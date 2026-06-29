'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function ProductStockPage() {
    const [products, setProducts] = useState([])
    const [branches, setBranches] = useState([])
    const [stocks, setStocks] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [dbUser, setDbUser] = useState(null)
    
    // Filters
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedBranch, setSelectedBranch] = useState('')

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedProduct, setSelectedProduct] = useState(null)
    const [selectedBranchForStock, setSelectedBranchForStock] = useState('')
    const [newQuantity, setNewQuantity] = useState(0)
    const [isSaving, setIsSaving] = useState(false)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const fetchData = async () => {
        setIsLoading(true)
        
        // Fetch User for Branch filtering
        const { data: { user } } = await supabase.auth.getUser()
        let userBranchId = null
        if (user) {
            const { data: uData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (uData) {
                setDbUser(uData)
                if (uData.role !== 'owner') {
                    userBranchId = uData.branch_id
                    setSelectedBranch(uData.branch_id || '')
                }
            }
        }
        
        // Fetch Branches
        const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
        if (brData) setBranches(brData)
            
        // Fetch Products
        const { data: prData } = await supabase.from('products').select('*').eq('is_active', true).order('name', { ascending: true })
        if (prData) setProducts(prData)
            
        // Fetch Stocks
        let stockQuery = supabase.from('product_stock').select('*')
        if (userBranchId) stockQuery = stockQuery.eq('branch_id', userBranchId)
            
        const { data: stData } = await stockQuery
        if (stData) setStocks(stData)
        
        setIsLoading(false)
    }

    useEffect(() => {
        fetchData()
    }, [supabase])

    const handleOpenModal = (product, branchId) => {
        if (dbUser?.role === 'therapist') {
            alert('Akses Ditolak: Terapis tidak diizinkan mengedit stok produk.')
            return
        }
        if (dbUser?.role !== 'owner' && branchId !== dbUser?.branch_id) {
            alert('Anda tidak memiliki izin untuk mengedit stok di cabang lain.')
            return
        }
        const currentStock = stocks.find(s => s.product_id === product.id && s.branch_id === branchId)
        
        setSelectedProduct(product)
        setSelectedBranchForStock(branchId)
        setNewQuantity(currentStock ? currentStock.quantity : 0)
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setSelectedProduct(null)
        setNewQuantity(0)
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setIsSaving(true)

        const currentStock = stocks.find(s => s.product_id === selectedProduct.id && s.branch_id === selectedBranchForStock)
        
        if (currentStock) {
            // Update
            const { error } = await supabase
                .from('product_stock')
                .update({ quantity: Number(newQuantity), updated_at: new Date() })
                .eq('id', currentStock.id)
                
            if (!error) fetchData()
            else alert('Gagal mengupdate stok: ' + error.message)
        } else {
            // Insert
            const { error } = await supabase
                .from('product_stock')
                .insert([{
                    product_id: selectedProduct.id,
                    branch_id: selectedBranchForStock,
                    quantity: Number(newQuantity)
                }])
                
            if (!error) fetchData()
            else alert('Gagal menyimpan stok: ' + error.message)
        }

        setIsSaving(false)
        handleCloseModal()
    }

    const displayedBranches = branches.filter(b => selectedBranch === '' || b.id === selectedBranch)
    
    const displayedProducts = products.filter(p => {
        if (!searchQuery) return true
        return p.name.toLowerCase().includes(searchQuery.toLowerCase())
    })

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola inventaris dan jumlah stok produk per cabang.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </span>
                        <input
                            type="text"
                            placeholder="Cari produk..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-10 bg-white w-full"
                        />
                    </div>
                    {(!dbUser || dbUser.role === 'owner') && (
                        <select
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="input-ayumi bg-white sm:w-48 font-semibold text-gray-700"
                        >
                            <option value="">Semua Cabang</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : displayedProducts.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada data produk aktif ditemukan. Silakan tambahkan produk di Master Produk.</div>
                ) : displayedBranches.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada cabang ditemukan.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-teal-50/50 border-b border-teal-100 text-teal-800 text-sm">
                                    <th className="p-4 font-bold border-r border-teal-100 min-w-[200px]">Nama Produk</th>
                                    {displayedBranches.map(b => (
                                        <th key={b.id} className="p-4 font-bold text-center border-r border-teal-100 last:border-0 min-w-[150px]">
                                            Stok {b.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {displayedProducts.map((p) => (
                                    <tr key={p.id} className="hover:bg-teal-50/30 transition-colors">
                                        <td className="p-4 font-medium text-gray-800 border-r border-gray-50">
                                            {p.name}
                                            {p.description && <p className="text-[10px] text-gray-400 font-normal mt-1">{p.description}</p>}
                                        </td>
                                        {displayedBranches.map(b => {
                                            const stockItem = stocks.find(s => s.product_id === p.id && s.branch_id === b.id)
                                            const qty = stockItem ? stockItem.quantity : 0
                                            
                                            let stockColor = "text-gray-700 bg-gray-100"
                                            if (qty > 10) stockColor = "text-teal-700 bg-teal-100"
                                            else if (qty > 0) stockColor = "text-orange-700 bg-orange-100"
                                            else stockColor = "text-red-700 bg-red-100 font-bold"

                                            return (
                                                <td key={b.id} className="p-4 text-center border-r border-gray-50 last:border-0">
                                                    <div className="flex items-center justify-center gap-3">
                                                        <span className={`px-2.5 py-1 rounded-md font-mono ${stockColor}`}>
                                                            {qty}
                                                        </span>
                                                        <button 
                                                            onClick={() => handleOpenModal(p, b.id)}
                                                            className="text-teal-600 hover:text-teal-800 p-1.5 hover:bg-teal-50 rounded-lg transition-colors"
                                                            title="Update Stok"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal Update Stock */}
            {isModalOpen && selectedProduct && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm my-8 transform transition-all">
                        <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-teal-50/50 rounded-t-2xl">
                            <h3 className="text-lg font-bold text-teal-800">Update Stok Produk</h3>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-4 md:p-6 space-y-5">
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Produk</p>
                                <p className="font-bold text-gray-800">{selectedProduct.name}</p>
                            </div>
                            
                            <div>
                                <p className="text-sm text-gray-500 mb-1">Cabang</p>
                                <p className="font-semibold text-gray-700">{branches.find(b => b.id === selectedBranchForStock)?.name}</p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Sisa Stok Fisik Saat Ini</label>
                                <div className="flex items-center gap-3">
                                    <button 
                                        type="button" 
                                        onClick={() => setNewQuantity(Math.max(0, newQuantity - 1))}
                                        className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" /></svg>
                                    </button>
                                    <input
                                        type="number"
                                        value={newQuantity}
                                        onChange={(e) => setNewQuantity(parseInt(e.target.value) || 0)}
                                        min="0"
                                        className="input-ayumi bg-white text-center text-xl font-bold font-mono focus:ring-teal-200 focus:border-teal-400 flex-1"
                                    />
                                    <button 
                                        type="button" 
                                        onClick={() => setNewQuantity(newQuantity + 1)}
                                        className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-gray-100">
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
                                    className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md transition-all flex items-center gap-2"
                                >
                                    {isSaving ? 'Menyimpan...' : 'Simpan Stok'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
