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

    // Helper Date
    const getLocalDateString = (date = new Date()) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const todayStr = getLocalDateString()

    // Timeline Schedule States
    const [scheduleStartDate, setScheduleStartDate] = useState(todayStr)
    const [scheduleEndDate, setScheduleEndDate] = useState(todayStr)
    const SCHEDULE_HOURS = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00']

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
    }, [selectedBranch, scheduleStartDate, scheduleEndDate])

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

        // Default commission to this month
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
            .gte('appointment_date', scheduleStartDate)
            .lte('appointment_date', scheduleEndDate)
            .order('appointment_date', { ascending: true })
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

    const isInfusAppointment = (apt) => {
        if (!apt) return false
        const treatmentNames = apt.appointment_treatments?.map(at => at.treatments?.name || '').join(' ').toLowerCase() || ''
        const categoryNames = apt.appointment_treatments?.map(at => at.treatments?.treatment_categories?.name || '').join(' ').toLowerCase() || ''
        const notes = (apt.notes || '').toLowerCase()

        return treatmentNames.includes('infus') || categoryNames.includes('infus') || notes.includes('infus')
    }

    const getTherapistArrivalActions = (apt) => {
        if (apt.status === 'completed' || apt.status === 'cancelled') return null

        const status = apt.arrival_status || 'not_arrived'
        const isMyPatient = apt.therapist_id === dbUser?.id
        const isUnassigned = !apt.therapist_id

        if (isUnassigned) {
            return (
                <button
                    onClick={() => handleClaimAppointment(apt.id)}
                    disabled={claimingAptId === apt.id}
                    className="text-[10px] font-bold text-white bg-slate-900 hover:bg-slate-800 px-2 py-0.5 rounded transition-colors cursor-pointer"
                >
                    {claimingAptId === apt.id ? 'Memilih...' : 'Pilih Pasien'}
                </button>
            )
        }

        if (status === 'arrived' && isMyPatient) {
            return (
                <button
                    onClick={() => handleTherapistReady(apt)}
                    className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded transition-colors cursor-pointer animate-pulse"
                >
                    Saya Siap
                </button>
            )
        }

        return null
    }

    // Categorized Appointments Today
    const todayAppointments = appointments.filter(a => a.appointment_date === todayStr && a.status !== 'cancelled')
    const myTodayAppointments = todayAppointments.filter(a => a.therapist_id === dbUser?.id)
    const arrivedWaitingToday = myTodayAppointments.filter(a => a.arrival_status === 'arrived' && a.status !== 'completed')
    const completedToday = myTodayAppointments.filter(a => a.status === 'completed')

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
                            <span>Dashboard & Jadwal Kerja</span>
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
                        <button className="text-xs font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-3.5 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer">
                            Riwayat Treatment
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
                            <span>Tugas Hari Ini</span>
                            <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-slate-900 mt-2">
                            {myTodayAppointments.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3 flex items-center gap-1.5">
                            <span className="text-emerald-700 font-bold">{completedToday.length} selesai</span>
                            <span>•</span>
                            <span className="text-amber-700 font-bold">{myTodayAppointments.length - completedToday.length} menunggu</span>
                        </div>
                    </div>

                    {/* Card 4: Pasien Tiba di Klinik */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>Tiba di Klinik</span>
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-amber-600 mt-2">
                            {arrivedWaitingToday.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3">
                            {arrivedWaitingToday.length > 0 ? 'Siap dipanggil ke ruangan' : 'Belum ada pasien menunggu'}
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

            {/* SECTION 2: TIMELINE SCHEDULE BOARD (08.00 - 20.00) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 md:p-6 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            Papan Jadwal Pasien
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Papan timeline janji temu pasien cabang {dbUser?.branches?.name || 'klinik'} (08.00 - 20.00).
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <DateRangePicker
                            startDate={scheduleStartDate}
                            endDate={scheduleEndDate}
                            onChange={(range) => {
                                setScheduleStartDate(range.startDate)
                                setScheduleEndDate(range.endDate)
                            }}
                            inputClassName="text-xs font-semibold py-1.5 px-3"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mx-auto mb-3"></div>
                        <p className="text-slate-500 font-medium text-xs">Memuat jadwal...</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {(() => {
                            const getDatesInRange = (startStr, endStr) => {
                                if (!startStr || !endStr) return []
                                const dates = []
                                const cur = new Date(startStr + 'T00:00:00')
                                const end = new Date(endStr + 'T00:00:00')
                                let count = 0
                                while (cur <= end && count < 31) {
                                    const year = cur.getFullYear()
                                    const month = String(cur.getMonth() + 1).padStart(2, '0')
                                    const day = String(cur.getDate()).padStart(2, '0')
                                    dates.push(`${year}-${month}-${day}`)
                                    cur.setDate(cur.getDate() + 1)
                                    count++
                                }
                                return dates
                            }

                            const groupedByDate = {}
                            appointments.forEach(apt => {
                                const d = apt.appointment_date
                                if (!groupedByDate[d]) groupedByDate[d] = []
                                groupedByDate[d].push(apt)
                            })

                            const dateList = getDatesInRange(scheduleStartDate, scheduleEndDate)

                            if (dateList.length === 0) {
                                return (
                                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-100">
                                        <p className="text-xs text-slate-400">Tidak ada rentang tanggal dipilih.</p>
                                    </div>
                                )
                            }

                            return dateList.map(dateStr => {
                                const dayApts = groupedByDate[dateStr] || []
                                const dateObj = new Date(dateStr + 'T00:00:00')
                                const isToday = dateStr === todayStr
                                const dateFormatted = dateObj.toLocaleDateString('id-ID', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric'
                                })

                                const totalInfus = dayApts.filter(a => isInfusAppointment(a)).length
                                const totalTreatment = dayApts.filter(a => !isInfusAppointment(a)).length

                                return (
                                    <div key={dateStr} className={`rounded-xl border transition-all ${isToday ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50/40'} p-4 md:p-5 shadow-2xs`}>
                                        {/* Date Subheader */}
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 mb-3 border-b border-slate-200">
                                            <div className="flex items-center gap-2.5">
                                                <h4 className="text-sm font-bold text-slate-900">
                                                    {dateFormatted}
                                                </h4>
                                                {isToday && (
                                                    <span className="bg-ayumi-primary text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                        Hari Ini
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 text-xs font-semibold">
                                                <span className="bg-sky-50 text-sky-800 px-2.5 py-0.5 rounded-md border border-sky-200/70">
                                                    {totalTreatment} Treatment
                                                </span>
                                                <span className="bg-cyan-50 text-cyan-800 px-2.5 py-0.5 rounded-md border border-cyan-200/70">
                                                    {totalInfus} Infus
                                                </span>
                                            </div>
                                        </div>

                                        {/* Scrollable Schedule Board */}
                                        <div className="overflow-x-auto custom-scrollbar pb-2">
                                            <div className="min-w-[850px]">
                                                {/* Column Headers */}
                                                <div className="flex items-center gap-4 pb-2 mb-2 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                                    <div className="w-16 flex-shrink-0 text-slate-400 font-bold pl-1 text-[11px]">WAKTU</div>
                                                    <div className="w-72 flex-shrink-0 text-cyan-900 bg-cyan-50 px-3 py-1 rounded-md border border-cyan-200 font-bold text-[11px]">
                                                        LAYANAN INFUS
                                                    </div>
                                                    <div className="flex-1 text-sky-900 bg-sky-50 px-3 py-1 rounded-md border border-sky-200 font-bold text-[11px]">
                                                        LAYANAN TREATMENT
                                                    </div>
                                                </div>

                                                {/* Hourly Timeline Rows */}
                                                <div className="divide-y divide-slate-100">
                                                    {SCHEDULE_HOURS.map(hourStr => {
                                                        const hourNum = parseInt(hourStr.split('.')[0], 10)
                                                        const hourApts = dayApts.filter(apt => {
                                                            if (!apt.start_time) return false
                                                            const h = parseInt(apt.start_time.split(':')[0], 10)
                                                            return h === hourNum
                                                        })

                                                        const infusApts = hourApts.filter(a => isInfusAppointment(a))
                                                        const treatmentApts = hourApts.filter(a => !isInfusAppointment(a))

                                                        return (
                                                            <div key={hourStr} className="flex items-stretch gap-4 py-2 border-b border-slate-100 hover:bg-slate-50/50 transition-colors min-h-[54px]">
                                                                {/* Time Column */}
                                                                <div className="w-16 flex-shrink-0 pt-1">
                                                                    <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 inline-block">
                                                                        {hourStr}
                                                                    </span>
                                                                </div>

                                                                {/* Column 1: Infus */}
                                                                <div className="w-72 flex-shrink-0 border-l border-slate-100 pl-3 flex flex-col justify-center min-h-[44px]">
                                                                    {infusApts.length === 0 ? (
                                                                        <div className="w-full min-h-[36px] border border-dashed border-slate-200/70 rounded-lg flex items-center px-3 text-slate-400">
                                                                            <span className="italic text-[11px]">- Kosong -</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex flex-col gap-2 w-full">
                                                                            {infusApts.map(apt => {
                                                                                const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Infus'
                                                                                const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''
                                                                                const isMyPatient = apt.therapist_id === dbUser?.id

                                                                                return (
                                                                                    <div 
                                                                                        key={apt.id}
                                                                                        className={`border rounded-lg p-2.5 w-full shadow-2xs transition-all flex flex-col justify-between ${
                                                                                            isMyPatient ? 'bg-cyan-50/80 border-cyan-300 ring-1 ring-cyan-200' : 'bg-slate-50 border-slate-200'
                                                                                        }`}
                                                                                    >
                                                                                        <div>
                                                                                            <div className="flex justify-between items-center text-xs font-bold pb-1 mb-1 border-b border-cyan-200/60">
                                                                                                <span className="text-cyan-900 font-extrabold text-[11px]">
                                                                                                    {startTime} - {endTime}
                                                                                                </span>
                                                                                                {isMyPatient && (
                                                                                                    <span className="text-[10px] font-bold bg-cyan-200/70 text-cyan-800 px-1.5 py-0.2 rounded">
                                                                                                        Tugas Anda
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>

                                                                                            <div className="font-bold text-sm text-slate-900 truncate">
                                                                                                {apt.patients?.full_name || 'Pasien'}
                                                                                            </div>

                                                                                            <div className="text-[11px] text-cyan-900 font-medium mt-0.5 bg-white px-2 py-0.5 rounded border border-cyan-200/70 truncate">
                                                                                                {treatmentsList}
                                                                                            </div>

                                                                                            <div className="text-[10.5px] text-slate-500 font-medium mt-1">
                                                                                                <span>Petugas: </span>
                                                                                                {apt.therapist?.full_name ? (
                                                                                                    <b className="font-bold text-slate-800">{apt.therapist.full_name}</b>
                                                                                                ) : (
                                                                                                    <span className="text-amber-700 font-bold">Belum Ada Terapis</span>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>

                                                                                        <div className="mt-2 pt-1.5 border-t border-cyan-200/50 flex items-center justify-between gap-1">
                                                                                            <div>{getTherapistArrivalActions(apt)}</div>
                                                                                            <div className="flex items-center gap-1">
                                                                                                {apt.patients?.id && (
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                        className="text-[10px] font-bold text-slate-700 bg-white hover:bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                                                                                                        title="Lihat Rekam Medis"
                                                                                                    >
                                                                                                        Medis
                                                                                                    </button>
                                                                                                )}
                                                                                                {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                    <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                        <button className="text-[10px] font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded transition-all cursor-pointer">
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

                                                                {/* Column 2: Treatment */}
                                                                <div className="flex-1 border-l border-slate-100 pl-3 flex items-center min-h-[44px]">
                                                                    {treatmentApts.length === 0 ? (
                                                                        <div className="w-full min-h-[36px] border border-dashed border-slate-200/70 rounded-lg flex items-center px-3 text-slate-400">
                                                                            <span className="italic text-[11px]">- Kosong -</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex flex-row flex-nowrap items-stretch gap-3 py-0.5 w-full overflow-x-auto custom-scrollbar">
                                                                            {treatmentApts.map(apt => {
                                                                                const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Treatment'
                                                                                const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''
                                                                                const isMyPatient = apt.therapist_id === dbUser?.id

                                                                                return (
                                                                                    <div 
                                                                                        key={apt.id}
                                                                                        className={`border rounded-lg p-2.5 w-[270px] min-w-[270px] flex-shrink-0 shadow-2xs transition-all flex flex-col justify-between ${
                                                                                            isMyPatient ? 'bg-sky-50/80 border-sky-300 ring-1 ring-sky-200' : 'bg-slate-50 border-slate-200'
                                                                                        }`}
                                                                                    >
                                                                                        <div>
                                                                                            <div className="flex justify-between items-center text-xs font-bold pb-1 mb-1 border-b border-sky-200/60">
                                                                                                <span className="text-sky-900 font-extrabold text-[11px]">
                                                                                                    {startTime} - {endTime}
                                                                                                </span>
                                                                                                {isMyPatient ? (
                                                                                                    <span className="text-[10px] font-bold bg-sky-200/70 text-sky-800 px-1.5 py-0.2 rounded">
                                                                                                        Tugas Anda
                                                                                                    </span>
                                                                                                ) : !apt.therapist_id ? (
                                                                                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded">
                                                                                                        Tersedia
                                                                                                    </span>
                                                                                                ) : null}
                                                                                            </div>

                                                                                            <div className="font-bold text-sm text-slate-900 truncate">
                                                                                                {apt.patients?.full_name || 'Pasien'}
                                                                                            </div>

                                                                                            <div className="text-[11px] text-slate-800 font-medium mt-0.5 bg-white px-2 py-0.5 rounded border border-slate-200 truncate">
                                                                                                {treatmentsList}
                                                                                            </div>

                                                                                            <div className="text-[10.5px] text-slate-500 font-medium mt-1">
                                                                                                <span>Terapis: </span>
                                                                                                {apt.therapist?.full_name ? (
                                                                                                    <b className="font-bold text-slate-800">{apt.therapist.full_name}</b>
                                                                                                ) : (
                                                                                                    <span className="text-amber-700 font-bold">Belum Ada Terapis</span>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>

                                                                                        <div className="mt-2 pt-1.5 border-t border-sky-200/50 flex items-center justify-between gap-1">
                                                                                            <div>{getTherapistArrivalActions(apt)}</div>
                                                                                            <div className="flex items-center gap-1">
                                                                                                {apt.patients?.id && (
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                        className="text-[10px] font-bold text-slate-700 bg-white hover:bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                                                                                                        title="Lihat Rekam Medis"
                                                                                                    >
                                                                                                        Medis
                                                                                                    </button>
                                                                                                )}
                                                                                                {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                    <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                        <button className="text-[10px] font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded transition-all cursor-pointer">
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
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        })()}
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
