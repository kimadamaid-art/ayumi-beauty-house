'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { use } from 'react'

export default function AppointmentDetailPage({ params }) {
    const resolvedParams = use(params)
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [appointment, setAppointment] = useState(null)
    const [treatments, setTreatments] = useState([])
    const [loading, setLoading] = useState(true)
    const [isUpdating, setIsUpdating] = useState(false)

    const formatTime = (isoString) => {
        if (!isoString) return ''
        try {
            const date = new Date(isoString)
            return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
        } catch (e) {
            return ''
        }
    }

    useEffect(() => {
        fetchData()

        const channel = supabase
            .channel(`realtime-appointment-detail-${resolvedParams.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments',
                    filter: `id=eq.${resolvedParams.id}`
                },
                () => {
                    fetchData()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [resolvedParams.id])

    const fetchData = async () => {
        setLoading(true)

        // Fetch Appointment
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`
                *,
                patients (*),
                branches (name),
                treatment_records (id, result_notes)
            `)
            .eq('id', resolvedParams.id)
            .single()

        if (aptData) {
            setAppointment(aptData)
            
            // Fetch Appointment Treatments
            const { data: trData } = await supabase
                .from('appointment_treatments')
                .select(`
                    id,
                    sort_order,
                    treatments (id, name, duration_minutes, price, discount_percent)
                `)
                .eq('appointment_id', aptData.id)
                .order('sort_order', { ascending: true })
                
            if (trData) {
                setTreatments(trData.map(t => t.treatments))
            }
        }
        setLoading(false)
    }

    const handleStatusUpdate = async (newStatus) => {
        setIsUpdating(true)
        
        const payload = { status: newStatus }

        const { error } = await supabase
            .from('appointments')
            .update(payload)
            .eq('id', appointment.id)

        if (!error) {
            setAppointment(prev => ({ ...prev, ...payload }))
        } else {
            alert('Gagal update status: ' + error.message)
        }
        setIsUpdating(false)
    }

    const getStatusBadge = (a) => {
        const status = a.status
        const hasSoap = a.treatment_records && a.treatment_records.length > 0 && a.treatment_records[0].result_notes;

        if (status === 'completed' && !hasSoap) {
            return (
                <span className="px-4 py-1.5 rounded-full text-sm font-bold bg-yellow-50 text-yellow-700 border border-yellow-200">
                    Selesai (Menunggu SOAP)
                </span>
            )
        }

        const badges = {
            'scheduled': 'bg-blue-100 text-blue-700',
            'confirmed': 'bg-green-100 text-green-700',
            'completed': 'bg-gray-100 text-gray-700',
            'cancelled': 'bg-red-100 text-red-700',
            'no_show': 'bg-orange-100 text-orange-700'
        }
        const labels = {
            'scheduled': 'Scheduled',
            'confirmed': 'Confirmed',
            'completed': 'Selesai',
            'cancelled': 'Batal',
            'no_show': 'No Show'
        }
        const colorClass = badges[status] || 'bg-gray-100 text-gray-700'
        return (
            <span className={`px-4 py-1.5 rounded-full text-sm font-bold ${colorClass}`}>
                {labels[status] || status}
            </span>
        )
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    if (!appointment) {
        return <div className="text-center py-20 text-gray-500">Jadwal tidak ditemukan</div>
    }

    const steps = [
        { 
            label: 'Terjadwal', 
            description: 'Janji Temu Dibuat', 
            completed: appointment.status !== 'cancelled' 
        },
        { 
            label: 'Pasien Datang', 
            description: appointment.arrived_at 
                ? `Tiba ${formatTime(appointment.arrived_at)}` 
                : 'Menunggu...', 
            completed: ['arrived', 'therapist_ready', 'in_treatment'].includes(appointment.arrival_status) || appointment.status === 'completed' 
        },
        { 
            label: 'Terapis Siap', 
            description: appointment.therapist_ready_at 
                ? `Siap ${formatTime(appointment.therapist_ready_at)}` 
                : 'Menunggu...', 
            completed: ['therapist_ready', 'in_treatment'].includes(appointment.arrival_status) || appointment.status === 'completed' 
        },
        { 
            label: 'Masuk Ruangan', 
            description: appointment.arrival_status === 'in_treatment' || appointment.status === 'completed'
                ? 'Pasien di ruangan' 
                : 'Menunggu...', 
            completed: appointment.arrival_status === 'in_treatment' || appointment.status === 'completed' 
        },
        { 
            label: 'Selesai', 
            description: appointment.status === 'completed' 
                ? 'Treatment Selesai' 
                : 'Belum selesai', 
            completed: appointment.status === 'completed' 
        }
    ]

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-4">
                <Link href="/appointments">
                    <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                </Link>
                <div>
                    <p className="text-sm text-ayumi-text-muted mt-1">Kelola status dan tindak lanjut janji temu.</p>
                </div>
            </div>

            {/* Header Card */}
            <div className="card-ayumi p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center text-ayumi-primary">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">{new Date(appointment.appointment_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
                        <p className="text-ayumi-primary font-bold text-lg flex items-center gap-2 mt-1">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {appointment.start_time.substring(0, 5)} - {appointment.end_time.substring(0, 5)}
                        </p>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                    {getStatusBadge(appointment)}
                    <span className="text-sm font-semibold text-gray-500">{appointment.branches?.name}</span>
                </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="bg-white rounded-2xl shadow-sm border border-pink-50 p-4 flex flex-wrap gap-3">
                {appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
                    <>
                        <button 
                            onClick={() => handleStatusUpdate('completed')}
                            disabled={isUpdating}
                            className="bg-green-100 hover:bg-green-200 text-green-700 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
                        >
                            Selesai
                        </button>
                        <button 
                            onClick={() => {
                                if (window.confirm("Yakin ingin membatalkan?")) {
                                    handleStatusUpdate('cancelled')
                                }
                            }}
                            disabled={isUpdating}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
                        >
                            Batalkan (Cancel)
                        </button>
                    </>
                )}

                {appointment.status === 'completed' && (
                    appointment.treatment_records && appointment.treatment_records.length > 0 ? (
                        <Link href={`/treatment-records/${appointment.treatment_records[0].id}`}>
                            <button className="bg-pink-50 text-ayumi-primary border border-ayumi-primary hover:bg-pink-100/50 py-2.5 px-5 flex items-center gap-2 text-sm font-bold rounded-xl transition-all cursor-pointer">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                Lihat Rekam Medis
                            </button>
                        </Link>
                    ) : (
                        <Link href={`/treatment-records/new?patientId=${appointment.patient_id}&appointmentId=${appointment.id}`}>
                            <button className="btn-primary py-2.5 flex items-center gap-2 text-sm font-bold cursor-pointer">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Buat Rekam Medis
                            </button>
                        </Link>
                    )
                )}
            </div>

            {/* Timeline Card */}
            <div className="card-ayumi p-6 md:p-8">
                <h4 className="text-lg font-bold text-ayumi-secondary mb-6 flex items-center gap-2">
                    <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    Alur Pelayanan Pasien
                </h4>
                
                <div className="relative">
                    {/* Connection Line (Desktop) */}
                    <div className="hidden md:block absolute top-5 left-[10%] right-[10%] h-0.5 bg-gray-200 -z-10">
                        <div 
                            className="h-full bg-ayumi-primary transition-all duration-500" 
                            style={{ 
                                width: `${
                                    steps.filter(s => s.completed).length === 5 
                                    ? 100 
                                    : (steps.filter(s => s.completed).length - 1) * 25
                                }%` 
                            }}
                        />
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 md:gap-4">
                        {steps.map((step, idx) => {
                            const isCompleted = step.completed;
                            const isLastCompleted = isCompleted && (idx === steps.length - 1 || !steps[idx + 1].completed);
                            return (
                                <div key={idx} className="flex md:flex-col items-center gap-4 md:gap-2 flex-1 w-full md:text-center">
                                    {/* Step Circle */}
                                    <div className={`relative flex items-center justify-center w-10 h-10 rounded-full font-bold border-2 transition-all duration-300 ${
                                        isCompleted 
                                        ? 'bg-ayumi-primary border-ayumi-primary text-white shadow-[0_0_12px_rgba(181,88,138,0.3)]' 
                                        : 'bg-white border-gray-300 text-gray-400'
                                    } ${isLastCompleted && idx < 4 && appointment.status !== 'completed' && appointment.status !== 'cancelled' ? 'animate-pulse' : ''}`}>
                                        {isCompleted ? (
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <span>{idx + 1}</span>
                                        )}
                                        
                                        {/* Mobile Connection Line */}
                                        {idx < 4 && (
                                            <div className="md:hidden absolute top-10 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-gray-200 -z-10">
                                                <div className={`w-full h-full bg-ayumi-primary transition-all duration-300 ${steps[idx + 1].completed ? 'h-full' : 'h-0'}`} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Step Details */}
                                    <div className="flex flex-col md:items-center">
                                        <span className={`font-bold text-sm transition-colors ${isCompleted ? 'text-ayumi-secondary' : 'text-gray-400'}`}>
                                            {step.label}
                                        </span>
                                        <span className={`text-xs mt-0.5 ${isCompleted ? 'text-ayumi-primary font-medium' : 'text-gray-400'}`}>
                                            {step.description}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {appointment.status === 'completed' && (!appointment.treatment_records || appointment.treatment_records.length === 0) && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-2xl flex items-center gap-3 font-semibold text-sm">
                    <svg className="w-6 h-6 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <span>Perhatian: Terapis belum mengisi catatan SOAP (keluhan, kondisi kulit, tindakan & rekomendasi) untuk treatment ini.</span>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Info Pasien */}
                <div className="lg:col-span-1 card-ayumi p-6 space-y-6">
                    <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3">Profil Pasien</h3>
                    <div className="text-center">
                        <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center text-ayumi-primary text-2xl font-bold mx-auto mb-3">
                            {appointment.patients?.full_name?.substring(0,2).toUpperCase()}
                        </div>
                        <h4 className="font-bold text-gray-800 text-lg">{appointment.patients?.full_name}</h4>
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold mt-2 ${appointment.patients?.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                            {appointment.patients?.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    <ul className="space-y-4 pt-4 border-t border-gray-50">
                        <li>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">WhatsApp</span>
                            <span className="font-medium text-gray-800">{appointment.patients?.whatsapp}</span>
                        </li>
                        <li>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">Gender</span>
                            <span className="font-medium text-gray-800">{appointment.patients?.gender === 'female' ? 'Wanita' : appointment.patients?.gender === 'male' ? 'Pria' : 'Lainnya'}</span>
                        </li>
                        <li>
                            <span className="block text-xs font-semibold text-gray-400 uppercase">Tipe Kulit</span>
                            <span className="font-medium text-gray-800 capitalize">{appointment.patients?.skin_type}</span>
                        </li>
                    </ul>
                    <Link href={`/patients/${appointment.patient_id}`}>
                        <button className="w-full mt-4 text-ayumi-primary bg-pink-50 hover:bg-pink-100 font-bold text-sm py-2.5 rounded-xl transition-colors">
                            Lihat Profil Lengkap
                        </button>
                    </Link>
                </div>

                {/* Info Treatment & Catatan */}
                <div className="lg:col-span-2 space-y-6">
                    {treatments.length > 0 && (
                        <div className="card-ayumi p-6">
                            <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-4">Rencana Tindakan (Treatments)</h3>
                            <div className="space-y-3">
                                {treatments.map((t, i) => (
                                    <div key={i} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-ayumi-primary font-bold shadow-sm">
                                                {i+1}
                                            </div>
                                            <div>
                                                <div className="font-bold text-gray-800">{t.name}</div>
                                                <div className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    {t.duration_minutes} menit
                                                </div>
                                            </div>
                                        </div>
                                        <div className="font-bold text-gray-700 text-right">
                                            {t.discount_percent > 0 ? (
                                                <div className="flex flex-col items-end">
                                                    <span className="line-through text-xs text-gray-400">Rp {t.price?.toLocaleString('id-ID')}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="bg-pink-50 text-ayumi-primary text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                            -{t.discount_percent}%
                                                        </span>
                                                        <span className="font-bold text-gray-800">Rp {(t.price * (1 - t.discount_percent / 100))?.toLocaleString('id-ID')}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span>Rp {t.price?.toLocaleString('id-ID')}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="card-ayumi p-6">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-4">Catatan</h3>
                        {appointment.notes ? (
                            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed bg-yellow-50/50 p-4 rounded-xl border border-yellow-100/50">{appointment.notes}</p>
                        ) : (
                            <p className="text-gray-400 italic">Tidak ada catatan.</p>
                        )}
                    </div>

                    {appointment.status === 'cancelled' && appointment.cancel_reason && (
                        <div className="bg-red-50 rounded-3xl border border-red-100 p-6">
                            <h3 className="text-lg font-bold text-red-700 mb-2 flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                Alasan Pembatalan
                            </h3>
                            <p className="text-red-600 font-medium">{appointment.cancel_reason}</p>
                        </div>
                    )}
                </div>
            </div>


        </div>
    )
}
