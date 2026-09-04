'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import CameraCaptureModal from '@/components/ui/CameraCaptureModal'
import { compressImageForMedical } from '@/lib/imageCompression'

function EditRecordForm() {
    const router = useRouter()
    const params = useParams()
    const id = params.id

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
        skin_type: '',
        contraindications: '',
        medical_history: '',
        client_skincare_routine: '',
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

    // Camera Modal State
    const [isCameraOpen, setIsCameraOpen] = useState(false)
    const [activeCameraSlot, setActiveCameraSlot] = useState(null)
    const fileInputRefs = {
        foto_depan: useRef(null),
        foto_kiri: useRef(null),
        foto_kanan: useRef(null)
    }

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
            const { data: pts } = await supabase.from('patients').select('id, full_name, whatsapp, skin_type, allergies, medical_notes, notes').order('full_name', { ascending: true })
            if (pts) setPatients(pts)

            const { data: usrs } = await supabase.from('users').select('id, full_name, role, branch_id').eq('role', 'therapist').eq('is_active', true).order('full_name')
            if (usrs) setProviders(usrs)

            const { data: trts } = await supabase.from('treatments').select('*').eq('is_active', true)
            if (trts) setTreatmentsMaster(trts)

            const { data: brs } = await supabase.from('branches').select('id, name')
            if (brs) setBranches(brs)

            // 4. Fetch Existing Record Details
            const { data: recData, error: recErr } = await supabase
                .from('treatment_records')
                .select('*, patients (id, full_name, whatsapp, skin_type, allergies, medical_notes, notes)')
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
                skin_type: recData.skin_type || recData.patients?.skin_type || '',
                contraindications: recData.contraindications || recData.patients?.allergies || '',
                medical_history: recData.medical_history || recData.patients?.medical_notes || '',
                client_skincare_routine: recData.client_skincare_routine || recData.patients?.notes || '',
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

        const isImage = file.type?.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')
        if (!isImage) {
            toast.error('Format foto wajib gambar (JPG, PNG, WEBP).')
            return
        }

        if (file.size > 10 * 1024 * 1024) {
            toast.error('Ukuran foto maksimal 10MB.')
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
        // Automatic client-side compression (WebP 1600px q80)
        let uploadFile = file
        if (typeof compressImageForMedical === 'function') {
            try {
                uploadFile = await compressImageForMedical(file, 1600, 0.8)
            } catch (e) {
                console.warn('Compression fallback:', e)
            }
        }

        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token

        const fd = new FormData()
        fd.append('file', uploadFile)
        fd.append('patientId', patientId)
        fd.append('recordId', recordId)
        fd.append('slotKey', slotKey)
        fd.append('photoType', 'before')

        const res = await fetch('/api/patient-photos/upload', {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: fd
        })

        const json = await res.json()
        if (!res.ok || !json.success) {
            throw new Error(json.error || `Gagal mengunggah foto slot ${slotKey}`)
        }

        return json.photo
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
            let updatePayload = {
                patient_id: formData.patient_id,
                branch_id: formData.branch_id,
                performed_by: formData.performed_by || null,
                treatment_date: formData.treatment_date,
                treatment_time: formData.treatment_time,
                skin_type: formData.skin_type || null,
                contraindications: formData.contraindications || null,
                medical_history: formData.medical_history || null,
                client_skincare_routine: formData.client_skincare_routine || null,
                skin_condition: formData.skin_condition,
                complaints: formData.complaints,
                result_notes: formData.result_notes,
                recommendation: formData.recommendation
            }

            const { error: recordErr } = await supabase
                .from('treatment_records')
                .update(updatePayload)
                .eq('id', id)

            if (recordErr) {
                delete updatePayload.skin_type
                delete updatePayload.contraindications
                delete updatePayload.medical_history
                delete updatePayload.client_skincare_routine
                const { error: fallbackErr } = await supabase
                    .from('treatment_records')
                    .update(updatePayload)
                    .eq('id', id)
                if (fallbackErr) throw fallbackErr
            }

            // Sync to master patient record
            if (formData.patient_id) {
                await supabase
                    .from('patients')
                    .update({
                        skin_type: formData.skin_type || null,
                        allergies: formData.contraindications || null,
                        medical_notes: formData.medical_history || null,
                        notes: formData.client_skincare_routine || null
                    })
                    .eq('id', formData.patient_id)
            }

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
                // Auto-schedule follow-up bertahap: 2 minggu, 3 minggu & 1 bulan
                const followupSteps = [
                    { days: 14, type: 'followup_2minggu', priority: 'normal' },
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
                if (queueErr) console.warn('Followup queue note:', queueErr.message || queueErr)
            }

            // 4. Upload Photos if updated (via Server API)
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']
            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    await uploadPhotoSlot(photoFiles[slot], slot, formData.patient_id, id)
                }
            }

            toast.success('Rekam medis berhasil diperbarui!')
            router.push(`/treatment-records/${id}`)
            router.refresh()

        } catch (err) {
            console.error('Error saving treatment record:', err)
            const errorMsg = err.message || getFriendlyErrorMessage(err)
            setError(errorMsg)
            toast.error(errorMsg)
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
                    {/* Profil Kulit & Riwayat Klinis */}
                    <div className="card-ayumi p-4 md:p-6 space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-3 gap-2">
                            <div>
                                <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                                    <span className="p-1.5 bg-pink-100 text-pink-600 rounded-xl text-lg">🔬</span>
                                    Profil Kulit & Riwayat Klinis Pasien
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">Informasi jenis kulit, kontraindikasi medis, dan perawatan rutin pasien</p>
                            </div>
                            <span className="self-start sm:self-auto text-[11px] font-bold text-pink-700 bg-pink-50 border border-pink-200 px-3 py-1 rounded-full shadow-2xs">
                                ✨ Sinkron ke Master Pasien
                            </span>
                        </div>

                        {/* Jenis Kulit */}
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                    <span>🧴</span> Jenis Kulit (Skin Type)
                                </label>
                                {formData.skin_type && (
                                    <span className="text-[11px] font-bold text-pink-600 bg-pink-50 px-2 py-0.5 rounded-md">
                                        Terpilih: {formData.skin_type}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: 'Normal', label: '✨ Normal', activeBg: 'bg-emerald-600 border-emerald-600 text-white' },
                                    { id: 'Kering', label: '🌵 Kering (Dry)', activeBg: 'bg-amber-600 border-amber-600 text-white' },
                                    { id: 'Berminyak', label: '💧 Berminyak (Oily)', activeBg: 'bg-blue-600 border-blue-600 text-white' },
                                    { id: 'Kombinasi', label: '⚖️ Kombinasi', activeBg: 'bg-teal-600 border-teal-600 text-white' },
                                    { id: 'Sensitif', label: '🌸 Sensitif', activeBg: 'bg-rose-600 border-rose-600 text-white' },
                                    { id: 'Acne-Prone', label: '🔴 Acne-Prone (Jerawat)', activeBg: 'bg-red-600 border-red-600 text-white' },
                                    { id: 'Aging / Flek', label: '⏳ Aging / Flek', activeBg: 'bg-purple-600 border-purple-600 text-white' }
                                ].map(item => {
                                    const isSelected = formData.skin_type === item.id || (formData.skin_type && formData.skin_type.toLowerCase().split(',').map(s=>s.trim()).includes(item.id.toLowerCase()))
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, skin_type: isSelected ? '' : item.id }))}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-2xs ${
                                                isSelected 
                                                    ? `${item.activeBg} shadow-sm scale-105 ring-2 ring-pink-300` 
                                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                                            }`}
                                        >
                                            {isSelected && <span className="mr-1">✓</span>}
                                            {item.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Kontraindikasi */}
                        <div className="p-4 bg-gradient-to-br from-rose-50/70 via-rose-50/30 to-amber-50/40 border-2 border-rose-200/90 rounded-2xl space-y-2.5 shadow-2xs">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-extrabold uppercase tracking-wider text-rose-900 flex items-center gap-1.5">
                                    <span className="text-base">⚠️</span>
                                    Kontraindikasi / Peringatan Khusus
                                </label>
                                <span className="text-[10px] font-extrabold text-rose-700 uppercase bg-rose-100/80 border border-rose-200 px-2 py-0.5 rounded-md">
                                    Wajib Diperiksa
                                </span>
                            </div>
                            <textarea
                                name="contraindications"
                                value={formData.contraindications}
                                onChange={handleChange}
                                rows="2"
                                placeholder="Contoh: Sedang hamil/menyusui, alergi zat aktif, penggunaan retinol/AHA aktif..."
                                className="input-ayumi bg-white text-xs md:text-sm border-rose-200 focus:border-rose-400 resize-none shadow-2xs"
                            ></textarea>
                            {/* Quick Tag Chips */}
                            <div className="space-y-1.5 pt-1">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Pilih Cepat (Klik untuk Tambah/Hapus):</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {[
                                        'Ibu Hamil / Menyusui',
                                        'Retinoid / Roaccutane / AHA Aktif',
                                        'Alergi Obat/Bahan',
                                        'Riwayat Keloid',
                                        'Kulit Iritasi / Sunburn',
                                        'Tanam Benang / Filler Baru',
                                        'Tidak Ada Kontraindikasi'
                                    ].map(tag => {
                                        const isNone = tag === 'Tidak Ada Kontraindikasi'
                                        const curr = (formData.contraindications || '').trim()
                                        const isSelected = isNone 
                                            ? (curr === 'Tidak Ada' || curr === 'Tidak Ada Kontraindikasi')
                                            : curr.split(',').map(s=>s.trim()).includes(tag)

                                        return (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => {
                                                        const current = (prev.contraindications || '').trim()
                                                        if (isNone) {
                                                            return { ...prev, contraindications: isSelected ? '' : 'Tidak Ada' }
                                                        }
                                                        if (current === 'Tidak Ada' || current === 'Tidak Ada Kontraindikasi') {
                                                            return { ...prev, contraindications: tag }
                                                        }
                                                        let items = current ? current.split(',').map(s => s.trim()).filter(Boolean) : []
                                                        if (items.includes(tag)) {
                                                            items = items.filter(i => i !== tag)
                                                        } else {
                                                            items.push(tag)
                                                        }
                                                        return { ...prev, contraindications: items.join(', ') }
                                                    })
                                                }}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-rose-600 border-rose-600 text-white shadow-2xs'
                                                        : 'bg-white border-rose-200/80 text-rose-800 hover:bg-rose-100/70'
                                                }`}
                                            >
                                                {isSelected ? `✓ ${tag}` : `+ ${tag}`}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Sejarah Medis */}
                            <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-2xl space-y-2.5">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                    <span>📋</span> Sejarah Medis & Riwayat Penyakit
                                </label>
                                <textarea
                                    name="medical_history"
                                    value={formData.medical_history}
                                    onChange={handleChange}
                                    rows="3"
                                    placeholder="Riwayat medis, riwayat alergi lama, pengobatan rutin, atau tindakan di klinik lain..."
                                    className="input-ayumi bg-white focus:bg-white text-xs md:text-sm resize-none shadow-2xs"
                                ></textarea>
                                {/* Quick Tags */}
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    {[
                                        'Penyakit Kulit Kronis',
                                        'Obat Jerawat Rutin',
                                        'Alergi Obat/Makanan',
                                        'Treatment di Klinik Lain',
                                        'Tidak Ada Riwayat Medis'
                                    ].map(tag => {
                                        const isNone = tag === 'Tidak Ada Riwayat Medis'
                                        const curr = (formData.medical_history || '').trim()
                                        const isSelected = isNone 
                                            ? (curr === 'Tidak Ada' || curr === 'Tidak Ada Riwayat Medis')
                                            : curr.split(',').map(s=>s.trim()).includes(tag)

                                        return (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => {
                                                        const current = (prev.medical_history || '').trim()
                                                        if (isNone) {
                                                            return { ...prev, medical_history: isSelected ? '' : 'Tidak Ada' }
                                                        }
                                                        if (current === 'Tidak Ada' || current === 'Tidak Ada Riwayat Medis') {
                                                            return { ...prev, medical_history: tag }
                                                        }
                                                        let items = current ? current.split(',').map(s => s.trim()).filter(Boolean) : []
                                                        if (items.includes(tag)) {
                                                            items = items.filter(i => i !== tag)
                                                        } else {
                                                            items.push(tag)
                                                        }
                                                        return { ...prev, medical_history: items.join(', ') }
                                                    })
                                                }}
                                                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-slate-800 border-slate-800 text-white shadow-2xs'
                                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                                }`}
                                            >
                                                {isSelected ? `✓ ${tag}` : `+ ${tag}`}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Perawatan Klien */}
                            <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-2xl space-y-2.5">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                    <span>🧴</span> Skincare Rutin di Rumah
                                </label>
                                <textarea
                                    name="client_skincare_routine"
                                    value={formData.client_skincare_routine}
                                    onChange={handleChange}
                                    rows="3"
                                    placeholder="Produk harian yang dipakai (Facial Wash, Toner, Sunscreen, Krim Malam, dll)..."
                                    className="input-ayumi bg-white focus:bg-white text-xs md:text-sm resize-none shadow-2xs"
                                ></textarea>
                                {/* Quick Tags */}
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    {[
                                        'Facial Wash',
                                        'Toner',
                                        'Serum',
                                        'Sunscreen',
                                        'Moisturizer',
                                        'Night Cream',
                                        'Racikan Dokter'
                                    ].map(tag => {
                                        const curr = (formData.client_skincare_routine || '').trim()
                                        const isSelected = curr.split(',').map(s=>s.trim()).includes(tag)

                                        return (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => {
                                                        const current = (prev.client_skincare_routine || '').trim()
                                                        let items = current ? current.split(',').map(s => s.trim()).filter(Boolean) : []
                                                        if (items.includes(tag)) {
                                                            items = items.filter(i => i !== tag)
                                                        } else {
                                                            items.push(tag)
                                                        }
                                                        return { ...prev, client_skincare_routine: items.join(', ') }
                                                    })
                                                }}
                                                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-pink-600 border-pink-600 text-white shadow-2xs'
                                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-pink-50 hover:text-pink-700 hover:border-pink-200'
                                                }`}
                                            >
                                                {isSelected ? `✓ ${tag}` : `+ ${tag}`}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

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
                                        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs md:bg-transparent md:backdrop-blur-none cursor-default" onClick={() => setIsTreatmentDropdownOpen(false)} />
                                        <div className="fixed inset-x-3 top-20 max-w-md mx-auto md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-96 bg-white border border-pink-100 rounded-2xl shadow-2xl z-50 p-3.5 space-y-3">
                                            <div className="flex justify-between items-center px-1">
                                                <div className="text-xs font-bold text-pink-900">Pilih Treatment / Produk:</div>
                                                <button type="button" onClick={() => setIsTreatmentDropdownOpen(false)} className="text-gray-400 hover:text-red-500 md:hidden text-xs font-bold">✕ Tutup</button>
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Cari treatment atau produk..."
                                                value={treatmentSearch}
                                                onChange={(e) => setTreatmentSearch(e.target.value)}
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-ayumi-primary bg-gray-50 text-gray-700 font-semibold"
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
                                                                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-center justify-between text-xs md:text-sm cursor-pointer ${isSelected ? 'opacity-40 cursor-not-allowed bg-gray-50' : 'hover:bg-pink-50/50'}`}
                                                            >
                                                                <span className="font-bold text-ayumi-secondary truncate pr-2">{t.name}</span>
                                                                <span className="font-bold text-gray-700 shrink-0">Rp {t.price?.toLocaleString('id-ID')}</span>
                                                            </button>
                                                        );
                                                    })}
                                                {treatmentsMaster.filter(t => t.name.toLowerCase().includes(treatmentSearch.toLowerCase())).length === 0 && (
                                                    <div className="text-center py-6 text-gray-400 text-xs font-medium">
                                                        Tidak ada treatment/produk ditemukan
                                                    </div>
                                                )}
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
                                    const isCoupon = Boolean(item.used_coupon_item_id || item.notes?.includes('[KUPON'));
                                    return (
                                        <div key={item.treatment_id} className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-gray-50 p-3.5 rounded-xl border border-gray-100">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-ayumi-secondary">{item.name}</span>
                                                    {isCoupon && (
                                                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-200">
                                                            🎟️ Kupon Pasien (Rp 0)
                                                        </span>
                                                    )}
                                                </div>
                                                {hasDiscount && !isCoupon && (
                                                    <div className="flex items-center gap-1.5 mt-1 text-xs">
                                                        <span className="line-through text-gray-400">Rp {item.original_price?.toLocaleString('id-ID')}</span>
                                                        <span className="bg-pink-50 text-ayumi-primary font-bold px-1.5 py-0.5 rounded text-[10px]">
                                                            -{item.discount_percent}%
                                                        </span>
                                                    </div>
                                                )}
                                                {item.notes && <p className="text-xs text-gray-500 mt-0.5">{item.notes.replace(/\[KUPON_BARU:[^\]]+\]\s*/, '').replace(/\[KUPON_LAMA:[^\]]+\]\s*/, '')}</p>}
                                            </div>
                                            
                                            {!isCoupon && (
                                                <div className="w-full md:w-auto grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                    <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-gray-200">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase pl-1">Disc%</span>
                                                        <input 
                                                            type="number" 
                                                            min="0"
                                                            max="100"
                                                            value={item.discount_percent === 0 ? '' : item.discount_percent}
                                                            placeholder="0"
                                                            onChange={(e) => handleTreatmentDiscountChange(item.treatment_id, e.target.value)}
                                                            className="w-full text-xs font-bold text-right pr-1 outline-none"
                                                        />
                                                        <span className="text-gray-400 text-xs pr-1 font-bold">%</span>
                                                    </div>

                                                    <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase pl-1">Disc Rp</span>
                                                        <input 
                                                            type="number" 
                                                            value={item.original_price - item.price_at_time === 0 ? '' : item.original_price - item.price_at_time}
                                                            placeholder="0"
                                                            onChange={(e) => handleTreatmentDiscountNominalChange(item.treatment_id, e.target.value)}
                                                            className="w-full text-xs font-bold text-right pr-1 outline-none"
                                                        />
                                                    </div>

                                                    <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase pl-1">Harga Rp</span>
                                                        <input 
                                                            type="number" 
                                                            value={item.price_at_time}
                                                            onChange={(e) => handleTreatmentPriceChange(item.treatment_id, e.target.value)}
                                                            className="w-full text-xs font-bold text-right pr-1 outline-none text-ayumi-primary"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <button 
                                                type="button" 
                                                onClick={() => handleRemoveTreatment(item.treatment_id)}
                                                className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors self-end md:self-center cursor-pointer"
                                                title="Hapus tindakan"
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
                        <div className="flex justify-between items-center border-b pb-2">
                            <div>
                                <h3 className="text-lg font-bold text-ayumi-secondary">Foto Dokumentasi</h3>
                                <p className="text-xs text-gray-500">Ambil langsung dengan kamera perangkat atau unggah dari galeri.</p>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { key: 'foto_depan', label: 'Foto Depan' },
                                { key: 'foto_kiri', label: 'Foto Samping Kiri' },
                                { key: 'foto_kanan', label: 'Foto Samping Kanan' }
                            ].map(slot => (
                                <div key={slot.key} className="border-2 border-dashed border-gray-200 rounded-2xl p-4 text-center bg-gray-50/70 hover:bg-white transition-all relative flex flex-col justify-center items-center min-h-[190px]">
                                    {photoPreviews[slot.key] ? (
                                        <div className="w-full relative group">
                                            <div className="w-full h-48 sm:h-52 bg-gray-950/5 rounded-xl overflow-hidden flex items-center justify-center border border-gray-100 shadow-inner">
                                                <img src={photoPreviews[slot.key]} alt={slot.label} className="w-full h-full object-contain" />
                                            </div>
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveCameraSlot(slot.key)
                                                        setIsCameraOpen(true)
                                                    }}
                                                    className="bg-white/90 hover:bg-white text-gray-800 p-2 rounded-xl text-xs font-bold shadow transition-transform hover:scale-105 flex items-center gap-1 cursor-pointer"
                                                    title="Ambil Ulang dari Kamera"
                                                >
                                                    <svg className="w-4 h-4 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                    Kamera
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => fileInputRefs[slot.key].current?.click()}
                                                    className="bg-white/90 hover:bg-white text-gray-800 p-2 rounded-xl text-xs font-bold shadow transition-transform hover:scale-105 flex items-center gap-1 cursor-pointer"
                                                    title="Ganti dari Galeri"
                                                >
                                                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    Galeri
                                                </button>
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={() => {
                                                    setPhotoFiles(prev => ({ ...prev, [slot.key]: null }))
                                                    setPhotoPreviews(prev => ({ ...prev, [slot.key]: null }))
                                                }}
                                                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-md z-10 cursor-pointer"
                                                title="Hapus Foto"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                            <div className="mt-1.5 text-center">
                                                <span className="text-xs font-bold text-gray-600">{slot.label}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center space-y-3 w-full py-2">
                                            <div className="w-12 h-12 rounded-2xl bg-pink-50 text-pink-600 flex items-center justify-center shadow-xs">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                            </div>
                                            <span className="text-xs font-bold text-gray-700 block">{slot.label}</span>
                                            
                                            <div className="flex items-center gap-2 w-full max-w-[200px]">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveCameraSlot(slot.key)
                                                        setIsCameraOpen(true)
                                                    }}
                                                    className="flex-1 py-2 px-2 bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                    Kamera
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => fileInputRefs[slot.key].current?.click()}
                                                    className="flex-1 py-2 px-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                                                >
                                                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                                    Galeri
                                                </button>
                                            </div>

                                            <input 
                                                type="file" 
                                                ref={fileInputRefs[slot.key]}
                                                accept="image/*" 
                                                onChange={(e) => {
                                                    if (e.target.files && e.target.files[0]) {
                                                        handleFileChange(slot.key, e.target.files[0])
                                                    }
                                                    e.target.value = ''
                                                }}
                                                className="hidden"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Camera Capture Modal */}
                        <CameraCaptureModal
                            isOpen={isCameraOpen}
                            onClose={() => {
                                setIsCameraOpen(false)
                                setActiveCameraSlot(null)
                            }}
                            title={`Ambil Foto: ${activeCameraSlot ? (activeCameraSlot === 'foto_depan' ? 'Foto Depan' : activeCameraSlot === 'foto_kiri' ? 'Foto Samping Kiri' : 'Foto Samping Kanan') : ''}`}
                            onCapture={(capturedFile) => {
                                if (activeCameraSlot && capturedFile) {
                                    handleFileChange(activeCameraSlot, capturedFile)
                                }
                            }}
                        />
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
