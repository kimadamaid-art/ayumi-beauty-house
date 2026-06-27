'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

function AddRecordForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const urlPatientId = searchParams.get('patientId')
    const urlAppointmentId = searchParams.get('appointmentId')
    const urlTransactionId = searchParams.get('transactionId')

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

    // Form State
    const [formData, setFormData] = useState({
        patient_id: urlPatientId || '',
        branch_id: '',
        performed_by: '',
        treatment_date: new Date().toISOString().split('T')[0],
        treatment_time: new Date().toTimeString().substring(0, 5),
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

    // Patient Coupons
    const [patientCoupons, setPatientCoupons] = useState([])
    const [isCouponModalOpen, setIsCouponModalOpen] = useState(false)

    useEffect(() => {
        const checkAccessAndFetchData = async () => {
            setIsCheckingAccess(true)
            
            // 1. Get current logged in user
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }

            // 2. Verify user role is not therapist (only admin/owner can access)
            const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
            if (userData?.role === 'therapist') {
                toast.error('Terapis tidak diizinkan mengakses halaman input rekam medis.')
                router.push('/therapist/dashboard')
                return
            }

            setIsCheckingAccess(false)

            // 3. Fetch Master Data
            const { data: pts } = await supabase.from('patients').select('id, full_name, whatsapp')
            if (pts) setPatients(pts)

            const { data: usrs } = await supabase.from('users').select('id, full_name, role')
            if (usrs) setProviders(usrs)

            const { data: trts } = await supabase.from('treatments').select('*').eq('is_active', true)
            if (trts) setTreatmentsMaster(trts)

            const { data: brs } = await supabase.from('branches').select('id, name')
            if (brs && brs.length > 0) {
                setBranches(brs)
                setFormData(prev => ({
                    ...prev,
                    branch_id: prev.branch_id || brs[0].id
                }))
            }

            // 4. Check if linked to appointment or transaction
            if (urlTransactionId) {
                const { data: trx } = await supabase
                    .from('transactions')
                    .select('*, transaction_items(*)')
                    .eq('id', urlTransactionId)
                    .single()

                if (trx) {
                    setFormData(prev => ({
                        ...prev,
                        patient_id: trx.patient_id,
                        branch_id: trx.branch_id
                    }))

                    // Prefill treatments from transaction
                    const trxTreatments = trx.transaction_items?.filter(item => item.item_type === 'treatment') || []
                    if (trxTreatments.length > 0) {
                        // Look up commission from master treatments
                        const { data: masterTreatments } = await supabase.from('treatments').select('id, commission_percent').in('id', trxTreatments.map(i => i.treatment_id))
                        const commissionMap = {}
                        if (masterTreatments) masterTreatments.forEach(mt => { commissionMap[mt.id] = mt.commission_percent || 0 })

                        setSelectedTreatments(trxTreatments.map(item => {
                            const originalPrice = item.subtotal / item.quantity
                            return {
                                treatment_id: item.treatment_id,
                                name: item.name,
                                price_at_time: originalPrice,
                                original_price: originalPrice,
                                discount_percent: 0,
                                notes: '',
                                followup_days: 0,
                                commission_percent: commissionMap[item.treatment_id] || 0
                            }
                        }))
                    }
                }
            } else if (urlAppointmentId) {
                const { data: apt } = await supabase
                    .from('appointments')
                    .select('*')
                    .eq('id', urlAppointmentId)
                    .single()

                if (apt) {
                    setFormData(prev => ({
                        ...prev,
                        patient_id: apt.patient_id,
                        branch_id: apt.branch_id,
                        treatment_date: apt.appointment_date,
                        treatment_time: apt.start_time.substring(0, 5),
                        performed_by: apt.therapist_id || ''
                    }))

                    // Prefill treatments from appointment if any exist
                    const { data: aptTreatments } = await supabase
                        .from('appointment_treatments')
                        .select('treatment_id, treatments(name, price, discount_percent, commission_percent)')
                        .eq('appointment_id', urlAppointmentId)
                        .order('sort_order')

                    if (aptTreatments && aptTreatments.length > 0) {
                        setSelectedTreatments(aptTreatments.map(at => {
                            const t = at.treatments
                            const discountVal = t?.discount_percent || 0
                            const discountedPrice = discountVal > 0 ? t.price * (1 - discountVal / 100) : (t?.price || 0)
                            return {
                                treatment_id: at.treatment_id,
                                name: t?.name || '',
                                price_at_time: discountedPrice,
                                original_price: t?.price || 0,
                                discount_percent: discountVal,
                                notes: '',
                                followup_days: t?.followup_days || 0,
                                commission_percent: t?.commission_percent || 0
                            }
                        }))
                    }
                }
            } else if (urlPatientId) {
                setFormData(prev => ({ ...prev, patient_id: urlPatientId }))
            }
        }
        checkAccessAndFetchData()
    }, [supabase, urlPatientId, urlAppointmentId, urlTransactionId, router])

    // Effect to fetch patient coupons whenever patient_id changes
    useEffect(() => {
        const fetchCoupons = async () => {
            if (!formData.patient_id) {
                setPatientCoupons([])
                return
            }

            const { data } = await supabase
                .from('patient_coupon_items')
                .select(`
                    id, patient_coupon_id, treatment_id, total_sessions, used_sessions, remaining_sessions, status,
                    treatments(name),
                    patient_coupons(status, coupon_packages(name))
                `)
                .eq('status', 'active')
            
            // Filter in JS since we can't easily filter by nested table in supabase JS client directly sometimes
            if (data) {
                // Find coupons belonging to this patient and where parent is active
                const { data: pcData } = await supabase
                    .from('patient_coupons')
                    .select('id')
                    .eq('patient_id', formData.patient_id)
                    .eq('status', 'active')

                const activeCouponIds = pcData?.map(pc => pc.id) || []
                
                const validItems = data.filter(item => activeCouponIds.includes(item.patient_coupon_id) && item.remaining_sessions > 0)
                setPatientCoupons(validItems)
            }
        }
        fetchCoupons()
    }, [formData.patient_id, supabase])

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const handleFileChange = (slot, file) => {
        if (!file) return

        // Validate formats
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
        if (!allowedTypes.includes(file.type)) {
            toast.error('Format foto wajib JPG, PNG, atau WEBP.')
            return
        }

        // Validate size (max 5MB)
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
                original_price: couponItem ? 0 : originalPrice,
                discount_percent: couponItem ? 0 : discountVal,
                notes: couponItem ? `(Pakai Kupon: ${couponItem.patient_coupons?.coupon_packages?.name})` : '',
                followup_days: t.followup_days || 0,
                used_coupon_item_id: couponItem ? couponItem.id : null,
                used_patient_coupon_id: couponItem ? couponItem.patient_coupon_id : null,
                commission_percent: t.commission_percent || 0
            }
        ])
    }

    const handleRemoveTreatment = (id) => {
        setSelectedTreatments(prev => prev.filter(x => x.treatment_id !== id))
    }

    const handleTreatmentDiscountChange = (id, percent) => {
        const pct = Math.min(100, Math.max(0, Number(percent) || 0))
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === id) {
                const newPrice = x.original_price * (1 - pct / 100);
                return { ...x, discount_percent: pct, price_at_time: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleTreatmentDiscountNominalChange = (id, nominalStr) => {
        const nominal = Math.max(0, Number(nominalStr) || 0)
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === id) {
                const checkedNominal = Math.min(x.original_price, nominal)
                const pct = x.original_price > 0 ? Math.round((checkedNominal / x.original_price) * 100) : 0
                const newPrice = x.original_price - checkedNominal
                return { ...x, discount_percent: Math.min(100, pct), price_at_time: Math.round(newPrice) };
            }
            return x;
        }))
    }

    const handleTreatmentPriceChange = (id, newPrice) => {
        const price = Number(newPrice) || 0
        setSelectedTreatments(prev => prev.map(x => {
            if (x.treatment_id === id) {
                const pct = x.original_price > 0 ? Math.round(((x.original_price - price) / x.original_price) * 100) : 0
                return { ...x, price_at_time: price, discount_percent: Math.min(100, Math.max(0, pct)) }
            }
            return x
        }))
    }

    const uploadPhotoSlot = async (file, slotKey, patientId, recordId) => {
        const ext = file.name.split('.').pop() || 'jpg'
        const filePath = `${patientId}/${recordId}/${slotKey}.${ext}`

        // Upload to bucket: patient-photos
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
            // Get current logged in user
            const { data: { user } } = await supabase.auth.getUser()
            const currentUserId = user?.id || null

            // 1. Insert Treatment Record
            // Save single Notes field to result_notes column, others saved as empty strings/null
            const { data: recordData, error: recordErr } = await supabase
                .from('treatment_records')
                .insert([{
                    patient_id: formData.patient_id,
                    appointment_id: urlAppointmentId || null,
                    branch_id: formData.branch_id,
                    performed_by: formData.performed_by || null,
                    treatment_date: formData.treatment_date,
                    treatment_time: formData.treatment_time,
                    skin_condition: formData.skin_condition,
                    complaints: formData.complaints,
                    result_notes: formData.result_notes,
                    recommendation: formData.recommendation,
                    created_by: currentUserId
                }])
                .select('id')
                .single()

            if (recordErr) throw recordErr
            const recordId = recordData.id

            // If it came from a transaction, link them
            if (urlTransactionId) {
                await supabase
                    .from('transactions')
                    .update({ treatment_record_id: recordId })
                    .eq('id', urlTransactionId)
            }

            // 2. Insert Record Items & Followup Queue & Coupon Logs
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
                        patient_id: formData.patient_id,
                        treatment_record_id: recordId,
                        branch_id: formData.branch_id,
                        used_by: currentUserId,
                        notes: 'Dipakai pada ' + new Date().toLocaleDateString('id-ID')
                    })
                    couponsToUpdate.push(t.used_coupon_item_id)
                }

                if (t.followup_days > 0) {
                    const scheduledDate = new Date(formData.treatment_date)
                    scheduledDate.setDate(scheduledDate.getDate() + t.followup_days)
                    
                    queuesToInsert.push({
                        patient_id: formData.patient_id,
                        treatment_record_id: recordId,
                        branch_id: formData.branch_id,
                        assigned_to: formData.performed_by || null,
                        followup_type: 'treatment_reminder',
                        scheduled_date: scheduledDate.toISOString().split('T')[0],
                        priority: 'normal',
                        status: 'pending'
                    })
                }
            })

            const { error: itemsErr } = await supabase.from('treatment_record_items').insert(itemsToInsert)
            if (itemsErr) throw itemsErr

            if (queuesToInsert.length > 0) {
                const { error: queueErr } = await supabase.from('followup_queue').insert(queuesToInsert)
                if (queueErr) throw queueErr
            }

            if (couponLogsToInsert.length > 0) {
                const { error: logErr } = await supabase.from('coupon_usage_logs').insert(couponLogsToInsert)
                if (logErr) throw logErr

                // Update patient_coupon_items sessions (Simplified logic: we'll call an RPC later or do it in JS, but here we do it sequentially since it's just a few)
                for (const itemId of couponsToUpdate) {
                    const { data: itemData } = await supabase.from('patient_coupon_items').select('used_sessions, remaining_sessions, total_sessions, patient_coupon_id').eq('id', itemId).single()
                    if (itemData) {
                        const newUsed = itemData.used_sessions + 1
                        const newRemaining = itemData.remaining_sessions - 1
                        const status = newRemaining <= 0 ? 'fully_used' : 'active'
                        
                        await supabase.from('patient_coupon_items')
                            .update({ used_sessions: newUsed, remaining_sessions: newRemaining, status })
                            .eq('id', itemId)
                        
                        // Check if all items in parent coupon are fully used
                        if (status === 'fully_used') {
                            const { data: siblings } = await supabase.from('patient_coupon_items').select('status').eq('patient_coupon_id', itemData.patient_coupon_id)
                            if (siblings && siblings.every(s => s.status === 'fully_used')) {
                                await supabase.from('patient_coupons').update({ status: 'fully_used' }).eq('id', itemData.patient_coupon_id)
                            }
                        }
                    }
                }
            }

            // 3. Upload Photos to Storage & Save Meta if present
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']
            const photosToInsert = []
            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    const meta = await uploadPhotoSlot(photoFiles[slot], slot, formData.patient_id, recordId)
                    photosToInsert.push(meta)
                }
            }

            if (photosToInsert.length > 0) {
                const { error: photoErr } = await supabase.from('patient_photos').insert(photosToInsert)
                if (photoErr) throw photoErr
            }

            toast.success('Rekam medis berhasil disimpan!')
            router.push(`/treatment-records/${recordId}`)
            router.refresh()

        } catch (err) {
            console.error(err)
            setError('Gagal menyimpan rekam medis: ' + err.message)
            toast.error('Gagal menyimpan rekam medis: ' + err.message)
        } finally {
            setIsSaving(false)
        }
    }

    if (isCheckingAccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memeriksa akses...</p>
            </div>
        )
    }

    return (
        <>
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
                    <div className="card-ayumi p-6 space-y-4">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b pb-2">Data Kunjungan</h3>
                        
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Pilih Pasien *</label>
                            <select
                                name="patient_id"
                                value={formData.patient_id}
                                onChange={handleChange}
                                required
                                disabled={!!urlPatientId || !!urlAppointmentId}
                                className="input-ayumi bg-white disabled:opacity-75"
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
                                    readOnly={!!urlAppointmentId}
                                    className="input-ayumi bg-white read-only:bg-gray-100 read-only:text-gray-500"
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
                                    readOnly={!!urlAppointmentId}
                                    className="input-ayumi bg-white read-only:bg-gray-100 read-only:text-gray-500"
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
                                disabled={!!urlAppointmentId || !!urlTransactionId}
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
                    <div className="card-ayumi p-6 space-y-4">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b pb-2">Catatan Rekam Medis (SOAP)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Subjektif (Keluhan Pasien)</label>
                                <textarea
                                    name="complaints"
                                    value={formData.complaints}
                                    onChange={handleChange}
                                    rows="3"
                                    className="input-ayumi bg-white resize-none"
                                    placeholder="Keluhan utama pasien saat datang..."
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
                                    placeholder="Kondisi kulit fisik saat diperiksa..."
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
                                placeholder="Detail tindakan yang dilakukan dan hasil treatment..."
                            ></textarea>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Planning (Rekomendasi Treatment & Skincare)</label>
                            <textarea
                                name="recommendation"
                                value={formData.recommendation}
                                onChange={handleChange}
                                rows="3"
                                className="input-ayumi bg-white resize-none"
                                placeholder="Rencana treatment selanjutnya dan anjuran produk skincare homecare..."
                            ></textarea>
                        </div>
                    </div>

                    <div className="card-ayumi p-6 space-y-4">
                        <div className="flex justify-between items-center border-b pb-2 relative">
                            <h3 className="text-lg font-bold text-ayumi-primary">Tindakan Treatment</h3>
                            <div className="flex items-center gap-2 relative">
                                {patientCoupons.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setIsCouponModalOpen(true)}
                                        className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-bold rounded-xl px-4 py-2 text-sm shadow-md flex items-center gap-2"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                                        Pakai Kupon ({patientCoupons.length})
                                    </button>
                                )}
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
                                            <div className="relative">
                                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                </span>
                                                <input
                                                    type="text"
                                                    placeholder="Cari treatment atau produk..."
                                                    value={treatmentSearch}
                                                    onChange={(e) => setTreatmentSearch(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-ayumi-primary bg-gray-50/50 text-gray-700 font-semibold"
                                                    autoFocus
                                                />
                                            </div>
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
                                                                className={`w-full text-left px-3 py-2.5 my-0.5 rounded-xl transition-colors flex items-center justify-between text-xs md:text-sm cursor-pointer ${isSelected ? 'opacity-40 cursor-not-allowed bg-gray-50' : 'hover:bg-pink-50/50'}`}
                                                            >
                                                                <div className="flex-1 pr-3">
                                                                    <span className="font-bold text-ayumi-secondary block truncate">{t.name}</span>
                                                                </div>
                                                                <div className="text-right whitespace-nowrap font-bold text-gray-700">
                                                                    Rp {t.price?.toLocaleString('id-ID')}
                                                                </div>
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
                                            </div>
                                            
                                            {/* Discount Input (%) & Nominal (Rp) & Final Price Input (Rp) */}
                                            <div className="w-full md:w-auto flex flex-col xl:flex-row items-center gap-3">
                                                {/* Discount % Input */}
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

                                                {/* Discount Nominal Rp Input */}
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

                                                {/* Final Price Input */}
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
                    </div>                    {/* Foto Dokumentasi Section */}
                    <div className="card-ayumi p-6 space-y-6">
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

                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="btn-primary px-10 py-4 font-bold"
                        >
                            {isSaving ? 'Menyimpan & Mengunggah Foto...' : 'Simpan Rekam Medis'}
                        </button>
                    </div>
                </div>
            </div>
        </form>

        {/* Modal Pilih Kupon */}
        {isCouponModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-ayumi-secondary">Pilih Kupon Pasien</h3>
                        <button type="button" onClick={() => setIsCouponModalOpen(false)} className="text-gray-400 hover:text-red-500">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                        {patientCoupons.map(couponItem => {
                            const isSelected = selectedTreatments.some(x => x.used_coupon_item_id === couponItem.id)
                            return (
                                <div key={couponItem.id} className={`border rounded-2xl p-4 flex justify-between items-center transition-colors ${isSelected ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-pink-200 bg-pink-50/30'}`}>
                                    <div>
                                        <div className="text-xs font-bold text-gray-500 mb-1">{couponItem.patient_coupons?.coupon_packages?.name}</div>
                                        <div className="font-bold text-ayumi-secondary">{couponItem.treatments?.name}</div>
                                        <div className="text-xs font-mono font-bold text-ayumi-primary mt-1">Sisa Kuota: {couponItem.remaining_sessions}x</div>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={isSelected}
                                        onClick={() => {
                                            handleAddTreatment(couponItem.treatment_id, couponItem)
                                            setIsCouponModalOpen(false)
                                        }}
                                        className="bg-ayumi-primary hover:bg-ayumi-secondary text-white font-bold px-4 py-2 rounded-lg text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
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
        </>
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
                    <h2 className="text-xl font-bold text-ayumi-secondary">Tambah Rekam Medis</h2>
                    <p className="text-sm text-ayumi-text-muted">Catat tindakan treatment, hasil, dan komparasi foto dokumentasi.</p>
                </div>
            </div>
            
            <Suspense fallback={<div className="p-10 text-center text-pink-500 font-bold">Memuat Form...</div>}>
                <AddRecordForm />
            </Suspense>
        </div>
    )
}
