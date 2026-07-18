'use client'

import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LineChart, Line, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'

export default function Dashboard() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    
    // Auth & Role States
    const [authUser, setAuthUser] = useState(null)
    const [dbUser, setDbUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isMounted, setIsMounted] = useState(false)

    // Filter State
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')

    // Widget States
    const [statAppointments, setStatAppointments] = useState(0)
    const [statFollowups, setStatFollowups] = useState(0)
    const [statBirthdays, setStatBirthdays] = useState(0)
    const [statDormant, setStatDormant] = useState(0)
    const [statNewPatients, setStatNewPatients] = useState(0)
    const [statExpiringCoupons, setStatExpiringCoupons] = useState(0)

    // Financial Widget States
    const [statTodayIncome, setStatTodayIncome] = useState(0)
    const [statTodayTx, setStatTodayTx] = useState(0)
    const [statTopPaymentMethod, setStatTopPaymentMethod] = useState('-')
    const [sparklineData, setSparklineData] = useState([])

    // Table States
    const [recentAppointments, setRecentAppointments] = useState([])
    const [recentFollowups, setRecentFollowups] = useState([])

    useEffect(() => {
        setIsMounted(true)
    }, [])

    useEffect(() => {
        fetchInitialData()
    }, [])

    // Re-fetch statistics when branch filter changes
    useEffect(() => {
        if (dbUser) {
            fetchStatistics()
        }
    }, [selectedBranch, dbUser])

    const fetchInitialData = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
            router.push('/login')
            return
        }
        setAuthUser(user)

        // Fetch user role from public.users gracefully
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .maybeSingle() // Use maybeSingle to prevent crashing if 0 rows
            
        if (userData) {
            if (userData.role === 'therapist') {
                router.push('/therapist/dashboard')
                return
            }
            
            setDbUser(userData)
            
            // Fetch branches for filter
            const { data: branchData } = await supabase.from('branches').select('id, name')
            if (branchData) setBranches(branchData)

            if (userData.role !== 'owner') {
                setSelectedBranch(userData.branch_id || '')
            } else {
                setSelectedBranch('')
            }
        } else {
            // Fallback if user is not in public.users table yet
            console.warn('User not found in public.users, unauthorized access')
            setDbUser({ role: 'unauthorized', full_name: user.email, id: user.id })
            
            const { data: branchData } = await supabase.from('branches').select('id, name')
            if (branchData) setBranches(branchData)
            setSelectedBranch('')
        }
    }

    const fetchStatistics = async () => {
        setLoading(true)
        try {
            const todayDateStr = new Date().toISOString().split('T')[0]
            
            // Helper to append branch filter
            const applyBranchFilter = (query, columnName = 'branch_id') => {
                if (selectedBranch) {
                    return query.eq(columnName, selectedBranch)
                }
                return query
            }

            // Define parallel promises
            // 1. Query the today view statistics
            let viewQuery = supabase.from('dashboard_today_view').select('*')
            if (selectedBranch) {
                viewQuery = viewQuery.eq('branch_id', selectedBranch)
            }

            // 2. Query expiring coupons count
            const in30Days = new Date()
            in30Days.setDate(in30Days.getDate() + 30)
            const couponsQuery = supabase.from('patient_coupons').select('id', { count: 'exact' })
                .eq('status', 'active')
                .gte('expired_at', new Date().toISOString())
                .lte('expired_at', in30Days.toISOString())

            // 3. Query recent appointments table
            let tableAptQuery = supabase.from('appointments').select('id, start_time, end_time, status, patients(full_name, whatsapp)')
                .eq('appointment_date', todayDateStr)
                .order('start_time', { ascending: true })
                .limit(5)
            tableAptQuery = applyBranchFilter(tableAptQuery)

            // 4. Query recent followups table
            let tableFuQuery = supabase.from('followup_queue').select('id, followup_type, priority, patients(full_name, whatsapp)')
                .eq('status', 'pending')
                .lte('scheduled_date', todayDateStr)
                .order('priority', { ascending: false })
                .limit(5)
            tableFuQuery = applyBranchFilter(tableFuQuery)

            // 5. Query today's transactions for revenue breakdown
            let trxTodayQuery = supabase.from('transactions').select('total, payment_method')
                .gte('created_at', `${todayDateStr}T00:00:00Z`)
                .lte('created_at', `${todayDateStr}T23:59:59Z`)
            trxTodayQuery = applyBranchFilter(trxTodayQuery)

            // 6. Query transactions for the last 7 days sparkline
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
            sevenDaysAgo.setHours(0,0,0,0)
            let sparklineQuery = supabase.from('transactions').select('total, created_at')
                .gte('created_at', sevenDaysAgo.toISOString())
            sparklineQuery = applyBranchFilter(sparklineQuery)

            // Execute all queries in parallel
            const [
                viewResult,
                couponsResult,
                tableAptResult,
                tableFuResult,
                trxTodayResult,
                sparkResult
            ] = await Promise.all([
                viewQuery,
                couponsQuery,
                tableAptQuery,
                tableFuQuery,
                trxTodayQuery,
                sparklineQuery
            ])

            // --- Process View Results (Stat Cards) ---
            let totalApt = 0
            let totalFu = 0
            let totalBday = 0
            let totalDormant = 0
            let totalNewPatients = 0
            
            if (viewResult && viewResult.data) {
                viewResult.data.forEach(row => {
                    if (row) {
                        totalApt += Number(row.appointments_today || 0)
                        totalFu += Number(row.followups_today || 0)
                        totalBday += Number(row.birthdays_this_week || 0)
                        totalDormant += Number(row.dormant_patients || 0)
                        totalNewPatients += Number(row.new_patients_this_month || 0)
                    }
                })
            }
            setStatAppointments(totalApt)
            setStatFollowups(totalFu)
            setStatBirthdays(totalBday)
            setStatDormant(totalDormant)
            setStatNewPatients(totalNewPatients)

            if (viewResult && viewResult.error) {
                console.error('Error fetching dashboard_today_view:', viewResult.error.message)
            }

            // --- Process Expiring Coupons ---
            setStatExpiringCoupons(couponsResult?.count || 0)

            // --- Process Appointments List ---
            if (tableAptResult && tableAptResult.data) {
                setRecentAppointments(tableAptResult.data)
            }

            // --- Process Followups List ---
            if (tableFuResult && tableFuResult.data) {
                setRecentFollowups(tableFuResult.data)
            }

            // --- Process Today Transactions ---
            let todayIncome = 0
            let todayTxCount = 0
            const methodCounts = {}
            if (trxTodayResult && trxTodayResult.data) {
                todayTxCount = trxTodayResult.data.length
                trxTodayResult.data.forEach(tx => {
                    if (tx) {
                        todayIncome += Number(tx.total || 0)
                        const m = tx.payment_method
                        if (m) {
                            methodCounts[m] = (methodCounts[m] || 0) + 1
                        }
                    }
                })
            }
            setStatTodayIncome(todayIncome)
            setStatTodayTx(todayTxCount)

            let topMethod = '-'
            let maxCount = 0
            Object.entries(methodCounts).forEach(([m, count]) => {
                if (count > maxCount) {
                    maxCount = count
                    topMethod = m.toUpperCase()
                }
            })
            setStatTopPaymentMethod(topMethod)

            // --- Process Sparkline ---
            const dailyMap = {}
            for (let i = 0; i < 7; i++) {
                const d = new Date()
                d.setDate(d.getDate() - i)
                const dateStr = d.toISOString().split('T')[0]
                dailyMap[dateStr] = 0
            }

            if (sparkResult && sparkResult.data) {
                sparkResult.data.forEach(tx => {
                    if (tx && tx.created_at) {
                        try {
                            const dateStr = new Date(tx.created_at).toISOString().split('T')[0]
                            if (dailyMap[dateStr] !== undefined) {
                                dailyMap[dateStr] += Number(tx.total || 0)
                            }
                        } catch (e) {
                            console.error('Error parsing date for sparkline:', tx.created_at, e)
                        }
                    }
                })
            }

            const formattedSpark = Object.entries(dailyMap)
                .map(([date, total]) => {
                    try {
                        const d = new Date(date)
                        const label = d.toLocaleDateString('id-ID', { weekday: 'short' })
                        return { date, label, total }
                    } catch (e) {
                        return { date, label: '-', total }
                    }
                })
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                
            setSparklineData(formattedSpark)
        } catch (error) {
            console.error("Dashboard statistics fetching crashed:", error)
        } finally {
            setLoading(false)
        }
    }

    if (loading && !dbUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-ayumi-bg">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6 relative">
            {loading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            )}
            
            {/* Branch Filter & Page Context */}
            <div className="flex justify-end items-center mb-6">
                <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100">
                    <span className="text-sm font-bold text-ayumi-secondary">Filter Cabang:</span>
                    <select 
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={dbUser?.role !== 'owner'}
                        className="bg-transparent border-none text-ayumi-primary text-sm focus:ring-0 cursor-pointer font-bold disabled:opacity-70 disabled:cursor-not-allowed outline-none"
                    >
                        {dbUser?.role === 'owner' && <option value="">Semua Cabang</option>}
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>
            </div>

                {/* FINANCIAL WIDGETS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {/* Total Pendapatan Hari Ini */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 bg-gradient-to-br from-green-50 to-emerald-50 border-emerald-100 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-xl font-extrabold text-emerald-800 font-mono">Rp {statTodayIncome.toLocaleString('id-ID')}</h3>
                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Pendapatan Hari Ini</p>
                        </div>
                    </div>

                    {/* Total Transaksi Hari Ini */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-indigo-100 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-indigo-100 text-indigo-700 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        </div>
                        <div>
                            <h3 className="text-2xl font-extrabold text-indigo-900">{statTodayTx}</h3>
                            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Transaksi Hari Ini</p>
                        </div>
                    </div>

                    {/* Metode Bayar Terbanyak */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 bg-gradient-to-br from-pink-50 to-rose-50 border-rose-100 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-rose-100 text-rose-700 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-xl font-extrabold text-rose-900 uppercase">{statTopPaymentMethod}</h3>
                            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">Top Metode Bayar</p>
                        </div>
                    </div>

                    {/* Sparkline chart */}
                    <div className="card-ayumi p-4 bg-white hover:shadow-md transition-shadow flex flex-col justify-between">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pendapatan 7 Hari Terakhir</span>
                        </div>
                        <div className="h-10 w-full">
                            {isMounted && sparklineData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={sparklineData}>
                                        <RechartsTooltip formatter={(value) => 'Rp ' + (typeof value === 'number' ? value.toLocaleString('id-ID') : value)} contentStyle={{ fontSize: '10px', padding: '4px' }} />
                                        <Line type="monotone" dataKey="total" stroke="#B5588A" strokeWidth={2.5} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full bg-gray-50 animate-pulse rounded" />
                            )}
                        </div>
                    </div>
                </div>

                {/* WIDGETS 6 KARTU */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {/* Widget 1 */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-ayumi-text">{statAppointments}</h3>
                            <p className="text-sm font-semibold text-ayumi-text-muted">Appointment Hari Ini</p>
                        </div>
                    </div>

                    {/* Widget 2 */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-ayumi-text">{statFollowups}</h3>
                            <p className="text-sm font-semibold text-ayumi-text-muted">Follow Up Hari Ini</p>
                        </div>
                    </div>

                    {/* Widget 3 */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-pink-50 text-ayumi-primary rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.701 2.701 0 00-1.5-.454M9 6v2m3-2v2m3-2v2M9 3h.01M12 3h.01M15 3h.01M21 21v-7a2 2 0 00-2-2H5a2 2 0 00-2 2v7h18zm-3-9v-2a2 2 0 00-2-2H8a2 2 0 00-2 2v2h12z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-ayumi-text">{statBirthdays}</h3>
                            <p className="text-sm font-semibold text-ayumi-text-muted">Birthday Minggu Ini</p>
                        </div>
                    </div>

                    {/* Widget 4 */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-ayumi-text">{statDormant}</h3>
                            <p className="text-sm font-semibold text-ayumi-text-muted">Pasien Dormant</p>
                        </div>
                    </div>

                    {/* Widget 6 */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-ayumi-text">{statNewPatients}</h3>
                            <p className="text-sm font-semibold text-ayumi-text-muted">Pasien Baru Bulan Ini</p>
                        </div>
                    </div>

                    {/* Widget 7 - Expiring Coupons */}
                    <div className="card-ayumi p-4 md:p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className="w-14 h-14 bg-pink-100 text-pink-600 rounded-2xl flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-3xl font-extrabold text-red-500">{statExpiringCoupons}</h3>
                            <p className="text-sm font-semibold text-red-500">Kupon Akan Expired</p>
                        </div>
                    </div>
                </div>

                {/* TABLES QUICK ACTIONS */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    {/* Table 1: Recent Appointments */}
                    <div className="card-ayumi overflow-hidden flex flex-col">
                        <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                            <h3 className="text-lg font-bold text-ayumi-secondary">Janji Temu Terdekat</h3>
                            <Link href="/appointments">
                                <button className="text-sm font-bold text-ayumi-primary hover:underline">Lihat Semua</button>
                            </Link>
                        </div>
                        <div className="p-0 overflow-x-auto flex-1">
                            <table className="whitespace-nowrap w-full text-left text-sm">
                                <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold">
                                        <tr>
                                            <th className="px-6 py-3">Waktu</th>
                                            <th className="px-6 py-3">Pasien</th>
                                            <th className="px-6 py-3">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {recentAppointments.length === 0 ? (
                                            <tr><td colSpan="3" className="px-6 py-8 text-center text-gray-400">Tidak ada jadwal hari ini.</td></tr>
                                        ) : (
                                            recentAppointments.map(apt => (
                                                <tr key={apt.id} className="hover:bg-ayumi-table-hover transition-colors bg-white">
                                                    <td className="px-6 py-4 font-bold text-gray-700">
                                                        {apt.start_time ? apt.start_time.substring(0,5) : '-'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="font-bold text-gray-800">{apt.patients?.full_name}</div>
                                                        <div className="text-xs text-gray-500">{apt.patients?.whatsapp}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${apt.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                                            {apt.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Table 2: Pending Follow Ups */}
                        <div className="card-ayumi overflow-hidden flex flex-col">
                            <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                                <h3 className="text-lg font-bold text-ayumi-secondary">Tugas Follow-Up</h3>
                                <Link href="/crm">
                                    <button className="text-sm font-bold text-ayumi-primary hover:underline">Lihat Semua</button>
                                </Link>
                            </div>
                            <div className="p-0 overflow-x-auto flex-1">
                                <table className="whitespace-nowrap w-full text-left text-sm">
                                    <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold">
                                        <tr>
                                            <th className="px-6 py-3">Pasien</th>
                                            <th className="px-6 py-3">Jenis</th>
                                            <th className="px-6 py-3">Prioritas</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {recentFollowups.length === 0 ? (
                                            <tr><td colSpan="3" className="px-6 py-8 text-center text-gray-400">Semua follow up selesai!</td></tr>
                                        ) : (
                                            recentFollowups.map(fu => (
                                                <tr key={fu.id} className="hover:bg-ayumi-table-hover transition-colors bg-white">
                                                    <td className="px-6 py-4">
                                                        <div className="font-bold text-gray-800">{fu.patients?.full_name}</div>
                                                        <div className="text-xs text-gray-500">{fu.patients?.whatsapp}</div>
                                                    </td>
                                                    <td className="px-6 py-4 font-semibold text-gray-600 uppercase text-xs">
                                                        {fu.followup_type?.replace('_', ' ')}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${fu.priority === 'high' ? 'bg-red-100 text-red-700' : (fu.priority === 'normal' || fu.priority === 'medium') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                                            {fu.priority}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
        </div>
    )
}
