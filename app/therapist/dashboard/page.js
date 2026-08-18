'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import DateRangePicker from '@/components/DateRangePicker'
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

    // Schedule Timeline States
    const getLocalDateString = (date = new Date()) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const [startDate, setStartDate] = useState(getLocalDateString())
    const [endDate, setEndDate] = useState(getLocalDateString())
    const [searchQuery, setSearchQuery] = useState('')
    const SCHEDULE_HOURS = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00']

    // Commission Widget States
    const todayStr = getLocalDateString()
    const [commPeriodPreset, setCommPeriodPreset] = useState('today') // 'today' | 'week' | 'month' | 'custom'
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
    }, [selectedBranch, startDate, endDate])

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
        fetchTherapistCommissions(userData.id, commStartDate, commEndDate)

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
            .gte('appointment_date', startDate)
            .lte('appointment_date', endDate)
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
        if (!userId || !start || !end) return
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
                treatment_records!inner(
                    id,
                    treatment_date,
                    treatment_time,
                    branch_id,
                    branches(name),
                    patient_id,
                    appointment_id,
                    patients(id, full_name),
                    performed_by
                ),
                treatments(id, name)
            `)
            .eq('treatment_records.performed_by', userId)
            .gte('treatment_records.treatment_date', start)
            .lte('treatment_records.treatment_date', end)

        if (!error && data) {
            const allPatientIds = Array.from(new Set(data.map(item => item.treatment_records?.patient_id).filter(Boolean)))

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
                            data.forEach(item => {
                                if (item.treatment_records?.patient_id && patientsMap[item.treatment_records.patient_id]) {
                                    item.treatment_records.patients = patientsMap[item.treatment_records.patient_id]
                                }
                            })
                        }
                    }
                } catch (e) {
                    console.error('Lookup error in dashboard commissions:', e)
                }
            }

            const sorted = data.sort((a, b) => {
                const dateA = new Date(`${a.treatment_records?.treatment_date}T${a.treatment_records?.treatment_time || '00:00:00'}`)
                const dateB = new Date(`${b.treatment_records?.treatment_date}T${b.treatment_records?.treatment_time || '00:00:00'}`)
                return dateB - dateA
            })
            setCommItems(sorted)
        } else {
            setCommItems([])
        }
        setCommLoading(false)
    }

    const handleCommPresetChange = (preset) => {
        setCommPeriodPreset(preset)
        const now = new Date()
        if (preset === 'today') {
            const dateStr = getLocalDateString(now)
            setCommStartDate(dateStr)
            setCommEndDate(dateStr)
        } else if (preset === 'week') {
            const d = new Date()
            const dayOfWeek = d.getDay()
            const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
            const monday = new Date(d.setDate(diffToMon))
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            setCommStartDate(getLocalDateString(monday))
            setCommEndDate(getLocalDateString(sunday))
        } else if (preset === 'month') {
            const y = now.getFullYear()
            const m = now.getMonth()
            const first = new Date(y, m, 1)
            const last = new Date(y, m + 1, 0)
            setCommStartDate(getLocalDateString(first))
            setCommEndDate(getLocalDateString(last))
        }
    }

    useEffect(() => {
        if (dbUser?.id && commStartDate && commEndDate) {
            fetchTherapistCommissions(dbUser.id, commStartDate, commEndDate)
        }
    }, [dbUser, commStartDate, commEndDate])

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

    const isInfusAppointment = (apt) => {
        if (!apt) return false
        const treatmentNames = apt.appointment_treatments?.map(at => at.treatments?.name || '').join(' ').toLowerCase() || ''
        const categoryNames = apt.appointment_treatments?.map(at => at.treatments?.treatment_categories?.name || '').join(' ').toLowerCase() || ''
        const notes = (apt.notes || '').toLowerCase()

        return treatmentNames.includes('infus') || categoryNames.includes('infus') || notes.includes('infus')
    }

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
            const todayStr = new Date().toISOString()
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({
                    arrival_status: 'therapist_ready',
                    therapist_ready_at: todayStr,
                    updated_at: todayStr
                })
                .eq('id', apt.id)

            if (aptErr) throw aptErr
            // Send notification to branch admins of this appointment (excluding owner)
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
                    className="text-[10px] font-extrabold text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded-md transition-colors shadow-2xs cursor-pointer"
                >
                    {claimingAptId === apt.id ? 'Memilih...' : 'Pilih Pasien'}
                </button>
            )
        }

        if (status === 'arrived' && isMyPatient) {
            return (
                <button
                    onClick={() => handleTherapistReady(apt)}
                    className="text-[10px] font-extrabold text-white bg-green-600 hover:bg-green-700 px-2 py-0.5 rounded-md transition-colors shadow-2xs cursor-pointer animate-pulse"
                >
                    Saya Siap!
                </button>
            )
        }

        if (status === 'therapist_ready') {
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse"></span>
                    Siap!
                </span>
            )
        }

        if (status === 'in_treatment') {
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1"></span>
                    Di Ruangan
                </span>
            )
        }

        if (status === 'arrived') {
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1"></span>
                    Tiba
                </span>
            )
        }

        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                Scheduled
            </span>
        )
    }

    const filteredAppointments = appointments.filter(apt => {
        if (apt.status === 'cancelled') return false
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            const name = apt.patients?.full_name?.toLowerCase() || ''
            const wa = apt.patients?.whatsapp || ''
            if (!name.includes(query) && !wa.includes(query)) return false
        }
        return true
    })

    return (
        <div className="space-y-6">
            {/* Top Therapist Status & Branch Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white px-5 py-3.5 rounded-2xl border border-pink-100/70 shadow-xs">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-ayumi-primary to-pink-400 text-white font-black text-sm flex items-center justify-center shadow-xs">
                        💆‍♀️
                    </div>
                    <div>
                        <div className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                            <span>Hai, <b className="text-ayumi-primary">{dbUser?.full_name || 'Terapis'}</b></span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-medium">
                            Pantau perolehan komisi dan jadwal pasien Anda hari ini.
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {dbUser?.branches?.name && (
                        <div className="flex items-center gap-1.5 bg-pink-50 border border-pink-100 text-ayumi-primary px-3 py-1.5 rounded-xl text-xs font-bold shrink-0">
                            <span className="w-2 h-2 rounded-full bg-ayumi-primary"></span>
                            <span>Cabang: <b className="text-slate-800 font-extrabold">{dbUser.branches.name}</b></span>
                        </div>
                    )}
                    <Link href="/therapist/appointments?tab=history">
                        <button className="text-xs font-bold text-ayumi-secondary hover:text-ayumi-primary bg-white hover:bg-pink-50/50 border border-pink-100 px-3 py-1.5 rounded-xl transition-all shadow-2xs flex items-center gap-1 cursor-pointer">
                            <span>📜 Riwayat</span>
                        </button>
                    </Link>
                </div>
            </div>

            {/* RINGKASAN & RINCIAN KOMISI TERAPIS WIDGET */}
            <div className="bg-white rounded-3xl border border-pink-100/70 p-5 md:p-6 shadow-sm space-y-5">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-gray-100 pb-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="px-3 py-1 bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white text-[11px] font-black rounded-full uppercase tracking-wider shadow-sm">
                                💰 Komisi Saya
                            </span>
                            <span className="text-xs text-gray-400 font-medium">
                                ({commStartDate === commEndDate ? new Date(commStartDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : `${new Date(commStartDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${new Date(commEndDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`})
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 font-medium">
                            Akumulasi komisi seluruh cabang (harian, mingguan, bulanan, atau custom).
                        </p>
                    </div>

                    {/* Filter Preset Buttons */}
                    <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                        <div className="bg-pink-50/80 p-1 rounded-2xl border border-pink-100 flex flex-wrap gap-1">
                            <button
                                onClick={() => handleCommPresetChange('today')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${commPeriodPreset === 'today' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                            >
                                Hari Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('week')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${commPeriodPreset === 'week' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                            >
                                Minggu Ini
                            </button>
                            <button
                                onClick={() => handleCommPresetChange('month')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${commPeriodPreset === 'month' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                            >
                                Bulan Ini
                            </button>
                            <button
                                onClick={() => setCommPeriodPreset('custom')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${commPeriodPreset === 'custom' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                            >
                                Custom
                            </button>
                        </div>

                        {commPeriodPreset === 'custom' && (
                            <div className="w-full sm:w-auto relative z-30">
                                <DateRangePicker
                                    startDate={commStartDate}
                                    endDate={commEndDate}
                                    onChange={(range) => {
                                        setCommStartDate(range.startDate)
                                        setCommEndDate(range.endDate)
                                    }}
                                    inputClassName="input-ayumi bg-white border border-pink-200 text-xs font-bold py-1.5 px-3 rounded-xl cursor-pointer"
                                    align="right"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Stat Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-ayumi-secondary via-ayumi-primary to-pink-600 rounded-2xl p-5 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
                        <div className="absolute -right-4 -bottom-4 opacity-15 text-6xl">💰</div>
                        <div className="text-xs font-bold text-pink-200 uppercase tracking-wider">Total Komisi Diterima</div>
                        <div className="text-2xl lg:text-3xl font-black mt-2 leading-none">
                            Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                        </div>
                        <div className="text-[11px] text-pink-100 font-medium mt-3 flex items-center gap-1">
                            <span>Akumulasi komisi seluruh cabang untuk periode terpilih</span>
                        </div>
                    </div>

                    <div className="bg-pink-50/60 border border-pink-200/70 rounded-2xl p-5 flex flex-col justify-between">
                        <div className="text-xs font-bold text-ayumi-secondary uppercase tracking-wider">Tindakan Treatment Selesai</div>
                        <div className="text-2xl lg:text-3xl font-black text-gray-900 mt-2 leading-none">
                            {commSummary.treatmentCount} <span className="text-sm font-bold text-gray-500">Tindakan</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-3">
                            Total tindakan yang telah Anda selesaikan
                        </div>
                    </div>
                </div>

                {/* Rincian Komisi Per Treatment Table Header Toggle */}
                <div className="pt-2 border-t border-gray-100">
                    <button
                        onClick={() => setIsCommDetailOpen(!isCommDetailOpen)}
                        className="flex items-center justify-between w-full text-left py-2 px-1 hover:bg-pink-50/50 rounded-xl transition-colors cursor-pointer"
                    >
                        <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-gray-800">📋 Rincian Komisi per Treatment</span>
                            <span className="px-2 py-0.5 bg-pink-100 text-ayumi-primary font-bold text-[10px] rounded-full">
                                {commItems.length} item
                            </span>
                        </div>
                        <span className="text-xs text-ayumi-primary font-bold flex items-center gap-1">
                            {isCommDetailOpen ? 'Sembunyikan' : 'Tampilkan Detail'}
                            <svg className={`w-4 h-4 transition-transform ${isCommDetailOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                        </span>
                    </button>

                    {isCommDetailOpen && (
                        <div className="mt-3 overflow-x-auto rounded-2xl border border-gray-200/80 shadow-xs">
                            {commLoading ? (
                                <div className="text-center py-10">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ayumi-primary mx-auto mb-2"></div>
                                    <p className="text-xs text-gray-500 font-medium">Memuat data komisi...</p>
                                </div>
                            ) : commItems.length === 0 ? (
                                <div className="text-center py-8 bg-gray-50/50">
                                    <p className="text-gray-500 font-semibold text-xs">Belum ada komisi treatment pada periode ini.</p>
                                </div>
                            ) : (
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="bg-pink-50/70 text-ayumi-secondary font-extrabold uppercase tracking-wider text-[11px]">
                                            <th className="p-3">Tanggal & Waktu</th>
                                            <th className="p-3">Cabang</th>
                                            <th className="p-3">Pasien</th>
                                            <th className="p-3">Treatment</th>
                                            <th className="p-3 text-center">% Komisi</th>
                                            <th className="p-3 text-right">Komisi Diterima</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white font-medium">
                                        {commItems.map(item => {
                                            const priceAtTime = Number(item.price_at_time || 0)
                                            const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                                                ? Number(item.original_price)
                                                : priceAtTime
                                            const commPercent = Number(item.commission_percent || 0)
                                            const commAmount = Math.round(basePrice * (commPercent / 100))
                                            const recordDate = item.treatment_records?.treatment_date
                                            const recordTime = item.treatment_records?.treatment_time
                                            const branchName = item.treatment_records?.branches?.name || '-'

                                            return (
                                                <tr key={item.id} className="hover:bg-pink-50/20 transition-colors">
                                                    <td className="p-3">
                                                        <div className="font-bold text-gray-900">
                                                            {recordDate ? new Date(recordDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 mt-0.5">{recordTime || '-'}</div>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold rounded-md text-[10.5px] border border-slate-200">
                                                            {branchName}
                                                        </span>
                                                    </td>
                                                    <td className="p-3">
                                                        {(() => {
                                                            const pt = Array.isArray(item.treatment_records?.patients)
                                                                ? item.treatment_records?.patients[0]
                                                                : item.treatment_records?.patients
                                                            const patientName = pt?.full_name || '-'
                                                            const patientId = item.treatment_records?.patient_id || pt?.id
                                                            return (
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <span className="font-extrabold text-gray-800 text-xs">{patientName}</span>
                                                                    {patientId && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setSelectedPatientIdForHistory(patientId)}
                                                                            className="inline-flex items-center gap-1 text-[10px] font-bold text-ayumi-primary hover:text-pink-700 bg-pink-50 hover:bg-pink-100 border border-pink-200/80 px-1.5 py-0.2 rounded-md transition-all shadow-2xs cursor-pointer"
                                                                        >
                                                                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                                            <span>Riwayat Medis ↗</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )
                                                        })()}
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="font-bold text-ayumi-primary">{item.treatments?.name || 'Treatment'}</div>
                                                        {item.notes && <div className="text-[10px] text-gray-400 italic">{item.notes}</div>}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className="px-2 py-0.5 bg-pink-100 text-ayumi-primary font-extrabold rounded-md text-[10px]">
                                                            {commPercent}%
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right font-black text-emerald-600 text-sm">
                                                        +Rp {commAmount.toLocaleString('id-ID')}
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

            {/* UNIFIED TIMELINE SCHEDULE BOARD FOR THERAPIST */}
            <div className="card-ayumi p-4 md:p-6 shadow-sm border border-pink-100/50">
                {/* Filter Bar */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <h3 className="text-base md:text-lg font-black text-slate-800">
                            Jadwal Treatment & Infus
                        </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto relative z-30">
                        <DateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(range) => {
                                setStartDate(range.startDate)
                                setEndDate(range.endDate)
                            }}
                            inputClassName="text-xs font-semibold"
                            align="right"
                        />
                        <Link href="/appointments/new">
                            <button className="btn-primary py-2 px-4 flex items-center gap-1.5 text-xs cursor-pointer shadow-pink-500/10 shadow-md">
                                <span className="font-black text-sm">+</span> Buat Jadwal
                            </button>
                        </Link>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                        <p className="text-gray-500 font-medium text-xs">Memuat jadwal...</p>
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
                            filteredAppointments.forEach(apt => {
                                const d = apt.appointment_date
                                if (!groupedByDate[d]) groupedByDate[d] = []
                                groupedByDate[d].push(apt)
                            })

                            const rangeDates = getDatesInRange(startDate, endDate)
                            const dateSet = new Set(rangeDates)
                            Object.keys(groupedByDate).forEach(d => dateSet.add(d))
                            const sortedDates = Array.from(dateSet).sort()

                            if (sortedDates.length === 0) {
                                return (
                                    <div className="py-16 text-center flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-100">
                                        <p className="text-gray-500 font-medium text-sm">Silakan pilih tanggal untuk melihat jadwal.</p>
                                    </div>
                                )
                            }

                            return (
                                <div className="space-y-8">
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
                                            <div key={dateStr} className="bg-white rounded-2xl border border-pink-100/60 p-4 sm:p-6 shadow-sm overflow-hidden">
                                                {/* Date Section Header */}
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-lg">🗓️</span>
                                                        <h3 className="font-black text-slate-800 text-base sm:text-lg">
                                                            {formattedDate}
                                                        </h3>
                                                    </div>

                                                    <div className="flex items-center gap-2 text-xs font-bold">
                                                        <span className="bg-sky-50 text-sky-700 px-3 py-1 rounded-full border border-sky-100 flex items-center gap-1.5">
                                                            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                                                            {totalTreatment} Treatment
                                                        </span>
                                                        <span className="bg-cyan-50 text-cyan-700 px-3 py-1 rounded-full border border-cyan-100 flex items-center gap-1.5">
                                                            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                                                            {totalInfus} Infus
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Scrollable Schedule Board Sheet */}
                                                <div className="overflow-x-auto custom-scrollbar pb-2">
                                                    <div className="min-w-[850px]">
                                                        {/* Grid Column Headers */}
                                                        <div className="flex items-center gap-4 pb-3 mb-2 border-b border-slate-100 text-xs font-black uppercase tracking-wider text-slate-500">
                                                            <div className="w-16 flex-shrink-0 text-slate-400 font-black pl-1 text-[11px] uppercase tracking-wider">WAKTU</div>
                                                            <div className="w-72 flex-shrink-0 flex items-center gap-2 text-cyan-800 bg-cyan-100/70 px-3.5 py-1.5 rounded-full border border-cyan-300 font-extrabold text-[11px] uppercase tracking-wider">
                                                                <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                                                                LAYANAN INFUS
                                                            </div>
                                                            <div className="flex-1 flex items-center gap-2 text-sky-800 bg-sky-100/70 px-3.5 py-1.5 rounded-full border border-sky-300 font-extrabold text-[11px] uppercase tracking-wider">
                                                                <span className="w-2 h-2 rounded-full bg-sky-500"></span>
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
                                                                    <div key={hourStr} className="flex items-stretch gap-4 py-2.5 border-b border-slate-100 hover:bg-slate-50/30 transition-colors min-h-[58px]">
                                                                        {/* Waktu */}
                                                                        <div className="w-16 flex-shrink-0 pt-1.5">
                                                                            <span className="text-xs font-black text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200/60 inline-block">
                                                                                {hourStr}
                                                                            </span>
                                                                        </div>

                                                                        {/* Column 1: Infus */}
                                                                        <div className="w-72 flex-shrink-0 border-l border-slate-100 pl-3 flex flex-col justify-center min-h-[48px]">
                                                                            {infusApts.length === 0 ? (
                                                                                <Link 
                                                                                    href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}&notes=Infus`} 
                                                                                    className="w-full min-h-[42px] border border-dashed border-slate-200/80 hover:border-cyan-300 hover:bg-cyan-50/40 rounded-xl transition-all flex items-center px-3 text-xs text-slate-400 hover:text-cyan-700 font-semibold gap-2 group cursor-pointer"
                                                                                    title={`Tambah Infus Jam ${hourStr.replace('.', ':')}`}
                                                                                >
                                                                                    <span className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-cyan-100 text-slate-400 group-hover:text-cyan-700 flex items-center justify-center font-black text-xs transition-colors">+</span>
                                                                                    <span className="opacity-70 group-hover:opacity-100 transition-opacity">Tambah Infus</span>
                                                                                </Link>
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
                                                                                                className={`border text-slate-800 rounded-xl p-3 w-full shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between ${
                                                                                                    isMyPatient ? 'bg-[#e3f7fa] border-cyan-400 ring-2 ring-cyan-200' : 'bg-[#ebf9fb] border-cyan-300'
                                                                                                }`}
                                                                                            >
                                                                                                <div>
                                                                                                    <div className="flex justify-between items-center text-xs font-bold text-cyan-950 pb-1.5 mb-1.5 border-b border-cyan-200/70">
                                                                                                        <span className="flex items-center gap-1.5 text-cyan-900 font-extrabold text-[11px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-2xs"></span>
                                                                                                            💧 {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        {isMyPatient && (
                                                                                                            <span className="text-[10px] font-black bg-cyan-200/80 text-cyan-800 px-1.5 py-0.2 rounded-md">
                                                                                                                Tugas Anda
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>

                                                                                                    <div className="font-extrabold text-sm text-slate-900 tracking-tight truncate">
                                                                                                        {apt.patients?.full_name || 'Pasien'}
                                                                                                    </div>

                                                                                                    <div className="text-[11px] text-cyan-950 font-semibold mt-1 bg-white/80 px-2 py-0.5 rounded-md border border-cyan-200/80 inline-block shadow-2xs truncate max-w-full">
                                                                                                        💧 {treatmentsList}
                                                                                                    </div>

                                                                                                    <div className="text-[10.5px] text-cyan-900/80 font-medium mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 truncate">
                                                                                                        {apt.therapist?.full_name ? (
                                                                                                            <span>Petugas: <b className="font-bold text-slate-800">{apt.therapist.full_name.split(' ')[0]}</b></span>
                                                                                                        ) : (
                                                                                                            <span className="text-amber-600 font-bold">⚠️ Belum Ada Terapis</span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>

                                                                                                {/* Footer Actions */}
                                                                                                <div className="mt-2.5 pt-2 border-t border-cyan-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getTherapistArrivalActions(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {apt.patients?.id && (
                                                                                                            <button
                                                                                                                type="button"
                                                                                                                onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                                className="text-[10px] font-bold text-ayumi-primary hover:text-pink-700 bg-white/80 hover:bg-white px-1.5 py-0.5 rounded-md border border-pink-200 transition-colors cursor-pointer"
                                                                                                                title="Lihat Riwayat Medis"
                                                                                                            >
                                                                                                                📋
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                            <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                                <button
                                                                                                                    className="text-[10px] font-black text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded-md transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                                                                                                                    title="Input Treatment & SOAP Medis"
                                                                                                                >
                                                                                                                    <span>📝 Input Treatment</span>
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
                                                                        <div className="flex-1 border-l border-slate-100 pl-3 flex items-center min-h-[48px]">
                                                                            {treatmentApts.length === 0 ? (
                                                                                <Link 
                                                                                    href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}`} 
                                                                                    className="w-full min-h-[42px] border border-dashed border-slate-200/80 hover:border-sky-300 hover:bg-sky-50/40 rounded-xl transition-all flex items-center px-3 text-xs text-slate-400 hover:text-sky-700 font-semibold gap-2 group cursor-pointer"
                                                                                    title={`Tambah Treatment Jam ${hourStr.replace('.', ':')}`}
                                                                                >
                                                                                    <span className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-sky-100 text-slate-400 group-hover:text-sky-700 flex items-center justify-center font-black text-xs transition-colors">+</span>
                                                                                    <span className="opacity-70 group-hover:opacity-100 transition-opacity">Tambah Jadwal Treatment</span>
                                                                                </Link>
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
                                                                                                className={`border text-slate-800 rounded-xl p-3 w-[270px] min-w-[270px] flex-shrink-0 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between ${
                                                                                                    isMyPatient ? 'bg-[#e0f2fe] border-sky-400 ring-2 ring-sky-200' : 'bg-[#ebf6fe] border-sky-300'
                                                                                                }`}
                                                                                            >
                                                                                                <div>
                                                                                                    <div className="flex justify-between items-center text-xs font-bold text-sky-950 pb-1.5 mb-1.5 border-b border-sky-200/70">
                                                                                                        <span className="flex items-center gap-1.5 text-sky-900 font-extrabold text-[11px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shadow-2xs"></span>
                                                                                                            {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        {isMyPatient ? (
                                                                                                            <span className="text-[10px] font-black bg-sky-200/80 text-sky-800 px-1.5 py-0.2 rounded-md">
                                                                                                                Pasien Anda
                                                                                                            </span>
                                                                                                        ) : !apt.therapist_id ? (
                                                                                                            <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-md">
                                                                                                                Tersedia
                                                                                                            </span>
                                                                                                        ) : null}
                                                                                                    </div>

                                                                                                    <div className="font-extrabold text-sm text-slate-900 tracking-tight truncate">
                                                                                                        {apt.patients?.full_name || 'Pasien'}
                                                                                                    </div>

                                                                                                    <div className="text-[11px] text-sky-950 font-semibold mt-1 bg-white/80 px-2 py-0.5 rounded-md border border-sky-200/80 inline-block shadow-2xs truncate max-w-full">
                                                                                                        {treatmentsList}
                                                                                                    </div>

                                                                                                    <div className="text-[10.5px] text-sky-900/80 font-medium mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 truncate">
                                                                                                        {apt.therapist?.full_name ? (
                                                                                                            <span>Terapis: <b className="font-bold text-slate-800">{apt.therapist.full_name.split(' ')[0]}</b></span>
                                                                                                        ) : (
                                                                                                            <span className="text-amber-600 font-bold">⚠️ Belum Ada Terapis</span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>

                                                                                                {/* Footer Actions */}
                                                                                                <div className="mt-2.5 pt-2 border-t border-sky-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getTherapistArrivalActions(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {apt.patients?.id && (
                                                                                                            <button
                                                                                                                type="button"
                                                                                                                onClick={() => setSelectedPatientIdForHistory(apt.patients.id)}
                                                                                                                className="text-[10px] font-bold text-ayumi-primary hover:text-pink-700 bg-white/80 hover:bg-white px-1.5 py-0.5 rounded-md border border-pink-200 transition-colors cursor-pointer"
                                                                                                                title="Lihat Riwayat Medis"
                                                                                                            >
                                                                                                                📋
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                                                                                                            <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                                                                <button
                                                                                                                    className="text-[10px] font-black text-white bg-ayumi-primary hover:bg-[#9a4b75] px-2 py-0.5 rounded-md transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                                                                                                                    title="Input Treatment & SOAP Medis"
                                                                                                                >
                                                                                                                    <span>📝 Input Treatment</span>
                                                                                                                </button>
                                                                                                            </Link>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        )
                                                                                    })}

                                                                                    {/* Compact Ghost Add Slot next to existing patient cards */}
                                                                                    <Link 
                                                                                        href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}`} 
                                                                                        className="w-[130px] min-w-[130px] self-stretch min-h-[105px] border-2 border-dashed border-sky-200 hover:border-sky-400 bg-sky-50/20 hover:bg-sky-50/60 rounded-xl flex flex-col items-center justify-center text-sky-600 hover:text-sky-700 transition-all text-xs font-bold gap-1 cursor-pointer group shadow-2xs flex-shrink-0"
                                                                                        title={`Tambah Jadwal Jam ${hourStr.replace('.', ':')}`}
                                                                                    >
                                                                                        <span className="w-6 h-6 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center transition-colors text-sky-700 font-black text-xs">+</span>
                                                                                        <span className="text-[11px] text-sky-700 font-bold group-hover:underline">Tambah</span>
                                                                                    </Link>
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
