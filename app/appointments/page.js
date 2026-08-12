'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import DateRangePicker from '../../components/DateRangePicker'

export default function AppointmentsPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [appointments, setAppointments] = useState([])
    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)
    
    // Filters & States
    const [viewMode, setViewMode] = useState('calendar') // default to calendar
    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }
    const [filterBranch, setFilterBranch] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [startDate, setStartDate] = useState(getLocalYYYYMMDD())
    const [endDate, setEndDate] = useState(getLocalYYYYMMDD())
    const [searchQuery, setSearchQuery] = useState('')
    const [isOwner, setIsOwner] = useState(false)
    const [listSubView, setListSubView] = useState('schedule') // 'schedule' or 'table'
    const SCHEDULE_HOURS = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00']

    // Calendar States
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

    useEffect(() => {
        const savedView = localStorage.getItem('appointmentsViewMode')
        if (savedView) setViewMode(savedView)
        fetchData()

        // Subscribe to public.appointments updates for realtime dashboard
        const channel = supabase
            .channel('realtime-appointments-dashboard')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments'
                },
                () => {
                    fetchData()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    const handleViewModeChange = (mode) => {
        setViewMode(mode)
        localStorage.setItem('appointmentsViewMode', mode)
    }

    const fetchData = async () => {
        setLoading(true)
        
        // Fetch Branches
        const { data: branchData } = await supabase.from('branches').select('id, name')
        if (branchData) setBranches(branchData)

        // Get current user's role and branch
        const { data: { user } } = await supabase.auth.getUser()
        let userBranchId = null
        let ownerFlag = false

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData) {
                ownerFlag = userData.role === 'owner'
                setIsOwner(ownerFlag)
                userBranchId = userData.branch_id
                if (!ownerFlag && userBranchId) {
                    setFilterBranch(userBranchId)
                }
            } else {
                ownerFlag = true
                setIsOwner(true)
            }
        } else {
            ownerFlag = true
            setIsOwner(true)
        }

        // Fetch Appointments with Patient Info, Treatments & Categories
        let query = supabase
            .from('appointments')
            .select(`
                *,
                patients (full_name, whatsapp),
                branches (name),
                therapist:users!appointments_therapist_id_fkey (full_name),
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
            .order('appointment_date', { ascending: false })
            .order('start_time', { ascending: true })

        if (!ownerFlag && userBranchId) {
            query = query.eq('branch_id', userBranchId)
        }

        const { data: aptData } = await query

        if (aptData) {
            setAppointments(aptData)
        }
        setLoading(false)
    }

    const isInfusAppointment = (apt) => {
        if (!apt) return false
        const treatmentNames = apt.appointment_treatments?.map(at => at.treatments?.name || '').join(' ').toLowerCase() || ''
        const categoryNames = apt.appointment_treatments?.map(at => at.treatments?.treatment_categories?.name || '').join(' ').toLowerCase() || ''
        const notes = (apt.notes || '').toLowerCase()

        return treatmentNames.includes('infus') || categoryNames.includes('infus') || notes.includes('infus')
    }

    const handleDeleteAppointment = async (aptId, e) => {
        if (e) {
            e.stopPropagation()
            e.preventDefault()
        }

        try {
            const { data: recordData } = await supabase
                .from('treatment_records')
                .select('id')
                .eq('appointment_id', aptId)
                .maybeSingle()

            if (recordData) {
                const { data: txData } = await supabase
                    .from('transactions')
                    .select('transaction_number')
                    .eq('treatment_record_id', recordData.id)
                    .maybeSingle()

                if (txData) {
                    toast.error(`Tidak dapat menghapus: Rekam medis sudah dibayar di kasir (${txData.transaction_number}).`)
                    return
                }
            }

            let confirmMsg = 'Apakah Anda yakin ingin menghapus jadwal temu ini?'
            if (recordData) {
                confirmMsg = 'Jadwal ini memiliki Rekam Medis (SOAP) terkait. Menghapus jadwal ini juga akan menghapus rekam medis. Lanjutkan?'
            }

            if (!window.confirm(confirmMsg)) return

            setLoading(true)

            if (recordData) {
                const recordId = recordData.id
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

                await supabase.from('followup_queue').delete().eq('treatment_record_id', recordId)
                await supabase.from('treatment_record_items').delete().eq('treatment_record_id', recordId)
                await supabase.from('patient_photos').delete().eq('treatment_record_id', recordId)
                await supabase.from('treatment_records').delete().eq('id', recordId)
            }

            await supabase.from('appointment_treatments').delete().eq('appointment_id', aptId)
            const { error: deleteErr } = await supabase.from('appointments').delete().eq('id', aptId)

            if (deleteErr) throw deleteErr

            toast.success('Jadwal temu berhasil dihapus.')
            fetchData()

        } catch (err) {
            console.error('Error deleting appointment:', err)
            toast.error('Gagal menghapus jadwal: ' + err.message)
            setLoading(false)
        }
    }

    const getArrivalStatusBadgeAndActions = (apt) => {
        if (apt.status === 'completed' || apt.status === 'cancelled') {
            return null
        }

        const status = apt.arrival_status || 'not_arrived'

        const handlePatientArrived = async (e) => {
            e.stopPropagation()
            e.preventDefault()
            
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const todayStr = new Date().toISOString()
            
            // 1. Update appointment status
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({
                    arrival_status: 'arrived',
                    arrived_at: todayStr,
                    updated_at: todayStr
                })
                .eq('id', apt.id)

            if (aptErr) {
                toast.error('Gagal update status kedatangan: ' + aptErr.message)
                return
            }

            // 2. Insert notification if therapist is assigned
            if (apt.therapist_id) {
                // Fetch appointment treatments
                const { data: apptTreatments } = await supabase
                    .from('appointment_treatments')
                    .select('treatments(name)')
                    .eq('appointment_id', apt.id)
                
                const treatmentNames = apptTreatments?.map(t => t.treatments?.name).join(', ') || 'Treatment'
                const startHour = apt.start_time ? apt.start_time.substring(0, 5) : ''

                const { error: notifErr } = await supabase
                    .from('notifications')
                    .insert([{
                        recipient_id: apt.therapist_id,
                        sender_id: user.id,
                        appointment_id: apt.id,
                        type: 'patient_arrived',
                        title: 'Pasien Sudah Datang 🙋‍♀️',
                        message: `Pasien ${apt.patients?.full_name || ''} telah tiba di lokasi untuk ${treatmentNames} (${startHour}). Silakan persiapkan ruangan & perawatan.`
                    }])
                
                if (notifErr) {
                    console.error('Gagal membuat notifikasi:', notifErr.message)
                }
            }
            
            toast.success('Status kedatangan pasien diperbarui!')
            fetchData()
        }

        const handlePatientEnter = async (e) => {
            e.stopPropagation()
            e.preventDefault()

            const todayStr = new Date().toISOString()
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({
                    arrival_status: 'in_treatment',
                    updated_at: todayStr
                })
                .eq('id', apt.id)

            if (aptErr) {
                toast.error('Gagal update status masuk ruangan: ' + aptErr.message)
                return
            }

            toast.success('Pasien dipersilakan masuk ruangan!')
            fetchData()
        }

        if (status === 'not_arrived') {
            return (
                <button
                    onClick={handlePatientArrived}
                    className="text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded-md transition-colors shadow-sm cursor-pointer"
                >
                    Pasien Sudah Datang
                </button>
            )
        }

        if (status === 'arrived') {
            return (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-200 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 mr-1"></span>
                    Menunggu Terapis
                </span>
            )
        }

        if (status === 'therapist_ready') {
            return (
                <div className="flex flex-col gap-1 items-center">
                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 animate-pulse mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1"></span>
                        Terapis Siap!
                    </span>
                    <button
                        onClick={handlePatientEnter}
                        className="text-[10px] font-bold text-white bg-pink-500 hover:bg-pink-600 px-2.5 py-1 rounded-md transition-colors shadow-sm cursor-pointer"
                    >
                        Persilakan Masuk
                    </button>
                </div>
            )
        }

        if (status === 'in_treatment') {
            return (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1"></span>
                    Di Ruangan
                </span>
            )
        }

        return null
    }

    const getStatusBadge = (a) => {
        const status = a.status
        const hasSoap = a.treatment_records && a.treatment_records.length > 0 && a.treatment_records[0].result_notes;

        if (status === 'completed' && !hasSoap) {
            return (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border bg-amber-50 text-amber-700 border-amber-200">
                    Selesai (SOAP)
                </span>
            )
        }

        const badges = {
            'scheduled': 'bg-blue-50 text-blue-700 border-blue-200',
            'confirmed': 'bg-green-50 text-green-700 border-green-200',
            'completed': 'bg-gray-50 text-gray-700 border-gray-200',
            'cancelled': 'bg-red-50 text-red-700 border-red-200',
            'no_show': 'bg-orange-50 text-orange-700 border-orange-200'
        }
        
        const labels = {
            'scheduled': 'Scheduled',
            'confirmed': 'Confirmed',
            'completed': 'Selesai',
            'cancelled': 'Batal',
            'no_show': 'No Show'
        }

        const colorClass = badges[status] || 'bg-gray-50 text-gray-700'
        return (
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${colorClass}`}>
                {labels[status] || status}
            </span>
        )
    }

    const getMiniAptStyle = (a) => {
        const status = a.status
        const hasSoap = a.treatment_records && a.treatment_records.length > 0 && a.treatment_records[0].result_notes;
        
        if (status === 'completed' && !hasSoap) {
            return {
                bg: 'bg-amber-50/80 text-amber-700 border-amber-100/50',
                dot: 'bg-amber-500'
            }
        }
        
        const styles = {
            'scheduled': { bg: 'bg-blue-50/80 text-blue-700 border-blue-100/50', dot: 'bg-blue-500' },
            'confirmed': { bg: 'bg-green-50/80 text-green-700 border-green-100/50', dot: 'bg-green-500' },
            'completed': { bg: 'bg-gray-50/80 text-gray-700 border-gray-100/50', dot: 'bg-gray-500' },
            'cancelled': { bg: 'bg-red-50/80 text-red-700 border-red-100/50', dot: 'bg-red-500' },
            'no_show': { bg: 'bg-orange-50/80 text-orange-700 border-orange-100/50', dot: 'bg-orange-500' }
        }
        
        return styles[status] || { bg: 'bg-gray-50/80 text-gray-600', dot: 'bg-gray-400' }
    }

    const filteredAppointments = appointments.filter(apt => {
        if (apt.status === 'cancelled') return false
        let matches = true
        if (filterBranch && apt.branch_id !== filterBranch) matches = false
        if (filterStatus && apt.status !== filterStatus) matches = false
        if (startDate && endDate && (apt.appointment_date < startDate || apt.appointment_date > endDate)) matches = false
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            const name = apt.patients?.full_name?.toLowerCase() || ''
            const wa = apt.patients?.whatsapp || ''
            if (!name.includes(query) && !wa.includes(query)) matches = false
        }
        return matches
    })

    // --- CALENDAR LOGIC (PURE JS) ---
    const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()
    const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay()

    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month) // 0 (Sun) to 6 (Sat)
    
    // Calculate trailing empty cells to make calendar grid rectangular
    const totalCellsSoFar = firstDay + daysInMonth
    const remainingCells = (7 - (totalCellsSoFar % 7)) % 7

    const prevMonth = () => {
        setCurrentMonth(new Date(year, month - 1, 1))
    }
    
    const nextMonth = () => {
        setCurrentMonth(new Date(year, month + 1, 1))
    }

    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]

    // Group appointments by date for the calendar
    const appointmentsByDate = {}
    filteredAppointments.forEach(apt => {
        if (!appointmentsByDate[apt.appointment_date]) {
            appointmentsByDate[apt.appointment_date] = []
        }
        appointmentsByDate[apt.appointment_date].push(apt)
    })

    // Slots System
    const TIME_SLOTS = [
        { label: '08:00 - 10:00', startHour: 8, endHour: 10, timeStr: '08:00' },
        { label: '10:00 - 12:00', startHour: 10, endHour: 12, timeStr: '10:00' },
        { label: '12:00 - 14:00', startHour: 12, endHour: 14, timeStr: '12:00' },
        { label: '14:00 - 16:00', startHour: 14, endHour: 16, timeStr: '14:00' },
        { label: '16:00 - 18:00', startHour: 16, endHour: 18, timeStr: '16:00' }
    ]

    const selectedDateAppointments = filteredAppointments.filter(a => a.appointment_date === selectedDate)
    
    const getAppointmentsForSlot = (slot) => {
        return selectedDateAppointments.filter(a => {
            const hour = parseInt(a.start_time.split(':')[0], 10)
            return hour >= slot.startHour && hour < slot.endHour
        })
    }

    const getOtherAppointments = () => {
        return selectedDateAppointments.filter(a => {
            const hour = parseInt(a.start_time.split(':')[0], 10)
            return hour < 8 || hour >= 18
        })
    }

    return (
        <div className="space-y-6">
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row justify-end items-center gap-3">
                <div className="flex bg-white border border-gray-100 p-1.5 rounded-xl shadow-sm">
                    <button 
                        onClick={() => handleViewModeChange('list')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${viewMode === 'list' ? 'bg-ayumi-bg text-ayumi-secondary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        List View
                    </button>
                    <button 
                        onClick={() => handleViewModeChange('calendar')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${viewMode === 'calendar' ? 'bg-ayumi-bg text-ayumi-secondary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Calendar View
                    </button>
                </div>
                <Link href="/appointments/new">
                    <button className="btn-primary py-2.5 px-5 flex items-center gap-2 text-xs cursor-pointer shadow-pink-500/10 shadow-md">
                        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                        Buat Jadwal baru
                    </button>
                </Link>
            </div>

            {/* Filter Bar */}
            <div className="card-ayumi p-4 md:p-6 shadow-sm border border-pink-100/50">
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <div className="flex-1 relative">
                        <svg className="w-5 h-5 absolute left-4 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input 
                            type="text" 
                            placeholder="Cari nama pasien atau WhatsApp..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-ayumi pl-11 py-2.5 bg-gray-50/50 focus:bg-white"
                        />
                    </div>
                    <DateRangePicker 
                        startDate={startDate}
                        endDate={endDate}
                        onChange={(range) => {
                            setStartDate(range.startDate);
                            setEndDate(range.endDate);
                        }}
                        inputClassName="text-xs font-semibold"
                    />
                    {isOwner && (
                        <select 
                            value={filterBranch}
                            onChange={(e) => setFilterBranch(e.target.value)}
                            className="input-ayumi bg-gray-50/50 focus:bg-white w-full md:w-auto text-xs"
                        >
                            <option value="">Semua Cabang</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    )}
                    <select 
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="input-ayumi bg-gray-50/50 focus:bg-white w-full md:w-auto text-xs"
                    >
                        <option value="">Semua Status</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                        <option value="no_show">No Show</option>
                    </select>
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                        <p className="text-gray-500 font-medium">Memuat jadwal...</p>
                    </div>
                ) : (
                    <>
                        {/* 1. LIST VIEW */}
                        {viewMode === 'list' ? (
                            <div className="space-y-6">
                                {/* Sub-view Switcher: Schedule Timeline vs Table View */}
                                <div className="flex justify-between items-center bg-gray-50/80 p-2 rounded-xl border border-gray-100 mb-2">
                                    <div className="text-xs font-extrabold text-gray-500 flex items-center gap-1.5 pl-1">
                                        <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Tampilan List Janji Temu
                                    </div>
                                    <div className="flex bg-white p-1 rounded-lg border border-gray-200/60 shadow-xs gap-1">
                                        <button
                                            onClick={() => setListSubView('schedule')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                                                listSubView === 'schedule'
                                                    ? 'bg-ayumi-primary text-white shadow-sm'
                                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                            }`}
                                        >
                                            Schedule (Jam)
                                        </button>
                                        <button
                                            onClick={() => setListSubView('table')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                                                listSubView === 'table'
                                                    ? 'bg-ayumi-primary text-white shadow-sm'
                                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                            }`}
                                        >
                                            Tabel Ringkas
                                        </button>
                                    </div>
                                </div>

                                {filteredAppointments.length === 0 ? (
                                    <div className="py-16 text-center flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-100">
                                        <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto">
                                            <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        </div>
                                        <p className="text-gray-500 font-medium text-lg">Belum ada jadwal temu.</p>
                                        <p className="text-sm text-gray-400 mt-1">Coba sesuaikan filter pencarian Anda.</p>
                                    </div>
                                ) : listSubView === 'schedule' ? (
                                    /* SCHEDULE TIMELINE VIEW WITH INFUS & TREATMENT COLUMNS */
                                    <div className="space-y-8">
                                        {(() => {
                                            // Group appointments by date
                                            const groupedByDate = {}
                                            filteredAppointments.forEach(apt => {
                                                const d = apt.appointment_date
                                                if (!groupedByDate[d]) groupedByDate[d] = []
                                                groupedByDate[d].push(apt)
                                            })
                                            const sortedDates = Object.keys(groupedByDate).sort()

                                            return sortedDates.map(dateStr => {
                                                const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
                                                    weekday: 'long',
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric'
                                                })

                                                const dayApts = groupedByDate[dateStr]
                                                const totalInfus = dayApts.filter(a => isInfusAppointment(a)).length
                                                const totalTreatment = dayApts.length - totalInfus

                                                return (
                                                    <div key={dateStr} className="bg-white rounded-2xl border border-pink-100/60 p-4 sm:p-6 shadow-sm overflow-hidden">
                                                        {/* Date Section Header */}
                                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100">
                                                            <div className="flex items-center gap-2">
                                                                <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                                </svg>
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
                                                                <div className="flex items-center gap-4 pb-3 mb-2 border-b-2 border-slate-100 text-xs font-black uppercase tracking-wider text-slate-500">
                                                                    <div className="w-20 flex-shrink-0 text-slate-400">Waktu</div>
                                                                    <div className="w-52 flex-shrink-0 flex items-center gap-1.5 text-cyan-800 bg-cyan-50/80 px-3 py-1.5 rounded-xl border border-cyan-100/70">
                                                                        <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                                                                        💧 Layanan Infus
                                                                    </div>
                                                                    <div className="flex-1 flex items-center gap-1.5 text-sky-800 bg-sky-50/80 px-3 py-1.5 rounded-xl border border-sky-100/70">
                                                                        <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                                                                        🌸 Layanan Treatment
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
                                                                            <div key={hourStr} className="flex items-stretch gap-4 py-3 border-b border-slate-100 hover:bg-slate-50/40 transition-colors min-h-[64px]">
                                                                                {/* Waktu (Far Left) */}
                                                                                <div className="w-20 flex-shrink-0 pt-1.5">
                                                                                    <span className="text-base font-black text-slate-600 tracking-tight bg-slate-100/80 px-2.5 py-1 rounded-lg border border-slate-200/50 inline-block">
                                                                                        {hourStr}
                                                                                    </span>
                                                                                </div>

                                                                                {/* Column 1: Infus (Left Column) */}
                                                                                <div className="w-52 flex-shrink-0 border-l border-slate-100 pl-3">
                                                                                    {infusApts.length === 0 ? (
                                                                                        <div className="h-full min-h-[36px] flex items-center text-xs text-slate-300 italic font-medium pl-1">
                                                                                            -
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="flex flex-col gap-2.5">
                                                                                            {infusApts.map(apt => {
                                                                                                const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Infus'
                                                                                                const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                                const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''

                                                                                                return (
                                                                                                    <div 
                                                                                                        key={apt.id}
                                                                                                        className="bg-gradient-to-r from-cyan-50 to-sky-50 border border-cyan-200 text-slate-800 rounded-lg p-3.5 w-full shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
                                                                                                    >
                                                                                                        <div>
                                                                                                            {/* Header: Time & Ubah Link */}
                                                                                                            <div className="flex justify-between items-center text-xs font-bold text-cyan-950 pb-2 mb-2 border-b border-cyan-200/80">
                                                                                                                <span className="flex items-center gap-1 text-cyan-900">
                                                                                                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
                                                                                                                    💧 {startTime} - {endTime}
                                                                                                                </span>
                                                                                                                <Link href={`/appointments/${apt.id}`}>
                                                                                                                    <span className="text-cyan-700 hover:text-cyan-900 flex items-center gap-1 font-bold text-[11px] cursor-pointer hover:underline">
                                                                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                                                                                        </svg>
                                                                                                                        Ubah
                                                                                                                    </span>
                                                                                                                </Link>
                                                                                                            </div>

                                                                                                            {/* Customer Name */}
                                                                                                            <div className="font-extrabold text-sm text-slate-900 tracking-tight">
                                                                                                                {apt.patients?.full_name || 'Pasien'}
                                                                                                            </div>

                                                                                                            {/* Treatment list */}
                                                                                                            <div className="text-xs text-cyan-900 font-semibold mt-1 leading-snug bg-cyan-100/60 px-2 py-1 rounded border border-cyan-200/50 inline-block">
                                                                                                                💧 {treatmentsList}
                                                                                                            </div>

                                                                                                            {/* Therapist & Branch Info */}
                                                                                                            {(apt.therapist?.full_name || apt.branches?.name) && (
                                                                                                                <div className="text-[11px] text-cyan-900/70 font-medium mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
                                                                                                                    {apt.therapist?.full_name && <span>Petugas/Terapis: <b>{apt.therapist.full_name.split(' ')[0]}</b></span>}
                                                                                                                    {apt.branches?.name && <span>• Cabang: <b>{apt.branches.name}</b></span>}
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>

                                                                                                        {/* Footer: Arrival / Status & Hapus Button */}
                                                                                                        <div className="mt-3 pt-2 border-t border-cyan-200/80 flex items-center justify-between gap-2">
                                                                                                            <div className="flex-1">
                                                                                                                {getArrivalStatusBadgeAndActions(apt) || getStatusBadge(apt)}
                                                                                                            </div>

                                                                                                            <button
                                                                                                                onClick={(e) => handleDeleteAppointment(apt.id, e)}
                                                                                                                className="text-red-500 hover:text-red-700 flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-colors"
                                                                                                                title="Hapus Jadwal"
                                                                                                            >
                                                                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                                                </svg>
                                                                                                                Hapus
                                                                                                            </button>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                )
                                                                                            })}
                                                                                        </div>
                                                                                    )}
                                                                                </div>

                                                                                {/* Column 2: Treatment (Strict Horizontal Row, No Wrapping) */}
                                                                                <div className="flex-1 border-l border-slate-100 pl-3">
                                                                                    {treatmentApts.length === 0 ? (
                                                                                        <div className="h-full min-h-[36px] flex items-center text-xs text-slate-300 italic font-medium pl-1">
                                                                                            -
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="flex flex-row flex-nowrap gap-3 items-stretch py-0.5">
                                                                                            {treatmentApts.map(apt => {
                                                                                                const treatmentsList = apt.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || apt.notes || 'Treatment'
                                                                                                const startTime = apt.start_time ? apt.start_time.substring(0, 5) : ''
                                                                                                const endTime = apt.end_time ? apt.end_time.substring(0, 5) : ''

                                                                                                return (
                                                                                                    <div 
                                                                                                        key={apt.id}
                                                                                                        className="bg-[#d7effe] border border-[#9ed6f8] text-gray-800 rounded-lg p-3.5 w-[250px] flex-shrink-0 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
                                                                                                    >
                                                                                                        <div>
                                                                                                            {/* Header: Time & Ubah Link */}
                                                                                                            <div className="flex justify-between items-center text-xs font-bold text-sky-950 pb-2 mb-2 border-b border-sky-200/70">
                                                                                                                <span className="flex items-center gap-1">
                                                                                                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-600"></span>
                                                                                                                    {startTime} - {endTime}
                                                                                                                </span>
                                                                                                                <Link href={`/appointments/${apt.id}`}>
                                                                                                                    <span className="text-sky-600 hover:text-sky-800 flex items-center gap-1 font-bold text-[11px] cursor-pointer hover:underline">
                                                                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                                                                                        </svg>
                                                                                                                        Ubah
                                                                                                                    </span>
                                                                                                                </Link>
                                                                                                            </div>

                                                                                                            {/* Customer Name */}
                                                                                                            <div className="font-extrabold text-sm text-gray-900 tracking-tight">
                                                                                                                {apt.patients?.full_name || 'Pasien'}
                                                                                                            </div>

                                                                                                            {/* Treatment list */}
                                                                                                            <div className="text-xs text-gray-700 font-medium mt-1 leading-snug">
                                                                                                                {treatmentsList}
                                                                                                            </div>

                                                                                                            {/* Therapist & Branch Info */}
                                                                                                            {(apt.therapist?.full_name || apt.branches?.name) && (
                                                                                                                <div className="text-[11px] text-sky-900/70 font-medium mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
                                                                                                                    {apt.therapist?.full_name && <span>Terapis: <b>{apt.therapist.full_name.split(' ')[0]}</b></span>}
                                                                                                                    {apt.branches?.name && <span>• Cabang: <b>{apt.branches.name}</b></span>}
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>

                                                                                                        {/* Footer: Arrival / Status & Hapus Button */}
                                                                                                        <div className="mt-3 pt-2 border-t border-sky-200/70 flex items-center justify-between gap-2">
                                                                                                            <div className="flex-1">
                                                                                                                {getArrivalStatusBadgeAndActions(apt) || getStatusBadge(apt)}
                                                                                                            </div>

                                                                                                            <button
                                                                                                                onClick={(e) => handleDeleteAppointment(apt.id, e)}
                                                                                                                className="text-red-500 hover:text-red-700 flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-colors"
                                                                                                                title="Hapus Jadwal"
                                                                                                            >
                                                                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                                                </svg>
                                                                                                                Hapus
                                                                                                            </button>
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
                                ) : (
                                    /* TABLE VIEW */
                                    <div className="overflow-x-auto">
                                        <table className="whitespace-nowrap w-full text-left border-collapse">
                                            <thead className="bg-ayumi-table-header text-ayumi-secondary text-xs font-extrabold uppercase tracking-wider">
                                                <tr>
                                                    <th className="p-4 rounded-tl-xl">Waktu</th>
                                                    <th className="p-4">Pasien</th>
                                                    <th className="p-4">Cabang</th>
                                                    <th className="p-4">Terapis</th>
                                                    <th className="p-4">Alur Kedatangan</th>
                                                    <th className="p-4">Status</th>
                                                    <th className="p-4 text-center rounded-tr-xl">Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 text-sm">
                                                {filteredAppointments.map(apt => (
                                                    <tr key={apt.id} className="hover:bg-ayumi-table-hover transition-colors">
                                                        <td className="p-4">
                                                            <div className="font-bold text-ayumi-text">{new Date(apt.appointment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                                                            <div className="text-xs text-ayumi-primary font-bold mt-1">
                                                                {apt.start_time ? apt.start_time.substring(0, 5) : '-'} - {apt.end_time ? apt.end_time.substring(0, 5) : '-'}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-800">{apt.patients?.full_name}</div>
                                                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                                                {apt.patients?.whatsapp}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-gray-600 font-bold">{apt.branches?.name}</td>
                                                        <td className="p-4 text-xs text-gray-600 font-bold">
                                                            {apt.therapist?.full_name ? apt.therapist.full_name.split(' ')[0] : <span className="text-gray-400 italic font-normal">Belum assign</span>}
                                                        </td>
                                                        <td className="p-4">
                                                            {getArrivalStatusBadgeAndActions(apt)}
                                                        </td>
                                                        <td className="p-4">
                                                            {getStatusBadge(apt)}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <Link href={`/appointments/${apt.id}`}>
                                                                    <button className="text-xs font-extrabold text-ayumi-primary hover:text-white hover:bg-ayumi-primary px-3 py-1.5 rounded-lg transition-all border border-pink-100">
                                                                        Detail
                                                                    </button>
                                                                </Link>
                                                                <button 
                                                                    onClick={(e) => handleDeleteAppointment(apt.id, e)}
                                                                    className="text-xs font-extrabold text-red-500 hover:text-white hover:bg-red-500 px-3 py-1.5 rounded-lg transition-all border border-red-100"
                                                                >
                                                                    Hapus
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* 2. CALENDAR + TIMELINE VIEW */
                            <div className="flex flex-col lg:flex-row gap-6">
                                {/* Calendar Grid Box */}
                                <div className="flex-1 card-ayumi p-4 sm:p-6 border border-pink-100/60 bg-white shadow-sm rounded-2xl">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-100">
                                        <div>
                                            <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                                <span>{monthNames[month]} {year}</span>
                                            </h3>
                                            <p className="text-xs text-gray-400 font-medium mt-0.5">Pilih tanggal untuk melihat rincian agenda</p>
                                        </div>

                                        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200/60">
                                            <button 
                                                onClick={prevMonth} 
                                                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-ayumi-primary transition-all shadow-xs cursor-pointer"
                                                title="Bulan Sebelumnya"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setCurrentMonth(new Date())
                                                    setSelectedDate(new Date().toISOString().split('T')[0])
                                                }} 
                                                className="px-3 py-1 rounded-lg hover:bg-white text-xs font-extrabold text-ayumi-primary transition-all shadow-xs cursor-pointer"
                                            >
                                                Hari Ini
                                            </button>
                                            <button 
                                                onClick={nextMonth} 
                                                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-ayumi-primary transition-all shadow-xs cursor-pointer"
                                                title="Bulan Berikutnya"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="overflow-x-auto pb-2 custom-scrollbar">
                                        <div className="grid grid-cols-7 gap-1.5 min-w-[550px] md:min-w-0">
                                            {dayNames.map((day, idx) => (
                                                <div 
                                                    key={day} 
                                                    className={`text-center font-extrabold text-[11px] py-2 uppercase tracking-wider rounded-lg ${
                                                        idx === 0 || idx === 6 ? 'text-pink-400 bg-pink-50/30' : 'text-slate-400 bg-slate-50/50'
                                                    }`}
                                                >
                                                    {day}
                                                </div>
                                            ))}
                                            
                                            {/* Empty cells before 1st of month */}
                                            {Array.from({ length: firstDay }).map((_, i) => (
                                                <div key={`empty-${i}`} className="p-2 min-h-[100px] rounded-xl bg-slate-50/30 border border-slate-100/40"></div>
                                            ))}
                                            
                                            {/* Days of Month */}
                                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                                const d = i + 1
                                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                                                const isSelected = selectedDate === dateStr
                                                const isToday = new Date().toISOString().split('T')[0] === dateStr
                                                const dayAppointments = appointmentsByDate[dateStr] || []
                                                
                                                return (
                                                    <div 
                                                        key={d} 
                                                        onClick={() => setSelectedDate(dateStr)}
                                                        className={`p-2 min-h-[105px] rounded-xl border transition-all duration-150 flex flex-col relative overflow-hidden cursor-pointer ${
                                                            isSelected 
                                                                ? 'border-pink-500 bg-pink-50/60 shadow-sm ring-2 ring-pink-400/30' 
                                                                : isToday 
                                                                    ? 'border-pink-300 bg-white shadow-xs' 
                                                                    : 'border-gray-100/90 hover:border-pink-300 hover:bg-pink-50/20 bg-white shadow-2xs'
                                                        }`}
                                                    >
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <span className={`text-xs font-extrabold w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                                                                isToday 
                                                                    ? 'bg-ayumi-primary text-white shadow-sm' 
                                                                    : isSelected ? 'bg-pink-200 text-pink-900' : 'text-slate-700'
                                                            }`}>
                                                                {d}
                                                            </span>
                                                            {dayAppointments.length > 0 && (
                                                                <span className="text-[10px] font-black bg-pink-100 text-ayumi-primary px-1.5 py-0.5 rounded-full shadow-2xs">
                                                                    {dayAppointments.length}
                                                                </span>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Mini Badges inside calendar cell */}
                                                        <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-0.5">
                                                            {dayAppointments.slice(0, 2).map((a, idx) => {
                                                                const style = getMiniAptStyle(a)
                                                                return (
                                                                    <div 
                                                                        key={idx} 
                                                                        className={`flex items-center justify-between text-[9.5px] leading-tight font-bold px-1.5 py-0.5 rounded border transition-all ${style.bg}`}
                                                                        title={`${a.patients?.full_name} (${a.start_time ? a.start_time.substring(0,5) : ''})`}
                                                                    >
                                                                        <div className="flex items-center gap-1 truncate">
                                                                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`}></div>
                                                                            <span className="truncate">{a.patients?.full_name?.split(' ')[0]}</span>
                                                                        </div>
                                                                        <span className="text-[8.5px] opacity-75 flex-shrink-0 ml-0.5">{a.start_time ? a.start_time.substring(0,5) : ''}</span>
                                                                    </div>
                                                                )
                                                            })}
                                                            {dayAppointments.length > 2 && (
                                                                <div className="text-[9px] text-pink-600 font-extrabold pl-1 pt-0.5">
                                                                    +{dayAppointments.length - 2} lainnya
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}

                                            {/* Empty cells after last day of month to complete rectangular week rows */}
                                            {Array.from({ length: remainingCells }).map((_, i) => (
                                                <div key={`empty-end-${i}`} className="p-2 min-h-[100px] rounded-xl bg-slate-50/30 border border-slate-100/40"></div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
 
                                {/* Side Panel for Selected Date (Timeline Agenda) */}
                                <div className="w-full lg:w-[380px] flex flex-col gap-4">
                                    <div className="bg-gradient-to-br from-slate-900 via-pink-950 to-slate-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden border border-pink-900/30">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 rounded-full blur-xl pointer-events-none"></div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[11px] font-bold text-pink-300 uppercase tracking-wider flex items-center gap-1.5">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                                Jadwal Agenda
                                            </span>
                                            <span className="text-xs font-extrabold bg-pink-500/20 text-pink-200 border border-pink-500/30 px-2.5 py-0.5 rounded-full">
                                                {selectedDateAppointments.length} Janji Temu
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-black leading-tight tracking-tight text-white mt-1">
                                            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                        </h3>
                                    </div>
 
                                    <div className="flex-1 bg-white border border-pink-100/60 rounded-2xl p-4 sm:p-5 space-y-4 max-h-[620px] overflow-y-auto custom-scrollbar shadow-sm">
                                        {TIME_SLOTS.map((slot, i) => {
                                            const slotApts = getAppointmentsForSlot(slot)
                                            return (
                                                <div key={i} className="flex flex-col gap-2.5 pb-4 border-b border-gray-100/80 last:border-b-0 last:pb-0">
                                                    {/* Slot Time Label Header */}
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[11px] font-extrabold text-slate-600 bg-slate-100/80 px-2.5 py-1 rounded-md border border-slate-200/50 inline-flex items-center gap-1.5">
                                                            <svg className="w-3 h-3 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            Jam {slot.label}
                                                        </span>
                                                        {slotApts.length > 0 && (
                                                            <span className="text-[10px] text-gray-400 font-semibold">{slotApts.length} Janji</span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Slot Content Cards */}
                                                    <div className="space-y-2.5">
                                                        {slotApts.length === 0 ? (
                                                            <Link href={`/appointments/new?date=${selectedDate}&time=${slot.timeStr}`}>
                                                                <div className="border border-dashed border-slate-200 rounded-xl p-3 flex items-center justify-between text-slate-400 hover:text-ayumi-primary hover:border-ayumi-primary hover:bg-pink-50/40 transition-all cursor-pointer group">
                                                                    <span className="font-bold text-xs">Slot Masih Kosong</span>
                                                                    <span className="text-[11px] font-extrabold text-ayumi-primary group-hover:underline flex items-center gap-1">
                                                                        + Tambah
                                                                    </span>
                                                                </div>
                                                            </Link>
                                                        ) : (
                                                            <div className="space-y-2.5">
                                                                {slotApts.map(a => {
                                                                    const treatmentsList = a.appointment_treatments?.map(at => at.treatments?.name).filter(Boolean).join(', ') || a.notes || ''
                                                                    return (
                                                                        <div key={a.id} className="bg-white border border-pink-100 rounded-xl p-3.5 shadow-xs relative overflow-hidden group hover:shadow-md transition-shadow">
                                                                            {/* Color indicator bar on left */}
                                                                            <div className={`absolute top-0 left-0 w-1.5 h-full ${
                                                                                a.status === 'scheduled' ? 'bg-blue-500' :
                                                                                a.status === 'confirmed' ? 'bg-emerald-500' :
                                                                                a.status === 'completed' ? (a.treatment_records && a.treatment_records.length > 0 ? 'bg-slate-400' : 'bg-amber-500') :
                                                                                a.status === 'cancelled' ? 'bg-rose-500' : 'bg-orange-500'
                                                                            }`}></div>
                                                                            
                                                                            <div className="pl-2">
                                                                                {/* Top Bar: Patient Name & Status */}
                                                                                <div className="flex justify-between items-start gap-2">
                                                                                    <div>
                                                                                        <div className="font-extrabold text-sm text-slate-900 tracking-tight">{a.patients?.full_name || 'Pasien'}</div>
                                                                                        <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1 mt-0.5">
                                                                                            <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                                            {a.start_time ? a.start_time.substring(0,5) : ''} - {a.end_time ? a.end_time.substring(0,5) : ''}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>{getStatusBadge(a)}</div>
                                                                                </div>

                                                                                {/* Treatment Name */}
                                                                                {treatmentsList && (
                                                                                    <div className="text-xs font-semibold text-ayumi-primary mt-1.5 flex items-start gap-1 bg-pink-50/60 p-1.5 rounded-lg border border-pink-100/50">
                                                                                        <svg className="w-3.5 h-3.5 text-ayumi-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                                                                        <span className="line-clamp-2">{treatmentsList}</span>
                                                                                    </div>
                                                                                )}

                                                                                {/* Info: Therapist & Quick Link */}
                                                                                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                                                                                    <span className="flex items-center gap-1 text-[11px]">
                                                                                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                                                        Terapis: <span className="font-bold text-slate-800">{a.therapist?.full_name ? a.therapist.full_name.split(' ')[0] : <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">Belum assign</span>}</span>
                                                                                    </span>

                                                                                    <div className="flex items-center gap-2">
                                                                                        <Link href={`/appointments/${a.id}`}>
                                                                                            <span className="text-[10px] font-extrabold text-ayumi-primary hover:underline cursor-pointer">Edit →</span>
                                                                                        </Link>
                                                                                        <button 
                                                                                            onClick={(e) => handleDeleteAppointment(a.id, e)}
                                                                                            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 cursor-pointer"
                                                                                            title="Hapus"
                                                                                        >
                                                                                            Hapus
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                                
                                                                                {/* Arrival Status Actions inside card */}
                                                                                {getArrivalStatusBadgeAndActions(a) && (
                                                                                    <div className="flex justify-center mt-2 pt-2 border-t border-dashed border-slate-100">
                                                                                        {getArrivalStatusBadgeAndActions(a)}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                })}
                                                                
                                                                {/* Allow adding more appointments in same slot */}
                                                                <Link href={`/appointments/new?date=${selectedDate}&time=${slot.timeStr}`}>
                                                                    <div className="border border-dashed border-slate-200 rounded-lg p-2 flex items-center justify-center gap-1 text-slate-400 hover:text-ayumi-primary hover:border-ayumi-primary hover:bg-pink-50/30 transition-all cursor-pointer">
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                                                                        <span className="font-bold text-[10px]">Tambah Janji Temu</span>
                                                                    </div>
                                                                </Link>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                        
                                        {/* Waktu Lainnya (outside 08:00 - 18:00) */}
                                        {getOtherAppointments().length > 0 && (
                                            <div className="space-y-3 mt-4 pt-4 border-t-2 border-slate-100 border-dashed">
                                                <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">Waktu Lainnya</div>
                                                {getOtherAppointments().map(a => (
                                                    <div key={a.id} className="bg-white border border-pink-100 rounded-xl p-3 shadow-xs relative overflow-hidden">
                                                        <div className="flex justify-between items-start pl-2">
                                                            <div>
                                                                <div className="font-bold text-sm text-slate-800">{a.patients?.full_name}</div>
                                                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{a.start_time ? a.start_time.substring(0,5) : ''} - {a.end_time ? a.end_time.substring(0,5) : ''}</div>
                                                            </div>
                                                            <div>{getStatusBadge(a)}</div>
                                                        </div>
                                                        <div className="pl-2 mt-2 pt-2 border-t border-slate-100 flex justify-between items-center text-xs">
                                                            <span className="text-[11px] text-slate-600">Terapis: <b>{a.therapist?.full_name ? a.therapist.full_name.split(' ')[0] : 'Belum assign'}</b></span>
                                                            <Link href={`/appointments/${a.id}`}>
                                                                <span className="text-[10px] font-bold text-ayumi-primary hover:underline">Detail →</span>
                                                            </Link>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
