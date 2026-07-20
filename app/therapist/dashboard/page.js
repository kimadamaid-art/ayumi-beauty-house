'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'

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

        const { error } = await supabase
            .from('appointments')
            .update({
                therapist_id: dbUser.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', aptId)

        if (!error) {
            toast.success('Pasien berhasil ditugaskan ke Anda!', { id: 'claim' })
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

        // 2. Notify all admins of this branch and owners
        const { data: allActiveUsers } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .eq('is_active', true)

        const recipients = allActiveUsers?.filter(u => 
            u.role === 'admin' && u.branch_id === selectedBranch
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
                title: 'Terapis Siap',
                message: `${dbUser.full_name} sudah siap menerima ${apt.patients?.full_name} untuk ${treatmentNames}.`
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
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Branch Selector Card */}
            <div className="card-ayumi p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-2 border-pink-100/50 bg-white">
                <div>
                    <p className="text-sm font-semibold text-gray-600">
                        Cabang Penempatan: <span className="text-ayumi-primary font-bold">{dbUser?.branches?.name || 'Tidak ada penempatan'}</span>
                    </p>
                </div>

                <div className="flex flex-col gap-1 w-full md:w-auto">
                    <label className="text-xs font-bold text-gray-400 uppercase">Pilih Cabang Lihat Jadwal</label>
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="input-ayumi bg-pink-50 border-pink-200 text-ayumi-primary font-bold py-2 cursor-pointer"
                    >
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
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

                                                {isClaimedByMe && apt.arrival_status === 'arrived' && !isCompleted && (
                                                    <button
                                                        onClick={() => handleTherapistReady(apt)}
                                                        className="text-[11px] font-bold text-white bg-yellow-500 hover:bg-yellow-600 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
                                                    >
                                                        Siap Menerima Pasien
                                                    </button>
                                                )}

                                                {isClaimedByMe && (apt.arrival_status === 'therapist_ready' || apt.arrival_status === 'in_treatment' || apt.arrival_status === 'not_arrived' || !apt.arrival_status) && !isCompleted && apt.status !== 'cancelled' && (
                                                    <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                        <button className="text-[11px] font-bold text-white bg-pink-500 hover:bg-pink-600 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer">
                                                            Mulai Treatment
                                                        </button>
                                                    </Link>
                                                )}

                                                {isClaimedByMe && isCompleted && (
                                                    <span className="text-[11px] font-bold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
                                                        Selesai (SOAP)
                                                    </span>
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
