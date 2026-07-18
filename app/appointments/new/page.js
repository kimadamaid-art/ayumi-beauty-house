'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'

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
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState('')

    // Data lists
    const [patients, setPatients] = useState([])
    const [branches, setBranches] = useState([])
    const [therapists, setTherapists] = useState([])
    const [isOwner, setIsOwner] = useState(false)
    const [patientSearch, setPatientSearch] = useState('')

    const [formData, setFormData] = useState({
        patient_id: '',
        branch_id: '',
        appointment_date: searchParams.get('date') || '',
        start_time: searchParams.get('time') || '08:00',
        end_time: '10:00',
        therapist_id: '',
        notes: ''
    })

    useEffect(() => {
        const localDate = new Date()
        const offset = localDate.getTimezoneOffset()
        const localISO = new Date(localDate.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0]
        setFormData(prev => ({
            ...prev,
            appointment_date: searchParams.get('date') || localISO
        }))
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        let userBranchId = null
        let ownerFlag = false

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData?.role === 'owner') {
                ownerFlag = true
                setIsOwner(true)
            } else {
                userBranchId = userData?.branch_id
            }
        }

        // Fetch Patients
        const { data: ptData } = await supabase.from('patients').select('id, full_name, whatsapp')
        if (ptData) setPatients(ptData)

        // Fetch Branches
        let brQuery = supabase.from('branches').select('id, name').eq('is_active', true)
        if (!ownerFlag && userBranchId) {
            brQuery = brQuery.eq('id', userBranchId)
        }
        const { data: brData } = await brQuery
        if (brData && brData.length > 0) {
            setBranches(brData)
            setFormData(prev => ({ ...prev, branch_id: brData[0].id }))
        }

        // Fetch Therapists
        const { data: trpData } = await supabase.from('users').select('id, full_name').eq('role', 'therapist').order('full_name')
        if (trpData) setTherapists(trpData)
    }

    // Filter patients based on search
    const filteredPatients = patients.filter(pt => {
        if (!patientSearch) return true
        const search = patientSearch.toLowerCase()
        return (
            (pt.full_name && pt.full_name.toLowerCase().includes(search)) ||
            (pt.whatsapp && pt.whatsapp.includes(search))
        )
    })

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
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

        setIsSaving(true)

        try {
            // Insert Appointment (tanpa treatment — treatment diisi oleh terapis saat sesi)
            const { error: aptErr } = await supabase
                .from('appointments')
                .insert([{
                    patient_id: formData.patient_id,
                    branch_id: formData.branch_id,
                    appointment_date: formData.appointment_date,
                    start_time: formData.start_time,
                    end_time: formData.end_time,
                    therapist_id: formData.therapist_id || null,
                    status: 'scheduled',
                    notes: formData.notes
                }])

            if (aptErr) throw aptErr

            toast.success('Jadwal temu berhasil dibuat!')
            router.push('/appointments')
            router.refresh()

        } catch (err) {
            console.error('Save error:', err)
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
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors">
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
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Cari Pasien *</label>
                    <input
                        type="text"
                        placeholder="Ketik nama atau WhatsApp..."
                        value={patientSearch}
                        onChange={(e) => {
                            setPatientSearch(e.target.value)
                            if (formData.patient_id) {
                                setFormData(prev => ({ ...prev, patient_id: '' }))
                            }
                        }}
                        className="input-ayumi bg-white mb-3"
                    />
                    {!formData.patient_id && (
                        <div className="max-h-48 overflow-y-auto bg-white rounded-xl border border-gray-100 shadow-sm">
                            {filteredPatients.length === 0 ? (
                                <div className="p-4 text-center text-sm text-gray-500">Pasien tidak ditemukan.</div>
                            ) : (
                                filteredPatients.slice(0, 50).map(pt => (
                                    <div 
                                        key={pt.id} 
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, patient_id: pt.id }))
                                            setPatientSearch(pt.full_name)
                                        }}
                                        className="p-3 border-b border-gray-50 cursor-pointer transition-colors hover:bg-pink-50/50"
                                    >
                                        <div className="font-bold text-gray-800 text-sm">{pt.full_name}</div>
                                        <div className="text-xs text-gray-500">{pt.whatsapp}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                    {formData.patient_id && (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                            <span className="text-sm font-bold text-green-700">{patientSearch}</span>
                            <button type="button" onClick={() => { setFormData(prev => ({ ...prev, patient_id: '' })); setPatientSearch('') }} className="ml-auto text-gray-400 hover:text-red-500">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
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
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Terapis (Opsional)</label>
                        <select
                            name="therapist_id"
                            value={formData.therapist_id}
                            onChange={handleChange}
                            className="input-ayumi focus:bg-white"
                        >
                            <option value="">-- Belum ditentukan --</option>
                            {therapists.map(t => (
                                <option key={t.id} value={t.id}>{t.full_name}</option>
                            ))}
                        </select>
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
                            className="px-8 py-3.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Batal
                        </button>
                    </Link>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="btn-primary px-8 py-3.5"
                    >
                        {isSaving ? 'Menyimpan...' : 'Simpan Jadwal'}
                    </button>
                </div>
            </form>
        </div>
    )
}
