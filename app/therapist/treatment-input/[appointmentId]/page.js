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
    const [therapistsList, setTherapistsList] = useState([])
    const [selectedPerformerId, setSelectedPerformerId] = useState('')

    // Treatment selection
    const [selectedTreatments, setSelectedTreatments] = useState([])
    const [treatmentSearch, setTreatmentSearch] = useState('')
    const [isTreatmentDropdownOpen, setIsTreatmentDropdownOpen] = useState(false)

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

        // Fetch Appointment
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`*, patients (id, full_name, gender, birth_date, allergies, notes), branches (name)`)
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
                // Pre-fill complaints from appointment notes
                setFormData(prev => ({
                    ...prev,
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
                followup_days: t.followup_days || 0,
                notes: '',
                commission_percent: t.commission_percent || 0
            }
        ])
    }

    const handleRemoveTreatment = (treatmentId) => {
        setSelectedTreatments(prev => prev.filter(x => x.treatment_id !== treatmentId))
    }

    const uploadPhotoSlot = async (file, slotKey, patientId, recordId) => {
        const safePatientId = patientId || appointment?.patient_id || appointment?.patients?.id || 'patient'
        const safeRecordId = recordId || 'record'
        
        // Automatic client-side compression (WebP 1600px q80)
        let uploadFile = file
        try {
            uploadFile = await compressImageForMedical(file, 1600, 0.8)
        } catch (compErr) {
            console.warn('Compression fallback to original file:', compErr)
        }

        const ext = (uploadFile.name && uploadFile.name.split('.').pop()) || 'webp'
        const filePath = `${safePatientId}/${safeRecordId}/${slotKey}.${ext}`
        
        const { error: uploadErr } = await supabase.storage
            .from('patient-photos')
            .upload(filePath, uploadFile, { upsert: true })

        if (uploadErr) {
            console.error(`Gagal upload foto ${slotKey}:`, uploadErr)
            throw new Error(`Gagal mengunggah foto ${slotKey}: ${uploadErr.message}`)
        }

        return {
            patient_id: safePatientId !== 'patient' ? safePatientId : null,
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
        const performer = dbUser.role === 'therapist' ? dbUser.id : (selectedPerformerId || appointment.therapist_id || null)

        if (dbUser.role !== 'therapist' && !performer) {
            toast.error('Silakan pilih terapis yang menangani tindakan terlebih dahulu.')
            return
        }

        setSaving(true)

        try {
            let recordId = existingRecordId

            if (existingRecordId) {
                // Update existing record
                const { error: updateError } = await supabase
                    .from('treatment_records')
                    .update({
                        patient_id: appointment.patient_id || appointment.patients?.id || null,
                        performed_by: performer,
                        skin_condition: formData.skin_condition,
                        complaints: formData.complaints,
                        result_notes: formData.result_notes,
                        recommendation: formData.recommendation,
                        updated_by: dbUser.id
                    })
                    .eq('id', existingRecordId)

                if (updateError) throw updateError

                // Clear old items to re-insert fresh list
                await supabase.from('treatment_record_items').delete().eq('treatment_record_id', existingRecordId)
            } else {
                // Insert new Treatment Record
                const { data: recordData, error: recordError } = await supabase
                    .from('treatment_records')
                    .insert([{
                        patient_id: appointment.patient_id || appointment.patients?.id || null,
                        appointment_id: appointment.id,
                        branch_id: appointment.branch_id,
                        performed_by: performer,
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
                recordId = recordData.id
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

            // 3. Upload Photos
            const photoSlots = ['foto_depan', 'foto_kiri', 'foto_kanan']
            const photosToInsert = []
            const targetPatientId = appointment?.patient_id || appointment?.patients?.id || null

            for (const slot of photoSlots) {
                if (photoFiles[slot]) {
                    try {
                        const meta = await uploadPhotoSlot(photoFiles[slot], slot, targetPatientId, recordId)
                        photosToInsert.push(meta)
                    } catch (photoErr) {
                        console.error(`Gagal upload foto ${slot}:`, photoErr)
                        toast.error(`Peringatan: ${photoErr.message}`)
                    }
                }
            }

            if (photosToInsert.length > 0) {
                for (const p of photosToInsert) {
                    await supabase.from('patient_photos').delete().eq('treatment_record_id', recordId).eq('caption', p.caption)
                }
                const { error: insertPhotoErr } = await supabase.from('patient_photos').insert(photosToInsert)
                if (insertPhotoErr) {
                    console.error('Error inserting patient_photos meta:', insertPhotoErr)
                }
            }

            // 4. Update Appointment Status to completed
            await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', appointment.id)

            // 4.5 Send notifications to admins of the branch (excluding owner)
            const { data: allActiveUsers } = await supabase
                .from('users')
                .select('id, role, branch_id')
                .eq('role', 'admin')
                .eq('is_active', true)

            const recipients = allActiveUsers?.filter(u => 
                u.id !== dbUser.id && (!u.branch_id || u.branch_id === appointment.branch_id)
            ) || []

            if (recipients.length > 0) {
                const performerName = dbUser.role === 'therapist' ? `Terapis ${dbUser.full_name}` : `${dbUser.full_name} (${dbUser.role})`
                const notificationsToInsert = recipients.map(recipient => ({
                    recipient_id: recipient.id,
                    sender_id: dbUser.id,
                    appointment_id: appointment.id,
                    type: 'treatment_completed',
                    title: 'Treatment Selesai 💳',
                    message: `${performerName} telah menyelesaikan input treatment untuk ${appointment.patients?.full_name || ''}. Silakan proses pembayaran di Kasir POS.`
                }))
                await supabase.from('notifications').insert(notificationsToInsert)
            }

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
                            <div key={slot.key} className="relative border-2 border-dashed border-gray-200 rounded-2xl flex flex-col justify-center items-center min-h-[180px] bg-gray-50/70 hover:bg-white transition-all p-3">
                                {photoPreviews[slot.key] ? (
                                    <div className="w-full relative group">
                                        <img src={photoPreviews[slot.key]} alt={slot.label} className="w-full h-36 object-cover rounded-xl shadow-xs" />
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
