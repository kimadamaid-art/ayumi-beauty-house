'use client'

import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    Tooltip as RechartsTooltip, 
    ResponsiveContainer, 
    CartesianGrid, 
    PieChart, 
    Pie, 
    Cell, 
    Legend 
} from 'recharts'
import DateRangePicker from "../../../components/DateRangePicker"

export default function TreatmentsReportPage() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [branches, setBranches] = useState([])
    const [treatmentCategories, setTreatmentCategories] = useState([])
    const [productCategories, setProductCategories] = useState([])
    
    // Active Report Tab: 'treatments' | 'products'
    const [activeTab, setActiveTab] = useState('treatments')

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
    const [customStart, setCustomStart] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [customEnd, setCustomEnd] = useState(() => {
        return getLocalYYYYMMDD()
    })

    const [selectedBranch, setSelectedBranch] = useState('all')
    const [selectedCategory, setSelectedCategory] = useState('all')
    const [searchTerm, setSearchTerm] = useState('')

    // Database raw items
    const [rawTransactionItems, setRawTransactionItems] = useState([])
    const [rawTreatmentRecordItems, setRawTreatmentRecordItems] = useState([])

    // Table sorting state
    const [sortField, setSortField] = useState('count') // 'name' | 'category' | 'count' | 'uniquePatients' | 'revenue' | 'avgPrice'
    const [sortDirection, setSortDirection] = useState('desc') // 'asc' | 'desc'

    // Colors for Donut Chart
    const COLORS = ['#B5588A', '#06B6D4', '#EAB308', '#10B981', '#6366F1', '#EC4899', '#8B5CF6', '#F97316']

    useEffect(() => {
        checkAccessAndFetchInitialData()
    }, [])

    useEffect(() => {
        if (userLoaded) {
            fetchReportData()
        }
    }, [userLoaded, customStart, customEnd, selectedBranch])

    const checkAccessAndFetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
        if (!userData || (userData.role !== 'owner' && userData.role !== 'admin')) {
            toast.error('Akses ditolak. Halaman ini khusus untuk Owner dan Admin.')
            router.push('/dashboard')
            return
        }

        const owner = userData.role === 'owner'
        setIsOwner(owner)
        setUserBranchId(userData.branch_id)
        
        // Fetch Active Branches
        const { data: branchData } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        if (branchData) setBranches(branchData)

        // Fetch Treatment Categories
        const { data: catData } = await supabase.from('treatment_categories').select('id, name').order('name')
        if (catData) setTreatmentCategories(catData)

        // Fetch Product Categories
        const { data: pCatData } = await supabase.from('product_categories').select('id, name').order('name')
        if (pCatData) setProductCategories(pCatData)

        // Branch Access Enforcement:
        // Non-owner (Admin) is STRICTLY LOCKED to their assigned branch!
        if (!owner && userData.branch_id) {
            setSelectedBranch(userData.branch_id)
        } else if (owner) {
            setSelectedBranch('all')
        }

        setUserLoaded(true)
    }

    const fetchReportData = async () => {
        setIsLoading(true)
        const sDate = customStart || getLocalYYYYMMDD()
        const eDate = customEnd || getLocalYYYYMMDD()

        try {
            // 1. Fetch POS Transaction Items (Treatments & Products)
            let trxQuery = supabase
                .from('transaction_items')
                .select(`
                    id,
                    item_type,
                    treatment_id,
                    product_id,
                    name,
                    quantity,
                    subtotal,
                    transactions!inner(
                        id,
                        created_at,
                        branch_id,
                        patient_id
                    )
                `)
                .gte('transactions.created_at', new Date(`${sDate}T00:00:00`).toISOString())
                .lte('transactions.created_at', new Date(`${eDate}T23:59:59.999`).toISOString())

            // Enforce Branch Filter (Strict for Admin)
            const effectiveBranch = !isOwner ? (userBranchId || selectedBranch) : selectedBranch
            if (effectiveBranch && effectiveBranch !== 'all') {
                trxQuery = trxQuery.eq('transactions.branch_id', effectiveBranch)
            }

            // 2. Fetch Treatment Record Items
            let recQuery = supabase
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
                .gte('treatment_records.treatment_date', sDate)
                .lte('treatment_records.treatment_date', eDate)

            if (effectiveBranch && effectiveBranch !== 'all') {
                recQuery = recQuery.eq('treatment_records.branch_id', effectiveBranch)
            }

            const [trxRes, recRes] = await Promise.all([trxQuery, recQuery])

            setRawTransactionItems(trxRes.data || [])
            setRawTreatmentRecordItems(recRes.data || [])
        } catch (err) {
            console.error('Error fetching combined report data:', err)
        } finally {
            setIsLoading(false)
        }
    }

    // Process Treatment Metrics
    const processedTreatmentMetrics = useMemo(() => {
        const groups = {}

        // Combine from POS transaction items (treatment)
        rawTransactionItems.forEach(item => {
            if (item.item_type === 'treatment') {
                const tName = item.name || 'Treatment'
                const qty = Number(item.quantity || 1)
                const amt = Number(item.subtotal || 0)
                const pId = item.transactions?.patient_id

                if (!groups[tName]) {
                    groups[tName] = {
                        id: item.treatment_id || item.product_id || tName,
                        name: tName,
                        categoryName: 'Perawatan Utama',
                        count: 0,
                        revenue: 0,
                        patients: new Set()
                    }
                }

                groups[tName].count += qty
                groups[tName].revenue += amt
                if (pId) groups[tName].patients.add(pId)
            }
        })

        // Combine from Treatment Records if any
        rawTreatmentRecordItems.forEach(item => {
            const tName = item.treatments?.name || 'Treatment'
            const catName = item.treatments?.treatment_categories?.name || 'Perawatan Utama'
            const price = Number(item.price_at_time || 0)
            const pId = item.treatment_records?.patient_id

            if (!groups[tName]) {
                groups[tName] = {
                    id: item.treatment_id || tName,
                    name: tName,
                    categoryName: catName,
                    count: 0,
                    revenue: 0,
                    patients: new Set()
                }
            } else if (groups[tName].categoryName === 'Perawatan Utama') {
                groups[tName].categoryName = catName
            }

            groups[tName].count += 1
            groups[tName].revenue += price
            if (pId) groups[tName].patients.add(pId)
        })

        let list = Object.values(groups).map(g => ({
            id: g.id,
            name: g.name,
            categoryName: g.categoryName,
            count: g.count,
            uniquePatients: g.patients.size,
            revenue: g.revenue,
            avgPrice: g.count > 0 ? Math.round(g.revenue / g.count) : 0
        }))

        // Category Filter
        if (selectedCategory !== 'all') {
            list = list.filter(item => item.categoryName === selectedCategory)
        }

        // Search Filter
        if (searchTerm.trim() !== '') {
            list = list.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
        }

        // Sorting
        list.sort((a, b) => {
            let valA = a[sortField] ?? a.count
            let valB = b[sortField] ?? b.count

            if (typeof valA === 'string') {
                valA = valA.toLowerCase()
                valB = valB.toLowerCase()
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1
            return 0
        })

        return list
    }, [rawTransactionItems, rawTreatmentRecordItems, selectedCategory, searchTerm, sortField, sortDirection])

    // Process Product Metrics
    const processedProductMetrics = useMemo(() => {
        const groups = {}

        rawTransactionItems.forEach(item => {
            if (item.item_type === 'product') {
                const pName = item.name || 'Skincare Product'
                const qty = Number(item.quantity || 1)
                const amt = Number(item.subtotal || 0)
                const patientId = item.transactions?.patient_id

                if (!groups[pName]) {
                    groups[pName] = {
                        id: item.product_id || item.treatment_id || pName,
                        name: pName,
                        categoryName: 'Produk Skincare',
                        count: 0,
                        revenue: 0,
                        patients: new Set()
                    }
                }

                groups[pName].count += qty
                groups[pName].revenue += amt
                if (patientId) groups[pName].patients.add(patientId)
            }
        })

        let list = Object.values(groups).map(g => ({
            id: g.id,
            name: g.name,
            categoryName: g.categoryName,
            count: g.count,
            uniquePatients: g.patients.size,
            revenue: g.revenue,
            avgPrice: g.count > 0 ? Math.round(g.revenue / g.count) : 0
        }))

        // Category Filter
        if (selectedCategory !== 'all') {
            list = list.filter(item => item.categoryName === selectedCategory)
        }

        // Search Filter
        if (searchTerm.trim() !== '') {
            list = list.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
        }

        // Sorting
        list.sort((a, b) => {
            let valA = a[sortField] ?? a.count
            let valB = b[sortField] ?? b.count

            if (typeof valA === 'string') {
                valA = valA.toLowerCase()
                valB = valB.toLowerCase()
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1
            return 0
        })

        return list
    }, [rawTransactionItems, selectedCategory, searchTerm, sortField, sortDirection])

    // Active Metrics Depending on Active Tab
    const currentMetrics = activeTab === 'treatments' ? processedTreatmentMetrics : processedProductMetrics

    // KPI Summary
    const summaryStats = useMemo(() => {
        const totalCount = currentMetrics.reduce((acc, curr) => acc + curr.count, 0)
        const totalRevenue = currentMetrics.reduce((acc, curr) => acc + curr.revenue, 0)

        const sortedByRev = [...currentMetrics].sort((a, b) => b.revenue - a.revenue)
        const bestSeller = sortedByRev.length > 0 && sortedByRev[0].revenue > 0 ? sortedByRev[0].name : '-'

        const sortedByCount = [...currentMetrics].sort((a, b) => b.count - a.count)
        const mostPopular = sortedByCount.length > 0 && sortedByCount[0].count > 0 ? sortedByCount[0].name : '-'

        return {
            totalCount,
            totalRevenue,
            bestSeller,
            mostPopular
        }
    }, [currentMetrics])

    // Top 10 Chart Data
    const top10ChartData = useMemo(() => {
        return [...currentMetrics]
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
    }, [currentMetrics])

    // Donut Chart Category Distribution
    const categoryChartData = useMemo(() => {
        const catMap = {}
        currentMetrics.forEach(item => {
            const catName = item.categoryName || 'Lainnya'
            catMap[catName] = (catMap[catName] || 0) + item.revenue
        })

        return Object.entries(catMap).map(([name, value]) => ({
            name,
            value
        }))
    }, [currentMetrics])

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('desc')
        }
    }

    const userBranchName = branches.find(b => b.id === (userBranchId || selectedBranch))?.name || 'Cabang Klinik'

    return (
        <div className="space-y-6 pb-12">
            {/* HEADER UTAMA & FILTER BAR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                <div>
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">
                        Laporan Analitik Perawatan & Penjualan Produk
                    </h2>
                    <p className="text-xs text-gray-600 font-semibold mt-1">
                        Analisis lengkap omset, performa treatment, dan penjualan produk skincare per cabang klinik.
                    </p>
                </div>

                {/* Filter Controls: Rentang Waktu & Cabang */}
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Rentang Waktu</span>
                        <DateRangePicker
                            startDate={customStart}
                            endDate={customEnd}
                            onChange={({ startDate: s, endDate: e }) => {
                                setCustomStart(s)
                                setCustomEnd(e)
                            }}
                            align="right"
                            inputClassName="bg-pink-50 hover:bg-pink-100/70 text-ayumi-secondary border border-pink-200 font-extrabold text-xs px-3.5 py-2 rounded-2xl shadow-sm transition-colors cursor-pointer"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Filter Cabang</span>
                        {isOwner ? (
                            <div className="flex items-center gap-2 bg-pink-50 border border-pink-200 px-3.5 py-2 rounded-2xl shadow-sm">
                                <svg className="w-4 h-4 text-ayumi-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                <select 
                                    value={selectedBranch}
                                    onChange={(e) => setSelectedBranch(e.target.value)}
                                    className="bg-transparent border-none text-ayumi-secondary text-xs focus:ring-0 cursor-pointer font-extrabold outline-none pr-4"
                                >
                                    <option value="all" className="text-gray-800">Semua Cabang (Global)</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id} className="text-gray-800">{b.name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 bg-gray-100 border border-gray-200 px-3.5 py-2 rounded-2xl">
                                <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                <span className="text-gray-800 text-xs font-extrabold">{userBranchName}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* TAB SWITCHER BERSIH & RAPI */}
            <div className="flex items-center gap-2 p-1.5 bg-gray-100/80 rounded-2xl w-fit border border-gray-200">
                <button
                    onClick={() => {
                        setActiveTab('treatments')
                        setSelectedCategory('all')
                    }}
                    className={`px-5 py-2.5 rounded-xl font-extrabold text-xs transition-all flex items-center gap-2 ${
                        activeTab === 'treatments'
                            ? 'bg-white text-ayumi-primary shadow-sm border border-pink-200'
                            : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                    <svg className="w-4 h-4 text-[#B5588A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    <span>Laporan Treatment (Perawatan)</span>
                </button>

                <button
                    onClick={() => {
                        setActiveTab('products')
                        setSelectedCategory('all')
                    }}
                    className={`px-5 py-2.5 rounded-xl font-extrabold text-xs transition-all flex items-center gap-2 ${
                        activeTab === 'products'
                            ? 'bg-white text-cyan-700 shadow-sm border border-cyan-200'
                            : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                    <svg className="w-4 h-4 text-[#06B6D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    <span>Laporan Penjualan Produk Skincare</span>
                </button>
            </div>

            {/* 4 CARDS RINGKASAN KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Total Volume */}
                <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {activeTab === 'treatments' ? 'Total Sesi Treatment' : 'Total Unit Terjual'}
                    </span>
                    <p className="text-2xl font-black text-gray-900 tracking-tight">
                        {summaryStats.totalCount} <span className="text-sm font-semibold text-gray-500">{activeTab === 'treatments' ? 'Sesi' : 'Unit'}</span>
                    </p>
                </div>

                {/* Card 2: Total Pendapatan */}
                <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-1">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">
                        {activeTab === 'treatments' ? 'Pendapatan Treatment' : 'Pendapatan Produk'}
                    </span>
                    <p className="text-2xl font-black text-emerald-800 tracking-tight">
                        Rp {summaryStats.totalRevenue.toLocaleString('id-ID')}
                    </p>
                </div>

                {/* Card 3: Terlaris Nominal */}
                <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-1">
                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                        Terlaris (Nominal Omset)
                    </span>
                    <p className="text-base font-extrabold text-amber-900 truncate">
                        {summaryStats.bestSeller}
                    </p>
                </div>

                {/* Card 4: Terfavorit Volume */}
                <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-1">
                    <span className="text-[10px] font-bold text-pink-700 uppercase tracking-widest">
                        Terfavorit ({activeTab === 'treatments' ? 'Banyak Sesi' : 'Banyak Unit'})
                    </span>
                    <p className="text-base font-extrabold text-pink-900 truncate">
                        {summaryStats.mostPopular}
                    </p>
                </div>
            </div>

            {/* VISUALISASI GRAFIK BAR CHART & DONUT CHART */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Top 10 Bar Chart */}
                <div className="lg:col-span-2 p-6 bg-white rounded-3xl shadow-sm border border-gray-200 space-y-4">
                    <h3 className="text-base font-extrabold text-gray-900">
                        Top 10 {activeTab === 'treatments' ? 'Treatment Terfavorit (Jumlah Sesi)' : 'Produk Terlaris (Jumlah Unit)'}
                    </h3>
                    <div className="h-72 w-full pt-2">
                        {isLoading ? (
                            <div className="h-full flex items-center justify-center text-xs text-gray-400">Memuat grafik...</div>
                        ) : top10ChartData.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-xs text-gray-400">Tidak ada data untuk grafik pada periode ini.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={top10ChartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                    <XAxis type="number" tick={{ fontSize: 11, fontWeight: 600 }} />
                                    <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fontWeight: 700, fill: '#1e293b' }} />
                                    <RechartsTooltip formatter={(val) => [val + (activeTab === 'treatments' ? ' Sesi' : ' Unit'), 'Jumlah']} />
                                    <Bar dataKey="count" fill={activeTab === 'treatments' ? '#B5588A' : '#06B6D4'} radius={[0, 6, 6, 0]} maxBarSize={24} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Right: Donut Chart Distribution */}
                <div className="p-6 bg-white rounded-3xl shadow-sm border border-gray-200 space-y-4">
                    <h3 className="text-base font-extrabold text-gray-900">
                        Distribusi Omset Kategori
                    </h3>
                    <div className="h-72 w-full flex items-center justify-center">
                        {isLoading ? (
                            <div className="text-xs text-gray-400">Memuat distribusi...</div>
                        ) : categoryChartData.length === 0 ? (
                            <div className="text-xs text-gray-400 text-center">Tidak ada data distribusi kategori.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoryChartData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={4}
                                        dataKey="value"
                                    >
                                        {categoryChartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip formatter={(val) => ['Rp ' + Number(val).toLocaleString('id-ID'), 'Omset']} />
                                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: '700' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* TABEL RANKING PERFORMANSI DETIL */}
            <div className="p-6 bg-white rounded-3xl shadow-sm border border-gray-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
                    <div>
                        <h3 className="text-lg font-extrabold text-gray-900">
                            Ranking Performansi {activeTab === 'treatments' ? 'Treatment' : 'Penjualan Produk'}
                        </h3>
                        <p className="text-xs text-gray-500 font-semibold mt-0.5">
                            Daftar diurutkan berdasarkan parameter performa. Klik header kolom untuk menyortir.
                        </p>
                    </div>

                    {/* Search Field */}
                    <div className="relative w-full sm:w-64">
                        <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input
                            type="text"
                            placeholder={activeTab === 'treatments' ? "Cari treatment..." : "Cari produk..."}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input-ayumi pl-9 text-xs py-2 border-gray-300 w-full"
                        />
                    </div>
                </div>

                {/* Table Data */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="bg-pink-50/60 text-ayumi-secondary uppercase font-extrabold border-b border-pink-100">
                                <th onClick={() => handleSort('name')} className="p-3.5 rounded-l-2xl cursor-pointer hover:bg-pink-100/70">
                                    {activeTab === 'treatments' ? 'Nama Treatment' : 'Nama Produk'} {sortField === 'name' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                                <th onClick={() => handleSort('categoryName')} className="p-3.5 cursor-pointer hover:bg-pink-100/70">
                                    Kategori {sortField === 'categoryName' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                                <th onClick={() => handleSort('count')} className="p-3.5 text-right cursor-pointer hover:bg-pink-100/70">
                                    {activeTab === 'treatments' ? 'Sesi Tindakan' : 'Unit Terjual'} {sortField === 'count' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                                <th onClick={() => handleSort('uniquePatients')} className="p-3.5 text-right cursor-pointer hover:bg-pink-100/70">
                                    Pasien Unik {sortField === 'uniquePatients' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                                <th onClick={() => handleSort('revenue')} className="p-3.5 text-right cursor-pointer hover:bg-pink-100/70">
                                    Total Omset {sortField === 'revenue' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                                <th onClick={() => handleSort('avgPrice')} className="p-3.5 text-right rounded-r-2xl cursor-pointer hover:bg-pink-100/70">
                                    Rata-Rata/Harga {sortField === 'avgPrice' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-gray-400">Mengambil data analitik...</td>
                                </tr>
                            ) : currentMetrics.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-gray-400">Belum ada data transaksi {activeTab === 'treatments' ? 'treatment' : 'produk'} pada periode ini.</td>
                                </tr>
                            ) : (
                                currentMetrics.map((row, idx) => (
                                    <tr key={row.id || idx} className="hover:bg-gray-50/80 transition-colors">
                                        <td className="p-3.5 font-extrabold text-gray-900">{row.name}</td>
                                        <td className="p-3.5">
                                            <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                                                {row.categoryName}
                                            </span>
                                        </td>
                                        <td className="p-3.5 text-right font-extrabold text-gray-900">{row.count}</td>
                                        <td className="p-3.5 text-right text-gray-600 font-bold">{row.uniquePatients} orang</td>
                                        <td className="p-3.5 text-right font-extrabold text-emerald-700 tracking-tight">
                                            Rp {row.revenue.toLocaleString('id-ID')}
                                        </td>
                                        <td className="p-3.5 text-right text-gray-600 font-bold tracking-tight">
                                            Rp {row.avgPrice.toLocaleString('id-ID')}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
