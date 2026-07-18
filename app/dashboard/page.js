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
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-3xl">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            )}
            
            {/* Banner Penyambut Premium */}
            <div className="bg-gradient-to-r from-ayumi-secondary via-[#5c3316] to-[#6d3e1d] rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-16 -mt-16 pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-16 -mb-16 pointer-events-none"></div>
                
                <div className="relative z-10 space-y-2">
                    <span className="bg-white/15 text-pink-100 text-[10px] uppercase font-bold tracking-[0.2em] px-3 py-1 rounded-full border border-white/10">
                        {dbUser?.role ? dbUser.role.toUpperCase() : 'USER'} PORTAL
                    </span>
                    <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                        Selamat Datang Kembali, <span className="text-ayumi-accent">{dbUser?.full_name || 'Staf Klinik'}</span>!
                    </h2>
                    <p className="text-sm text-pink-100/70 max-w-xl font-medium">
                        Kelola data pasien, transaksi kasir, dan jadwal perawatan kecantikan dengan mudah dan efisien.
                    </p>
                </div>

                {/* Filter Cabang Premium */}
                <div className="relative z-10 shrink-0">
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold text-pink-200/80 uppercase tracking-widest pl-1">Cabang Terpilih</span>
                        <div className="flex items-center gap-2.5 bg-white/10 hover:bg-white/15 border border-white/20 px-4 py-2.5 rounded-2xl shadow-inner backdrop-blur-md transition-colors">
                            <svg className="w-4 h-4 text-ayumi-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                            <select 
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                                disabled={dbUser?.role !== 'owner'}
                                className="bg-transparent border-none text-white text-sm focus:ring-0 cursor-pointer font-bold disabled:opacity-75 disabled:cursor-not-allowed outline-none pr-6"
                                style={{ colorScheme: 'dark' }}
                            >
                                {dbUser?.role === 'owner' && <option value="" className="text-gray-800">Semua Cabang (Global)</option>}
                                {branches.map(b => (
                                    <option key={b.id} value={b.id} className="text-gray-800">{b.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* WIDGET KEUANGAN */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {/* Total Pendapatan Hari Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 bg-gradient-to-br from-emerald-50/60 to-white hover:-translate-y-1 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 bg-emerald-100/80 text-emerald-700 rounded-2xl flex items-center justify-center shadow-inner">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-[17px] font-black text-emerald-800 font-mono tracking-tight">Rp {statTodayIncome.toLocaleString('id-ID')}</h3>
                        <p className="text-[9px] font-bold text-emerald-600/85 uppercase tracking-[0.12em] mt-0.5">Pendapatan Hari Ini</p>
                    </div>
                </div>

                {/* Total Transaksi Hari Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 bg-gradient-to-br from-blue-50/60 to-white hover:-translate-y-1 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 bg-blue-100/80 text-blue-700 rounded-2xl flex items-center justify-center shadow-inner">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-blue-900 tracking-tight">{statTodayTx}</h3>
                        <p className="text-[9px] font-bold text-blue-600/85 uppercase tracking-[0.12em] mt-0.5">Transaksi Hari Ini</p>
                    </div>
                </div>

                {/* Metode Bayar Terbanyak */}
                <div className="card-ayumi p-6 flex items-center gap-4 bg-gradient-to-br from-rose-50/60 to-white hover:-translate-y-1 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 bg-rose-100/80 text-rose-700 rounded-2xl flex items-center justify-center shadow-inner">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-base font-black text-rose-900 uppercase tracking-tight">{statTopPaymentMethod}</h3>
                        <p className="text-[9px] font-bold text-rose-600/85 uppercase tracking-[0.12em] mt-0.5">Top Metode Bayar</p>
                    </div>
                </div>

                {/* Tren Pendapatan */}
                <div className="card-ayumi p-4 bg-white hover:-translate-y-1 hover:shadow-md transition-all duration-300 flex flex-col justify-between h-[86px]">
                    <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.1em]">Tren Pendapatan (7 Hari)</span>
                    </div>
                    <div className="h-9 w-full overflow-hidden">
                        {isMounted && sparklineData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={sparklineData}>
                                    <RechartsTooltip formatter={(value) => 'Rp ' + (typeof value === 'number' ? value.toLocaleString('id-ID') : value)} contentStyle={{ fontSize: '9px', padding: '3px' }} />
                                    <Line type="monotone" dataKey="total" stroke="#B5588A" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full bg-gray-50 animate-pulse rounded-lg" />
                        )}
                    </div>
                </div>
            </div>

            {/* WIDGET METRIK 6 KARTU */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {/* Widget 1 - Appointment Hari Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-blue-50/30 to-white border-blue-100/20">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 leading-none">{statAppointments}</h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1.5">Appointment Hari Ini</p>
                    </div>
                </div>

                {/* Widget 2 - Follow Up Hari Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-orange-50/30 to-white border-orange-100/20">
                    <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 leading-none">{statFollowups}</h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1.5">Follow Up Hari Ini</p>
                    </div>
                </div>

                {/* Widget 3 - Birthday Minggu Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-pink-50/30 to-white border-pink-100/20">
                    <div className="w-12 h-12 bg-pink-50 text-ayumi-primary rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.701 2.701 0 00-1.5-.454M9 6v2m3-2v2m3-2v2M9 3h.01M12 3h.01M15 3h.01M21 21v-7a2 2 0 00-2-2H5a2 2 0 00-2 2v7h18zm-3-9v-2a2 2 0 00-2-2H8a2 2 0 00-2 2v2h12z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 leading-none">{statBirthdays}</h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1.5">Birthday Minggu Ini</p>
                    </div>
                </div>

                {/* Widget 4 - Pasien Dormant */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-red-50/30 to-white border-red-100/20">
                    <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 leading-none">{statDormant}</h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1.5">Pasien Dormant</p>
                    </div>
                </div>

                {/* Widget 5 - Pasien Baru Bulan Ini */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-emerald-50/30 to-white border-emerald-100/20">
                    <div className="w-12 h-12 bg-emerald-50 text-green-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 leading-none">{statNewPatients}</h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1.5">Pasien Baru Bulan Ini</p>
                    </div>
                </div>

                {/* Widget 6 - Kupon Akan Expired */}
                <div className="card-ayumi p-6 flex items-center gap-4 hover:-translate-y-1 hover:shadow-md transition-all duration-300 bg-gradient-to-br from-rose-50/30 to-white border-rose-100/20">
                    <div className="w-12 h-12 bg-pink-100 text-pink-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                    </div>
                    <div>
                        <h3 className={`text-2xl font-black leading-none ${statExpiringCoupons > 0 ? 'text-red-600' : 'text-gray-800'}`}>{statExpiringCoupons}</h3>
                        <p className={`text-xs font-semibold mt-1.5 ${statExpiringCoupons > 0 ? 'text-red-500' : 'text-gray-500'}`}>Kupon Akan Expired (30 Hari)</p>
                    </div>
                </div>
            </div>

            {/* DAFTAR DATA TERBARU */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Janji Temu Terdekat */}
                <div className="card-ayumi overflow-hidden flex flex-col bg-white hover:shadow-md transition-shadow duration-300">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-6 bg-ayumi-primary rounded-full"></div>
                            <h3 className="font-extrabold text-ayumi-secondary text-base">Janji Temu Terdekat</h3>
                        </div>
                        <Link href="/appointments">
                            <span className="text-xs font-extrabold text-ayumi-primary hover:text-ayumi-primary-hover hover:underline cursor-pointer">Lihat Semua</span>
                        </Link>
                    </div>
                    <div className="p-3 flex-1">
                        {recentAppointments.length === 0 ? (
                            <div className="py-12 text-center text-gray-400 text-sm font-medium">Tidak ada jadwal hari ini.</div>
                        ) : (
                            <div className="space-y-2">
                                {recentAppointments.map(apt => {
                                    const initial = apt.patients?.full_name ? apt.patients.full_name.charAt(0).toUpperCase() : '?';
                                    return (
                                        <div key={apt.id} className="flex items-center justify-between p-3.5 hover:bg-ayumi-table-hover rounded-2xl transition-colors border border-transparent hover:border-pink-100/30">
                                            <div className="flex items-center gap-3">
                                                {/* Patient Avatar Circle */}
                                                <div className="w-10 h-10 bg-pink-100 text-ayumi-primary rounded-xl flex items-center justify-center font-bold text-sm shadow-inner shrink-0">
                                                    {initial}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-800 text-sm">{apt.patients?.full_name}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">{apt.patients?.whatsapp || '-'}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <div className="text-xs font-bold text-ayumi-secondary flex items-center gap-1">
                                                        <svg className="w-3.5 h-3.5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                        {apt.start_time ? apt.start_time.substring(0,5) : '-'}
                                                    </div>
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                                                    apt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                                    apt.status === 'completed' ? 'bg-gray-100 text-gray-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {apt.status}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Tugas Follow-Up */}
                <div className="card-ayumi overflow-hidden flex flex-col bg-white hover:shadow-md transition-shadow duration-300">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-6 bg-orange-400 rounded-full"></div>
                            <h3 className="font-extrabold text-ayumi-secondary text-base">Tugas Follow-Up</h3>
                        </div>
                        <Link href="/crm">
                            <span className="text-xs font-extrabold text-ayumi-primary hover:text-ayumi-primary-hover hover:underline cursor-pointer">Lihat Semua</span>
                        </Link>
                    </div>
                    <div className="p-3 flex-1">
                        {recentFollowups.length === 0 ? (
                            <div className="py-12 text-center text-gray-400 text-sm font-medium">Semua follow up selesai!</div>
                        ) : (
                            <div className="space-y-2">
                                {recentFollowups.map(fu => {
                                    const initial = fu.patients?.full_name ? fu.patients.full_name.charAt(0).toUpperCase() : '?';
                                    return (
                                        <div key={fu.id} className="flex items-center justify-between p-3.5 hover:bg-ayumi-table-hover rounded-2xl transition-colors border border-transparent hover:border-pink-100/30">
                                            <div className="flex items-center gap-3">
                                                {/* Patient Avatar Circle */}
                                                <div className="w-10 h-10 bg-orange-100 text-orange-700 rounded-xl flex items-center justify-center font-bold text-sm shadow-inner shrink-0">
                                                    {initial}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-800 text-sm">{fu.patients?.full_name}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">{fu.patients?.whatsapp || '-'}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[10px] font-extrabold text-gray-500 uppercase bg-gray-100 px-2 py-1 rounded-lg">
                                                    {fu.followup_type ? fu.followup_type.replace('_', ' ') : '-'}
                                                </span>
                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                                                    fu.priority === 'high' ? 'bg-red-100 text-red-700' :
                                                    (fu.priority === 'medium' || fu.priority === 'normal') ? 'bg-orange-100 text-orange-700' :
                                                    'bg-green-100 text-green-700'
                                                }`}>
                                                    {fu.priority}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
