'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import DateRangePicker from '../../components/DateRangePicker'
import StatCard from '@/components/ui/StatCard'
import { getCachedUser } from '@/lib/cachedUser'
import { getCachedBranches } from '@/lib/cachedBranches'
import { parsePaymentSplits, getQrisFee } from '@/lib/paymentUtils'
import { getTransactionRevenueBreakdown } from '@/lib/revenueBreakdown'
import { COUPON_REDEEM_SELECT } from '@/lib/couponRedeem'
import { computeDashboardInsights } from '@/lib/dashboardInsights'
import LazyRecharts from '@/components/charts/LazyRecharts'
import { toLocalYYYYMMDD } from '@/lib/localDate'
import { exportDashboardSummaryPdf } from '@/lib/exports/dashboardSummaryPdf'
import CustomerIntelligenceSection from '@/components/dashboard/CustomerIntelligenceSection'
import CategoryAnalyticsSection from '@/components/dashboard/CategoryAnalyticsSection'

// Module-level persistent caches (preserved across client navigation within session)
let globalCategoriesCache = null
let globalDashboardCache = null
let globalDashboardCachedKey = ''
let globalDashboardCachedAt = 0
const DASHBOARD_CACHE_TTL_MS = 3 * 60 * 1000

// Kapsul pemilih cabang untuk bagian analisis owner. inHeader = versi ringkas yang
// ditampilkan di tengah header saat kapsul utama sudah ter-scroll lewat.
function AnalysisBranchPill({ branches, activeBranch, onSelect, inHeader = false }) {
    return (
        <div className={inHeader
            ? 'flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-full p-1 pl-3 animate-in fade-in duration-200'
            : 'w-full sm:w-auto flex items-center justify-center gap-2 bg-white border border-stone-200 shadow-sm rounded-2xl sm:rounded-full p-1.5 sm:pl-4'}
        >
            <span className={`${inHeader ? '' : 'hidden sm:inline '}text-[11px] font-extrabold text-[#5c3316] uppercase tracking-wider whitespace-nowrap`}>
                {inHeader ? 'Analisis' : 'Analisis cabang'}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1" role="group" aria-label="Pilih cabang untuk analisis">
                {[{ branchId: '', branchName: 'Semua Cabang' }, ...(branches || [])].map(b => {
                    const active = activeBranch === b.branchId
                    return (
                        <button
                            key={b.branchId || 'all'}
                            type="button"
                            onClick={() => onSelect(b.branchId)}
                            aria-pressed={active}
                            title="Berlaku untuk peringkat layanan, pola waktu, kategori, dan demografi. Nominal = omzet bersih setelah diskon."
                            className={`${inHeader ? 'px-3 py-1' : 'px-3 sm:px-3.5 py-1.5'} rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${active
                                ? 'bg-[#5c3316] text-white shadow-sm'
                                : 'text-stone-600 hover:bg-stone-100 hover:text-[#5c3316]'}`}
                        >
                            {b.branchId ? b.branchName.replace(/^Ayumi\s+/i, '') : (
                                <><span className="sm:hidden">Semua</span><span className="hidden sm:inline">Semua Cabang</span></>
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

// Kunci cache metrik. Mencakup id, peran, dan cabang pengguna: cache ini hidup di memori
// tab dan tidak ikut hilang saat berpindah halaman, sehingga tanpa identitas di kuncinya,
// pengguna berikutnya di tab yang sama bisa menerima metrik milik pengguna sebelumnya
// (misalnya admin menerima omset seluruh cabang milik owner). Filter cabang tidak
// termasuk karena fetchDashboardMetrics tidak membacanya.
function dashboardCacheKey(user, startStr, endStr, monthStr) {
    return [user?.id || '', user?.role || '', user?.branch_id || '', startStr, endStr, monthStr].join('|')
}

export default function Dashboard() {
    const router = useRouter()
    
    // Auth & Role States
    const [dbUser, setDbUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isMounted, setIsMounted] = useState(false)

    // Filter State
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')

    // Date Range State (Defaults to current month: from 1st of month to today)

    const [startDate, setStartDate] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    })
    const [endDate, setEndDate] = useState(() => {
        return toLocalYYYYMMDD()
    })

    // Selected Target Month State
    const [targetMonth, setTargetMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false)
    const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear())

    const monthNamesIndo = useMemo(() => [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ], [])

    const shortMonthNames = useMemo(() => [
        'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
        'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
    ], [])

    const currentMonthLabel = useMemo(() => {
        if (!targetMonth) return ''
        const [yStr, mStr] = targetMonth.split('-')
        const mIdx = (parseInt(mStr, 10) || 1) - 1
        return `${monthNamesIndo[mIdx]} ${yStr}`
    }, [targetMonth, monthNamesIndo])

    // Operational KPI States
    const [statAppointments, setStatAppointments] = useState(0)
    const [statFollowups, setStatFollowups] = useState(0)
    const [statBirthdays, setStatBirthdays] = useState(0)
    const [statNewPatients, setStatNewPatients] = useState(0)
    const [statDormant, setStatDormant] = useState(0)
    const [statExpiringCoupons, setStatExpiringCoupons] = useState(0)

    // Detailed Metrics States (Unified for Owner & Admin)
    const [branchDailyComparison, setBranchDailyComparison] = useState([])
    const [branchMonthlyTargetData, setBranchMonthlyTargetData] = useState([])
    const [topTreatments, setTopTreatments] = useState([])
    const [topProducts, setTopProducts] = useState([])
    const [bottomTreatments, setBottomTreatments] = useState([])
    const [dayOfWeekStats, setDayOfWeekStats] = useState([])
    const [hourlyStats, setHourlyStats] = useState([])
    const [categoryVolumeStats, setCategoryVolumeStats] = useState([])
    const [categorySalesStats, setCategorySalesStats] = useState([])
    const [demographicGender, setDemographicGender] = useState([])
    const [demographicAge, setDemographicAge] = useState([])
    const [retentionStats, setRetentionStats] = useState({
        treatment: { newCount: 0, oldCount: 0, newRevenue: 0, oldRevenue: 0, totalRevenue: 0 },
        product: { newCount: 0, oldCount: 0, newRevenue: 0, oldRevenue: 0, totalRevenue: 0 }
    })
    const [salesInsightMetric, setSalesInsightMetric] = useState('sales') // 'sales' | 'count'
    const [retentionTab, setRetentionTab] = useState('all') // 'all' | 'treatment' | 'product'
    const [selectedCategoryTab, setSelectedCategoryTab] = useState('all') // 'all' | category name
    const [showAllCategoryItems, setShowAllCategoryItems] = useState(false)
    const [paymentBreakdown, setPaymentBreakdown] = useState([])
    const [recentBranchTransactions, setRecentBranchTransactions] = useState([])

    // Performance Caching & Lifecycle Refs
    const isInitializedRef = useRef(false)
    // Periode terakhir yang metriknya dimuat, untuk menghindari memuat ulang metrik saat
    // yang berubah hanya filter cabang (metrik tidak bergantung padanya).
    const lastMetricsParamsRef = useRef(null)
    // Melewati sekali efek filter yang terpicu oleh pemilihan cabang awal di
    // fetchInitialData, karena kombinasi itu sudah dimuat oleh fetchInitialData sendiri.
    const skipInitialFilterEffectRef = useRef(false)
    // Cabang untuk bagian analisis owner ('' = semua cabang). Analisis dihitung ulang dari
    // transaksi yang sudah dimuat, jadi berganti cabang tidak memicu query baru.
    const [analysisBranch, setAnalysisBranch] = useState('')
    const analysisBranchRef = useRef('')
    const insightSourceRef = useRef(null)
    // Saat kapsul pemilih cabang ter-scroll lewat, salinannya ditampilkan di tengah header
    // (#header-center-slot di GlobalHeader) supaya tetap terjangkau tanpa menutupi grafik.
    const [analysisPillDocked, setAnalysisPillDocked] = useState(false)
    const analysisPillObserverRef = useRef(null)
    const analysisPillRef = useCallback(node => {
        if (analysisPillObserverRef.current) {
            analysisPillObserverRef.current.disconnect()
            analysisPillObserverRef.current = null
        }
        if (!node || typeof IntersectionObserver === 'undefined') {
            setAnalysisPillDocked(false)
            return
        }
        const observer = new IntersectionObserver(([entry]) => {
            // Hanya ditempel bila kapsul keluar lewat atas, bukan saat belum terlihat di bawah.
            setAnalysisPillDocked(!entry.isIntersecting && entry.boundingClientRect.top < 120)
        })
        observer.observe(node)
        analysisPillObserverRef.current = observer
    }, [])

    // Executive Section Collapsible / Accordion States (Owner)
    const [collapsedSections, setCollapsedSections] = useState({})
    const toggleSection = (key) => setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))

    const [branchTotals, setBranchTotals] = useState({
        monthlyTarget: 0,
        rangeIncome: 0,
        treatmentIncome: 0,
        productIncome: 0,
        couponSalesIncome: 0,
        couponUsedValue: 0,
        couponUsedSessions: 0,
        qrisFee: 0,
        rangeTxCount: 0,
        topBranchName: '-'
    })

    // Table States (Appointments & Followups)
    const [recentAppointments, setRecentAppointments] = useState([])
    const [recentFollowups, setRecentFollowups] = useState([])

    // Modal States for Target Editing (Owner)
    const [isTargetModalOpen, setIsTargetModalOpen] = useState(false)
    const [targetFormData, setTargetFormData] = useState({})
    const [isSavingTargets, setIsSavingTargets] = useState(false)

    // Modal States for Coupon Session Usage Details
    const [isCouponUsageModalOpen, setIsCouponUsageModalOpen] = useState(false)
    const [couponUsageModalBranch, setCouponUsageModalBranch] = useState({ id: '', name: 'Semua Cabang' })
    const [couponUsageLogsList, setCouponUsageLogsList] = useState([])
    const [couponUsageSearch, setCouponUsageSearch] = useState('')

    const formatLogDateTime = (isoString) => {
        if (!isoString) return '-'
        const d = new Date(isoString)
        return d.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const openCouponUsageModal = (branchId = '', branchName = 'Semua Cabang') => {
        setCouponUsageModalBranch({ id: branchId || '', name: branchName || 'Semua Cabang' })
        setCouponUsageSearch('')
        setIsCouponUsageModalOpen(true)
    }

    const filteredCouponLogs = useMemo(() => {
        let list = couponUsageLogsList || []
        if (couponUsageModalBranch.id) {
            list = list.filter(l => l.branch_id === couponUsageModalBranch.id)
        }
        if (couponUsageSearch && couponUsageSearch.trim()) {
            const q = couponUsageSearch.toLowerCase()
            list = list.filter(l => 
                (l.patients?.full_name || '').toLowerCase().includes(q) ||
                (l.patients?.whatsapp || '').toLowerCase().includes(q) ||
                (l.patient_coupon_items?.treatments?.name || '').toLowerCase().includes(q) ||
                (l.patient_coupon_items?.patient_coupons?.coupon_packages?.name || '').toLowerCase().includes(q) ||
                (l.users?.full_name || '').toLowerCase().includes(q) ||
                (l.notes || '').toLowerCase().includes(q)
            )
        }
        return list
    }, [couponUsageLogsList, couponUsageModalBranch, couponUsageSearch])

    useEffect(() => {
        setIsMounted(true)
    }, [])

    const sortBranchesWithPangandaranLast = (list) => {
        if (!list || list.length === 0) return []
        return [...list].sort((a, b) => {
            const isAPangandaran = (a.name || '').toLowerCase().includes('pangandaran')
            const isBPangandaran = (b.name || '').toLowerCase().includes('pangandaran')
            if (isAPangandaran && !isBPangandaran) return 1
            if (!isAPangandaran && isBPangandaran) return -1
            return (a.name || '').localeCompare(b.name || '')
        })
    }

    // MAIN METRICS FETCHING (Unified for Owner and Admin/Staff)
    const fetchDashboardMetrics = useCallback(async (branchList, startStr, endStr, targetMonthVal, userObj) => {
        if (!branchList || branchList.length === 0) return

        try {
            const currentUser = userObj || dbUser
            const isOwner = currentUser?.role === 'owner'
            const userBranchId = currentUser?.branch_id || ''
            
            let targetBranches = branchList.filter(b => b.is_active !== false)
            if (!isOwner && userBranchId) {
                targetBranches = targetBranches.filter(b => b.id === userBranchId)
            }
            targetBranches = sortBranchesWithPangandaranLast(targetBranches)

            const sDate = startStr || startDate
            const eDate = endStr || endDate
            const tMonth = targetMonthVal || targetMonth
            lastMetricsParamsRef.current = { start: sDate, end: eDate, month: tMonth }
            
            // Helper for category mappings (cached at module level so page navigation never re-fetches)
            const getCategoriesData = async () => {
                if (!isOwner) return { treatmentCatMap: {}, productCatMap: {}, allActiveTreatments: [] }
                if (globalCategoriesCache) {
                    return globalCategoriesCache
                }
                try {
                    const [tcRes, trRes, prRes] = await Promise.all([
                        supabase.from('treatment_categories').select('id, name'),
                        supabase.from('treatments').select('id, name, category_id, is_active'),
                        supabase.from('products').select('id, name, description, is_active')
                    ])

                    const tCats = tcRes.data || []
                    const catIdToName = {}
                    tCats.forEach(c => { catIdToName[c.id] = c.name })

                    const trs = trRes.data || []
                    const activeTrs = trs.filter(t => t.is_active !== false)
                    const tMap = {}
                    trs.forEach(t => {
                        const catName = catIdToName[t.category_id] || 'FACE TREATMENT'
                        tMap[t.id] = catName
                        tMap[t.name] = catName
                    })

                    const prs = prRes.data || []
                    const pMap = {}
                    prs.forEach(p => {
                        const match = (p.description || '').match(/Kategori:\s*([^|\[\]\n\r]+)/i)
                        const catName = match ? match[1].trim() : 'Ayumi Produk'
                        pMap[p.id] = catName
                        pMap[p.name] = catName
                    })

                    const result = { treatmentCatMap: tMap, productCatMap: pMap, allActiveTreatments: activeTrs }
                    globalCategoriesCache = result
                    return result
                } catch (catErr) {
                    console.warn('Error fetching categories for owner insights:', catErr)
                    return { treatmentCatMap: {}, productCatMap: {}, allActiveTreatments: [] }
                }
            }

            // 1. Transaction query for selected date range (paginated so multi-branch / wide range never clips at 1000)
            const fetchAllRangeTransactions = async () => {
                const rows = []
                for (let from = 0; ; from += 1000) {
                    let q = supabase
                        .from('transactions')
                        .select(`
                            id, 
                            transaction_number,
                            branch_id, 
                            patient_id,
                            total,
                            subtotal,
                            discount,
                            payment_method,
                            payment_status,
                            created_at,
                            notes,
                            patients (id, full_name, gender, birth_date),
                            transaction_items (
                                id,
                                item_type,
                                treatment_id,
                                product_id,
                                name,
                                quantity,
                                price,
                                subtotal,
                                original_price,
                                discount_percent
                            ),
                            ${COUPON_REDEEM_SELECT}
                        `)
                        .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                        .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                        .order('created_at', { ascending: false })
                        .order('id', { ascending: true })
                        .range(from, from + 999)

                    if (!isOwner && userBranchId) {
                        q = q.eq('branch_id', userBranchId)
                    }

                    const { data, error } = await q
                    if (error) {
                        return { data: rows.length > 0 ? rows : null, error }
                    }
                    if (!data || data.length === 0) break
                    rows.push(...data)
                    if (data.length < 1000) break
                }
                return { data: rows, error: null }
            }

            // 2. Transactions for monthly target query (paginated to guarantee all branches data included)
            const [tYearStr, tMonthStr] = (tMonth || '').split('-')
            const tYear = parseInt(tYearStr, 10) || new Date().getFullYear()
            const tMonthIdx = (parseInt(tMonthStr, 10) || (new Date().getMonth() + 1)) - 1

            const startOfMonth = new Date(tYear, tMonthIdx, 1, 0, 0, 0).toISOString()
            const endOfMonth = new Date(tYear, tMonthIdx + 1, 0, 23, 59, 59, 999).toISOString()

            const fetchAllMonthlyTransactions = async () => {
                const rows = []
                for (let from = 0; ; from += 1000) {
                    let q = supabase
                        .from('transactions')
                        .select(`
                            id, 
                            transaction_number,
                            branch_id, 
                            total, 
                            subtotal, 
                            discount, 
                            payment_method, 
                            payment_status,
                            notes,
                            transaction_items (
                                item_type,
                                quantity,
                                price,
                                subtotal,
                                original_price,
                                discount_percent
                            )
                        `)
                        .eq('payment_status', 'paid')
                        .gte('created_at', startOfMonth)
                        .lte('created_at', endOfMonth)
                        .order('created_at', { ascending: true })
                        .order('id', { ascending: true })
                        .range(from, from + 999)

                    if (!isOwner && userBranchId) {
                        q = q.eq('branch_id', userBranchId)
                    }

                    const { data, error } = await q
                    if (error) {
                        console.error('Error fetching monthly transactions batch:', error)
                        return { data: rows.length > 0 ? rows : [], error }
                    }
                    if (!data || data.length === 0) break
                    rows.push(...data)
                    if (data.length < 1000) break
                }
                return { data: rows, error: null }
            }

            // 3. Coupon usage logs query (paginated)
            const fetchAllCouponUsageLogs = async () => {
                const rows = []
                for (let from = 0; ; from += 1000) {
                    let q = supabase
                        .from('coupon_usage_logs')
                        .select(`
                            id,
                            used_at,
                            notes,
                            branch_id,
                            transaction_id,
                            treatment_record_id,
                            branches (id, name),
                            patients (id, full_name, whatsapp),
                            patient_coupon_items (
                                id,
                                total_sessions,
                                used_sessions,
                                remaining_sessions,
                                treatments (id, name, price),
                                patient_coupons (
                                    id,
                                    coupon_packages (id, name, price)
                                )
                            ),
                            users:users!coupon_usage_logs_used_by_fkey (id, full_name)
                        `)
                        .is('voided_at', null)
                        .gte('used_at', new Date(`${sDate}T00:00:00`).toISOString())
                        .lte('used_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                        .order('used_at', { ascending: false })
                        .range(from, from + 999)

                    if (!isOwner && userBranchId) {
                        q = q.eq('branch_id', userBranchId)
                    }

                    const { data, error } = await q
                    if (error) {
                        console.error('Error fetching coupon logs batch:', error)
                        return { data: rows.length > 0 ? rows : [], error }
                    }
                    if (!data || data.length === 0) break
                    rows.push(...data)
                    if (data.length < 1000) break
                }
                return { data: rows, error: null }
            }

            // Retensi (khusus owner) memeriksa pasien mana yang sudah pernah bertransaksi sebelum
            // periode ini. Sebelumnya pemeriksaan itu baru dimulai setelah query transaksi yang berat
            // selesai, menambah 1,4-1,7 detik ke waktu muat. Kini daftar pasien diambil lewat query
            // ringan yang berjalan bersamaan dengan query inti, dan riwayat lamanya langsung dimuat.
            // Hasil akhirnya tetap dihitung hanya untuk pasien di uniquePatientsMap (lihat bagian
            // retensi di bawah), jadi klasifikasi pasien baru/lama tidak berubah.
            const retentionBeforeIso = new Date(`${sDate}T00:00:00`).toISOString()
            // Riwayat diambil per halaman: sebelumnya satu permintaan untuk hingga 250 pasien
            // bisa melewati batas 1000 baris, dan pasien lama yang terpotong terhitung sebagai baru.
            const fetchPriorPatients = async (patientIds) => {
                const found = new Set()
                const chunks = []
                for (let i = 0; i < patientIds.length; i += 100) chunks.push(patientIds.slice(i, i + 100))
                await Promise.all(chunks.map(async chunk => {
                    for (let from = 0; ; from += 1000) {
                        const { data, error } = await supabase
                            .from('transactions')
                            .select('patient_id')
                            .in('patient_id', chunk)
                            .lt('created_at', retentionBeforeIso)
                            .eq('payment_status', 'paid')
                            .order('id', { ascending: true })
                            .range(from, from + 999)
                        if (error) throw error
                        ;(data || []).forEach(r => found.add(r.patient_id))
                        if (!data || data.length < 1000) break
                    }
                }))
                return found
            }
            const targetBranchIds = new Set(targetBranches.map(b => b.id))
            const earlyRetentionPromise = isOwner
                ? (async () => {
                    const ids = new Set()
                    for (let from = 0; ; from += 1000) {
                        const { data, error } = await supabase
                            .from('transactions')
                            .select('patient_id, branch_id, payment_status')
                            .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                            .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                            .order('created_at', { ascending: true })
                            .range(from, from + 999)
                        if (error) throw error
                        ;(data || []).forEach(tx => {
                            if (tx.patient_id && tx.branch_id && targetBranchIds.has(tx.branch_id) && tx.payment_status === 'paid') {
                                ids.add(tx.patient_id)
                            }
                        })
                        if (!data || data.length < 1000) break
                    }
                    return { covered: ids, prior: await fetchPriorPatients([...ids]) }
                })().catch(err => {
                    console.warn('Early retention lookup failed, will retry after core queries:', err)
                    return null
                })
                : null

            // Execute ALL core queries in parallel!
            const [
                catData,
                txResult,
                monthlyResult,
                logsResult
            ] = await Promise.all([
                getCategoriesData(),
                fetchAllRangeTransactions(),
                fetchAllMonthlyTransactions(),
                fetchAllCouponUsageLogs()
            ])

            const { treatmentCatMap, productCatMap, allActiveTreatments } = catData
            const monthlyTrx = monthlyResult?.data || []
            const couponLogsData = logsResult?.data || []

            let rangeTrx = txResult?.data || []
            if (txResult?.error) {
                console.warn('Full transaction query failed, falling back:', txResult.error.message)
                const fallbackRows = []
                for (let from = 0; ; from += 1000) {
                    let fallbackQuery = supabase
                        .from('transactions')
                        .select(`
                            id, 
                            transaction_number,
                            branch_id, 
                            patient_id,
                            total,
                            subtotal,
                            discount,
                            payment_method,
                            payment_status,
                            created_at,
                            notes,
                            patients (id, full_name, gender, birth_date),
                            transaction_items (
                                id,
                                item_type,
                                treatment_id,
                                product_id,
                                name,
                                quantity,
                                subtotal
                            )
                        `)
                        .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                        .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                        .order('created_at', { ascending: false })
                        .range(from, from + 999)

                    if (!isOwner && userBranchId) {
                        fallbackQuery = fallbackQuery.eq('branch_id', userBranchId)
                    }
                    const { data: fbData, error: fbError } = await fallbackQuery
                    if (fbError) break
                    if (!fbData || fbData.length === 0) break
                    fallbackRows.push(...fbData)
                    if (fbData.length < 1000) break
                }
                rangeTrx = fallbackRows
            }

            // Save recent transactions for the table (10 latest)
            setRecentBranchTransactions(rangeTrx ? rangeTrx.slice(0, 10) : [])

            const rangeMap = {}
            let grandTotalRange = 0
            let grandTreatmentRange = 0
            let grandProductRange = 0
            let grandCouponSalesRange = 0
            let grandDiscountRange = 0
            let grandQrisFeeRange = 0
            let totalTxCountRange = 0
            const methodMap = {}

            targetBranches.forEach(b => {
                rangeMap[b.id] = {
                    branchId: b.id,
                    branchName: b.name,
                    treatmentIncome: 0,
                    productIncome: 0,
                    couponSalesIncome: 0,
                    couponUsedValue: 0,
                    couponUsedSessions: 0,
                    otherIncome: 0,
                    treatmentGross: 0,
                    productGross: 0,
                    couponSalesGross: 0,
                    otherGross: 0,
                    treatmentRedeem: 0,
                    productRedeem: 0,
                    couponSalesRedeem: 0,
                    otherRedeem: 0,
                    discountTotal: 0,
                    cashIncome: 0,
                    totalIncome: 0,
                    qrisFee: 0,
                    transactionCount: 0
                }
            })

            if (rangeTrx) {
                rangeTrx.forEach(tx => {
                    // Hanya nota lunas, sama seperti Riwayat Transaksi & Riwayat Kasir. Dulu semua
                    // status selain void (termasuk pending/unpaid/cancelled) ikut dihitung.
                    const isPaid = tx.payment_status === 'paid'
                    if (tx && tx.branch_id && rangeMap[tx.branch_id] && isPaid) {
                        const branchObj = rangeMap[tx.branch_id]
                        branchObj.transactionCount += 1
                        totalTxCountRange += 1

                        // Omzet per kategori dihitung bersih (setelah diskon) agar jumlahnya sama
                        // dengan total omzet cabang. Lihat lib/revenueBreakdown.js.
                        const breakdown = getTransactionRevenueBreakdown(tx)
                        const txTreatment = breakdown.net.treatment
                        const txProduct = breakdown.net.product
                        const txCouponSales = breakdown.net.coupon
                        const txOther = breakdown.net.other
                        const txCouponUsed = breakdown.couponRedeemedValue
                        const txCouponSessions = breakdown.couponRedeemedSessions

                        branchObj.treatmentIncome += txTreatment
                        branchObj.productIncome += txProduct
                        branchObj.couponSalesIncome += txCouponSales
                        branchObj.couponUsedValue += txCouponUsed
                        branchObj.couponUsedSessions += txCouponSessions
                        branchObj.otherIncome += txOther
                        branchObj.treatmentGross += breakdown.gross.treatment
                        branchObj.productGross += breakdown.gross.product
                        branchObj.couponSalesGross += breakdown.gross.coupon
                        branchObj.otherGross += breakdown.gross.other
                        // Nilai sesi kupon yang dipakai: masuk kotor, bukan diskon.
                        branchObj.treatmentRedeem += breakdown.redeem.treatment
                        branchObj.productRedeem += breakdown.redeem.product
                        branchObj.couponSalesRedeem += breakdown.redeem.coupon
                        branchObj.otherRedeem += breakdown.redeem.other
                        
                        const realCash = breakdown.netTotal
                        const txQrisFee = getQrisFee(tx)
                        // Diskon riil = kotor - bersih. tx.discount tidak dipakai karena pada nota
                        // migrasi GD diskon kupon tercatat dua kali di kolom itu.
                        const txDisc = breakdown.gross.treatment + breakdown.gross.product + breakdown.gross.coupon + breakdown.gross.other - realCash - breakdown.redeemTotal

                        branchObj.discountTotal += txDisc
                        branchObj.cashIncome += realCash
                        branchObj.totalIncome += realCash
                        branchObj.qrisFee += txQrisFee

                        grandTotalRange += realCash
                        grandTreatmentRange += txTreatment
                        grandProductRange += txProduct
                        grandCouponSalesRange += txCouponSales
                        grandDiscountRange += txDisc
                        grandQrisFeeRange += txQrisFee

                        const splits = parsePaymentSplits(tx)
                        Object.entries(splits).forEach(([method, amt]) => {
                            if (amt > 0) {
                                const pMethod = method.toUpperCase()
                                methodMap[pMethod] = (methodMap[pMethod] || 0) + amt
                            }
                        })
                    }
                })
            }

            // Formatted payment breakdown
            const formattedMethods = Object.entries(methodMap).map(([m, amt]) => ({
                method: m,
                amount: amt,
                percent: grandTotalRange > 0 ? ((amt / grandTotalRange) * 100).toFixed(1) : '0'
            })).sort((a, b) => b.amount - a.amount)
            setPaymentBreakdown(formattedMethods)

            setCouponUsageLogsList(couponLogsData)

            let grandCouponUsedSessions = 0
            let grandCouponUsedVal = 0
            targetBranches.forEach(b => {
                const bLogs = couponLogsData.filter(l => l.branch_id === b.id)
                const logSessionCount = bLogs.length
                let bLogVal = 0
                bLogs.forEach(l => {
                    const it = l.patient_coupon_items
                    const tP = Number(it?.treatments?.price || 0)
                    const pP = Number(it?.patient_coupons?.coupon_packages?.price || 0)
                    const tS = Number(it?.total_sessions || 1)
                    bLogVal += (tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0))
                })

                // Sesi dari kasir aplikasi tercatat di coupon_usage_logs. Sesi dari nota migrasi
                // GD Cashier tidak punya log, jadi dihitung dari notanya (lihat revenueBreakdown).
                // Keduanya tidak tumpang tindih, sehingga dijumlahkan.
                const gdCount = rangeMap[b.id]?.couponUsedSessions || 0
                const gdVal = rangeMap[b.id]?.couponUsedValue || 0
                const finalSessionCount = logSessionCount + gdCount
                const finalSessionVal = bLogVal + gdVal

                rangeMap[b.id].couponUsedSessions = finalSessionCount
                rangeMap[b.id].couponUsedValue = finalSessionVal
                rangeMap[b.id].gdCouponUsedSessions = gdCount
                rangeMap[b.id].gdCouponUsedValue = gdVal

                grandCouponUsedSessions += finalSessionCount
                grandCouponUsedVal += finalSessionVal
            })

            let topBranch = '-'
            let maxIncome = -1

            const formattedRangeComp = targetBranches.map(b => {
                const item = rangeMap[b.id]
                if (item.totalIncome > maxIncome && item.totalIncome > 0) {
                    maxIncome = item.totalIncome
                    topBranch = item.branchName
                }
                return { ...item }
            })

            setBranchDailyComparison(formattedRangeComp)

            // Analisis (peringkat, pola waktu, kategori, demografi, retensi) dihitung lewat
            // lib/dashboardInsights.js agar bisa diulang per cabang tanpa query baru.
            const insightRows = (rangeTrx || []).filter(tx => tx && rangeMap[tx.branch_id])
            const priorPatientIds = new Set()
            if (isOwner) {
                // Retensi: pasien yang sudah pernah bertransaksi sebelum periode ini.
                const uniquePatIds = [...new Set(insightRows
                    .filter(tx => tx.payment_status === 'paid' && tx.patients?.id)
                    .map(tx => tx.patients.id))]
                if (uniquePatIds.length > 0) {
                    try {
                        const early = await earlyRetentionPromise
                        // Pasien yang belum terjangkau pemeriksaan awal (misalnya transaksinya masuk
                        // di sela-sela kedua query) diperiksa sekarang, seperti sebelumnya.
                        const missing = uniquePatIds.filter(id => !early || !early.covered.has(id))
                        const extra = missing.length > 0 ? await fetchPriorPatients(missing) : new Set()
                        uniquePatIds.forEach(id => {
                            if ((early && early.prior.has(id)) || extra.has(id)) priorPatientIds.add(id)
                        })
                    } catch (priorErr) {
                        console.warn('Error checking prior transactions for retention:', priorErr)
                    }
                }
            }

            const insightContext = { treatmentCatMap, productCatMap, allActiveTreatments, priorPatientIds }
            insightSourceRef.current = { rows: insightRows, context: insightContext, isOwner }
            const allBranchInsights = computeDashboardInsights(insightRows, insightContext, '')
            const activeAnalysisBranch = isOwner ? analysisBranchRef.current : ''
            const visibleInsights = activeAnalysisBranch
                ? computeDashboardInsights(insightRows, insightContext, activeAnalysisBranch)
                : allBranchInsights

            setTopTreatments(visibleInsights.topTreatments)
            setTopProducts(visibleInsights.topProducts)
            if (isOwner) {
                setDayOfWeekStats(visibleInsights.dayOfWeekStats)
                setHourlyStats(visibleInsights.hourlyStats)
                setCategoryVolumeStats(visibleInsights.categoryVolumeStats)
                setCategorySalesStats(visibleInsights.categorySalesStats)
                setBottomTreatments(visibleInsights.bottomTreatments)
                setDemographicGender(visibleInsights.demographicGender)
                setDemographicAge(visibleInsights.demographicAge)
                setRetentionStats(visibleInsights.retentionStats)
            }

            // 2. Monthly target calculation (Khusus Treatment & Kupon) - pre-fetched in parallel
            const monthlyMap = {}
            let totalCompanyTarget = 0
            let totalMonthlyTargetIncome = 0

            targetBranches.forEach(b => {
                const targetVal = Number(b.monthly_target || 0)
                totalCompanyTarget += targetVal
                monthlyMap[b.id] = {
                    branchId: b.id,
                    branchName: b.name,
                    monthlyTarget: targetVal,
                    monthlyIncome: 0,
                    monthlyTreatmentIncome: 0,
                    monthlyCouponSalesIncome: 0,
                    monthlyQrisFee: 0
                }
            })

            if (monthlyTrx) {
                monthlyTrx.forEach(tx => {
                    if (tx && tx.branch_id && monthlyMap[tx.branch_id]) {
                        // Target HANYA untuk Treatment dan Kupon, dihitung dari pendapatan bersih
                        // (setelah diskon). Sesi kupon yang dipakai tidak ikut, karena nilainya sudah
                        // terhitung saat paket kupon dijual.
                        const breakdown = getTransactionRevenueBreakdown(tx)
                        const txTreatmentIncome = breakdown.net.treatment
                        const txCouponSalesIncome = breakdown.net.coupon
                        const txTargetIncome = txTreatmentIncome + txCouponSalesIncome

                        const qFee = getQrisFee(tx)
                        monthlyMap[tx.branch_id].monthlyIncome += txTargetIncome
                        monthlyMap[tx.branch_id].monthlyTreatmentIncome += txTreatmentIncome
                        monthlyMap[tx.branch_id].monthlyCouponSalesIncome += txCouponSalesIncome
                        monthlyMap[tx.branch_id].monthlyQrisFee += qFee
                        totalMonthlyTargetIncome += txTargetIncome
                    }
                })
            }

            const formattedMonthlyTargets = targetBranches.map(b => {
                const item = monthlyMap[b.id]
                const percent = item.monthlyTarget > 0 ? (item.monthlyIncome / item.monthlyTarget) * 100 : 0
                const remaining = item.monthlyTarget - item.monthlyIncome

                return {
                    ...item,
                    rawPercent: percent.toFixed(1),
                    remainingTarget: remaining > 0 ? remaining : 0,
                    surplusTarget: remaining < 0 ? Math.abs(remaining) : 0
                }
            })

            setBranchMonthlyTargetData(formattedMonthlyTargets)

            const computedTotals = {
                monthlyTarget: totalCompanyTarget,
                monthlyTargetIncome: totalMonthlyTargetIncome,
                rangeIncome: grandTotalRange,
                treatmentIncome: grandTreatmentRange,
                productIncome: grandProductRange,
                couponSalesIncome: grandCouponSalesRange,
                couponUsedValue: grandCouponUsedVal,
                couponUsedSessions: grandCouponUsedSessions,
                discountTotal: grandDiscountRange,
                qrisFee: grandQrisFeeRange,
                rangeTxCount: totalTxCountRange,
                topBranchName: topBranch !== '-' ? topBranch : (formattedRangeComp[0]?.branchName || '-')
            }
            setBranchTotals(computedTotals)

            // Cache metrics at module level for instantaneous 0ms reopening
            globalDashboardCache = {
                branchTotals: computedTotals,
                // Nama field harus sama dengan state yang dipakai tampilan (branchDailyComparison).
                branchDailyComparison: formattedRangeComp,
                branchMonthlyTargetData: formattedMonthlyTargets,
                // Cache selalu berisi analisis semua cabang; pilihan cabang analisis kembali ke
                // "Semua Cabang" setiap kali halaman dibuka ulang.
                topTreatments: allBranchInsights.topTreatments,
                topProducts: allBranchInsights.topProducts,
                bottomTreatments: allBranchInsights.bottomTreatments,
                categorySalesStats: allBranchInsights.categorySalesStats,
                categoryVolumeStats: allBranchInsights.categoryVolumeStats,
                demographicGender: allBranchInsights.demographicGender,
                demographicAge: allBranchInsights.demographicAge,
                retentionStats: allBranchInsights.retentionStats,
                dayOfWeekStats: allBranchInsights.dayOfWeekStats,
                hourlyStats: allBranchInsights.hourlyStats,
                paymentBreakdown: formattedMethods,
                couponUsageLogsList: couponLogsData,
                recentBranchTransactions: rangeTrx ? rangeTrx.slice(0, 10) : []
            }
            globalDashboardCachedKey = dashboardCacheKey(currentUser, sDate, eDate, tMonth)
            globalDashboardCachedAt = Date.now()

        } catch (e) {
            console.error('Error fetching dashboard metrics:', e)
        }
    }, [startDate, endDate, targetMonth, dbUser])

    const applyCachedDashboard = (cache) => {
        if (!cache) return
        if (cache.branchTotals) setBranchTotals(cache.branchTotals)
        // Sebelumnya memanggil setBranchRangeData, yang tidak pernah dideklarasikan: setiap
        // cache terpakai berakhir ReferenceError dan dashboard tertahan di spinner.
        if (cache.branchDailyComparison) setBranchDailyComparison(cache.branchDailyComparison)
        if (cache.branchMonthlyTargetData) setBranchMonthlyTargetData(cache.branchMonthlyTargetData)
        if (cache.topTreatments) setTopTreatments(cache.topTreatments)
        if (cache.topProducts) setTopProducts(cache.topProducts)
        if (cache.bottomTreatments) setBottomTreatments(cache.bottomTreatments)
        if (cache.categorySalesStats) setCategorySalesStats(cache.categorySalesStats)
        if (cache.categoryVolumeStats) setCategoryVolumeStats(cache.categoryVolumeStats)
        if (cache.demographicGender) setDemographicGender(cache.demographicGender)
        if (cache.demographicAge) setDemographicAge(cache.demographicAge)
        if (cache.retentionStats) setRetentionStats(cache.retentionStats)
        if (cache.dayOfWeekStats) setDayOfWeekStats(cache.dayOfWeekStats)
        if (cache.hourlyStats) setHourlyStats(cache.hourlyStats)
        if (cache.paymentBreakdown) setPaymentBreakdown(cache.paymentBreakdown)
        if (cache.couponUsageLogsList) setCouponUsageLogsList(cache.couponUsageLogsList)
        if (cache.recentBranchTransactions) setRecentBranchTransactions(cache.recentBranchTransactions)
    }

    const fetchInitialData = async () => {
        try {
            // Pengguna dan cabang dari cache bersama -- seketika bila sudah pernah dimuat.
            const [{ user, dbUser: profile }, branchData] = await Promise.all([
                getCachedUser(),
                getCachedBranches()
            ])

            if (!user) {
                router.push('/login')
                return
            }

            const activeUserData = profile || { role: 'owner', full_name: user.email, id: user.id }
            if (activeUserData.role === 'therapist') {
                router.push('/therapist/dashboard')
                return
            }

            const sorted = branchData || []
            const initialBranch = activeUserData.role === 'owner' ? '' : (activeUserData.branch_id || '')

            // Metrik dari cache bila masih segar untuk pengguna dan periode yang sama.
            const cacheKey = dashboardCacheKey(activeUserData, startDate, endDate, targetMonth)
            const hasFreshCache = globalDashboardCache
                && globalDashboardCachedKey === cacheKey
                && (Date.now() - globalDashboardCachedAt < DASHBOARD_CACHE_TTL_MS)
            if (hasFreshCache) {
                applyCachedDashboard(globalDashboardCache)
            }

            // setSelectedBranch memicu efek filter di bawah. Kombinasi awal ini dimuat oleh
            // fungsi ini sendiri, jadi efeknya dilewati sekali -- tanpa itu, metrik dan
            // statistik operasional dimuat dua kali setiap admin membuka dashboard.
            if (initialBranch !== selectedBranch) {
                skipInitialFilterEffectRef.current = true
            }

            setBranches(sorted)
            setDbUser(activeUserData)
            setSelectedBranch(initialBranch)

            // Halaman langsung tampil tanpa menunggu metrik. Dengan cache: lengkap seketika,
            // lalu diperbarui diam-diam di latar. Tanpa cache: metrik menyusul, dengan
            // penanda "Memperbarui data dashboard..." selama dimuat.
            isInitializedRef.current = true
            if (hasFreshCache) {
                setLoading(false)
            }

            // Statistik operasional tidak bergantung pada metrik, jadi dimuat bersamaan.
            fetchOperationalStats(activeUserData)
            if (sorted.length > 0) {
                await fetchDashboardMetrics(sorted, startDate, endDate, targetMonth, activeUserData)
            }

            setLoading(false)
        } catch (err) {
            console.error('Error initializing dashboard:', err)
            setLoading(false)
        }
    }

    const fetchOperationalStats = async (userObj) => {
        try {
            const currentUser = userObj || dbUser
            const isOwner = currentUser?.role === 'owner'
            const effectiveBranch = isOwner ? selectedBranch : (currentUser?.branch_id || '')
            const todayDateStr = toLocalYYYYMMDD()
            const now = new Date()

            const applyBranch = (query, col = 'branch_id') => {
                if (effectiveBranch) return query.eq(col, effectiveBranch)
                return query
            }

            // 1. Appointments Today
            let aptQuery = supabase.from('appointments').select('id, start_time, end_time, status, patient_id, patients(id, full_name, whatsapp)', { count: 'exact' })
                .eq('appointment_date', todayDateStr)
                .order('start_time', { ascending: true })
            // Tampilan hanya memakai 5 teratas; jumlahnya tetap dihitung penuh oleh count: exact.
            aptQuery = applyBranch(aptQuery).limit(5)

            // 2. Followups Pending
            let fuQuery = supabase.from('followup_queue').select('id, followup_type, priority, scheduled_date, patient_id, patients(id, full_name, whatsapp)', { count: 'exact' })
                .eq('status', 'pending')
                .lte('scheduled_date', todayDateStr)
                .order('priority', { ascending: false })
            // Sebelumnya seluruh antrean (ratusan baris, dengan join pasien) diunduh hanya untuk
            // jumlah dan 5 teratas. Jumlahnya tetap dihitung penuh oleh count: exact.
            fuQuery = applyBranch(fuQuery).limit(5)

            // 3. Birthdays This Month
            const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0')
            // Diambil per halaman: satu permintaan berhenti di 1000 baris, sehingga cabang dengan
            // lebih dari 1000 pasien (Ciamis: 1.916) menampilkan jumlah ulang tahun yang kurang.
            // Hanya birth_date yang diambil -- satu-satunya kolom yang dipakai perhitungannya.
            const bdayQuery = (async () => {
                const rows = []
                for (let from = 0; ; from += 1000) {
                    const { data, error } = await applyBranch(
                        supabase.from('patients').select('birth_date').not('birth_date', 'is', null)
                    ).order('id', { ascending: true }).range(from, from + 999)
                    if (error) return { data: null }
                    if (!data || data.length === 0) break
                    rows.push(...data)
                    if (data.length < 1000) break
                }
                return { data: rows }
            })()

            // 4. Dormant Patients (>60 days no visit)
            // Tabel patients tidak punya kolom last_visit, sehingga query lama selalu ditolak
            // (400) dan angkanya tampil 0. patient_status_view menghitung kunjungan terakhir
            // dari rekam treatment dan hanya berisi pasien aktif.
            let dormantQuery = supabase.from('patient_status_view').select('patient_id', { count: 'exact', head: true })
                .or('days_since_last_visit.gt.60,last_visit_date.is.null')
            dormantQuery = applyBranch(dormantQuery)

            // 5. New Patients This Month
            const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
            let newPatQuery = supabase.from('patients').select('id', { count: 'exact', head: true })
                .gte('created_at', startOfMonthIso)
            newPatQuery = applyBranch(newPatQuery)

            // 6. Expiring Coupons (within 30 days)
            const in30Days = new Date()
            in30Days.setDate(in30Days.getDate() + 30)
            let couponsQuery = supabase.from('patient_coupons').select('id', { count: 'exact', head: true })
                .eq('status', 'active')
                .gte('expired_at', now.toISOString())
                .lte('expired_at', in30Days.toISOString())

            const [
                aptRes,
                fuRes,
                bdayRes,
                dormantRes,
                newPatRes,
                couponsRes
            ] = await Promise.all([
                aptQuery,
                fuQuery,
                bdayQuery,
                dormantQuery,
                newPatQuery,
                couponsQuery
            ])

            setStatAppointments(aptRes?.count || aptRes?.data?.length || 0)
            setRecentAppointments(aptRes?.data ? aptRes.data.slice(0, 5) : [])

            setStatFollowups(fuRes?.count || fuRes?.data?.length || 0)
            setRecentFollowups(fuRes?.data ? fuRes.data.slice(0, 5) : [])

            const bdayCount = (bdayRes?.data || []).filter(p => {
                if (!p.birth_date) return false
                const parts = p.birth_date.split('-')
                return parts[1] === currentMonthStr
            }).length
            setStatBirthdays(bdayCount)

            setStatDormant(dormantRes?.count || 0)
            setStatNewPatients(newPatRes?.count || 0)
            setStatExpiringCoupons(couponsRes?.count || 0)

        } catch (err) {
            console.error('Error fetching operational stats:', err)
        }
    }

    useEffect(() => {
        fetchInitialData()
    }, [])

    useEffect(() => {
        if (!isInitializedRef.current) return
        if (skipInitialFilterEffectRef.current) {
            skipInitialFilterEffectRef.current = false
            return
        }
        if (dbUser && branches.length > 0) {
            // Metrik hanya bergantung pada periode, bukan filter cabang -- jadi hanya dimuat
            // ulang bila periodenya berubah. Statistik operasional memakai filter cabang,
            // jadi selalu dimuat ulang.
            const last = lastMetricsParamsRef.current
            const periodChanged = !last || last.start !== startDate || last.end !== endDate || last.month !== targetMonth
            if (periodChanged) {
                fetchDashboardMetrics(branches, startDate, endDate, targetMonth, dbUser)
            }
            fetchOperationalStats(dbUser)
        }
    }, [startDate, endDate, targetMonth, selectedBranch])

    const selectAnalysisBranch = (branchId) => {
        setAnalysisBranch(branchId)
        analysisBranchRef.current = branchId
        const source = insightSourceRef.current
        if (!source || !source.isOwner) return
        const ins = computeDashboardInsights(source.rows, source.context, branchId)
        setTopTreatments(ins.topTreatments)
        setTopProducts(ins.topProducts)
        setDayOfWeekStats(ins.dayOfWeekStats)
        setHourlyStats(ins.hourlyStats)
        setCategoryVolumeStats(ins.categoryVolumeStats)
        setCategorySalesStats(ins.categorySalesStats)
        setBottomTreatments(ins.bottomTreatments)
        setDemographicGender(ins.demographicGender)
        setDemographicAge(ins.demographicAge)
        setRetentionStats(ins.retentionStats)
    }

    const handleOpenTargetModal = () => {
        const initialForm = {}
        branches.forEach(b => {
            initialForm[b.id] = b.monthly_target || 0
        })
        setTargetFormData(initialForm)
        setIsTargetModalOpen(true)
    }

    const handleSaveTargets = async () => {
        setIsSavingTargets(true)
        try {
            const updates = Object.entries(targetFormData).map(([branchId, targetVal]) => {
                return supabase
                    .from('branches')
                    .update({ monthly_target: Number(targetVal) || 0 })
                    .eq('id', branchId)
            })
            await Promise.all(updates)
            toast.success('Target bulanan cabang berhasil disimpan')
            setIsTargetModalOpen(false)
            
            const { data: updatedBranches } = await supabase
                .from('branches')
                .select('id, name, monthly_target, is_active')
            if (updatedBranches) {
                const sorted = sortBranchesWithPangandaranLast(updatedBranches)
                setBranches(sorted)
                fetchDashboardMetrics(sorted, startDate, endDate, targetMonth, dbUser)
            }
        } catch (e) {
            console.error('Failed to update targets:', e)
            toast.error('Gagal memperbarui target: ' + e.message)
        } finally {
            setIsSavingTargets(false)
        }
    }

    const handlePrintSummary = () =>
        exportDashboardSummaryPdf({ branchDailyComparison, branchTotals, branches, dbUser, endDate, paymentBreakdown, startDate, topProducts, topTreatments })

    const userBranchName = useMemo(() => {
        if (!dbUser?.branch_id || !branches) return 'Semua Cabang'
        const found = branches.find(b => b.id === dbUser.branch_id)
        return found ? found.name : 'Semua Cabang'
    }, [dbUser, branches])

    const isOwner = dbUser?.role === 'owner'

    // --- Tampilan dashboard admin cabang (hanya format & turunan tampilan, bukan logika data) ---
    const formatCompactRupiah = (val) => {
        const n = Number(val || 0)
        const abs = Math.abs(n)
        if (abs >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
        if (abs >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} Jt`
        if (abs >= 1e3) return `Rp ${Math.round(n / 1e3).toLocaleString('id-ID')} Rb`
        return `Rp ${Math.round(n).toLocaleString('id-ID')}`
    }

    // Sisa hari (termasuk hari ini) pada bulan target, untuk kebutuhan rata-rata harian.
    const getTargetDaysLeft = () => {
        if (!targetMonth) return 0
        const [y, m] = targetMonth.split('-').map(Number)
        const daysInMonth = new Date(y, m, 0).getDate()
        const now = new Date()
        const curY = now.getFullYear()
        const curM = now.getMonth() + 1
        if (y < curY || (y === curY && m < curM)) return 0
        if (y === curY && m === curM) return daysInMonth - now.getDate() + 1
        return daysInMonth
    }

    // Warna per kategori sama dengan grafik owner, agar kategori selalu berwarna sama.
    const adminCompositionData = (() => {
        const treatment = Number(branchTotals.treatmentIncome || 0)
        const product = Number(branchTotals.productIncome || 0)
        const coupon = Number(branchTotals.couponSalesIncome || 0)
        const other = Math.max(0, Math.round(Number(branchTotals.rangeIncome || 0) - treatment - product - coupon))
        const rows = [
            { key: 'treatment', name: 'Treatment', value: treatment, color: '#EC4899' },
            { key: 'product', name: 'Produk Skincare', value: product, color: '#06B6D4' },
            { key: 'coupon', name: 'Penjualan Kupon', value: coupon, color: '#8B5CF6' }
        ]
        if (other > 0) rows.push({ key: 'other', name: 'Lainnya', value: other, color: '#A8A29E' })
        const total = rows.reduce((s, r) => s + r.value, 0)
        return { rows, total }
    })()

    const medalStyle = (idx) => {
        if (idx === 0) return 'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm shadow-amber-500/30'
        if (idx === 1) return 'bg-gradient-to-br from-slate-200 to-slate-400 text-white shadow-sm shadow-slate-400/30'
        if (idx === 2) return 'bg-gradient-to-br from-orange-300 to-orange-600 text-white shadow-sm shadow-orange-600/30'
        return 'bg-stone-100 text-stone-500'
    }

    const getInitials = (name) => {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
        if (parts.length === 0) return '?'
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
    }

    const PAYMENT_METHOD_STYLE = {
        qris: 'bg-violet-50 text-violet-700 border-violet-200',
        cash: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        debit: 'bg-sky-50 text-sky-700 border-sky-200',
        credit: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        transfer: 'bg-blue-50 text-blue-700 border-blue-200'
    }

    const APPOINTMENT_STATUS = {
        scheduled: { label: 'Terjadwal', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
        confirmed: { label: 'Dikonfirmasi', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
        arrived: { label: 'Sudah Datang', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
        in_treatment: { label: 'Sedang Treatment', cls: 'bg-pink-50 text-pink-700 border-pink-200' },
        therapist_ready: { label: 'Terapis Siap', cls: 'bg-pink-50 text-pink-700 border-pink-200' },
        completed: { label: 'Selesai', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        cancelled: { label: 'Dibatalkan', cls: 'bg-stone-100 text-stone-500 border-stone-200' },
        no_show: { label: 'Tidak Datang', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
        not_arrived: { label: 'Tidak Datang', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
    }

    const FOLLOWUP_TYPE_LABEL = {
        treatment_reminder: 'Pengingat perawatan',
        birthday: 'Ucapan ulang tahun',
        dormant_reactivation: 'Sapaan pasien dormant',
        manual: 'Follow-up manual'
    }

    const PRIORITY_STYLE = {
        high: { label: 'Tinggi', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
        normal: { label: 'Normal', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
        low: { label: 'Rendah', cls: 'bg-stone-100 text-stone-600 border-stone-200' }
    }

    if (loading && (!dbUser || !isInitializedRef.current)) {
        return (
            <div className="min-h-[75vh] flex flex-col items-center justify-center gap-4 text-stone-500 font-sans">
                <div className="relative flex items-center justify-center">
                    <div className="w-11 h-11 border-3 border-stone-200 border-t-[#5c3316] rounded-full animate-spin" />
                </div>
                <div className="text-center space-y-1">
                    <p className="text-sm font-bold text-stone-800 tracking-wide">Memuat Dashboard Eksekutif...</p>
                    <p className="text-xs text-stone-400 font-medium">Sinkronisasi data penjualan multi-cabang & analitik</p>
                </div>
            </div>
        )
    }

    return (
        <div className={`space-y-6 pb-12 font-sans text-stone-900 relative ${loading && isInitializedRef.current ? '[&>*:not(:first-child)]:opacity-60 [&>*:not(:first-child)]:animate-pulse' : ''}`}>
            {/* Selama metrik pertama dimuat tanpa cache, konten diredupkan agar angka nol
                sementara tidak terbaca sebagai data sungguhan; penanda di bawah tetap terang. */}
            {loading && isInitializedRef.current && (
                <div className="sticky top-4 z-40 flex justify-center pointer-events-none mb-2 animate-in fade-in duration-200">
                    <div className="bg-stone-900/90 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-xl flex items-center gap-2.5 border border-white/20">
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Memperbarui data dashboard...</span>
                    </div>
                </div>
            )}

            {isOwner ? (
                /* ========================================================================= */
                /* DASHBOARD KHUSUS OWNER (EXECUTIVE OVERVIEW - RESTORED)                   */
                /* ========================================================================= */
                <div className="space-y-6">
                    {/* HERO BANNER EKSKLUSIF OWNER */}
                    <div className="bg-gradient-to-r from-ayumi-secondary via-[#5c3316] to-[#6d3e1d] rounded-2xl sm:rounded-3xl p-5 sm:p-6 md:p-8 text-white shadow-xl relative border border-white/10">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6 pb-5 sm:pb-6 border-b border-white/15">
                            <div className="space-y-1">
                                <span className="bg-white/15 text-pink-100 text-[10px] uppercase font-extrabold tracking-[0.2em] px-3.5 py-1 rounded-full border border-white/15 shadow-sm">
                                    EXECUTIVE BUSINESS SUMMARY
                                </span>
                                <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white mt-1.5">
                                    Rekap Omset Perusahaan
                                </h2>
                                <p className="text-xs text-pink-100/80 font-medium">
                                    Ringkasan akumulasi omset dan performa seluruh cabang klinik Ayumi Beauty House.
                                </p>
                            </div>

                            {/* Export / Cetak Laporan Button */}
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handlePrintSummary}
                                    className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs px-4 py-2.5 rounded-2xl border border-white/20 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4 text-ayumi-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    <span>Cetak Laporan</span>
                                </button>
                            </div>
                        </div>

                        {/* 4 KPI Cards: Total Pendapatan Perusahaan, Total Transaksi, Sesi Kupon Terpakai, Biaya Tambahan QRIS */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 pt-5 sm:pt-6">
                            <StatCard
                                title="Total Pendapatan Perusahaan"
                                value={`Rp ${branchTotals.rangeIncome.toLocaleString('id-ID')}`}
                                subtitle={`Periode Terpilih (${branches.length} Cabang)`}
                                variant="glass"
                            />
                            <StatCard
                                title="Total Transaksi Perusahaan"
                                value={`${branchTotals.rangeTxCount} Transaksi`}
                                subtitle="Akumulasi Seluruh Cabang"
                                variant="glass"
                            />
                            <div 
                                onClick={() => openCouponUsageModal(selectedBranch, selectedBranch ? (branches.find(b => b.id === selectedBranch)?.name || 'Cabang Terpilih') : 'Semua Cabang')}
                                className="cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
                                title="Klik untuk rincian pemakaian kupon"
                            >
                                <StatCard
                                    title="Sesi Kupon Terpakai (Redeem)"
                                    value={`Rp ${(branchTotals.couponUsedValue || 0).toLocaleString('id-ID')}`}
                                    subtitle={`${branchTotals.couponUsedSessions || 0} Sesi Terpakai`}
                                    variant="glass"
                                />
                            </div>
                            <StatCard
                                title="Biaya Tambahan QRIS (0.3%)"
                                value={`Rp ${(branchTotals.qrisFee || 0).toLocaleString('id-ID')}`}
                                subtitle="Biaya MDR Layanan QRIS"
                                variant="glass"
                            />
                        </div>

                        {/* Ringkasan Metode Pembayaran Global */}
                        {paymentBreakdown.length > 0 && (
                            <div className="mt-5 pt-4 border-t border-white/15 flex flex-wrap items-center gap-3 text-xs font-semibold">
                                <span className="text-[10px] text-pink-200 uppercase font-bold tracking-widest">Sebaran Metode Bayar:</span>
                                {paymentBreakdown.map(p => (
                                    <span key={p.method} className="bg-white/10 px-3 py-1 rounded-xl border border-white/15 text-white flex items-center gap-1.5">
                                        <strong className="text-ayumi-accent">{p.method}:</strong> Rp {p.amount.toLocaleString('id-ID')} ({p.percent}%)
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* SECTION 1: PERBANDINGAN OMSET (TREATMENT & PRODUK) PER CABANG */}
                    <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
                        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.branchComparison ? '' : 'pb-4 border-b border-gray-200'}`}>
                            <div>
                                <div 
                                    onClick={() => toggleSection('branchComparison')}
                                    className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                                    title={collapsedSections.branchComparison ? "Buka modul" : "Lipat modul"}
                                >
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#B5588A] group-hover:bg-[#9c4372] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                                        <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.branchComparison ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-ayumi-primary transition-colors">
                                        Perbandingan Omset (Treatment & Produk) per Cabang
                                    </h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                                    Visualisasi perbandingan omset treatment dan produk antar cabang untuk rentang periode terpilih.
                                </p>
                            </div>

                            {/* Toolbar Kontrol: Rentang Waktu (DateRangePicker) */}
                            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                                <div className="flex flex-col gap-1 w-full sm:w-auto">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Rentang Waktu</span>
                                    <DateRangePicker
                                        startDate={startDate}
                                        endDate={endDate}
                                        onChange={({ startDate: s, endDate: e }) => {
                                            setStartDate(s)
                                            setEndDate(e)
                                        }}
                                        align="right"
                                        inputClassName="w-full sm:w-auto bg-pink-50 hover:bg-pink-100/70 text-ayumi-secondary border border-pink-200 font-extrabold text-xs px-3.5 py-2 rounded-2xl shadow-sm transition-colors cursor-pointer justify-between"
                                    />
                                </div>
                            </div>
                        </div>

                        {!collapsedSections.branchComparison ? (
                            <>
                                {/* Cards Breakdown Omset per Cabang */}
                                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4 pt-1">
                                    {branchDailyComparison.map(b => {
                                        const rows = [
                                            { key: 'treatment', label: 'Treatment', dot: 'bg-[#EC4899]', gross: b.treatmentGross || 0, redeem: b.treatmentRedeem || 0, net: b.treatmentIncome || 0 },
                                            { key: 'product', label: 'Produk', dot: 'bg-[#06B6D4]', gross: b.productGross || 0, redeem: b.productRedeem || 0, net: b.productIncome || 0 },
                                            { key: 'coupon', label: 'Penjualan Kupon', shortLabel: 'Kupon', dot: 'bg-emerald-500', gross: b.couponSalesGross || 0, redeem: b.couponSalesRedeem || 0, net: b.couponSalesIncome || 0 },
                                            { key: 'other', label: 'Lainnya', dot: 'bg-gray-400', gross: b.otherGross || 0, redeem: b.otherRedeem || 0, net: b.otherIncome || 0, optional: true }
                                        ].filter(row => !row.optional || row.gross !== 0 || row.net !== 0)
                                        const grossTotal = rows.reduce((acc, row) => acc + row.gross, 0)
                                        const redeemTotal = rows.reduce((acc, row) => acc + row.redeem, 0)
                                        const netTotal = rows.reduce((acc, row) => acc + row.net, 0)
                                        const rp = (n) => Math.round(n).toLocaleString('id-ID')
                                        // Tanda minus tipografis agar sejajar dengan angka; nilai 0 ditampilkan redup.
                                        const discCell = (n) => Math.round(n) > 0
                                            ? <span className="text-rose-600">−{rp(n)}</span>
                                            : <span className="text-gray-300">—</span>
                                        const redeemCell = (n) => Math.round(n) > 0
                                            ? <span className="text-amber-600">−{rp(n)}</span>
                                            : <span className="text-gray-300">—</span>
                                        const hasActivity = (b.transactionCount || 0) > 0 || (b.couponUsedSessions || 0) > 0
                                        return (
                                        <div key={b.branchId} className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 shadow-sm hover:shadow-md transition-all flex flex-col gap-3">
                                            <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-gray-100">
                                                <h4 className="font-extrabold text-base text-gray-900 truncate">{b.branchName}</h4>
                                                <span className="text-[11px] font-bold text-stone-600 bg-stone-100 rounded-full px-2.5 py-0.5 whitespace-nowrap">{b.transactionCount || 0} transaksi</span>
                                            </div>

                                            {hasActivity ? (
                                                <>
                                                    {/* Ukuran huruf & label mengikuti lebar kartu (container query), bukan lebar layar. */}
                                                    <div className="@container">
                                                    <table className="w-full table-fixed text-[10px] @md:text-[11.5px] @xl:text-[12.5px] tabular-nums">
                                                        <colgroup>
                                                            <col className="w-[25%] @md:w-[22%] @xl:w-[26%]" />
                                                            <col className="w-[19%] @md:w-[20%] @xl:w-[18%]" />
                                                            <col className="w-[19%] @xl:w-[18%]" />
                                                            <col className="w-[18%] @xl:w-[20%]" />
                                                            <col className="w-[19%] @md:w-[21%] @xl:w-[18%]" />
                                                        </colgroup>
                                                        <thead>
                                                            <tr className="text-[9.5px] @xl:text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gray-400">
                                                                <th className="text-left font-semibold pb-2">Kategori</th>
                                                                <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Kotor</th>
                                                                <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Diskon</th>
                                                                <th className="text-right font-semibold pb-2 pl-1 @md:pl-2 whitespace-nowrap" title="Redeem Kupon: nilai sesi kupon yang dipakai; sudah dibayar saat paket dijual">
                                                                    <span className="inline-flex items-center gap-1 text-amber-600/80">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                                                                        <span className="@xl:hidden">Redeem</span>
                                                                        <span className="hidden @xl:inline">Redeem Kupon</span>
                                                                    </span>
                                                                </th>
                                                                <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Bersih</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rows.map(row => (
                                                                <tr key={row.key} className="border-t border-gray-100">
                                                                    <td className="py-2.5 pr-2 font-semibold text-gray-800">
                                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                                            <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`}></span>
                                                                            {row.shortLabel ? (
                                                                                <span className="truncate"><span className="@xl:hidden">{row.shortLabel}</span><span className="hidden @xl:inline">{row.label}</span></span>
                                                                            ) : (
                                                                                <span className="truncate">{row.label}</span>
                                                                            )}
                                                                        </span>
                                                                    </td>
                                                                    <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium text-gray-600 whitespace-nowrap">{rp(row.gross)}</td>
                                                                    <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium whitespace-nowrap">{discCell(row.gross - row.net - row.redeem)}</td>
                                                                    <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium whitespace-nowrap">{redeemCell(row.redeem)}</td>
                                                                    <td className="py-2.5 pl-1 @md:pl-2 text-right font-bold text-gray-900 whitespace-nowrap">{rp(row.net)}</td>
                                                                </tr>
                                                            ))}
                                                            <tr className="border-t border-gray-300">
                                                                <td className="pt-3 font-bold text-gray-900">Total</td>
                                                                <td className="pt-3 pl-1 @md:pl-2 text-right font-bold text-gray-800 whitespace-nowrap">{rp(grossTotal)}</td>
                                                                <td className="pt-3 pl-1 @md:pl-2 text-right font-bold whitespace-nowrap">{discCell(grossTotal - netTotal - redeemTotal)}</td>
                                                                <td className="pt-3 pl-1 @md:pl-2 text-right font-bold whitespace-nowrap">{redeemCell(redeemTotal)}</td>
                                                                <td className="pt-3 pl-1 @md:pl-2 text-right font-extrabold text-[#5c3316] whitespace-nowrap">{rp(netTotal)}</td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                    </div>

                                                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                                                        <span
                                                            className="text-[10px] text-gray-400 font-medium"
                                                            title="Treatment termasuk infus. Diskon termasuk bonus gratis. Redeem kupon = sesi kupon yang dipakai; uangnya diterima saat paket dijual."
                                                        >
                                                            Kotor − Diskon − Redeem Kupon = Bersih
                                                        </span>
                                                        {(b.couponUsedSessions || 0) > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => openCouponUsageModal(b.branchId, b.branchName)}
                                                                className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-full px-2.5 py-0.5 transition-colors cursor-pointer"
                                                                title="Rincian sesi kupon yang dipakai pada periode ini"
                                                            >
                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                                {b.couponUsedSessions} sesi kupon dipakai · Rincian ↗
                                                            </button>
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi pada periode ini.</p>
                                            )}

                                            <div className="mt-auto pt-3 border-t border-gray-100 flex justify-between items-center gap-3">
                                                <div>
                                                    <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Total Omset Cabang</p>
                                                    <p className="text-lg font-black text-[#5c3316] tracking-tight tabular-nums leading-tight">
                                                        Rp {rp(b.cashIncome || 0)}
                                                    </p>
                                                </div>
                                                {(b.qrisFee || 0) > 0 && (
                                                    <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 whitespace-nowrap" title="Omset sudah dikurangi biaya layanan QRIS">
                                                        Biaya QRIS −Rp {rp(b.qrisFee)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )})}
                                </div>

                                {/* Recharts Bar Chart Grouped */}
                                <div className="pt-4 sm:pt-6 border-t border-gray-100">
                                    <div className="h-64 sm:h-72 w-full">
                                        {isMounted && branchDailyComparison.length > 0 ? (
                                            <LazyRecharts render={(R) => (
                                            <R.ResponsiveContainer width="100%" height="100%">
                                                <R.BarChart 
                                                    data={branchDailyComparison} 
                                                    barGap={4} 
                                                    barCategoryGap="18%"
                                                    margin={{ top: 15, right: 10, left: 0, bottom: 20 }}
                                                >
                                                    <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                    <R.XAxis 
                                                        dataKey="branchName" 
                                                        interval={0}
                                                        tickFormatter={(val) => (val ? val.replace(/^Ayumi\s+/i, '') : val)}
                                                        tick={{ fontSize: 10, fontWeight: 700, fill: '#1e293b' }} 
                                                        axisLine={{ stroke: '#cbd5e1' }}
                                                        tickLine={false} 
                                                    />
                                                    <R.YAxis 
                                                        width={42}
                                                        tickFormatter={(val) => {
                                                            if (val === 0) return '0'
                                                            if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.0', '') + ' Jt'
                                                            if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                            return val
                                                        }}
                                                        tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
                                                        axisLine={false}
                                                        tickLine={false} 
                                                    />
                                                    <R.Tooltip 
                                                        formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                                        itemSorter={(item) => (item.name.includes('Treatment') ? -1 : 1)}
                                                        labelStyle={{ fontWeight: 'bold', color: '#5c3316', fontSize: '13px' }}
                                                        contentStyle={{ borderRadius: '16px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #f472b6', padding: '10px 14px' }}
                                                    />
                                                    <R.Legend 
                                                        verticalAlign="top" 
                                                        align="center"
                                                        wrapperStyle={{ paddingTop: '0px', paddingBottom: '12px', fontWeight: '800', fontSize: '12px', color: '#0f172a' }} 
                                                    />
                                                    <R.Bar dataKey="treatmentIncome" name="Omset Treatment" fill="#EC4899" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                                    <R.Bar dataKey="productIncome" name="Omset Produk" fill="#06B6D4" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                                    <R.Bar dataKey="couponSalesIncome" name="Penjualan Kupon" fill="#10B981" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                                    <R.Bar dataKey="couponUsedValue" name="Pemakaian Sesi" fill="#F59E0B" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                                </R.BarChart>
                                            </R.ResponsiveContainer>
                                            )} />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                                                Mengambil data cabang...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        ) : null}
            </div>

                    {/* SECTION 2: MONITORING TARGET BULANAN PER CABANG */}
                    <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-6 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
                        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 ${collapsedSections.targetMonitoring ? '' : 'pb-4 border-b border-gray-200'}`}>
                            <div>
                                <div 
                                    onClick={() => toggleSection('targetMonitoring')}
                                    className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                                    title={collapsedSections.targetMonitoring ? "Buka modul" : "Lipat modul"}
                                >
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-orange-500 group-hover:bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                                        <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.targetMonitoring ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-orange-600 transition-colors">
                                        Monitoring Target Bulanan per Cabang
                                    </h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                                    Pantau persentase pencapaian omset bulan ini dibanding target operasional tiap cabang.
                                </p>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                                <button
                                    type="button"
                                    onClick={handleOpenTargetModal}
                                    className="flex items-center gap-1.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white text-xs font-bold px-3.5 py-2 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer"
                                >
                                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    <span>Atur Target</span>
                                </button>

                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                                        className="flex items-center gap-2 bg-pink-50 hover:bg-pink-100/80 text-ayumi-primary border border-pink-200 text-xs font-extrabold px-3.5 py-2 rounded-2xl shadow-sm transition-all cursor-pointer"
                                    >
                                        <svg className="w-4 h-4 text-ayumi-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        <span>Periode: {currentMonthLabel}</span>
                                        <svg className={`w-3.5 h-3.5 text-ayumi-primary transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {isMonthPickerOpen && (
                                        <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-pink-150 shadow-2xl p-4 z-50 space-y-3">
                                            {/* Header Year Switcher */}
                                            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                                <button
                                                    type="button"
                                                    onClick={() => setPickerYear(prev => prev - 1)}
                                                    className="p-1.5 hover:bg-pink-50 text-ayumi-primary rounded-xl transition-colors font-bold flex items-center justify-center cursor-pointer"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                                </button>
                                                <span className="font-black text-gray-800 text-sm tracking-tight">{pickerYear}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setPickerYear(prev => prev + 1)}
                                                    className="p-1.5 hover:bg-pink-50 text-ayumi-primary rounded-xl transition-colors font-bold flex items-center justify-center cursor-pointer"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                                </button>
                                            </div>

                                            {/* 12 Months Grid */}
                                            <div className="grid grid-cols-3 gap-2">
                                                {shortMonthNames.map((mName, idx) => {
                                                    const monthVal = `${pickerYear}-${String(idx + 1).padStart(2, '0')}`
                                                    const isSelected = targetMonth === monthVal

                                                    return (
                                                        <button
                                                            key={idx}
                                                            type="button"
                                                            onClick={() => {
                                                                setTargetMonth(monthVal)
                                                                setIsMonthPickerOpen(false)
                                                            }}
                                                            className={`
                                                                py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center
                                                                ${isSelected 
                                                                    ? 'bg-ayumi-primary text-white shadow-md shadow-pink-500/20 font-black' 
                                                                    : 'bg-gray-50 hover:bg-pink-50 text-gray-700 hover:text-ayumi-primary'}
                                                            `}
                                                        >
                                                            {mName}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {!collapsedSections.targetMonitoring ? (
                            <>
                                {/* Akumulasi Global Perusahaan */}
                                {branchTotals.monthlyTarget > 0 && (
                            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Ringkasan Target Perusahaan (Treatment & Kupon)</p>
                                        <p className="text-sm font-extrabold text-gray-900 mt-0.5">
                                            Total Capaian: <span className="text-emerald-700 font-bold">Rp {(branchTotals.monthlyTargetIncome || 0).toLocaleString('id-ID')}</span> <span className="text-gray-500 font-normal text-xs">/ Rp {branchTotals.monthlyTarget.toLocaleString('id-ID')}</span>
                                        </p>
                                        <div className="flex flex-wrap gap-x-4 text-xs font-bold mt-1">
                                            {(branchTotals.couponSalesIncome || 0) > 0 && (
                                                <span className="text-emerald-700">
                                                    🎟️ Penjualan Kupon: Rp {(branchTotals.couponSalesIncome || 0).toLocaleString('id-ID')}
                                                </span>
                                            )}
                                            {(branchTotals.couponUsedSessions || 0) > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => openCouponUsageModal('', 'Semua Cabang')}
                                                    className="text-amber-800 hover:text-amber-900 bg-amber-100/80 hover:bg-amber-200 px-2 py-0.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
                                                    title="Lihat rincian orang & pemakaian sesi kupon"
                                                >
                                                    <span>🎟️ Pemakaian Sesi: <strong>{(branchTotals.couponUsedSessions || 0)} Sesi</strong> {(branchTotals.couponUsedValue || 0) > 0 ? `(Valuasi: Rp ${(branchTotals.couponUsedValue || 0).toLocaleString('id-ID')})` : ''}</span>
                                                    <span className="text-[10px] bg-amber-200 text-amber-800 font-black px-1.5 py-0.5 rounded">Rincian ↗</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-amber-200/80 pt-3 md:pt-0 md:pl-5 shrink-0">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Pencapaian Global</p>
                                        <p className="text-base font-extrabold text-amber-900">
                                            {branchTotals.monthlyTarget > 0 ? (((branchTotals.monthlyTargetIncome || 0) / branchTotals.monthlyTarget) * 100).toFixed(1) : 0}%
                                        </p>
                                    </div>
                                    <div className="w-32 h-2.5 bg-amber-200/60 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-amber-600 rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(100, Math.max(0, branchTotals.monthlyTarget > 0 ? (((branchTotals.monthlyTargetIncome || 0) / branchTotals.monthlyTarget) * 100) : 0))}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Grid Cards Target per Cabang */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
                            {branchMonthlyTargetData.map(item => {
                                const rawPct = Number(item.rawPercent || 0)

                                let barColor = 'bg-rose-500'
                                let badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200'

                                if (rawPct >= 100) {
                                    barColor = 'bg-emerald-600'
                                    badgeStyle = 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                } else if (rawPct >= 50) {
                                    barColor = 'bg-amber-500'
                                    badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200'
                                }

                                return (
                                    <div key={item.branchId} className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 shadow-sm space-y-3 transition-all group">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="font-extrabold text-base text-gray-900">{item.branchName}</h4>
                                                <p className="text-xs text-gray-500 font-semibold mt-0.5">Target Operasional (Treatment & Kupon)</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-3 py-1 rounded-lg border ${badgeStyle}`}>
                                                    {rawPct >= 100 ? `${rawPct.toFixed(1)}% (Tercapai)` : `${rawPct.toFixed(1)}%`}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={handleOpenTargetModal}
                                                    title="Edit Target Cabang"
                                                    className="p-1.5 text-gray-400 hover:text-ayumi-primary hover:bg-pink-50 rounded-lg transition-colors cursor-pointer"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Progress Bar & Values */}
                                        <div className="space-y-1.5 pt-1">
                                            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full ${barColor} rounded-full transition-all duration-500`}
                                                    style={{ width: `${Math.min(100, Math.max(0, rawPct))}%` }}
                                                ></div>
                                            </div>
                                            <div className="flex justify-between items-center text-xs pt-1">
                                                <span className="text-gray-600 font-semibold">Pencapaian: <strong className="text-emerald-700 font-bold">Rp {item.monthlyIncome.toLocaleString('id-ID')}</strong></span>
                                                <span className="text-gray-600 font-semibold">Target: <strong className="text-gray-900 font-bold">Rp {item.monthlyTarget.toLocaleString('id-ID')}</strong></span>
                                            </div>
                                            {item.monthlyQrisFee > 0 && (
                                                <div className="flex justify-between items-center text-[10px] text-gray-400 font-medium pt-0.5">
                                                    <span>Biaya Tambahan QRIS (0.3%):</span>
                                                    <span className="font-bold text-violet-700">Rp {item.monthlyQrisFee.toLocaleString('id-ID')}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Stat Footer */}
                                        <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs font-medium">
                                            {rawPct >= 100 ? (
                                                <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                                                    <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                                    Target Tercapai (Surplus: <strong className="text-emerald-800 font-bold">Rp {item.surplusTarget.toLocaleString('id-ID')}</strong>)
                                                </span>
                                            ) : (
                                                <span className="text-gray-600 font-semibold flex items-center justify-between w-full">
                                                    <span>Sisa Kekurangan:</span>
                                                    <strong className="text-rose-700 font-bold">Rp {item.remainingTarget.toLocaleString('id-ID')}</strong>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </>
                ) : null}
            </div>

                    {/* Pilihan cabang untuk seluruh bagian analisis di bawah */}
                    <div ref={analysisPillRef} className="flex justify-center">
                        <AnalysisBranchPill branches={branchDailyComparison} activeBranch={analysisBranch} onSelect={selectAnalysisBranch} />
                    </div>
                    {analysisPillDocked && typeof document !== 'undefined' && document.getElementById('header-center-slot')
                        ? createPortal(
                            <AnalysisBranchPill branches={branchDailyComparison} activeBranch={analysisBranch} onSelect={selectAnalysisBranch} inHeader />,
                            document.getElementById('header-center-slot')
                        )
                        : null}

                    {/* SECTION 3: TOP & BOTTOM TREATMENT & TOP PRODUK */}
                    <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
                        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.topBottom ? '' : 'pb-4 border-b border-gray-200'}`}>
                            <div>
                                <div 
                                    onClick={() => toggleSection('topBottom')}
                                    className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                                    title={collapsedSections.topBottom ? "Buka modul" : "Lipat modul"}
                                >
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#B5588A] group-hover:bg-[#9c4372] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                                        <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.topBottom ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-ayumi-primary transition-colors">
                                        Peringkat Layanan & Produk Terlaris vs Evaluasi Terendah
                                    </h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                                    Peringkat 5 teratas treatment dan produk skincare paling laris, serta treatment dengan peminat terendah untuk evaluasi promo.
                                </p>
                            </div>
                        </div>

                        {!collapsedSections.topBottom ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 pt-1">
                                {/* 1. Top 5 Treatment Terfavorit */}
                                <div className="p-5 sm:p-6 bg-stone-50/60 border border-pink-100/90 rounded-2xl sm:rounded-3xl space-y-4">
                                    <div className="flex items-center gap-3 pb-3 border-b border-pink-100">
                                        <div className="w-9 h-9 rounded-2xl bg-pink-100/80 text-[#B5588A] flex items-center justify-center shrink-0 shadow-inner">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                        </div>
                                        <div>
                                            <h3 className="text-base font-extrabold text-gray-900">Top Perawatan (Treatment)</h3>
                                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Layanan paling banyak diminati periode ini.</p>
                                        </div>
                                    </div>
                                    <div className="space-y-2.5">
                                        {topTreatments.length === 0 ? (
                                            <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi treatment pada periode ini.</p>
                                        ) : (
                                            topTreatments.map((t, idx) => (
                                                <div key={t.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-pink-100 hover:border-pink-200 transition-colors shadow-2xs">
                                                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                        <span className="w-6 h-6 rounded-xl bg-pink-100 text-[#B5588A] font-black text-xs flex items-center justify-center shrink-0">
                                                            #{idx + 1}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <p className="font-extrabold text-xs text-gray-900 truncate">{t.name}</p>
                                                            <p className="text-[10px] font-semibold text-gray-500 mt-0.5">{t.count} Sesi Terjual</p>
                                                        </div>
                                                    </div>
                                                    <span className="font-extrabold text-xs text-[#B5588A] tracking-tight shrink-0">
                                                        Rp {t.revenue.toLocaleString('id-ID')}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* 2. Top 5 Produk Terlaris */}
                                <div className="p-5 sm:p-6 bg-stone-50/60 border border-cyan-100/90 rounded-2xl sm:rounded-3xl space-y-4">
                                    <div className="flex items-center gap-3 pb-3 border-b border-cyan-100">
                                        <div className="w-9 h-9 rounded-2xl bg-cyan-100/80 text-[#06B6D4] flex items-center justify-center shrink-0 shadow-inner">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                        </div>
                                        <div>
                                            <h3 className="text-base font-extrabold text-gray-900">Top Penjualan Produk</h3>
                                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Produk skincare paling laris periode ini.</p>
                                        </div>
                                    </div>
                                    <div className="space-y-2.5">
                                        {topProducts.length === 0 ? (
                                            <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada penjualan produk pada periode ini.</p>
                                        ) : (
                                            topProducts.map((p, idx) => (
                                                <div key={p.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-cyan-100 hover:border-cyan-200 transition-colors shadow-2xs">
                                                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                        <span className="w-6 h-6 rounded-xl bg-cyan-100 text-[#06B6D4] font-black text-xs flex items-center justify-center shrink-0">
                                                            #{idx + 1}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <p className="font-extrabold text-xs text-gray-900 truncate">{p.name}</p>
                                                            <p className="text-[10px] font-semibold text-gray-500 mt-0.5">{p.count} Unit Terjual</p>
                                                        </div>
                                                    </div>
                                                    <span className="font-extrabold text-xs text-[#06B6D4] tracking-tight shrink-0">
                                                        Rp {p.revenue.toLocaleString('id-ID')}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* 3. Perawatan (Treatment) Terendah - Evaluasi Promo (Khusus Owner) */}
                                <div className="p-5 sm:p-6 bg-stone-50/60 border border-amber-150 rounded-2xl sm:rounded-3xl space-y-4">
                                    <div className="flex items-center gap-3 pb-3 border-b border-amber-200/80">
                                        <div className="w-9 h-9 rounded-2xl bg-amber-100/80 text-amber-700 flex items-center justify-center shrink-0 shadow-inner">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <h3 className="text-base font-extrabold text-gray-900">Treatment Terendah</h3>
                                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                    Evaluasi
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Layanan paling sedikit diminati (perlu promo).</p>
                                        </div>
                                    </div>
                                    <div className="space-y-2.5">
                                        {bottomTreatments.length === 0 ? (
                                            <p className="text-xs text-gray-400 font-medium py-6 text-center">Data treatment tidak mencukupi untuk evaluasi.</p>
                                        ) : (
                                            bottomTreatments.map((t, idx) => (
                                                <div key={t.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-amber-200/70 hover:border-amber-300 transition-colors shadow-2xs">
                                                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                        <span className="w-6 h-6 rounded-xl bg-amber-100 text-amber-800 font-black text-xs flex items-center justify-center shrink-0">
                                                            #{idx + 1}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <p className="font-extrabold text-xs text-gray-900 truncate">{t.name}</p>
                                                            <p className="text-[10px] font-semibold text-amber-800/80 mt-0.5">{t.count} Sesi Terjual</p>
                                                        </div>
                                                    </div>
                                                    <span className="font-extrabold text-xs text-amber-900 tracking-tight shrink-0">
                                                        Rp {t.revenue.toLocaleString('id-ID')}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {/* SECTION 4: SALES INSIGHTS (HARI & JAM TERAMAI) - OWNER ONLY */}
                    <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
                        {/* Section Header with Metric Toggle */}
                        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.salesInsights ? '' : 'pb-4 border-b border-gray-200'}`}>
                            <div>
                                <div 
                                    onClick={() => toggleSection('salesInsights')}
                                    className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                                    title={collapsedSections.salesInsights ? "Buka modul" : "Lipat modul"}
                                >
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-orange-500 group-hover:bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                                        <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.salesInsights ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-orange-600 transition-colors">
                                        Sales Insights: Pola Waktu Penjualan Teramai
                                    </h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                                    Analisis transaksi harian dan jam operasional sibuk untuk optimasi jadwal kerja dan promo klinik.
                                </p>
                            </div>

                            <div className="flex items-center gap-1.5 p-1 bg-stone-100 border border-stone-200 rounded-2xl shrink-0 self-start sm:self-auto">
                                <button
                                    type="button"
                                    onClick={() => setSalesInsightMetric('sales')}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                        salesInsightMetric === 'sales'
                                            ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                            : 'text-stone-500 hover:text-stone-800'
                                    }`}
                                >
                                    Nominal Omset (Rp)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSalesInsightMetric('count')}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                        salesInsightMetric === 'count'
                                            ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                            : 'text-stone-500 hover:text-stone-800'
                                    }`}
                                >
                                    Volume Transaksi (Trx)
                                </button>
                            </div>
                        </div>

                        {!collapsedSections.salesInsights ? (
                            /* Two Charts: Day of the Week & Hourly Sales */
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
                                {/* 1. Day of the Week */}
                                <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-extrabold text-sm text-gray-900">
                                                Penjualan Berdasarkan Hari (Day of the Week)
                                            </h4>
                                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                                Akumulasi aktivitas transaksi Senin s/d Minggu
                                            </p>
                                        </div>
                                        {dayOfWeekStats.length > 0 && (
                                            <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                                Puncak: {
                                                    salesInsightMetric === 'sales'
                                                        ? dayOfWeekStats.reduce((max, d) => (d.sales > (max?.sales || 0) ? d : max), dayOfWeekStats[0])?.day
                                                        : dayOfWeekStats.reduce((max, d) => (d.count > (max?.count || 0) ? d : max), dayOfWeekStats[0])?.day
                                                }
                                            </span>
                                        )}
                                    </div>
                                    <div className="h-60 sm:h-64 w-full pt-2">
                                        {isMounted && dayOfWeekStats.length > 0 ? (
                                            <LazyRecharts render={(R) => (
                                            <R.ResponsiveContainer width="100%" height="100%">
                                                <R.BarChart data={dayOfWeekStats} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                                                    <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                    <R.XAxis dataKey="day" tick={{ fontSize: 11, fontWeight: 700, fill: '#334155' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                                                    <R.YAxis 
                                                        width={salesInsightMetric === 'sales' ? 45 : 30}
                                                        tickFormatter={(val) => {
                                                            if (salesInsightMetric === 'sales') {
                                                                if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                                                if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                                return val
                                                            }
                                                            return val
                                                        }}
                                                        tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} 
                                                    />
                                                    <R.Tooltip 
                                                        formatter={(value) => [
                                                            salesInsightMetric === 'sales'
                                                                ? 'Rp ' + Number(value).toLocaleString('id-ID')
                                                                : `${value} Transaksi`,
                                                            salesInsightMetric === 'sales' ? 'Omset Kotor' : 'Volume'
                                                        ]}
                                                        contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #fdba74' }}
                                                    />
                                                    <R.Bar 
                                                        dataKey={salesInsightMetric === 'sales' ? 'sales' : 'count'} 
                                                        fill="#f97316" 
                                                        radius={[6, 6, 0, 0]} 
                                                        maxBarSize={36} 
                                                    />
                                                </R.BarChart>
                                            </R.ResponsiveContainer>
                                            )} />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat data harian...</div>
                                        )}
                                    </div>
                                </div>

                                {/* 2. Hourly Sales Amount */}
                                <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-extrabold text-sm text-gray-900">
                                                Jam Sibuk Penjualan (Hourly Sales)
                                            </h4>
                                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                                Distribusi keramaian transaksi jam 08:00 - 21:00
                                            </p>
                                        </div>
                                        {hourlyStats.length > 0 && (
                                            <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                                Puncak: {
                                                    salesInsightMetric === 'sales'
                                                        ? hourlyStats.reduce((max, h) => (h.sales > (max?.sales || 0) ? h : max), hourlyStats[0])?.hour
                                                        : hourlyStats.reduce((max, h) => (h.count > (max?.count || 0) ? h : max), hourlyStats[0])?.hour
                                                }
                                            </span>
                                        )}
                                    </div>
                                    <div className="h-60 sm:h-64 w-full pt-2">
                                        {isMounted && hourlyStats.length > 0 ? (
                                            <LazyRecharts render={(R) => (
                                            <R.ResponsiveContainer width="100%" height="100%">
                                                <R.BarChart data={hourlyStats} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                                                    <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                    <R.XAxis dataKey="hour" tick={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                                                    <R.YAxis 
                                                        width={salesInsightMetric === 'sales' ? 45 : 30}
                                                        tickFormatter={(val) => {
                                                            if (salesInsightMetric === 'sales') {
                                                                if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                                                if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                                return val
                                                            }
                                                            return val
                                                        }}
                                                        tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} 
                                                    />
                                                    <R.Tooltip 
                                                        formatter={(value) => [
                                                            salesInsightMetric === 'sales'
                                                                ? 'Rp ' + Number(value).toLocaleString('id-ID')
                                                                : `${value} Transaksi`,
                                                            salesInsightMetric === 'sales' ? 'Omset Kotor' : 'Volume'
                                                        ]}
                                                        contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #fdba74' }}
                                                    />
                                                    <R.Bar 
                                                        dataKey={salesInsightMetric === 'sales' ? 'sales' : 'count'} 
                                                        fill="#ea580c" 
                                                        radius={[5, 5, 0, 0]} 
                                                        maxBarSize={22} 
                                                    />
                                                </R.BarChart>
                                            </R.ResponsiveContainer>
                                            )} />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat data jam sibuk...</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {/* SECTION 5: ANALISIS PENJUALAN PER KATEGORI (CATEGORY ANALYTICS) - OWNER ONLY */}
                    <CategoryAnalyticsSection
                        categorySalesStats={categorySalesStats}
                        categoryVolumeStats={categoryVolumeStats}
                        collapsedSections={collapsedSections}
                        isMounted={isMounted}
                        selectedCategoryTab={selectedCategoryTab}
                        setSelectedCategoryTab={setSelectedCategoryTab}
                        setShowAllCategoryItems={setShowAllCategoryItems}
                        showAllCategoryItems={showAllCategoryItems}
                        toggleSection={toggleSection}
                    />

                    {/* SECTION 6: DEMOGRAFI & RETENSI PELANGGAN (CUSTOMER INTELLIGENCE) - OWNER ONLY */}
                    <CustomerIntelligenceSection
                        collapsedSections={collapsedSections}
                        demographicAge={demographicAge}
                        demographicGender={demographicGender}
                        isMounted={isMounted}
                        retentionStats={retentionStats}
                        retentionTab={retentionTab}
                        setRetentionTab={setRetentionTab}
                        toggleSection={toggleSection}
                    />
                </div>
            ) : (
                /* ========================================================================= */
                /* DASHBOARD ADMIN CABANG                                                    */
                /* ========================================================================= */
                <div className="space-y-6">
                    {/* 1. HEADER & AKSI CEPAT */}
            <div className="relative overflow-hidden rounded-3xl border border-[#f0d9c8] bg-gradient-to-br from-[#fff8f3] via-[#fbe9dc] to-[#f4d3bd] p-5 sm:p-7 shadow-sm">
                <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/40 blur-3xl"></div>
                <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 left-1/3 w-72 h-72 rounded-full bg-[#e8b598]/25 blur-3xl"></div>

                <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-5">
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#5c3316] text-white text-[10.5px] font-black uppercase tracking-[0.12em]">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                {userBranchName}
                            </span>
                            <span className="px-2.5 py-1 rounded-full bg-white/70 border border-[#e9c9b3] text-[#7a4424] text-[10.5px] font-bold uppercase tracking-[0.12em]">
                                {dbUser?.role === 'admin' ? 'Admin Cabang' : (dbUser?.role || 'Portal')}
                            </span>
                        </div>
                        <h1 className="text-2xl sm:text-[1.7rem] font-extrabold text-[#3d1f0b] tracking-tight leading-tight">
                            {dbUser?.full_name ? `Halo, ${dbUser.full_name.split(' ')[0]}` : 'Ringkasan Operasional & Omset'}
                        </h1>
                        <p className="text-sm text-[#7a5a45] font-medium max-w-xl">
                            Ringkasan omset, target, dan layanan terlaris cabang {userBranchName.replace(/^Ayumi\s+/i, '')} untuk periode yang dipilih.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
                        <DateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onChange={({ startDate: s, endDate: e }) => {
                                setStartDate(s)
                                setEndDate(e)
                            }}
                            align="right"
                            inputClassName="bg-white/80 hover:bg-white text-[#3d1f0b] border border-[#e9c9b3] font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-none transition-colors cursor-pointer justify-between"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => router.push('/appointments')}
                                className="flex-1 sm:flex-none px-3.5 py-2.5 bg-white/80 hover:bg-white text-[#5c3316] border border-[#e9c9b3] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                Janji Temu
                            </button>
                            <button
                                onClick={() => router.push('/treatment-records')}
                                className="flex-1 sm:flex-none px-3.5 py-2.5 bg-white/80 hover:bg-white text-[#5c3316] border border-[#e9c9b3] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Rekam Medis
                            </button>
                            <button
                                onClick={() => router.push('/kasir')}
                                className="flex-1 sm:flex-none px-4 py-2.5 bg-[#5c3316] hover:bg-[#43230c] text-white rounded-xl text-xs font-extrabold transition-all shadow-md shadow-[#5c3316]/25 hover:-translate-y-0.5 flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                                Buka Kasir
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. RINGKASAN PENDAPATAN (5 KPI) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {[
                    {
                        key: 'income',
                        label: 'Pendapatan',
                        value: branchTotals.rangeIncome,
                        badge: `${branchTotals.rangeTxCount} Transaksi`,
                        caption: 'Penerimaan kasir periode ini',
                        onClick: () => router.push('/transactions'),
                        tone: { icon: 'relative bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/25 from-[#a0582c] to-[#4a2410] shadow-[#5c3316]/30', badge: 'bg-[#fbeee4] text-[#7a4424] border-[#efd3bf]', ring: 'hover:border-[#d9ad8f]' },
                        icon: <><path d="M19 7V4.5A1.5 1.5 0 0017.5 3H5a2 2 0 000 4h15a1 1 0 011 1v3.5" /><path d="M3 5v14a2 2 0 002 2h15a1 1 0 001-1v-3.5" /><path d="M21 11.5h-3.5a2.25 2.25 0 000 4.5H21a.5.5 0 00.5-.5v-3.5a.5.5 0 00-.5-.5z" /><circle cx="17.6" cy="13.75" r=".6" fill="currentColor" /></>
                    },
                    {
                        key: 'treatment',
                        label: 'Layanan Treatment',
                        value: branchTotals.treatmentIncome,
                        badge: adminCompositionData.total > 0 ? `${Math.round((branchTotals.treatmentIncome / adminCompositionData.total) * 100)}% omset` : 'Tindakan',
                        caption: 'Nilai bersih layanan perawatan',
                        onClick: () => router.push('/reports/treatments'),
                        tone: { icon: 'relative bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/25 from-pink-400 to-rose-600 shadow-pink-500/30', badge: 'bg-pink-50 text-pink-700 border-pink-200/80', ring: 'hover:border-pink-300' },
                        icon: <><path d="M9.94 15.5a2 2 0 00-1.44-1.44l-6.13-1.58a.5.5 0 010-.96L8.5 9.94A2 2 0 009.94 8.5l1.58-6.14a.5.5 0 01.96 0l1.58 6.14a2 2 0 001.44 1.44l6.14 1.58a.5.5 0 010 .96l-6.14 1.58a2 2 0 00-1.44 1.44l-1.58 6.14a.5.5 0 01-.96 0z" /><path d="M20 3v4M22 5h-4M4 17v2M5 18H3" /></>
                    },
                    {
                        key: 'product',
                        label: 'Produk Skincare',
                        value: branchTotals.productIncome,
                        badge: adminCompositionData.total > 0 ? `${Math.round((branchTotals.productIncome / adminCompositionData.total) * 100)}% omset` : 'Produk',
                        caption: 'Penjualan skincare & kosmetik',
                        onClick: () => router.push('/transactions'),
                        tone: { icon: 'relative bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/25 from-cyan-400 to-sky-600 shadow-cyan-500/30', badge: 'bg-cyan-50 text-cyan-800 border-cyan-200/80', ring: 'hover:border-cyan-300' },
                        icon: <><path d="M10.5 2.5h3v3.5h-3z" /><path d="M13.5 3.5H17l1 1.5" /><path d="M8.5 6h7A2.5 2.5 0 0118 8.5V19a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 016 19V8.5A2.5 2.5 0 018.5 6z" /><path d="M9 11.5h6v5.5H9z" /><path d="M11 14.25h2" /></>
                    },
                    {
                        key: 'coupon',
                        label: 'Sesi Kupon Terpakai',
                        value: branchTotals.couponUsedValue,
                        badge: `${branchTotals.couponUsedSessions || 0} Sesi`,
                        caption: 'Nilai sesi kupon yang diklaim · lihat rincian',
                        onClick: () => openCouponUsageModal(isOwner ? selectedBranch : dbUser?.branch_id, userBranchName),
                        tone: { icon: 'relative bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/25 from-amber-400 to-orange-500 shadow-amber-500/30', badge: 'bg-amber-50 text-amber-800 border-amber-200/80', ring: 'hover:border-amber-300' },
                        icon: <><path d="M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2z" /><path d="M13 5v2M13 11v2M13 17v2" /><path d="M6.5 10.5l1 .8 1.5-2" /></>
                    },
                    {
                        key: 'qris',
                        label: 'Biaya QRIS',
                        value: branchTotals.qrisFee,
                        badge: '0,3% MDR',
                        caption: 'Biaya layanan QRIS periode ini',
                        onClick: () => router.push('/transactions'),
                        tone: { icon: 'relative bg-gradient-to-br text-white shadow-md ring-1 ring-inset ring-white/25 from-violet-400 to-indigo-600 shadow-violet-500/30', badge: 'bg-violet-50 text-violet-800 border-violet-200/80', ring: 'hover:border-violet-300' },
                        icon: <><rect x="3" y="3" width="6.5" height="6.5" rx="1.5" /><rect x="14.5" y="3" width="6.5" height="6.5" rx="1.5" /><rect x="3" y="14.5" width="6.5" height="6.5" rx="1.5" /><path d="M5.75 5.75h1M17.25 5.75h1M5.75 17.25h1" /><path d="M14.5 14.5h2.5v2.5M21 14.5v.01M14.5 21h2.5M21 18v3h-2" /></>
                    }
                ].map(card => (
                    <button
                        key={card.key}
                        type="button"
                        onClick={card.onClick}
                        className={`group text-left p-5 rounded-2xl bg-white border border-stone-200/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md cursor-pointer flex flex-col justify-between gap-4 ${card.tone.ring}`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3 ${card.tone.icon}`}>
                                <span aria-hidden="true" className="absolute inset-x-1.5 top-1 h-1/2 rounded-t-xl bg-gradient-to-b from-white/30 to-transparent"></span>
                                <svg className="relative w-[22px] h-[22px] drop-shadow-sm" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">{card.icon}</svg>
                            </span>
                            <span className={`text-[10.5px] font-bold border px-2 py-0.5 rounded-full whitespace-nowrap ${card.tone.badge}`}>
                                {card.badge}
                            </span>
                        </div>
                        <div>
                            <p className="text-[10.5px] font-bold text-stone-500 uppercase tracking-[0.12em]">{card.label}</p>
                            <p className="text-xl 2xl:text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums mt-1 break-words">
                                Rp {Number(card.value || 0).toLocaleString('id-ID')}
                            </p>
                            <p className="text-[11px] text-stone-500 font-medium mt-1">{card.caption}</p>
                        </div>
                    </button>
                ))}
            </div>

            {/* 3. TARGET BULANAN & KOMPOSISI OMSET */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Target Bulanan Cabang */}
                <div className="lg:col-span-2 p-6 bg-white border border-stone-200/80 rounded-3xl shadow-sm flex flex-col gap-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[10.5px] font-bold text-stone-500 uppercase tracking-[0.12em]">Target Bulanan</p>
                            <h3 className="text-base font-extrabold text-stone-900 mt-0.5">Pencapaian {currentMonthLabel}</h3>
                            <p className="text-[11px] text-stone-500 font-medium mt-0.5">Dari omset treatment + penjualan kupon</p>
                        </div>

                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                                className="px-3 py-1.5 rounded-xl bg-stone-50 border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors whitespace-nowrap"
                            >
                                {currentMonthLabel} ▾
                            </button>

                            {isMonthPickerOpen && (
                                <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl border border-stone-200 shadow-xl p-3 z-50 space-y-2">
                                    <div className="flex items-center justify-between pb-1.5 border-b border-stone-100">
                                        <button
                                            type="button"
                                            onClick={() => setPickerYear(prev => prev - 1)}
                                            className="p-1 hover:bg-stone-100 text-stone-700 rounded-md font-bold text-xs"
                                        >
                                            ◀
                                        </button>
                                        <span className="font-extrabold text-stone-800 text-xs">{pickerYear}</span>
                                        <button
                                            type="button"
                                            onClick={() => setPickerYear(prev => prev + 1)}
                                            className="p-1 hover:bg-stone-100 text-stone-700 rounded-md font-bold text-xs"
                                        >
                                            ▶
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {shortMonthNames.map((mName, idx) => {
                                            const monthVal = `${pickerYear}-${String(idx + 1).padStart(2, '0')}`
                                            const isSelected = targetMonth === monthVal
                                            return (
                                                <button
                                                    key={idx}
                                                    type="button"
                                                    onClick={() => {
                                                        setTargetMonth(monthVal)
                                                        setIsMonthPickerOpen(false)
                                                    }}
                                                    className={`py-1.5 rounded-lg text-xs font-bold transition-all text-center ${isSelected ? 'bg-stone-900 text-white' : 'bg-stone-50 hover:bg-stone-100 text-stone-700'}`}
                                                >
                                                    {mName}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {branchMonthlyTargetData.length === 0 && (
                        <p className="text-xs text-stone-400 font-medium py-8 text-center">Data target belum tersedia.</p>
                    )}

                    {branchMonthlyTargetData.map(item => {
                        const rawPct = Number(item.rawPercent || 0)
                        const isTargetSet = item.monthlyTarget > 0
                        const achieved = isTargetSet && rawPct >= 100
                        const daysLeft = getTargetDaysLeft()
                        const dailyNeeded = !achieved && daysLeft > 0 ? Math.ceil(item.remainingTarget / daysLeft) : 0
                        const ringPct = Math.min(100, Math.max(0, rawPct))
                        const R_SIZE = 116
                        const R_STROKE = 11
                        const radius = (R_SIZE - R_STROKE) / 2
                        const circumference = 2 * Math.PI * radius

                        return (
                            <div key={item.branchId} className="space-y-4">
                                <div className="flex items-center gap-5">
                                    <div className="relative shrink-0" style={{ width: R_SIZE, height: R_SIZE }}>
                                        {achieved && (
                                            <div aria-hidden="true" className="absolute inset-2 rounded-full bg-emerald-300/40 blur-xl animate-pulse"></div>
                                        )}
                                        <svg width={R_SIZE} height={R_SIZE} className="relative -rotate-90">
                                            <defs>
                                                <linearGradient id={`targetGrad-${item.branchId}`} x1="0" y1="0" x2="1" y2="1">
                                                    <stop offset="0%" stopColor={achieved ? '#34d399' : '#e0a17c'} />
                                                    <stop offset="100%" stopColor={achieved ? '#059669' : '#8a4a24'} />
                                                </linearGradient>
                                            </defs>
                                            <circle cx={R_SIZE / 2} cy={R_SIZE / 2} r={radius} fill="none" stroke="#f5f0eb" strokeWidth={R_STROKE} />
                                            <circle
                                                cx={R_SIZE / 2}
                                                cy={R_SIZE / 2}
                                                r={radius}
                                                fill="none"
                                                stroke={`url(#targetGrad-${item.branchId})`}
                                                strokeWidth={R_STROKE}
                                                strokeLinecap="round"
                                                strokeDasharray={circumference}
                                                strokeDashoffset={circumference * (1 - ringPct / 100)}
                                                style={{ transition: 'stroke-dashoffset 700ms ease' }}
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                            <span className={`text-2xl font-black tabular-nums tracking-tight ${achieved ? 'text-emerald-700' : 'text-stone-900'}`}>
                                                {isTargetSet ? `${rawPct.toFixed(1)}%` : '—'}
                                            </span>
                                            <span className="text-[9.5px] font-bold text-stone-400 uppercase tracking-wider">tercapai</span>
                                        </div>
                                    </div>

                                    <div className="min-w-0 space-y-1.5">
                                        {branchMonthlyTargetData.length > 1 && (
                                            <p className="text-xs font-extrabold text-stone-900">{item.branchName}</p>
                                        )}
                                        <div>
                                            <p className="text-[10.5px] font-bold text-stone-400 uppercase tracking-wider">Terkumpul</p>
                                            <p className="text-lg font-extrabold text-stone-900 tabular-nums leading-tight">Rp {item.monthlyIncome.toLocaleString('id-ID')}</p>
                                        </div>
                                        <p className="text-[11px] text-stone-500 font-medium">
                                            Target {isTargetSet ? <strong className="text-stone-800 tabular-nums">Rp {item.monthlyTarget.toLocaleString('id-ID')}</strong> : <span className="italic">belum diatur</span>}
                                        </p>
                                    </div>
                                </div>

                                {isTargetSet && (
                                    <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ${achieved ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-[#e0a17c] to-[#8a4a24]'}`}
                                            style={{ width: `${ringPct}%` }}
                                        ></div>
                                    </div>
                                )}

                                {isTargetSet && (achieved ? (
                                    <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 shadow-[0_0_24px_-8px_rgba(16,185,129,0.55)]">
                                        <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                        </span>
                                        <div>
                                            <p className="text-xs font-extrabold text-emerald-800">Target Tercapai</p>
                                            <p className="text-[11px] font-semibold text-emerald-700">Surplus {formatCompactRupiah(item.surplusTarget)} di atas target. Hebat, tim {item.branchName.replace(/^Ayumi\s+/i, '')}!</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <div className="p-3 rounded-2xl bg-[#fbf4ee] border border-[#f0dccd]">
                                            <p className="text-[10px] font-bold text-[#9a6a4c] uppercase tracking-wider">Sisa Target</p>
                                            <p className="text-sm font-extrabold text-[#5c3316] tabular-nums mt-0.5">{formatCompactRupiah(item.remainingTarget)}</p>
                                        </div>
                                        <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200/80">
                                            <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                                {daysLeft > 0 ? `Per hari · ${daysLeft} hari lagi` : 'Bulan berakhir'}
                                            </p>
                                            <p className="text-sm font-extrabold text-stone-900 tabular-nums mt-0.5">
                                                {daysLeft > 0 ? formatCompactRupiah(dailyNeeded) : '—'}
                                            </p>
                                        </div>
                                    </div>
                                ))}

                                {item.monthlyQrisFee > 0 && (
                                    <p className="text-[10.5px] text-stone-400 font-medium flex justify-between">
                                        <span>Biaya QRIS bulan ini (0,3%)</span>
                                        <span className="font-bold text-violet-700 tabular-nums">Rp {item.monthlyQrisFee.toLocaleString('id-ID')}</span>
                                    </p>
                                )}
                            </div>
                        )
                    })}

                    {isOwner && (
                        <div className="pt-3 border-t border-stone-100 flex justify-end">
                            <button
                                onClick={handleOpenTargetModal}
                                className="text-xs font-bold text-[#5c3316] hover:underline"
                            >
                                Edit Target Cabang ➔
                            </button>
                        </div>
                    )}
                </div>

                {/* Komposisi Pendapatan (donut) */}
                <div className="lg:col-span-3 p-6 bg-white border border-stone-200/80 rounded-3xl shadow-sm flex flex-col gap-4">
                    <div>
                        <p className="text-[10.5px] font-bold text-stone-500 uppercase tracking-[0.12em]">Komposisi Pendapatan</p>
                        <h3 className="text-base font-extrabold text-stone-900 mt-0.5">Sumber omset {startDate} s/d {endDate}</h3>
                    </div>

                    {adminCompositionData.total <= 0 ? (
                        <div className="flex-1 min-h-[220px] flex items-center justify-center text-xs font-semibold text-stone-400">
                            Belum ada pendapatan pada periode ini.
                        </div>
                    ) : (
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_1fr] items-center gap-6">
                            <div className="relative h-56 w-full max-w-[15rem] mx-auto">
                                {isMounted && (
                                    <LazyRecharts render={(R) => (
                                        <R.ResponsiveContainer width="100%" height="100%">
                                            <R.PieChart>
                                                <R.Pie
                                                    data={adminCompositionData.rows.filter(r => r.value > 0)}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    innerRadius="66%"
                                                    outerRadius="96%"
                                                    paddingAngle={2}
                                                    cornerRadius={4}
                                                    stroke="#ffffff"
                                                    strokeWidth={2}
                                                    startAngle={90}
                                                    endAngle={-270}
                                                    isAnimationActive
                                                >
                                                    {adminCompositionData.rows.filter(r => r.value > 0).map(r => (
                                                        <R.Cell key={r.key} fill={r.color} />
                                                    ))}
                                                </R.Pie>
                                                <R.Tooltip
                                                    formatter={(value, name) => [`Rp ${Number(value).toLocaleString('id-ID')} (${((value / adminCompositionData.total) * 100).toFixed(1)}%)`, name]}
                                                    contentStyle={{ borderRadius: '12px', backgroundColor: '#ffffff', border: '1px solid #e7e5e4', fontSize: '12px' }}
                                                />
                                            </R.PieChart>
                                        </R.ResponsiveContainer>
                                    )} />
                                )}
                                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Total</span>
                                    <span className="text-lg font-black text-stone-900 tabular-nums leading-tight">{formatCompactRupiah(adminCompositionData.total)}</span>
                                    <span className="text-[10.5px] font-semibold text-stone-500">{branchTotals.rangeTxCount} transaksi</span>
                                </div>
                            </div>

                            <ul className="space-y-2.5">
                                {adminCompositionData.rows.map(r => {
                                    const pct = adminCompositionData.total > 0 ? (r.value / adminCompositionData.total) * 100 : 0
                                    return (
                                        <li key={r.key} className="p-3 rounded-2xl border border-stone-100 bg-stone-50/60">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="flex items-center gap-2 min-w-0">
                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }}></span>
                                                    <span className="text-xs font-bold text-stone-700 truncate">{r.name}</span>
                                                </span>
                                                <span className="text-xs font-black text-stone-900 tabular-nums">{pct.toFixed(1)}%</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-3">
                                                <div className="flex-1 h-1.5 bg-white rounded-full overflow-hidden border border-stone-100">
                                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: r.color }}></div>
                                                </div>
                                                <span className="text-[11px] font-semibold text-stone-500 tabular-nums whitespace-nowrap">Rp {r.value.toLocaleString('id-ID')}</span>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* 4. TOP 5 LAYANAN & PRODUK TERLARIS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[
                    { key: 'treatments', title: '5 Treatment Terlaris', subtitle: 'Layanan dengan pendapatan tertinggi periode ini', items: topTreatments, unit: 'sesi', bar: 'bg-pink-100/70', empty: 'Belum ada data tindakan treatment pada periode ini.' },
                    { key: 'products', title: '5 Produk Skincare Terlaris', subtitle: 'Produk dengan penjualan tertinggi periode ini', items: topProducts, unit: 'unit', bar: 'bg-cyan-100/70', empty: 'Belum ada data penjualan produk pada periode ini.' }
                ].map(list => {
                    const maxRevenue = Math.max(1, ...list.items.map(i => Number(i.revenue || 0)))
                    return (
                        <div key={list.key} className="p-6 bg-white border border-stone-200/80 rounded-3xl shadow-sm space-y-4">
                            <div>
                                <h3 className="text-base font-extrabold text-stone-900">{list.title}</h3>
                                <p className="text-[11px] text-stone-500 font-medium mt-0.5">{list.subtitle}</p>
                            </div>
                            {list.items.length === 0 ? (
                                <p className="text-xs text-stone-400 font-medium py-8 text-center">{list.empty}</p>
                            ) : (
                                <ol className="space-y-2">
                                    {list.items.map((it, idx) => (
                                        <li key={it.name} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white">
                                            <div
                                                aria-hidden="true"
                                                className={`absolute inset-y-0 left-0 ${list.bar} transition-all duration-700`}
                                                style={{ width: `${(Number(it.revenue || 0) / maxRevenue) * 100}%` }}
                                            ></div>
                                            <div className="relative flex items-center justify-between gap-3 px-3 py-2.5">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <span className={`w-7 h-7 rounded-full font-black text-xs flex items-center justify-center shrink-0 ${medalStyle(idx)}`}>
                                                        {idx + 1}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="font-extrabold text-xs text-stone-900 truncate">{it.name}</p>
                                                        <p className="text-[11px] text-stone-500 font-medium">{it.count} {list.unit}</p>
                                                    </div>
                                                </div>
                                                <span className="font-extrabold text-xs text-stone-900 tabular-nums whitespace-nowrap">
                                                    Rp {Number(it.revenue || 0).toLocaleString('id-ID')}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* 5. TRANSAKSI TERKINI */}
            <div className="p-6 bg-white border border-stone-200/80 rounded-3xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div>
                        <p className="text-[10.5px] font-bold text-stone-500 uppercase tracking-[0.12em]">Transaksi Terkini</p>
                        <h3 className="text-base font-extrabold text-stone-900 mt-0.5">Pembayaran kasir {userBranchName.replace(/^Ayumi\s+/i, '')}</h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-0.5">10 transaksi terakhir pada periode yang dipilih</p>
                    </div>
                    <Link
                        href="/transactions"
                        className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#fbf4ee] border border-[#f0dccd] text-xs font-bold text-[#5c3316] hover:bg-[#f6e6d9] transition-colors"
                    >
                        Semua Transaksi
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </Link>
                </div>

                {recentBranchTransactions.length === 0 ? (
                    <div className="py-12 text-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 text-stone-400 text-xs font-semibold">
                        Tidak ada transaksi pada rentang tanggal ini.
                    </div>
                ) : (
                    <div className="overflow-x-auto -mx-2 px-2">
                        <table className="w-full text-left border-separate border-spacing-y-1.5 text-xs min-w-[760px]">
                            <thead>
                                <tr className="text-[10.5px] font-bold text-stone-400 uppercase tracking-wider">
                                    <th className="px-3 pb-1">Waktu</th>
                                    <th className="px-3 pb-1">Pasien</th>
                                    <th className="px-3 pb-1">Item</th>
                                    <th className="px-3 pb-1 text-right">Total</th>
                                    <th className="px-3 pb-1 text-center">Metode</th>
                                    <th className="px-3 pb-1 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentBranchTransactions.map(tx => {
                                    const isVoid = tx.payment_status === 'void'
                                    const patientId = tx.patient_id || tx.patients?.id
                                    const patientName = tx.patients?.full_name || 'Pasien Umum'
                                    const created = tx.created_at ? new Date(tx.created_at) : null
                                    const method = String(tx.payment_method || 'cash').toLowerCase()
                                    const items = tx.transaction_items || []
                                    return (
                                        <tr key={tx.id} className="group">
                                            <td className="px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] rounded-l-2xl transition-colors whitespace-nowrap align-top">
                                                <p className="font-bold text-stone-800">
                                                    {created ? created.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                                                </p>
                                                <p className="text-[11px] text-stone-400 font-medium tabular-nums">
                                                    {created ? created.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''} WIB
                                                </p>
                                            </td>
                                            <td className="px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] transition-colors align-top">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#e0a17c] to-[#8a4a24] text-white text-[11px] font-black flex items-center justify-center shrink-0">
                                                        {getInitials(patientName)}
                                                    </span>
                                                    <div className="min-w-0">
                                                        {patientId ? (
                                                            <Link href={`/patients/${patientId}`} className="font-bold text-stone-900 hover:text-ayumi-primary transition-colors block truncate max-w-[11rem]" title="Buka profil pasien">
                                                                {patientName}
                                                            </Link>
                                                        ) : (
                                                            <p className="font-bold text-stone-900 truncate max-w-[11rem]">{patientName}</p>
                                                        )}
                                                        <Link href="/transactions" className="text-[10.5px] text-stone-400 font-mono hover:text-stone-600">
                                                            {tx.transaction_number || tx.id.slice(0, 8)}
                                                        </Link>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] transition-colors align-top">
                                                {items.length === 0 ? (
                                                    <span className="text-stone-400">-</span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1 max-w-[22rem]">
                                                        {items.slice(0, 2).map((item, i) => (
                                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-stone-200/80 text-[11px] text-stone-700 font-medium">
                                                                <span className="truncate max-w-[12rem]">{item.name}</span>
                                                                {Number(item.quantity) > 1 && <span className="text-stone-400">×{item.quantity}</span>}
                                                            </span>
                                                        ))}
                                                        {items.length > 2 && (
                                                            <span className="px-2 py-0.5 rounded-lg bg-[#fbeee4] text-[#7a4424] text-[11px] font-bold">
                                                                +{items.length - 2} lainnya
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className={`px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] transition-colors text-right font-extrabold whitespace-nowrap tabular-nums align-top ${isVoid ? 'line-through text-stone-400' : 'text-stone-900'}`}>
                                                Rp {Number(tx.total || 0).toLocaleString('id-ID')}
                                            </td>
                                            <td className="px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] transition-colors text-center whitespace-nowrap align-top">
                                                <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${PAYMENT_METHOD_STYLE[method] || 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                                                    {method}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 bg-stone-50/70 group-hover:bg-[#fbf4ee] rounded-r-2xl transition-colors text-center whitespace-nowrap align-top">
                                                {isVoid ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>Void
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Lunas
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 6. OPERASIONAL HARIAN & CRM PASIEN */}
            <div className="space-y-4">
                <div>
                    <p className="text-[10.5px] font-bold text-stone-500 uppercase tracking-[0.12em]">Operasional & CRM</p>
                    <h3 className="text-base font-extrabold text-stone-900 mt-0.5">Hari ini di klinik</h3>
                    <p className="text-[11px] text-stone-500 font-medium mt-0.5">Janji temu, antrean follow-up, dan retensi pasien</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                    {[
                        { key: 'apt', label: 'Janji Temu Hari Ini', value: statAppointments, href: '/appointments', tone: 'from-sky-400 to-blue-600', icon: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /><path d="M9 14.5l2 2 4-4" /></> },
                        { key: 'fu', label: 'Follow-Up Pending', value: statFollowups, href: '/crm', tone: 'from-orange-400 to-rose-500', icon: <><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.8-.9L3 20.5l1.4-4.6A8.4 8.4 0 1121 11.5z" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" /></> },
                        { key: 'bday', label: 'Ultah Bulan Ini', value: statBirthdays, href: '/crm', tone: 'from-pink-400 to-fuchsia-600', icon: <><rect x="3.5" y="11" width="17" height="9.5" rx="2" /><path d="M3.5 15c1.4 0 1.4-1 2.8-1s1.4 1 2.9 1 1.4-1 2.8-1 1.4 1 2.9 1 1.4-1 2.8-1 1.4 1 2.8 1" /><path d="M8 11V8.5M12 11V8.5M16 11V8.5" /><path d="M8 5.5c0-.8.5-1.5 0-2.5M12 5.5c0-.8.5-1.5 0-2.5M16 5.5c0-.8.5-1.5 0-2.5" /></> },
                        { key: 'new', label: 'Pasien Baru', value: statNewPatients, href: '/patients', tone: 'from-emerald-400 to-teal-600', icon: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0113 0" /><path d="M19 8v6M16 11h6" /></> },
                        { key: 'dormant', label: 'Dormant (>60 hari)', value: statDormant, href: '/crm', tone: 'from-amber-400 to-orange-600', icon: <><circle cx="12" cy="12.5" r="8.5" /><path d="M12 8v4.5l3 2" /><path d="M5 3.5L2.5 6M19 3.5L21.5 6" /></> },
                        { key: 'coupon', label: 'Kupon Expired (30 hari)', value: statExpiringCoupons, href: '/coupons', tone: 'from-violet-400 to-indigo-600', icon: <><path d="M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2z" /><path d="M13 5v2M13 11v2M13 17v2" /><path d="M6.5 9.5v3l1.5 1" /></> }
                    ].map(stat => (
                        <button
                            key={stat.key}
                            type="button"
                            onClick={() => router.push(stat.href)}
                            className="group text-left p-4 rounded-2xl bg-white border border-stone-200/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md cursor-pointer"
                        >
                            <span className={`relative w-9 h-9 rounded-xl bg-gradient-to-br ${stat.tone} text-white shadow-md ring-1 ring-inset ring-white/25 flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
                                <span aria-hidden="true" className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-lg bg-gradient-to-b from-white/30 to-transparent"></span>
                                <svg className="relative w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">{stat.icon}</svg>
                            </span>
                            <p className="text-2xl font-black text-stone-900 tabular-nums mt-3 leading-none">{Number(stat.value || 0).toLocaleString('id-ID')}</p>
                            <p className="text-[11px] font-bold text-stone-500 mt-1.5 leading-snug">{stat.label}</p>
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Jadwal janji temu hari ini */}
                    <div className="p-5 bg-white border border-stone-200/80 rounded-3xl shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-extrabold text-stone-900">Jadwal Janji Temu Hari Ini</h4>
                            <Link href="/appointments" className="text-xs font-bold text-[#5c3316] hover:underline">Kelola →</Link>
                        </div>
                        {recentAppointments.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-8 text-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/60">Belum ada janji temu hari ini.</p>
                        ) : (
                            <div className="space-y-2">
                                {recentAppointments.map(apt => {
                                    const aptPatientId = apt.patient_id || apt.patients?.id
                                    const st = APPOINTMENT_STATUS[apt.status] || { label: apt.status || '-', cls: 'bg-stone-100 text-stone-600 border-stone-200' }
                                    return (
                                        <div key={apt.id} onClick={() => router.push('/appointments')} className="flex items-center gap-3 p-2.5 rounded-2xl bg-stone-50/70 hover:bg-[#fbf4ee] transition-colors cursor-pointer">
                                            <div className="w-14 shrink-0 text-center py-1.5 rounded-xl bg-white border border-stone-200/80">
                                                <p className="text-sm font-black text-stone-900 tabular-nums leading-none">{apt.start_time?.slice(0, 5) || '--:--'}</p>
                                                <p className="text-[9.5px] font-bold text-stone-400 mt-0.5 tabular-nums">s/d {apt.end_time?.slice(0, 5) || '--:--'}</p>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                {aptPatientId ? (
                                                    <Link
                                                        href={`/patients/${aptPatientId}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-xs font-extrabold text-stone-900 hover:text-ayumi-primary transition-colors block truncate"
                                                        title="Buka profil pasien"
                                                    >
                                                        {apt.patients?.full_name || 'Pasien'}
                                                    </Link>
                                                ) : (
                                                    <p className="text-xs font-extrabold text-stone-900 truncate">{apt.patients?.full_name || 'Pasien'}</p>
                                                )}
                                                <p className="text-[11px] text-stone-500 font-medium tabular-nums">{apt.patients?.whatsapp || 'Tanpa nomor WA'}</p>
                                            </div>
                                            <span className={`shrink-0 px-2.5 py-0.5 rounded-full border text-[10.5px] font-bold ${st.cls}`}>{st.label}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Antrean follow-up CRM */}
                    <div className="p-5 bg-white border border-stone-200/80 rounded-3xl shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-extrabold text-stone-900">Antrean Follow-Up CRM</h4>
                            <Link href="/crm" className="text-xs font-bold text-[#5c3316] hover:underline">Buka CRM →</Link>
                        </div>
                        {recentFollowups.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-8 text-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/60">Semua follow-up pasien sudah selesai.</p>
                        ) : (
                            <div className="space-y-2">
                                {recentFollowups.map(fu => {
                                    const fuPatientId = fu.patient_id || fu.patients?.id
                                    const name = fu.patients?.full_name || 'Pasien'
                                    const pr = PRIORITY_STYLE[fu.priority] || PRIORITY_STYLE.normal
                                    return (
                                        <div key={fu.id} onClick={() => router.push('/crm')} className="flex items-center gap-3 p-2.5 rounded-2xl bg-stone-50/70 hover:bg-[#fbf4ee] transition-colors cursor-pointer">
                                            <span className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-white text-[11px] font-black flex items-center justify-center shrink-0">
                                                {getInitials(name)}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                {fuPatientId ? (
                                                    <Link
                                                        href={`/patients/${fuPatientId}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-xs font-extrabold text-stone-900 hover:text-ayumi-primary transition-colors block truncate"
                                                        title="Buka profil pasien"
                                                    >
                                                        {name}
                                                    </Link>
                                                ) : (
                                                    <p className="text-xs font-extrabold text-stone-900 truncate">{name}</p>
                                                )}
                                                <p className="text-[11px] text-stone-500 font-medium">
                                                    {FOLLOWUP_TYPE_LABEL[fu.followup_type] || (fu.followup_type ? fu.followup_type.replace(/_/g, ' ') : 'Follow-up')}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 px-2.5 py-0.5 rounded-full border text-[10.5px] font-bold ${pr.cls}`}>{pr.label}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* MODAL: ATUR TARGET OMSET BULANAN (OWNER) */}
            {isTargetModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-md w-full p-6 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                            <h3 className="text-base font-extrabold text-stone-900">Atur Target Omset Cabang</h3>
                            <button onClick={() => setIsTargetModalOpen(false)} className="text-stone-400 hover:text-stone-700 text-sm font-bold">✕</button>
                        </div>
                        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                            {branches.map(b => (
                                <div key={b.id} className="space-y-1">
                                    <label className="text-xs font-bold text-stone-700">{b.name}</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xs font-bold">Rp</span>
                                        <input
                                            type="number"
                                            value={targetFormData[b.id] ?? ''}
                                            onChange={(e) => setTargetFormData({ ...targetFormData, [b.id]: e.target.value })}
                                            className="w-full pl-9 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#5c3316]"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-3 border-t border-stone-100 flex justify-end gap-2">
                            <button onClick={() => setIsTargetModalOpen(false)} className="px-4 py-2 bg-stone-100 text-stone-700 rounded-xl text-xs font-bold">Batal</button>
                            <button onClick={handleSaveTargets} disabled={isSavingTargets} className="px-4 py-2 bg-[#5c3316] text-white rounded-xl text-xs font-bold disabled:opacity-50">
                                {isSavingTargets ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: RINCIAN PEMAKAIAN SESI KUPON */}
            {isCouponUsageModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-stone-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-extrabold text-stone-900">Rincian Pemakaian Sesi Kupon</h3>
                                <p className="text-xs text-stone-500 font-medium">Periode {startDate} s/d {endDate} ({couponUsageModalBranch.name})</p>
                            </div>
                            <button onClick={() => setIsCouponUsageModalOpen(false)} className="text-stone-400 hover:text-stone-700 text-sm font-bold">✕</button>
                        </div>
                        <div className="p-3.5 bg-stone-50 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <span className="text-xs font-bold text-stone-700">Total: {filteredCouponLogs.length} Sesi</span>
                                <span className="text-xs font-bold text-amber-800 bg-amber-100/80 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                                    Valuasi Redeem: Rp {filteredCouponLogs.reduce((acc, log) => {
                                        const item = log.patient_coupon_items
                                        const tP = Number(item?.treatments?.price || 0)
                                        const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                                        const tS = Number(item?.total_sessions || 1)
                                        return acc + (tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0))
                                    }, 0).toLocaleString('id-ID')}
                                </span>
                            </div>
                            <input
                                type="text"
                                value={couponUsageSearch}
                                onChange={(e) => setCouponUsageSearch(e.target.value)}
                                placeholder="Cari nama pasien / layanan..."
                                className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#5c3316]"
                            />
                        </div>
                        <div className="p-4 overflow-y-auto flex-1">
                            {(() => {
                                // Sesi dari nota migrasi GD Cashier tidak punya log per pasien, jadi hanya
                                // ringkasannya yang ditampilkan di sini.
                                const gdRows = (branchDailyComparison || []).filter(b => !couponUsageModalBranch.id || b.branchId === couponUsageModalBranch.id)
                                const gdSessions = gdRows.reduce((acc, b) => acc + (b.gdCouponUsedSessions || 0), 0)
                                const gdValue = gdRows.reduce((acc, b) => acc + (b.gdCouponUsedValue || 0), 0)
                                if (gdSessions === 0 || couponUsageSearch.trim()) return null
                                return (
                                    <p className="mb-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-medium">
                                        Ditambah <strong>{gdSessions} sesi (Rp {gdValue.toLocaleString('id-ID')})</strong> dari nota migrasi GD Cashier. Rincian per pasien untuk nota GD dapat dilihat di Riwayat Transaksi.
                                    </p>
                                )
                            })()}
                            {filteredCouponLogs.length === 0 ? (
                                <p className="text-xs text-stone-400 py-10 text-center">Tidak ditemukan riwayat pemakaian sesi kupon.</p>
                            ) : (
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="bg-stone-50 text-stone-700 font-bold border-b border-stone-200 uppercase text-[11px]">
                                            <th className="p-2.5">Waktu</th>
                                            <th className="p-2.5">Pasien</th>
                                            <th className="p-2.5">Paket & Layanan</th>
                                            <th className="p-2.5 text-center">Status Sesi</th>
                                            <th className="p-2.5 text-right">Nilai Sesi</th>
                                            <th className="p-2.5">Petugas</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {filteredCouponLogs.map((log, idx) => {
                                            const item = log.patient_coupon_items
                                            const tP = Number(item?.treatments?.price || 0)
                                            const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                                            const tS = Number(item?.total_sessions || 1)
                                            const val = tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0)

                                            return (
                                                <tr key={log.id || idx} className="hover:bg-stone-50/50">
                                                    <td className="p-2.5 text-stone-500 whitespace-nowrap">{formatLogDateTime(log.used_at)}</td>
                                                    <td className="p-2.5 whitespace-nowrap">
                                                        {log.patients?.id ? (
                                                            <Link 
                                                                href={`/patients/${log.patients.id}`}
                                                                className="font-bold text-stone-900 hover:text-ayumi-primary hover:underline transition-colors inline-flex items-center gap-1 group/cp"
                                                                title="Buka Profil & Riwayat Pasien"
                                                            >
                                                                <span>{log.patients?.full_name || 'Pasien'}</span>
                                                                <span className="text-[11px] text-ayumi-primary font-bold group-hover/cp:translate-x-0.5 group-hover/cp:-translate-y-0.5 transition-transform">↗</span>
                                                            </Link>
                                                        ) : (
                                                            <span className="font-bold text-stone-900">{log.patients?.full_name || 'Pasien'}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-2.5">
                                                        <p className="font-bold text-stone-900">{log.patient_coupon_items?.treatments?.name || 'Treatment'}</p>
                                                        <p className="text-[10px] text-stone-400">{log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || 'Paket'}</p>
                                                    </td>
                                                    <td className="p-2.5 text-center">
                                                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                                                            Sesi {log.patient_coupon_items?.used_sessions || 1}/{log.patient_coupon_items?.total_sessions || 1}
                                                        </span>
                                                    </td>
                                                    <td className="p-2.5 text-right font-bold text-amber-900 whitespace-nowrap tabular-nums">
                                                        Rp {val.toLocaleString('id-ID')}
                                                    </td>
                                                    <td className="p-2.5 text-stone-600">{log.users?.full_name || '-'}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-3.5 border-t border-stone-100 flex justify-end">
                            <button onClick={() => setIsCouponUsageModalOpen(false)} className="px-4 py-2 bg-stone-100 text-stone-700 rounded-xl text-xs font-bold">Tutup</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
