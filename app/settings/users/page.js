'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

export default function UsersPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [users, setUsers] = useState([])
    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [currentUser, setCurrentUser] = useState(null)
    const [error, setError] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [showPassword, setShowPassword] = useState(false)

    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        password: '',
        phone: '',
        role: 'admin',
        branch_id: '',
        is_active: true
    })

    useEffect(() => {
        checkRoleAndFetchData()
    }, [])

    const checkRoleAndFetchData = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
        if (userData?.role !== 'owner') {
            alert('Akses Ditolak: Hanya Owner yang dapat mengakses halaman ini.')
            router.push('/settings')
            return
        }

        // Fetch users & branches
        const [usersRes, branchesRes] = await Promise.all([
            supabase.from('users').select('*, branches(name)').order('created_at', { ascending: false }),
            supabase.from('branches').select('id, name').eq('is_active', true)
        ])

        if (usersRes.data) setUsers(usersRes.data)
        if (branchesRes.data) setBranches(branchesRes.data)
        
        setLoading(false)
    }

    const handleOpenAdd = () => {
        setFormData({ full_name: '', email: '', password: '', phone: '', role: 'admin', branch_id: '', is_active: true })
        setIsEditing(false)
        setCurrentUser(null)
        setError('')
        setIsModalOpen(true)
        setShowPassword(false)
    }

    const handleOpenEdit = (user) => {
        setFormData({
            full_name: user.full_name || '',
            email: user.email || '',
            password: '', // tidak bisa edit password dari sini
            phone: user.phone || '',
            role: user.role || 'admin',
            branch_id: user.branch_id || '',
            is_active: user.is_active
        })
        setIsEditing(true)
        setCurrentUser(user)
        setError('')
        setIsModalOpen(true)
        setShowPassword(false)
    }

    const handleToggleActive = async (u) => {
        const { error } = await supabase
            .from('users')
            .update({ is_active: !u.is_active, updated_at: new Date().toISOString() })
            .eq('id', u.id)
        if (!error) {
            toast.success(`User berhasil di${!u.is_active ? 'aktifkan' : 'nonaktifkan'}`)
            checkRoleAndFetchData()
        } else {
            toast.error('Gagal mengubah status user')
        }
    }

    const handleDelete = async (u) => {
        if (!confirm(`Apakah Anda yakin ingin menghapus user ${u.full_name}? Aksi ini tidak dapat dibatalkan.`)) return
        
        try {
            toast.loading('Menghapus user...', { id: 'delete' })
            const res = await fetch(`/api/users?id=${u.id}`, { method: 'DELETE' })
            const result = await res.json()
            
            if (!res.ok) throw new Error(result.error || 'Gagal menghapus user')
            
            toast.success('User berhasil dihapus', { id: 'delete' })
            checkRoleAndFetchData()
        } catch (err) {
            toast.error(err.message, { id: 'delete' })
        }
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setError('')
        setIsSaving(true)

        try {
            if (formData.role === 'owner') formData.branch_id = null

            if (isEditing) {
                // Update via API Route (Service Role) to handle password changes
                const updatePayload = {
                    id: currentUser.id,
                    email: formData.email,
                    full_name: formData.full_name,
                    phone: formData.phone,
                    role: formData.role,
                    branch_id: formData.branch_id,
                    is_active: formData.is_active
                }
                if (formData.password) updatePayload.password = formData.password

                const res = await fetch('/api/users', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatePayload)
                })

                const result = await res.json()
                if (!res.ok) throw new Error(result.error || 'Gagal update user')
                
                toast.success('User berhasil diupdate!')
                setTimeout(() => { setIsModalOpen(false); checkRoleAndFetchData() }, 1000)

            } else {
                // Create New Auth User via API Route (Service Role)
                const res = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                })

                const result = await res.json()
                if (!res.ok) throw new Error(result.error || 'Gagal membuat user')

                toast.success('User berhasil dibuat!')
                setTimeout(() => { setIsModalOpen(false); checkRoleAndFetchData() }, 1000)
            }
        } catch (err) {
            setError(err.message)
            toast.error(err.message)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola akses sistem untuk dokter, terapis, dan admin.</p>
                </div>
                <button 
                    onClick={handleOpenAdd}
                    className="btn-primary px-5 py-2.5 flex items-center gap-2"
                >
                    <span>+ Tambah User</span>
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
                            <thead className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                <tr>
                                    <th className="px-6 py-4">User</th>
                                    <th className="px-6 py-4">Role & Cabang</th>
                                    <th className="px-6 py-4">Kontak</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {users.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-400">Belum ada data user.</td></tr>
                                ) : (
                                    users.map(u => (
                                        <tr key={u.id} className="hover:bg-ayumi-table-hover transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{u.full_name}</div>
                                                <div className="text-xs text-gray-500">{u.email}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className={`inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wider mb-1 ${u.role === 'owner' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {u.role}
                                                </div>
                                                <div className="text-xs text-gray-500 font-medium">
                                                    {u.role === 'owner' ? 'Semua Cabang' : (u.branches?.name || 'Tidak ada cabang')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-700">{u.phone || '-'}</td>
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => handleToggleActive(u)}
                                                    className={`px-3 py-1 text-xs font-bold rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                                >
                                                    {u.is_active ? 'Aktif' : 'Nonaktif'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button 
                                                        onClick={() => handleOpenEdit(u)}
                                                        className="text-ayumi-primary hover:text-ayumi-secondary font-bold px-3 py-1 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(u)}
                                                        className="text-red-500 hover:text-red-700 font-bold px-3 py-1 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                    >
                                                        Hapus
                                                    </button>
                                                </div>
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
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in-up max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                            <h3 className="text-xl font-bold text-gray-800">{isEditing ? 'Edit User' : 'Tambah User Baru'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-red-500">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1">
                            <form onSubmit={handleSave} className="space-y-4">
                                {error && <div className="p-3 bg-red-50 text-red-600 text-sm font-semibold rounded-xl border border-red-100">{error}</div>}
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Lengkap *</label>
                                        <input 
                                            type="text" required
                                            className="input-ayumi bg-white"
                                            value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">Nomor Telepon</label>
                                        <input 
                                            type="text" 
                                            className="input-ayumi bg-white"
                                            value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email *</label>
                                    <input 
                                        type="email" required
                                        className="input-ayumi bg-white"
                                        value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                                    />
                                    {isEditing && <p className="text-xs text-gray-400 mt-1">Ubah email jika ingin mengganti email login pengguna ini.</p>}
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        {isEditing ? 'Password Baru (Opsional)' : 'Password *'}
                                    </label>
                                    <div className="relative">
                                        <input 
                                            type={showPassword ? 'text' : 'password'} required={!isEditing} minLength="8"
                                            className="input-ayumi bg-white pr-10"
                                            value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                                            placeholder={isEditing ? 'Kosongkan jika tidak ingin diubah' : 'Minimal 8 karakter'}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                        >
                                            {showPassword ? (
                                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                </svg>
                                            ) : (
                                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">Role (Hak Akses) *</label>
                                        <select 
                                            className="input-ayumi bg-white font-semibold"
                                            value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
                                        >
                                            <option value="admin">Admin / Pegawai</option>
                                            <option value="therapist">Terapis</option>
                                            <option value="owner">Owner (Semua Akses)</option>
                                        </select>
                                    </div>

                                    {(formData.role === 'admin' || formData.role === 'therapist') && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">Penempatan Cabang *</label>
                                            <select 
                                                required
                                                className="input-ayumi bg-white"
                                                value={formData.branch_id} onChange={e => setFormData({...formData, branch_id: e.target.value})}
                                            >
                                                <option value="">Pilih Cabang</option>
                                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {isEditing && (
                                    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                                        <input 
                                            type="checkbox" 
                                            id="isActiveUser"
                                            checked={formData.is_active}
                                            onChange={e => setFormData({...formData, is_active: e.target.checked})}
                                            className="w-4 h-4 text-ayumi-primary rounded focus:ring-ayumi-primary"
                                        />
                                        <label htmlFor="isActiveUser" className="text-sm font-semibold text-gray-700">Akun Aktif (Bisa Login)</label>
                                    </div>
                                )}

                                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 mt-6">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Batal</button>
                                    <button type="submit" disabled={isSaving} className="btn-primary px-6 py-2.5 flex items-center gap-2 disabled:opacity-50">
                                        {isSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                                        {isSaving ? 'Menyimpan...' : 'Simpan User'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
