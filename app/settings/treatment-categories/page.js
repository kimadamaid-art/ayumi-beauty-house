'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function TreatmentCategoriesPage() {
    const router = useRouter()
    const [categories, setCategories] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    
    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState('add') // 'add' | 'edit'
    const [selectedCategory, setSelectedCategory] = useState(null)
    const [categoryName, setCategoryName] = useState('')
    const [isSaving, setIsSaving] = useState(false)

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
        await fetchCategories()
    }

    const fetchCategories = async () => {
        const { data, error } = await supabase
            .from('treatment_categories')
            .select('*')
            .order('name', { ascending: true })
        
        if (!error && data) {
            setCategories(data)
        }
        setIsLoading(false)
    }

    useEffect(() => {
        checkAccess()
    }, [supabase])

    const handleOpenModal = (mode, category = null) => {
        setModalMode(mode)
        setSelectedCategory(category)
        setCategoryName(category ? category.name : '')
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setSelectedCategory(null)
        setCategoryName('')
    }

    const handleSave = async (e) => {
        e.preventDefault()
        if (!categoryName.trim()) return

        setIsSaving(true)
        if (modalMode === 'add') {
            const { error } = await supabase
                .from('treatment_categories')
                .insert([{ name: categoryName.trim() }])
            if (!error) fetchCategories()
        } else if (modalMode === 'edit' && selectedCategory) {
            const { error } = await supabase
                .from('treatment_categories')
                .update({ name: categoryName.trim() })
                .eq('id', selectedCategory.id)
            if (!error) fetchCategories()
        }
        setIsSaving(false)
        handleCloseModal()
    }

    const handleDelete = async (id) => {
        if (!confirm('Apakah Anda yakin ingin menghapus kategori ini? Semua treatment terkait mungkin akan terpengaruh.')) return

        const { error } = await supabase
            .from('treatment_categories')
            .delete()
            .eq('id', id)
            
        if (!error) fetchCategories()
        else alert('Gagal menghapus kategori. Pastikan tidak ada treatment yang menggunakannya.')
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola data master kategori perawatan klinik.</p>
                </div>
                <button
                    onClick={() => handleOpenModal('add')}
                    className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    Tambah Kategori
                </button>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : categories.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Belum ada data kategori.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold w-16 text-center">No</th>
                                    <th className="p-4 font-semibold">Nama Kategori</th>
                                    <th className="p-4 font-semibold w-32 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {categories.map((cat, idx) => (
                                    <tr key={cat.id} className="hover:bg-ayumi-table-hover transition-colors group">
                                        <td className="p-4 text-center text-gray-500">{idx + 1}</td>
                                        <td className="p-4 font-medium text-gray-800">{cat.name}</td>
                                        <td className="p-4">
                                            <div className="flex items-center justify-center gap-3 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => handleOpenModal('edit', cat)}
                                                    className="text-blue-600 hover:text-blue-800 p-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(cat.id)}
                                                    className="text-red-600 hover:text-red-800 p-1.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                    title="Hapus"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden transform transition-all">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-pink-50/30">
                            <h3 className="text-lg font-bold text-ayumi-secondary">
                                {modalMode === 'add' ? 'Tambah Kategori' : 'Edit Kategori'}
                            </h3>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6">
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Nama Kategori</label>
                                <input
                                    type="text"
                                    value={categoryName}
                                    onChange={(e) => setCategoryName(e.target.value)}
                                    placeholder="Contoh: Facial Treatment"
                                    required
                                    className="input-ayumi bg-white"
                                />
                            </div>
                            <div className="flex gap-3 justify-end">
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
                                    className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm"
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
