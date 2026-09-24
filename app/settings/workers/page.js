'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

// Worker adalah tenaga non-terapis (infus dan sejenisnya) yang upahnya dicatat
// dalam nominal rupiah, bukan persen seperti komisi terapis. Worker tidak punya
// akun login: daftar ini murni data pencatatan yang dikelola owner, dan berlaku
// lintas cabang.
export default function WorkersPage() {
    const router = useRouter()
    const [workers, setWorkers] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState('add') // 'add' | 'edit'
    const [selectedWorker, setSelectedWorker] = useState(null)
    const [fullName, setFullName] = useState('')
    const [phone, setPhone] = useState('')
    const [notes, setNotes] = useState('')
    const [isActive, setIsActive] = useState(true)
    const [isSaving, setIsSaving] = useState(false)

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
        await fetchWorkers()
    }

    const fetchWorkers = async () => {
        const { data, error } = await supabase
            .from('workers')
            .select('*')
            .order('is_active', { ascending: false })
            .order('full_name', { ascending: true })

        if (!error && data) {
            setWorkers(data)
        }
        setIsLoading(false)
    }

    useEffect(() => {
        checkAccess()
    }, [supabase])

    const handleOpenModal = (mode, worker = null) => {
        setModalMode(mode)
        setSelectedWorker(worker)
        setFullName(worker ? worker.full_name : '')
        setPhone(worker ? (worker.phone || '') : '')
        setNotes(worker ? (worker.notes || '') : '')
        setIsActive(worker ? worker.is_active : true)
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setSelectedWorker(null)
        setFullName('')
        setPhone('')
        setNotes('')
        setIsActive(true)
    }

    const handleSave = async (e) => {
        e.preventDefault()
        if (!fullName.trim()) return

        setIsSaving(true)
        const payload = {
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            notes: notes.trim() || null,
            is_active: isActive
        }

        let error = null
        if (modalMode === 'add') {
            ({ error } = await supabase.from('workers').insert([payload]))
        } else if (selectedWorker) {
            ({ error } = await supabase.from('workers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', selectedWorker.id))
        }

        setIsSaving(false)
        if (error) {
            alert('Gagal menyimpan data worker: ' + error.message)
            return
        }
        await fetchWorkers()
        handleCloseModal()
    }

    // Worker yang sudah pernah mengerjakan tindakan tidak dihapus, hanya dinonaktifkan,
    // supaya laporan upah periode sebelumnya tetap menampilkan namanya.
    const handleToggleActive = async (worker) => {
        const { error } = await supabase
            .from('workers')
            .update({ is_active: !worker.is_active, updated_at: new Date().toISOString() })
            .eq('id', worker.id)

        if (error) {
            alert('Gagal mengubah status worker: ' + error.message)
            return
        }
        fetchWorkers()
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">
                        Kelola daftar worker (tenaga infus dan tindakan sejenis). Upahnya dicatat dalam rupiah per tindakan, dan berlaku di semua cabang.
                    </p>
                </div>
                <button
                    onClick={() => handleOpenModal('add')}
                    className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm cursor-pointer"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    Tambah Worker
                </button>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : workers.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">
                        Belum ada worker. Klik <span className="font-bold">Tambah Worker</span> untuk mulai mendaftarkan.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold">Nama Worker</th>
                                    <th className="p-4 font-semibold">Telepon</th>
                                    <th className="p-4 font-semibold">Catatan</th>
                                    <th className="p-4 font-semibold w-28 text-center">Status</th>
                                    <th className="p-4 font-semibold w-32 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {workers.map(worker => (
                                    <tr key={worker.id} className="hover:bg-ayumi-table-hover transition-colors group">
                                        <td className="p-4 font-bold text-gray-800">{worker.full_name}</td>
                                        <td className="p-4 text-gray-600">{worker.phone || '-'}</td>
                                        <td className="p-4 text-gray-500 max-w-xs truncate">{worker.notes || '-'}</td>
                                        <td className="p-4 text-center">
                                            <button
                                                onClick={() => handleToggleActive(worker)}
                                                title={worker.is_active ? 'Nonaktifkan worker' : 'Aktifkan kembali'}
                                                className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer transition-colors ${worker.is_active
                                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                            >
                                                {worker.is_active ? 'AKTIF' : 'NONAKTIF'}
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleOpenModal('edit', worker)}
                                                    className="text-blue-600 hover:text-blue-800 p-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
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

            <div className="text-xs text-gray-500 bg-amber-50/60 border border-amber-100 rounded-xl p-4 leading-relaxed">
                <span className="font-bold text-amber-800">Catatan:</span> worker yang tidak dipakai lagi cukup <span className="font-semibold">dinonaktifkan</span>, jangan dihapus.
                Dengan begitu laporan upah bulan-bulan sebelumnya tetap menampilkan namanya, dan namanya tidak lagi muncul sebagai pilihan di kasir.
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">
                            {modalMode === 'add' ? 'Tambah Worker' : 'Edit Worker'}
                        </h3>
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Worker</label>
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder="Contoh: Siti"
                                    required
                                    className="input-ayumi w-full text-sm font-bold"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Telepon <span className="font-normal text-gray-400">(opsional)</span></label>
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="Contoh: 0812xxxxxxx"
                                    className="input-ayumi w-full text-sm font-bold"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Catatan <span className="font-normal text-gray-400">(opsional)</span></label>
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Contoh: khusus infus"
                                    className="input-ayumi w-full text-sm font-bold"
                                />
                            </div>

                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={isActive}
                                    onChange={(e) => setIsActive(e.target.checked)}
                                    className="w-4 h-4 accent-ayumi-primary cursor-pointer"
                                />
                                <span className="text-sm font-semibold text-gray-700">Aktif (muncul sebagai pilihan di kasir)</span>
                            </label>

                            <div className="flex gap-3 justify-end pt-3 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="btn-primary px-5 py-2 text-sm font-semibold cursor-pointer"
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
