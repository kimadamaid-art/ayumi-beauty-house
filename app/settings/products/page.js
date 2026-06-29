'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function ProductsPage() {
    const router = useRouter()
    const [products, setProducts] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    
    // Search filter
    const [searchQuery, setSearchQuery] = useState('')

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
        is_active: true
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

        const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'owner') {
            alert('Akses Ditolak: Halaman ini hanya boleh diakses oleh Owner.')
            router.push('/dashboard')
            return
        }
        await fetchData()
    }

    const fetchData = async () => {
        setIsLoading(true)
        
        let query = supabase.from('products').select('*').order('name', { ascending: true })
        
        const { data: prData } = await query
        if (prData) setProducts(prData)
        
        setIsLoading(false)
    }

    useEffect(() => {
        checkAccess()
    }, [supabase])

    const handleOpenModal = (mode, product = null) => {
        setModalMode(mode)
        setSelectedProduct(product)
        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                price: product.price || '',
                is_active: product.is_active !== undefined ? product.is_active : true
            })
        } else {
            setFormData({
                name: '',
                description: '',
                price: '',
                is_active: true
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

    const handleSave = async (e) => {
        e.preventDefault()
        setIsSaving(true)

        const payload = {
            name: formData.name,
            description: formData.description,
            price: Number(formData.price),
            is_active: formData.is_active
        }

        if (modalMode === 'add') {
            const { error } = await supabase.from('products').insert([payload])
            if (!error) fetchData()
            else alert('Gagal menyimpan data: ' + error.message)
        } else if (modalMode === 'edit' && selectedProduct) {
            const { error } = await supabase.from('products').update(payload).eq('id', selectedProduct.id)
            if (!error) fetchData()
            else alert('Gagal mengupdate data: ' + error.message)
        }

        setIsSaving(false)
        handleCloseModal()
    }

    const handleToggleActive = async (product) => {
        const { error } = await supabase
            .from('products')
            .update({ is_active: !product.is_active })
            .eq('id', product.id)
            
        if (!error) fetchData()
    }

    const displayedProducts = products
        .filter(p => {
            if (!searchQuery) return true
            return p.name.toLowerCase().includes(searchQuery.toLowerCase())
        })

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola daftar master produk fisik yang dijual di klinik.</p>
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
                    <button
                        onClick={() => handleOpenModal('add')}
                        className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm justify-center whitespace-nowrap bg-orange-500 hover:bg-orange-600 border-orange-500 hover:border-orange-600"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                        Tambah Produk
                    </button>
                </div>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : displayedProducts.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada data produk ditemukan.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold">Nama Produk</th>
                                    <th className="p-4 font-semibold text-right">Harga Jual (Rp)</th>
                                    <th className="p-4 font-semibold text-center">Status</th>
                                    <th className="p-4 font-semibold text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {displayedProducts.map((p) => (
                                    <tr key={p.id} className={`hover:bg-ayumi-table-hover transition-colors ${!p.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                                        <td className="p-4 font-medium text-gray-800">
                                            {p.name}
                                            {p.description && <p className="text-xs text-gray-400 font-normal mt-0.5">{p.description}</p>}
                                        </td>
                                        <td className="p-4 text-right text-gray-700 font-mono font-bold">
                                            Rp {p.price?.toLocaleString('id-ID')}
                                        </td>
                                        <td className="p-4 text-center">
                                            <button 
                                                onClick={() => handleToggleActive(p)}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${p.is_active ? 'bg-orange-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <button 
                                                    onClick={() => handleOpenModal('edit', p)}
                                                    className="text-orange-500 hover:text-orange-700 p-1.5 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal Form */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8 transform transition-all">
                        <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-orange-50/50 rounded-t-2xl">
                            <h3 className="text-lg font-bold text-orange-800">
                                {modalMode === 'add' ? 'Tambah Master Produk' : 'Edit Master Produk'}
                            </h3>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-4 md:p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Produk</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Deskripsi / SKU (Opsional)</label>
                                <input
                                    type="text"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400"
                                    placeholder="Contoh: Serum Anti Aging 30ml"
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
                                    className="input-ayumi bg-white focus:ring-orange-200 focus:border-orange-400"
                                />
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <label className="text-sm font-semibold text-gray-700">Status Aktif</label>
                                <button 
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-orange-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-gray-100">
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
                                    {isSaving ? 'Menyimpan...' : 'Simpan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
