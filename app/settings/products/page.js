'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function ProductsPage() {
    const router = useRouter()
    const [products, setProducts] = useState([])
    const [branches, setBranches] = useState([])
    const [stocks, setStocks] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [dbUser, setDbUser] = useState(null)
    
    // Search & Filter
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedBranchFilter, setSelectedBranchFilter] = useState('')

    // Inline Stock Edit State
    const [inlineStockValues, setInlineStockValues] = useState({}) // { `${productId}_${branchId}`: quantity }
    const [savingStockKey, setSavingStockKey] = useState(null) // `${productId}_${branchId}`

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState('add') // 'add' | 'edit'
    const [selectedProduct, setSelectedProduct] = useState(null)
    const [isSaving, setIsSaving] = useState(false)

    // Form states
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        price: '',
        is_active: true,
        branchStocks: {} // { branchId: quantity }
    })

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const checkAccess = async () => {
        setIsLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || (userData.role !== 'owner' && userData.role !== 'admin')) {
            alert('Akses Ditolak: Halaman ini hanya boleh diakses oleh Owner atau Admin.')
            router.push('/dashboard')
            return
        }
        setDbUser(userData)
        
        // Auto-select branch if non-owner admin
        if (userData.role !== 'owner' && userData.branch_id) {
            setSelectedBranchFilter(userData.branch_id)
        }

        await fetchData()
    }

    const fetchData = async () => {
        setIsLoading(true)
        
        // Fetch active branches
        const { data: brData } = await supabase
            .from('branches')
            .select('id, name, branch_code')
            .eq('is_active', true)
            .order('name', { ascending: true })
        if (brData) setBranches(brData)

        // Fetch products
        const { data: prData } = await supabase
            .from('products')
            .select('*')
            .order('name', { ascending: true })
        if (prData) setProducts(prData)

        // Fetch product stocks
        const { data: stData } = await supabase
            .from('product_stock')
            .select('*')
        if (stData) setStocks(stData)
        
        setIsLoading(false)
    }

    useEffect(() => {
        checkAccess()
    }, [supabase])

    // Get allowed branches for current user
    const getAllowedBranches = () => {
        if (!dbUser) return []
        if (dbUser.role === 'owner') return branches
        if (dbUser.branch_id) {
            return branches.filter(b => b.id === dbUser.branch_id)
        }
        return branches
    }

    // --- Inline Stock Edit Handlers ---
    const getStockForProductBranch = (productId, branchId) => {
        const entry = stocks.find(s => s.product_id === productId && s.branch_id === branchId)
        return entry ? entry.quantity : 0
    }

    const handleInlineInputChange = (productId, branchId, rawVal) => {
        const key = `${productId}_${branchId}`
        if (rawVal === '') {
            setInlineStockValues(prev => ({ ...prev, [key]: '' }))
            return
        }
        // Remove leading zeros before digits (e.g. "040" -> "40")
        const cleanVal = rawVal.replace(/^0+(?=\d)/, '')
        const numVal = parseInt(cleanVal, 10)
        setInlineStockValues(prev => ({
            ...prev,
            [key]: isNaN(numVal) ? '' : Math.max(0, numVal)
        }))
    }

    const handleInlineStockSave = async (productId, branchId, rawQty) => {
        const key = `${productId}_${branchId}`
        const numQty = rawQty === '' || isNaN(Number(rawQty)) ? 0 : Math.max(0, Number(rawQty))
        
        // Normalize state to number
        setInlineStockValues(prev => ({ ...prev, [key]: numQty }))

        const currentQtyInDB = getStockForProductBranch(productId, branchId)
        if (numQty === currentQtyInDB) return

        try {
            setSavingStockKey(key)
            const existingStock = stocks.find(s => s.product_id === productId && s.branch_id === branchId)

            if (existingStock) {
                const { error } = await supabase
                    .from('product_stock')
                    .update({
                        quantity: numQty,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingStock.id)
                if (error) throw error

                setStocks(prev => prev.map(s => s.id === existingStock.id ? { ...s, quantity: numQty } : s))
            } else {
                const { data: inserted, error } = await supabase
                    .from('product_stock')
                    .insert([{
                        product_id: productId,
                        branch_id: branchId,
                        quantity: numQty
                    }])
                    .select()
                    .single()
                if (error) throw error

                if (inserted) {
                    setStocks(prev => [...prev, inserted])
                }
            }

            setTimeout(() => {
                setSavingStockKey(null)
            }, 1200)
        } catch (err) {
            console.error('Error saving inline stock:', err)
            setSavingStockKey(null)
        }
    }

    const handleStepper = async (productId, branchId, delta) => {
        const key = `${productId}_${branchId}`
        const currentVal = inlineStockValues[key] !== undefined && inlineStockValues[key] !== '' 
            ? Number(inlineStockValues[key]) 
            : getStockForProductBranch(productId, branchId)
        const newQty = Math.max(0, currentVal + delta)
        
        setInlineStockValues(prev => ({
            ...prev,
            [key]: newQty
        }))
        await handleInlineStockSave(productId, branchId, newQty)
    }

    // --- Modal Handlers ---
    const handleOpenModal = (mode, product = null) => {
        setModalMode(mode)
        setSelectedProduct(product)

        const initialBranchStocks = {}
        branches.forEach(b => {
            if (product) {
                const stockEntry = stocks.find(s => s.product_id === product.id && s.branch_id === b.id)
                initialBranchStocks[b.id] = stockEntry ? stockEntry.quantity : 0
            } else {
                initialBranchStocks[b.id] = 0
            }
        })

        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                price: product.price || '',
                is_active: product.is_active !== undefined ? product.is_active : true,
                branchStocks: initialBranchStocks
            })
        } else {
            setFormData({
                name: '',
                description: '',
                price: '',
                is_active: true,
                branchStocks: initialBranchStocks
            })
        }
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setSelectedProduct(null)
    }

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }))
    }

    const handleBranchStockChange = (branchId, value) => {
        const numVal = Math.max(0, parseInt(value, 10) || 0)
        setFormData(prev => ({
            ...prev,
            branchStocks: {
                ...prev.branchStocks,
                [branchId]: numVal
            }
        }))
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setIsSaving(true)

        const productPayload = {
            name: formData.name.trim(),
            description: formData.description ? formData.description.trim() : null,
            price: Number(formData.price),
            is_active: formData.is_active,
            updated_at: new Date().toISOString()
        }

        try {
            let productId = selectedProduct?.id

            if (modalMode === 'add') {
                const { data: newProd, error } = await supabase
                    .from('products')
                    .insert([productPayload])
                    .select()
                    .single()

                if (error) throw error
                productId = newProd.id
            } else if (modalMode === 'edit' && productId) {
                const { error } = await supabase
                    .from('products')
                    .update(productPayload)
                    .eq('id', productId)

                if (error) throw error
            }

            // Save/Upsert stock ONLY for allowed branches (Owner = all branches, Admin = user branch)
            const allowedBranchesToSave = getAllowedBranches()

            if (productId) {
                for (const branch of allowedBranchesToSave) {
                    const qty = formData.branchStocks[branch.id] !== undefined ? formData.branchStocks[branch.id] : 0
                    const existingStock = stocks.find(s => s.product_id === productId && s.branch_id === branch.id)

                    if (existingStock) {
                        const { error: stockErr } = await supabase
                            .from('product_stock')
                            .update({
                                quantity: qty,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', existingStock.id)
                        if (stockErr) console.error(`Failed to update stock for branch ${branch.name}:`, stockErr)
                    } else {
                        const { error: stockErr } = await supabase
                            .from('product_stock')
                            .insert([{
                                product_id: productId,
                                branch_id: branch.id,
                                quantity: qty
                            }])
                        if (stockErr) console.error(`Failed to insert stock for branch ${branch.name}:`, stockErr)
                    }
                }
            }

            await fetchData()
            handleCloseModal()
        } catch (err) {
            alert('Gagal menyimpan data: ' + err.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleToggleActive = async (product) => {
        const { error } = await supabase
            .from('products')
            .update({ is_active: !product.is_active })
            .eq('id', product.id)
            
        if (!error) fetchData()
    }

    const getTotalStockForProduct = (productId) => {
        const allowed = getAllowedBranches()
        const allowedIds = new Set(allowed.map(b => b.id))
        return stocks
            .filter(s => s.product_id === productId && (allowedIds.size === 0 || allowedIds.has(s.branch_id)))
            .reduce((sum, s) => sum + (s.quantity || 0), 0)
    }

    const displayedProducts = products
        .filter(p => {
            const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()))
            if (!matchesSearch) return false

            if (selectedBranchFilter) {
                const qty = getStockForProductBranch(p.id, selectedBranchFilter)
                return qty >= 0
            }
            return true
        })

    const allowedBranches = getAllowedBranches()
    const userBranchName = dbUser?.role !== 'owner' && dbUser?.branch_id 
        ? branches.find(b => b.id === dbUser.branch_id)?.name 
        : null

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">Master & Stok Produk Skincare</h2>
                    <p className="text-sm text-ayumi-text-muted">
                        {dbUser?.role === 'owner' 
                            ? 'Kelola katalog produk, harga jual, dan jumlah stok di seluruh cabang klinik.'
                            : `Kelola stok produk untuk cabang ${userBranchName || 'Anda'}.`
                        }
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    {/* Branch Filter */}
                    <select
                        value={selectedBranchFilter}
                        onChange={(e) => setSelectedBranchFilter(e.target.value)}
                        disabled={dbUser?.role !== 'owner'}
                        className="input-ayumi bg-white text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                    >
                        {dbUser?.role === 'owner' && <option value="">Semua Cabang (Stok Total)</option>}
                        {branches
                            .filter(b => dbUser?.role === 'owner' || b.id === dbUser?.branch_id)
                            .map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))
                        }
                    </select>

                    {/* Search Input */}
                    <div className="relative flex-1 sm:w-64">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </span>
                        <input
                            type="text"
                            placeholder="Cari produk..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-10 bg-white w-full text-sm"
                        />
                    </div>

                    <button
                        onClick={() => handleOpenModal('add')}
                        className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm justify-center whitespace-nowrap bg-orange-500 hover:bg-orange-600 border-orange-500 hover:border-orange-600 shadow-sm"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                        Tambah Produk
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat data produk & stok...</div>
                ) : displayedProducts.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada data produk ditemukan.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold">Nama Produk</th>
                                    <th className="p-4 font-semibold text-right">Harga Jual (Rp)</th>
                                    <th className="p-4 font-semibold text-center">
                                        {allowedBranches.length === 1 
                                            ? `Stok (${allowedBranches[0]?.name})` 
                                            : 'Stok Per Cabang'
                                        }
                                    </th>
                                    <th className="p-4 font-semibold text-center">Total Stok</th>
                                    <th className="p-4 font-semibold text-center">Status</th>
                                    <th className="p-4 font-semibold text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {displayedProducts.map((p) => {
                                    const totalStock = getTotalStockForProduct(p.id)

                                    return (
                                        <tr key={p.id} className={`hover:bg-ayumi-table-hover transition-colors ${!p.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                                            {/* Product Name & Description */}
                                            <td className="p-4 font-medium text-gray-800">
                                                <div className="font-semibold text-gray-900">{p.name}</div>
                                                {p.description && <p className="text-xs text-gray-400 font-normal mt-0.5">{p.description}</p>}
                                            </td>

                                            {/* Selling Price */}
                                            <td className="p-4 text-right text-gray-700  font-bold">
                                                Rp {p.price?.toLocaleString('id-ID')}
                                            </td>

                                            {/* Direct Stock Editing Cell with Theme Focus Color */}
                                            <td className="p-4 text-center">
                                                {allowedBranches.length === 1 ? (
                                                    // Single Branch View (e.g. Admin Ciamis) -> Clean stepper & direct input with theme-colored active focus!
                                                    (() => {
                                                        const b = allowedBranches[0]
                                                        const key = `${p.id}_${b.id}`
                                                        const currentQty = inlineStockValues[key] !== undefined ? inlineStockValues[key] : getStockForProductBranch(p.id, b.id)
                                                        const isSavingKey = savingStockKey === key

                                                        return (
                                                            <div className="inline-flex items-center justify-center gap-1.5 bg-white hover:bg-orange-50/40 focus-within:bg-orange-50 focus-within:border-orange-400 focus-within:ring-4 focus-within:ring-orange-100 p-1.5 rounded-xl border border-gray-200 transition-all shadow-2xs">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleStepper(p.id, b.id, -1)}
                                                                    className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-extrabold text-base flex items-center justify-center transition-colors border border-gray-200 shadow-2xs cursor-pointer select-none"
                                                                    title="Kurangi Stok"
                                                                >
                                                                    -
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={currentQty}
                                                                    onFocus={(e) => e.target.select()}
                                                                    onChange={(e) => handleInlineInputChange(p.id, b.id, e.target.value)}
                                                                    onBlur={() => handleInlineStockSave(p.id, b.id, currentQty)}
                                                                    className="w-16 h-7 text-center  font-black text-sm border border-gray-200 rounded-md focus:border-orange-500 focus:ring-0 bg-transparent text-gray-900 focus:text-orange-950 outline-none"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleStepper(p.id, b.id, 1)}
                                                                    className="w-7 h-7 rounded-lg bg-orange-100 hover:bg-orange-200 active:bg-orange-300 text-orange-700 font-extrabold text-base flex items-center justify-center transition-colors border border-orange-200 shadow-2xs cursor-pointer select-none"
                                                                    title="Tambah Stok"
                                                                >
                                                                    +
                                                                </button>
                                                                <span className="text-xs font-semibold text-gray-400 pl-0.5">pcs</span>
                                                                {isSavingKey && (
                                                                    <span className="text-xs font-bold text-emerald-600 ml-1 animate-pulse">✓ Tersimpan</span>
                                                                )}
                                                            </div>
                                                        )
                                                    })()
                                                ) : (
                                                    // Multi-Branch View (e.g. Owner) -> Clean grid of direct stock inputs with active theme colors
                                                    <div className="flex flex-wrap gap-2 items-center justify-center">
                                                        {allowedBranches.map(b => {
                                                            const key = `${p.id}_${b.id}`
                                                            const currentQty = inlineStockValues[key] !== undefined ? inlineStockValues[key] : getStockForProductBranch(p.id, b.id)
                                                            const isSavingKey = savingStockKey === key

                                                            return (
                                                                <div 
                                                                    key={b.id} 
                                                                    className="inline-flex items-center gap-1.5 bg-white hover:bg-orange-50/50 focus-within:bg-orange-50 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-200/60 border border-gray-200 px-2.5 py-1 rounded-xl transition-all shadow-2xs"
                                                                >
                                                                    <span className="text-xs font-bold text-gray-500 ">{b.branch_code || b.name.slice(0,3).toUpperCase()}:</span>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        value={currentQty}
                                                                        onFocus={(e) => e.target.select()}
                                                                        onChange={(e) => handleInlineInputChange(p.id, b.id, e.target.value)}
                                                                        onBlur={() => handleInlineStockSave(p.id, b.id, currentQty)}
                                                                        className="w-14 h-7 text-center  font-black text-xs bg-transparent outline-none text-gray-800 focus:text-orange-950"
                                                                    />
                                                                    {isSavingKey && <span className="text-[10px] font-bold text-emerald-600">✓</span>}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Total Stock Badge */}
                                            <td className="p-4 text-center">
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold  ${
                                                    totalStock === 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {totalStock} pcs
                                                </span>
                                            </td>

                                            {/* Active Toggle */}
                                            <td className="p-4 text-center">
                                                <button 
                                                    onClick={() => handleToggleActive(p)}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${p.is_active ? 'bg-orange-500' : 'bg-gray-300'}`}
                                                    title={p.is_active ? 'Nonaktifkan Produk' : 'Aktifkan Produk'}
                                                >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </button>
                                            </td>

                                            {/* Action Button (Pencil Icon for Full Product Details Edit) */}
                                            <td className="p-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button 
                                                        onClick={() => handleOpenModal('edit', p)}
                                                        className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors border border-transparent hover:border-orange-200"
                                                        title="Edit Detail Produk (Nama / Harga / Kategori)"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Unified Modal Form (Product Details Edit) */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8 transform transition-all">
                        <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-orange-50/50 rounded-t-2xl">
                            <div>
                                <h3 className="text-lg font-bold text-orange-800">
                                    {modalMode === 'add' ? 'Tambah Master Produk & Stok' : 'Edit Detail Master Produk'}
                                </h3>
                                <p className="text-xs text-orange-600 mt-0.5">
                                    {dbUser?.role === 'owner' 
                                        ? 'Atur detail produk dan alokasi stok untuk semua cabang.'
                                        : `Atur detail produk dan alokasi stok untuk cabang ${userBranchName || 'Anda'}.`
                                    }
                                </p>
                            </div>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-4 md:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                            {/* Product Info Section */}
                            <div className="space-y-3 pb-3 border-b border-gray-100">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Informasi Produk</h4>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Produk</label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        required
                                        className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400 text-sm"
                                        placeholder="Contoh: Mid-Night Brightening Cream"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Kategori / Deskripsi (Opsional)</label>
                                    <input
                                        type="text"
                                        name="description"
                                        value={formData.description}
                                        onChange={handleChange}
                                        className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400 text-sm"
                                        placeholder="Contoh: Kategori: YUFADERMA BRIGHT"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Harga Jual (Rp)</label>
                                    <input
                                        type="number"
                                        name="price"
                                        value={formData.price}
                                        onChange={handleChange}
                                        required
                                        min="0"
                                        className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400 text-sm  font-bold"
                                    />
                                </div>
                            </div>

                            {/* Branch Stock Allocation Section */}
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                                        {dbUser?.role === 'owner' ? 'Alokasi Stok Per Cabang' : `Alokasi Stok (${userBranchName || 'Cabang Anda'})`}
                                    </h4>
                                    <span className="text-xs text-gray-400 font-normal">Jumlah unit fisik</span>
                                </div>

                                <div className={`grid gap-3 ${allowedBranches.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                                    {allowedBranches.map(b => (
                                        <div key={b.id} className="p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-bold text-gray-700">{b.name}</span>
                                            </div>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formData.branchStocks[b.id] !== undefined ? formData.branchStocks[b.id] : 0}
                                                onChange={(e) => handleBranchStockChange(b.id, e.target.value)}
                                                className="input-ayumi bg-white text-sm  font-bold w-full text-right focus:ring-orange-200 focus:border-orange-400"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Active Status */}
                            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <div>
                                    <label className="text-sm font-semibold text-gray-700 block">Status Aktif Produk</label>
                                    <p className="text-xs text-gray-400">Produk aktif akan muncul di layar Kasir/POS.</p>
                                </div>
                                <button 
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-orange-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-5 py-2.5 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl shadow-md transition-all flex items-center gap-2"
                                >
                                    {isSaving ? 'Menyimpan...' : 'Simpan Produk & Stok'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
