'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import DateRangePicker from '../../components/DateRangePicker'

export default function AppointmentsPage() {
    const [appointments, setAppointments] = useState([])
    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)
    
    // Filters & States
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
    const SCHEDULE_HOURS = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00']

    useEffect(() => {
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
                    className="text-[10px] font-extrabold text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded-md transition-colors shadow-2xs cursor-pointer"
                >
                    Pasien Datang
                </button>
            )
        }

        if (status === 'arrived') {
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1"></span>
                    Menunggu
                </span>
            )
        }

        if (status === 'therapist_ready') {
            return (
                <div className="flex items-center gap-1">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1"></span>
                        Siap!
                    </span>
                    <button
                        onClick={handlePatientEnter}
                        className="text-[10px] font-bold text-white bg-pink-500 hover:bg-pink-600 px-1.5 py-0.5 rounded-md transition-colors shadow-2xs cursor-pointer"
                    >
                        Masuk
                    </button>
                </div>
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

        return null
    }

    const getStatusBadge = (a) => {
        const status = a.status
        const hasSoap = a.treatment_records && a.treatment_records.length > 0 && a.treatment_records[0].result_notes;

        if (status === 'completed' && !hasSoap) {
            return (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold border bg-amber-50 text-amber-700 border-amber-200">
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
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${colorClass}`}>
                {labels[status] || status}
            </span>
        )
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

    return (
        <div className="space-y-4">
            {/* Top Action Bar */}
            <div className="flex justify-end items-center">
                <Link href="/appointments/new">
                    <button className="btn-primary py-2 px-4 flex items-center gap-1.5 text-xs cursor-pointer shadow-pink-500/10 shadow-sm font-bold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                        Buat Jadwal Baru
                    </button>
                </Link>
            </div>

            {/* Main Container Card */}
            <div className="card-ayumi p-3.5 sm:p-5 shadow-sm border border-pink-100/50">
                {/* Filter Bar Compact */}
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
                        startDate={startDate}
                        endDate={endDate}
                        onChange={(range) => {
                            setStartDate(range.startDate);
                            setEndDate(range.endDate);
                        }}
                        inputClassName="text-xs font-semibold py-2"
                    />
                    {isOwner && (
                        <select 
                            value={filterBranch}
                            onChange={(e) => setFilterBranch(e.target.value)}
                            className="input-ayumi bg-gray-50/50 focus:bg-white w-full md:w-auto text-xs py-2"
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
                                Papan Jadwal Janji Temu
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

                            const rangeDates = getDatesInRange(startDate, endDate)
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
                                                                                <Link 
                                                                                    href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}&notes=Infus`} 
                                                                                    className="w-full min-h-[36px] border border-dashed border-slate-200/80 hover:border-cyan-300 hover:bg-cyan-50/40 rounded-lg transition-all flex items-center px-2.5 text-[11px] text-slate-400 hover:text-cyan-700 font-semibold gap-1.5 group cursor-pointer"
                                                                                    title={`Tambah Infus Jam ${hourStr.replace('.', ':')}`}
                                                                                >
                                                                                    <span className="w-4 h-4 rounded-full bg-slate-100 group-hover:bg-cyan-100 text-slate-400 group-hover:text-cyan-700 flex items-center justify-center font-bold text-[10px] transition-colors">+</span>
                                                                                    <span className="opacity-70 group-hover:opacity-100 transition-opacity">Tambah Infus</span>
                                                                                </Link>
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
                                                                                                    {/* Header: Time & Ubah Link */}
                                                                                                    <div className="flex justify-between items-center text-[10.5px] font-bold text-cyan-950 pb-1 mb-1 border-b border-cyan-200/70">
                                                                                                        <span className="flex items-center gap-1 text-cyan-900 font-bold text-[10.5px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-2xs"></span>
                                                                                                            {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        <Link href={`/appointments/${apt.id}`}>
                                                                                                            <span className="text-cyan-700 hover:text-cyan-900 flex items-center gap-0.5 font-bold text-[10px] cursor-pointer hover:underline bg-white/80 hover:bg-white px-1.5 py-0.2 rounded border border-cyan-200 transition-colors">
                                                                                                                Ubah
                                                                                                                </span>
                                                                                                        </Link>
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

                                                                                                {/* Footer: Arrival / Status & Actions */}
                                                                                                <div className="mt-2 pt-1.5 border-t border-cyan-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getArrivalStatusBadgeAndActions(apt) || getStatusBadge(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
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

                                                                                                        <button
                                                                                                            onClick={(e) => handleDeleteAppointment(apt.id, e)}
                                                                                                            className="text-red-400 hover:text-red-600 hover:bg-red-50 p-0.5 rounded transition-colors cursor-pointer"
                                                                                                            title="Hapus Jadwal"
                                                                                                        >
                                                                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                                            </svg>
                                                                                                        </button>
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
                                                                                <Link 
                                                                                    href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}`} 
                                                                                    className="w-full min-h-[36px] border border-dashed border-slate-200/80 hover:border-sky-300 hover:bg-sky-50/40 rounded-lg transition-all flex items-center px-2.5 text-[11px] text-slate-400 hover:text-sky-700 font-semibold gap-1.5 group cursor-pointer"
                                                                                    title={`Tambah Treatment Jam ${hourStr.replace('.', ':')}`}
                                                                                >
                                                                                    <span className="w-4 h-4 rounded-full bg-slate-100 group-hover:bg-sky-100 text-slate-400 group-hover:text-sky-700 flex items-center justify-center font-bold text-[10px] transition-colors">+</span>
                                                                                    <span className="opacity-70 group-hover:opacity-100 transition-opacity">Tambah Jadwal Treatment</span>
                                                                                </Link>
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
                                                                                                    {/* Header: Time & Ubah Link */}
                                                                                                    <div className="flex justify-between items-center text-[10.5px] font-bold text-sky-950 pb-1 mb-1 border-b border-sky-200/70">
                                                                                                        <span className="flex items-center gap-1 text-sky-900 font-bold text-[10.5px]">
                                                                                                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shadow-2xs"></span>
                                                                                                            {startTime} - {endTime}
                                                                                                        </span>
                                                                                                        <Link href={`/appointments/${apt.id}`}>
                                                                                                            <span className="text-sky-700 hover:text-sky-900 flex items-center gap-0.5 font-bold text-[10px] cursor-pointer hover:underline bg-white/80 hover:bg-white px-1.5 py-0.2 rounded border border-sky-200 transition-colors">
                                                                                                                Ubah
                                                                                                            </span>
                                                                                                        </Link>
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

                                                                                                {/* Footer: Arrival / Status & Actions */}
                                                                                                <div className="mt-2 pt-1.5 border-t border-sky-200/70 flex items-center justify-between gap-1">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {getArrivalStatusBadgeAndActions(apt) || getStatusBadge(apt)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-1">
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

                                                                                                        <button
                                                                                                            onClick={(e) => handleDeleteAppointment(apt.id, e)}
                                                                                                            className="text-red-400 hover:text-red-600 hover:bg-red-50 p-0.5 rounded transition-colors cursor-pointer"
                                                                                                            title="Hapus Jadwal"
                                                                                                        >
                                                                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                                            </svg>
                                                                                                        </button>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        )
                                                                                    })}

                                                                                    {/* Compact Ghost Add Slot next to existing patient cards */}
                                                                                    <Link 
                                                                                        href={`/appointments/new?date=${dateStr}&time=${hourStr.replace('.', ':')}`} 
                                                                                        className="w-[85px] min-w-[85px] self-stretch min-h-[90px] border-2 border-dashed border-sky-200 hover:border-sky-400 bg-sky-50/20 hover:bg-sky-50/60 rounded-lg flex flex-col items-center justify-center text-sky-600 hover:text-sky-700 transition-all text-[10.5px] font-bold gap-1 cursor-pointer group shadow-2xs flex-shrink-0"
                                                                                        title={`Tambah Jadwal Jam ${hourStr.replace('.', ':')}`}
                                                                                    >
                                                                                        <span className="w-5 h-5 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center transition-colors text-sky-700 font-bold text-[10px]">+</span>
                                                                                        <span className="text-[10px] text-sky-700 font-bold group-hover:underline">Tambah</span>
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
        </div>
    )
}
