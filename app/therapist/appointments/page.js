'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function TherapistAppointments() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(true)
    const [dbUser, setDbUser] = useState(null)
    
    // Filters
    const [filterStatus, setFilterStatus] = useState('')
    const [filterDate, setFilterDate] = useState('')

    useEffect(() => {
        fetchUserAndAppointments()
    }, [])

    const fetchUserAndAppointments = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }

        setDbUser(userData)

        // Fetch Appointments assigned to this therapist
        const { data: aptData } = await supabase
            .from('appointments')
            .select(`
                *,
                patients (full_name, whatsapp),
                branches (name)
            `)
            .eq('therapist_id', userData.id)
            .order('appointment_date', { ascending: false })
            .order('start_time', { ascending: true })

        if (aptData) {
            setAppointments(aptData)
        }
        setLoading(false)
    }

    const getStatusBadge = (status) => {
        const badges = {
            'scheduled': 'bg-blue-100 text-blue-700 border-blue-200',
            'confirmed': 'bg-green-100 text-green-700 border-green-200',
            'completed': 'bg-gray-100 text-gray-700 border-gray-200',
            'cancelled': 'bg-red-100 text-red-700 border-red-200',
            'no_show': 'bg-orange-100 text-orange-700 border-orange-200'
        }
        
        const labels = {
            'scheduled': 'Scheduled',
            'confirmed': 'Confirmed',
            'completed': 'Completed',
            'cancelled': 'Cancelled',
            'no_show': 'No Show'
        }

        const colorClass = badges[status] || 'bg-gray-100 text-gray-700'
        return (
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${colorClass}`}>
                {labels[status] || status}
            </span>
        )
    }

    const filteredAppointments = appointments.filter(apt => {
        let matches = true
        if (filterStatus && apt.status !== filterStatus) matches = false
        if (filterDate && apt.appointment_date !== filterDate) matches = false
        return matches
    })

    if (loading && !dbUser) {
        return (
            <div className="flex justify-center p-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">

            <div className="card-ayumi p-6">
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input 
                        type="date" 
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs"
                    />
                    <select 
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs"
                    >
                        <option value="">Semua Status</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                    </select>
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                        <p className="text-gray-500 font-medium">Memuat jadwal...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary text-sm font-bold">
                                <tr>
                                    <th className="p-4 rounded-tl-xl">Tanggal & Waktu</th>
                                    <th className="p-4">Pasien</th>
                                    <th className="p-4">Cabang</th>
                                    <th className="p-4">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredAppointments.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto text-pink-300">
                                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">Belum ada jadwal temu.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAppointments.map(apt => (
                                        <tr key={apt.id} className="hover:bg-ayumi-table-hover transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-ayumi-text">{new Date(apt.appointment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                                                <div className="text-sm text-ayumi-primary font-semibold mt-1">
                                                    {apt.start_time.substring(0, 5)} - {apt.end_time.substring(0, 5)}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="font-bold text-gray-800">{apt.patients?.full_name}</div>
                                                <div className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                                    {apt.patients?.whatsapp}
                                                </div>
                                            </td>
                                            <td className="p-4 text-gray-600 font-medium">{apt.branches?.name}</td>
                                            <td className="p-4">
                                                {getStatusBadge(apt.status)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
