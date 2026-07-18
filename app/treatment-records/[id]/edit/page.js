'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'

function EditRecordForm() {
    const router = useRouter()
    const params = useParams()
    const id = params.id

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Authorization & Loading State
    const [isCheckingAccess, setIsCheckingAccess] = useState(true)

    // Data Master
    const [patients, setPatients] = useState([])
    const [providers, setProviders] = useState([])
    const [treatmentsMaster, setTreatmentsMaster] = useState([])
    const [branches, setBranches] = useState([])
    const [isOwner, setIsOwner] = useState(false)

    // Form State
    const [formData, setFormData] = useState({
        patient_id: '',
        branch_id: '',
        performed_by: '',
        treatment_date: '',
        treatment_time: '',
        complaints: '',
        skin_condition: '',
        result_notes: '',
        recommendation: ''
    })

    const [selectedTreatments, setSelectedTreatments] = useState([])
    const [treatmentSearch, setTreatmentSearch] = useState('')
    const [isTreatmentDropdownOpen, setIsTreatmentDropdownOpen] = useState(false)

    // Photo files and previews for 3 slots
    const [photoFiles, setPhotoFiles] = useState({
        foto_depan: null,
        foto_kiri: null,
        foto_kanan: null
    })

    const [photoPreviews, setPhotoPreviews] = useState({
        foto_depan: null,
        foto_kiri: null,
        foto_kanan: null
    })

    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        const checkAccessAndFetchData = async () => {
            setIsCheckingAccess(true)
            
            // 1. Get current logged in user
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }

            // 2. Verify user role (only admin/owner can edit)
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData?.role !== 'owner' && userData?.role !== 'admin') {
                toast.error('Akses ditolak. Hanya Owner atau Admin yang dapat mengubah rekam medis.')
                router.push('/treatment-records')
                return
            }
            setIsOwner(userData?.role === 'owner')

            // 3. Fetch Master Data
            const { data: pts } = await supabase.from('patients').select('id, full_name, whatsapp')
            if (pts) setPatients(pts)

            const { data: usrs } = await supabase.from('users').select('id, full_name, role')
            if (usrs) setProviders(usrs)

            const { data: trts } = await supabase.from('treatments').select('*').eq('is_active', true)
            if (trts) setTreatmentsMaster(trts)

            const { data: brs } = await supabase.from('branches').select('id, name')
            if (brs) setBranches(brs)

            // 4. Fetch Existing Record Details
            const { data: recData, error: recErr } = await supabase
                .from('treatment_records')
                .select('*')
                .eq('id', id)
                .single()

            if (recErr || !recData) {
                toast.error('Data rekam medis tidak ditemukan.')
                router.push('/treatment-records')
                return
            }

            // Guard check for admin: must match their branch
            if (userData?.role === 'admin' && recData.branch_id !== userData.branch_id) {
                toast.error('Anda tidak memiliki izin untuk mengedit rekam medis di cabang lain.')
                router.push('/treatment-records')
                return
            }

            setFormData({
                patient_id: recData.patient_id,
                branch_id: recData.branch_id || '',
                performed_by: recData.performed_by || '',
                treatment_date: recData.treatment_date,
                treatment_time: recData.treatment_time ? recData.treatment_time.substring(0, 5) : '',
                complaints: recData.complaints || '',
                skin_condition: recData.skin_condition || '',
                result_notes: recData.result_notes || '',
                recommendation: recData.recommendation || ''
            })

            // Fetch Items
            const { data: itemsData } = await supabase
                .from('treatment_record_items')
                .select(`
                    *,
                    treatments (name, followup_days)
                `)
                .eq('treatment_record_id', id)
                .order('sort_order', { ascending: true })

            if (itemsData) {
                setSelectedTreatments(itemsData.map(item => ({
                    treatment_id: item.treatment_id,
                    name: item.treatments?.name || 'Unknown',
                    price_at_time: item.price_at_time,
                    original_price: item.original_price,
                    discount_percent: item.discount_percent,
                    notes: item.notes || '',
                    followup_days: item.treatments?.followup_days || 0,
                    commission_percent: item.commission_percent || 0
                })))
            }

            // Fetch Photos
            const { data: photosData } = await supabase
                .from('patient_photos')
                .select('*')
                .eq('treatment_record_id', id)

            if (photosData && photosData.length > 0) {
                const previews = {}
                for (const photo of photosData) {
                    const { data: signedData, error: signedErr } = await supabase.storage
                        .from('patient-photos')
                        .createSignedUrl(photo.storage_path, 60 * 60)

                    if (signedData && !signedErr) {
                        const key = photo.caption || photo.storage_path.split('/').pop().split('.')[0]
                        if (key === 'foto_depan') previews.foto_depan = signedData.signedUrl
                        if (key === 'foto_kiri') previews.foto_kiri = signedData.signedUrl
                        if (key === 'foto_kanan') previews.foto_kanan = signedData.signedUrl
                    }
                }
                setPhotoPreviews(prev => ({ ...prev, ...previews }))
            }

            setIsCheckingAccess(false)
        }
        checkAccessAndFetchData()
    }, [id, supabase, router])

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const handleFileChange = (slot, file) => {
        if (!file) return

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
        if (!allowedTypes.includes(file.type)) {
            toast.error('Format foto wajib JPG, PNG, atau WEBP.')
            return
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('Ukuran foto maksimal 5MB.')
            return
        }

        setPhotoFiles(prev => ({ ...prev, [slot]: file }))
        setPhotoPreviews(prev => ({ ...prev, [slot]: URL.createObjectURL(file) }))
    }

    const handleAddTreatment = (treatmentId) => {
        if (!treatmentId) return
        const t = treatmentsMaster.find(x => x.id === treatmentId)
        if (!t) return
        
        if (selectedTreatments.some(x => x.treatment_id === t.id)) return

        const discountVal = t.discount_percent || 0
        const originalPrice = t.price || 0
        const priceAtTime = discountVal > 0 ? originalPrice * (1 - discountVal / 100) : originalPrice

        setSelectedTreatments(prev => [
            ...prev,
            {
                treatment_id: t.id,
                name: t.name,
                price_at_time: Math.round(priceAtTime),
                original_price: originalPrice,
                discount_percent: discountVal,
                notes: '',
                followup_days: t.followup_days || 0,
                commission_percent: t.commission_percent || 0
            }
        ])
    }

    const handleRemoveTreatment = (treatment_id) => {
        setSelectedTreatments(prev => prev.filter(x => x.treatment_id !== treatment_id))
    }

    const handleTreatmentDiscountChange = (treatment_id, percent) => {
        const pct = Math.min(100, Math.max(0, Number(percent) || 0))
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === treatment_id) {
                const newPrice = x.original_price * (1 - pct / 100);
                return { ...x, discount_percent: pct, price_at_time: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleTreatmentDiscountNominalChange = (treatment_id, nominalStr) => {
        const nominal = Math.max(0, Number(nominalStr) || 0)
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === treatment_id) {
                const checkedNominal = Math.min(x.original_price, nominal)
                const pct = x.original_price > 0 ? Math.round((checkedNominal / x.original_price) * 100) : 0
                const newPrice = x.original_price - checkedNominal
                return { ...x, discount_percent: Math.min(100, pct), price_at_time: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleTreatmentPriceChange = (treatment_id, newPrice) => {
        const price = Number(newPrice) || 0
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === treatment_id) {
                const pct = x.original_price > 0 ? Math.round(((x.original_price - price) / x.original_price) * 100) : 0
                return { ...x, price_at_time: price, discount_percent: Math.min(100, Math.max(0, pct)) }
            }
            return x
        }))
    }

    const uploadPhotoSlot = async (file, slotKey, patientId, recordId) => {
        const ext = file.name.split('.').pop() || 'jpg'
        const filePath = `${patientId}/${recordId}/${slotKey}.${ext}`

        const { error: uploadErr } = await supabase.storage
            .from('patient-photos')
            .upload(filePath, file, { upsert: true })

        if (uploadErr) {
            throw new Error(`Gagal mengunggah foto slot ${slotKey}: ${uploadErr.message}`)
        }

        return {
            patient_id: patientId,
            treatment_record_id: recordId,
            photo_type: 'treatment',
            storage_path: filePath,
            caption: slotKey
        }
    }

    const handleSave = async (e) => {
        e.preventDefault()
        setError('')

        if (!formData.patient_id) {
            setError('Pilih pasien terlebih dahulu.')
            return
        }
        if (selectedTreatments.length === 0) {
            setError('Pilih minimal 1 treatment yang dilakukan.')
            return
        }

        setIsSaving(true)

        try {
            // 1. Update Treatment Record
            const { error: recordErr } = await supabase
                .from('treatment_records')
                .update({
                    patient_id: formData.patient_id,
                    branch_id: formData.branch_id,
                    performed_by: formData.performed_by || null,
                    treatment_date: formData.treatment_date,
                    treatment_time: formData.treatment_time,
                    skin_condition: formData.skin_condition,
                    complaints: formData.complaints,
                    result_notes: formData.result_notes,
                    recommendation: formData.recommendation
                })
                .eq('id', id)

            if (recordErr) throw recordErr

            // 2. Delete old Items & insert new ones
            await supabase.from('treatment_record_items').delete().eq('treatment_record_id', id)

            const itemsToInsert = selectedTreatments.map((t, index) => ({
                treatment_record_id: id,
                treatment_id: t.treatment_id,
                price_at_time: t.price_at_time,
                original_price: t.original_price,
                discount_percent: t.discount_percent,
                notes: t.notes,
                sort_order: index + 1,
                commission_percent: t.commission_percent || 0
            }))

            const { error: itemsErr } = await supabase.from('treatment_record_items').insert(itemsToInsert)
            if (itemsErr) throw itemsErr

            // 3. Delete old followup queue & insert new ones
            await supabase.from('followup_queue').delete().eq('treatment_record_id', id)

            const queuesToInsert = []
            selectedTreatments.forEach(t => {
                // Auto-schedule follow-up bertahap: 3 minggu & 1 bulan
                const followupSteps = [
                    { days: 21, type: 'followup_3minggu', priority: 'normal' },
                    { days: 30, type: 'followup_1bulan', priority: 'normal' }
                ]
                followupSteps.forEach(step => {
                    const scheduledDate = new Date(formData.treatment_date)
                    scheduledDate.setDate(scheduledDate.getDate() + step.days)
                    
                    queuesToInsert.push({
                        patient_id: formData.patient_id,
                        treatment_record_id: id,
                        branch_id: formData.branch_id,
                        assigned_to: formData.performed_by || null,
                        followup_type: step.type,
                        scheduled_date: scheduledDate.toISOString().split('T')[0],
                        priority: step.priority,
                        status: 'pending'
                    })
                })
            })

            if (queuesToInsert.length > 0) {
                const { error: queueErr } = await supabase.from('followup_queue').insert(queuesToInsert)
                if (queueErr) throw queueErr
            }

            // 4. Upload Photos if updated
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']
            const photosToInsert = []
            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    // Delete old photo entry from DB first to prevent duplicates
                    await supabase.from('patient_photos').delete().eq('treatment_record_id', id).eq('caption', slot)
                    const meta = await uploadPhotoSlot(photoFiles[slot], slot, formData.patient_id, id)
                    photosToInsert.push(meta)
                }
            }

            if (photosToInsert.length > 0) {
                const { error: photoErr } = await supabase.from('patient_photos').insert(photosToInsert)
                if (photoErr) throw photoErr
            }

            toast.success('Rekam medis berhasil diperbarui!')
            router.push(`/treatment-records/${id}`)
            router.refresh()

        } catch (err) {
            console.error(err)
            const friendlyMsg = getFriendlyErrorMessage(err)
            setError(friendlyMsg)
            toast.error(friendlyMsg)
        } finally {
            setIsSaving(false)
        }
    }

    if (isCheckingAccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memuat Data & Memeriksa Akses...</p>
            </div>
        )
    }

    return (
        <form onSubmit={handleSave} className="space-y-6">
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl font-medium border border-red-100 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Kiri: Info Umum */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="card-ayumi p-4 md:p-6 space-y-4">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b pb-2">Data Kunjungan</h3>
                        
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Pilih Pasien *</label>
                            <select
                                name="patient_id"
                                value={formData.patient_id}
                                onChange={handleChange}
                                required
                                disabled
                                className="input-ayumi bg-gray-100 disabled:opacity-75"
                            >
                                <option value="">-- Pilih Pasien --</option>
                                {patients.map(p => (
                                    <option key={p.id} value={p.id}>{p.full_name} ({p.whatsapp})</option>
                                ))}
                            </select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Tanggal *</label>
                                <input
                                    type="date"
                                    name="treatment_date"
                                    value={formData.treatment_date}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Waktu *</label>
                                <input
                                    type="time"
                                    name="treatment_time"
                                    value={formData.treatment_time}
                                    onChange={handleChange}
                                    required
                                    className="input-ayumi bg-white"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Cabang *</label>
                            <select
                                name="branch_id"
                                value={formData.branch_id}
                                onChange={handleChange}
                                required
                                disabled={!isOwner}
                                className="input-ayumi bg-white disabled:opacity-75"
                            >
                                <option value="" disabled>-- Pilih Cabang --</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Dokter / Terapis</label>
                            <select
                                name="performed_by"
                                value={formData.performed_by}
                                onChange={handleChange}
                                className="input-ayumi bg-white"
                            >
                                <option value="">-- Pilih Provider --</option>
                                {providers.map(p => (
                                    <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Kanan: Medis & Item */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="card-ayumi p-4 md:p-6 space-y-4">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b pb-2">Catatan SOAP</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Subjektif (Keluhan Pasien)</label>
                                <textarea
                                    name="complaints"
                                    value={formData.complaints}
                                    onChange={handleChange}
                                    rows="3"
                                    className="input-ayumi bg-white resize-none"
                                    placeholder="Keluhan utama pasien..."
                                ></textarea>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Objektif (Kondisi Kulit)</label>
                                <textarea
                                    name="skin_condition"
                                    value={formData.skin_condition}
                                    onChange={handleChange}
                                    rows="3"
                                    className="input-ayumi bg-white resize-none"
                                    placeholder="Kondisi kulit fisik..."
                                ></textarea>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Asesmen (Tindakan & Hasil) *</label>
                            <textarea
                                name="result_notes"
                                value={formData.result_notes}
                                onChange={handleChange}
                                rows="4"
                                required
                                className="input-ayumi bg-white resize-none"
                                placeholder="Detail tindakan..."
                            ></textarea>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Planning (Rekomendasi)</label>
                            <textarea
                                name="recommendation"
                                value={formData.recommendation}
                                onChange={handleChange}
                                rows="3"
                                className="input-ayumi bg-white resize-none"
                                placeholder="Rekomendasi skincare homecare..."
                            ></textarea>
                        </div>
                    </div>

                    <div className="card-ayumi p-4 md:p-6 space-y-4">
                        <div className="flex justify-between items-center border-b pb-2 relative">
                            <h3 className="text-lg font-bold text-ayumi-primary">Tindakan Treatment</h3>
                            <div className="flex items-center gap-2 relative">
                                <button
                                    type="button"
                                    onClick={() => setIsTreatmentDropdownOpen(!isTreatmentDropdownOpen)}
                                    className="border-2 border-[#fce7f3] text-ayumi-primary font-semibold rounded-xl px-4 py-2 text-sm outline-none bg-pink-50 hover:bg-pink-100/50 transition-all flex items-center gap-2 cursor-pointer z-10 relative"
                                >
                                    <span>+ Tambah Treatment / Produk</span>
                                    <svg className={`w-4 h-4 transition-transform ${isTreatmentDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                
                                {isTreatmentDropdownOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setIsTreatmentDropdownOpen(false)} />
                                        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white border border-pink-100 rounded-2xl shadow-xl z-50 p-3.5 space-y-3">
                                            <input
                                                type="text"
                                                placeholder="Cari..."
                                                value={treatmentSearch}
                                                onChange={(e) => setTreatmentSearch(e.target.value)}
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-ayumi-primary bg-gray-50 text-gray-700"
                                                autoFocus
                                            />
                                            <div className="max-h-60 overflow-y-auto divide-y divide-gray-50 pr-1">
                                                {treatmentsMaster
                                                    .filter(t => t.name.toLowerCase().includes(treatmentSearch.toLowerCase()))
                                                    .map(t => {
                                                        const isSelected = selectedTreatments.some(x => x.treatment_id === t.id);
                                                        return (
                                                            <button
                                                                key={t.id}
                                                                type="button"
                                                                disabled={isSelected}
                                                                onClick={() => {
                                                                    handleAddTreatment(t.id);
                                                                    setIsTreatmentDropdownOpen(false);
                                                                    setTreatmentSearch('');
                                                                }}
                                                                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-center justify-between text-xs md:text-sm ${isSelected ? 'opacity-40 cursor-not-allowed bg-gray-50' : 'hover:bg-pink-50/50'}`}
                                                            >
                                                                <span className="font-bold text-ayumi-secondary truncate">{t.name}</span>
                                                                <span className="font-bold text-gray-700">Rp {t.price?.toLocaleString('id-ID')}</span>
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {selectedTreatments.length === 0 ? (
                            <div className="text-center py-6 text-gray-400 text-sm">
                                Belum ada treatment / produk yang dipilih.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {selectedTreatments.map(item => {
                                    const hasDiscount = item.discount_percent > 0;
                                    return (
                                        <div key={item.treatment_id} className="flex flex-col md:flex-row gap-3 items-center bg-gray-50 p-3.5 rounded-xl border border-gray-100">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-ayumi-secondary truncate">{item.name}</div>
                                                {hasDiscount && (
                                                    <div className="flex items-center gap-1.5 mt-1 text-xs">
                                                        <span className="line-through text-gray-400">Rp {item.original_price?.toLocaleString('id-ID')}</span>
                                                        <span className="bg-pink-50 text-ayumi-primary font-bold px-1.5 py-0.5 rounded text-[10px]">
                                                            -{item.discount_percent}%
                                                        </span>
                                                    </div>
                                                )}
                                                {item.notes && <p className="text-xs text-gray-500 mt-0.5">{item.notes}</p>}
                                            </div>
                                            
                                            <div className="w-full md:w-auto flex flex-col xl:flex-row items-center gap-3">
                                                <div className="flex items-center gap-2 w-full sm:w-28">
                                                    <label className="text-xs font-bold text-gray-500 whitespace-nowrap">Diskon %:</label>
                                                    <div className="relative flex-1">
                                                        <input 
                                                            type="number" 
                                                            min="0"
                                                            max="100"
                                                            value={item.discount_percent === 0 ? '' : item.discount_percent}
                                                            placeholder="0"
                                                            onChange={(e) => handleTreatmentDiscountChange(item.treatment_id, e.target.value)}
                                                            className="w-full pr-6 pl-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-ayumi-primary bg-white font-mono font-bold"
                                                        />
                                                        <span className="absolute right-2.5 top-1.5 text-gray-400 text-xs font-semibold">%</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 w-full sm:w-36">
                                                    <label className="text-xs font-bold text-gray-500 whitespace-nowrap">Diskon Rp:</label>
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-2 top-1.5 text-gray-400 text-xs font-semibold">Rp</span>
                                                        <input 
                                                            type="number" 
                                                            value={item.original_price - item.price_at_time === 0 ? '' : item.original_price - item.price_at_time}
                                                            placeholder="0"
                                                            onChange={(e) => handleTreatmentDiscountNominalChange(item.treatment_id, e.target.value)}
                                                            className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-ayumi-primary bg-white font-mono font-bold"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 w-full sm:w-44">
                                                    <label className="text-xs font-bold text-gray-500 whitespace-nowrap">Harga:</label>
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs font-semibold">Rp</span>
                                                        <input 
                                                            type="number" 
                                                            value={item.price_at_time}
                                                            onChange={(e) => handleTreatmentPriceChange(item.treatment_id, e.target.value)}
                                                            className="w-full pl-7 pr-2.5 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-ayumi-primary bg-white font-mono font-bold text-right"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <button 
                                                type="button" 
                                                onClick={() => handleRemoveTreatment(item.treatment_id)}
                                                className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    );
                                })}
                                <div className="text-right pt-3 font-bold text-lg text-ayumi-secondary">
                                    Total: Rp {selectedTreatments.reduce((acc, curr) => acc + Number(curr.price_at_time), 0).toLocaleString('id-ID')}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Foto Dokumentasi Section */}
                    <div className="card-ayumi p-4 md:p-6 space-y-6">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b pb-2">Foto Dokumentasi</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { key: 'foto_depan', label: 'Foto Depan' },
                                { key: 'foto_kiri', label: 'Foto Samping Kiri' },
                                { key: 'foto_kanan', label: 'Foto Samping Kanan' }
                            ].map(slot => (
                                <div key={slot.key} className="border-2 border-dashed border-gray-200 rounded-2xl p-4 text-center bg-gray-50 hover:bg-white transition-colors relative flex flex-col justify-center items-center min-h-[160px]">
                                    {photoPreviews[slot.key] ? (
                                        <div className="w-full relative group">
                                            <img src={photoPreviews[slot.key]} alt={slot.label} className="w-full h-32 object-cover rounded-xl shadow-sm" />
                                            <button 
                                                type="button" 
                                                onClick={() => {
                                                    setPhotoFiles(prev => ({ ...prev, [slot.key]: null }))
                                                    setPhotoPreviews(prev => ({ ...prev, [slot.key]: null }))
                                                }}
                                                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-md"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center space-y-2">
                                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            <span className="text-xs font-bold text-gray-500 block">{slot.label}</span>
                                            <input 
                                                type="file" 
                                                accept="image/jpeg,image/png,image/webp" 
                                                onChange={(e) => handleFileChange(slot.key, e.target.files[0])}
                                                className="absolute inset-0 opacity-0 cursor-pointer"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Link href={`/treatment-records/${id}`}>
                            <button
                                type="button"
                                className="px-8 py-4 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors text-sm shadow-sm"
                            >
                                Batal
                            </button>
                        </Link>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="btn-primary px-10 py-4 font-bold text-sm shadow-md"
                        >
                            {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    )
}

export default function Page() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/treatment-records">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm border border-gray-100">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <h2 className="text-xl font-bold text-ayumi-secondary">Edit Rekam Medis</h2>
                    <p className="text-sm text-ayumi-text-muted">Ubah tindakan treatment, SOAP notes, atau foto dokumentasi.</p>
                </div>
            </div>
            
            <Suspense fallback={<div className="p-10 text-center text-pink-500 font-bold">Memuat Form...</div>}>
                <EditRecordForm />
            </Suspense>
        </div>
    )
}
