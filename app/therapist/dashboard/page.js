'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { supabase } from '@/lib/supabaseClient'
import TherapistPatientHistoryModal from '@/components/ui/TherapistPatientHistoryModal'

export default function TherapistDashboard() {
    const router = useRouter()

    const [dbUser, setDbUser] = useState(null)
    const [selectedBranch, setSelectedBranch] = useState('')
    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(true)
    const [claimingAptId, setClaimingAptId] = useState(null)
    const [selectedPatientIdForHistory, setSelectedPatientIdForHistory] = useState(null)
    const [queueFilter, setQueueFilter] = useState('my_tasks') // 'my_tasks' | 'waiting' | 'unassigned' | 'completed' | 'all'

    // Today's Date String
    const getLocalDateString = (date = new Date()) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const todayStr = getLocalDateString()

    // Commission Widget States
    const [commPeriodPreset, setCommPeriodPreset] = useState('month') // 'today' | 'week' | 'month'
    const [commItems, setCommItems] = useState([])
    const [commLoading, setCommLoading] = useState(false)

    useEffect(() => {
        fetchUserAndData()

        const channel = supabase
            .channel('therapist-realtime-dashboard')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'appointments' },
                () => {
                    fetchAppointments()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    useEffect(() => {
        if (selectedBranch) {
            fetchAppointments()
        }
    }, [selectedBranch])

    const fetchUserAndData = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase
            .from('users')
            .select('*, branches(name)')
            .eq('id', user.id)
            .maybeSingle()

        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }

        setDbUser(userData)
        fetchTherapistCommissions(userData.id, commPeriodPreset)

        const assignedBranchId = userData.branch_id || ''
        setSelectedBranch(assignedBranchId)
    }

    const fetchAppointments = async () => {
        if (!selectedBranch) return
        setLoading(true)

        const { data, error } = await supabase
            .from('appointments')
            .select(`
                *,
                patients (id, full_name, whatsapp),
                branches (name),
                therapist:users!appointments_therapist_id_fkey (id, full_name),
                treatment_records (id, result_notes),
                appointment_treatments (
                    treatments (
                        id,
                        name,
                        category_id,
                        treatment_categories (id, name)
                    )
                )
            `)
            .eq('branch_id', selectedBranch)
            .eq('appointment_date', todayStr)
            .order('start_time', { ascending: true })

        if (data) {
            const allPatientIds = Array.from(new Set(data.map(a => a.patient_id).filter(Boolean)))
            if (allPatientIds.length > 0) {
                try {
                    const res = await fetch('/api/therapist/patient-lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: allPatientIds })
                    })
                    if (res.ok) {
                        const { patientsMap } = await res.json()
                        if (patientsMap) {
                            data.forEach(a => {
                                if (a.patient_id && patientsMap[a.patient_id]) {
                                    a.patients = { ...a.patients, ...patientsMap[a.patient_id] }
                                }
                            })
                        }
                    }
                } catch (e) {
                    console.error('Lookup error in therapist dashboard appointments:', e)
                }
            }
            setAppointments(data)
        }
        setLoading(false)
    }

    const fetchTherapistCommissions = async (userId = dbUser?.id, preset = commPeriodPreset) => {
        if (!userId) return
        setCommLoading(true)

        const now = new Date()
        let start = todayStr
        let end = todayStr

        if (preset === 'week') {
            const d = new Date()
            const dayOfWeek = d.getDay()
            const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
            const monday = new Date(d.setDate(diffToMon))
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            start = getLocalDateString(monday)
            end = getLocalDateString(sunday)
        } else if (preset === 'month') {
            const y = now.getFullYear()
            const m = now.getMonth()
            const first = new Date(y, m, 1)
            const last = new Date(y, m + 1, 0)
            start = getLocalDateString(first)
            end = getLocalDateString(last)
        }

        const { data, error } = await supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                original_price,
                discount_percent,
                commission_percent,
                treatment_records!inner(
                    id,
                    treatment_date,
                    treatment_time,
                    branch_id,
                    performed_by
                )
            `)
            .eq('treatment_records.performed_by', userId)
            .gte('treatment_records.treatment_date', start)
            .lte('treatment_records.treatment_date', end)

        if (!error && data) {
            setCommItems(data)
        } else {
            setCommItems([])
        }
        setCommLoading(false)
    }

    const handleCommPresetChange = (preset) => {
        setCommPeriodPreset(preset)
        if (dbUser?.id) {
            fetchTherapistCommissions(dbUser.id, preset)
        }
    }

    const commSummary = useMemo(() => {
        let totalRevenue = 0
        let totalCommission = 0

        commItems.forEach(item => {
            const priceAtTime = Number(item.price_at_time || 0)
            const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                ? Number(item.original_price)
                : priceAtTime
            const commPercent = Number(item.commission_percent || 0)
            const commAmount = Math.round(basePrice * (commPercent / 100))

            totalRevenue += priceAtTime
            totalCommission += commAmount
        })

        return {
            totalRevenue,
            totalCommission,
            treatmentCount: commItems.length
        }
    }, [commItems])

    const handleClaimAppointment = async (aptId) => {
        if (!dbUser) return
        setClaimingAptId(aptId)

        try {
            const { error } = await supabase
                .from('appointments')
                .update({ therapist_id: dbUser.id })
                .eq('id', aptId)

            if (error) throw error

            toast.success('Jadwal berhasil Anda ambil. Silakan tangani pasien.')
            fetchAppointments()
        } catch (err) {
            toast.error('Gagal mengambil jadwal: ' + getFriendlyErrorMessage(err))
        } finally {
            setClaimingAptId(null)
        }
    }

    const handleTherapistReady = async (apt) => {
        try {
            const todayNowStr = new Date().toISOString()
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({
                    arrival_status: 'therapist_ready',
                    therapist_ready_at: todayNowStr,
                    updated_at: todayNowStr
                })
                .eq('id', apt.id)

            if (aptErr) throw aptErr

            const { data: activeAdmins } = await supabase
                .from('users')
                .select('id, role, branch_id')
                .eq('role', 'admin')
                .eq('is_active', true)

            const recipients = activeAdmins?.filter(u => 
                u.id !== dbUser.id && (!u.branch_id || u.branch_id === apt.branch_id)
            ) || []

            if (recipients.length > 0) {
                const notificationsToInsert = recipients.map(adm => ({
                    recipient_id: adm.id,
                    sender_id: dbUser.id,
                    appointment_id: apt.id,
                    type: 'therapist_ready',
                    title: 'Terapis Siap',
                    message: `Terapis ${dbUser.full_name} sudah siap menangani pasien ${apt.patients?.full_name || ''}. Silakan persilakan pasien masuk.`
                }))
                await supabase.from('notifications').insert(notificationsToInsert)
            }

            toast.success('Status berhasil diperbarui. Kasir/Admin telah diberi tahu.')
            fetchAppointments()
        } catch (err) {
            toast.error('Gagal update status: ' + err.message)
        }
    }

    // Categorized Appointments
    const myAppointments = appointments.filter(a => a.therapist_id === dbUser?.id && a.status !== 'cancelled')
    const unassignedAppointments = appointments.filter(a => !a.therapist_id && a.status !== 'cancelled')
    const arrivedWaitingAppointments = myAppointments.filter(a => a.arrival_status === 'arrived' && a.status !== 'completed')
    const inTreatmentAppointments = myAppointments.filter(a => (a.arrival_status === 'therapist_ready' || a.arrival_status === 'in_treatment') && a.status !== 'completed')
    const completedToday = myAppointments.filter(a => a.status === 'completed')

    // Find the current active or next priority patient for this therapist
    const priorityPatient = useMemo(() => {
        const currentActive = myAppointments.find(a => a.arrival_status === 'in_treatment' || a.arrival_status === 'therapist_ready')
        if (currentActive) return currentActive

        const arrived = myAppointments.find(a => a.arrival_status === 'arrived' && a.status !== 'completed')
        if (arrived) return arrived

        const nextScheduled = myAppointments.find(a => a.status !== 'completed')
        if (nextScheduled) return nextScheduled

        return null
    }, [myAppointments])

    // Filter queue list
    const displayedQueue = useMemo(() => {
        if (queueFilter === 'my_tasks') return myAppointments.filter(a => a.status !== 'completed')
        if (queueFilter === 'waiting') return appointments.filter(a => a.arrival_status === 'arrived' && a.status !== 'completed')
        if (queueFilter === 'unassigned') return unassignedAppointments
        if (queueFilter === 'completed') return completedToday
        return appointments.filter(a => a.status !== 'cancelled')
    }, [queueFilter, appointments, myAppointments, unassignedAppointments, completedToday])

    return (
        <div className="space-y-6 w-full">
            {/* Top Therapist Status & Branch Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white px-6 py-4 rounded-2xl border border-slate-200/80 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-extrabold text-sm flex items-center justify-center shadow-2xs">
                        {dbUser?.full_name ? dbUser.full_name.charAt(0).toUpperCase() : 'T'}
                    </div>
                    <div>
                        <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <span>Selamat Bertugas, <span className="text-ayumi-primary">{dbUser?.full_name || 'Terapis'}</span></span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-2">
                            <span>{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            <span>•</span>
                            <span>Pusat Kerja & Antrean Hari Ini</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {dbUser?.branches?.name && (
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span>Cabang: <b className="text-slate-900 font-bold">{dbUser.branches.name}</b></span>
                        </div>
                    )}
                    <Link href="/therapist/appointments">
                        <button className="text-xs font-bold text-slate-700 hover:text-ayumi-primary bg-white hover:bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer">
                            Papan Jadwal Penuh
                        </button>
                    </Link>
                    <Link href="/therapist/appointments?tab=history">
                        <button className="text-xs font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-3.5 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer">
                            Riwayat Komisi
                        </button>
                    </Link>
                </div>
            </div>

            {/* 4 Summary Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Stat 1: Komisi */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-5 text-white shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Komisi Anda</span>
                        <div className="bg-white/10 p-0.5 rounded-lg flex text-[10px] font-bold">
                            <button 
                                onClick={() => handleCommPresetChange('today')}
                                className={`px-2 py-0.5 rounded transition-colors ${commPeriodPreset === 'today' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
                            >
                                Hari Ini
                            </button>
                            <button 
                                onClick={() => handleCommPresetChange('month')}
                                className={`px-2 py-0.5 rounded transition-colors ${commPeriodPreset === 'month' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
                            >
                                Bulan Ini
                            </button>
                        </div>
                    </div>
                    <div className="text-2xl font-black mt-3 leading-none text-white tracking-tight">
                        Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                    </div>
                    <div className="text-[11px] text-slate-400 font-medium mt-3">
                        {commSummary.treatmentCount} tindakan treatment selesai
                    </div>
                </div>

                {/* Stat 2: Tugas Hari Ini */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <span>Tugas Hari Ini</span>
                        <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 mt-2 leading-none">
                        {myAppointments.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3 flex items-center gap-1.5">
                        <span className="text-emerald-700 font-bold">{completedToday.length} selesai</span>
                        <span>•</span>
                        <span className="text-amber-700 font-bold">{myAppointments.length - completedToday.length} menunggu</span>
                    </div>
                </div>

                {/* Stat 3: Pasien Tiba & Menunggu */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <span>Tiba di Klinik</span>
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    </div>
                    <div className="text-2xl font-black text-amber-600 mt-2 leading-none">
                        {arrivedWaitingAppointments.length} <span className="text-xs font-semibold text-slate-400">Menunggu</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        {arrivedWaitingAppointments.length > 0 ? 'Siap dipanggil ke ruangan treatment' : 'Tidak ada pasien menunggu'}
                    </div>
                </div>

                {/* Stat 4: Pasien Tersedia / Belum Ada Terapis */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <span>Pasien Tersedia</span>
                        <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                    </div>
                    <div className="text-2xl font-black text-sky-600 mt-2 leading-none">
                        {unassignedAppointments.length} <span className="text-xs font-semibold text-slate-400">Bisa Diambil</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        {unassignedAppointments.length > 0 ? 'Tersedia untuk diambil terapis' : 'Semua jadwal telah terisi'}
                    </div>
                </div>
            </div>

            {/* MAIN FOCUS: NEXT PRIORITY PATIENT CARD */}
            {priorityPatient ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-xs relative overflow-hidden">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs flex flex-col items-center justify-center shadow-2xs shrink-0">
                                <span className="text-[10px] uppercase text-slate-400 font-bold">Fokus</span>
                                <span className="text-xs font-black text-slate-800">Tugas</span>
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 bg-slate-900 text-white text-[10.5px] font-bold rounded-md uppercase tracking-wider">
                                        Pasien Prioritas
                                    </span>
                                    <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                        {priorityPatient.start_time?.substring(0, 5)} - {priorityPatient.end_time?.substring(0, 5)}
                                    </span>
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mt-1.5">
                                    {priorityPatient.patients?.full_name || 'Nama Pasien'}
                                </h3>
                                <div className="text-xs font-medium text-slate-600 mt-0.5 flex flex-wrap items-center gap-2">
                                    <span>Layanan: <b className="text-slate-900 font-bold">{priorityPatient.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || priorityPatient.notes || 'Treatment'}</b></span>
                                    <span>•</span>
                                    <span>Status: 
                                        <b className={`ml-1 font-bold ${
                                            priorityPatient.arrival_status === 'arrived' ? 'text-amber-700' :
                                            priorityPatient.arrival_status === 'therapist_ready' ? 'text-emerald-700' :
                                            priorityPatient.arrival_status === 'in_treatment' ? 'text-sky-700' : 'text-slate-700'
                                        }`}>
                                            {priorityPatient.arrival_status === 'arrived' ? 'Tiba di Klinik' :
                                             priorityPatient.arrival_status === 'therapist_ready' ? 'Terapis Siap' :
                                             priorityPatient.arrival_status === 'in_treatment' ? 'Sedang Perawatan' : 'Terjadwal'}
                                        </b>
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons for Focus Patient */}
                        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                            {priorityPatient.patients?.id && (
                                <button
                                    onClick={() => setSelectedPatientIdForHistory(priorityPatient.patients.id)}
                                    className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-all shadow-2xs cursor-pointer"
                                >
                                    Riwayat Medis
                                </button>
                            )}

                            {priorityPatient.arrival_status === 'arrived' && (
                                <button
                                    onClick={() => handleTherapistReady(priorityPatient)}
                                    className="btn-primary px-4 py-2 text-xs font-bold shadow-xs cursor-pointer"
                                >
                                    Saya Siap (Panggil Pasien)
                                </button>
                            )}

                            {priorityPatient.status !== 'completed' && (
                                <Link href={`/therapist/treatment-input/${priorityPatient.id}`}>
                                    <button className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-xs cursor-pointer">
                                        Input Treatment & SOAP
                                    </button>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-slate-50 rounded-2xl border border-slate-200/80 p-4 text-center">
                    <span className="text-xs font-semibold text-slate-600">Semua tugas pasien Anda hari ini telah selesai atau belum ada jadwal mendesak.</span>
                </div>
            )}

            {/* TODAY'S TREATMENT QUEUE LIST */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 md:p-6 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            Antrean & Jadwal Pasien Hari Ini
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Daftar pasien di cabang {dbUser?.branches?.name || 'klinik'} untuk hari ini ({new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}).
                        </p>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex flex-wrap gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60">
                        <button
                            onClick={() => setQueueFilter('my_tasks')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'my_tasks' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Tugas Saya ({myAppointments.filter(a => a.status !== 'completed').length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('waiting')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'waiting' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Tiba & Menunggu ({arrivedWaitingAppointments.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('unassigned')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'unassigned' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Tersedia ({unassignedAppointments.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('completed')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'completed' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Selesai ({completedToday.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Semua ({appointments.length})
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mx-auto mb-3"></div>
                        <p className="text-xs text-slate-500 font-medium">Memuat antrean pasien...</p>
                    </div>
                ) : displayedQueue.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50/50 rounded-xl border border-slate-100">
                        <p className="text-sm font-bold text-slate-700">Tidak ada pasien dalam kategori ini untuk hari ini.</p>
                        <p className="text-xs text-slate-400 mt-1">Gunakan tombol "Papan Jadwal Penuh" untuk melihat jadwal di tanggal lain.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {displayedQueue.map(apt => {
                            const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                            const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''
                            const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Treatment'
                            const isMyTask = apt.therapist_id === dbUser?.id
                            const isUnassigned = !apt.therapist_id
                            const isCompleted = apt.status === 'completed'

                            return (
                                <div 
                                    key={apt.id}
                                    className={`rounded-xl border p-4 transition-all shadow-2xs flex flex-col justify-between ${
                                        isCompleted ? 'bg-slate-50/70 border-slate-200 opacity-80' :
                                        isMyTask ? 'bg-white border-pink-300 ring-1 ring-pink-200' :
                                        'bg-white border-slate-200'
                                    }`}
                                >
                                    <div>
                                        {/* Card Header: Time & Badges */}
                                        <div className="flex justify-between items-center pb-2 mb-2.5 border-b border-slate-100 text-xs">
                                            <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                                {startTime} - {endTime}
                                            </span>
                                            
                                            {isCompleted ? (
                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded text-[10.5px] border border-emerald-200/60">
                                                    Selesai
                                                </span>
                                            ) : apt.arrival_status === 'arrived' ? (
                                                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 font-bold rounded text-[10.5px] border border-amber-200/60">
                                                    Tiba di Klinik
                                                </span>
                                            ) : apt.arrival_status === 'therapist_ready' ? (
                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-bold rounded text-[10.5px] border border-emerald-200/60">
                                                    Siap Masuk
                                                </span>
                                            ) : apt.arrival_status === 'in_treatment' ? (
                                                <span className="px-2 py-0.5 bg-sky-50 text-sky-800 font-bold rounded text-[10.5px] border border-sky-200/60">
                                                    Di Ruangan
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-semibold rounded text-[10.5px]">
                                                    Terjadwal
                                                </span>
                                            )}
                                        </div>

                                        {/* Patient Name */}
                                        <div className="font-bold text-slate-900 text-sm tracking-tight truncate">
                                            {apt.patients?.full_name || 'Nama Pasien'}
                                        </div>

                                        {/* Treatment Details */}
                                        <div className="text-xs text-slate-700 font-semibold mt-1 bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded truncate">
                                            {treatmentsList}
                                        </div>

                                        {/* Therapist info */}
                                        <div className="text-[11px] text-slate-500 font-medium mt-2 flex items-center gap-1">
                                            <span>Petugas: </span>
                                            {apt.therapist?.full_name ? (
                                                <b className="text-slate-800 font-semibold">{isMyTask ? 'Anda' : apt.therapist.full_name}</b>
                                            ) : (
                                                <span className="text-amber-700 font-semibold">Belum Ditugaskan</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                                        <div>
                                            {apt.patients?.id && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                    className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors text-[11px] font-semibold cursor-pointer"
                                                    title="Lihat Rekam Medis"
                                                >
                                                    Rekam Medis
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            {isUnassigned && !isCompleted && (
                                                <button
                                                    onClick={() => handleClaimAppointment(apt.id)}
                                                    disabled={claimingAptId === apt.id}
                                                    className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                                >
                                                    {claimingAptId === apt.id ? 'Memilih...' : 'Ambil Tugas'}
                                                </button>
                                            )}

                                            {isMyTask && apt.arrival_status === 'arrived' && !isCompleted && (
                                                <button
                                                    onClick={() => handleTherapistReady(apt)}
                                                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                                >
                                                    Saya Siap
                                                </button>
                                            )}

                                            {!isCompleted && (
                                                <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                    <button className="px-2.5 py-1 rounded bg-ayumi-primary hover:bg-[#9a4b75] text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer">
                                                        Input SOAP
                                                    </button>
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Modal Riwayat Medis Pasien */}
            {selectedPatientIdForHistory && (
                <TherapistPatientHistoryModal
                    isOpen={!!selectedPatientIdForHistory}
                    onClose={() => setSelectedPatientIdForHistory(null)}
                    patientId={selectedPatientIdForHistory}
                />
            )}
        </div>
    )
}
