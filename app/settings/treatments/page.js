'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function TreatmentsPage() {
    const router = useRouter()
    const [treatments, setTreatments] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    
    // Search filter
    const [searchQuery, setSearchQuery] = useState('')

    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState('add') // 'add' | 'edit'
    const [selectedTreatment, setSelectedTreatment] = useState(null)
    const [isSaving, setIsSaving] = useState(false)

    // Inline edit states
    const [editingField, setEditingField] = useState({ id: null, field: null })
    const [inlineValue, setInlineValue] = useState('')

    // Form states
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        duration: '60',
        followup_days: '30',
        is_active: true,
        discount_percent: 0,
        commission_percent: 0
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
        
        // Fetch Treatments
        let query = supabase.from('treatments').select('*').order('name', { ascending: true })
        
        const { data: trData } = await query
        if (trData) setTreatments(trData)
        
        setIsLoading(false)
    }

    useEffect(() => {
        checkAccess()
    }, [supabase])

    const handleOpenModal = (mode, treatment = null) => {
        setModalMode(mode)
        setSelectedTreatment(treatment)
        if (treatment) {
            setFormData({
                name: treatment.name || '',
                price: treatment.price || '',
                duration: treatment.duration_minutes || '',
                followup_days: treatment.followup_days || '',
                is_active: treatment.is_active !== undefined ? treatment.is_active : true,
                discount_percent: treatment.discount_percent || 0,
                commission_percent: treatment.commission_percent || 0
            })
        } else {
            setFormData({
                name: '',
                price: '',
                duration: '60',
                followup_days: '30',
                is_active: true,
                discount_percent: 0,
                commission_percent: 0
            })
        }
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setSelectedTreatment(null)
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
            price: Number(formData.price),
            duration_minutes: Number(formData.duration),
            followup_days: Number(formData.followup_days),
            is_active: formData.is_active,
            discount_percent: Number(formData.discount_percent || 0),
            commission_percent: Number(formData.commission_percent || 0)
        }

        if (modalMode === 'add') {
            const { error } = await supabase.from('treatments').insert([payload])
            if (!error) fetchData()
            else alert('Gagal menyimpan data: ' + error.message)
        } else if (modalMode === 'edit' && selectedTreatment) {
            const { error } = await supabase.from('treatments').update(payload).eq('id', selectedTreatment.id)
            if (!error) fetchData()
            else alert('Gagal mengupdate data: ' + error.message)
        }

        setIsSaving(false)
        handleCloseModal()
    }

    const handleToggleActive = async (treatment) => {
        const { error } = await supabase
            .from('treatments')
            .update({ is_active: !treatment.is_active })
            .eq('id', treatment.id)
            
        if (!error) fetchData()
    }

    const handleInlineEditStart = (treatment, field) => {
        setEditingField({ id: treatment.id, field })
        const currentVal = treatment[field] || 0
        setInlineValue(currentVal > 0 ? currentVal.toString() : '')
    }

    const handleInlineEditCancel = () => {
        setEditingField({ id: null, field: null })
        setInlineValue('')
    }

    const handleInlineEditSave = async (treatment) => {
        const { field } = editingField
        const newValue = Number(inlineValue)
        if (newValue === (treatment[field] || 0)) {
            handleInlineEditCancel()
            return
        }

        const { error } = await supabase
            .from('treatments')
            .update({ [field]: newValue })
            .eq('id', treatment.id)
            
        if (!error) {
            fetchData()
        } else {
            alert(`Gagal mengupdate data: ` + error.message)
        }
        handleInlineEditCancel()
    }

    // Combine data for display
    const displayedTreatments = treatments
        .filter(t => {
            if (!searchQuery) return true
            return t.name.toLowerCase().includes(searchQuery.toLowerCase())
        })

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm text-ayumi-text-muted">Kelola daftar layanan dan prosedur klinik.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </span>
                        <input
                            type="text"
                            placeholder="Cari treatment/produk..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-10 bg-white w-full"
                        />
                    </div>
                    <button
                        onClick={() => handleOpenModal('add')}
                        className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm justify-center whitespace-nowrap"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                        Tambah Treatment
                    </button>
                </div>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : displayedTreatments.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Tidak ada data treatment/produk ditemukan.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold">Nama Treatment / Produk</th>
                                    <th className="p-4 font-semibold text-right">Harga (Rp)</th>
                                    <th className="p-4 font-semibold text-center">Komisi</th>
                                    <th className="p-4 font-semibold text-center">Durasi</th>
                                    <th className="p-4 font-semibold text-center">Follow-up</th>
                                    <th className="p-4 font-semibold text-center">Status</th>
                                    <th className="p-4 font-semibold text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {displayedTreatments.map((t) => {
                                    const hasDiscount = t.discount_percent > 0
                                    const discountedPrice = hasDiscount ? t.price * (1 - t.discount_percent / 100) : t.price
                                    return (
                                        <tr key={t.id} className={`hover:bg-ayumi-table-hover transition-colors ${!t.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
                                            <td className="p-4 font-medium text-gray-800">{t.name}</td>
                                            <td className="p-4 text-right">
                                                {editingField.id === t.id && editingField.field === 'price' ? (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <span className="text-xs text-gray-500">Rp</span>
                                                        <input 
                                                            type="number"
                                                            value={inlineValue}
                                                            onChange={(e) => setInlineValue(e.target.value)}
                                                            className="w-24 px-2 py-1 text-xs border border-ayumi-primary rounded text-right font-mono focus:outline-none focus:ring-1 focus:ring-ayumi-primary bg-white"
                                                            min="0"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleInlineEditSave(t)
                                                                if (e.key === 'Escape') handleInlineEditCancel()
                                                            }}
                                                            onBlur={() => handleInlineEditSave(t)}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div 
                                                        className="cursor-pointer group relative inline-flex items-center justify-end w-full"
                                                        onClick={() => handleInlineEditStart(t, 'price')}
                                                        title="Klik untuk ubah harga"
                                                    >
                                                        {hasDiscount ? (
                                                            <div className="flex flex-col items-end">
                                                                <span className="line-through text-xs text-gray-400 group-hover:text-ayumi-primary transition-colors">Rp {t.price?.toLocaleString('id-ID')}</span>
                                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                                    <span className="bg-pink-50 text-ayumi-primary text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                                        -{t.discount_percent}%
                                                                    </span>
                                                                    <span className="font-bold text-gray-800">Rp {discountedPrice?.toLocaleString('id-ID')}</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="font-bold text-gray-700 font-mono group-hover:text-ayumi-primary transition-colors border-b border-transparent group-hover:border-ayumi-primary">Rp {t.price?.toLocaleString('id-ID')}</span>
                                                        )}
                                                        <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 absolute -left-4 top-1/2 -translate-y-1/2 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                {editingField.id === t.id && editingField.field === 'commission_percent' ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <input 
                                                            type="number"
                                                            value={inlineValue}
                                                            onChange={(e) => setInlineValue(e.target.value)}
                                                            className="w-16 px-2 py-1 text-xs border border-ayumi-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-ayumi-primary bg-white"
                                                            min="0"
                                                            max="100"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleInlineEditSave(t)
                                                                if (e.key === 'Escape') handleInlineEditCancel()
                                                            }}
                                                            onBlur={() => handleInlineEditSave(t)}
                                                        />
                                                        <span className="text-xs text-gray-500">%</span>
                                                    </div>
                                                ) : (
                                                    <div 
                                                        className="cursor-pointer group relative inline-flex items-center justify-center"
                                                        onClick={() => handleInlineEditStart(t, 'commission_percent')}
                                                        title="Klik untuk ubah komisi"
                                                    >
                                                        {t.commission_percent > 0 ? (
                                                            <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-0.5 rounded-md border border-transparent group-hover:border-emerald-200 transition-colors">
                                                                {t.commission_percent}%
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs px-2.5 py-0.5 rounded-md border border-transparent group-hover:border-gray-200 transition-colors">
                                                                0%
                                                            </span>
                                                        )}
                                                        <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 absolute -right-4 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                {editingField.id === t.id && editingField.field === 'duration_minutes' ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <input 
                                                            type="number"
                                                            value={inlineValue}
                                                            onChange={(e) => setInlineValue(e.target.value)}
                                                            className="w-16 px-2 py-1 text-xs border border-ayumi-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-ayumi-primary bg-white"
                                                            min="1"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleInlineEditSave(t)
                                                                if (e.key === 'Escape') handleInlineEditCancel()
                                                            }}
                                                            onBlur={() => handleInlineEditSave(t)}
                                                        />
                                                        <span className="text-xs text-gray-500">mnt</span>
                                                    </div>
                                                ) : (
                                                    <div 
                                                        className="cursor-pointer group relative inline-flex items-center justify-center text-gray-600"
                                                        onClick={() => handleInlineEditStart(t, 'duration_minutes')}
                                                        title="Klik untuk ubah durasi"
                                                    >
                                                        <span className="border-b border-transparent group-hover:border-ayumi-primary group-hover:text-ayumi-primary transition-colors">{t.duration_minutes || 0} mnt</span>
                                                        <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 absolute -right-4 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                {editingField.id === t.id && editingField.field === 'followup_days' ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <input 
                                                            type="number"
                                                            value={inlineValue}
                                                            onChange={(e) => setInlineValue(e.target.value)}
                                                            className="w-16 px-2 py-1 text-xs border border-ayumi-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-ayumi-primary bg-white"
                                                            min="0"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleInlineEditSave(t)
                                                                if (e.key === 'Escape') handleInlineEditCancel()
                                                            }}
                                                            onBlur={() => handleInlineEditSave(t)}
                                                        />
                                                        <span className="text-xs text-gray-500">hr</span>
                                                    </div>
                                                ) : (
                                                    <div 
                                                        className="cursor-pointer group relative inline-flex items-center justify-center text-gray-600"
                                                        onClick={() => handleInlineEditStart(t, 'followup_days')}
                                                        title="Klik untuk ubah followup"
                                                    >
                                                        <span className="border-b border-transparent group-hover:border-ayumi-primary group-hover:text-ayumi-primary transition-colors">{t.followup_days || 0} hr</span>
                                                        <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 absolute -right-4 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                <button 
                                                    onClick={() => handleToggleActive(t)}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${t.is_active ? 'bg-ayumi-primary' : 'bg-gray-300'}`}
                                                >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${t.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </button>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button 
                                                        onClick={() => handleOpenModal('edit', t)}
                                                        className="text-ayumi-primary hover:text-ayumi-secondary p-1.5 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors"
                                                        title="Edit"
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

            {/* Modal Form */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8 transform transition-all">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-pink-50/30 rounded-t-2xl">
                            <h3 className="text-lg font-bold text-ayumi-secondary">
                                {modalMode === 'add' ? 'Tambah Treatment / Produk' : 'Edit Treatment / Produk'}
                            </h3>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Treatment / Produk</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-white"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Harga Asli (Rp)</label>
                                    <input
                                        type="number"
                                        name="price"
                                        value={formData.price}
                                        onChange={handleChange}
                                        required
                                        min="0"
                                        className="input-ayumi bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Diskon (%)</label>
                                    <input
                                        type="number"
                                        name="discount_percent"
                                        value={formData.discount_percent}
                                        onChange={handleChange}
                                        min="0"
                                        max="100"
                                        className="input-ayumi bg-white"
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            {formData.discount_percent > 0 && (
                                <div className="bg-pink-50/50 border border-pink-100 p-3.5 rounded-xl flex justify-between items-center text-sm">
                                    <span className="font-semibold text-gray-500">Harga Setelah Diskon:</span>
                                    <span className="font-extrabold text-ayumi-primary font-mono text-base">
                                        Rp {(formData.price * (1 - formData.discount_percent / 100))?.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Durasi (Menit)</label>
                                    <input
                                        type="number"
                                        name="duration"
                                        value={formData.duration}
                                        onChange={handleChange}
                                        required
                                        min="1"
                                        className="input-ayumi bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Follow-up (Hari)</label>
                                    <input
                                        type="number"
                                        name="followup_days"
                                        value={formData.followup_days}
                                        onChange={handleChange}
                                        required
                                        min="0"
                                        className="input-ayumi bg-white"
                                        placeholder="Hari untuk follow up"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Komisi Terapis (%)</label>
                                <input
                                    type="number"
                                    name="commission_percent"
                                    value={formData.commission_percent}
                                    onChange={handleChange}
                                    min="0"
                                    max="100"
                                    className="input-ayumi bg-white"
                                    placeholder="0"
                                />
                                {formData.commission_percent > 0 && formData.price > 0 && (
                                    <div className="bg-emerald-50/50 border border-emerald-100 p-3 rounded-xl flex justify-between items-center text-sm mt-2">
                                        <span className="font-semibold text-gray-500">Estimasi Komisi per Treatment:</span>
                                        <span className="font-extrabold text-emerald-600 font-mono text-base">
                                            Rp {Math.round(
                                                (formData.discount_percent > 0
                                                    ? formData.price * (1 - formData.discount_percent / 100)
                                                    : Number(formData.price)
                                                ) * (formData.commission_percent / 100)
                                            ).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <label className="text-sm font-semibold text-gray-700">Status Aktif</label>
                                <button 
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-ayumi-primary' : 'bg-gray-300'}`}
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
