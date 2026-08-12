'use client'

import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import DateRangePicker from '@/components/DateRangePicker'

export default function TherapistDashboard() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')
    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(true)
    const [claimingAptId, setClaimingAptId] = useState(null)

    // Calendar States
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectedDate, setSelectedDate] = useState('')

    // Helper to get local date string YYYY-MM-DD
    const getLocalDateString = (date) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Commission Widget States
    const todayStr = getLocalDateString(new Date())
    const [commPeriodPreset, setCommPeriodPreset] = useState('today') // 'today' | 'week' | 'month' | 'custom'
    const [commStartDate, setCommStartDate] = useState(todayStr)
    const [commEndDate, setCommEndDate] = useState(todayStr)
    const [commItems, setCommItems] = useState([])
    const [commLoading, setCommLoading] = useState(false)
    const [isCommDetailOpen, setIsCommDetailOpen] = useState(true)

    useEffect(() => {
        setSelectedDate(getLocalDateString(new Date()))
        fetchUserAndData()
    }, [])

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

        // Fetch Branches
        const { data: branchData } = await supabase.from('branches').select('id, name')
        if (branchData) {
            setBranches(branchData)
            if (branchData.length > 0) {
                // Default to branch assigned to therapist if they have one, else first branch
                setSelectedBranch(userData.branch_id || branchData[0].id)
            }
        }
    }

    const fetchAppointments = async () => {
        if (!selectedBranch) return

        const year = currentMonth.getFullYear()
        const month = currentMonth.getMonth()
        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
        const lastDay = new Date(year, month + 1, 0).getDate()
        const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`

        // Fetch all appointments for the branch in the current month range
        const { data, error } = await supabase
            .from('appointments')
            .select(`
                id, start_time, end_time, status, appointment_date, therapist_id, notes, arrival_status, arrived_at, therapist_ready_at,
                patients(full_name, whatsapp),
                therapist:users!appointments_therapist_id_fkey(full_name),
                treatment_records(id, result_notes)
            `)
            .eq('branch_id', selectedBranch)
            .gte('appointment_date', startDate)
            .lte('appointment_date', endDate)
            .order('start_time', { ascending: true })

        if (data) {
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
                    patients(full_name, whatsapp),
                    performed_by
                ),
                treatments(id, name)
            `)
            .eq('treatment_records.performed_by', userId)
            .gte('treatment_records.treatment_date', start)
            .lte('treatment_records.treatment_date', end)

        if (!error && data) {
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

    useEffect(() => {
        if (dbUser && selectedBranch) {
            fetchAppointments()

            // Subscribe to realtime updates for appointments in this branch
            const channel = supabase
                .channel('realtime-appointments-therapist')
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'appointments',
                        filter: `branch_id=eq.${selectedBranch}`
                    },
                    () => {
                        fetchAppointments()
                    }
                )
                .subscribe()

            return () => {
                supabase.removeChannel(channel)
            }
        }
    }, [dbUser, selectedBranch, currentMonth])

    const handleClaimPatient = async (aptId) => {
        if (!confirm('Apakah Anda yakin ingin menangani pasien ini?')) return

        setClaimingAptId(aptId)
        toast.loading('Menugaskan Anda ke janji temu...', { id: 'claim' })

        const { data: aptData } = await supabase
            .from('appointments')
            .select('*, patients(full_name)')
            .eq('id', aptId)
            .maybeSingle()

        const { error } = await supabase
            .from('appointments')
            .update({
                therapist_id: dbUser.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', aptId)

        if (!error) {
            toast.success('Pasien berhasil ditugaskan ke Anda!', { id: 'claim' })

            // Notification if patient already arrived
            if (aptData?.arrival_status === 'arrived') {
                await supabase.from('notifications').insert([{
                    recipient_id: dbUser.id,
                    sender_id: dbUser.id,
                    appointment_id: aptId,
                    type: 'patient_arrived',
                    title: 'Pasien Sudah Datang 🙋‍♀️',
                    message: `Pasien ${aptData?.patients?.full_name || ''} sudah tiba di klinik dan siap Anda tangani!`
                }])
            }

            fetchAppointments()
        } else {
            toast.error('Gagal memilih pasien: ' + getFriendlyErrorMessage(error), { id: 'claim' })
        }
        setClaimingAptId(null)
    }

    const handleTherapistReady = async (apt) => {
        if (!confirm('Apakah Anda siap menerima pasien ini?')) return

        const todayStr = new Date().toISOString()
        toast.loading('Mengirim notifikasi siap ke admin...', { id: 'ready' })

        // 1. Update status
        const { error: aptErr } = await supabase
            .from('appointments')
            .update({
                arrival_status: 'therapist_ready',
                therapist_ready_at: todayStr,
                updated_at: todayStr
            })
            .eq('id', apt.id)

        if (aptErr) {
            toast.error('Gagal update status: ' + getFriendlyErrorMessage(aptErr), { id: 'ready' })
            return
        }

        // 2. Notify all active admins & owners
        const { data: allActiveUsers } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .eq('is_active', true)

        const recipients = allActiveUsers?.filter(u => 
            u.id !== dbUser.id && (u.role === 'owner' || (u.role === 'admin' && (!u.branch_id || u.branch_id === selectedBranch)))
        ) || []

        if (recipients.length > 0) {
            // Fetch treatments
            const { data: apptTreatments } = await supabase
                .from('appointment_treatments')
                .select('treatments(name)')
                .eq('appointment_id', apt.id)
            
            const treatmentNames = apptTreatments?.map(t => t.treatments?.name).join(', ') || 'Treatment'
            
            const notificationsPayload = recipients.map(recipient => ({
                recipient_id: recipient.id,
                sender_id: dbUser.id,
                appointment_id: apt.id,
                type: 'therapist_ready',
                title: 'Terapis Siap 💆‍♀️',
                message: `Terapis ${dbUser.full_name} sudah siap di ruangan menerima ${apt.patients?.full_name} (${treatmentNames}).`
            }))

            const { error: notifErr } = await supabase
                .from('notifications')
                .insert(notificationsPayload)

            if (notifErr) {
                console.error('Gagal membuat notifikasi ke admin:', notifErr.message)
            }
        }

        toast.success('Kesiapan terkirim ke admin!', { id: 'ready' })
        fetchAppointments()
    }

    const getStatusBadge = (status) => {
        const badges = {
            'scheduled': 'bg-blue-100 text-blue-700 border-blue-200',
            'confirmed': 'bg-green-100 text-green-700 border-green-200',
            'completed': 'bg-gray-100 text-gray-700 border-gray-200',
            'cancelled': 'bg-red-100 text-red-700 border-red-200',
            'no_show': 'bg-orange-100 text-orange-700 border-orange-200'
        }
        const colorClass = badges[status] || 'bg-gray-100 text-gray-700'
        return <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${colorClass}`}>{status}</span>
    }

    // --- CALENDAR LOGIC ---
    const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()
    const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay()

    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)

    const prevMonth = () => {
        setCurrentMonth(new Date(year, month - 1, 1))
    }

    const nextMonth = () => {
        setCurrentMonth(new Date(year, month + 1, 1))
    }

    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]

    // Group appointments by date
    const appointmentsByDate = {}
    appointments.forEach(apt => {
        if (!appointmentsByDate[apt.appointment_date]) {
            appointmentsByDate[apt.appointment_date] = []
        }
        appointmentsByDate[apt.appointment_date].push(apt)
    })

    const selectedDateAppointments = appointments.filter(a => a.appointment_date === selectedDate)

    if (loading && !dbUser) {
        return (
            <div className="flex items-center justify-center p-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    return (
        <div className="w-full space-y-6">
            {/* Header & Branch Selector Banner */}
            <div className="bg-white rounded-3xl p-6 border border-pink-100 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <h2 className="text-lg font-black text-gray-900">Dashboard Terapis</h2>
                    </div>
                    <p className="text-xs text-gray-500 font-medium">
                        Penempatan Cabang Aktif: <span className="text-ayumi-primary font-bold">{dbUser?.branches?.name || 'Tidak ada penempatan'}</span>
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full md:w-auto">
                    <label className="text-xs font-bold text-gray-400 uppercase shrink-0">Lihat Jadwal Cabang:</label>
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="input-ayumi bg-pink-50/70 border-pink-200 text-ayumi-primary font-bold py-2 px-4 rounded-xl cursor-pointer text-xs w-full sm:w-auto"
                    >
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* RINGKASAN & RINCIAN KOMISI TERAPIS WIDGET */}
            <div className="bg-white rounded-3xl border-2 border-pink-100 p-5 md:p-6 shadow-sm space-y-5">
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
                            Pantau perolehan komisi Anda dari setiap tindakan treatment yang Anda selesaikan.
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
                            <div className="w-full sm:w-auto z-30">
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
                    {/* Card 1: Total Komisi */}
                    <div className="bg-gradient-to-br from-ayumi-secondary via-ayumi-primary to-pink-600 rounded-2xl p-5 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
                        <div className="absolute -right-4 -bottom-4 opacity-15 text-6xl">💰</div>
                        <div className="text-xs font-bold text-pink-200 uppercase tracking-wider">Total Komisi Diterima</div>
                        <div className="text-2xl lg:text-3xl font-black mt-2 leading-none">
                            Rp {commSummary.totalCommission.toLocaleString('id-ID')}
                        </div>
                        <div className="text-[11px] text-pink-100 font-medium mt-3 flex items-center gap-1">
                            <span>✨ Akumulasi periode terpilih</span>
                        </div>
                    </div>

                    {/* Card 2: Jumlah Perawatan */}
                    <div className="bg-pink-50/60 border border-pink-200/70 rounded-2xl p-5 flex flex-col justify-between">
                        <div className="text-xs font-bold text-ayumi-secondary uppercase tracking-wider">Tindakan Treatment</div>
                        <div className="text-2xl lg:text-3xl font-black text-gray-900 mt-2 leading-none">
                            {commSummary.treatmentCount} <span className="text-sm font-bold text-gray-500">Tindakan</span>
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-3">
                            Selesai dikerjakan oleh Anda
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
                                <div className="text-center py-10 bg-gray-50/50">
                                    <p className="text-gray-500 font-semibold text-xs">Belum ada komisi treatment pada periode ini.</p>
                                </div>
                            ) : (
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="bg-pink-50/70 text-ayumi-secondary font-extrabold uppercase tracking-wider text-[11px]">
                                            <th className="p-3">Tanggal & Waktu</th>
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

                                            return (
                                                <tr key={item.id} className="hover:bg-pink-50/20 transition-colors">
                                                    <td className="p-3">
                                                        <div className="font-bold text-gray-900">
                                                            {recordDate ? new Date(recordDate + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 mt-0.5">{recordTime || '-'}</div>
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="font-bold text-gray-800">{item.treatment_records?.patients?.full_name || '-'}</div>
                                                        <div className="text-[10px] text-gray-400">{item.treatment_records?.patients?.whatsapp || ''}</div>
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

            {/* Split Calendar & Detail Harian */}
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Kolom Kiri: Kalender */}
                <div className="flex-1 card-ayumi p-4 md:p-6 border border-gray-100 bg-white">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-extrabold text-ayumi-secondary">
                            Jadwal {monthNames[month]} {year}
                        </h3>
                        <div className="flex gap-2">
                            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-pink-50 text-ayumi-primary transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <button onClick={() => setCurrentMonth(new Date())} className="px-3 py-1.5 rounded-lg hover:bg-pink-50 text-sm font-bold text-ayumi-primary transition-colors">
                                Bulan Ini
                            </button>
                            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-pink-50 text-ayumi-primary transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto pb-4 custom-scrollbar">
                        <div className="grid grid-cols-7 gap-1.5 min-w-[500px] md:min-w-0">
                            {dayNames.map(day => (
                                <div key={day} className="text-center font-bold text-gray-400 text-xs py-1 uppercase tracking-wider">
                                    {day}
                                </div>
                            ))}

                            {/* Sel Kosong sebelum Tanggal 1 */}
                            {Array.from({ length: firstDay }).map((_, i) => (
                                <div key={`empty-${i}`} className="p-2 h-20 rounded-xl bg-gray-50/30"></div>
                            ))}

                            {/* Hari-hari dalam bulan */}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const d = i + 1
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                                const isSelected = selectedDate === dateStr
                                const isToday = getLocalDateString(new Date()) === dateStr
                                const dayAppointments = appointmentsByDate[dateStr] || []

                                // Indicators
                                const hasMyClaim = dayAppointments.some(a => a.therapist_id === dbUser.id)
                                const hasUnassigned = dayAppointments.some(a => !a.therapist_id)

                                return (
                                    <div
                                        key={d}
                                        onClick={() => setSelectedDate(dateStr)}
                                        className={`p-2 h-20 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden ${
                                            isSelected
                                                ? 'border-ayumi-primary bg-pink-50 shadow-sm'
                                                : isToday ? 'border-pink-200 bg-white' : 'border-gray-50 hover:border-pink-100 bg-white'
                                        }`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-ayumi-primary text-white' : 'text-gray-700'}`}>
                                                {d}
                                            </span>
                                            {dayAppointments.length > 0 && (
                                                <span className="text-[9px] font-bold bg-pink-100 text-ayumi-primary px-1.5 py-0.5 rounded-md">
                                                    {dayAppointments.length}
                                                </span>
                                            )}
                                        </div>

                                        {/* Indikator Status di bagian bawah sel */}
                                        <div className="flex gap-1 items-center justify-end mt-1">
                                            {hasMyClaim && (
                                                <span className="w-2 h-2 rounded-full bg-pink-500" title="Ada pasien Anda"></span>
                                            )}
                                            {hasUnassigned && (
                                                <span className="w-2 h-2 rounded-full bg-blue-400" title="Ada pasien belum dihandle"></span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Kolom Kanan: Detail Janji Temu Harian */}
                <div className="w-full lg:w-96 flex flex-col gap-4">
                    <div className="bg-ayumi-secondary rounded-2xl p-5 text-white shadow-md">
                        <div className="text-xs font-medium text-pink-200 mb-1">Jadwal pada tanggal</div>
                        <h3 className="text-lg font-bold">
                            {new Date(selectedDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </h3>
                    </div>

                    <div className="flex-1 bg-gray-50 border-2 border-gray-100 rounded-3xl p-5 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                        {selectedDateAppointments.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3 mx-auto text-gray-400">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                </div>
                                <p className="font-semibold text-sm">Tidak ada jadwal temu</p>
                                <p className="text-xs text-gray-400 mt-1">Di cabang terpilih pada tanggal ini.</p>
                            </div>
                        ) : (
                            selectedDateAppointments.map(apt => {
                                const isClaimedByMe = apt.therapist_id === dbUser.id
                                const isUnassigned = !apt.therapist_id
                                const isCompleted = apt.status === 'completed' || (apt.treatment_records && apt.treatment_records.length > 0)

                                return (
                                    <div key={apt.id} className="bg-white border-2 border-pink-100 rounded-xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between min-h-[140px]">
                                        <div className={`absolute top-0 left-0 w-1.5 h-full ${
                                            isClaimedByMe ? 'bg-pink-500' :
                                            isUnassigned ? 'bg-blue-400' : 'bg-gray-300'
                                        }`}></div>

                                        <div>
                                            <div className="flex justify-between items-start mb-2 pl-2">
                                                <div>
                                                    <div className="font-bold text-gray-800 text-sm">{apt.patients?.full_name}</div>
                                                    <div className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                                        {apt.start_time ? apt.start_time.substring(0, 5) : '-'} - {apt.end_time ? apt.end_time.substring(0, 5) : '-'}
                                                    </div>
                                                </div>
                                                <div className="scale-75 origin-top-right">
                                                    {getStatusBadge(isCompleted ? 'completed' : apt.status)}
                                                </div>
                                            </div>

                                            {apt.notes && (
                                                <div className="pl-2 text-[11px] text-gray-500 italic mt-1 line-clamp-2 bg-yellow-50/50 p-1.5 rounded border border-yellow-100">
                                                    Catatan: {apt.notes}
                                                </div>
                                            )}
                                        </div>

                                        <div className="pl-2 flex justify-between items-center mt-3 pt-3 border-t border-gray-50">
                                            <div className="text-xs text-gray-500 font-medium flex flex-col gap-1">
                                                {isClaimedByMe && <span className="text-pink-600 font-bold">Ditangani Anda</span>}
                                                {isUnassigned && <span className="text-blue-500 font-bold">Belum ada terapis</span>}
                                                {!isClaimedByMe && !isUnassigned && (
                                                    <span className="text-gray-500">
                                                        Terapis: <span className="font-semibold">{apt.therapist?.full_name?.split(' ')[0]}</span>
                                                    </span>
                                                )}
                                                
                                                {/* Visual Arrival Status Badge for Therapist */}
                                                {isClaimedByMe && apt.arrival_status === 'arrived' && (
                                                    <span className="inline-flex items-center text-[10px] font-extrabold text-yellow-600 animate-pulse mt-0.5">
                                                        Pasien Sudah Datang!
                                                    </span>
                                                )}
                                                {isClaimedByMe && apt.arrival_status === 'therapist_ready' && (
                                                    <span className="inline-flex items-center text-[10px] font-bold text-green-600 animate-pulse mt-0.5">
                                                        Menunggu Pasien Masuk...
                                                    </span>
                                                )}
                                                {isClaimedByMe && apt.arrival_status === 'in_treatment' && (
                                                    <span className="inline-flex items-center text-[10px] font-bold text-blue-600 mt-0.5">
                                                        Sedang Treatment
                                                    </span>
                                                )}
                                            </div>

                                            <div>
                                                {isUnassigned && (
                                                    <button
                                                        onClick={() => handleClaimPatient(apt.id)}
                                                        disabled={claimingAptId === apt.id}
                                                        className="text-[11px] font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
                                                    >
                                                        {claimingAptId === apt.id ? 'Memproses...' : 'Pilih Pasien'}
                                                    </button>
                                                )}

                                                {isClaimedByMe && apt.status !== 'cancelled' && (
                                                    <div className="flex flex-col gap-1.5 items-end">
                                                        {apt.arrival_status === 'arrived' && !isCompleted && (
                                                            <button
                                                                onClick={() => handleTherapistReady(apt)}
                                                                className="text-[11px] font-bold text-white bg-yellow-500 hover:bg-yellow-600 px-3 py-1 rounded-lg transition-colors shadow-sm cursor-pointer"
                                                            >
                                                                Siap Menerima Pasien
                                                            </button>
                                                        )}

                                                        <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                            <button className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm cursor-pointer ${
                                                                isCompleted 
                                                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                                                                    : 'bg-ayumi-primary hover:bg-ayumi-primary-hover text-white'
                                                            }`}>
                                                                {isCompleted ? '📝 Input / Edit SOAP' : '💆‍♀️ Treatment & SOAP'}
                                                            </button>
                                                        </Link>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
