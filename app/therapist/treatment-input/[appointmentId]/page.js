'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import CameraCaptureModal from '@/components/ui/CameraCaptureModal'
import TherapistPatientHistoryModal from '@/components/ui/TherapistPatientHistoryModal'
import { compressImageForMedical } from '@/lib/imageCompression'
import { notifyTreatmentCompleted } from '@/lib/notifications'

export default function TreatmentInputPage() {
    const router = useRouter()
    const params = useParams()
    const appointmentId = params?.appointmentId

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [appointment, setAppointment] = useState(null)
    const [dbUser, setDbUser] = useState(null)
    const [existingRecordId, setExistingRecordId] = useState(null)
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

    // Master data
    const [treatmentsMaster, setTreatmentsMaster] = useState([])
    const [couponPackagesMaster, setCouponPackagesMaster] = useState([])
    const [patientActiveCoupons, setPatientActiveCoupons] = useState([])
    const [therapistsList, setTherapistsList] = useState([])
    const [selectedPerformerId, setSelectedPerformerId] = useState('')

    // Treatment & Package selection
    const [selectedTreatments, setSelectedTreatments] = useState([])
    const [treatmentSearch, setTreatmentSearch] = useState('')
    const [packageSearch, setPackageSearch] = useState('')
    const [isTreatmentDropdownOpen, setIsTreatmentDropdownOpen] = useState(false)
    const [isPackageDropdownOpen, setIsPackageDropdownOpen] = useState(false)

    // SOAP Form & Clinical Profile
    const [formData, setFormData] = useState({
        skin_type: '',
        contraindications: '',
        medical_history: '',
        client_skincare_routine: '',
        complaints: '',
        skin_condition: '',
        result_notes: '',
        recommendation: ''
    })

    // Photos
    const [photoFiles, setPhotoFiles] = useState({ foto_depan: null, foto_kiri: null, foto_kanan: null })
    const [photoPreviews, setPhotoPreviews] = useState({ foto_depan: null, foto_kiri: null, foto_kanan: null })

    // Camera Modal State
    const [isCameraOpen, setIsCameraOpen] = useState(false)
    const [activeCameraSlot, setActiveCameraSlot] = useState(null)
    const fileInputRefs = {
        foto_depan: useRef(null),
        foto_kiri: useRef(null),
        foto_kanan: useRef(null)
    }

    useEffect(() => {
        fetchData()
    }, [appointmentId])

    // Kupon sengaja tidak ditangani di sini. Terapis hanya mencatat tindakan yang
    // dikerjakan; penukaran kupon dan pemotongan sisa sesi dilakukan admin di kasir,
    // supaya sisa sesi hanya berubah di satu tempat dan tidak terpotong dua kali.

    const fetchData = async () => {
        setLoading(true)
        
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || !['therapist', 'owner', 'admin'].includes(userData.role)) {
            router.push('/dashboard')
            return
        }
        setDbUser(userData)

        // Fetch Appointment with full patient clinical profile
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`*, patients (id, full_name, gender, birth_date, allergies, notes, skin_type, medical_notes, skin_concerns), branches (name)`)
            .eq('id', appointmentId)
            .single()

        if (aptData) {
            // Verify assigned therapist only if user is therapist role
            if (userData.role === 'therapist' && aptData.therapist_id && aptData.therapist_id !== userData.id) {
                toast.error('Anda tidak ditugaskan untuk jadwal ini.')
                router.push('/therapist/dashboard')
                return
            }

            setAppointment(aptData)

            // Check if treatment_record already exists for this appointment
            const { data: existingRecord } = await supabase
                .from('treatment_records')
                .select(`
                    *,
                    treatment_record_items (
                        id, treatment_id, price_at_time, original_price, discount_percent, notes, treatments (name, followup_days, commission_percent)
                    )
                `)
                .eq('appointment_id', aptData.id)
                .maybeSingle()

            if (existingRecord) {
                setExistingRecordId(existingRecord.id)
                if (existingRecord.performed_by) {
                    setSelectedPerformerId(existingRecord.performed_by)
                } else if (aptData.therapist_id) {
                    setSelectedPerformerId(aptData.therapist_id)
                } else if (userData.role === 'therapist') {
                    setSelectedPerformerId(userData.id)
                }

                setFormData({
                    skin_type: existingRecord.skin_type || aptData.patients?.skin_type || '',
                    contraindications: existingRecord.contraindications || aptData.patients?.allergies || '',
                    medical_history: existingRecord.medical_history || aptData.patients?.medical_notes || '',
                    client_skincare_routine: existingRecord.client_skincare_routine || aptData.patients?.notes || '',
                    complaints: existingRecord.complaints || aptData.notes || '',
                    skin_condition: existingRecord.skin_condition || '',
                    result_notes: existingRecord.result_notes || '',
                    recommendation: existingRecord.recommendation || ''
                })

                if (existingRecord.treatment_record_items?.length > 0) {
                    setSelectedTreatments(existingRecord.treatment_record_items.map(item => ({
                        treatment_id: item.treatment_id,
                        name: item.treatments?.name || 'Treatment',
                        price_at_time: item.price_at_time || 0,
                        original_price: item.original_price || item.price_at_time || 0,
                        discount_percent: item.discount_percent || 0,
                        followup_days: item.treatments?.followup_days || 0,
                        notes: item.notes || '',
                        commission_percent: item.commission_percent || 0
                    })))
                }

                // Fetch Existing Photos for this Record
                const { data: existingPhotos } = await supabase
                    .from('patient_photos')
                    .select('*')
                    .eq('treatment_record_id', existingRecord.id)

                if (existingPhotos && existingPhotos.length > 0) {
                    const previews = {}
                    for (let i = 0; i < existingPhotos.length; i++) {
                        const photo = existingPhotos[i]
                        let photoUrl = null

                        try {
                            const { data: signedData } = await supabase.storage
                                .from('patient-photos')
                                .createSignedUrl(photo.storage_path, 60 * 60)
                            if (signedData?.signedUrl) photoUrl = signedData.signedUrl
                        } catch (e) {}

                        if (!photoUrl) {
                            try {
                                const { data: pubData } = supabase.storage.from('patient-photos').getPublicUrl(photo.storage_path)
                                if (pubData?.publicUrl) photoUrl = pubData.publicUrl
                            } catch (e) {}
                        }

                        if (photoUrl) {
                            const rawCaption = (photo.caption || '').toLowerCase()
                            const fileName = (photo.storage_path.split('/').pop() || '').toLowerCase()

                            if (rawCaption.includes('depan') || fileName.includes('depan') || rawCaption.includes('front')) {
                                previews['foto_depan'] = photoUrl
                            } else if (rawCaption.includes('kiri') || fileName.includes('kiri') || rawCaption.includes('left')) {
                                previews['foto_kiri'] = photoUrl
                            } else if (rawCaption.includes('kanan') || fileName.includes('kanan') || rawCaption.includes('right')) {
                                previews['foto_kanan'] = photoUrl
                            } else {
                                if (i === 0 && !previews['foto_depan']) previews['foto_depan'] = photoUrl
                                else if (i === 1 && !previews['foto_kiri']) previews['foto_kiri'] = photoUrl
                                else if (i === 2 && !previews['foto_kanan']) previews['foto_kanan'] = photoUrl
                            }
                        }
                    }
                    setPhotoPreviews(prev => ({ ...prev, ...previews }))
                }
            } else {
                // Pre-fill clinical data & complaints from patient profile & appointment notes
                setFormData(prev => ({
                    ...prev,
                    skin_type: aptData.patients?.skin_type || '',
                    contraindications: aptData.patients?.allergies || '',
                    medical_history: aptData.patients?.medical_notes || '',
                    client_skincare_routine: aptData.patients?.notes || '',
                    complaints: aptData.notes || ''
                }))
            }
        } else {
            toast.error('Jadwal tidak ditemukan')
            router.push('/therapist/dashboard')
        }

        // Fetch Treatments Master
        const { data: trData } = await supabase.from('treatments').select('*').eq('is_active', true).order('name')
        if (trData) setTreatmentsMaster(trData)

        // Fetch Patient Active Coupons if patient exists
        const patientId = aptData?.patient_id || aptData?.patients?.id
        if (patientId) {
            const { data: pcData } = await supabase
                .from('patient_coupons')
                .select(`
                    id, package_id, expired_at, status,
                    coupon_packages (id, name, price),
                    patient_coupon_items (
                        id, treatment_id, total_sessions, used_sessions, remaining_sessions, status,
                        treatments (id, name, price, commission_percent, followup_days)
                    )
                `)
                .eq('patient_id', patientId)
                .neq('status', 'fully_used')
                .neq('status', 'completed')
                .gt('expired_at', new Date().toISOString())

            if (pcData) {
                const validCoupons = pcData.filter(c => 
                    c.patient_coupon_items?.some(it => it.remaining_sessions > 0 && it.status !== 'fully_used')
                )
                setPatientActiveCoupons(validCoupons)
            }
        }

        // Fetch Coupon Packages Master with items
        const { data: cpData } = await supabase
            .from('coupon_packages')
            .select(`
                id, name, price, category,
                coupon_package_items (
                    id, treatment_id, quantity, price_per_item,
                    treatments (id, name, price, commission_percent, followup_days)
                )
            `)
            .eq('is_active', true)
            .order('name')
        if (cpData) setCouponPackagesMaster(cpData)

        // Fetch Therapists for performer selection if admin/owner
        const { data: thList } = await supabase
            .from('users')
            .select('id, full_name, role, branch_id')
            .eq('role', 'therapist')
            .eq('is_active', true)
            .order('full_name')
        if (thList) {
            setTherapistsList(thList)
            if (!aptData?.therapist_id && userData.role !== 'therapist' && thList.length > 0) {
                setSelectedPerformerId(prev => prev || thList[0].id)
            }
        }
        
        setLoading(false)
    }

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
        if (selectedTreatments.some(x => x.treatment_id === t.id && !x.is_new_package && !x.is_existing_coupon)) {
            toast.error('Treatment ini sudah ada di daftar.')
            return
        }

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
                followup_days: t.followup_days || 0,
                notes: '',
                commission_percent: t.commission_percent || 0,
                mode: 'regular'
            }
        ])
    }

    const handleAddPackage = (pkg) => {
        if (!pkg) return
        const firstItem = pkg.coupon_package_items?.[0]
        if (!firstItem) {
            toast.error('Paket kupon ini belum memiliki rincian tindakan.')
            return
        }

        const t = firstItem.treatments || treatmentsMaster.find(x => x.id === firstItem.treatment_id)
        if (!t) {
            toast.error('Tindakan dalam paket kupon tidak ditemukan.')
            return
        }

        const originalPrice = t.price || 0
        setSelectedTreatments(prev => {
            // Remove previous new_package item if any to prevent duplicate package purchase in single session
            const filtered = prev.filter(x => !x.is_new_package)
            return [
                ...filtered,
                {
                    treatment_id: t.id,
                    name: `${t.name} (Sesi 1 dari Paket ${pkg.name})`,
                    price_at_time: 0,
                    original_price: originalPrice,
                    discount_percent: 100,
                    followup_days: t.followup_days || 14,
                    notes: `[KUPON_BARU:${pkg.id}:${pkg.name}:${pkg.price}] Sesi 1/${firstItem.quantity} - Beli Paket ${pkg.name}`,
                    commission_percent: t.commission_percent || 5,
                    is_new_package: true,
                    package_id: pkg.id,
                    package_name: pkg.name,
                    package_price: pkg.price,
                    package_total_sessions: firstItem.quantity
                }
            ]
        })

        // Auto update recommendation note
        setFormData(prev => {
            const recommendationText = `Ambil Paket Kupon: ${pkg.name} (Total ${firstItem.quantity} Sesi)`
            if (prev.recommendation && prev.recommendation.includes(pkg.name)) return prev
            return {
                ...prev,
                recommendation: prev.recommendation ? `${prev.recommendation}\n${recommendationText}` : recommendationText
            }
        })

        toast.success(`Paket ${pkg.name} dipilih! Sesi 1 akan otomatis terpotong saat pembayaran kasir.`)
    }

    const handleUseActiveCoupon = (coupon, item) => {
        if (!item || item.remaining_sessions <= 0) {
            toast.error('Sisa sesi kupon ini sudah habis.')
            return
        }

        const t = item.treatments || treatmentsMaster.find(x => x.id === item.treatment_id)
        if (!t) {
            toast.error('Tindakan dalam kupon tidak ditemukan.')
            return
        }

        if (selectedTreatments.some(x => x.treatment_id === t.id && x.used_coupon_item_id === item.id)) {
            toast.error('Kupon ini sudah dimasukkan ke tindakan.')
            return
        }

        setSelectedTreatments(prev => [
            ...prev,
            {
                treatment_id: t.id,
                name: `${t.name} (Klaim Kupon: ${coupon.coupon_packages?.name || 'Paket'})`,
                price_at_time: 0,
                original_price: t.price || 0,
                discount_percent: 100,
                followup_days: t.followup_days || 14,
                notes: `[KUPON_LAMA:${item.id}:${coupon.coupon_packages?.name || 'Paket'}] Sisa ${item.remaining_sessions} Sesi`,
                commission_percent: t.commission_percent || 5,
                is_existing_coupon: true,
                used_coupon_item_id: item.id,
                coupon_package_name: coupon.coupon_packages?.name || 'Paket Kupon',
                remaining_sessions: item.remaining_sessions
            }
        ])

        toast.success(`Kupon ${coupon.coupon_packages?.name || ''} digunakan! Sisa ${item.remaining_sessions} sesi.`)
    }

    const handleRemoveTreatment = (treatmentId) => {
        setSelectedTreatments(prev => prev.filter(x => x.treatment_id !== treatmentId))
    }

    const uploadPhotoSlot = async (file, slotKey, patientId, recordId) => {
        let uploadFile = file
        if (typeof compressImageForMedical === 'function') {
            try {
                uploadFile = await compressImageForMedical(file, 1600, 0.8)
            } catch (compErr) {
                console.warn('Compression fallback to original file:', compErr)
            }
        }

        const safePatientId = patientId || 'patient'
        const fd = new FormData()
        fd.append('file', uploadFile)
        fd.append('patientId', safePatientId)
        fd.append('recordId', recordId)
        fd.append('slotKey', slotKey)
        fd.append('photoType', 'before')

        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token

        const res = await fetch('/api/patient-photos/upload', {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: fd
        })

        const json = await res.json()
        if (!res.ok || !json.success) {
            throw new Error(json.error || `Gagal mengunggah foto ${slotKey}`)
        }

        return json.photo
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        
        if (selectedTreatments.length === 0) {
            toast.error('Pilih minimal 1 treatment yang dilakukan.')
            return
        }
        const performer = dbUser.role === 'therapist' ? dbUser.id : (selectedPerformerId || appointment.therapist_id || null)

        if (dbUser.role !== 'therapist' && !performer) {
            toast.error('Silakan pilih terapis yang menangani tindakan terlebih dahulu.')
            return
        }

        setSaving(true)

        try {
            let recordId = existingRecordId
            const targetPatientId = appointment?.patient_id || appointment?.patients?.id || null

            // Clinical & SOAP fields payload
            const clinicalFields = {
                skin_type: formData.skin_type || null,
                contraindications: formData.contraindications || null,
                medical_history: formData.medical_history || null,
                client_skincare_routine: formData.client_skincare_routine || null
            }

            if (existingRecordId) {
                // Update existing record
                let updatePayload = {
                    patient_id: targetPatientId,
                    performed_by: performer,
                    skin_condition: formData.skin_condition,
                    complaints: formData.complaints,
                    result_notes: formData.result_notes,
                    recommendation: formData.recommendation,
                    ...clinicalFields,
                    updated_by: dbUser.id
                }

                const { error: updateError } = await supabase
                    .from('treatment_records')
                    .update(updatePayload)
                    .eq('id', existingRecordId)

                if (updateError) {
                    // Graceful fallback if columns are still pending schema cache
                    delete updatePayload.skin_type
                    delete updatePayload.contraindications
                    delete updatePayload.medical_history
                    delete updatePayload.client_skincare_routine
                    const { error: fallbackErr } = await supabase
                        .from('treatment_records')
                        .update(updatePayload)
                        .eq('id', existingRecordId)
                    if (fallbackErr) throw fallbackErr
                }

                // Clear old items to re-insert fresh list
                await supabase.from('treatment_record_items').delete().eq('treatment_record_id', existingRecordId)
            } else {
                // Insert new Treatment Record
                let insertPayload = {
                    patient_id: targetPatientId,
                    appointment_id: appointment.id,
                    branch_id: appointment.branch_id,
                    performed_by: performer,
                    treatment_date: new Date().toISOString().split('T')[0],
                    treatment_time: new Date().toTimeString().substring(0, 5),
                    skin_condition: formData.skin_condition,
                    complaints: formData.complaints,
                    result_notes: formData.result_notes,
                    recommendation: formData.recommendation,
                    ...clinicalFields,
                    created_by: dbUser.id
                }

                const { data: recordData, error: recordError } = await supabase
                    .from('treatment_records')
                    .insert([insertPayload])
                    .select('id')
                    .single()

                if (recordError) {
                    delete insertPayload.skin_type
                    delete insertPayload.contraindications
                    delete insertPayload.medical_history
                    delete insertPayload.client_skincare_routine
                    const { data: fbData, error: fbErr } = await supabase
                        .from('treatment_records')
                        .insert([insertPayload])
                        .select('id')
                        .single()
                    if (fbErr) throw fbErr
                    recordId = fbData.id
                } else {
                    recordId = recordData.id
                }
            }

            // Sync clinical profile directly to master patients table
            if (targetPatientId) {
                await supabase
                    .from('patients')
                    .update({
                        skin_type: formData.skin_type || null,
                        allergies: formData.contraindications || null,
                        medical_notes: formData.medical_history || null,
                        notes: formData.client_skincare_routine || null
                    })
                    .eq('id', targetPatientId)
            }

            // 2. Insert Treatment Record Items + Followup Queue
            const itemsToInsert = []
            const queuesToInsert = []

            selectedTreatments.forEach((t, index) => {
                itemsToInsert.push({
                    treatment_record_id: recordId,
                    treatment_id: t.treatment_id,
                    price_at_time: t.price_at_time,
                    original_price: t.original_price,
                    discount_percent: t.discount_percent,
                    notes: t.notes,
                    sort_order: index + 1,
                    commission_percent: t.commission_percent || 0
                })

                // Auto-schedule follow-up bertahap: 2 minggu, 3 minggu & 1 bulan
                const baseDateStr = appointment.appointment_date || new Date().toISOString().split('T')[0]
                const followupSteps = [
                    { days: 14, type: 'followup_2minggu', priority: 'normal' },
                    { days: 21, type: 'followup_3minggu', priority: 'normal' },
                    { days: 30, type: 'followup_1bulan', priority: 'normal' }
                ]
                followupSteps.forEach(step => {
                    const scheduledDate = new Date(baseDateStr + 'T00:00:00')
                    scheduledDate.setDate(scheduledDate.getDate() + step.days)
                    queuesToInsert.push({
                        patient_id: appointment.patient_id,
                        treatment_record_id: recordId,
                        branch_id: appointment.branch_id || dbUser?.branch_id || null,
                        assigned_to: dbUser.id,
                        followup_type: step.type,
                        scheduled_date: scheduledDate.toISOString().split('T')[0],
                        priority: step.priority,
                        status: 'pending'
                    })
                })
            })

            const { error: itemsErr } = await supabase.from('treatment_record_items').insert(itemsToInsert)
            if (itemsErr) throw itemsErr

            if (queuesToInsert.length > 0) {
                const { error: queueErr } = await supabase.from('followup_queue').insert(queuesToInsert)
                if (queueErr) {
                    console.warn('Followup queue note:', queueErr.message || queueErr)
                }
            }

            // 3. Upload Photos (via Server API)
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']

            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    try {
                        await uploadPhotoSlot(photoFiles[slot], slot, targetPatientId, recordId)
                    } catch (photoErr) {
                        console.error(`Gagal upload foto ${slot}:`, photoErr)
                        toast.error(`Peringatan: ${photoErr.message}`)
                    }
                }
            }

            // 4. Update Appointment Status to completed
            await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', appointment.id)

            // 4.5 Kirim notifikasi realtime ke seluruh Admin, Kasir, dan Owner
            await notifyTreatmentCompleted({
                supabase,
                appointment,
                performerUser: dbUser
            })

            toast.success('Treatment & SOAP berhasil disimpan! Kasir dapat memproses pembayaran.')
            if (dbUser.role === 'therapist') {
                router.push('/therapist/dashboard')
            } else {
                router.push('/appointments')
            }
            
        } catch (error) {
            toast.error('Terjadi kesalahan: ' + error.message)
            console.error(error)
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    if (!appointment) return null

    return (
        <div className="max-w-4xl mx-auto space-y-6">

            {/* Info Pasien & Jadwal */}
            <div className="card-ayumi p-5 grid grid-cols-2 md:grid-cols-4 gap-4 bg-gradient-to-br from-pink-50 to-white border-pink-100 items-center">
                <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Pasien</div>
                    <div className="text-base font-bold text-ayumi-text">{appointment.patients?.full_name}</div>
                    <button
                        type="button"
                        onClick={() => setIsHistoryModalOpen(true)}
                        className="text-[11px] font-bold text-ayumi-primary hover:underline flex items-center gap-1 mt-1 cursor-pointer"
                    >
                        <span>📋 Lihat Riwayat Medis Pasien ↗</span>
                    </button>
                </div>
                <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Cabang</div>
                    <div className="text-base font-bold text-ayumi-text">{appointment.branches?.name}</div>
                </div>
                <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Tanggal</div>
                    <div className="text-base font-bold text-ayumi-text">
                        {new Date(appointment.appointment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                </div>
                <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Jam</div>
                    <div className="text-base font-bold text-ayumi-primary">{appointment.start_time?.substring(0,5)} WIB</div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* ─── PEMILIHAN TERAPIS PELAKSANA (KHUSUS OWNER / ADMIN) ─── */}
                {dbUser?.role !== 'therapist' ? (
                    <div className="card-ayumi p-4 bg-amber-50/80 border border-amber-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                        <div>
                            <label className="block text-xs font-bold text-amber-900 uppercase tracking-wider">
                                Terapis yang Menangani Tindakan (Penerima Komisi) <span className="text-red-500">*</span>
                            </label>
                            <p className="text-[11px] text-amber-700 font-medium mt-0.5">
                                Pilih nama terapis pelaksana agar komisi tindakan tercatat dengan tepat ke terapis bersangkutan.
                            </p>
                        </div>
                        <div className="w-full md:w-72">
                            <select
                                value={selectedPerformerId}
                                onChange={(e) => setSelectedPerformerId(e.target.value)}
                                required
                                className="input-ayumi bg-white text-sm font-bold border-amber-300 focus:ring-amber-400"
                            >
                                <option value="">-- Pilih Terapis Pelaksana --</option>
                                {therapistsList
                                    .filter(t => !t.branch_id || !appointment?.branch_id || t.branch_id === appointment.branch_id)
                                    .map(t => (
                                        <option key={t.id} value={t.id}>{t.full_name}</option>
                                    ))
                                }
                            </select>
                        </div>
                    </div>
                ) : (
                    <div className="bg-pink-50 border border-pink-100 rounded-2xl px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Terapis Pelaksana:</span>
                        <span className="text-sm font-extrabold text-ayumi-primary">👩‍⚕️ {dbUser.full_name}</span>
                    </div>
                )}

                {/* ─── SECTION 1: PROFIL KULIT & DATA KLINIS PASIEN ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-6">
                    <div className="flex items-center justify-between border-b pb-3">
                        <h2 className="text-lg font-bold text-ayumi-secondary flex items-center gap-2">
                            <span className="p-1.5 bg-pink-100 text-pink-600 rounded-lg">🔬</span>
                            Profil Kulit & Riwayat Klinis Pasien
                        </h2>
                        <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                            Tersinkronisasi ke Master Pasien
                        </span>
                    </div>

                    {/* 1.1 Jenis Kulit (Skin Type Chips) */}
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            Jenis Kulit (Skin Type)
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { id: 'Normal', label: '✨ Normal', color: 'hover:border-emerald-400 hover:text-emerald-700 active:bg-emerald-50' },
                                { id: 'Kering', label: '🌵 Kering (Dry)', color: 'hover:border-amber-400 hover:text-amber-700 active:bg-amber-50' },
                                { id: 'Berminyak', label: '💧 Berminyak (Oily)', color: 'hover:border-blue-400 hover:text-blue-700 active:bg-blue-50' },
                                { id: 'Kombinasi', label: '⚖️ Kombinasi', color: 'hover:border-teal-400 hover:text-teal-700 active:bg-teal-50' },
                                { id: 'Sensitif', label: '🌸 Sensitif', color: 'hover:border-rose-400 hover:text-rose-700 active:bg-rose-50' },
                                { id: 'Acne-Prone', label: '🔴 Acne-Prone (Berjerawat)', color: 'hover:border-red-400 hover:text-red-700 active:bg-red-50' },
                                { id: 'Aging', label: '⏳ Aging / Flek', color: 'hover:border-purple-400 hover:text-purple-700 active:bg-purple-50' }
                            ].map(item => {
                                const isSelected = formData.skin_type === item.id || (formData.skin_type && formData.skin_type.toLowerCase().includes(item.id.toLowerCase()))
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, skin_type: isSelected ? '' : item.id }))}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                            isSelected 
                                                ? 'bg-pink-600 border-pink-600 text-white shadow-sm scale-105' 
                                                : `bg-white border-gray-200 text-gray-700 ${item.color}`
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* 1.2 Kontraindikasi (Warning Box) */}
                    <div className="p-4 bg-rose-50/50 border-2 border-rose-200/80 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-rose-900 flex items-center gap-1.5">
                                <span className="text-rose-600 font-extrabold text-base">⚠️</span>
                                Kontraindikasi / Peringatan Khusus
                            </label>
                            <span className="text-[11px] font-bold text-rose-600 uppercase bg-rose-100 px-2 py-0.5 rounded-md">Penting</span>
                        </div>
                        <textarea
                            name="contraindications"
                            value={formData.contraindications}
                            onChange={handleChange}
                            rows="2"
                            placeholder="Contoh: Sedang hamil/menyusui, alergi zat aktif tertentu, penggunaan retinol/AHA aktif..."
                            className="input-ayumi bg-white text-sm border-rose-200 focus:border-rose-400 resize-none"
                        ></textarea>
                        {/* Quick Tag Chips */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] text-gray-500 font-semibold mr-1">Tag Cepat:</span>
                            {[
                                'Ibu Hamil / Menyusui',
                                'Retinoid / AHA-BHA Aktif',
                                'Alergi Obat/Bahan',
                                'Riwayat Keloid',
                                'Kulit Iritasi / Sunburn',
                                'Tidak Ada Kontraindikasi'
                            ].map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                        setFormData(prev => {
                                            const current = prev.contraindications?.trim() || ''
                                            if (tag === 'Tidak Ada Kontraindikasi') return { ...prev, contraindications: 'Tidak Ada' }
                                            if (current.includes(tag)) return prev
                                            const updated = current ? `${current}, ${tag}` : tag
                                            return { ...prev, contraindications: updated }
                                        })
                                    }}
                                    className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-white border border-rose-200 text-rose-800 hover:bg-rose-100 hover:border-rose-300 transition-colors cursor-pointer"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* 1.3 Sejarah Medis */}
                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-gray-700">
                                📋 Sejarah Medis & Riwayat Penyakit
                            </label>
                            <textarea
                                name="medical_history"
                                value={formData.medical_history}
                                onChange={handleChange}
                                rows="3"
                                placeholder="Riwayat medis umum, riwayat alergi lama, konsumsi obat rutin, atau tindakan medis sebelumnya..."
                                className="input-ayumi bg-gray-50 focus:bg-white text-sm resize-none"
                            ></textarea>
                            {/* Quick Tags */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {[
                                    'Penyakit Kulit Kronis',
                                    'Konsumsi Obat Jerawat Rutin',
                                    'Perawatan di Klinik Lain',
                                    'Tidak Ada Riwayat Medis'
                                ].map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => {
                                                const current = prev.medical_history?.trim() || ''
                                                if (tag === 'Tidak Ada Riwayat Medis') return { ...prev, medical_history: 'Tidak Ada' }
                                                if (current.includes(tag)) return prev
                                                const updated = current ? `${current}, ${tag}` : tag
                                                return { ...prev, medical_history: updated }
                                            })
                                        }}
                                        className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 1.4 Perawatan Klien (Skincare Rutin Homecare) */}
                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-gray-700">
                                🧴 Perawatan Klien (Skincare Rutin di Rumah)
                            </label>
                            <textarea
                                name="client_skincare_routine"
                                value={formData.client_skincare_routine}
                                onChange={handleChange}
                                rows="3"
                                placeholder="Produk perawatan harian yang sedang dipakai klien (Facial Wash, Toner, Sunscreen, Krim Malam, dll)..."
                                className="input-ayumi bg-gray-50 focus:bg-white text-sm resize-none"
                            ></textarea>
                            {/* Quick Tags */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {[
                                    'Facial Wash',
                                    'Toner',
                                    'Serum',
                                    'Sunscreen',
                                    'Moisturizer',
                                    'Night Cream',
                                    'Produk Racikan Dokter'
                                ].map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => {
                                                const current = prev.client_skincare_routine?.trim() || ''
                                                if (current.includes(tag)) return prev
                                                const updated = current ? `${current}, ${tag}` : tag
                                                return { ...prev, client_skincare_routine: updated }
                                            })
                                        }}
                                        className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ─── SECTION 2: CATATAN SOAP ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-5">
                    <h2 className="text-lg font-bold text-ayumi-secondary border-b pb-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Catatan SOAP
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded mr-2">S</span>
                                Subjektif (Keluhan Pasien)
                            </label>
                            <textarea
                                name="complaints"
                                value={formData.complaints}
                                onChange={handleChange}
                                rows="3"
                                placeholder="Keluhan utama pasien saat datang..."
                                className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                            ></textarea>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded mr-2">O</span>
                                Objektif (Kondisi Kulit Saat Pemeriksaan)
                            </label>
                            <textarea
                                name="skin_condition"
                                value={formData.skin_condition}
                                onChange={handleChange}
                                rows="3"
                                placeholder="Kondisi kulit fisik saat diperiksa..."
                                className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                            ></textarea>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded mr-2">A</span>
                            Asesmen (Tindakan & Hasil) *
                        </label>
                        <textarea
                            name="result_notes"
                            value={formData.result_notes}
                            onChange={handleChange}
                            required
                            rows="4"
                            placeholder="Detail tindakan yang dilakukan dan hasil treatment..."
                            className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                        ></textarea>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded mr-2">P</span>
                            Planning (Rekomendasi Treatment & Skincare)
                        </label>
                        <textarea
                            name="recommendation"
                            value={formData.recommendation}
                            onChange={handleChange}
                            rows="3"
                            placeholder="Rencana treatment lanjutan dan anjuran produk skincare homecare..."
                            className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                        ></textarea>
                    </div>
                </div>

                {/* ─── BANNER KUPON AKTIF PASIEN (JIKA ADA) ─── */}
                {patientActiveCoupons.length > 0 && (
                    <div className="card-ayumi p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50/70 border-2 border-emerald-200 rounded-2xl shadow-xs">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-xl">🎟️</span>
                            <div>
                                <h3 className="text-sm font-extrabold text-emerald-900">Kupon Aktif Milik Pasien</h3>
                                <p className="text-xs text-emerald-700">Pasien memiliki kupon yang masih bersisa. Klik tombol untuk langsung menggunakan kupon pada tindakan hari ini.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {patientActiveCoupons.map(coupon => (
                                <div key={coupon.id} className="space-y-2">
                                    {coupon.patient_coupon_items?.filter(it => it.remaining_sessions > 0).map(it => {
                                        const isUsedInForm = selectedTreatments.some(x => x.used_coupon_item_id === it.id)
                                        return (
                                            <div key={it.id} className="bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs flex items-center justify-between gap-2">
                                                <div>
                                                    <div className="font-bold text-xs text-gray-800">{coupon.coupon_packages?.name || 'Paket Kupon'}</div>
                                                    <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                                                        {it.treatments?.name || 'Tindakan'} • <span className="bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-800 font-extrabold">Sisa {it.remaining_sessions} Sesi</span>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={isUsedInForm}
                                                    onClick={() => handleUseActiveCoupon(coupon, it)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${isUsedInForm ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'}`}
                                                >
                                                    {isUsedInForm ? '✓ Sudah Dipakai' : '⚡ Pakai Kupon'}
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── SECTION 2: PILIH TREATMENT & PAKET KUPON ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b pb-3">
                        <div>
                            <h2 className="text-lg font-bold text-ayumi-primary flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                Tindakan Treatment *
                            </h2>
                            <p className="text-xs text-gray-400 mt-0.5">Pilih tindakan satuan biasa atau pilih paket kupon jika pasien mengambil paket.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Tombol Beli Paket Kupon Baru */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsPackageDropdownOpen(!isPackageDropdownOpen)
                                        setIsTreatmentDropdownOpen(false)
                                    }}
                                    className="border-2 border-purple-200 text-purple-700 font-bold rounded-xl px-3.5 py-2 text-xs md:text-sm bg-purple-50 hover:bg-purple-100 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                >
                                    <span>🎁</span>
                                    <span>Ambil Paket Kupon</span>
                                </button>
                                {isPackageDropdownOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs md:bg-transparent md:backdrop-blur-none cursor-default" onClick={() => setIsPackageDropdownOpen(false)} />
                                        <div className="fixed inset-x-3 top-20 max-w-md mx-auto md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-96 bg-white border border-purple-100 rounded-2xl shadow-2xl z-50 p-3.5 space-y-2">
                                            <div className="flex justify-between items-center px-1">
                                                <div className="text-xs font-bold text-purple-900">Pilih Paket Kupon Baru:</div>
                                                <button type="button" onClick={() => setIsPackageDropdownOpen(false)} className="text-gray-400 hover:text-red-500 md:hidden text-xs font-bold">✕ Tutup</button>
                                            </div>
                                            <div className="relative">
                                                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                <input
                                                    type="text"
                                                    placeholder="Cari paket kupon (cth: PRP 3x)..."
                                                    value={packageSearch}
                                                    onChange={(e) => setPackageSearch(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-purple-500 bg-gray-50 font-medium"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                                                {couponPackagesMaster
                                                    .filter(p => p.name.toLowerCase().includes(packageSearch.toLowerCase()))
                                                    .map(p => {
                                                        const totalSessions = p.coupon_package_items?.[0]?.quantity || 0
                                                        const treatmentName = p.coupon_package_items?.[0]?.treatments?.name || 'Treatment'
                                                        return (
                                                            <button
                                                                key={p.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    handleAddPackage(p)
                                                                    setIsPackageDropdownOpen(false)
                                                                    setPackageSearch('')
                                                                }}
                                                                className="w-full text-left px-3 py-2.5 rounded-xl transition-colors hover:bg-purple-50 flex items-center justify-between text-sm cursor-pointer"
                                                            >
                                                                <div className="min-w-0 pr-2">
                                                                    <div className="font-extrabold text-purple-900 truncate">{p.name}</div>
                                                                    <div className="text-[11px] text-gray-500">{treatmentName} • {totalSessions}x Sesi</div>
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <div className="text-xs font-bold text-ayumi-secondary">Rp {Number(p.price).toLocaleString('id-ID')}</div>
                                                                    <span className="text-[10px] bg-purple-100 text-purple-800 font-extrabold px-1.5 py-0.5 rounded">Pilih</span>
                                                                </div>
                                                            </button>
                                                        )
                                                    })
                                                }
                                                {couponPackagesMaster.filter(p => p.name.toLowerCase().includes(packageSearch.toLowerCase())).length === 0 && (
                                                    <div className="text-center py-6 text-gray-400 text-sm">Tidak ada paket ditemukan</div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Tombol Tambah Treatment Satuan */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsTreatmentDropdownOpen(!isTreatmentDropdownOpen)
                                        setIsPackageDropdownOpen(false)
                                    }}
                                    className="border-2 border-pink-200 text-ayumi-primary font-bold rounded-xl px-3.5 py-2 text-xs md:text-sm bg-pink-50 hover:bg-pink-100 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                    <span>Tambah Treatment Satuan</span>
                                </button>
                                {isTreatmentDropdownOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs md:bg-transparent md:backdrop-blur-none cursor-default" onClick={() => setIsTreatmentDropdownOpen(false)} />
                                        <div className="fixed inset-x-3 top-20 max-w-md mx-auto md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-96 bg-white border border-pink-100 rounded-2xl shadow-2xl z-50 p-3.5 space-y-2">
                                            <div className="flex justify-between items-center px-1">
                                                <div className="text-xs font-bold text-pink-900">Pilih Treatment Satuan:</div>
                                                <button type="button" onClick={() => setIsTreatmentDropdownOpen(false)} className="text-gray-400 hover:text-red-500 md:hidden text-xs font-bold">✕ Tutup</button>
                                            </div>
                                            <div className="relative">
                                                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                <input
                                                    type="text"
                                                    placeholder="Cari treatment..."
                                                    value={treatmentSearch}
                                                    onChange={(e) => setTreatmentSearch(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-ayumi-primary bg-gray-50 font-medium"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                                                {treatmentsMaster
                                                    .filter(t => t.name.toLowerCase().includes(treatmentSearch.toLowerCase()))
                                                    .map(t => {
                                                        const isSelected = selectedTreatments.some(x => x.treatment_id === t.id && !x.is_new_package && !x.is_existing_coupon)
                                                        return (
                                                            <button
                                                                key={t.id}
                                                                type="button"
                                                                disabled={isSelected}
                                                                onClick={() => {
                                                                    handleAddTreatment(t.id)
                                                                    setIsTreatmentDropdownOpen(false)
                                                                    setTreatmentSearch('')
                                                                }}
                                                                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-center justify-between text-sm cursor-pointer ${isSelected ? 'opacity-40 cursor-not-allowed' : 'hover:bg-pink-50'}`}
                                                            >
                                                                <span className="font-bold text-ayumi-secondary truncate pr-2">{t.name}</span>
                                                                <span className="text-xs font-bold text-gray-400 shrink-0">Rp {Number(t.price).toLocaleString('id-ID')}</span>
                                                            </button>
                                                        )
                                                    })
                                                }
                                                {treatmentsMaster.filter(t => t.name.toLowerCase().includes(treatmentSearch.toLowerCase())).length === 0 && (
                                                    <div className="text-center py-6 text-gray-400 text-sm">Tidak ada treatment ditemukan</div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
 
                    {selectedTreatments.length === 0 ? (
                        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                            <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            <p className="text-gray-400 font-medium text-sm">Belum ada treatment dipilih</p>
                            <p className="text-gray-400 text-xs mt-1">Pilih "Ambil Paket Kupon" atau "Tambah Treatment Satuan" di atas</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {selectedTreatments.map((item, idx) => {
                                const isNewPkg = item.is_new_package || item.notes?.includes('[KUPON_BARU:')
                                const isOldCoupon = item.is_existing_coupon || item.notes?.includes('[KUPON_LAMA:')

                                return (
                                    <div 
                                        key={item.treatment_id + (item.used_coupon_item_id || idx)} 
                                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                                            isNewPkg 
                                                ? 'bg-purple-50/80 border-purple-200' 
                                                : isOldCoupon 
                                                    ? 'bg-emerald-50/80 border-emerald-200' 
                                                    : 'bg-pink-50 border-pink-100'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                                isNewPkg 
                                                    ? 'bg-purple-200 text-purple-800' 
                                                    : isOldCoupon 
                                                        ? 'bg-emerald-200 text-emerald-800' 
                                                        : 'bg-ayumi-primary/10 text-ayumi-primary'
                                            }`}>
                                                {idx + 1}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-ayumi-secondary text-sm">{item.name}</span>
                                                    {isNewPkg && (
                                                        <span className="bg-purple-100 text-purple-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-purple-200">
                                                            🎁 Beli Paket Baru
                                                        </span>
                                                    )}
                                                    {isOldCoupon && (
                                                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-200">
                                                            🎟️ Klaim Kupon Pasien
                                                        </span>
                                                    )}
                                                </div>
                                                {item.notes && (
                                                    <div className={`text-xs font-medium mt-0.5 ${
                                                        isNewPkg ? 'text-purple-700' : isOldCoupon ? 'text-emerald-700' : 'text-gray-500'
                                                    }`}>
                                                        {item.notes.replace(/\[KUPON_BARU:[^\]]+\]\s*/, '').replace(/\[KUPON_LAMA:[^\]]+\]\s*/, '')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveTreatment(item.treatment_id)}
                                                className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                                title="Hapus treatment ini"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>



                {/* ─── SECTION 3: FOTO DOKUMENTASI ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-4">
                    <div className="flex justify-between items-center border-b pb-3">
                        <div>
                            <h2 className="text-lg font-bold text-ayumi-secondary flex items-center gap-2">
                                <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                Foto Dokumentasi <span className="text-gray-400 font-normal text-sm ml-1">(Opsional)</span>
                            </h2>
                            <p className="text-xs text-gray-500 mt-0.5">Ambil foto kondisi kulit langsung lewat kamera atau pilih file.</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            { key: 'foto_depan', label: 'Foto Depan' },
                            { key: 'foto_kiri', label: 'Foto Samping Kiri' },
                            { key: 'foto_kanan', label: 'Foto Samping Kanan' }
                        ].map(slot => (
                            <div key={slot.key} className="relative border-2 border-dashed border-gray-200 rounded-2xl flex flex-col justify-center items-center min-h-[190px] bg-gray-50/70 hover:bg-white transition-all p-3">
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
                                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-md z-10 cursor-pointer"
                                            title="Hapus Foto"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                        <div className="mt-1.5 text-center">
                                            <span className="text-xs font-bold text-gray-600">{slot.label}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center space-y-2.5 w-full py-1">
                                        <div className="w-10 h-10 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        </div>
                                        <span className="text-xs font-bold text-gray-700 block">{slot.label}</span>
                                        
                                        <div className="flex items-center gap-1.5 w-full max-w-[190px]">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveCameraSlot(slot.key)
                                                    setIsCameraOpen(true)
                                                }}
                                                className="flex-1 py-1.5 px-2 bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                                Kamera
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => fileInputRefs[slot.key].current?.click()}
                                                className="flex-1 py-1.5 px-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                                            >
                                                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                                Galeri
                                            </button>
                                        </div>

                                        <input
                                            type="file"
                                            ref={fileInputRefs[slot.key]}
                                            accept="image/jpeg,image/png,image/webp"
                                            capture="environment"
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files[0]) {
                                                    handleFileChange(slot.key, e.target.files[0])
                                                }
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

                {/* Submit */}
                <div className="flex justify-between items-center pt-2">
                    <Link href="/therapist/dashboard">
                        <button type="button" className="px-6 py-3 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
                            Batal
                        </button>
                    </Link>
                    <button
                        type="submit"
                        disabled={saving || selectedTreatments.length === 0}
                        className="btn-primary py-3 px-8 text-base font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                        {saving ? 'Menyimpan...' : 'Simpan & Kirim ke Kasir'}
                    </button>
                </div>
            </form>

            {/* Patient History Modal */}
            <TherapistPatientHistoryModal
                patientId={appointment?.patient_id}
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
            />
        </div>
    )
}
