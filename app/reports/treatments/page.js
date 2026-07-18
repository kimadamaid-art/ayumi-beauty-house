'use client'

import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import DateRangePicker from "../../../components/DateRangePicker"

export default function TreatmentsReportPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [branches, setBranches] = useState([])
    const [categories, setCategories] = useState([])
    
    // Access controls
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [userLoaded, setUserLoaded] = useState(false)

    // Filters
    const [period, setPeriod] = useState('custom')
    const [customStart, setCustomStart] = useState(() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    })
    const [customEnd, setCustomEnd] = useState(() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    })
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [selectedCategory, setSelectedCategory] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')

    // Database raw items
    const [treatmentItems, setTreatmentItems] = useState([])

    // Table sorting state
    const [sortField, setSortField] = useState('sessionCount') // 'name' | 'category' | 'sessionCount' | 'uniquePatients' | 'revenue' | 'avgPrice'
    const [sortDirection, setSortDirection] = useState('desc') // 'asc' | 'desc'

    // Colors for Donut Chart
    const COLORS = ['#D46221', '#4E2A12', '#DE915D', '#E8B895', '#B5531B', '#914214', '#6E310E', '#FAF1E8']

    useEffect(() => {
        checkAccessAndFetchInitialData()
    }, [])

    useEffect(() => {
        if (userLoaded) {
            fetchReportData()
        }
    }, [userLoaded, period, customStart, customEnd, selectedBranch])

    const checkAccessAndFetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
        if (!userData || (userData.role !== 'owner' && userData.role !== 'admin')) {
            alert('Akses ditolak. Halaman ini khusus untuk Owner dan Admin.')
            router.push('/dashboard')
            return
        }

        const owner = userData.role === 'owner'
        setIsOwner(owner)
        setUserBranchId(userData.branch_id)
        
        // Fetch Branches
        const { data: branchData } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        if (branchData) setBranches(branchData)

        // Fetch Categories
        const { data: catData } = await supabase.from('treatment_categories').select('id, name').order('name')
        if (catData) setCategories(catData)

        // For admin, restrict branch filter to their own branch
        if (!owner && userData.branch_id) {
            setSelectedBranch(userData.branch_id)
        }

        // Initialize custom dates default
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
        const todayStr = now.toISOString().split('T')[0]
        // Default dates are already initialized as first day and last day of month in useState
        setUserLoaded(true)
    }

    // Helper to calculate date string ranges
    const dateRange = useMemo(() => {
        return {
            startStr: customStart || new Date().toISOString().split('T')[0],
            endStr: customEnd || new Date().toISOString().split('T')[0]
        }
    }, [customStart, customEnd])

    const fetchReportData = async () => {
        setIsLoading(true)
        const { startStr, endStr } = dateRange

        let query = supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                treatment_id,
                treatments(
                    name,
                    category_id,
                    treatment_categories(id, name)
                ),
                treatment_records!inner(
                    id,
                    treatment_date,
                    branch_id,
                    patient_id
                )
            `)
            .gte('treatment_records.treatment_date', startStr)
            .lte('treatment_records.treatment_date', endStr)

        if (selectedBranch !== 'all') {
            query = query.eq('treatment_records.branch_id', selectedBranch)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching treatment reports:', error)
        } else {
            setTreatmentItems(data || [])
        }
        setIsLoading(false)
    }

    // Process statistics & list
    const processedMetrics = useMemo(() => {
        const groups = {}

        treatmentItems.forEach(item => {
            const tId = item.treatment_id
            const tName = item.treatments?.name || 'Unknown Treatment'
            const catId = item.treatments?.category_id || null
            const catName = item.treatments?.treatment_categories?.name || 'Uncategorized'
            const price = Number(item.price_at_time || 0)
            const patientId = item.treatment_records?.patient_id

            if (!groups[tId]) {
                groups[tId] = {
                    id: tId,
                    name: tName,
                    categoryId: catId,
                    categoryName: catName,
                    sessionCount: 0,
                    revenue: 0,
                    patients: new Set()
                }
            }

            groups[tId].sessionCount += 1
            groups[tId].revenue += price
            if (patientId) {
                groups[tId].patients.add(patientId)
            }
        })

        let list = Object.values(groups).map(g => ({
            id: g.id,
            name: g.name,
            categoryId: g.categoryId,
            categoryName: g.categoryName,
            sessionCount: g.sessionCount,
            uniquePatients: g.patients.size,
            revenue: g.revenue,
            avgPrice: g.sessionCount > 0 ? Math.round(g.revenue / g.sessionCount) : 0
        }))

        // Client-side category filtering
        if (selectedCategory !== 'all') {
            list = list.filter(item => item.categoryId === selectedCategory)
        }

        // Client-side search filtering
        if (searchTerm.trim() !== '') {
            list = list.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
        }

        // Sort data based on sortField & sortDirection
        list.sort((a, b) => {
            let fieldA = a[sortField]
            let fieldB = b[sortField]

            if (typeof fieldA === 'string') {
                fieldA = fieldA.toLowerCase()
                fieldB = fieldB.toLowerCase()
            }

            if (fieldA < fieldB) return sortDirection === 'asc' ? -1 : 1
            if (fieldA > fieldB) return sortDirection === 'asc' ? 1 : -1
            return 0
        })

        return list
    }, [treatmentItems, selectedCategory, searchTerm, sortField, sortDirection])

    // Top widgets data
    const summaryStats = useMemo(() => {
        const totalSessions = processedMetrics.reduce((acc, curr) => acc + curr.sessionCount, 0)
        const totalRevenue = processedMetrics.reduce((acc, curr) => acc + curr.revenue, 0)

        // Best seller by revenue
        const sortedByRevenue = [...processedMetrics].sort((a, b) => b.revenue - a.revenue)
        const bestSeller = sortedByRevenue.length > 0 && sortedByRevenue[0].revenue > 0 ? sortedByRevenue[0].name : '-'

        // Most popular by sessions
        const sortedBySessions = [...processedMetrics].sort((a, b) => b.sessionCount - a.sessionCount)
        const mostPopular = sortedBySessions.length > 0 && sortedBySessions[0].sessionCount > 0 ? sortedBySessions[0].name : '-'

        return {
            totalSessions,
            totalRevenue,
            bestSeller,
            mostPopular
        }
    }, [processedMetrics])

    // Top 10 treatments chart (by sessions count)
    const top10ChartData = useMemo(() => {
        return [...processedMetrics]
            .sort((a, b) => b.sessionCount - a.sessionCount)
            .slice(0, 10)
    }, [processedMetrics])

    // Donut chart data: distribution per category
    const donutChartData = useMemo(() => {
        const catMap = {}
        processedMetrics.forEach(m => {
            const name = m.categoryName
            catMap[name] = (catMap[name] || 0) + m.revenue
        })

        return Object.entries(catMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
    }, [processedMetrics])

    // Handle sort click on table header
    const handleSort = (field) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('desc')
        }
    }

    const renderSortArrow = (field) => {
        if (sortField !== field) return null
        return sortDirection === 'asc' ? ' ▲' : ' ▼'
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
        <div className="space-y-6 pb-16">
            
            {/* Header Title */}
            <div>
                <h1 className="text-2xl font-extrabold text-ayumi-secondary">Laporan Analitik Treatment</h1>
                <p className="text-sm text-ayumi-text-muted mt-1">Metrik, sebaran kategori, dan ranking performa treatment klinik.</p>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col gap-4 bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm">
                
                {/* Row 1: Periods & Branch */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    
                    {/* Date Pickers for Custom Range */}
                    <div className="w-[290px] relative z-20">
                        <DateRangePicker 
                            startDate={customStart}
                            endDate={customEnd}
                            onChange={(range) => {
                                setCustomStart(range.startDate);
                                setCustomEnd(range.endDate);
                            }}
                            inputClassName="w-full input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg"
                        />
                    </div>

                    {/* Branch Select */}
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={!isOwner}
                        className="input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg max-w-[200px]"
                    >
                        {isOwner && <option value="all">Semua Cabang (Tindakan)</option>}
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>

                <hr className="border-gray-100" />

                {/* Row 2: Search & Categories */}
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                    {/* Category Select */}
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg max-w-[200px]"
                    >
                        <option value="all">Semua Kategori</option>
                        {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>

                    {/* Search Bar */}
                    <div className="relative w-full sm:w-72 ml-auto">
                        <svg className="w-4 h-4 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input
                            type="text"
                            placeholder="Cari treatment..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input-ayumi pl-9 bg-gray-50 focus:bg-white text-xs py-2"
                        />
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-pink-100 shadow-sm">
                    <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                    <p className="text-ayumi-primary font-semibold">Mengambil data analitik treatment...</p>
                </div>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Sesi */}
                        <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-indigo-50 to-indigo-100/50 border-indigo-100">
                            <div className="w-12 h-12 bg-white text-indigo-700 rounded-xl flex items-center justify-center shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Total Sesi</p>
                                <h4 className="text-xl font-black text-indigo-950 mt-0.5 font-mono">{summaryStats.totalSessions} Sesi</h4>
                            </div>
                        </div>

                        {/* Pendapatan */}
                        <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-green-50 to-green-100/50 border-green-100">
                            <div className="w-12 h-12 bg-white text-green-700 rounded-xl flex items-center justify-center shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Pendapatan</p>
                                <h4 className="text-lg font-black text-green-950 mt-0.5 font-mono">Rp {summaryStats.totalRevenue.toLocaleString('id-ID')}</h4>
                            </div>
                        </div>

                        {/* Terlaris (Revenue) */}
                        <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-100">
                            <div className="w-12 h-12 bg-white text-amber-700 rounded-xl flex items-center justify-center shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Terlaris (Rp)</p>
                                <h4 className="text-xs font-black text-amber-950 mt-0.5 truncate" title={summaryStats.bestSeller}>{summaryStats.bestSeller}</h4>
                            </div>
                        </div>

                        {/* Terpopuler (Sessions) */}
                        <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-pink-50 to-pink-100/50 border-pink-100">
                            <div className="w-12 h-12 bg-white text-ayumi-primary rounded-xl flex items-center justify-center shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold text-ayumi-primary uppercase tracking-widest font-sans">Terpopuler (Sesi)</p>
                                <h4 className="text-xs font-black text-ayumi-secondary mt-0.5 truncate" title={summaryStats.mostPopular}>{summaryStats.mostPopular}</h4>
                            </div>
                        </div>
                    </div>

                    {/* Visual Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Bar Chart Top 10 Treatments */}
                        <div className="card-ayumi p-4 md:p-6 lg:col-span-2">
                            <div className="border-b border-gray-100 pb-3 mb-6">
                                <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Top 10 Treatment Terlaris (Jumlah Sesi)</h3>
                            </div>
                            <div className="h-64 w-full">
                                {top10ChartData.length === 0 ? (
                                    <div className="h-full w-full flex items-center justify-center text-xs text-gray-400 italic">Tidak ada data.</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={top10ChartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                            <XAxis dataKey="name" stroke="#8c7d73" fontSize={8} tickFormatter={(t) => t.substring(0, 15) + (t.length > 15 ? '..' : '')} />
                                            <YAxis stroke="#8c7d73" fontSize={10} />
                                            <RechartsTooltip formatter={(v) => v + ' sesi'} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Bar dataKey="sessionCount" fill="#D46221" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* Donut Chart: Category Revenue Distribution */}
                        <div className="card-ayumi p-4 md:p-6 flex flex-col justify-between">
                            <div className="border-b border-gray-100 pb-3 mb-4">
                                <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Distribusi Pendapatan Kategori</h3>
                            </div>
                            <div className="h-52 w-full flex items-center justify-center relative">
                                {donutChartData.length === 0 ? (
                                    <div className="text-xs text-gray-400 italic">Tidak ada data.</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={donutChartData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={3}
                                                dataKey="value"
                                            >
                                                {donutChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip formatter={(v) => 'Rp ' + v.toLocaleString('id-ID')} contentStyle={{ fontSize: '10px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                            {/* Simple Legend List */}
                            <div className="mt-2 space-y-1 text-xs max-h-24 overflow-y-auto pr-1">
                                {donutChartData.map((item, index) => (
                                    <div key={item.name} className="flex justify-between items-center">
                                        <div className="flex items-center gap-2 truncate">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                            <span className="text-gray-600 truncate font-semibold">{item.name}</span>
                                        </div>
                                        <span className="font-bold text-gray-800 font-mono">Rp {item.value.toLocaleString('id-ID')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Ranking Table */}
                    <div className="card-ayumi overflow-hidden">
                        <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
                            <h2 className="text-lg font-bold text-ayumi-secondary">Ranking Performansi Treatment</h2>
                            <p className="text-xs text-ayumi-text-muted mt-1">Daftar treatment klinik diurutkan berdasarkan parameter. Klik header kolom untuk menyortir.</p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="whitespace-nowrap w-full text-left text-sm">
                                <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold uppercase text-xs">
                                    <tr className="cursor-pointer select-none">
                                        <th onClick={() => handleSort('name')} className="px-6 py-4">Treatment {renderSortArrow('name')}</th>
                                        <th onClick={() => handleSort('categoryName')} className="px-6 py-4 text-center">Kategori {renderSortArrow('categoryName')}</th>
                                        <th onClick={() => handleSort('sessionCount')} className="px-6 py-4 text-center">Sesi Tindakan {renderSortArrow('sessionCount')}</th>
                                        <th onClick={() => handleSort('uniquePatients')} className="px-6 py-4 text-center">Pasien Unik {renderSortArrow('uniquePatients')}</th>
                                        <th onClick={() => handleSort('revenue')} className="px-6 py-4 text-right">Total Pendapatan {renderSortArrow('revenue')}</th>
                                        <th onClick={() => handleSort('avgPrice')} className="px-6 py-4 text-right">Rata-rata Harga / Sesi {renderSortArrow('avgPrice')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 text-gray-700 bg-white">
                                    {processedMetrics.length === 0 ? (
                                        <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-400 font-medium">Tidak ada data treatment dalam periode/kategori ini.</td></tr>
                                    ) : (
                                        processedMetrics.map(t => (
                                            <tr
                                                key={t.id}
                                                onClick={() => router.push(`/reports/treatments/${t.id}?period=${period}&start=${dateRange.startStr}&end=${dateRange.endStr}`)}
                                                className="hover:bg-ayumi-table-hover cursor-pointer transition-colors"
                                            >
                                                <td className="px-6 py-4 font-bold text-gray-800 hover:text-ayumi-primary transition-colors">
                                                    {t.name}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="bg-pink-50 text-ayumi-primary px-2.5 py-1 rounded-md text-xs font-bold">
                                                        {t.categoryName}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center font-bold text-gray-800">
                                                    {t.sessionCount}x Sesi
                                                </td>
                                                <td className="px-6 py-4 text-center font-bold text-gray-800">
                                                    {t.uniquePatients} Pasien
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-gray-800 font-mono">
                                                    Rp {t.revenue.toLocaleString('id-ID')}
                                                </td>
                                                <td className="px-6 py-4 text-right font-semibold text-gray-600 font-mono">
                                                    Rp {t.avgPrice.toLocaleString('id-ID')}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
