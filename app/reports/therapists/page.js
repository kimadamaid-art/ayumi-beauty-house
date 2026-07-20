'use client'

import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import DateRangePicker from "../../../components/DateRangePicker"

export default function TherapistsReportPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [branches, setBranches] = useState([])
    const [therapists, setTherapists] = useState([])
    
    // Access controls
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [userLoaded, setUserLoaded] = useState(false)

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Filters
    const [startDate, setStartDate] = useState(() => {
        const now = new Date()
        return getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1))
    })
    const [endDate, setEndDate] = useState(() => {
        return getLocalYYYYMMDD(new Date())
    })
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [selectedTherapistFilter, setSelectedTherapistFilter] = useState('all')

    // Raw database results
    const [treatmentItems, setTreatmentItems] = useState([])

    useEffect(() => {
        checkAccessAndFetchInitialData()
    }, [])

    useEffect(() => {
        if (userLoaded && startDate && endDate) {
            fetchReportData()
        }
    }, [userLoaded, startDate, endDate, selectedBranch])

    const checkAccessAndFetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'owner') {
            alert('Akses ditolak. Halaman ini khusus untuk Owner.')
            router.push('/dashboard')
            return
        }

        setIsOwner(true)
        setUserBranchId(userData.branch_id)

        // Fetch Branches
        const { data: branchData } = await supabase
            .from('branches')
            .select('id, name')
            .eq('is_active', true)
            .order('name')
        if (branchData) setBranches(branchData)

        // Fetch Active Therapists
        const { data: therapistData } = await supabase
            .from('users')
            .select('id, full_name, role, branch_id, branches(name)')
            .eq('role', 'therapist')
            .order('full_name')
        if (therapistData) setTherapists(therapistData)

        setUserLoaded(true)
    }

    const fetchReportData = async () => {
        if (!startDate || !endDate) return
        setIsLoading(true)

        let query = supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                commission_percent,
                treatment_records!inner(
                    id,
                    treatment_date,
                    branch_id,
                    patient_id,
                    therapist_id
                )
            `)
            .gte('treatment_records.treatment_date', startDate)
            .lte('treatment_records.treatment_date', endDate)

        // Apply branch filter
        if (selectedBranch !== 'all') {
            query = query.eq('treatment_records.branch_id', selectedBranch)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching report data:', error)
        } else {
            setTreatmentItems(data || [])
        }

        setIsLoading(false)
    }

    // Processed Therapist Metrics
    const therapistMetrics = useMemo(() => {
        // Group items by therapist_id
        const therapistGroups = {}

        treatmentItems.forEach(item => {
            const therapistId = item.treatment_records?.therapist_id
            if (!therapistId) return

            if (!therapistGroups[therapistId]) {
                therapistGroups[therapistId] = {
                    id: therapistId,
                    revenue: 0,
                    commission: 0,
                    treatmentCount: 0,
                    patients: new Set()
                }
            }

            const priceAtTime = Number(item.price_at_time || 0)
            const commissionPercent = Number(item.commission_percent || 0)
            const commissionAmount = Math.round(priceAtTime * (commissionPercent / 100))

            therapistGroups[therapistId].revenue += priceAtTime
            therapistGroups[therapistId].commission += commissionAmount
            therapistGroups[therapistId].treatmentCount += 1
            if (item.treatment_records?.patient_id) {
                therapistGroups[therapistId].patients.add(item.treatment_records.patient_id)
            }
        })

        // Merge with full therapist list to include those with 0 activity
        const result = therapists.map(t => {
            const stats = therapistGroups[t.id] || { revenue: 0, commission: 0, treatmentCount: 0, patients: new Set() }
            return {
                id: t.id,
                name: t.full_name,
                branchName: t.branches?.name || 'Tidak ada cabang',
                branchId: t.branch_id,
                revenue: stats.revenue,
                commission: stats.commission,
                treatmentCount: stats.treatmentCount,
                uniquePatients: stats.patients.size,
                avgPerTreatment: stats.treatmentCount > 0 ? Math.round(stats.revenue / stats.treatmentCount) : 0
            }
        })

        // Filter by branch penempatan if selectedBranch !== 'all' (only for listing consistency if requested, but database filters actions by records' branch)
        // Here we just keep all active therapists and display their metrics within that branch's records.

        // Sort by revenue descending
        return result.sort((a, b) => b.revenue - a.revenue)
    }, [treatmentItems, therapists])

    // Summary Card Stats
    const summaryStats = useMemo(() => {
        const totalRevenue = therapistMetrics.reduce((acc, curr) => acc + curr.revenue, 0)
        const totalCommission = therapistMetrics.reduce((acc, curr) => acc + curr.commission, 0)
        const totalTreatments = therapistMetrics.reduce((acc, curr) => acc + curr.treatmentCount, 0)
        
        // Find best therapist (highest revenue > 0)
        const activeTherapists = therapistMetrics.filter(t => t.revenue > 0)
        const bestTherapist = activeTherapists.length > 0 ? activeTherapists[0].name : '-'

        // Average treatments per therapist
        const avgTreatments = therapistMetrics.length > 0 ? Math.round(totalTreatments / therapistMetrics.length * 10) / 10 : 0

        return {
            totalRevenue,
            totalCommission,
            bestTherapist,
            avgTreatments
        }
    }, [therapistMetrics])

    // Handle Dropdown Therapist Select -> Redirect to details page
    const handleTherapistFilterChange = (e) => {
        const val = e.target.value
        setSelectedTherapistFilter(val)
        if (val !== 'all') {
            router.push(`/reports/therapists/${val}`)
        }
    }

    if (!userLoaded) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memeriksa Hak Akses...</p>
            </div>
        )
    }

    return (
        <div className="space-y-8 pb-16">
            
            {/* Header */}
            <div>
                <h1 className="text-2xl font-extrabold text-ayumi-secondary">Laporan Analisa Per Terapis</h1>
                <p className="text-sm text-ayumi-text-muted mt-1">Performa, kontribusi pendapatan, dan analisis komparasi terapis klinik.</p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm w-full sm:w-auto">
                <DateRangePicker 
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(range) => {
                        setStartDate(range.startDate);
                        setEndDate(range.endDate);
                    }}
                    inputClassName="text-sm font-semibold"
                />

                {/* Filter Cabang */}
                <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    disabled={!isOwner}
                    className="input-ayumi bg-gray-50 focus:bg-white text-sm font-semibold max-w-[200px]"
                >
                    {isOwner && <option value="all">Semua Cabang (Gabungan)</option>}
                    {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>

                {/* Separator Line (Only visible on larger screens) */}
                <div className="hidden sm:block h-8 w-px bg-gray-200 mx-2"></div>

                {/* Pilih Terapis Dropdown */}
                <select
                    value={selectedTherapistFilter}
                    onChange={handleTherapistFilterChange}
                    className="input-ayumi border-ayumi-primary/20 text-ayumi-primary bg-pink-50 hover:bg-pink-100 focus:bg-white text-sm font-bold shadow-sm max-w-[220px] transition-colors"
                >
                    <option value="all">Lihat Detail Terapis...</option>
                    {therapists.map(t => (
                        <option key={t.id} value={t.id}>{t.full_name}</option>
                    ))}
                </select>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-pink-100 shadow-sm">
                    <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                    <p className="text-ayumi-primary font-semibold">Mengambil data performa terapis...</p>
                </div>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Card 1: Total Pendapatan */}
                        <div className="card-ayumi p-4 md:p-6 bg-gradient-to-br from-orange-50 to-orange-100/50 border-orange-100 flex items-center gap-5 hover:shadow-md transition-shadow">
                            <div className="w-14 h-14 bg-white text-ayumi-primary rounded-2xl flex items-center justify-center shadow-sm">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-ayumi-primary uppercase tracking-widest">Pendapatan Terapis</p>
                                <h3 className="text-2xl font-black text-ayumi-secondary mt-1 font-mono">Rp {summaryStats.totalRevenue.toLocaleString('id-ID')}</h3>
                            </div>
                        </div>

                        {/* Card 2: Total Komisi */}
                        <div className="card-ayumi p-4 md:p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-100 flex items-center gap-5 hover:shadow-md transition-shadow">
                            <div className="w-14 h-14 bg-white text-emerald-600 rounded-2xl flex items-center justify-center shadow-sm">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Total Komisi Terapis</p>
                                <h3 className="text-2xl font-black text-ayumi-secondary mt-1 font-mono">Rp {summaryStats.totalCommission.toLocaleString('id-ID')}</h3>
                            </div>
                        </div>

                        {/* Card 3: Terapis Terbaik */}
                        <div className="card-ayumi p-4 md:p-6 bg-gradient-to-br from-pink-50 to-pink-100/50 border-pink-100 flex items-center gap-5 hover:shadow-md transition-shadow">
                            <div className="w-14 h-14 bg-white text-rose-500 rounded-2xl flex items-center justify-center shadow-sm animate-pulse">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Terapis Terbaik</p>
                                <h3 className="text-xl font-black text-ayumi-secondary mt-1">{summaryStats.bestTherapist}</h3>
                            </div>
                        </div>

                        {/* Card 4: Rata-rata Treatment */}
                        <div className="card-ayumi p-4 md:p-6 bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-100 flex items-center gap-5 hover:shadow-md transition-shadow">
                            <div className="w-14 h-14 bg-white text-amber-600 rounded-2xl flex items-center justify-center shadow-sm">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Rata-rata Sesi / Terapis</p>
                                <h3 className="text-2xl font-black text-ayumi-secondary mt-1 font-mono">{summaryStats.avgTreatments} Sesi</h3>
                            </div>
                        </div>
                    </div>

                    {/* Rankings Table */}
                    <div className="card-ayumi overflow-hidden">
                        <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
                            <h2 className="text-lg font-bold text-ayumi-secondary">Ranking Terapis Bulan Ini</h2>
                            <p className="text-xs text-ayumi-text-muted mt-1">Daftar terapis terurut berdasarkan kontribusi pendapatan terbesar.</p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="whitespace-nowrap w-full text-left text-sm">
                                <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold uppercase text-xs">
                                <tr>
                                        <th className="px-6 py-4 text-center">Rank</th>
                                        <th className="px-6 py-4">Terapis</th>
                                        <th className="px-6 py-4 text-center">Cabang Penempatan</th>
                                        <th className="px-6 py-4 text-center">Pasien Unik</th>
                                        <th className="px-6 py-4 text-center">Total Treatment (Sesi)</th>
                                        <th className="px-6 py-4 text-right">Total Pendapatan</th>
                                        <th className="px-6 py-4 text-right">Total Komisi</th>
                                        <th className="px-6 py-4 text-right">Rata-rata / Treatment</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 text-gray-700 bg-white">
                                    {therapistMetrics.length === 0 ? (
                                        <tr><td colSpan="8" className="px-6 py-12 text-center text-gray-400">Belum ada data tindakan terapis pada periode ini.</td></tr>
                                    ) : (
                                        therapistMetrics.map((t, idx) => {
                                            const nameInitials = t.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
                                            
                                            // Badges for top 3
                                            let rankBadge = `${idx + 1}`
                                            if (idx === 0) rankBadge = '🥇 1'
                                            else if (idx === 1) rankBadge = '🥈 2'
                                            else if (idx === 2) rankBadge = '🥉 3'

                                            return (
                                                <tr 
                                                    key={t.id} 
                                                    onClick={() => router.push(`/reports/therapists/${t.id}`)}
                                                    className="hover:bg-ayumi-table-hover cursor-pointer transition-colors"
                                                >
                                                    <td className="px-6 py-4 text-center font-bold text-gray-800 text-sm">
                                                        {rankBadge}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center font-bold text-sm text-ayumi-primary shadow-inner shrink-0">
                                                                {nameInitials}
                                                            </div>
                                                            <div>
                                                                <span className="font-bold text-gray-800 hover:text-ayumi-primary transition-colors block">{t.name}</span>
                                                                <span className="text-xs text-gray-400">Klik untuk melihat detail</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center font-semibold text-xs text-gray-600">
                                                        <span className="bg-purple-50 text-[#6B3A5A] px-2.5 py-1 rounded-md font-bold">
                                                            {t.branchName}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-center font-bold text-gray-800">{t.uniquePatients} Pasien</td>
                                                    <td className="px-6 py-4 text-center font-bold text-gray-800">{t.treatmentCount}x Sesi</td>
                                                    <td className="px-6 py-4 text-right font-black text-gray-800 font-mono">
                                                        Rp {t.revenue.toLocaleString('id-ID')}
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-mono">
                                                        {t.commission > 0 ? (
                                                            <span className="font-bold text-emerald-600">Rp {t.commission.toLocaleString('id-ID')}</span>
                                                        ) : (
                                                            <span className="text-gray-400">Rp 0</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-semibold text-gray-600 font-mono">
                                                        Rp {t.avgPerTreatment.toLocaleString('id-ID')}
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Comparison Section (Horizontal Bar Charts) */}
                    <div className="card-ayumi p-4 md:p-6">
                        <div className="border-b border-gray-100 pb-4 mb-6">
                            <h2 className="text-lg font-bold text-ayumi-secondary">Perbandingan Antar Terapis</h2>
                            <p className="text-xs text-ayumi-text-muted mt-1">Grafik komparasi visual kontribusi pendapatan dan beban kerja (sesi tindakan) terapis.</p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Pendapatan Chart */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-ayumi-primary uppercase tracking-wide text-center">Komparasi Total Pendapatan</h3>
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            layout="vertical" 
                                            data={therapistMetrics}
                                            margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                            <XAxis type="number" tickFormatter={(v) => `Rp ${v >= 1000000 ? (v/1000000) + 'M' : v}`} stroke="#8c7d73" fontSize={10} />
                                            <YAxis dataKey="name" type="category" stroke="#8c7d73" width={90} fontSize={10} fontStyle="bold" />
                                            <RechartsTooltip formatter={(v) => 'Rp ' + v.toLocaleString('id-ID')} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Bar dataKey="revenue" fill="#D46221" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Sesi Treatment Chart */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide text-center">Komparasi Jumlah Sesi Tindakan</h3>
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            layout="vertical" 
                                            data={therapistMetrics}
                                            margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                            <XAxis type="number" stroke="#8c7d73" fontSize={10} />
                                            <YAxis dataKey="name" type="category" stroke="#8c7d73" width={90} fontSize={10} fontStyle="bold" />
                                            <RechartsTooltip formatter={(v) => v + ' Sesi'} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Bar dataKey="treatmentCount" fill="#4E2A12" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Side by Side Comparison Table */}
                        <div className="mt-8 border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/50">
                            <div className="p-4 bg-white border-b border-gray-100">
                                <h4 className="text-sm font-bold text-gray-800">Tabel Komparasi Head-to-Head</h4>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="whitespace-nowrap w-full text-left text-xs">
                                    <thead className="bg-gray-100 text-gray-600 font-bold">
                                    <tr>
                                            <th className="p-3">Nama Terapis</th>
                                            <th className="p-3 text-right">Pendapatan</th>
                                            <th className="p-3 text-right">Komisi</th>
                                            <th className="p-3 text-center">Kontribusi %</th>
                                            <th className="p-3 text-center">Jumlah Sesi</th>
                                            <th className="p-3 text-center">Pasien Unik</th>
                                            <th className="p-3 text-right">Efisiensi (Avg/Sesi)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {therapistMetrics.map(t => {
                                            const totalRevenue = summaryStats.totalRevenue || 1
                                            const contributionPercent = Math.round((t.revenue / totalRevenue) * 100)
                                            return (
                                                <tr key={t.id} className="hover:bg-gray-50/50">
                                                    <td className="p-3 font-bold text-gray-800">{t.name}</td>
                                                    <td className="p-3 text-right font-semibold text-gray-800 font-mono">Rp {t.revenue.toLocaleString('id-ID')}</td>
                                                    <td className="p-3 text-right font-semibold font-mono">
                                                        {t.commission > 0 ? (
                                                            <span className="text-emerald-600">Rp {t.commission.toLocaleString('id-ID')}</span>
                                                        ) : (
                                                            <span className="text-gray-400">Rp 0</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${contributionPercent > 0 ? 'bg-orange-50 text-ayumi-primary' : 'bg-gray-50 text-gray-400'}`}>
                                                            {contributionPercent}%
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-center font-medium">{t.treatmentCount}x Sesi</td>
                                                    <td className="p-3 text-center font-medium">{t.uniquePatients} Pasien</td>
                                                    <td className="p-3 text-right font-semibold text-gray-500 font-mono">Rp {t.avgPerTreatment.toLocaleString('id-ID')}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
