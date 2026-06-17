'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

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
    const [isOwner, setIsOwner] = useState(false)
    const [patientSearch, setPatientSearch] = useState('')

    const [formData, setFormData] = useState({
        patient_id: '',
        branch_id: '',
        appointment_date: searchParams.get('date') || new Date().toISOString().split('T')[0],
        start_time: searchParams.get('time') || '08:00',
        end_time: '10:00',
        therapist_id: '',
        notes: ''
    })

    useEffect(() => {
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

        // Fetch Patients (Now fetching ALL patients, regardless of branch)
        let ptQuery = supabase.from('patients').select('id, full_name, whatsapp')
        const { data: ptData } = await ptQuery
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

    // Auto calculate End Time (+2 hours) when start_time changes, but allow manual edits
    // Only auto-update if end_time hasn't been manually tampered much, or just always auto-update when start_time changes
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
            // 1. Insert Appointment
            const { data: aptData, error: aptErr } = await supabase
                .from('appointments')
                .insert([{
                    patient_id: formData.patient_id,
                    branch_id: formData.branch_id,
                    appointment_date: formData.appointment_date,
                    start_time: formData.start_time,
                    end_time: formData.end_time,
                    therapist_id: null,
                    status: 'scheduled',
                    notes: formData.notes
                }])
                .select('id')
                .single()

            if (aptErr) throw aptErr

            toast.success('Jadwal temu berhasil dibuat!')
            router.push('/appointments')
            router.refresh()

        } catch (err) {
            console.error('Save error:', err)
            setError('Gagal menyimpan jadwal: ' + err.message)
            toast.error('Gagal menyimpan jadwal: ' + err.message)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/appointments">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <p className="text-sm text-ayumi-text-muted mt-1">Isi formulir untuk membuat janji temu pasien.</p>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="font-medium text-sm">{error}</span>
                </div>
            )}

            <form onSubmit={handleSave} className="card-ayumi p-8 space-y-8">
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    
                    {/* Kiri: Data Pasien & Jadwal */}
                    <div className="space-y-6">
                        <h3 className="text-lg font-bold text-ayumi-primary border-b border-pink-50 pb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            Pasien & Jadwal
                        </h3>

                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Cari Pasien *</label>
                            <input
                                type="text"
                                placeholder="Ketik nama atau WhatsApp..."
                                value={patientSearch}
                                onChange={(e) => setPatientSearch(e.target.value)}
                                className="input-ayumi bg-white mb-3"
                            />
                            <div className="max-h-48 overflow-y-auto bg-white rounded-xl border border-gray-100 shadow-sm">
                                {filteredPatients.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-gray-500">Pasien tidak ditemukan.</div>
                                ) : (
                                    filteredPatients.slice(0, 50).map(pt => (
                                        <div 
                                            key={pt.id} 
                                            onClick={() => setFormData(prev => ({ ...prev, patient_id: pt.id }))}
                                            className={`p-3 border-b border-gray-50 cursor-pointer transition-colors ${formData.patient_id === pt.id ? 'bg-pink-50 border-l-4 border-l-ayumi-primary' : 'hover:bg-gray-50'}`}
                                        >
                                            <div className="font-bold text-gray-800 text-sm">{pt.full_name}</div>
                                            <div className="text-xs text-gray-500">{pt.whatsapp}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

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
                                <option value="10:00">10:00</option>
                                <option value="12:00">12:00</option>
                                <option value="14:00">14:00</option>
                                <option value="16:00">16:00</option>
                            </select>
                        </div>
                    </div>

                    {/* Kanan: Notes */}
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Catatan (Opsional)</label>
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleChange}
                                rows="8"
                                className="input-ayumi focus:bg-white resize-none h-64"
                                placeholder="Tulis catatan janji temu di sini..."
                            ></textarea>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-100 pt-8 flex justify-end gap-4 mt-8">
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
