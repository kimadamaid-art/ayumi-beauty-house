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
    const [loading, setLoading] = useState(true)
    const [isUpdating, setIsUpdating] = useState(false)
    const [isOwner, setIsOwner] = useState(false)
    const [userRole, setUserRole] = useState('')

    const handleDeleteAppointment = async () => {
        try {
            // Check for associated treatment record
            const { data: recordData } = await supabase
                .from('treatment_records')
                .select('id')
                .eq('appointment_id', resolvedParams.id)
                .maybeSingle()

            if (recordData) {
                // Check if the treatment record has a transaction (payment)
                const { data: txData } = await supabase
                    .from('transactions')
                    .select('transaction_number')
                    .eq('treatment_record_id', recordData.id)
                    .maybeSingle()

                if (txData) {
                    alert(`Tidak dapat menghapus jadwal ini karena rekam medis terkait sudah dibayar di kasir (No. Transaksi: ${txData.transaction_number}). Harap hapus transaksi pembayaran terlebih dahulu jika ingin menghapus jadwal ini.`)
                    return
                }
            }

            let confirmMsg = 'Apakah Anda yakin ingin menghapus jadwal temu ini? Semua tindakan terkait juga akan dihapus.'
            if (recordData) {
                confirmMsg = 'Jadwal ini memiliki Rekam Medis (SOAP) terkait. Menghapus jadwal ini juga akan menghapus rekam medis dan mengembalikan kupon yang digunakan. Lanjutkan?'
            }

            if (!window.confirm(confirmMsg)) {
                return
            }

            // Perform deletion cleanup
            if (recordData) {
                const recordId = recordData.id

                // 1. Rollback coupon sessions if any
                const { data: logs } = await supabase
                    .from('coupon_usage_logs')
                    .select('*')
                    .eq('treatment_record_id', recordId)

                if (logs && logs.length > 0) {
                    for (const log of logs) {
                        const { data: itemData } = await supabase
                            .from('patient_coupon_items')
                            .select('used_sessions, remaining_sessions, patient_coupon_id')
                            .eq('id', log.patient_coupon_item_id)
                            .single()

                        if (itemData) {
                            const newUsed = Math.max(0, itemData.used_sessions - 1)
                            const newRemaining = itemData.remaining_sessions + 1
                            
                            await supabase
                                .from('patient_coupon_items')
                                .update({
                                    used_sessions: newUsed,
                                    remaining_sessions: newRemaining,
                                    status: 'active'
                                })
                                .eq('id', log.patient_coupon_item_id)

                            await supabase
                                .from('patient_coupons')
                                .update({ status: 'active' })
                                .eq('id', itemData.patient_coupon_id)
                        }
                    }

                    await supabase
                        .from('coupon_usage_logs')
                        .delete()
                        .eq('treatment_record_id', recordId)
                }

                // 2. Delete followup queue
                await supabase
                    .from('followup_queue')
                    .delete()
                    .eq('treatment_record_id', recordId)

                // 3. Delete treatment record items
                await supabase
                    .from('treatment_record_items')
                    .delete()
                    .eq('treatment_record_id', recordId)

                // 4. Delete patient photos
                await supabase
                    .from('patient_photos')
                    .delete()
                    .eq('treatment_record_id', recordId)

                // 5. Delete the treatment record itself
                const { error: recordDeleteErr } = await supabase
                    .from('treatment_records')
                    .delete()
                    .eq('id', recordId)

                if (recordDeleteErr) throw recordDeleteErr
            }

            // 6. Delete appointment treatments
            await supabase
                .from('appointment_treatments')
                .delete()
                .eq('appointment_id', resolvedParams.id)

            // 7. Delete appointment itself
            const { error: deleteErr } = await supabase
                .from('appointments')
                .delete()
                .eq('id', resolvedParams.id)

            if (deleteErr) throw deleteErr

            alert('Jadwal temu berhasil dihapus.')
            router.push('/appointments')
            router.refresh()

        } catch (err) {
            console.error('Error deleting appointment:', err)
            alert('Gagal menghapus jadwal: ' + err.message)
        }
    }

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

        // Fetch user and check role
        const { data: { user } } = await supabase.auth.getUser()
        let loggedInUser = null
        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData) {
                loggedInUser = userData
                setIsOwner(userData.role === 'owner')
                setUserRole(userData.role || '')
            } else {
                setIsOwner(true)
            }
        } else {
            setIsOwner(true)
        }

        // Fetch Appointment
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`
                *,
                patients (*),
                branches (name),
                users!appointments_therapist_id_fkey (full_name),
                treatment_records (id, result_notes, treatment_record_items(treatment_id, price_at_time, treatments(name)))
            `)
            .eq('id', resolvedParams.id)
            .single()

        if (aptData) {
            // Guard: Non-owner is restricted to their branch
            if (loggedInUser && loggedInUser.role !== 'owner' && loggedInUser.branch_id && aptData.branch_id !== loggedInUser.branch_id) {
                alert('Anda tidak diizinkan mengakses jadwal dari cabang lain.')
                router.push('/appointments')
                return
            }
            setAppointment(aptData)
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
            <div className="card-ayumi p-5 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
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
                {isOwner && (
                    <>
                        <Link href={`/appointments/${appointment.id}/edit`}>
                            <button className="bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 py-2.5 px-5 flex items-center gap-2 text-sm font-bold rounded-xl transition-all cursor-pointer shadow-sm">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                Edit Jadwal
                            </button>
                        </Link>
                        <button 
                            onClick={handleDeleteAppointment}
                            className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 py-2.5 px-5 flex items-center gap-2 text-sm font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Hapus Jadwal
                        </button>
                    </>
                )}

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
                        <span className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            Menunggu terapis input treatment
                        </span>
                    )
                )}
            </div>

            {/* Timeline Card */}
            <div className="card-ayumi p-4 md:p-6 md:p-8">
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

            {appointment.status !== 'cancelled' && (!appointment.treatment_records || appointment.treatment_records.length === 0) && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-2xl flex items-start gap-3 font-semibold text-sm">
                    <svg className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div>
                        <div>Terapis belum mengisi treatment & catatan SOAP.</div>
                        <div className="font-normal text-xs mt-1 text-yellow-700">Terapis dapat mengisi melalui menu <strong>Dashboard Terapis → Jadwal Hari Ini → Input Treatment</strong>.</div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Info Pasien */}
                <div className="lg:col-span-1 card-ayumi p-4 md:p-6 space-y-6">
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
                    {/* Tampilkan rekam medis jika sudah ada */}
                    {appointment.treatment_records && appointment.treatment_records.length > 0 && (
                        <div className="card-ayumi p-4 md:p-6">
                            <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Treatment yang Dilakukan
                            </h3>
                            <div className="space-y-2">
                                {appointment.treatment_records[0].treatment_record_items?.map((item, i) => (
                                    <div key={i} className="flex justify-between items-center p-3 bg-green-50 rounded-xl border border-green-100">
                                        <span className="font-bold text-gray-800 text-sm">{item.treatments?.name || 'Treatment'}</span>
                                        <span className="font-bold text-green-700 text-sm">Rp {item.price_at_time?.toLocaleString('id-ID')}</span>
                                    </div>
                                ))}
                            </div>
                            <Link href={`/treatment-records/${appointment.treatment_records[0].id}`} className="mt-4 block">
                                <button className="w-full text-center text-ayumi-primary text-sm font-bold hover:underline py-1">Lihat Detail Rekam Medis →</button>
                            </Link>
                        </div>
                    )}

                    <div className="card-ayumi p-4 md:p-6">
                        <h3 className="text-lg font-bold text-ayumi-secondary border-b border-gray-100 pb-3 mb-4">Catatan</h3>
                        {appointment.notes ? (
                            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed bg-yellow-50/50 p-4 rounded-xl border border-yellow-100/50">{appointment.notes}</p>
                        ) : (
                            <p className="text-gray-400 italic">Tidak ada catatan.</p>
                        )}
                    </div>

                    {appointment.status === 'cancelled' && appointment.cancel_reason && (
                        <div className="bg-red-50 rounded-3xl border border-red-100 p-4 md:p-6">
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
