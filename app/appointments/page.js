'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

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
    const [filterBranch, setFilterBranch] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [filterDate, setFilterDate] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [isOwner, setIsOwner] = useState(false)

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

        // Fetch Appointments with Patient Info
        let query = supabase
            .from('appointments')
            .select(`
                *,
                patients (full_name, whatsapp),
                branches (name),
                therapist:users!appointments_therapist_id_fkey (full_name),
                treatment_records (id, result_notes)
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
                const startHour = apt.start_time.substring(0, 5)

                const { error: notifErr } = await supabase
                    .from('notifications')
                    .insert([{
                        recipient_id: apt.therapist_id,
                        sender_id: user.id,
                        appointment_id: apt.id,
                        type: 'patient_arrived',
                        title: 'Pasien Sudah Datang',
                        message: `${apt.patients?.full_name} sudah datang untuk treatment ${treatmentNames} jam ${startHour}.`
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
        if (filterDate && apt.appointment_date !== filterDate) matches = false
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
            <div className="card-ayumi p-6 shadow-sm border border-pink-100/50">
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
                    <input 
                        type="date" 
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="input-ayumi bg-gray-50/50 focus:bg-white w-full md:w-auto text-xs"
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
                                        {filteredAppointments.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                                    <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto">
                                                        <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    </div>
                                                    <p className="text-gray-500 font-medium text-lg">Belum ada jadwal temu.</p>
                                                    <p className="text-sm text-gray-400 mt-1">Coba sesuaikan filter pencarian Anda.</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredAppointments.map(apt => (
                                                <tr key={apt.id} className="hover:bg-ayumi-table-hover transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-ayumi-text">{new Date(apt.appointment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                                                        <div className="text-xs text-ayumi-primary font-bold mt-1">
                                                            {apt.start_time.substring(0, 5)} - {apt.end_time.substring(0, 5)}
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
                                                        <Link href={`/appointments/${apt.id}`}>
                                                            <button className="text-xs font-extrabold text-ayumi-primary hover:text-white hover:bg-ayumi-primary px-4 py-2 rounded-lg transition-all border border-pink-100">
                                                                Detail
                                                            </button>
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            /* 2. CALENDAR + TIMELINE VIEW */
                            <div className="flex flex-col lg:flex-row gap-6">
                                {/* Calendar Grid Box */}
                                <div className="flex-1 card-ayumi p-6 border border-gray-100 bg-white shadow-sm rounded-2xl">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="text-lg font-black text-ayumi-secondary">
                                            {monthNames[month]} {year}
                                        </h3>
                                        <div className="flex gap-1 bg-gray-50 p-1 rounded-xl">
                                            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-pink-100/50 text-ayumi-primary transition-colors">
                                                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                            </button>
                                            <button onClick={() => setCurrentMonth(new Date())} className="px-3.5 py-1.5 rounded-lg hover:bg-pink-100/50 text-xs font-bold text-ayumi-primary transition-all">
                                                Hari Ini
                                            </button>
                                            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-pink-100/50 text-ayumi-primary transition-colors">
                                                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="overflow-x-auto pb-4 custom-scrollbar">
                                        <div className="grid grid-cols-7 gap-1.5 min-w-[500px] md:min-w-0">
                                        {dayNames.map(day => (
                                            <div key={day} className="text-center font-extrabold text-gray-400 text-[10px] py-2 uppercase tracking-wider">
                                                {day}
                                            </div>
                                        ))}
                                        
                                        {/* Empty cells before 1st of month */}
                                        {Array.from({ length: firstDay }).map((_, i) => (
                                            <div key={`empty-${i}`} className="p-2 h-24 rounded-xl bg-gray-50/40 border border-gray-50/50"></div>
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
                                                    className={`p-2 h-24 rounded-xl border transition-all flex flex-col relative overflow-hidden ${
                                                        isSelected 
                                                            ? 'border-ayumi-primary bg-pink-50 shadow-sm' 
                                                            : isToday ? 'border-pink-200 bg-white shadow-sm' : 'border-gray-100 hover:border-pink-300 bg-white'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-start mb-1.5">
                                                        <span className={`text-xs font-black w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-700'}`}>
                                                            {d}
                                                        </span>
                                                        {dayAppointments.length > 0 && (
                                                            <span className="text-[9px] font-extrabold bg-pink-100 text-ayumi-primary px-1.5 py-0.5 rounded">
                                                                {dayAppointments.length}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Mini Badges inside calendar cell */}
                                                    <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
                                                        {dayAppointments.slice(0, 2).map((a, idx) => {
                                                            const style = getMiniAptStyle(a)
                                                            return (
                                                                <div 
                                                                    key={idx} 
                                                                    className={`flex items-center gap-1 text-[9px] leading-tight font-bold px-1.5 py-0.5 rounded border ${style.bg}`}
                                                                >
                                                                    <div className={`w-1 h-1 rounded-full flex-shrink-0 ${style.dot}`}></div>
                                                                    <span className="truncate">{a.start_time.substring(0,5)} {a.patients?.full_name?.split(' ')[0]}</span>
                                                                </div>
                                                            )
                                                        })}
                                                        {dayAppointments.length > 2 && (
                                                            <div className="text-[9px] text-gray-400 font-extrabold pl-1.5">
                                                                +{dayAppointments.length - 2} lainnya
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}

                                        {/* Empty cells after last day of month to complete rectangular week rows */}
                                        {Array.from({ length: remainingCells }).map((_, i) => (
                                            <div key={`empty-end-${i}`} className="p-2 h-24 rounded-xl bg-gray-50/40 border border-gray-50/50"></div>
                                        ))}
                                    </div>
                                    </div>
                                </div>
 
                                {/* Side Panel for Selected Date (Timeline Agenda) */}
                                <div className="w-full lg:w-96 flex flex-col gap-4">
                                    <div className="bg-ayumi-secondary rounded-2xl p-5 text-white shadow-md relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-8 -mt-8"></div>
                                        <div className="text-xs font-semibold text-pink-200 mb-0.5">Jadwal pada tanggal</div>
                                        <h3 className="text-base font-black leading-tight tracking-tight">
                                            {new Date(selectedDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                        </h3>
                                    </div>
 
                                    <div className="flex-1 bg-white border border-pink-100/50 rounded-2xl p-5 space-y-5 max-h-[600px] overflow-y-auto custom-scrollbar shadow-sm">
                                        {TIME_SLOTS.map((slot, i) => {
                                            const slotApts = getAppointmentsForSlot(slot)
                                            return (
                                                <div key={i} className="flex flex-col sm:flex-row gap-3 items-start border-b border-gray-100/50 pb-4 last:border-b-0 last:pb-0">
                                                    {/* Slot Time Label (Left) */}
                                                    <div className="w-full sm:w-28 flex-shrink-0 pt-1">
                                                        <div className="text-[10px] font-black text-ayumi-secondary tracking-wider uppercase bg-pink-100/50 px-2.5 py-1.5 rounded-lg inline-block sm:block text-center border border-pink-100">
                                                            {slot.label}
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Slot Content Cards (Right) */}
                                                    <div className="flex-1 w-full space-y-2">
                                                        {slotApts.length === 0 ? (
                                                            <Link href={`/appointments/new?date=${selectedDate}&time=${slot.timeStr}`}>
                                                                <div className="border border-dashed border-gray-200 rounded-xl p-3 flex items-center justify-between text-gray-400 hover:text-ayumi-primary hover:border-ayumi-primary hover:bg-pink-50/50 transition-all cursor-pointer group">
                                                                    <span className="font-extrabold text-xs">Slot Tersedia</span>
                                                                    <svg className="w-4 h-4 transition-transform group-hover:scale-110 text-gray-400 group-hover:text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                                                                </div>
                                                            </Link>
                                                        ) : (
                                                            <div className="space-y-2">
                                                                {slotApts.map(a => (
                                                                    <div key={a.id} className="bg-white border border-pink-100/80 rounded-xl p-3 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                                                                        {/* Status color indicator bar on left */}
                                                                        <div className={`absolute top-0 left-0 w-1 h-full ${
                                                                            a.status === 'scheduled' ? 'bg-blue-400' :
                                                                            a.status === 'confirmed' ? 'bg-green-400' :
                                                                            a.status === 'completed' ? (a.treatment_records && a.treatment_records.length > 0 ? 'bg-gray-400' : 'bg-yellow-400') :
                                                                            a.status === 'cancelled' ? 'bg-red-400' : 'bg-orange-400'
                                                                        }`}></div>
                                                                        
                                                                        <div className="flex justify-between items-start pl-2">
                                                                            <div>
                                                                                <div className="font-bold text-sm text-gray-800 tracking-tight">{a.patients?.full_name}</div>
                                                                                <div className="text-[10px] text-gray-500 font-semibold flex items-center gap-1 mt-0.5">
                                                                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                                    {a.start_time.substring(0,5)} - {a.end_time.substring(0,5)}
                                                                                </div>
                                                                            </div>
                                                                            <div className="scale-75 origin-top-right">{getStatusBadge(a)}</div>
                                                                        </div>
                                                                        
                                                                        <div className="pl-2 mt-3 pt-2.5 border-t border-gray-50 flex flex-col gap-2">
                                                                            <div className="flex justify-between items-center text-xs text-gray-500 font-medium">
                                                                                <span className="flex items-center gap-1 text-[11px]">
                                                                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                                                    Terapis: <span className="font-bold text-gray-700">{a.therapist?.full_name ? a.therapist.full_name.split(' ')[0] : 'Belum assign'}</span>
                                                                                </span>
                                                                                <Link href={`/appointments/${a.id}`}>
                                                                                    <span className="text-[10px] font-extrabold text-ayumi-primary hover:text-ayumi-primary-hover hover:underline cursor-pointer">Detail →</span>
                                                                                </Link>
                                                                            </div>
                                                                            
                                                                            {/* Arrival status actions inside card */}
                                                                            {getArrivalStatusBadgeAndActions(a) && (
                                                                                <div className="flex justify-center mt-1.5 pt-2 border-t border-dashed border-gray-100">
                                                                                    {getArrivalStatusBadgeAndActions(a)}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                
                                                                {/* Compact allow adding more appointments in same slot */}
                                                                <Link href={`/appointments/new?date=${selectedDate}&time=${slot.timeStr}`}>
                                                                    <div className="border border-dashed border-gray-200 rounded-lg p-2 flex items-center justify-center gap-1 text-gray-400 hover:text-ayumi-primary hover:border-ayumi-primary hover:bg-pink-50/50 transition-all cursor-pointer">
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
                                            <div className="space-y-3 mt-4 pt-4 border-t-2 border-gray-100 border-dashed">
                                                <div className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2">Waktu Lainnya</div>
                                                {getOtherAppointments().map(a => (
                                                    <div key={a.id} className="flex flex-col sm:flex-row gap-3 items-start">
                                                        <div className="w-full sm:w-28 flex-shrink-0 pt-1">
                                                            <div className="text-[10px] font-black text-ayumi-secondary tracking-wider uppercase bg-pink-100/50 px-2.5 py-1.5 rounded-lg inline-block sm:block text-center border border-pink-100">
                                                                {a.start_time.substring(0,5)} - {a.end_time.substring(0,5)}
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 w-full">
                                                            <div className="bg-white border border-pink-100/80 rounded-xl p-3 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                                                                <div className={`absolute top-0 left-0 w-1 h-full ${
                                                                    a.status === 'scheduled' ? 'bg-blue-400' :
                                                                    a.status === 'confirmed' ? 'bg-green-400' :
                                                                    a.status === 'completed' ? (a.treatment_records && a.treatment_records.length > 0 ? 'bg-gray-400' : 'bg-yellow-400') :
                                                                    a.status === 'cancelled' ? 'bg-red-400' : 'bg-orange-400'
                                                                }`}></div>
                                                                <div className="flex justify-between items-start pl-2">
                                                                    <div>
                                                                        <div className="font-bold text-sm text-gray-800 tracking-tight">{a.patients?.full_name}</div>
                                                                        <div className="text-[10px] text-gray-500 font-semibold mt-0.5">Cabang: {a.branches?.name}</div>
                                                                    </div>
                                                                    <div className="scale-75 origin-top-right">{getStatusBadge(a)}</div>
                                                                </div>
                                                                <div className="pl-2 mt-3 pt-2.5 border-t border-gray-50 flex justify-between items-center text-xs text-gray-500 font-medium">
                                                                    <span className="flex items-center gap-1 text-[11px]">
                                                                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                                        Terapis: <span className="font-bold text-gray-700">{a.therapist?.full_name ? a.therapist.full_name.split(' ')[0] : 'Belum assign'}</span>
                                                                    </span>
                                                                    <Link href={`/appointments/${a.id}`}>
                                                                        <span className="text-[10px] font-extrabold text-ayumi-primary hover:text-ayumi-primary-hover hover:underline cursor-pointer">Detail →</span>
                                                                    </Link>
                                                                </div>
                                                            </div>
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
