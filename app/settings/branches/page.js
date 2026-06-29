'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

export default function BranchesPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [currentBranch, setCurrentBranch] = useState(null)
    const [error, setError] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        address: '',
        phone: '',
        city: '',
        is_active: true
    })

    useEffect(() => {
        checkAccess()
    }, [])

    const checkAccess = async () => {
        setLoading(true)
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
        await fetchBranches()
    }

    const fetchBranches = async () => {
        const { data, error } = await supabase
            .from('branches')
            .select('*')
            .order('name', { ascending: true })
        if (data) setBranches(data)
        setLoading(false)
    }

    const handleOpenAdd = () => {
        setFormData({ name: '', address: '', phone: '', city: '', is_active: true })
        setIsEditing(false)
        setCurrentBranch(null)
        setError('')
        setIsModalOpen(true)
    }

    const handleOpenEdit = (branch) => {
        setFormData({
            name: branch.name || '',
            address: branch.address || '',
            phone: branch.phone || '',
            city: branch.city || '',
            is_active: branch.is_active
        })
        setIsEditing(true)
        setCurrentBranch(branch)
        setError('')
        setIsModalOpen(true)
    }

    const handleToggleActive = async (branch) => {
        const { error } = await supabase
            .from('branches')
            .update({ is_active: !branch.is_active, updated_at: new Date().toISOString() })
            .eq('id', branch.id)
        if (!error) {
            toast.success(`Cabang berhasil di${!branch.is_active ? 'aktifkan' : 'nonaktifkan'}`)
            fetchBranches()
        } else {
            toast.error('Gagal mengubah status cabang')
        }
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setError('')
        
        try {
            if (isEditing) {
                const { error: dbError } = await supabase
                    .from('branches')
                    .update({ ...formData, updated_at: new Date().toISOString() })
                    .eq('id', currentBranch.id)
                if (dbError) throw dbError
            } else {
                const { error: dbError } = await supabase
                    .from('branches')
                    .insert([formData])
                if (dbError) throw dbError
            }
            
            setIsModalOpen(false)
            toast.success(`Cabang berhasil ${isEditing ? 'diperbarui' : 'ditambahkan'}!`)
            fetchBranches()
        } catch (err) {
            setError(err.message)
            toast.error(err.message)
        }
    }

    return (
        <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola daftar cabang klinik dan informasi kontaknya.</p>
                </div>
                <button 
                    onClick={handleOpenAdd}
                    className="btn-primary px-5 py-2.5 flex items-center gap-2"
                >
                    <span>+ Tambah Cabang</span>
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            ) : (
                <div className="card-ayumi overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left text-sm text-gray-600">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary text-sm border-b border-gray-100">
                                <tr>
                                    <th className="px-6 py-4">Nama Cabang</th>
                                    <th className="px-6 py-4">Kota</th>
                                    <th className="px-6 py-4">Telepon</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {branches.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-400">Belum ada data cabang.</td></tr>
                                ) : (
                                    branches.map(b => (
                                        <tr key={b.id} className="hover:bg-ayumi-table-hover transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{b.name}</div>
                                                <div className="text-xs text-gray-500 truncate max-w-[200px]">{b.address || '-'}</div>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-700">{b.city || '-'}</td>
                                            <td className="px-6 py-4">{b.phone || '-'}</td>
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => handleToggleActive(b)}
                                                    className={`px-3 py-1 text-xs font-bold rounded-full ${b.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                                >
                                                    {b.is_active ? 'Aktif' : 'Nonaktif'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => handleOpenEdit(b)}
                                                    className="text-ayumi-primary hover:text-ayumi-secondary font-bold px-3 py-1 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors"
                                                >
                                                    Edit
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal Add/Edit */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-fade-in-up">
                        <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-xl font-bold text-gray-800">{isEditing ? 'Edit Cabang' : 'Tambah Cabang Baru'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-red-500">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-4 md:p-6 space-y-4">
                            {error && <div className="p-3 bg-red-50 text-red-600 text-sm font-semibold rounded-xl">{error}</div>}
                            
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Cabang *</label>
                                <input 
                                    type="text" required
                                    className="input-ayumi bg-white"
                                    value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Kota</label>
                                <input 
                                    type="text" 
                                    className="input-ayumi bg-white"
                                    value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nomor Telepon/WA</label>
                                <input 
                                    type="text" 
                                    className="input-ayumi bg-white"
                                    value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Alamat Lengkap</label>
                                <textarea 
                                    rows="2"
                                    className="input-ayumi bg-white"
                                    value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}
                                ></textarea>
                            </div>

                            {isEditing && (
                                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                                    <input 
                                        type="checkbox" 
                                        id="isActive"
                                        checked={formData.is_active}
                                        onChange={e => setFormData({...formData, is_active: e.target.checked})}
                                        className="w-4 h-4 text-ayumi-primary rounded focus:ring-ayumi-primary"
                                    />
                                    <label htmlFor="isActive" className="text-sm font-semibold text-gray-700">Cabang Aktif Beroperasi</label>
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Batal</button>
                                <button type="submit" className="btn-primary px-6 py-2.5">Simpan Data</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
