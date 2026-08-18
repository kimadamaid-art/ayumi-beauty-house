'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { supabase } from '@/lib/supabaseClient'
import DateRangePicker from '@/components/DateRangePicker'
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

    // Helper Date
    const getLocalDateString = (date = new Date()) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const todayStr = getLocalDateString()

    // Commission Widget States
    const [commPeriodPreset, setCommPeriodPreset] = useState('month') // 'today' | 'week' | 'month' | 'custom'
    const [commStartDate, setCommStartDate] = useState(todayStr)
    const [commEndDate, setCommEndDate] = useState(todayStr)
    const [commItems, setCommItems] = useState([])
    const [commLoading, setCommLoading] = useState(false)
    const [isCommDetailOpen, setIsCommDetailOpen] = useState(false)

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

        // Default set to month
        const now = new Date()
        const first = new Date(now.getFullYear(), now.getMonth(), 1)
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        const startMonthStr = getLocalDateString(first)
        const endMonthStr = getLocalDateString(last)
        setCommStartDate(startMonthStr)
        setCommEndDate(endMonthStr)

        fetchTherapistCommissions(userData.id, startMonthStr, endMonthStr)

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

    const fetchTherapistCommissions = async (userId = dbUser?.id, start = commStartDate, end = commEndDate) => {
        if (!userId) return
        setCommLoading(true)

        const { data, error } = await supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                original_price,
                discount_percent,
                commission_percent,
                notes,
                treatments(name),
                treatment_records!inner(
                    id,
                    treatment_date,
                    treatment_time,
                    branch_id,
                    performed_by,
                    patients(full_name),
                    branches(name)
                )
            `)
            .eq('treatment_records.performed_by', userId)
            .gte('treatment_records.treatment_date', start)
            .lte('treatment_records.treatment_date', end)
            .order('treatment_records(treatment_date)', { ascending: false })

        if (!error && data) {
            setCommItems(data)
        } else {
            setCommItems([])
        }
        setCommLoading(false)
    }

    const handleCommPresetChange = (preset) => {
        setCommPeriodPreset(preset)
        const now = new Date()
        let start = todayStr
        let end = todayStr

        if (preset === 'today') {
            start = todayStr
            end = todayStr
        } else if (preset === 'week') {
            const d = new Date()
            const dayOfWeek = d.getDay()
            const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
            const monday = new Date(d.setDate(diffToMon))
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            start = getLocalDateString(monday)
            end = getLocalDateString(sunday)
        } else if (preset === 'month') {
            const first = new Date(now.getFullYear(), now.getMonth(), 1)
            const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
            start = getLocalDateString(first)
            end = getLocalDateString(last)
        }

        setCommStartDate(start)
        setCommEndDate(end)

        if (preset !== 'custom' && dbUser?.id) {
            fetchTherapistCommissions(dbUser.id, start, end)
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
    const completedToday = myAppointments.filter(a => a.status === 'completed')

    // Filter queue list
    const displayedQueue = useMemo(() => {
        if (queueFilter === 'my_tasks') return myAppointments.filter(a => a.status !== 'completed')
        if (queueFilter === 'waiting') return appointments.filter(a => a.arrival_status === 'arrived' && a.status !== 'completed')
        if (queueFilter === 'unassigned') return unassignedAppointments
        if (queueFilter === 'completed') return completedToday
        return appointments.filter(a => a.status !== 'cancelled')
    }, [queueFilter, appointments, myAppointments, unassignedAppointments, completedToday])

    return (
        <div className="space-y-6 w-full pb-10">
            {/* Top Therapist Status & Branch Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 text-ayumi-primary font-black text-base flex items-center justify-center shadow-2xs">
                        {dbUser?.full_name ? dbUser.full_name.charAt(0).toUpperCase() : 'T'}
                    </div>
                    <div>
                        <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <span>Selamat Bertugas, <span className="text-ayumi-primary font-black">{dbUser?.full_name || 'Terapis'}</span></span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-2">
                            <span>{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            <span>•</span>
                            <span>Pusat Kerja Harian</span>
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

            {/* SECTION 1: PERFORMANCE & COMMISSION WIDGET */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4">
                {/* Header Filter Bar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-100">
                    <div>
                        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                            Performa & Komisi Saya
                        </h2>
                        <p className="text-xs text-slate-400">
                            Akumulasi seluruh tindakan perawatan dan komisi dari seluruh cabang klinik.
                        </p>
                    </div>

                    {/* Period Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/70 text-xs font-semibold">
                            <button
                                onClick={() => handleCommPresetChange('today')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    commPeriodPreset === 'today' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Hari Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('week')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    commPeriodPreset === 'week' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Minggu Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('month')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    commPeriodPreset === 'month' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Bulan Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('custom')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    commPeriodPreset === 'custom' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Custom
                            </button>
                        </div>

                        {commPeriodPreset === 'custom' && (
                            <DateRangePicker
                                startDate={commStartDate}
                                endDate={commEndDate}
                                onChange={(range) => {
                                    setCommStartDate(range.startDate)
                                    setCommEndDate(range.endDate)
                                    if (dbUser?.id) {
                                        fetchTherapistCommissions(dbUser.id, range.startDate, range.endDate)
                                    }
                                }}
                                inputClassName="text-xs font-semibold py-1 px-2.5"
                            />
                        )}
                    </div>
                </div>

                {/* 4 Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Card 1: Warm Terracotta Gradient Commission Card */}
                    <div className="bg-gradient-to-r from-[#ba5d45] via-[#a84c35] to-[#8f3a25] rounded-xl p-5 text-white shadow-sm flex flex-col justify-between">
                        <div className="text-[11px] font-bold text-orange-200 uppercase tracking-wider">
                            Total Komisi Diterima
                        </div>
                        <div className="text-2xl lg:text-3xl font-black tracking-tight mt-2 text-white">
                            Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                        </div>
                        <div className="text-[11px] text-orange-100/90 font-medium mt-3">
                            Akumulasi komisi seluruh cabang
                        </div>
                    </div>

                    {/* Card 2: Tindakan Selesai */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>Tindakan Selesai</span>
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-slate-900 mt-2">
                            {commSummary.treatmentCount} <span className="text-xs font-semibold text-slate-400">Tindakan</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3">
                            Total tindakan yang Anda kerjakan
                        </div>
                    </div>

                    {/* Card 3: Tugas Hari Ini */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>Tugas Pasien Hari Ini</span>
                            <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-slate-900 mt-2">
                            {myAppointments.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3 flex items-center gap-1.5">
                            <span className="text-emerald-700 font-bold">{completedToday.length} selesai</span>
                            <span>•</span>
                            <span className="text-amber-700 font-bold">{myAppointments.length - completedToday.length} menunggu</span>
                        </div>
                    </div>

                    {/* Card 4: Pasien Tiba di Klinik */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>Tiba & Menunggu</span>
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-amber-600 mt-2">
                            {arrivedWaitingAppointments.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3">
                            {arrivedWaitingAppointments.length > 0 ? 'Siap dipanggil ke ruangan' : 'Belum ada pasien menunggu'}
                        </div>
                    </div>
                </div>

                {/* Collapsible Commission Details Table */}
                <div className="pt-2">
                    <button
                        onClick={() => setIsCommDetailOpen(!isCommDetailOpen)}
                        className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 py-1 cursor-pointer transition-colors"
                    >
                        <span>{isCommDetailOpen ? '▼ Sembunyikan Rincian Komisi' : '▶ Tampilkan Rincian Komisi per Tindakan'}</span>
                        <span className="text-[11px] font-medium text-slate-400">({commItems.length} item)</span>
                    </button>

                    {isCommDetailOpen && (
                        <div className="mt-3 overflow-x-auto border border-slate-200 rounded-xl">
                            {commLoading ? (
                                <div className="text-center py-8 text-xs text-slate-400">Memuat rincian...</div>
                            ) : commItems.length === 0 ? (
                                <div className="text-center py-8 text-xs text-slate-400">Tidak ada data komisi untuk periode ini.</div>
                            ) : (
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                        <tr>
                                            <th className="py-2.5 px-3">Tanggal</th>
                                            <th className="py-2.5 px-3">Cabang</th>
                                            <th className="py-2.5 px-3">Pasien</th>
                                            <th className="py-2.5 px-3">Treatment</th>
                                            <th className="py-2.5 px-3 text-right">Tarif</th>
                                            <th className="py-2.5 px-3 text-center">% Komisi</th>
                                            <th className="py-2.5 px-3 text-right">Nominal Komisi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {commItems.map(item => {
                                            const rec = item.treatment_records
                                            const priceAtTime = Number(item.price_at_time || 0)
                                            const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                                                ? Number(item.original_price)
                                                : priceAtTime
                                            const commPercent = Number(item.commission_percent || 0)
                                            const commAmount = Math.round(basePrice * (commPercent / 100))

                                            return (
                                                <tr key={item.id} className="hover:bg-slate-50/50">
                                                    <td className="py-2 px-3 text-slate-700 font-medium whitespace-nowrap">
                                                        {rec?.treatment_date || '-'}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-700 whitespace-nowrap font-semibold">
                                                        {rec?.branches?.name || '-'}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-900 font-bold whitespace-nowrap">
                                                        {rec?.patients?.full_name || '-'}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-800">
                                                        {item.treatments?.name || item.notes || '-'}
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-medium text-slate-600">
                                                        Rp {basePrice.toLocaleString('id-ID')}
                                                    </td>
                                                    <td className="py-2 px-3 text-center font-bold text-slate-700">
                                                        {commPercent}%
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-extrabold text-[#ba5d45]">
                                                        Rp {commAmount.toLocaleString('id-ID')}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* SECTION 2: TODAY'S TREATMENT QUEUE LIST */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 md:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            Antrean Pasien Hari Ini
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Daftar janji temu pasien di cabang {dbUser?.branches?.name || 'klinik'} untuk hari ini ({new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}).
                        </p>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/70">
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
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-100">
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
                            const isInfus = treatmentsList.toLowerCase().includes('infus')

                            return (
                                <div 
                                    key={apt.id}
                                    className={`rounded-xl border p-4 transition-all shadow-2xs flex flex-col justify-between ${
                                        isCompleted ? 'bg-slate-50 border-slate-200 opacity-80' :
                                        isMyTask ? 'bg-white border-pink-300 ring-1 ring-pink-200' :
                                        'bg-white border-slate-200'
                                    }`}
                                >
                                    <div>
                                        {/* Card Header: Time & Badges */}
                                        <div className="flex justify-between items-center pb-2 mb-2.5 border-b border-slate-100 text-xs">
                                            <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                                                {startTime} - {endTime}
                                            </span>
                                            
                                            {isCompleted ? (
                                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded text-[10.5px] border border-emerald-200/60">
                                                    Selesai
                                                </span>
                                            ) : apt.arrival_status === 'arrived' ? (
                                                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 font-bold rounded text-[10.5px] border border-amber-200/60 animate-pulse">
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
                                        <div className="font-bold text-slate-900 text-base tracking-tight truncate">
                                            {apt.patients?.full_name || 'Nama Pasien'}
                                        </div>

                                        {/* Treatment Details */}
                                        <div className={`text-xs font-semibold mt-1.5 px-2.5 py-1 rounded truncate border ${
                                            isInfus ? 'bg-cyan-50 text-cyan-900 border-cyan-200/80' : 'bg-slate-50 text-slate-800 border-slate-200/80'
                                        }`}>
                                            {treatmentsList}
                                        </div>

                                        {/* Therapist info */}
                                        <div className="text-[11px] text-slate-500 font-medium mt-2.5 flex items-center gap-1">
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
                                                    className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors text-[11px] font-semibold cursor-pointer"
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
                                                    className="px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                                >
                                                    {claimingAptId === apt.id ? 'Memilih...' : 'Ambil Tugas'}
                                                </button>
                                            )}

                                            {isMyTask && apt.arrival_status === 'arrived' && !isCompleted && (
                                                <button
                                                    onClick={() => handleTherapistReady(apt)}
                                                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                                >
                                                    Saya Siap
                                                </button>
                                            )}

                                            {!isCompleted && (
                                                <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                    <button className="px-3 py-1 rounded bg-ayumi-primary hover:bg-[#9a4b75] text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer">
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
