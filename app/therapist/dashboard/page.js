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

        // Only fetch today's appointments for the therapist action center dashboard
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

            toast.success('Jadwal berhasil Anda ambil! Silakan tangani pasien.')
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

            // Send notification to branch admins of this appointment
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
                    title: 'Terapis Siap! 💆‍♀️',
                    message: `Terapis ${dbUser.full_name} sudah siap menangani pasien ${apt.patients?.full_name || ''}. Silakan persilakan pasien masuk.`
                }))
                await supabase.from('notifications').insert(notificationsToInsert)
            }

            toast.success('Status berhasil diperbarui! Kasir/Admin telah diberi tahu.')
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
        // 1. Check if there's any patient currently in treatment or therapist ready
        const currentActive = myAppointments.find(a => a.arrival_status === 'in_treatment' || a.arrival_status === 'therapist_ready')
        if (currentActive) return currentActive

        // 2. Check if there's any patient who arrived and waiting
        const arrived = myAppointments.find(a => a.arrival_status === 'arrived' && a.status !== 'completed')
        if (arrived) return arrived

        // 3. Find next scheduled patient today who is not completed
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
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Top Therapist Status & Branch Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white px-5 py-4 rounded-3xl border border-pink-100/70 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-ayumi-primary to-pink-400 text-white font-black text-xl flex items-center justify-center shadow-sm">
                        💆‍♀️
                    </div>
                    <div>
                        <div className="text-base font-black text-slate-800 flex items-center gap-2">
                            <span>Selamat Bertugas, <b className="text-ayumi-primary">{dbUser?.full_name || 'Terapis'}</b></span>
                        </div>
                        <div className="text-xs text-slate-400 font-medium mt-0.5 flex items-center gap-2">
                            <span>📅 {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            <span>•</span>
                            <span>Pusat Kerja & Antrean Hari Ini</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {dbUser?.branches?.name && (
                        <div className="flex items-center gap-1.5 bg-pink-50 border border-pink-100 text-ayumi-primary px-3.5 py-2 rounded-2xl text-xs font-bold shrink-0">
                            <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                            <span>Cabang: <b className="text-slate-800 font-extrabold">{dbUser.branches.name}</b></span>
                        </div>
                    )}
                    <Link href="/therapist/appointments">
                        <button className="text-xs font-bold text-slate-700 hover:text-ayumi-primary bg-slate-50 hover:bg-pink-50/50 border border-slate-200 px-3.5 py-2 rounded-2xl transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer">
                            <span>🗓️ Papan Jadwal Penuh</span>
                        </button>
                    </Link>
                    <Link href="/therapist/appointments?tab=history">
                        <button className="text-xs font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-3.5 py-2 rounded-2xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer">
                            <span>📜 Riwayat Komisi</span>
                        </button>
                    </Link>
                </div>
            </div>

            {/* 4 Summary Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Stat 1: Komisi */}
                <div className="bg-gradient-to-br from-ayumi-secondary via-ayumi-primary to-pink-600 rounded-3xl p-5 text-white shadow-sm flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute -right-3 -bottom-3 opacity-15 text-5xl">💰</div>
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-pink-200 uppercase tracking-wider">Komisi Anda</span>
                        <div className="bg-black/20 p-0.5 rounded-lg flex text-[10px] font-bold">
                            <button 
                                onClick={() => handleCommPresetChange('today')}
                                className={`px-2 py-0.5 rounded ${commPeriodPreset === 'today' ? 'bg-white text-ayumi-primary' : 'text-white'}`}
                            >
                                Hari Ini
                            </button>
                            <button 
                                onClick={() => handleCommPresetChange('month')}
                                className={`px-2 py-0.5 rounded ${commPeriodPreset === 'month' ? 'bg-white text-ayumi-primary' : 'text-white'}`}
                            >
                                Bulan Ini
                            </button>
                        </div>
                    </div>
                    <div className="text-2xl font-black mt-2 leading-none">
                        Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                    </div>
                    <div className="text-[11px] text-pink-100 font-medium mt-3">
                        {commSummary.treatmentCount} tindakan treatment selesai
                    </div>
                </div>

                {/* Stat 2: Tugas Hari Ini */}
                <div className="bg-white rounded-3xl p-5 border border-pink-100/70 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <span>Tugas Anda Hari Ini</span>
                        <span className="text-lg">💆‍♀️</span>
                    </div>
                    <div className="text-3xl font-black text-slate-800 mt-2 leading-none">
                        {myAppointments.length} <span className="text-xs font-bold text-slate-400">Pasien</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3 flex items-center gap-1">
                        <span className="text-emerald-600 font-bold">{completedToday.length} selesai</span>
                        <span>•</span>
                        <span className="text-amber-600 font-bold">{myAppointments.length - completedToday.length} menunggu</span>
                    </div>
                </div>

                {/* Stat 3: Pasien Tiba & Menunggu */}
                <div className="bg-white rounded-3xl p-5 border border-pink-100/70 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <span>Tiba di Klinik</span>
                        <span className="text-lg">🙋‍♀️</span>
                    </div>
                    <div className="text-3xl font-black text-amber-600 mt-2 leading-none">
                        {arrivedWaitingAppointments.length} <span className="text-xs font-bold text-slate-400">Menunggu</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        {arrivedWaitingAppointments.length > 0 ? 'Siap dipanggil ke ruangan treatment' : 'Belum ada pasien menunggu'}
                    </div>
                </div>

                {/* Stat 4: Pasien Tersedia / Belum Ada Terapis */}
                <div className="bg-white rounded-3xl p-5 border border-pink-100/70 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <span>Pasien Tersedia</span>
                        <span className="text-lg">✨</span>
                    </div>
                    <div className="text-3xl font-black text-sky-600 mt-2 leading-none">
                        {unassignedAppointments.length} <span className="text-xs font-bold text-slate-400">Bisa Diambil</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        {unassignedAppointments.length > 0 ? 'Bisa Anda ambil untuk dikerjakan' : 'Semua jadwal sudah ada terapis'}
                    </div>
                </div>
            </div>

            {/* MAIN FOCUS: NEXT PRIORITY PATIENT CARD */}
            {priorityPatient ? (
                <div className="bg-gradient-to-r from-pink-500/10 via-pink-50 to-white rounded-3xl border-2 border-pink-300/80 p-5 md:p-6 shadow-sm relative overflow-hidden">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex items-start gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-white border border-pink-200 text-ayumi-primary font-black text-2xl flex items-center justify-center shadow-xs shrink-0">
                                🎯
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 bg-ayumi-primary text-white text-[10.5px] font-black rounded-full uppercase tracking-wider shadow-2xs">
                                        Fokus Tugas Saat Ini
                                    </span>
                                    <span className="text-xs font-black text-slate-700 bg-white/80 px-2.5 py-0.5 rounded-lg border border-pink-200">
                                        🕒 {priorityPatient.start_time?.substring(0, 5)} - {priorityPatient.end_time?.substring(0, 5)}
                                    </span>
                                </div>
                                <h3 className="text-lg md:text-xl font-black text-slate-900 mt-1">
                                    {priorityPatient.patients?.full_name || 'Nama Pasien'}
                                </h3>
                                <div className="text-xs font-bold text-ayumi-secondary mt-0.5 flex flex-wrap items-center gap-2">
                                    <span>Layanan: <b className="text-slate-800">{priorityPatient.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || priorityPatient.notes || 'Treatment'}</b></span>
                                    <span>•</span>
                                    <span>Status: 
                                        <b className={`ml-1 font-extrabold ${
                                            priorityPatient.arrival_status === 'arrived' ? 'text-amber-600' :
                                            priorityPatient.arrival_status === 'therapist_ready' ? 'text-green-600' :
                                            priorityPatient.arrival_status === 'in_treatment' ? 'text-emerald-600' : 'text-blue-600'
                                        }`}>
                                            {priorityPatient.arrival_status === 'arrived' ? 'Sudah Tiba di Klinik 🙋‍♀️' :
                                             priorityPatient.arrival_status === 'therapist_ready' ? 'Terapis Siap 💆‍♀️' :
                                             priorityPatient.arrival_status === 'in_treatment' ? 'Sedang di Ruangan Perawatan' : 'Terjadwal'}
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
                                    className="px-3.5 py-2.5 rounded-xl border border-pink-200 bg-white hover:bg-pink-50 text-ayumi-primary font-extrabold text-xs transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <span>📋 Riwayat Medis</span>
                                </button>
                            )}

                            {priorityPatient.arrival_status === 'arrived' && (
                                <button
                                    onClick={() => handleTherapistReady(priorityPatient)}
                                    className="btn-primary px-4 py-2.5 text-xs font-extrabold flex items-center gap-1.5 shadow-md animate-pulse cursor-pointer"
                                >
                                    <span>💆‍♀️ Saya Siap! (Panggil Pasien)</span>
                                </button>
                            )}

                            {priorityPatient.status !== 'completed' && (
                                <Link href={`/therapist/treatment-input/${priorityPatient.id}`}>
                                    <button className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer">
                                        <span>📝 Input Treatment & SOAP</span>
                                    </button>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-gradient-to-r from-emerald-50 to-pink-50/40 rounded-3xl border border-emerald-200/60 p-5 text-center flex items-center justify-center gap-3">
                    <span className="text-2xl">🎉</span>
                    <span className="text-sm font-bold text-slate-700">Semua tugas pasien Anda hari ini telah selesai atau belum ada jadwal mendesak.</span>
                </div>
            )}

            {/* TODAY'S TREATMENT QUEUE LIST */}
            <div className="bg-white rounded-3xl border border-pink-100/70 p-5 md:p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
                    <div>
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <span>📋 Antrean & Jadwal Pasien Hari Ini</span>
                        </h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">
                            Daftar pasien yang terdaftar di cabang {dbUser?.branches?.name || 'klinik'} untuk hari ini ({new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}).
                        </p>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex flex-wrap gap-1 bg-pink-50/70 p-1 rounded-2xl border border-pink-100">
                        <button
                            onClick={() => setQueueFilter('my_tasks')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'my_tasks' ? 'bg-ayumi-primary text-white shadow-xs' : 'text-slate-600 hover:text-ayumi-primary'
                            }`}
                        >
                            Tugas Saya ({myAppointments.filter(a => a.status !== 'completed').length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('waiting')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'waiting' ? 'bg-ayumi-primary text-white shadow-xs' : 'text-slate-600 hover:text-ayumi-primary'
                            }`}
                        >
                            Tiba & Menunggu ({arrivedWaitingAppointments.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('unassigned')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'unassigned' ? 'bg-ayumi-primary text-white shadow-xs' : 'text-slate-600 hover:text-ayumi-primary'
                            }`}
                        >
                            Tersedia ({unassignedAppointments.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('completed')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'completed' ? 'bg-ayumi-primary text-white shadow-xs' : 'text-slate-600 hover:text-ayumi-primary'
                            }`}
                        >
                            Selesai ({completedToday.length})
                        </button>
                        <button
                            onClick={() => setQueueFilter('all')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                queueFilter === 'all' ? 'bg-ayumi-primary text-white shadow-xs' : 'text-slate-600 hover:text-ayumi-primary'
                            }`}
                        >
                            Semua ({appointments.length})
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ayumi-primary mx-auto mb-3"></div>
                        <p className="text-xs text-slate-500 font-medium">Memuat antrean pasien...</p>
                    </div>
                ) : displayedQueue.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-slate-100">
                        <div className="text-3xl mb-2">🌿</div>
                        <p className="text-sm font-bold text-slate-700">Tidak ada pasien dalam kategori ini untuk hari ini.</p>
                        <p className="text-xs text-slate-400 mt-1">Gunakan tombol "Papan Jadwal Penuh" untuk melihat jadwal di tanggal lain.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                                    className={`rounded-2xl border p-4.5 transition-all shadow-xs flex flex-col justify-between ${
                                        isCompleted ? 'bg-slate-50/70 border-slate-200 opacity-80' :
                                        isMyTask ? 'bg-white border-pink-200 ring-1 ring-pink-100 hover:border-pink-300' :
                                        'bg-white border-slate-200 hover:border-sky-300'
                                    }`}
                                >
                                    <div>
                                        {/* Card Header: Time & Badges */}
                                        <div className="flex justify-between items-center pb-2 mb-2.5 border-b border-slate-100 text-xs">
                                            <span className="font-extrabold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                                                🕒 {startTime} - {endTime}
                                            </span>
                                            
                                            {isCompleted ? (
                                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-md text-[10px]">
                                                    ✅ Selesai
                                                </span>
                                            ) : apt.arrival_status === 'arrived' ? (
                                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-black rounded-md text-[10px] animate-pulse">
                                                    🙋‍♀️ Tiba di Klinik
                                                </span>
                                            ) : apt.arrival_status === 'therapist_ready' ? (
                                                <span className="px-2 py-0.5 bg-green-100 text-green-800 font-bold rounded-md text-[10px]">
                                                    💆‍♀️ Siap Masuk
                                                </span>
                                            ) : apt.arrival_status === 'in_treatment' ? (
                                                <span className="px-2 py-0.5 bg-sky-100 text-sky-800 font-bold rounded-md text-[10px]">
                                                    🩺 Di Ruangan
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded-md text-[10px]">
                                                    Terjadwal
                                                </span>
                                            )}
                                        </div>

                                        {/* Patient Name */}
                                        <div className="font-black text-slate-900 text-base tracking-tight truncate">
                                            {apt.patients?.full_name || 'Nama Pasien'}
                                        </div>

                                        {/* Treatment Details */}
                                        <div className="text-xs text-ayumi-primary font-bold mt-1 bg-pink-50/70 border border-pink-100 px-2.5 py-1 rounded-lg truncate">
                                            ✨ {treatmentsList}
                                        </div>

                                        {/* Therapist info */}
                                        <div className="text-[11px] text-slate-400 font-medium mt-2 flex items-center gap-1">
                                            <span>Petugas: </span>
                                            {apt.therapist?.full_name ? (
                                                <b className="text-slate-700 font-bold">{isMyTask ? 'Anda' : apt.therapist.full_name}</b>
                                            ) : (
                                                <span className="text-amber-600 font-bold">⚠️ Belum Ada Terapis</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                                        <div className="flex items-center gap-1">
                                            {apt.patients?.id && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-pink-50 hover:text-ayumi-primary text-slate-600 transition-colors text-xs cursor-pointer"
                                                    title="Lihat Rekam Medis"
                                                >
                                                    📋 Medis
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            {isUnassigned && !isCompleted && (
                                                <button
                                                    onClick={() => handleClaimAppointment(apt.id)}
                                                    disabled={claimingAptId === apt.id}
                                                    className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                                >
                                                    {claimingAptId === apt.id ? 'Memilih...' : '+ Ambil Tugas'}
                                                </button>
                                            )}

                                            {isMyTask && apt.arrival_status === 'arrived' && !isCompleted && (
                                                <button
                                                    onClick={() => handleTherapistReady(apt)}
                                                    className="px-2.5 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white font-extrabold text-[11px] transition-colors shadow-2xs cursor-pointer animate-pulse"
                                                >
                                                    Saya Siap!
                                                </button>
                                            )}

                                            {!isCompleted && (
                                                <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                    <button className="px-2.5 py-1 rounded-lg bg-ayumi-primary hover:bg-[#9a4b75] text-white font-extrabold text-[11px] transition-colors shadow-2xs cursor-pointer">
                                                        📝 Input SOAP
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
