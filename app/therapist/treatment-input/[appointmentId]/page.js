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
    const [treatments, setTreatments] = useState([])
    const [dbUser, setDbUser] = useState(null)

    // Form states
    const [formData, setFormData] = useState({
        complaints: '',
        skin_condition: '',
        result_notes: '',
        recommendation: ''
    })


    useEffect(() => {
        fetchData()
    }, [resolvedParams.appointmentId])

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
            .select(`
                *,
                patients (*),
                branches (name)
            `)
            .eq('id', resolvedParams.appointmentId)
            .single()

        if (aptData) {
            // Verify assigned therapist
            if (aptData.therapist_id && aptData.therapist_id !== userData.id) {
                toast.error('Anda tidak ditugaskan untuk jadwal ini.')
                router.push('/therapist/dashboard')
                return
            }

            setAppointment(aptData)
            
            // Set initial complaints if available
            setFormData(prev => ({
                ...prev,
                complaints: aptData.notes || ''
            }))

            // Fetch Appointment Treatments
            const { data: trData } = await supabase
                .from('appointment_treatments')
                .select(`
                    id,
                    sort_order,
                    treatments (id, name, duration_minutes, price)
                `)
                .eq('appointment_id', aptData.id)
                .order('sort_order', { ascending: true })
                
            if (trData) {
                setTreatments(trData.map(t => t.treatments))
            }
        } else {
            toast.error('Jadwal tidak ditemukan')
            router.push('/therapist/dashboard')
        }
        
        setLoading(false)
    }

    const handleChange = (e) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }



    const handleSubmit = async (e) => {
        e.preventDefault()
        
        if (!formData.result_notes) {
            toast.error('Asesmen (Tindakan & Hasil) wajib diisi.')
            return
        }

        setSaving(true)

        try {
            // 2. Insert Treatment Record
            const recordPayload = {
                patient_id: appointment.patient_id,
                appointment_id: appointment.id,
                branch_id: appointment.branch_id,
                therapist_id: dbUser.id,
                treatment_date: new Date().toISOString().split('T')[0],
                skin_condition: formData.skin_condition,
                complaints: formData.complaints,
                result_notes: formData.result_notes,
                recommendation: formData.recommendation
            }

            const { error: recordError } = await supabase
                .from('treatment_records')
                .insert([recordPayload])

            if (recordError) throw recordError

            // 3. Update Appointment Status to completed
            const { error: aptError } = await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', appointment.id)

            if (aptError) throw aptError

            // 4. Create Follow Up Queue
            const followupDate = new Date()
            followupDate.setDate(followupDate.getDate() + 7) // Default follow up in 7 days
            
            const followupPayload = {
                patient_id: appointment.patient_id,
                branch_id: appointment.branch_id,
                followup_type: 'post_treatment',
                status: 'pending',
                scheduled_date: followupDate.toISOString().split('T')[0],
                priority: 'normal',
                notes: `Follow up otomatis untuk treatment: ${treatments.map(t => t.name).join(', ')}`
            }

            const { error: fuError } = await supabase
                .from('followup_queue')
                .insert([followupPayload])

            if (fuError) {
                console.error('Gagal membuat follow up', fuError)
            }

            toast.success('Hasil treatment berhasil disimpan!')
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
        <div className="max-w-4xl mx-auto space-y-6 p-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/therapist/dashboard">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Input Hasil Treatment</h1>
                </div>
            </div>

            {/* Read-only Info */}
            <div className="card-ayumi p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-pink-50 border-pink-100">
                <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Pasien</h3>
                    <div className="text-lg font-bold text-ayumi-text">{appointment.patients?.full_name}</div>
                    <div className="text-sm text-gray-600">{appointment.patients?.whatsapp}</div>
                </div>
                <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Treatment</h3>
                    {treatments.length > 0 ? (
                        <ul className="list-disc pl-4 text-sm font-bold text-ayumi-text space-y-1">
                            {treatments.map((t, i) => <li key={i}>{t.name}</li>)}
                        </ul>
                    ) : (
                        <span className="text-sm text-gray-500 italic">Treatment tidak spesifik</span>
                    )}
                </div>
            </div>

            {/* Form Input */}
            <form onSubmit={handleSubmit} className="card-ayumi p-6 md:p-8 space-y-8">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Subjektif (Keluhan Utama)</label>
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
                        <label className="block text-sm font-bold text-gray-700 mb-2">Objektif (Kondisi Kulit)</label>
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
                    <label className="block text-sm font-bold text-gray-700 mb-2">Asesmen (Tindakan & Hasil) *</label>
                    <textarea 
                        name="result_notes"
                        value={formData.result_notes}
                        onChange={handleChange}
                        required
                        rows="4"
                        placeholder="Detail tindakan yang dilakukan dan hasil setelah treatment..."
                        className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                    ></textarea>
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Planning (Rekomendasi Treatment & Skincare)</label>
                    <textarea 
                        name="recommendation"
                        value={formData.recommendation}
                        onChange={handleChange}
                        rows="3"
                        placeholder="Rencana treatment lanjutan dan anjuran produk skincare homecare..."
                        className="input-ayumi bg-gray-50 focus:bg-white resize-none"
                    ></textarea>
                </div>



                <div className="pt-6 border-t border-gray-100 flex justify-end">
                    <button 
                        type="submit" 
                        disabled={saving}
                        className="btn-primary py-3 px-8 text-base font-bold flex items-center gap-2 w-full md:w-auto justify-center"
                    >
                        {saving && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                        {saving ? 'Menyimpan...' : 'Simpan Hasil Treatment'}
                    </button>
                </div>
            </form>
        </div>
    )
}
