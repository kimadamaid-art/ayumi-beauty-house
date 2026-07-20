'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { use } from 'react'
import { toast } from 'react-hot-toast'

export default function TreatmentInputPage({ params }) {
    const resolvedParams = use(params)
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [appointment, setAppointment] = useState(null)
    const [dbUser, setDbUser] = useState(null)

    // Master data
    const [treatmentsMaster, setTreatmentsMaster] = useState([])
    const [patientCoupons, setPatientCoupons] = useState([])

    // Treatment selection
    const [selectedTreatments, setSelectedTreatments] = useState([])
    const [treatmentSearch, setTreatmentSearch] = useState('')
    const [isTreatmentDropdownOpen, setIsTreatmentDropdownOpen] = useState(false)
    const [isCouponModalOpen, setIsCouponModalOpen] = useState(false)

    // SOAP Form
    const [formData, setFormData] = useState({
        complaints: '',
        skin_condition: '',
        result_notes: '',
        recommendation: ''
    })

    // Photos
    const [photoFiles, setPhotoFiles] = useState({ foto_depan: null, foto_kiri: null, foto_kanan: null })
    const [photoPreviews, setPhotoPreviews] = useState({ foto_depan: null, foto_kiri: null, foto_kanan: null })

    useEffect(() => {
        fetchData()
    }, [resolvedParams.appointmentId])

    // Fetch patient coupons when appointment is loaded
    useEffect(() => {
        const fetchCoupons = async () => {
            if (!appointment?.patient_id) return
            const { data: pcData } = await supabase
                .from('patient_coupons')
                .select('id')
                .eq('patient_id', appointment.patient_id)
                .eq('status', 'active')

            const activeCouponIds = pcData?.map(pc => pc.id) || []
            if (activeCouponIds.length === 0) return

            const { data } = await supabase
                .from('patient_coupon_items')
                .select(`
                    id, patient_coupon_id, treatment_id, total_sessions, used_sessions, remaining_sessions, status,
                    treatments(name),
                    patient_coupons(status, coupon_packages(name))
                `)
                .eq('status', 'active')
                .in('patient_coupon_id', activeCouponIds)
                .gt('remaining_sessions', 0)

            if (data) setPatientCoupons(data)
        }
        fetchCoupons()
    }, [appointment?.patient_id])

    const fetchData = async () => {
        setLoading(true)
        
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }
        setDbUser(userData)

        // Fetch Appointment
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`*, patients (*), branches (name)`)
            .eq('id', resolvedParams.appointmentId)
            .single()

        if (aptData) {
            // Verify assigned therapist
            if (aptData.therapist_id && aptData.therapist_id !== userData.id) {
                toast.error('Anda tidak ditugaskan untuk jadwal ini.')
                router.push('/therapist/dashboard')
                return
            }

            // Check if treatment_record already exists
            const { data: existingRecord } = await supabase
                .from('treatment_records')
                .select('id')
                .eq('appointment_id', aptData.id)
                .maybeSingle()

            if (existingRecord) {
                toast('Treatment sudah diinput sebelumnya.')
                router.push(`/treatment-records/${existingRecord.id}`)
                return
            }

            setAppointment(aptData)
            
            // Pre-fill complaints from appointment notes
            setFormData(prev => ({
                ...prev,
                complaints: aptData.notes || ''
            }))
        } else {
            toast.error('Jadwal tidak ditemukan')
            router.push('/therapist/dashboard')
        }

        // Fetch Treatments Master
        const { data: trData } = await supabase.from('treatments').select('*').eq('is_active', true).order('name')
        if (trData) setTreatmentsMaster(trData)
        
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

    const handleAddTreatment = (treatmentId, couponItem = null) => {
        if (!treatmentId) return
        const t = treatmentsMaster.find(x => x.id === treatmentId)
        if (!t) return
        if (selectedTreatments.some(x => x.treatment_id === t.id)) return

        const discountVal = t.discount_percent || 0
        const originalPrice = t.price || 0
        const priceAtTime = couponItem ? 0 : (discountVal > 0 ? originalPrice * (1 - discountVal / 100) : originalPrice)

        setSelectedTreatments(prev => [
            ...prev,
            {
                treatment_id: t.id,
                name: t.name,
                price_at_time: Math.round(priceAtTime),
                original_price: originalPrice,
                discount_percent: couponItem ? 0 : discountVal,
                followup_days: t.followup_days || 0,
                notes: couponItem ? `(Pakai Kupon: ${couponItem.patient_coupons?.coupon_packages?.name})` : '',
                used_coupon_item_id: couponItem ? couponItem.id : null,
                used_patient_coupon_id: couponItem ? couponItem.patient_coupon_id : null,
                commission_percent: t.commission_percent || 0
            }
        ])
    }

    const handleRemoveTreatment = (treatmentId) => {
        setSelectedTreatments(prev => prev.filter(x => x.treatment_id !== treatmentId))
    }

    const uploadPhotoSlot = async (file, slotKey, patientId, recordId) => {
        const ext = file.name.split('.').pop() || 'jpg'
        const filePath = `${patientId}/${recordId}/${slotKey}.${ext}`
        const { error: uploadErr } = await supabase.storage
            .from('patient-photos')
            .upload(filePath, file, { upsert: true })
        if (uploadErr) throw new Error(`Gagal mengunggah foto ${slotKey}: ${uploadErr.message}`)
        return {
            patient_id: patientId,
            treatment_record_id: recordId,
            photo_type: 'treatment',
            storage_path: filePath,
            caption: slotKey
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        
        if (selectedTreatments.length === 0) {
            toast.error('Pilih minimal 1 treatment yang dilakukan.')
            return
        }
        if (!formData.result_notes) {
            toast.error('Asesmen (Tindakan & Hasil) wajib diisi.')
            return
        }

        setSaving(true)

        try {
            // 1. Insert Treatment Record
            const { data: recordData, error: recordError } = await supabase
                .from('treatment_records')
                .insert([{
                    patient_id: appointment.patient_id,
                    appointment_id: appointment.id,
                    branch_id: appointment.branch_id,
                    performed_by: dbUser.id,
                    treatment_date: new Date().toISOString().split('T')[0],
                    treatment_time: new Date().toTimeString().substring(0, 5),
                    skin_condition: formData.skin_condition,
                    complaints: formData.complaints,
                    result_notes: formData.result_notes,
                    recommendation: formData.recommendation,
                    created_by: dbUser.id
                }])
                .select('id')
                .single()

            if (recordError) throw recordError
            const recordId = recordData.id

            // 2. Insert Treatment Record Items + Followup Queue + Coupon Logs
            const itemsToInsert = []
            const queuesToInsert = []
            const couponLogsToInsert = []
            const couponsToUpdate = []

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

                if (t.used_coupon_item_id) {
                    couponLogsToInsert.push({
                        patient_coupon_item_id: t.used_coupon_item_id,
                        patient_id: appointment.patient_id,
                        treatment_record_id: recordId,
                        branch_id: appointment.branch_id,
                        used_by: dbUser.id,
                        notes: 'Dipakai pada ' + new Date().toLocaleDateString('id-ID')
                    })
                    couponsToUpdate.push(t.used_coupon_item_id)
                }

                // Auto-schedule follow-up bertahap: 3 minggu & 1 bulan
                const followupSteps = [
                    { days: 21, type: 'followup_3minggu', priority: 'normal' },
                    { days: 30, type: 'followup_1bulan', priority: 'normal' }
                ]
                followupSteps.forEach(step => {
                    const scheduledDate = new Date()
                    scheduledDate.setDate(scheduledDate.getDate() + step.days)
                    queuesToInsert.push({
                        patient_id: appointment.patient_id,
                        treatment_record_id: recordId,
                        branch_id: appointment.branch_id,
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
                await supabase.from('followup_queue').insert(queuesToInsert)
            }

            if (couponLogsToInsert.length > 0) {
                await supabase.from('coupon_usage_logs').insert(couponLogsToInsert)
                for (const itemId of couponsToUpdate) {
                    const { data: itemData } = await supabase.from('patient_coupon_items')
                        .select('used_sessions, remaining_sessions, patient_coupon_id')
                        .eq('id', itemId).single()
                    if (itemData) {
                        const newUsed = itemData.used_sessions + 1
                        const newRemaining = itemData.remaining_sessions - 1
                        const status = newRemaining <= 0 ? 'fully_used' : 'active'
                        await supabase.from('patient_coupon_items')
                            .update({ used_sessions: newUsed, remaining_sessions: newRemaining, status })
                            .eq('id', itemId)
                    }
                }
            }

            // 3. Upload Photos
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']
            const photosToInsert = []
            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    const meta = await uploadPhotoSlot(photoFiles[slot], slot, appointment.patient_id, recordId)
                    photosToInsert.push(meta)
                }
            }
            if (photosToInsert.length > 0) {
                await supabase.from('patient_photos').insert(photosToInsert)
            }

            // 4. Update Appointment Status to completed
            await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', appointment.id)

            // 4.5 Send notifications to admins of the branch and owners
            const { data: allActiveUsers } = await supabase
                .from('users')
                .select('id, role, branch_id')
                .eq('is_active', true)

            const recipients = allActiveUsers?.filter(u => 
                u.role === 'admin' && u.branch_id === appointment.branch_id
            ) || []

            if (recipients.length > 0) {
                const notificationsToInsert = recipients.map(recipient => ({
                    recipient_id: recipient.id,
                    sender_id: dbUser.id,
                    appointment_id: appointment.id,
                    type: 'treatment_completed',
                    title: 'Treatment Selesai',
                    message: `${appointment.patients?.full_name} telah selesai treatment. Silakan klik untuk memproses pembayaran di Kasir POS.`
                }))
                await supabase.from('notifications').insert(notificationsToInsert)
            }

            toast.success('Treatment & SOAP berhasil disimpan! Kasir dapat memproses pembayaran.')
            router.push('/therapist/dashboard')
            
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
            <div className="card-ayumi p-5 grid grid-cols-2 md:grid-cols-4 gap-4 bg-gradient-to-br from-pink-50 to-white border-pink-100">
                <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Pasien</div>
                    <div className="text-base font-bold text-ayumi-text">{appointment.patients?.full_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{appointment.patients?.whatsapp}</div>
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

                {/* ─── SECTION 1: CATATAN SOAP ─── */}
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
                                Objektif (Kondisi Kulit)
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

                {/* ─── SECTION 2: PILIH TREATMENT ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-4">
                    <div className="flex justify-between items-center border-b pb-3">
                        <h2 className="text-lg font-bold text-ayumi-primary flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            Tindakan Treatment *
                        </h2>
                        <div className="flex items-center gap-2">
                            {patientCoupons.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setIsCouponModalOpen(true)}
                                    className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-bold rounded-xl px-3 py-2 text-xs shadow-md flex items-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                                    Kupon ({patientCoupons.length})
                                </button>
                            )}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsTreatmentDropdownOpen(!isTreatmentDropdownOpen)}
                                    className="border-2 border-pink-200 text-ayumi-primary font-bold rounded-xl px-4 py-2 text-sm bg-pink-50 hover:bg-pink-100 transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                    Tambah Treatment
                                </button>
                                {isTreatmentDropdownOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setIsTreatmentDropdownOpen(false)} />
                                        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white border border-pink-100 rounded-2xl shadow-2xl z-50 p-3 space-y-2">
                                            <div className="relative">
                                                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                <input
                                                    type="text"
                                                    placeholder="Cari treatment..."
                                                    value={treatmentSearch}
                                                    onChange={(e) => setTreatmentSearch(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-ayumi-primary bg-gray-50"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                                                {treatmentsMaster
                                                    .filter(t => t.name.toLowerCase().includes(treatmentSearch.toLowerCase()))
                                                    .map(t => {
                                                        const isSelected = selectedTreatments.some(x => x.treatment_id === t.id)
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
                        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
                            <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            <p className="text-gray-400 font-medium text-sm">Belum ada treatment dipilih</p>
                            <p className="text-gray-300 text-xs mt-1">Klik tombol "Tambah Treatment" di atas</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {selectedTreatments.map((item, idx) => (
                                <div key={item.treatment_id} className="flex items-center justify-between bg-pink-50 p-3.5 rounded-xl border border-pink-100">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-ayumi-primary/10 rounded-full flex items-center justify-center text-ayumi-primary font-bold text-sm">
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <div className="font-bold text-ayumi-secondary text-sm">{item.name}</div>
                                            {item.notes && <div className="text-xs text-purple-600 font-medium mt-0.5">{item.notes}</div>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTreatment(item.treatment_id)}
                                            className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>



                {/* ─── SECTION 3: FOTO DOKUMENTASI ─── */}
                <div className="card-ayumi p-4 md:p-6 space-y-4">
                    <h2 className="text-lg font-bold text-ayumi-secondary border-b pb-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        Foto Dokumentasi <span className="text-gray-400 font-normal text-sm ml-1">(Opsional)</span>
                    </h2>
                    <div className="grid grid-cols-3 gap-4">
                        {[
                            { key: 'foto_depan', label: 'Depan' },
                            { key: 'foto_kiri', label: 'Kiri' },
                            { key: 'foto_kanan', label: 'Kanan' }
                        ].map(slot => (
                            <div key={slot.key} className="relative border-2 border-dashed border-gray-200 rounded-2xl flex flex-col justify-center items-center min-h-[140px] bg-gray-50 hover:bg-white transition-colors overflow-hidden">
                                {photoPreviews[slot.key] ? (
                                    <div className="w-full relative group">
                                        <img src={photoPreviews[slot.key]} alt={slot.label} className="w-full h-36 object-cover rounded-xl" />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPhotoFiles(prev => ({ ...prev, [slot.key]: null }))
                                                setPhotoPreviews(prev => ({ ...prev, [slot.key]: null }))
                                            }}
                                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-md"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-1.5 p-3">
                                        <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        <span className="text-xs font-bold text-gray-400">{slot.label}</span>
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

            {/* Modal Pilih Kupon */}
            {isCouponModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-4 md:p-6 w-full max-w-lg shadow-xl">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="text-xl font-bold text-ayumi-secondary">Pilih Kupon Pasien</h3>
                            <button type="button" onClick={() => setIsCouponModalOpen(false)} className="text-gray-400 hover:text-red-500 p-1">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                            {patientCoupons.map(couponItem => {
                                const isSelected = selectedTreatments.some(x => x.used_coupon_item_id === couponItem.id)
                                return (
                                    <div key={couponItem.id} className={`border rounded-2xl p-4 flex justify-between items-center transition-colors ${isSelected ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-pink-200 bg-pink-50/30'}`}>
                                        <div>
                                            <div className="text-xs font-bold text-gray-500 mb-0.5">{couponItem.patient_coupons?.coupon_packages?.name}</div>
                                            <div className="font-bold text-ayumi-secondary">{couponItem.treatments?.name}</div>
                                            <div className="text-xs  font-bold text-ayumi-primary mt-1">Sisa Kuota: {couponItem.remaining_sessions}x</div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={isSelected}
                                            onClick={() => {
                                                handleAddTreatment(couponItem.treatment_id, couponItem)
                                                setIsCouponModalOpen(false)
                                            }}
                                            className="bg-ayumi-primary hover:bg-ayumi-secondary text-white font-bold px-4 py-2 rounded-xl text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                                        >
                                            {isSelected ? 'Terpilih' : 'Gunakan'}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
