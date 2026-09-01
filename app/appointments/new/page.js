'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { usePatientSearch } from '@/hooks/usePatientSearch'
import { validatePatientData } from '@/lib/patientValidation'

export default function NewAppointmentPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div></div>}>
            <NewAppointmentForm />
        </Suspense>
    )
}

function NewAppointmentForm() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    // Data lists
    const [branches, setBranches] = useState([])
    const [therapists, setTherapists] = useState([])
    const [infusTreatments, setInfusTreatments] = useState([])
    const [selectedInfusTreatmentId, setSelectedInfusTreatmentId] = useState('')
    const [isOwner, setIsOwner] = useState(false)
    
    // Patient Search Hook (server-side, debounce 350ms, limit 20, sequence tracked)
    const {
        searchQuery: patientSearch,
        setSearchQuery: setPatientSearch,
        results: patientSearchResults,
        isSearching: isSearchingPatient,
        hasSearched: hasSearchedPatient,
        resetSearch: resetPatientSearch
    } = usePatientSearch({ debounceMs: 150, limit: 50 })

    // Quick Add Patient Modal State
    const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false)
    const [isSavingPatient, setIsSavingPatient] = useState(false)
    const [modalConflictPatient, setModalConflictPatient] = useState(null)
    const [newPatientData, setNewPatientData] = useState({
        full_name: '',
        whatsapp: '',
        gender: 'female',
        birth_date: '',
        branch_id: '',
        address: '',
        skin_type: 'normal',
        allergies: '',
        medical_notes: ''
    })

    const [formData, setFormData] = useState({
        patient_id: '',
        branch_id: '',
        appointment_date: searchParams.get('date') || '',
        start_time: searchParams.get('time') || '08:00',
        end_time: '10:00',
        therapist_id: '',
        notes: searchParams.get('notes') || ''
    })

    useEffect(() => {
        const localDate = new Date()
        const offset = localDate.getTimezoneOffset()
        const localISO = new Date(localDate.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0]
        setFormData(prev => ({
            ...prev,
            appointment_date: searchParams.get('date') || localISO,
            start_time: searchParams.get('time') || prev.start_time,
            notes: searchParams.get('notes') || prev.notes
        }))
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        let userBranchId = null
        let ownerFlag = false

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData?.role === 'therapist') {
                toast.error('Akses Ditolak: Penambahan jadwal hanya dapat dilakukan oleh Admin Cabang dan Owner.')
                router.push('/therapist/dashboard')
                return
            }
            if (userData?.role === 'owner') {
                ownerFlag = true
                setIsOwner(true)
            } else {
                userBranchId = userData?.branch_id
            }
        }

        // Fetch Branches
        let brQuery = supabase.from('branches').select('id, name').eq('is_active', true)
        if (!ownerFlag && userBranchId) {
            brQuery = brQuery.eq('id', userBranchId)
        }
        const { data: brData } = await brQuery
        if (brData && brData.length > 0) {
            setBranches(brData)
            setFormData(prev => ({ ...prev, branch_id: userBranchId || brData[0].id }))
            setNewPatientData(prev => ({ ...prev, branch_id: userBranchId || brData[0].id }))
        }

        // Fetch Therapists
        const { data: trpData } = await supabase.from('users').select('id, full_name, branch_id').eq('role', 'therapist').order('full_name')
        if (trpData) setTherapists(trpData)

        // Fetch Infus Treatments
        const { data: infData } = await supabase
            .from('treatments')
            .select('id, name, price')
            .ilike('name', '%infus%')
            .eq('is_active', true)
            .order('price', { ascending: true })
        if (infData) setInfusTreatments(infData)
    }

    // Open Modal with prefilled search name if available
    const openNewPatientModal = (initialName = '') => {
        setNewPatientData(prev => ({
            ...prev,
            full_name: initialName || (patientSearch && !formData.patient_id ? patientSearch : ''),
            branch_id: formData.branch_id || (branches[0]?.id || '')
        }))
        setIsNewPatientModalOpen(true)
    }

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const handleNewPatientChange = (e) => {
        const { name, value } = e.target
        setNewPatientData(prev => ({ ...prev, [name]: value }))
        if (modalConflictPatient) setModalConflictPatient(null)
    }

    // Save New Patient Modal
    const handleSaveNewPatient = async (e) => {
        e.preventDefault()
        setModalConflictPatient(null)

        // 1. Centralized Validation
        const { isValid, errors, cleanPayload } = validatePatientData({
            ...newPatientData,
            branch_id: newPatientData.branch_id || formData.branch_id || (branches[0]?.id || null)
        })

        if (!isValid) {
            const firstErr = Object.values(errors)[0]
            toast.error(firstErr)
            return
        }

        setIsSavingPatient(true)

        try {
            // 2. Check existing normalized WhatsApp
            const { data: existingPt } = await supabase
                .from('patients')
                .select('id, full_name, whatsapp, branch_id, branches(name)')
                .eq('whatsapp', cleanPayload.whatsapp)
                .maybeSingle()

            if (existingPt) {
                const { data: tr } = await supabase
                    .from('treatment_records')
                    .select('treatment_date')
                    .eq('patient_id', existingPt.id)
                    .order('treatment_date', { ascending: false })
                    .limit(1)

                setModalConflictPatient({
                    ...existingPt,
                    lastVisit: tr && tr.length > 0 ? tr[0].treatment_date : null
                })
                setIsSavingPatient(false)
                return
            }

            // 3. Insert into Supabase patients table with sanitized payload
            const { data: createdPatient, error: ptErr } = await supabase
                .from('patients')
                .insert([cleanPayload])
                .select('id, full_name, whatsapp')
                .single()

            if (ptErr) throw ptErr

            toast.success(`Pasien "${createdPatient.full_name}" berhasil didaftarkan!`)

            // Select the newly created patient
            setFormData(prev => ({
                ...prev,
                patient_id: createdPatient.id,
                branch_id: cleanPayload.branch_id || prev.branch_id
            }))
            setSelectedPatient(createdPatient)
            setPatientSearch(createdPatient.full_name)

            // Reset and close modal
            setNewPatientData({
                full_name: '',
                whatsapp: '',
                gender: 'female',
                birth_date: '',
                branch_id: formData.branch_id || (branches[0]?.id || ''),
                address: '',
                skin_type: 'normal',
                allergies: '',
                medical_notes: ''
            })
            setModalConflictPatient(null)
            setIsNewPatientModalOpen(false)

        } catch (err) {
            console.error('Error creating patient:', err)
            let msg = err.message
            if (msg.includes('unique constraint') || msg.includes('23505')) {
                msg = 'Nomor WhatsApp ini sudah terdaftar sebagai pasien'
            }
            toast.error('Gagal menambahkan pasien: ' + msg)
        } finally {
            setIsSavingPatient(false)
        }
    }

    // Auto calculate End Time (+2 hours) when start_time changes
    useEffect(() => {
        if (!formData.start_time) return
        const [hours, minutes] = formData.start_time.split(':').map(Number)
        const endHours = (hours + 2) % 24
        const formattedHours = String(endHours).padStart(2, '0')
        const formattedMins = String(minutes).padStart(2, '0')
        setFormData(prev => ({ ...prev, end_time: `${formattedHours}:${formattedMins}` }))
    }, [formData.start_time])

    const handleSave = async (e) => {
        e.preventDefault()
        setError('')
        
        if (!formData.patient_id) {
            toast.error('Silakan pilih pasien terlebih dahulu.')
            setError('Silakan pilih pasien terlebih dahulu.')
            return
        }

        if (!formData.branch_id) {
            toast.error('Silakan pilih cabang klinik terlebih dahulu.')
            setError('Silakan pilih cabang klinik terlebih dahulu.')
            return
        }

        setIsSaving(true)

        try {
            const isWorker = formData.therapist_id === 'worker'
            let finalNotes = formData.notes || ''
            if (isWorker && !finalNotes.includes('[INFUS - WORKER]')) {
                finalNotes = `[INFUS - WORKER] ${finalNotes}`.trim()
            }

            // Insert Appointment
            const { data: createdApt, error: aptErr } = await supabase
                .from('appointments')
                .insert([{
                    patient_id: formData.patient_id,
                    branch_id: formData.branch_id,
                    appointment_date: formData.appointment_date,
                    start_time: formData.start_time,
                    end_time: formData.end_time,
                    therapist_id: isWorker ? null : (formData.therapist_id || null),
                    status: 'scheduled',
                    notes: finalNotes || null
                }])
                .select('id')
                .single()

            if (aptErr) throw aptErr

            if (isWorker && selectedInfusTreatmentId && createdApt?.id) {
                await supabase.from('appointment_treatments').insert([{
                    appointment_id: createdApt.id,
                    treatment_id: selectedInfusTreatmentId
                }])
            }

            toast.success(isWorker ? 'Jadwal temu Infus (Worker) berhasil dibuat!' : 'Jadwal temu berhasil dibuat!')
            router.push('/appointments')
            router.refresh()

        } catch (err) {
            console.warn('Save error:', err)
            const friendlyMsg = getFriendlyErrorMessage(err)
            setError(friendlyMsg)
            toast.error(friendlyMsg)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/appointments">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors cursor-pointer">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <h2 className="text-xl font-bold text-ayumi-secondary">Buat Jadwal Temu</h2>
                    <p className="text-sm text-ayumi-text-muted mt-0.5">Isi formulir untuk membuat janji temu pasien. Pilihan treatment akan diisi oleh terapis saat sesi berlangsung.</p>
                </div>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-blue-700 font-medium">
                    <strong>Alur Baru:</strong> Cukup daftarkan pasien & jadwalnya di sini. Terapis akan memilih jenis treatment dan mengisi catatan SOAP saat pasien sudah di ruangan.
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="font-medium text-sm">{error}</span>
                </div>
            )}

            <form onSubmit={handleSave} className="card-ayumi p-5 md:p-8 space-y-6">
                <h3 className="text-lg font-bold text-ayumi-primary border-b border-pink-50 pb-3 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Informasi Jadwal
                </h3>

                {/* Cari Pasien */}
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-bold text-gray-700">
                            Cari / Pilih Pasien <span className="text-red-500">*</span>
                        </label>
                        <button
                            type="button"
                            onClick={() => openNewPatientModal(patientSearch)}
                            className="text-xs font-bold text-ayumi-primary hover:text-pink-700 bg-pink-50 hover:bg-pink-100 border border-pink-200 px-3 py-1.5 rounded-xl transition-all inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                        >
                            <span className="text-sm font-black">+</span> Pasien Baru
                        </button>
                    </div>

                    {!formData.patient_id ? (
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Ketik nama atau WhatsApp pasien..."
                                value={patientSearch}
                                onChange={(e) => setPatientSearch(e.target.value)}
                                className="input-ayumi bg-white mb-2 text-sm"
                            />

                            <div className="max-h-60 overflow-y-auto bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                                {patientSearch.trim().length < 2 ? (
                                    <div className="p-4 text-center text-xs text-gray-400">
                                        Ketik minimal 2 karakter untuk mencari pasien...
                                    </div>
                                ) : isSearchingPatient ? (
                                    <div className="p-4 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                                        <div className="w-3.5 h-3.5 border-2 border-ayumi-primary border-t-transparent rounded-full animate-spin"></div>
                                        <span>Mencari data pasien...</span>
                                    </div>
                                ) : patientSearchResults.length > 0 ? (
                                    patientSearchResults.map(pt => (
                                        <div 
                                            key={pt.id} 
                                            onClick={() => {
                                                setFormData(prev => ({ ...prev, patient_id: pt.id }))
                                                setPatientSearch(pt.full_name)
                                            }}
                                            className="p-3 cursor-pointer transition-colors hover:bg-pink-50/50 flex items-center justify-between group"
                                        >
                                            <div>
                                                <div className="font-bold text-gray-800 text-sm">{pt.full_name}</div>
                                                <div className="text-xs text-gray-500">{pt.whatsapp || 'No HP tidak ada'}</div>
                                            </div>
                                            <span className="text-[11px] font-bold text-ayumi-primary opacity-0 group-hover:opacity-100 transition-opacity">Pilih →</span>
                                        </div>
                                    ))
                                ) : !isSearchingPatient && hasSearchedPatient && patientSearchResults.length === 0 ? (
                                    <div className="p-4 text-center">
                                        <p className="text-sm text-gray-500 mb-2">Tidak ditemukan pasien dengan nama / WA "{patientSearch}".</p>
                                        <button 
                                            type="button" 
                                            onClick={() => openNewPatientModal(patientSearch)}
                                            className="text-xs font-bold text-ayumi-primary hover:text-pink-700 bg-pink-50 hover:bg-pink-100 border border-pink-200 px-4 py-2 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                        >
                                            <span className="text-sm font-black">+</span> Daftarkan "{patientSearch}" Sebagai Pasien Baru
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3.5 py-2.5 shadow-2xs">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                            <div>
                                <span className="text-xs font-bold text-green-800 uppercase tracking-wider block">Pasien Terpilih:</span>
                                <span className="text-sm font-extrabold text-green-900">{patientSearch}</span>
                            </div>
                            <button 
                                type="button" 
                                onClick={() => { setFormData(prev => ({ ...prev, patient_id: '' })); resetPatientSearch() }} 
                                className="ml-auto text-xs font-bold text-red-500 hover:text-red-700 bg-white/80 hover:bg-white px-2 py-1 rounded-md border border-red-200 transition-colors cursor-pointer"
                            >
                                Ganti Pasien
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {isOwner && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Cabang Klinik *</label>
                            <select
                                name="branch_id"
                                value={formData.branch_id}
                                onChange={handleChange}
                                required
                                className="input-ayumi focus:bg-white"
                            >
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Terapis / Pelaksana (Opsional)</label>
                        <select
                            name="therapist_id"
                            value={formData.therapist_id}
                            onChange={handleChange}
                            className="input-ayumi focus:bg-white"
                        >
                            <option value="">-- Belum ditentukan --</option>
                            <option value="worker">Worker (Sesi Infus)</option>
                            {therapists
                                .filter(t => !t.branch_id || !formData.branch_id || t.branch_id === formData.branch_id)
                                .map(t => (
                                    <option key={t.id} value={t.id}>{t.full_name}</option>
                                ))
                            }
                        </select>
                        {formData.therapist_id === 'worker' && (
                            <div className="mt-2 space-y-2">
                                <p className="text-[11px] text-emerald-700 font-bold bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                                    Sesi Infus oleh Worker bebas dari pengisian rekam medis SOAP terapis.
                                </p>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                        Pilih Paket / Jenis Infus (Opsional)
                                    </label>
                                    <select
                                        value={selectedInfusTreatmentId}
                                        onChange={(e) => setSelectedInfusTreatmentId(e.target.value)}
                                        className="input-ayumi focus:bg-white text-xs"
                                    >
                                        <option value="">-- Pilih Jenis Infus (Bisa ditentukan nanti saat selesai) --</option>
                                        {infusTreatments.map(t => (
                                            <option key={t.id} value={t.id}>
                                                {t.name} (Rp {Number(t.price || 0).toLocaleString('id-ID')})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Tanggal *</label>
                        <input
                            type="date"
                            name="appointment_date"
                            value={formData.appointment_date}
                            onChange={handleChange}
                            required
                            className="input-ayumi focus:bg-white"
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Slot Jam *</label>
                        <select
                            name="start_time"
                            value={formData.start_time}
                            onChange={handleChange}
                            required
                            className="input-ayumi focus:bg-white"
                        >
                            <option value="08:00">08:00</option>
                            <option value="09:00">09:00</option>
                            <option value="10:00">10:00</option>
                            <option value="11:00">11:00</option>
                            <option value="12:00">12:00</option>
                            <option value="13:00">13:00</option>
                            <option value="14:00">14:00</option>
                            <option value="15:00">15:00</option>
                            <option value="16:00">16:00</option>
                            <option value="17:00">17:00</option>
                            <option value="18:00">18:00</option>
                            <option value="19:00">19:00</option>
                            <option value="20:00">20:00</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Catatan Reservasi (Opsional)</label>
                    <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        rows="4"
                        className="input-ayumi focus:bg-white resize-none"
                        placeholder="Keluhan awal, permintaan khusus, dll..."
                    ></textarea>
                </div>

                <div className="border-t border-gray-100 pt-6 flex justify-end gap-4">
                    <Link href="/appointments">
                        <button
                            type="button"
                            className="px-8 py-3.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
                        >
                            Batal
                        </button>
                    </Link>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="btn-primary px-8 py-3.5 cursor-pointer shadow-md"
                    >
                        {isSaving ? 'Menyimpan...' : 'Simpan Jadwal'}
                    </button>
                </div>
            </form>

            {/* MODAL TAMBAH PASIEN BARU */}
            {isNewPatientModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-pink-100 max-h-[90vh] overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between pb-4 mb-5 border-b border-gray-100">
                            <div className="flex items-center gap-2.5">
                                <div className="w-10 h-10 rounded-2xl bg-pink-50 border border-pink-100 flex items-center justify-center text-ayumi-primary font-black">
                                    👤
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-800">Tambah Pasien Baru</h3>
                                    <p className="text-xs text-gray-500 font-medium">Daftarkan profil pasien baru ke database</p>
                                </div>
                            </div>
                            <button 
                                type="button" 
                                onClick={() => setIsNewPatientModalOpen(false)}
                                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold transition-colors cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal Form */}
                        <form onSubmit={handleSaveNewPatient} className="space-y-4">
                            {modalConflictPatient && (
                                <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl space-y-2 text-left animate-in fade-in duration-150">
                                    <div className="flex items-start gap-2.5">
                                        <span className="text-xl">⚠️</span>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-xs text-amber-900">Nomor WhatsApp Sudah Terdaftar</h4>
                                            <p className="text-xs text-amber-800 mt-0.5">
                                                Nomor <span className="font-mono font-bold bg-amber-100 px-1 py-0.5 rounded">{modalConflictPatient.whatsapp}</span> sudah terdaftar atas nama <strong>{modalConflictPatient.full_name}</strong> ({modalConflictPatient.branches?.name || 'Pusat'}).
                                                {modalConflictPatient.lastVisit ? ` Kunjungan terakhir: ${new Date(modalConflictPatient.lastVisit).toLocaleDateString('id-ID')}.` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 pt-2 border-t border-amber-200/80">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFormData(prev => ({
                                                    ...prev,
                                                    patient_id: modalConflictPatient.id,
                                                    branch_id: modalConflictPatient.branch_id || prev.branch_id
                                                }))
                                                setSelectedPatient(modalConflictPatient)
                                                setPatientSearch(modalConflictPatient.full_name)
                                                setModalConflictPatient(null)
                                                setIsNewPatientModalOpen(false)
                                            }}
                                            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2 px-3 rounded-xl transition-all shadow-sm cursor-pointer"
                                        >
                                            ✓ Pakai Pasien Ini Saja
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setModalConflictPatient(null)}
                                            className="bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold py-2 px-3 rounded-xl border border-amber-300 transition-all cursor-pointer"
                                        >
                                            Ganti Nomor
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                    Nama Lengkap Pasien <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    name="full_name"
                                    required
                                    placeholder="Contoh: Siti Rahmawati"
                                    value={newPatientData.full_name}
                                    onChange={handleNewPatientChange}
                                    className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                        Nomor WhatsApp <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="tel"
                                        name="whatsapp"
                                        required
                                        placeholder="08123456789"
                                        value={newPatientData.whatsapp}
                                        onChange={handleNewPatientChange}
                                        className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                        Jenis Kelamin
                                    </label>
                                    <select
                                        name="gender"
                                        value={newPatientData.gender}
                                        onChange={handleNewPatientChange}
                                        className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                    >
                                        <option value="female">Perempuan</option>
                                        <option value="male">Laki-laki</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                        Tanggal Lahir (Opsional)
                                    </label>
                                    <input
                                        type="date"
                                        name="birth_date"
                                        value={newPatientData.birth_date}
                                        onChange={handleNewPatientChange}
                                        className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                        Cabang Terdaftar
                                    </label>
                                    <select
                                        name="branch_id"
                                        value={newPatientData.branch_id}
                                        onChange={handleNewPatientChange}
                                        className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                    >
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                    Alamat (Opsional)
                                </label>
                                <input
                                    type="text"
                                    name="address"
                                    placeholder="Contoh: Jl. Ahmad Yani No. 12"
                                    value={newPatientData.address}
                                    onChange={handleNewPatientChange}
                                    className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                                    Riwayat Alergi / Catatan Medis (Opsional)
                                </label>
                                <input
                                    type="text"
                                    name="allergies"
                                    placeholder="Contoh: Alergi alkohol, kulit sensitif..."
                                    value={newPatientData.allergies}
                                    onChange={handleNewPatientChange}
                                    className="input-ayumi py-2.5 bg-gray-50/50 focus:bg-white text-sm"
                                />
                            </div>

                            {/* Actions */}
                            <div className="pt-4 mt-5 border-t border-gray-100 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsNewPatientModalOpen(false)}
                                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSavingPatient}
                                    className="btn-primary px-6 py-2.5 text-xs font-bold cursor-pointer shadow-pink-500/20 shadow-md flex items-center gap-1.5"
                                >
                                    {isSavingPatient ? (
                                        <>
                                            <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></div>
                                            <span>Menyimpan...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>💾 Simpan & Pilih Pasien</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
