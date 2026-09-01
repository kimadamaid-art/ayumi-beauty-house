'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { supabase } from '@/lib/supabaseClient'
import DateRangePicker from '@/components/DateRangePicker'
import TherapistPatientHistoryModal from '@/components/ui/TherapistPatientHistoryModal'
import { notifyTherapistReady } from '@/lib/notifications'
import { getCommissionBasePrice, calculateTherapistCommission, buildCouponPriceMap } from '@/lib/commissionUtils'

export default function TherapistDashboard() {
    const router = useRouter()

    const [dbUser, setDbUser] = useState(null)
    const [selectedBranch, setSelectedBranch] = useState('')
    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(true)
    const [claimingAptId, setClaimingAptId] = useState(null)
    const [selectedPatientIdForHistory, setSelectedPatientIdForHistory] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState('')

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
            // Ambil kupon usage logs untuk mencocokkan harga riil per sesi kupon
            const { data: cLogs } = await supabase
                .from('coupon_usage_logs')
                .select(`
                    id,
                    treatment_record_id,
                    patient_coupon_items(
                        total_sessions,
                        patient_coupons(
                            package_id,
                            transaction_id,
                            coupon_packages(price),
                            transactions(
                                total,
                                transaction_items(item_type, price, subtotal)
                            )
                        )
                    )
                `)

            const couponMap = buildCouponPriceMap(cLogs || [])
            const enhanced = data.map(it => ({
                ...it,
                proportional_coupon_price: it.treatment_records?.id ? couponMap[it.treatment_records.id] : null
            }))

            setCommItems(enhanced)
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
            const basePrice = getCommissionBasePrice(item)
            const commAmount = calculateTherapistCommission(item)

            totalRevenue += (priceAtTime > 0 ? priceAtTime : (item.proportional_coupon_price || basePrice))
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

            // Kirim notifikasi realtime ke seluruh Admin cabang & Owner
            await notifyTherapistReady({
                supabase,
                appointment: apt,
                therapistUser: dbUser
            })

            toast.success('Status berhasil diperbarui! Admin / Kasir telah diberi tahu.')
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

    const getArrivalStatusBadgeAndActions = (apt) => {
        if (apt.status === 'completed' || apt.status === 'cancelled') return null

        const status = apt.arrival_status || 'not_arrived'
        const isMyPatient = apt.therapist_id === dbUser?.id
        const isUnassigned = !apt.therapist_id

        if (isUnassigned) {
            return (
                <button
                    onClick={() => handleClaimAppointment(apt.id)}
                    disabled={claimingAptId === apt.id}
                    className="text-[10.5px] font-extrabold text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded-md transition-colors shadow-2xs cursor-pointer"
                >
                    {claimingAptId === apt.id ? 'Memilih...' : 'Pilih Pasien'}
                </button>
            )
        }

        if (status === 'arrived' && isMyPatient) {
            return (
                <button
                    onClick={() => handleTherapistReady(apt)}
                    className="text-[10.5px] font-extrabold text-white bg-green-600 hover:bg-green-700 px-2.5 py-1 rounded-md transition-colors shadow-2xs cursor-pointer animate-pulse"
                >
                    Saya Siap!
                </button>
            )
        }

        if (status === 'arrived') {
            return (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold border bg-amber-50 text-amber-700 border-amber-200 animate-pulse">
                    Pasien Datang
                </span>
            )
        }

        if (status === 'therapist_ready') {
            return (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold border bg-green-50 text-green-700 border-green-200">
                    Terapis Siap
                </span>
            )
        }

        if (status === 'in_treatment') {
            return (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold border bg-sky-50 text-sky-700 border-sky-200">
                    Di Ruangan
                </span>
            )
        }

        return null
    }

    const filteredAppointments = useMemo(() => {
        return appointments.filter(apt => {
            if (apt.status === 'cancelled') return false
            if (filterStatus && apt.status !== filterStatus) return false
            if (searchQuery) {
                const query = searchQuery.toLowerCase()
                const name = apt.patients?.full_name?.toLowerCase() || ''
                const wa = apt.patients?.whatsapp || ''
                if (!name.includes(query) && !wa.includes(query)) return false
            }
            return true
        })
    }, [appointments, filterStatus, searchQuery])

    // Categorized Appointments Today
    const todayAppointments = appointments.filter(a => a.appointment_date === todayStr && a.status !== 'cancelled')
    const myTodayAppointments = todayAppointments.filter(a => a.therapist_id === dbUser?.id)
    const arrivedWaitingToday = myTodayAppointments.filter(a => a.arrival_status === 'arrived' && a.status !== 'completed')
    const completedToday = myTodayAppointments.filter(a => a.status === 'completed')

    return (
        <div className="space-y-6 w-full pb-10">
            {/* SECTION 1: PERFORMANCE & COMMISSION WIDGET */}
            <div className="card-ayumi p-4 md:p-6 shadow-sm border border-pink-100/60 space-y-4">
                {/* Header Filter Bar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-gray-100">
                    <div>
                        <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                            PERFORMA & KOMISI SAYA
                        </h2>
                        <p className="text-xs text-slate-400 font-medium">
                            Akumulasi seluruh tindakan perawatan dan komisi dari seluruh cabang klinik.
                        </p>
                    </div>

                    {/* Period Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-pink-50/70 p-1 rounded-2xl border border-pink-100 text-xs font-bold">
                            <button
                                onClick={() => handleCommPresetChange('today')}
                                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                                    commPeriodPreset === 'today' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-slate-600 hover:text-ayumi-primary'
                                }`}
                            >
                                Hari Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('week')}
                                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                                    commPeriodPreset === 'week' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-slate-600 hover:text-ayumi-primary'
                                }`}
                            >
                                Minggu Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('month')}
                                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                                    commPeriodPreset === 'month' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-slate-600 hover:text-ayumi-primary'
                                }`}
                            >
                                Bulan Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('custom')}
                                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                                    commPeriodPreset === 'custom' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-slate-600 hover:text-ayumi-primary'
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
                                inputClassName="text-xs font-semibold py-1.5 px-3"
                            />
                        )}
                    </div>
                </div>

                {/* 4 Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Card 1: Warm Terracotta Gradient Commission Card */}
                    <div className="bg-gradient-to-r from-[#ba5d45] via-[#a84c35] to-[#8f3a25] rounded-2xl p-5 text-white shadow-sm flex flex-col justify-between">
                        <div className="text-[11px] font-bold text-orange-200 uppercase tracking-wider">
                            TOTAL KOMISI DITERIMA
                        </div>
                        <div className="text-2xl lg:text-3xl font-black tracking-tight mt-2 text-white">
                            Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                        </div>
                        <div className="text-[11px] text-orange-100/90 font-medium mt-3">
                            Akumulasi komisi seluruh cabang
                        </div>
                    </div>

                    {/* Card 2: Tindakan Selesai */}
                    <div className="bg-white border border-pink-100/70 rounded-2xl p-5 flex flex-col justify-between shadow-2xs">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>TINDAKAN SELESAI</span>
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-slate-800 mt-2">
                            {commSummary.treatmentCount} <span className="text-xs font-semibold text-slate-400">Tindakan</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3">
                            Total tindakan yang Anda kerjakan
                        </div>
                    </div>

                    {/* Card 3: Tugas Hari Ini */}
                    <div className="bg-white border border-pink-100/70 rounded-2xl p-5 flex flex-col justify-between shadow-2xs">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>TUGAS HARI INI</span>
                            <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                        </div>
                        <div className="text-2xl lg:text-3xl font-black text-slate-800 mt-2">
                            {myTodayAppointments.length} <span className="text-xs font-semibold text-slate-400">Pasien</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-3 flex items-center gap-1.5">
                            <span className="text-emerald-700 font-bold">{completedToday.length} selesai</span>
                            <span>•</span>
                            <span className="text-amber-700 font-bold">{myTodayAppointments.length - completedToday.length} menunggu</span>
                        </div>
                    </div>

                    {/* Card 4: Pasien Tiba di Klinik */}
                    <div className="bg-white border border-pink-100/70 rounded-2xl p-5 flex flex-col justify-between shadow-2xs">
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>TIBA DI KLINIK</span>
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
                        className="text-xs font-bold text-slate-600 hover:text-ayumi-primary flex items-center gap-1.5 py-1 cursor-pointer transition-colors"
                    >
                        <span>{isCommDetailOpen ? '▼ Sembunyikan Rincian Komisi' : '▶ Tampilkan Rincian Komisi per Tindakan'}</span>
                        <span className="text-[11px] font-medium text-slate-400">({commItems.length} item)</span>
                    </button>

                    {isCommDetailOpen && (
                        <div className="mt-3 overflow-x-auto border border-pink-100 rounded-2xl">
                            {commLoading ? (
                                <div className="text-center py-8 text-xs text-slate-400">Memuat rincian...</div>
                            ) : commItems.length === 0 ? (
                                <div className="text-center py-8 text-xs text-slate-400">Tidak ada data komisi untuk periode ini.</div>
                            ) : (
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-pink-50/60 text-slate-700 font-extrabold border-b border-pink-100">
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
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {commItems.map(item => {
                                            const rec = item.treatment_records
                                            const basePrice = getCommissionBasePrice(item)
                                            const commPercent = Number(item.commission_percent || 0)
                                            const commAmount = calculateTherapistCommission(item)

                                            return (
                                                <tr key={item.id} className="hover:bg-pink-50/20">
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

            {/* SECTION 2: SCHEDULE TIMELINE VIEW (IDENTICAL COMPACT DESIGN) */}
            <div className="card-ayumi p-3.5 sm:p-5 shadow-sm border border-pink-100/50 space-y-4">
                {/* Filter Bar */}
                <div className="flex flex-col md:flex-row gap-2.5 mb-4">
                    <div className="flex-1 relative">
                        <svg className="w-4 h-4 absolute left-3.5 top-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input 
                            type="text" 
                            placeholder="Cari nama pasien atau WhatsApp..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-10 py-2 text-xs bg-gray-50/50 focus:bg-white"
                        />
                    </div>
                    <DateRangePicker 
                        startDate={scheduleStartDate}
                        endDate={scheduleEndDate}
                        onChange={(range) => {
                            setScheduleStartDate(range.startDate);
                            setScheduleEndDate(range.endDate);
                        }}
                        inputClassName="text-xs font-semibold py-2"
                    />
                    <select 
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="input-ayumi bg-gray-50/50 focus:bg-white w-full md:w-auto text-xs py-2"
                    >
                        <option value="">Semua Status</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                        <option value="no_show">No Show</option>
                    </select>
                </div>

                {loading ? (
                    <div className="text-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ayumi-primary mx-auto mb-3"></div>
                        <p className="text-gray-500 font-medium text-xs">Memuat jadwal...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Section Header */}
                        <div className="flex justify-between items-center bg-gray-50/80 p-2 rounded-xl border border-gray-100 mb-2">
                            <div className="text-[11px] font-extrabold text-gray-500 flex items-center gap-1.5 pl-1">
                                <svg className="w-3.5 h-3.5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Papan Jadwal Janji Temu Pasien
                            </div>
                        </div>

                        {/* SCHEDULE TIMELINE VIEW WITH INFUS & TREATMENT COLUMNS */}
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
                            filteredAppointments.forEach(apt => {
                                const d = apt.appointment_date
                                if (!groupedByDate[d]) groupedByDate[d] = []
                                groupedByDate[d].push(apt)
                            })

                            if (searchQuery && filteredAppointments.length === 0) {
                                return (
                                    <div className="py-12 text-center flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-100">
                                        <div className="w-12 h-12 bg-pink-50 rounded-full flex items-center justify-center mb-3 mx-auto">
                                            <svg className="w-6 h-6 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        </div>
                                        <p className="text-gray-500 font-medium text-sm">Pasien "{searchQuery}" tidak ditemukan pada jadwal.</p>
                                        <p className="text-xs text-gray-400 mt-1">Coba sesuaikan kata kunci pencarian Anda.</p>
                                    </div>
                                )
                            }

                            const rangeDates = getDatesInRange(scheduleStartDate, scheduleEndDate)
                            const dateSet = new Set(rangeDates)
                            Object.keys(groupedByDate).forEach(d => dateSet.add(d))
                            const sortedDates = Array.from(dateSet).sort()

                            if (sortedDates.length === 0) {
                                return (
                                    <div className="py-12 text-center flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-100">
                                        <div className="w-12 h-12 bg-pink-50 rounded-full flex items-center justify-center mb-3 mx-auto">
                                            <svg className="w-6 h-6 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        </div>
                                        <p className="text-gray-500 font-medium text-sm">Silakan pilih tanggal untuk melihat jadwal temu.</p>
                                    </div>
                                )
                            }

                            return (
                                <div className="space-y-6">
                                    {sortedDates.map(dateStr => {
                                        const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
                                            weekday: 'long',
                                            day: 'numeric',
                                            month: 'long',
                                            year: 'numeric'
                                        })

                                        const dayApts = groupedByDate[dateStr] || []
                                        const totalInfus = dayApts.filter(a => isInfusAppointment(a)).length
                                        const totalTreatment = dayApts.length - totalInfus

                                        return (
                                            <div key={dateStr} className="bg-white rounded-2xl border border-pink-100/60 p-3 sm:p-4.5 shadow-xs overflow-hidden">
                                                {/* Date Section Header */}
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 mb-3 border-b border-gray-100">
                                                    <div className="flex items-center gap-2">
                                                        <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                                                            {formattedDate}
                                                        </h3>
                                                    </div>

                                                    <div className="flex items-center gap-2 text-[11px] font-bold">
                                                        <span className="bg-sky-50 text-sky-700 px-2.5 py-0.5 rounded-full border border-sky-100 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                                            {totalTreatment} Treatment
                                                        </span>
                                                        <span className="bg-cyan-50 text-cyan-700 px-2.5 py-0.5 rounded-full border border-cyan-100 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
                                                            {totalInfus} Infus
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Scrollable Schedule Board Sheet */}
                                                <div className="overflow-x-auto custom-scrollbar pb-1.5">
                                                    <div className="min-w-[780px]">
                                                        {/* Grid Column Headers */}
                                                        <div className="flex items-center gap-3 pb-2 mb-1.5 border-b border-slate-100 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                                            <div className="w-14 flex-shrink-0 text-slate-400 font-extrabold pl-1 text-[10px] uppercase tracking-wider">WAKTU</div>
                                                            <div className="w-56 sm:w-60 flex-shrink-0 flex items-center gap-1.5 text-cyan-800 bg-cyan-100/70 px-3 py-1 rounded-full border border-cyan-300 font-bold text-[10px] uppercase tracking-wider">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
                                                                LAYANAN INFUS
                                                            </div>
                                                            <div className="flex-1 flex items-center gap-1.5 text-sky-800 bg-sky-100/70 px-3 py-1 rounded-full border border-sky-300 font-bold text-[10px] uppercase tracking-wider">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                                                LAYANAN TREATMENT
                                                            </div>
                                                        </div>

                                                        {/* Hourly Timeline Grid Rows */}
                                                        <div className="space-y-0 divide-y divide-slate-100">
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
                                                                    <div key={hourStr} className="flex items-stretch gap-3 py-2 border-b border-slate-100 hover:bg-slate-50/30 transition-colors min-h-[50px]">
                                                                        {/* Waktu (Far Left) */}
                                                                        <div className="w-14 flex-shrink-0 pt-1">
                                                                            <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60 inline-block">
                                                                                {hourStr}
                                                                            </span>
                                                                        </div>

                                                                        {/* Column 1: Infus (Left Column) */}
                                                                        <div className="w-56 sm:w-60 flex-shrink-0 border-l border-slate-100 pl-2.5 flex flex-col justify-center min-h-[40px]">
                                                                            {infusApts.length === 0 ? (
                                                                                <div className="w-full min-h-[36px] border border-dashed border-slate-200/80 rounded-lg flex items-center px-2.5 text-[11px] text-slate-400 font-medium">
                                                                                    <span className="opacity-60">- Kosong -</span>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex flex-col gap-1.5 w-full">
                                                                                    {infusApts.map(apt => {
                                                                                        const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Infus'
                                                                                        const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                        const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''

                                                                                        return (
                                                                                            <div 
                                                                                                key={apt.id}
                                                                                                className="bg-[#ebf9fb] border border-cyan-300 hover:border-cyan-400 text-slate-800 rounded-lg p-2.5 w-full shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
                                                                                            >
                                                                                                <div>
                                                                                                    {/* Header: Time & Badges */}
                                                                                                    <div className="flex justify-between items-center text-[10.5px] font-bold text-cyan-950 pb-1 mb-1 border-b border-cyan-200/70">
                                                                                                        <span className="flex items-center gap-1 text-cyan-900 font-bold text-[10.5px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-2xs"></span>
                                                                                                            {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        {apt.therapist_id === dbUser?.id && (
                                                                                                            <span className="text-[9.5px] font-bold bg-cyan-200/80 text-cyan-800 px-1.5 py-0.2 rounded">
                                                                                                                Tugas Anda
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>

                                                                                                    {/* Customer Name */}
                                                                                                    <div className="font-bold text-xs text-slate-900 tracking-tight truncate">
                                                                                                        {apt.patients?.full_name || 'Pasien'}
                                                                                                    </div>

                                                                                                    {/* Treatment list */}
                                                                                                    <div className="text-[10px] text-cyan-950 font-medium mt-0.5 bg-white/80 px-1.5 py-0.5 rounded border border-cyan-200/80 inline-block shadow-2xs truncate max-w-full">
                                                                                                        {treatmentsList}
                                                                                                    </div>

                                                                                                    {/* Therapist & Branch Info */}
                                                                                                    {(apt.therapist?.full_name || apt.branches?.name) && (
                                                                                                        <div className="text-[9.5px] text-cyan-900/80 font-medium mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 truncate">
                                                                                                            {apt.branches?.name && <span>Cabang: <b className="font-bold text-slate-800">{apt.branches.name}</b></span>}
                                                                                                            {apt.therapist?.full_name && <span>• {apt.therapist.full_name.split(' ')[0]}</span>}
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>

                                                                                                {/* Footer: Actions */}
                                                                                                <div className="mt-2 pt-1.5 border-t border-cyan-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getArrivalStatusBadgeAndActions(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {apt.patients?.id && (
                                                                                                            <button
                                                                                                                type="button"
                                                                                                                onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                                className="text-[9.5px] font-bold text-slate-700 hover:text-ayumi-primary bg-white/80 hover:bg-white px-1.5 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                                                                                                                title="Lihat Rekam Medis"
                                                                                                            >
                                                                                                                Medis
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                            <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                                <button
                                                                                                                    className="text-[9.5px] font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded transition-all shadow-2xs cursor-pointer"
                                                                                                                    title="Input Treatment & SOAP Medis"
                                                                                                                >
                                                                                                                    Input Treatment
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

                                                                        {/* Column 2: Treatment (Strict Horizontal Row) */}
                                                                        <div className="flex-1 border-l border-slate-100 pl-2.5 flex items-center min-h-[40px]">
                                                                            {treatmentApts.length === 0 ? (
                                                                                <div className="w-full min-h-[36px] border border-dashed border-slate-200/80 rounded-lg flex items-center px-2.5 text-[11px] text-slate-400 font-medium">
                                                                                    <span className="opacity-60">- Kosong -</span>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex flex-row flex-nowrap items-stretch gap-2.5 py-0.5 w-full overflow-x-auto custom-scrollbar">
                                                                                    {treatmentApts.map(apt => {
                                                                                        const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Treatment'
                                                                                        const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                        const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''

                                                                                        return (
                                                                                            <div 
                                                                                                key={apt.id}
                                                                                                className="bg-[#ebf6fe] border border-sky-300 hover:border-sky-400 text-slate-800 rounded-lg p-2.5 w-[230px] min-w-[230px] flex-shrink-0 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
                                                                                            >
                                                                                                <div>
                                                                                                    {/* Header: Time & Badges */}
                                                                                                    <div className="flex justify-between items-center text-[10.5px] font-bold text-sky-950 pb-1 mb-1 border-b border-sky-200/70">
                                                                                                        <span className="flex items-center gap-1 text-sky-900 font-bold text-[10.5px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shadow-2xs"></span>
                                                                                                            {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        {apt.therapist_id === dbUser?.id ? (
                                                                                                            <span className="text-[9.5px] font-bold bg-sky-200/80 text-sky-800 px-1.5 py-0.2 rounded">
                                                                                                                Pasien Anda
                                                                                                            </span>
                                                                                                        ) : !apt.therapist_id ? (
                                                                                                            <span className="text-[9.5px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded">
                                                                                                                Tersedia
                                                                                                            </span>
                                                                                                        ) : null}
                                                                                                    </div>

                                                                                                    {/* Customer Name */}
                                                                                                    <div className="font-bold text-xs text-slate-900 tracking-tight truncate">
                                                                                                        {apt.patients?.full_name || 'Pasien'}
                                                                                                    </div>

                                                                                                    {/* Treatment list */}
                                                                                                    <div className="text-[10px] text-sky-950 font-medium mt-0.5 bg-white/80 px-1.5 py-0.5 rounded border border-sky-200/80 inline-block shadow-2xs truncate max-w-full">
                                                                                                        {treatmentsList}
                                                                                                    </div>

                                                                                                    {/* Therapist & Branch Info */}
                                                                                                    {(apt.therapist?.full_name || apt.branches?.name) && (
                                                                                                        <div className="text-[9.5px] text-sky-900/80 font-medium mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 truncate">
                                                                                                            {apt.branches?.name && <span>Cabang: <b className="font-bold text-slate-800">{apt.branches.name}</b></span>}
                                                                                                            {apt.therapist?.full_name && <span>• {apt.therapist.full_name.split(' ')[0]}</span>}
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>

                                                                                                {/* Footer: Actions */}
                                                                                                <div className="mt-2 pt-1.5 border-t border-sky-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getArrivalStatusBadgeAndActions(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {apt.patients?.id && (
                                                                                                            <button
                                                                                                                type="button"
                                                                                                                onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                                className="text-[9.5px] font-bold text-slate-700 hover:text-ayumi-primary bg-white/80 hover:bg-white px-1.5 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                                                                                                                title="Lihat Rekam Medis"
                                                                                                            >
                                                                                                                Medis
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                            <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                                <button
                                                                                                                    className="text-[9.5px] font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded transition-all shadow-2xs cursor-pointer"
                                                                                                                    title="Input Treatment & SOAP Medis"
                                                                                                                >
                                                                                                                    Input Treatment
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
                                    })}
                                </div>
                            )
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
