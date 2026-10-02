'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toLocalYYYYMMDD } from '@/lib/localDate'
import { fetchAllPaginated } from '@/lib/fetchAllPaginated'
import { getCachedUser, getCachedBranches } from '@/lib/cachedBranches'
import Link from 'next/link'
import DateRangePicker from "../../components/DateRangePicker"
import BranchFilter from "@/components/ui/BranchFilter"
import toast from 'react-hot-toast'
import { openWhatsApp } from '@/lib/whatsapp'
import { parsePaymentSplits, getNetTransactionRevenue, getQrisFee } from '@/lib/paymentUtils'
import { getTransactionRevenueBreakdown, getTransactionPricingSummary } from '@/lib/revenueBreakdown'
import { exportTransactionsPdf } from '@/lib/exports/transactionsPdf'
import { exportTransactionsExcel } from '@/lib/exports/transactionsExcel'
import CouponRedeemModal from '@/components/transactions/CouponRedeemModal'
import TransactionDetailModal from '@/components/transactions/TransactionDetailModal'

// Recharts components (we only render them on client side to avoid hydration errors)
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell
} from 'recharts'

const TRANSACTION_SELECT_FIELDS = `
    id,
    transaction_number,
    created_at,
    total,
    subtotal,
    discount,
    payment_method,
    payment_status,
    notes,
    branch_id,
    patient_id,
    branches (name),
    patients (id, full_name, whatsapp, gender, birth_date, created_at),
    users:users!transactions_cashier_id_fkey(full_name),
    treatment_records (
        id,
        performed_by,
        therapist:users!treatment_records_performed_by_fkey (full_name),
        treatment_record_items (
            price_at_time,
            original_price,
            discount_percent,
            notes,
            treatments (name, price)
        ),
        coupon_usage_logs (id, voided_at, patient_coupon_items (treatment_id))
    ),
    coupon_usage_logs (id, voided_at, patient_coupon_items (treatment_id)),
    transaction_items (
        id,
        name,
        item_type,
        treatment_id,
        product_id,
        quantity,
        price,
        subtotal,
        original_price,
        discount_percent,
        products (id, name, price, description)
    )
`

const PAGE_SIZE = 1000
const PARALLEL_PAGES = 4

async function queryTransactionsWithRange(supabaseClient, {
    startDate,
    endDate,
    branchId = '',
    effectiveUser = null
}) {
    // Query dibuat ulang untuk setiap permintaan: builder Supabase tidak aman dipakai
    // ulang untuk halaman berikutnya.
    const buildQuery = (columns, options) => {
        let query = supabaseClient.from('transactions').select(columns, options)
        if (effectiveUser && effectiveUser.role !== 'owner') {
            query = query.eq('branch_id', effectiveUser.branch_id || '00000000-0000-0000-0000-000000000000')
        } else if (branchId) {
            query = query.eq('branch_id', branchId)
        }
        if (startDate) {
            query = query.gte('created_at', new Date(`${startDate}T00:00:00`).toISOString())
        }
        if (endDate) {
            query = query.lte('created_at', new Date(`${endDate}T23:59:59.999`).toISOString())
        }
        return query
    }
    const fetchPage = async (pageIdx) => {
        const from = pageIdx * PAGE_SIZE
        const { data, error } = await buildQuery(TRANSACTION_SELECT_FIELDS)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
        if (error) {
            console.error('Error fetching transactions batch:', error)
            throw error
        }
        return data || []
    }

    // Jumlah baris dihitung dulu agar halaman-halamannya bisa diambil bersamaan
    // (maks. 4 sekaligus). Laporan tahunan (±18.500 nota) turun dari ±17 menjadi ±8 detik.
    const { count, error: countError } = await buildQuery('id', { count: 'exact', head: true })
    if (countError || typeof count !== 'number') {
        // Cadangan: ambil berurutan seperti sebelumnya.
        const allRows = []
        for (let pageIdx = 0; ; pageIdx++) {
            const rows = await fetchPage(pageIdx)
            allRows.push(...rows)
            if (rows.length < PAGE_SIZE) break
        }
        return allRows
    }

    const pageCount = Math.ceil(count / PAGE_SIZE)
    const pages = new Array(pageCount)
    let nextPage = 0
    const worker = async () => {
        while (nextPage < pageCount) {
            const pageIdx = nextPage++
            pages[pageIdx] = await fetchPage(pageIdx)
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PAGES, pageCount) }, worker))

    // Transaksi yang masuk selama pengambilan bisa menggeser batas halaman; duplikat dibuang.
    const seen = new Set()
    return pages.flat().filter(row => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
    })
}

export default function TransactionsPage() {
    // Auth & UI States
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [isMounted, setIsMounted] = useState(false)
    const [activeMainTab, setActiveMainTab] = useState('all') // 'all' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

    // Filters (Global for main view, tabs have specific sub-filters)
    const [filterPeriod, setFilterPeriod] = useState('custom')
    const [filterBranch, setFilterBranch] = useState('') // empty means 'all'
    const [filterPaymentMethod, setFilterPaymentMethod] = useState('') // empty means 'all'
    const [filterTxType, setFilterTxType] = useState('') // empty means 'all'
    const [filterCustomerType, setFilterCustomerType] = useState('') // '' | 'new' | 'repeat' | 'walk-in'
    const [customStartDate, setCustomStartDate] = useState(() => {
        return toLocalYYYYMMDD()
    })
    const [customEndDate, setCustomEndDate] = useState(() => {
        return toLocalYYYYMMDD()
    })

    // Data State
    const [transactions, setTransactions] = useState([]) // all loaded transactions for current & comparison periods
    const [patientFirstTxMap, setPatientFirstTxMap] = useState({})
    const [productCatalogMap, setProductCatalogMap] = useState(() => new Map())

    // Load active product catalog once for accurate original price before discount lookup
    useEffect(() => {
        let isMounted = true
        async function loadProductCatalog() {
            try {
                const { data } = await supabase.from('products').select('id, name, price, description')
                if (data && data.length > 0 && isMounted) {
                    const map = new Map()
                    data.forEach(p => {
                        map.set(p.id, p)
                        if (p.name) map.set(p.name.trim().toLowerCase(), p)
                    })
                    setProductCatalogMap(map)
                }
            } catch (err) {
                console.warn('Could not load products catalog for pricing:', err)
            }
        }
        loadProductCatalog()
        return () => { isMounted = false }
    }, [])

    // Detail Modal State
    const [selectedTx, setSelectedTx] = useState(null)
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
    const [isEditingTx, setIsEditingTx] = useState(false)
    const [editTxData, setEditTxData] = useState({ payment_method: '', notes: '', created_at: '' })
    const [isDeletingTx, setIsDeletingTx] = useState(false)

    // Tab-Specific Sub-filters
    const [dailyReportDate, setDailyReportDate] = useState(() => toLocalYYYYMMDD())
    
    // Weekly Report selector (picks a start date)
    const getStartOfWeek = (d) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
        return new Date(date.setDate(diff))
    }
    // Tanggal lokal (WIB): toISOString() memberi tanggal UTC, yang sebelum pukul 07.00 WIB
    // masih hari sebelumnya.
    const [weeklyReportStart, setWeeklyReportStart] = useState(() => toLocalYYYYMMDD(getStartOfWeek(new Date())))

    // Monthly Report selector (Month & Year)
    const [monthlyReportMonth, setMonthlyReportMonth] = useState(new Date().getMonth()) // 0-11
    const [monthlyReportYear, setMonthlyReportYear] = useState(new Date().getFullYear())

    // Yearly Report selector (Year)
    const [yearlyReportYear, setYearlyReportYear] = useState(new Date().getFullYear())

    // Custom Tab filters
    const [customTabStart, setCustomTabStart] = useState(() => toLocalYYYYMMDD())
    const [customTabEnd, setCustomTabEnd] = useState(() => toLocalYYYYMMDD())
    const [customTabBranch, setCustomTabBranch] = useState('')
    const [customTabTxType, setCustomTabTxType] = useState('')

    // Tab 1 state: table loading & pagination
    const [isTableLoading, setIsTableLoading] = useState(false)
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(25)

    // Tab 2 State: Daily Report
    const [dailyTransactions, setDailyTransactions] = useState([])
    const [isDailyLoading, setIsDailyLoading] = useState(false)

    // Tab 3 State: Weekly Report
    const [weeklyTransactions, setWeeklyTransactions] = useState([])
    const [isWeeklyLoading, setIsWeeklyLoading] = useState(false)

    // Tab 4 State: Monthly Report
    const [monthlyTransactions, setMonthlyTransactions] = useState([])
    const [isMonthlyLoading, setIsMonthlyLoading] = useState(false)

    // Tab 5 State: Yearly Report
    const [yearlyTransactions, setYearlyTransactions] = useState([])
    const [isYearlyLoading, setIsYearlyLoading] = useState(false)

    // Tab 6 State: Custom Report
    const [customReportResult, setCustomReportResult] = useState(null)
    const [isCustomGenerating, setIsCustomGenerating] = useState(false)

    // Coupon Redeem / Sesi Kupon Terpakai State
    const [couponRedeemedData, setCouponRedeemedData] = useState({ totalSessions: 0, totalValue: 0, logs: [] })
    const [isCouponRedeemModalOpen, setIsCouponRedeemModalOpen] = useState(false)
    const [couponRedeemSearch, setCouponRedeemSearch] = useState('')

    // Coordinated Initialization Flag (Prevents double-fetch on mount)
    const isInitializedRef = useRef(false)

    // Tab 1 Fetcher
    const fetchTransactions = async (activeUser = dbUser, branchIdOverride = filterBranch, startOverride = customStartDate, endOverride = customEndDate) => {
        const effectiveUser = activeUser !== undefined ? activeUser : dbUser
        const effectiveBranch = branchIdOverride !== undefined ? branchIdOverride : filterBranch
        const effectiveStart = startOverride || customStartDate
        const effectiveEnd = endOverride || customEndDate

        setIsTableLoading(true)
        try {
            const rowsPromise = queryTransactionsWithRange(supabase, {
                startDate: effectiveStart,
                endDate: effectiveEnd,
                branchId: effectiveBranch,
                effectiveUser
            })

            const buildLogsQuery = () => {
            let logsQuery = supabase
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
                .gte('used_at', new Date(`${effectiveStart}T00:00:00`).toISOString())
                .lte('used_at', new Date(`${effectiveEnd}T23:59:59.999`).toISOString())
                .order('used_at', { ascending: false })

            if (effectiveBranch) {
                logsQuery = logsQuery.eq('branch_id', effectiveBranch)
            } else if (effectiveUser && effectiveUser.role !== 'owner' && effectiveUser.branch_id) {
                logsQuery = logsQuery.eq('branch_id', effectiveUser.branch_id)
            }
            // id sebagai pengurut kedua supaya batas halaman tidak melewatkan baris
            return logsQuery.order('id', { ascending: true })
            }

            const [rows, { data: couponLogs, error: couponErr }] = await Promise.all([
                rowsPromise,
                fetchAllPaginated(buildLogsQuery)
            ])

            if (couponErr) {
                console.warn('Error fetching coupon_usage_logs for transactions:', couponErr)
            }

            const validLogs = couponLogs || []
            let totalVal = 0
            validLogs.forEach(log => {
                const item = log.patient_coupon_items
                const tP = Number(item?.treatments?.price || 0)
                const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                const tS = Number(item?.total_sessions || 1)
                totalVal += (tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0))
            })

            setTransactions(rows)
            setCouponRedeemedData({
                totalSessions: validLogs.length,
                totalValue: totalVal,
                logs: validLogs
            })
        } catch (err) {
            console.error('Error fetching transactions:', err)
            toast.error('Gagal memuat data transaksi: ' + (err.message || ''))
        } finally {
            setIsTableLoading(false)
        }
    }

    // Coordinated single initial mount
    useEffect(() => {
        let isCurrent = true
        setTimeout(() => {
            if (isCurrent) setIsMounted(true)
        }, 0)
        async function fetchInitialData() {
            setIsLoading(true)
            try {
                const [{ user, dbUser: profile }, branchesData] = await Promise.all([
                    getCachedUser(),
                    getCachedBranches()
                ])

                if (!isCurrent) return

                let effectiveBranch = ''
                if (profile) {
                    setDbUser(profile)
                    if (profile.role !== 'owner') {
                        effectiveBranch = profile.branch_id || ''
                        setFilterBranch(effectiveBranch)
                        setCustomTabBranch(effectiveBranch)
                    }
                }
                if (branchesData) setBranches(branchesData)

                await fetchTransactions(profile, effectiveBranch, customStartDate, customEndDate)
            } catch (err) {
                console.error('Error fetching initial transactions data:', err)
            } finally {
                if (isCurrent) {
                    setIsLoading(false)
                    isInitializedRef.current = true
                }
            }
        }

        fetchInitialData()
        return () => { isCurrent = false }
    }, [])

    // Re-fetch Tab 1 when branch or date range changes AFTER initialization
    useEffect(() => {
        if (!isInitializedRef.current) return
        fetchTransactions(dbUser, filterBranch, customStartDate, customEndDate)
    }, [filterBranch, customStartDate, customEndDate])

    // Tab 2 Fetcher: Daily
    const fetchDailyTransactions = async (dateStr = dailyReportDate, branchOverride = filterBranch) => {
        setIsDailyLoading(true)
        try {
            const rows = await queryTransactionsWithRange(supabase, {
                startDate: dateStr,
                endDate: dateStr,
                branchId: branchOverride,
                effectiveUser: dbUser
            })
            setDailyTransactions(rows)
        } catch (err) {
            console.error('Error fetching daily transactions:', err)
            toast.error('Gagal memuat laporan harian')
        } finally {
            setIsDailyLoading(false)
        }
    }

    // Tab 3 Fetcher: Weekly (Fetches selected week + previous week for YoY/WoW comparison)
    const fetchWeeklyTransactions = async (startStr = weeklyReportStart, branchOverride = filterBranch) => {
        setIsWeeklyLoading(true)
        try {
            const start = new Date(startStr + 'T00:00:00')
            const prevStart = new Date(start)
            prevStart.setDate(prevStart.getDate() - 7)
            const end = new Date(start)
            end.setDate(start.getDate() + 7)

            // Tanggal lokal (WIB). Sebelumnya toISOString() menggeser tanggal mulai satu hari
            // ke belakang karena tengah malam WIB masih hari sebelumnya dalam UTC.
            const prevStartStr = toLocalYYYYMMDD(prevStart)
            end.setDate(end.getDate() - 1)
            const endStr = toLocalYYYYMMDD(end)

            const rows = await queryTransactionsWithRange(supabase, {
                startDate: prevStartStr,
                endDate: endStr,
                branchId: branchOverride,
                effectiveUser: dbUser
            })
            setWeeklyTransactions(rows)
        } catch (err) {
            console.error('Error fetching weekly transactions:', err)
            toast.error('Gagal memuat laporan mingguan')
        } finally {
            setIsWeeklyLoading(false)
        }
    }

    // Tab 4 Fetcher: Monthly (Fetches current month + previous month for comparison)
    const fetchMonthlyTransactions = async (m = monthlyReportMonth, y = monthlyReportYear, branchOverride = filterBranch) => {
        setIsMonthlyLoading(true)
        try {
            const prevDate = new Date(y, m - 1, 1)
            const endDate = new Date(y, m + 1, 0)
            const prevStartStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`
            const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

            const rows = await queryTransactionsWithRange(supabase, {
                startDate: prevStartStr,
                endDate: endStr,
                branchId: branchOverride,
                effectiveUser: dbUser
            })
            setMonthlyTransactions(rows)
        } catch (err) {
            console.error('Error fetching monthly transactions:', err)
            toast.error('Gagal memuat laporan bulanan')
        } finally {
            setIsMonthlyLoading(false)
        }
    }

    // Tab 5 Fetcher: Yearly (Fetches current year + previous year for YoY comparison)
    const fetchYearlyTransactions = async (y = yearlyReportYear, branchOverride = filterBranch) => {
        setIsYearlyLoading(true)
        try {
            const startStr = `${y - 1}-01-01`
            const endStr = `${y}-12-31`
            const rows = await queryTransactionsWithRange(supabase, {
                startDate: startStr,
                endDate: endStr,
                branchId: branchOverride,
                effectiveUser: dbUser
            })
            setYearlyTransactions(rows)
        } catch (err) {
            console.error('Error fetching yearly transactions:', err)
            toast.error('Gagal memuat laporan tahunan')
        } finally {
            setIsYearlyLoading(false)
        }
    }

    // On-demand fetcher triggered when report tabs become active or their filters change
    useEffect(() => {
        if (!isInitializedRef.current) return
        const timer = setTimeout(() => {
            if (activeMainTab === 'daily') {
                fetchDailyTransactions(dailyReportDate, filterBranch)
            } else if (activeMainTab === 'weekly') {
                fetchWeeklyTransactions(weeklyReportStart, filterBranch)
            } else if (activeMainTab === 'monthly') {
                fetchMonthlyTransactions(monthlyReportMonth, monthlyReportYear, filterBranch)
            } else if (activeMainTab === 'yearly') {
                fetchYearlyTransactions(yearlyReportYear, filterBranch)
            }
        }, 0)
        return () => clearTimeout(timer)
    }, [activeMainTab, dailyReportDate, weeklyReportStart, monthlyReportMonth, monthlyReportYear, yearlyReportYear, filterBranch])

    // Single derived state: ONLY transactions with payment_status === 'paid' for all financial & quantity calculations
    const validTransactions = useMemo(
        () => transactions.filter(tx => tx.payment_status === 'paid'),
        [transactions]
    )

    // Sesi kupon dari nota migrasi GD Cashier. Nota GD tidak punya coupon_usage_logs, jadi
    // nilainya diturunkan dari angka nota (lihat lib/revenueBreakdown.js), sama seperti
    // dashboard. Cakupannya sama dengan log kupon: cabang dan rentang tanggal saja.
    const gdCouponRedeemed = useMemo(() => {
        const start = new Date(customStartDate + 'T00:00:00')
        const end = new Date(customEndDate + 'T23:59:59.999')
        let sessions = 0
        let value = 0
        validTransactions.forEach(tx => {
            if (filterBranch && tx.branch_id !== filterBranch) return
            const txDate = new Date(tx.created_at)
            if (txDate < start || txDate > end) return
            const breakdown = getTransactionRevenueBreakdown(tx)
            sessions += breakdown.couponRedeemedSessions
            value += breakdown.couponRedeemedValue
        })
        return { sessions, value }
    }, [validTransactions, filterBranch, customStartDate, customEndDate])
    const couponRedeemedTotals = {
        sessions: couponRedeemedData.totalSessions + gdCouponRedeemed.sessions,
        value: couponRedeemedData.totalValue + gdCouponRedeemed.value
    }

    // Resolusi transaksi pertama per pasien untuk deteksi akurat New Customer vs Repeat.
    //
    // Sebelumnya seluruh riwayat transaksi setiap pasien diambil (100 pasien per permintaan)
    // tanpa paginasi, sehingga rentang bulanan/tahunan terpotong di 1.000 baris dan sebagian
    // pasien lama terbaca sebagai pasien baru. Kini hanya dua hal yang diperiksa, lengkap
    // per halaman: (1) apakah pasien punya transaksi sebelum rentang yang dimuat, dan
    // (2) transaksi paling awal pasien di dalam rentang itu (di cabang mana pun yang boleh
    // dilihat pengguna). Hasilnya sama dengan aturan lama: transaksi pertama pasien = Baru.
    useEffect(() => {
        let isCurrent = true
        async function resolveFirstTransactions() {
            const patientIds = [...new Set(transactions.map(t => t.patient_id).filter(Boolean))]
            if (patientIds.length === 0) {
                if (isCurrent) setPatientFirstTxMap({})
                return
            }
            const times = transactions.map(t => t.created_at).filter(Boolean).sort()
            const rangeStart = times[0]
            const rangeEnd = times[times.length - 1]
            try {
                const batches = []
                for (let i = 0; i < patientIds.length; i += 100) {
                    batches.push(patientIds.slice(i, i + 100))
                }
                const results = await Promise.all(batches.map(async chunk => {
                    const [prior, inRange] = await Promise.all([
                        fetchAllPaginated(() => supabase
                            .from('transactions')
                            .select('id, patient_id')
                            .in('patient_id', chunk)
                            .lt('created_at', rangeStart)
                            .order('id', { ascending: true })),
                        fetchAllPaginated(() => supabase
                            .from('transactions')
                            .select('id, patient_id, created_at')
                            .in('patient_id', chunk)
                            .gte('created_at', rangeStart)
                            .lte('created_at', rangeEnd)
                            .order('created_at', { ascending: true })
                            .order('id', { ascending: true }))
                    ])
                    if (prior.error) throw prior.error
                    if (inRange.error) throw inRange.error
                    return { prior: prior.data || [], inRange: inRange.data || [] }
                }))
                if (!isCurrent) return
                const map = {}
                results.forEach(({ prior }) => {
                    // Sudah pernah bertransaksi sebelumnya: tidak ada transaksi di rentang ini
                    // yang merupakan transaksi pertamanya.
                    prior.forEach(t => {
                        if (t.patient_id) map[t.patient_id] = { id: null, created_at: null }
                    })
                })
                results.forEach(({ inRange }) => {
                    inRange.forEach(t => {
                        if (t.patient_id && !map[t.patient_id]) {
                            map[t.patient_id] = { id: t.id, created_at: t.created_at }
                        }
                    })
                })
                setPatientFirstTxMap(map)
            } catch (e) {
                console.error('Error resolving patient first transactions:', e)
            }
        }
        resolveFirstTransactions()
        return () => { isCurrent = false }
    }, [transactions])

    // Helper jenis kelamin & umur pasien (format ringkas: Pr • 22 th / Lk • 28 th)
    const formatGenderAge = (patient) => {
        if (!patient) return null
        const parts = []
        if (patient.gender) {
            const g = String(patient.gender).toLowerCase().trim()
            if (g === 'female' || g === 'wanita' || g === 'perempuan') parts.push('PR')
            else if (g === 'male' || g === 'pria' || g === 'laki-laki') parts.push('LK')
        }
        if (patient.birth_date) {
            const birthDate = new Date(patient.birth_date)
            if (!isNaN(birthDate.getTime())) {
                const today = new Date()
                let age = today.getFullYear() - birthDate.getFullYear()
                const m = today.getMonth() - birthDate.getMonth()
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--
                }
                if (age > 0 && age < 120) {
                    parts.push(`${age} th`)
                }
            }
        }
        return parts.length > 0 ? parts.join(' • ') : null
    }

    // Sebelum Diskon - Diskon - Redeem Kupon = Total Bayar, dihitung dengan rumus yang sama
    // dengan dashboard (lib/revenueBreakdown.js). Dulu halaman ini punya rumus sendiri yang
    // mengambil harga katalog saat ini, sehingga angkanya bisa berbeda dari dashboard.
    const getCleanTxPricing = (tx) => getTransactionPricingSummary(tx)

    // Helper status customer: New Customer vs Repeat vs Walk-in
    const getCustomerStatus = (tx) => {
        if (!tx || !tx.patient_id) {
            return {
                type: 'walk-in',
                label: 'Walk-in',
                fullLabel: 'Walk-in Customer',
                badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/80'
            }
        }
        const firstTx = patientFirstTxMap[tx.patient_id]
        const isFirst = firstTx?.id === tx.id
        const txDateStr = tx.created_at ? tx.created_at.slice(0, 10) : ''
        const patRegStr = tx.patients?.created_at ? tx.patients.created_at.slice(0, 10) : ''
        const isSameDayReg = txDateStr && patRegStr && txDateStr === patRegStr

        if (isFirst || isSameDayReg) {
            return {
                type: 'new',
                label: 'Baru',
                fullLabel: 'Pasien Baru',
                badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
            }
        }
        return {
            type: 'repeat',
            label: 'Repeat',
            fullLabel: 'Repeat Customer',
            badgeClass: 'bg-blue-50 text-blue-700 border-blue-200/80'
        }
    }

    // Get filtered valid transactions for Main Tab KPI & summary calculations
    const filteredValidTransactions = useMemo(() => {
        return validTransactions.filter(tx => {
            // 1. Branch Filter
            if (filterBranch && tx.branch_id !== filterBranch) return false

            // 2. Payment Method Filter
            if (filterPaymentMethod && tx.payment_method !== filterPaymentMethod) return false

            // 3. Transaction Type Filter
            if (filterTxType) {
                const hasType = tx.transaction_items?.some(item => item.item_type === filterTxType)
                if (!hasType) return false
            }

            // 4. Customer Type Filter
            if (filterCustomerType) {
                const cStatus = getCustomerStatus(tx)
                if (cStatus.type !== filterCustomerType) return false
            }

            // 5. Period Date Filter
            const txDate = new Date(tx.created_at)
            const start = new Date(customStartDate + 'T00:00:00')
            const end = new Date(customEndDate + 'T23:59:59')
            return txDate >= start && txDate <= end
        })
    }, [validTransactions, filterBranch, filterPaymentMethod, filterTxType, filterCustomerType, customStartDate, customEndDate, patientFirstTxMap])

    // Get current raw transactions list based on main tab filter & parameters (for Table listing so VOID rows remain visible)
    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            // 1. Branch Filter
            if (filterBranch && tx.branch_id !== filterBranch) return false

            // 2. Payment Method Filter
            if (filterPaymentMethod && tx.payment_method !== filterPaymentMethod) return false

            // 3. Transaction Type Filter
            if (filterTxType) {
                const hasType = tx.transaction_items?.some(item => item.item_type === filterTxType)
                if (!hasType) return false
            }

            // 4. Customer Type Filter
            if (filterCustomerType) {
                const cStatus = getCustomerStatus(tx)
                if (cStatus.type !== filterCustomerType) return false
            }

            // 5. Period Date Filter
            const txDate = new Date(tx.created_at)
            const start = new Date(customStartDate + 'T00:00:00')
            const end = new Date(customEndDate + 'T23:59:59')
            return txDate >= start && txDate <= end
        })
    }, [transactions, filterBranch, filterPaymentMethod, filterTxType, filterCustomerType, customStartDate, customEndDate, patientFirstTxMap])

    // Paginated transactions for Tab 1
    const totalPages = Math.ceil(filteredTransactions.length / pageSize) || 1
    const safeCurrentPage = Math.min(currentPage, totalPages)
    const paginatedTransactions = useMemo(() => {
        if (pageSize === -1) return filteredTransactions
        const start = (safeCurrentPage - 1) * pageSize
        return filteredTransactions.slice(start, start + pageSize)
    }, [filteredTransactions, safeCurrentPage, pageSize])

    // Tab-scoped valid datasets
    const dailyValidTransactions = useMemo(
        () => dailyTransactions.filter(tx => tx.payment_status === 'paid'),
        [dailyTransactions]
    )
    const weeklyValidTransactions = useMemo(
        () => weeklyTransactions.filter(tx => tx.payment_status === 'paid'),
        [weeklyTransactions]
    )
    const monthlyValidTransactions = useMemo(
        () => monthlyTransactions.filter(tx => tx.payment_status === 'paid'),
        [monthlyTransactions]
    )
    const yearlyValidTransactions = useMemo(
        () => yearlyTransactions.filter(tx => tx.payment_status === 'paid'),
        [yearlyTransactions]
    )

    // Summary calculations for the main view (derived strictly from validTransactions)
    const mainSummary = useMemo(() => {
        let totalRevenue = 0
        let totalTx = 0
        let totalQrisFee = 0
        let treatmentQty = 0
        let productQty = 0
        let couponQty = 0
        let treatmentRevenue = 0
        let productRevenue = 0
        let couponRevenue = 0

        filteredValidTransactions.forEach(tx => {
            totalTx += 1
            totalQrisFee += getQrisFee(tx)
            // Pendapatan per jenis = bagian bersih (setelah diskon dan biaya QRIS), sama dengan
            // dashboard, sehingga treatment + produk + kupon = total pendapatan.
            const breakdown = getTransactionRevenueBreakdown(tx)
            totalRevenue += breakdown.netTotal
            treatmentRevenue += breakdown.net.treatment
            productRevenue += breakdown.net.product
            couponRevenue += breakdown.net.coupon
            tx.transaction_items?.forEach(item => {
                if (item.item_type === 'treatment') treatmentQty += item.quantity || 0
                else if (item.item_type === 'product') productQty += item.quantity || 0
                else if (item.item_type === 'coupon') couponQty += item.quantity || 0
            })
        })

        const avgRevenue = totalTx > 0 ? totalRevenue / totalTx : 0

        return {
            totalRevenue,
            totalTx,
            totalQrisFee,
            avgRevenue,
            treatmentQty,
            productQty,
            couponQty,
            treatmentRevenue,
            productRevenue,
            couponRevenue
        }
    }, [filteredValidTransactions])

    // Formatter helpers
    const formatCurrency = (val) => {
        // Dibulatkan ke rupiah: rata-rata dan bagian bersih bisa berupa pecahan
        // (sebelumnya tampil seperti "Rp 289.329,149").
        return 'Rp ' + Math.round(Number(val || 0)).toLocaleString('id-ID')
    }

    const formatDate = (isoString) => {
        if (!isoString) return '-'
        const date = new Date(isoString)
        return date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const formatDateParts = (isoString) => {
        if (!isoString) return { dateStr: '-', timeStr: '' }
        const d = new Date(isoString)
        const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
        const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':')
        return { dateStr, timeStr }
    }

    // WA Share Link creator
    const handleSendWA = (tx) => {
        if (!tx) return
        let phoneRaw = tx.patients?.whatsapp || ''
        if (!phoneRaw) {
            const inputPhone = window.prompt(
                'Nomor WhatsApp pasien belum terdaftar.\nSilakan masukkan nomor WhatsApp tujuan (contoh: 08123456789):'
            )
            if (!inputPhone || !inputPhone.trim()) {
                return
            }
            phoneRaw = inputPhone.trim()
        }

        const itemsText = tx.transaction_items
            ?.map(i => `- ${i.name} (${i.quantity}x) : ${formatCurrency(i.subtotal)}`)
            .join('\n') || ''

        const customerName = tx.patients?.full_name || 'Pelanggan Ayumi'
        const text = `Halo *${customerName}*,\n\nTerima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House.\nBerikut adalah rincian transaksi Anda:\n\nNo. Transaksi: *${tx.transaction_number}*\nTanggal: ${formatDate(tx.created_at)}\nCabang: ${tx.branches?.name || 'Ayumi Clinic'}\n\n*Item:*\n${itemsText}\n\n*Subtotal:* ${formatCurrency(tx.subtotal)}\n*Diskon:* ${formatCurrency(tx.discount)}\n*Total Bayar:* *${formatCurrency(tx.total)}*\n*Metode Pembayaran:* ${tx.payment_method?.toUpperCase() || '-'}\nStatus: LUNAS\n\nHubungi kami jika ada pertanyaan. Sampai jumpa kembali!`

        openWhatsApp(phoneRaw, text)
    }

    // Detail Modal Renderer
    const openDetailModal = (tx) => {
        setSelectedTx(tx)
        setIsDetailModalOpen(true)
        setIsEditingTx(false)
        setEditTxData({
            payment_method: tx.payment_method || '',
            notes: tx.notes || '',
            created_at: tx.created_at ? new Date(tx.created_at).toISOString().slice(0, 16) : ''
        })
    }

    const closeDetailModal = () => {
        setSelectedTx(null)
        setIsDetailModalOpen(false)
        setIsEditingTx(false)
    }

    const handleVoidTx = async (tx) => {
        if (!tx) return
        if (tx.payment_status === 'void') {
            alert('Transaksi ini sudah berstatus VOID.')
            return
        }

        const reason = window.prompt(`Konfirmasi Pembatalan Transaksi ${tx.transaction_number}:\nMasukkan alasan pembatalan transaksi secara jelas:`)
        if (!reason || !reason.trim()) {
            alert('Alasan pembatalan wajib diisi.')
            return
        }

        try {
            const { data, error } = await supabase.rpc('void_transaction', {
                p_transaction_id: tx.id,
                p_reason: reason.trim()
            })

            if (error) throw error

            alert(data?.message || 'Transaksi berhasil dibatalkan (VOID).')
            closeDetailModal()
            fetchTransactions()
        } catch (err) {
            console.error('Error voiding transaction:', err)
            alert('Gagal membatalkan transaksi: ' + (err.message || err.error_description || err))
        }
    }

    const handleDeleteTx = async (tx) => {
        if (!tx) return
        if (dbUser?.role !== 'owner') {
            toast.error('Hanya Owner yang memiliki izin menghapus transaksi.')
            return
        }

        const confirmText = window.prompt(
            `⚠️ PERINGATAN HAPUS PERMANEN (KHUSUS OWNER)\n\nApakah Anda yakin ingin menghapus transaksi "${tx.transaction_number}" secara permanen?\n\n- Data transaksi akan dihapus BERSIH dari database dan laporan omzet.\n- Stok produk yang terjual akan otomatis dikembalikan (jika belum di-void).\n\nKetik "HAPUS" untuk konfirmasi:`
        )

        if (confirmText !== 'HAPUS') {
            if (confirmText !== null) {
                toast.error('Penghapusan dibatalkan. Kata kunci konfirmasi tidak sesuai.')
            }
            return
        }

        setIsDeletingTx(true)
        const loadToast = toast.loading(`Menghapus transaksi ${tx.transaction_number}...`)
        try {
            const res = await fetch(`/api/transactions/${tx.id}`, {
                method: 'DELETE'
            })
            const resData = await res.json()

            if (!res.ok) {
                throw new Error(resData.error || 'Gagal menghapus transaksi.')
            }

            toast.success(resData.message || `Transaksi ${tx.transaction_number} berhasil dihapus.`, { id: loadToast })
            closeDetailModal()
            fetchTransactions()
        } catch (err) {
            console.error('Error deleting transaction:', err)
            toast.error(err.message || 'Gagal menghapus transaksi.', { id: loadToast })
        } finally {
            setIsDeletingTx(false)
        }
    }

    const handleSaveEditedTx = async () => {
        if (!selectedTx) return

        try {
            // Hanya update kolom yang diizinkan (payment_method & notes). created_at terkunci permanen!
            const { error: updateErr } = await supabase
                .from('transactions')
                .update({
                    payment_method: editTxData.payment_method,
                    notes: editTxData.notes
                })
                .eq('id', selectedTx.id)

            if (updateErr) throw updateErr

            alert('Transaksi berhasil diperbarui.')
            closeDetailModal()
            fetchTransactions()

        } catch (err) {
            console.error('Error updating transaction:', err)
            alert('Gagal memperbarui transaksi: ' + err.message)
        }
    }

    // Helper for Excel export
    const handleExcelExport = (reportType, title, dataset) =>
        exportTransactionsExcel({ reportType, title, dataset, branches, filterBranch, formatDate, formatGenderAge, getCleanTxPricing, getCustomerStatus })

    const handlePDFExport = (reportType, title, dataset) =>
        exportTransactionsPdf({ reportType, title, dataset, branches, dbUser, filterBranch, formatCurrency })


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 2: DAILY REPORT
    // ==========================================
    const dailyData = useMemo(() => {
        const selectedDate = new Date(dailyReportDate)
        const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
        const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999)

        const txList = dailyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        let revenue = 0
        const payMethods = { cash: { count: 0, total: 0 }, transfer: { count: 0, total: 0 }, qris: { count: 0, total: 0 }, debit: { count: 0, total: 0 }, credit: { count: 0, total: 0 } }
        const typeBreakdown = { treatment: { qty: 0, total: 0 }, product: { qty: 0, total: 0 }, coupon: { qty: 0, total: 0 } }
        
        // Hour bins 00:00 to 23:00
        const hourlyBins = Array.from({ length: 24 }, (_, i) => ({ hour: `${String(i).padStart(2, '0')}:00`, transaksi: 0, pendapatan: 0 }))

        txList.forEach(tx => {
            const txNet = getNetTransactionRevenue(tx)
            revenue += txNet
            const splits = parsePaymentSplits(tx)
            Object.entries(splits).forEach(([m, amt]) => {
                if (payMethods[m] && amt > 0) {
                    payMethods[m].count++
                    payMethods[m].total += amt
                }
            })

            const h = new Date(tx.created_at).getHours()
            hourlyBins[h].transaksi++
            hourlyBins[h].pendapatan += txNet

            const breakdown = getTransactionRevenueBreakdown(tx)
            Object.keys(typeBreakdown).forEach(type => {
                typeBreakdown[type].total += breakdown.net[type] || 0
            })
            tx.transaction_items?.forEach(item => {
                const type = item.item_type
                if (typeBreakdown[type]) {
                    typeBreakdown[type].qty += item.quantity || 0
                }
            })
        })

        // Filter hour bins to only show busy times (e.g. 08:00 to 21:00) to keep chart clean
        const activeHours = hourlyBins.filter((_, i) => i >= 8 && i <= 21)

        return {
            txList,
            revenue,
            totalTx: txList.length,
            payMethods,
            typeBreakdown,
            activeHours
        }
    }, [dailyValidTransactions, dailyReportDate, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 3: WEEKLY REPORT
    // ==========================================
    const weeklyData = useMemo(() => {
        const start = new Date(weeklyReportStart + 'T00:00:00')
        const end = new Date(start)
        end.setDate(start.getDate() + 7)

        // Previous Week dates for comparison
        const prevStart = new Date(start)
        prevStart.setDate(prevStart.getDate() - 7)
        const prevEnd = new Date(start)

        const txList = weeklyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate < end
        })

        const prevTxList = weeklyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate < prevEnd
        })

        let revenue = 0
        const daysOfWeek = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
        const dailyRevenue = daysOfWeek.map(day => ({ name: day, pendapatan: 0, transaksi: 0 }))
        const branchBreakdown = {}

        txList.forEach(tx => {
            const txNet = getNetTransactionRevenue(tx)
            const txFee = getQrisFee(tx)
            revenue += txNet
            const dayIdx = new Date(tx.created_at).getDay()
            dailyRevenue[dayIdx].pendapatan += txNet
            dailyRevenue[dayIdx].transaksi++

            const brName = tx.branches?.name || 'Tanpa Cabang'
            if (!branchBreakdown[brName]) {
                branchBreakdown[brName] = { name: brName, count: 0, total: 0, qrisFee: 0 }
            }
            branchBreakdown[brName].count++
            branchBreakdown[brName].total += txNet
            branchBreakdown[brName].qrisFee += txFee
        })

        // Sort chart starting from Monday
        const orderedRevenue = [
            dailyRevenue[1], // Senin
            dailyRevenue[2], // Selasa
            dailyRevenue[3], // Rabu
            dailyRevenue[4], // Kamis
            dailyRevenue[5], // Jumat
            dailyRevenue[6], // Sabtu
            dailyRevenue[0], // Minggu
        ]

        // Find busy days
        let busiestDay = '-'
        let maxTx = -1
        let highestRevDay = '-'
        let maxRev = -1

        dailyRevenue.forEach((d, idx) => {
            if (d.transaksi > maxTx) {
                maxTx = d.transaksi
                busiestDay = daysOfWeek[idx]
            }
            if (d.pendapatan > maxRev) {
                maxRev = d.pendapatan
                highestRevDay = daysOfWeek[idx]
            }
        })

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        return {
            txList,
            revenue,
            totalTx: txList.length,
            busiestDay: maxTx > 0 ? busiestDay : '-',
            highestRevDay: maxRev > 0 ? highestRevDay : '-',
            orderedRevenue,
            prevRevenue,
            growthPercent,
            branchBreakdown: Object.values(branchBreakdown)
        }
    }, [weeklyValidTransactions, weeklyReportStart, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 4: MONTHLY REPORT
    // ==========================================
    const monthlyData = useMemo(() => {
        const start = new Date(monthlyReportYear, monthlyReportMonth, 1)
        const end = new Date(monthlyReportYear, monthlyReportMonth + 1, 0, 23, 59, 59, 999)

        const prevStart = new Date(monthlyReportYear, monthlyReportMonth - 1, 1)
        const prevEnd = new Date(monthlyReportYear, monthlyReportMonth, 0, 23, 59, 59, 999)

        const txList = monthlyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        const prevTxList = monthlyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate <= prevEnd
        })

        let revenue = 0
        
        // 4 Weekly bins
        const weekBins = [
            { name: 'Minggu 1', pendapatan: 0 },
            { name: 'Minggu 2', pendapatan: 0 },
            { name: 'Minggu 3', pendapatan: 0 },
            { name: 'Minggu 4+', pendapatan: 0 }
        ]

        // Top Selling Counters
        const treatments = {}
        const products = {}
        const coupons = {}
        const branchesMap = {}
        const payMethods = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }

        txList.forEach(tx => {
            const val = getNetTransactionRevenue(tx)
            revenue += val

            // Map payment method (support split payments)
            const splits = parsePaymentSplits(tx)
            Object.entries(splits).forEach(([m, amt]) => {
                if (payMethods[m] !== undefined) {
                    payMethods[m] += amt
                }
            })

            // Map weekly bins
            const day = new Date(tx.created_at).getDate()
            if (day <= 7) weekBins[0].pendapatan += val
            else if (day <= 14) weekBins[1].pendapatan += val
            else if (day <= 21) weekBins[2].pendapatan += val
            else weekBins[3].pendapatan += val

            // Map branches
            const brName = tx.branches?.name || 'Tanpa Cabang'
            const txFee = getQrisFee(tx)
            if (!branchesMap[brName]) {
                branchesMap[brName] = { name: brName, count: 0, total: 0, qrisFee: 0 }
            }
            branchesMap[brName].count++
            branchesMap[brName].total += val
            branchesMap[brName].qrisFee += txFee

            // Map top sellers
            tx.transaction_items?.forEach(item => {
                const qty = item.quantity || 0
                const name = item.name
                if (item.item_type === 'treatment') {
                    treatments[name] = (treatments[name] || 0) + qty
                } else if (item.item_type === 'product') {
                    products[name] = (products[name] || 0) + qty
                } else if (item.item_type === 'coupon') {
                    coupons[name] = (coupons[name] || 0) + qty
                }
            })
        })

        const topTreatments = Object.entries(treatments).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)
        const topProducts = Object.entries(products).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)
        const topCoupons = Object.entries(coupons).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        const daysInMonth = end.getDate()
        const dailyAvg = revenue / daysInMonth

        // Pie Chart Data
        const pieData = Object.entries(payMethods)
            .filter(([_, val]) => val > 0)
            .map(([name, value]) => ({ name: name.toUpperCase(), value }))

        return {
            txList,
            revenue,
            totalTx: txList.length,
            growthPercent,
            dailyAvg,
            weekBins,
            topTreatments,
            topProducts,
            topCoupons,
            branchBreakdown: Object.values(branchesMap),
            pieData
        }
    }, [monthlyValidTransactions, monthlyReportMonth, monthlyReportYear, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 5: YEARLY REPORT
    // ==========================================
    const yearlyData = useMemo(() => {
        const start = new Date(yearlyReportYear, 0, 1)
        const end = new Date(yearlyReportYear, 11, 31, 23, 59, 59, 999)

        const prevStart = new Date(yearlyReportYear - 1, 0, 1)
        const prevEnd = new Date(yearlyReportYear - 1, 11, 31, 23, 59, 59, 999)

        const txList = yearlyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        const prevTxList = yearlyValidTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate <= prevEnd
        })

        let revenue = 0
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
        const monthlyRevenue = months.map(m => ({ name: m, pendapatan: 0, transaksi: 0 }))

        const treatments = {}
        const products = {}
        const coupons = {}
        const branchPivot = {} // { BranchName: { Jan: 0, Feb: 0 ... } }

        txList.forEach(tx => {
            const val = getNetTransactionRevenue(tx)
            revenue += val

            const mIdx = new Date(tx.created_at).getMonth()
            monthlyRevenue[mIdx].pendapatan += val
            monthlyRevenue[mIdx].transaksi++

            // Branch comparison per month
            const brName = tx.branches?.name || 'Tanpa Cabang'
            if (!branchPivot[brName]) {
                branchPivot[brName] = months.reduce((acc, m) => ({ ...acc, [m]: 0 }), {})
            }
            branchPivot[brName][months[mIdx]] += val

            // Top items
            tx.transaction_items?.forEach(item => {
                const qty = item.quantity || 0
                const name = item.name
                if (item.item_type === 'treatment') {
                    treatments[name] = (treatments[name] || 0) + qty
                } else if (item.item_type === 'product') {
                    products[name] = (products[name] || 0) + qty
                } else if (item.item_type === 'coupon') {
                    coupons[name] = (coupons[name] || 0) + qty
                }
            })
        })

        let bestMonth = '-'
        let maxMRev = -1
        monthlyRevenue.forEach((m, idx) => {
            if (m.pendapatan > maxMRev) {
                maxMRev = m.pendapatan
                bestMonth = months[idx]
            }
        })

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        const topTreatment = Object.entries(treatments).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'
        const topProduct = Object.entries(products).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'
        const topCoupon = Object.entries(coupons).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'

        // Pivot array helper
        const branchPivotList = Object.entries(branchPivot).map(([branchName, monthlyDataObj]) => ({
            branchName,
            ...monthlyDataObj
        }))

        return {
            txList,
            revenue,
            totalTx: txList.length,
            bestMonth: maxMRev > 0 ? bestMonth : '-',
            growthPercent,
            monthlyRevenue,
            topTreatment,
            topProduct,
            topCoupon,
            branchPivotList
        }
    }, [yearlyValidTransactions, yearlyReportYear, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 6: CUSTOM REPORT
    // ==========================================
    const handleGenerateCustomReport = async () => {
        setIsCustomGenerating(true)
        try {
            const rows = await queryTransactionsWithRange(supabase, {
                startDate: customTabStart,
                endDate: customTabEnd,
                branchId: customTabBranch,
                effectiveUser: dbUser
            })

            const txList = rows.filter(tx => {
                if (tx.payment_status !== 'paid') return false
                if (customTabTxType) {
                    const hasType = tx.transaction_items?.some(item => item.item_type === customTabTxType)
                    if (!hasType) return false
                }
                return true
            })

            let revenue = 0
            let totalQrisFee = 0
            let treatmentQty = 0
            let productQty = 0
            let couponQty = 0
            let treatmentRevenue = 0
            let productRevenue = 0
            let couponRevenue = 0

            txList.forEach(tx => {
                totalQrisFee += getQrisFee(tx)
                const breakdown = getTransactionRevenueBreakdown(tx)
                revenue += breakdown.netTotal
                treatmentRevenue += breakdown.net.treatment
                productRevenue += breakdown.net.product
                couponRevenue += breakdown.net.coupon
                tx.transaction_items?.forEach(item => {
                    if (item.item_type === 'treatment') {
                        treatmentQty += item.quantity || 0
                    } else if (item.item_type === 'product') {
                        productQty += item.quantity || 0
                    } else if (item.item_type === 'coupon') {
                        couponQty += item.quantity || 0
                    }
                })
            })

            setCustomReportResult({
                txList,
                revenue,
                totalQrisFee,
                totalTx: txList.length,
                avg: txList.length > 0 ? revenue / txList.length : 0,
                treatmentQty,
                productQty,
                couponQty,
                treatmentRevenue,
                productRevenue,
                couponRevenue
            })
        } catch (err) {
            console.error('Error generating custom report:', err)
            toast.error('Gagal membuat custom report')
        } finally {
            setIsCustomGenerating(false)
        }
    }

    // Chart Colors
    const COLORS = ['#D46221', '#4E2A12', '#F2D8C3', '#E8B895', '#914214']

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memuat data transaksi & laporan...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            
            {/* TAMPILAN UTAMA: HEADER ATAS & EXPORT ACTIONS */}
            <div className="card-ayumi p-4 md:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white shadow-sm border border-pink-100">
                <div>
                    <h2 className="text-xl font-extrabold text-gray-800 tracking-tight">Riwayat Transaksi</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Pantau catatan transaksi penjualan, pencetakan struk, dan laporan berkala klinik.</p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
                    {/* Excel & PDF Export Buttons */}
                    <button
                        onClick={() => handleExcelExport('Main', 'Semua_Transaksi', filteredTransactions)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-green-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer flex-1 sm:flex-initial"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export Excel
                    </button>
                    <button
                        onClick={() => handlePDFExport('Main', 'Semua_Transaksi', filteredTransactions)}
                        className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-orange-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer flex-1 sm:flex-initial"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Cetak Laporan PDF
                    </button>
                </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
                {/* 1. Total Pendapatan */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-emerald-50/50 to-white shadow-sm border border-emerald-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Total Pendapatan</h4>
                        <p className="text-xl font-extrabold text-gray-800 tracking-tight mt-0.5">{formatCurrency(mainSummary.totalRevenue)}</p>
                    </div>
                </div>

                {/* 2. Pendapatan Treatment */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-purple-50/50 to-white shadow-sm border border-purple-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 9.172V5L8 4z" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-purple-600 uppercase tracking-widest">Pendapatan Treatment</h4>
                        <p className="text-xl font-black text-gray-800 mt-0.5">{formatCurrency(mainSummary.treatmentRevenue)}</p>
                    </div>
                </div>

                {/* 3. Pendapatan Skincare / Produk */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-orange-50/50 to-white shadow-sm border border-orange-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Pendapatan Produk</h4>
                        <p className="text-xl font-black text-gray-800 mt-0.5">{formatCurrency(mainSummary.productRevenue)}</p>
                    </div>
                </div>

                {/* 4. Sesi Kupon Terpakai (Redeem) */}
                <div 
                    onClick={() => setIsCouponRedeemModalOpen(true)}
                    className="card-ayumi p-5 flex items-center justify-between bg-gradient-to-br from-amber-50/60 to-white shadow-sm border border-amber-200/80 hover:border-amber-300 hover:shadow-md transition-all duration-300 cursor-pointer group/kpn"
                    title="Klik untuk melihat rincian penukaran sesi kupon"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-inner shrink-0 group-hover/kpn:scale-105 transition-transform text-xl">
                            🎟️
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <h4 className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Sesi Kupon Terpakai</h4>
                                <span className="text-[9px] font-extrabold text-amber-800 bg-amber-100/90 group-hover/kpn:bg-amber-200 px-1.5 py-0.5 rounded transition-colors">
                                    Rincian ↗
                                </span>
                            </div>
                            <p className="text-xl font-black text-amber-950 mt-0.5">
                                {formatCurrency(couponRedeemedTotals.value)}
                            </p>
                            <p className="text-[11px] font-bold text-amber-700 mt-0.5">
                                {couponRedeemedTotals.sessions} Sesi Terpakai
                            </p>
                        </div>
                    </div>
                </div>

                {/* 5. Biaya Tambahan QRIS */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-violet-50/50 to-white shadow-sm border border-violet-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <h4 className="text-[10px] font-black text-violet-600 uppercase tracking-widest">Biaya Tambahan QRIS</h4>
                            <span className="text-[9px] font-extrabold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">0.3% MDR</span>
                        </div>
                        <p className="text-xl font-extrabold text-violet-900 tracking-tight mt-0.5">{formatCurrency(mainSummary.totalQrisFee)}</p>
                    </div>
                </div>

                {/* 6. Total Transaksi */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-pink-100/50 text-ayumi-primary flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Transaksi</h4>
                        <p className="text-xl font-black text-gray-800 mt-0.5">{mainSummary.totalTx}</p>
                    </div>
                </div>

                {/* 7. Rata-rata Penjualan */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100/50 text-blue-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rata-rata Penjualan</h4>
                        <p className="text-xl font-black text-gray-800 mt-0.5">{formatCurrency(mainSummary.avgRevenue)}</p>
                    </div>
                </div>

                {/* 8. Kuantitas Item Terjual */}
                <div className="card-ayumi p-5 flex flex-col justify-center bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Kuantitas Item Terjual</h4>
                    <div className="flex justify-between items-center text-xs font-semibold text-gray-600">
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-purple-600 uppercase font-extrabold tracking-wider">Treatment</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.treatmentQty}</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-orange-600 uppercase font-extrabold tracking-wider">Produk</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.productQty}</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-pink-600 uppercase font-extrabold tracking-wider">Kupon</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.couponQty}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* SIX TABS NAVIGATION */}
            <div className="flex overflow-x-auto gap-2 border-b border-gray-200 hide-scrollbar pt-2">
                {[
                    { id: 'all', label: 'Semua Transaksi' },
                    { id: 'daily', label: 'Laporan Harian' },
                    { id: 'weekly', label: 'Laporan Mingguan' },
                    { id: 'monthly', label: 'Laporan Bulanan' },
                    { id: 'yearly', label: 'Laporan Tahunan' },
                    { id: 'custom', label: 'Custom Report' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveMainTab(tab.id)}
                        className={`px-5 py-3 text-sm font-bold transition-all rounded-t-xl shrink-0 ${
                            activeMainTab === tab.id
                            ? 'bg-white text-ayumi-primary border-t-2 border-x border-[#fce7f3] border-b-0'
                            : 'text-gray-500 hover:text-ayumi-primary hover:bg-white/50 border border-transparent'
                        }`}
                        style={{ marginBottom: activeMainTab === tab.id ? '-1px' : '0' }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* TAB PANES CONTENT CONTAINER */}
            <div className="bg-white rounded-b-2xl rounded-tr-2xl shadow-sm border border-gray-100 p-4 md:p-6 min-h-[400px]">

                {/* ======================================================== */}
                {/* TAB 1: ALL TRANSACTIONS */}
                {/* ======================================================== */}
                {activeMainTab === 'all' && (
                    <div className="space-y-4">
                        {/* HEADER DAFTAR TRANSAKSI & FILTER LANGSUNG DI ATAS TABEL */}
                        <div className="card-ayumi p-4 md:p-5 flex flex-col gap-4 bg-white border border-gray-100 shadow-sm rounded-2xl">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-ayumi-secondary">Daftar Transaksi</h3>
                                    <p className="text-xs text-gray-400">Total {filteredTransactions.length} transaksi ditemukan berdasarkan filter</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-500 font-semibold">Tampilkan:</label>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => {
                                            setPageSize(Number(e.target.value))
                                            setCurrentPage(1)
                                        }}
                                        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-ayumi-primary"
                                    >
                                        <option value={10}>10 baris</option>
                                        <option value={25}>25 baris</option>
                                        <option value={50}>50 baris</option>
                                        <option value={100}>100 baris</option>
                                        <option value={-1}>Semua ({filteredTransactions.length})</option>
                                    </select>
                                </div>
                            </div>

                            {/* Grid Filter Langsung di Atas Kolom Tabel */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 border-t border-gray-100 pt-3">
                                {/* Branch Filter */}
                                <BranchFilter
                                    value={filterBranch}
                                    onChange={setFilterBranch}
                                    branches={branches}
                                    userRole={dbUser?.role}
                                    userBranchId={dbUser?.branch_id}
                                />

                                {/* Customer Type Filter */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tipe Pasien</label>
                                    <select
                                        value={filterCustomerType}
                                        onChange={(e) => {
                                            setFilterCustomerType(e.target.value)
                                            setCurrentPage(1)
                                        }}
                                        className="input-ayumi py-2 text-xs bg-gray-50 font-semibold text-gray-700"
                                    >
                                        <option value="">Semua Pasien</option>
                                        <option value="new">Pasien Baru</option>
                                        <option value="repeat">Pasien Repeat</option>
                                        <option value="walk-in">Walk-in Customer</option>
                                    </select>
                                </div>

                                {/* Payment Method */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Metode Bayar</label>
                                    <select
                                        value={filterPaymentMethod}
                                        onChange={(e) => setFilterPaymentMethod(e.target.value)}
                                        className="input-ayumi py-2 text-xs bg-gray-50 font-semibold text-gray-700"
                                    >
                                        <option value="">Semua Metode</option>
                                        <option value="cash">Cash</option>
                                        <option value="transfer">Transfer Bank</option>
                                        <option value="qris">QRIS</option>
                                        <option value="debit">Debit</option>
                                        <option value="credit">Credit</option>
                                    </select>
                                </div>

                                {/* Tx Type */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tipe Item</label>
                                    <select
                                        value={filterTxType}
                                        onChange={(e) => setFilterTxType(e.target.value)}
                                        className="input-ayumi py-2 text-xs bg-gray-50 font-semibold text-gray-700"
                                    >
                                        <option value="">Semua Tipe</option>
                                        <option value="treatment">Treatment</option>
                                        <option value="product">Produk</option>
                                        <option value="coupon">Kupon Paket</option>
                                    </select>
                                </div>

                                {/* Rentang Tanggal Filter */}
                                <div className="col-span-1 sm:col-span-2 lg:col-span-2 flex flex-col relative z-20">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rentang Tanggal</label>
                                    <DateRangePicker 
                                        startDate={customStartDate}
                                        endDate={customEndDate}
                                        onChange={(range) => {
                                            setCustomStartDate(range.startDate);
                                            setCustomEndDate(range.endDate);
                                        }}
                                        inputClassName="w-full input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg font-semibold"
                                        align="right"
                                    />
                                </div>
                            </div>
                        </div>

                        {isTableLoading ? (
                            <div className="p-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                                <div className="animate-spin w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full"></div>
                                <span className="text-sm font-semibold text-gray-500">Memuat transaksi...</span>
                            </div>
                        ) : filteredTransactions.length === 0 ? (
                            <div className="p-10 text-center text-gray-400 bg-white rounded-2xl border border-gray-100 shadow-sm">Tidak ada transaksi ditemukan. Silakan ubah filter.</div>
                        ) : (
                            <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                                <div className="overflow-x-auto">
                                    <table className="whitespace-nowrap w-full text-left border-collapse text-sm">
                                        <thead>
                                            <tr className="bg-ayumi-table-header text-ayumi-secondary border-b border-[#E8D0BD]">
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[13%] min-w-[155px]">No. Transaksi</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[10%] min-w-[110px]">Tanggal & Jam</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[18%] min-w-[185px]">Pasien</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[10%] min-w-[110px]">Cabang</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[11%] min-w-[125px]">Ringkasan Item</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[10%] min-w-[100px]">Terapis</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-center w-[7%] min-w-[85px]">Metode Bayar</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-right w-[8%] min-w-[105px]">Sebelum Diskon</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-right w-[9%] min-w-[115px]">Total</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-center w-[4%] min-w-[65px]">Status</th>
                                                <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-center w-[4%] min-w-[60px]">Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {paginatedTransactions.map((tx) => {
                                                // Compute brief summary string
                                                let t = 0, p = 0, c = 0
                                                tx.transaction_items?.forEach(i => {
                                                    if (i.item_type === 'treatment') t += i.quantity
                                                    if (i.item_type === 'product') p += i.quantity
                                                    if (i.item_type === 'coupon') c += i.quantity
                                                })

                                                // Customer status badge (New Customer vs Repeat vs Walk-in)
                                                const custStatus = getCustomerStatus(tx)

                                                // Pricing akurat sebelum diskon vs total
                                                const pricing = getCleanTxPricing(tx)

                                                // Therapist Name
                                                const therapistName = tx.treatment_records?.therapist?.full_name || null

                                                // Date and time parts
                                                const { dateStr, timeStr } = formatDateParts(tx.created_at)

                                                // Payment Method badge color
                                                let payBadgeClass = "bg-gray-100 text-gray-700 border-gray-200"
                                                if (tx.payment_method === 'cash') payBadgeClass = "bg-pink-50 text-pink-700 border-pink-200/80"
                                                if (tx.payment_method === 'transfer') payBadgeClass = "bg-blue-50 text-blue-700 border-blue-200/80"
                                                if (tx.payment_method === 'qris') payBadgeClass = "bg-green-50 text-green-700 border-green-200/80"
                                                if (tx.payment_method === 'debit' || tx.payment_method === 'credit') payBadgeClass = "bg-purple-50 text-purple-700 border-purple-200/80"

                                                return (
                                                    <tr 
                                                        key={tx.id} 
                                                        onClick={() => openDetailModal(tx)} 
                                                        className={`hover:bg-pink-50/25 transition-colors cursor-pointer group ${tx.payment_status === 'void' ? 'opacity-70 bg-rose-50/20' : ''}`}
                                                    >
                                                        <td className="py-3 px-4 font-mono font-bold text-xs text-gray-700 align-middle">
                                                            <span className={`inline-block px-2 py-0.5 rounded bg-gray-100/80 border border-gray-200 text-gray-700 ${tx.payment_status === 'void' ? 'line-through text-gray-400' : ''}`}>
                                                                {tx.transaction_number}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 text-xs align-middle">
                                                            <div className="font-semibold text-gray-800">{dateStr}</div>
                                                            <div className="text-[11px] text-gray-400 font-medium">{timeStr} WIB</div>
                                                        </td>
                                                        <td className="py-3 px-4 align-middle">
                                                            <div className="flex flex-col items-start gap-1">
                                                                <div className="flex items-center gap-1.5">
                                                                    {tx.patient_id ? (
                                                                        <Link 
                                                                            href={`/patients/${tx.patient_id}`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className="font-bold text-gray-900 hover:text-ayumi-primary hover:underline transition-colors text-sm inline-flex items-center gap-1 group/p"
                                                                            title="Buka Rekam Medis & Riwayat Pasien"
                                                                        >
                                                                            <span>{tx.patients?.full_name || 'Walk-in Customer'}</span>
                                                                            <span className="text-[11px] text-gray-400 group-hover/p:text-ayumi-primary group-hover/p:translate-x-0.5 group-hover/p:-translate-y-0.5 transition-transform">↗</span>
                                                                        </Link>
                                                                    ) : (
                                                                        <span className="font-bold text-gray-800 text-sm">{tx.patients?.full_name || 'Walk-in Customer'}</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${custStatus.badgeClass}`}>
                                                                        {custStatus.label}
                                                                    </span>
                                                                    {formatGenderAge(tx.patients) && (
                                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200/80">
                                                                            {formatGenderAge(tx.patients)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-gray-700 font-semibold text-xs align-middle">
                                                            {tx.branches?.name || '-'}
                                                        </td>
                                                        <td className="py-3 px-4 text-xs align-middle">
                                                            <div className="flex flex-wrap items-center gap-1">
                                                                {t > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-100">
                                                                        {t} Treatment
                                                                    </span>
                                                                )}
                                                                {p > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-100">
                                                                        {p} Produk
                                                                    </span>
                                                                )}
                                                                {c > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                                                                        {c} Kupon
                                                                    </span>
                                                                )}
                                                                {t === 0 && p === 0 && c === 0 && (
                                                                    <span className="text-gray-400 font-medium">-</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-xs align-middle">
                                                            {therapistName ? (
                                                                <span className="inline-flex items-center gap-1.5 font-bold text-gray-800 bg-pink-50/70 px-2.5 py-1 rounded-full border border-pink-100/90">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-ayumi-primary shrink-0"></span>
                                                                    <span>{therapistName}</span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400 font-medium px-2">-</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-center align-middle">
                                                            <div className="flex justify-center">
                                                                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${payBadgeClass}`}>
                                                                    {tx.payment_method}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-right text-xs align-middle">
                                                            <span className={`font-bold ${(pricing.discount > 0 || pricing.couponRedeem > 0) ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                                                {formatCurrency(pricing.sebelumDiskon)}
                                                            </span>
                                                        </td>
                                                        <td className={`py-3 px-4 text-right align-middle ${tx.payment_status === 'void' ? 'text-gray-400 line-through font-bold' : 'text-gray-900 font-extrabold'}`}>
                                                            <div className="flex flex-col items-end justify-center">
                                                                <span className="text-sm font-extrabold text-gray-900 tracking-tight">
                                                                    {formatCurrency(pricing.total)}
                                                                </span>
                                                                {pricing.discount > 0 && (
                                                                    <div className="mt-1 flex items-center justify-end">
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200/90 shadow-2xs">
                                                                            <svg className="w-2.5 h-2.5 text-rose-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                                                <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                                                            </svg>
                                                                            <span>Disc -{formatCurrency(pricing.discount)}</span>
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {pricing.couponRedeem > 0 && (
                                                                    <div className="mt-1 flex items-center justify-end">
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/90 shadow-2xs">
                                                                            <span>Redeem Kupon -{formatCurrency(pricing.couponRedeem)}</span>
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-center align-middle">
                                                            <div className="flex justify-center">
                                                                {tx.payment_status === 'void' ? (
                                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-700 border border-rose-200">
                                                                        VOID
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                        LUNAS
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-center align-middle">
                                                            <div className="flex justify-center">
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); openDetailModal(tx) }}
                                                                    className="text-xs font-bold text-ayumi-primary hover:text-white hover:bg-ayumi-primary bg-pink-50/80 hover:border-ayumi-primary border border-pink-200/80 px-3 py-1 rounded-lg transition-all shadow-2xs cursor-pointer"
                                                                >
                                                                    Lihat
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination Bar */}
                                {pageSize !== -1 && filteredTransactions.length > pageSize && (
                                    <div className="px-5 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-gray-50/40">
                                        <span className="text-gray-500 font-medium">
                                            Menampilkan {((safeCurrentPage - 1) * pageSize) + 1} - {Math.min(safeCurrentPage * pageSize, filteredTransactions.length)} dari {filteredTransactions.length} transaksi
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={safeCurrentPage === 1}
                                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                            >
                                                &larr; Prev
                                            </button>
                                            <div className="flex items-center gap-1 px-1">
                                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                                    .filter(p => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                                                    .reduce((acc, p, idx, arr) => {
                                                        if (idx > 0 && p - arr[idx - 1] > 1) {
                                                            acc.push(-1 * p)
                                                        }
                                                        acc.push(p)
                                                        return acc
                                                    }, [])
                                                    .map((p, idx) => p < 0 ? (
                                                        <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 font-bold">&hellip;</span>
                                                    ) : (
                                                        <button
                                                            key={p}
                                                            onClick={() => setCurrentPage(p)}
                                                            className={`w-7 h-7 rounded-lg font-bold text-xs transition-all ${
                                                                safeCurrentPage === p
                                                                    ? 'bg-ayumi-primary text-white shadow-sm'
                                                                    : 'text-gray-600 hover:bg-white border border-transparent hover:border-gray-200'
                                                            }`}
                                                        >
                                                            {p}
                                                        </button>
                                                    ))
                                                }
                                            </div>
                                            <button
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={safeCurrentPage === totalPages}
                                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                            >
                                                Next &rarr;
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 2: LAPORAN HARIAN */}
                {/* ======================================================== */}
                {activeMainTab === 'daily' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Tanggal:</label>
                                <DateRangePicker 
                                    startDate={dailyReportDate}
                                    endDate={dailyReportDate}
                                    singleDate={true}
                                    onChange={(range) => {
                                        if (range.startDate) setDailyReportDate(range.startDate);
                                    }}
                                    inputClassName="text-xs font-semibold py-1.5 bg-white shadow-sm"
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Harian', `Harian_${dailyReportDate}`, dailyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Harian', `Harian_${dailyReportDate}`, dailyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {isDailyLoading ? (
                            <div className="p-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                                <div className="animate-spin w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full"></div>
                                <span className="text-sm font-semibold text-gray-500">Memuat laporan harian...</span>
                            </div>
                        ) : (
                            <>
                                {/* Summary metrics for daily */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
                                        <div>
                                            <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Transaksi Hari Ini</h5>
                                            <p className="text-2xl font-black text-gray-800">{dailyData.totalTx}</p>
                                        </div>
                                        <div className="text-ayumi-primary bg-pink-50 p-3 rounded-xl"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg></div>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
                                        <div>
                                            <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Pendapatan Hari Ini</h5>
                                            <p className="text-2xl font-black text-gray-800  text-green-600">{formatCurrency(dailyData.revenue)}</p>
                                        </div>
                                        <div className="text-green-600 bg-green-50 p-3 rounded-xl"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
                                    </div>
                                </div>

                                {/* Breakdown tables */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Payment method breakdown */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Metode Pembayaran</h4>
                                        <table className="whitespace-nowrap w-full text-left text-xs">
                                            <thead>
                                                <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                                    <th className="p-3">Metode Bayar</th>
                                                    <th className="p-3 text-center">Jumlah Transaksi</th>
                                                    <th className="p-3 text-right">Pendapatan</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {Object.entries(dailyData.payMethods).map(([method, data]) => (
                                                    <tr key={method} className="hover:bg-gray-50/50">
                                                        <td className="p-3 font-bold uppercase text-gray-700">{method}</td>
                                                        <td className="p-3 text-center font-bold text-gray-600">{data.count}</td>
                                                        <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(data.total)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Item Type breakdown */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Tipe Produk / Layanan</h4>
                                        <table className="whitespace-nowrap w-full text-left text-xs">
                                            <thead>
                                                <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                                    <th className="p-3">Tipe Item</th>
                                                    <th className="p-3 text-center">Jumlah Terjual</th>
                                                    <th className="p-3 text-right">Total Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {Object.entries(dailyData.typeBreakdown).map(([type, data]) => (
                                                    <tr key={type} className="hover:bg-gray-50/50">
                                                        <td className="p-3 font-bold capitalize text-gray-700">
                                                            {type === 'treatment' ? 'Layanan Treatment' : type === 'product' ? 'Produk Fisik' : 'Kupon Paket'}
                                                        </td>
                                                        <td className="p-3 text-center font-bold text-gray-600">{data.qty}</td>
                                                        <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(data.total)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Chart: Busy Hours */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Jam Tersibuk (Transaksi Per Jam)</h4>
                                    <div className="h-64">
                                        {isMounted ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={dailyData.activeHours} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#888' }} />
                                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                    <Bar dataKey="transaksi" fill="#D46221" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                        )}
                                    </div>
                                </div>

                                {/* Daily Transactions list */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-ayumi-secondary">List Transaksi Hari Terkait</h4>
                                    {dailyData.txList.length === 0 ? (
                                        <div className="text-center p-5 md:p-8 text-gray-400 bg-gray-50 rounded-xl">Tidak ada transaksi pada tanggal ini.</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                                                <thead>
                                                    <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-100">
                                                        <th className="p-3">No. Transaksi</th>
                                                        <th className="p-3">Waktu</th>
                                                        <th className="p-3">Pasien</th>
                                                        <th className="p-3">Metode</th>
                                                        <th className="p-3 text-right">Total</th>
                                                        <th className="p-3 text-center">Status</th>
                                                        <th className="p-3 text-center">Detail</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {dailyData.txList.map(tx => (
                                                        <tr key={tx.id} onClick={() => openDetailModal(tx)} className="hover:bg-gray-50/50 cursor-pointer">
                                                            <td className="p-3 font-bold text-gray-800">{tx.transaction_number}</td>
                                                            <td className="p-3 text-gray-500">
                                                                {new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                            </td>
                                                            <td className="p-3 font-bold text-gray-700">{tx.patients?.full_name || 'Walk-in'}</td>
                                                            <td className="p-3 uppercase font-bold text-gray-500 text-[10px]">{tx.payment_method}</td>
                                                            <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(tx.total)}</td>
                                                            <td className="p-3 text-center"><span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-[9px] font-bold">LUNAS</span></td>
                                                            <td className="p-3 text-center">
                                                                <button className="text-xs text-ayumi-primary font-semibold hover:underline">Lihat</button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 3: LAPORAN MINGGUAN */}
                {/* ======================================================== */}
                {activeMainTab === 'weekly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Minggu (Mulai Senin):</label>
                                <DateRangePicker 
                                    startDate={weeklyReportStart}
                                    endDate={(() => {
                                        const d = new Date(`${weeklyReportStart}T00:00:00`);
                                        d.setDate(d.getDate() + 6);
                                        return toLocalYYYYMMDD(d);
                                    })()}
                                    onChange={(range) => {
                                        if (range.startDate) {
                                            setWeeklyReportStart(toLocalYYYYMMDD(getStartOfWeek(`${range.startDate}T00:00:00`)));
                                        }
                                    }}
                                    inputClassName="text-xs font-semibold py-1.5 bg-white shadow-sm"
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Mingguan', `Mingguan_Mulai_${weeklyReportStart}`, weeklyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Mingguan', `Mingguan_Mulai_${weeklyReportStart}`, weeklyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {isWeeklyLoading ? (
                            <div className="p-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                                <div className="animate-spin w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full"></div>
                                <span className="text-sm font-semibold text-gray-500">Memuat laporan mingguan...</span>
                            </div>
                        ) : (
                            <>
                                {/* Weekly summaries */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Minggu Ini</h5>
                                        <p className="text-2xl font-black text-gray-800">{weeklyData.totalTx}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                        <p className="text-2xl font-black text-green-600 ">{formatCurrency(weeklyData.revenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Hari Tersibuk (Trx)</h5>
                                        <p className="text-lg font-black text-ayumi-primary">{weeklyData.busiestDay}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pendapatan Tertinggi</h5>
                                        <p className="text-lg font-black text-purple-700">{weeklyData.highestRevDay}</p>
                                    </div>
                                </div>

                                {/* Comparison vs last week */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                                    <div>
                                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Perbandingan dengan Minggu Lalu</h4>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-semibold text-gray-600">Pendapatan Minggu Lalu: <strong className=" text-gray-800">{formatCurrency(weeklyData.prevRevenue)}</strong></span>
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${weeklyData.growthPercent >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {weeklyData.growthPercent >= 0 ? `▲ +${weeklyData.growthPercent.toFixed(1)}%` : `▼ ${weeklyData.growthPercent.toFixed(1)}%`}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Chart: Revenue per day */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Hari (Senin - Minggu)</h4>
                                    <div className="h-64">
                                        {isMounted ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={weeklyData.orderedRevenue} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                    <Bar dataKey="pendapatan" fill="#6B3A5A" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                        )}
                                    </div>
                                </div>

                                {/* Branch Breakdown for Owner & Admin */}
                                {(!dbUser || dbUser.role === 'owner') && (
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Pendapatan per Cabang</h4>
                                        <table className="whitespace-nowrap w-full text-left text-xs">
                                            <thead>
                                                <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                                    <th className="p-3">Cabang</th>
                                                    <th className="p-3 text-center">Jumlah Transaksi</th>
                                                    <th className="p-3 text-right">Total Pendapatan</th>
                                                    <th className="p-3 text-right text-violet-700">Biaya Tambahan QRIS (0.3%)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {weeklyData.branchBreakdown.map(b => (
                                                    <tr key={b.name} className="hover:bg-gray-50/50">
                                                        <td className="p-3 font-bold text-gray-700">{b.name}</td>
                                                        <td className="p-3 text-center font-bold text-gray-600">{b.count}</td>
                                                        <td className="p-3 text-right font-bold text-gray-800">{formatCurrency(b.total)}</td>
                                                        <td className="p-3 text-right font-bold text-violet-700">{formatCurrency(b.qrisFee || 0)}</td>
                                                    </tr>
                                                ))}
                                                {weeklyData.branchBreakdown.length === 0 && (
                                                    <tr><td colSpan="4" className="p-3 text-center text-gray-400">Tidak ada data per cabang.</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 4: LAPORAN BULANAN */}
                {/* ======================================================== */}
                {activeMainTab === 'monthly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Bulan & Tahun:</label>
                                <select
                                    value={monthlyReportMonth}
                                    onChange={(e) => setMonthlyReportMonth(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-36 shadow-sm"
                                >
                                    {['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'].map((m, idx) => (
                                        <option key={idx} value={idx}>{m}</option>
                                    ))}
                                </select>
                                <select
                                    value={monthlyReportYear}
                                    onChange={(e) => setMonthlyReportYear(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-28 shadow-sm"
                                >
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Bulanan', `Bulanan_${monthlyReportMonth + 1}_${monthlyReportYear}`, monthlyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Bulanan', `Bulanan_${monthlyReportMonth + 1}_${monthlyReportYear}`, monthlyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {isMonthlyLoading ? (
                            <div className="p-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                                <div className="animate-spin w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full"></div>
                                <span className="text-sm font-semibold text-gray-500">Memuat laporan bulanan...</span>
                            </div>
                        ) : (
                            <>
                                {/* Monthly summaries */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Bulan Ini</h5>
                                        <p className="text-2xl font-black text-gray-800">{monthlyData.totalTx}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                        <p className="text-2xl font-black text-green-600 ">{formatCurrency(monthlyData.revenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pertumbuhan vs Bulan Lalu</h5>
                                        <span className={`text-lg font-black ${monthlyData.growthPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {monthlyData.growthPercent >= 0 ? `▲ +${monthlyData.growthPercent.toFixed(1)}%` : `▼ ${monthlyData.growthPercent.toFixed(1)}%`}
                                        </span>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rata-rata Pendapatan / Hari</h5>
                                        <p className="text-lg font-black text-purple-700 ">{formatCurrency(monthlyData.dailyAvg)}</p>
                                    </div>
                                </div>

                                {/* Charts layout */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Revenue by week line chart */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Minggu</h4>
                                        <div className="h-64">
                                            {isMounted ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={monthlyData.weekBins} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                                        <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                                        <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                        <Line type="monotone" dataKey="pendapatan" stroke="#D46221" strokeWidth={3} activeDot={{ r: 6 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                            )}
                                        </div>
                                    </div>

                                    {/* Donut Chart of Payment Methods */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Breakdown Metode Bayar (Volume)</h4>
                                        <div className="h-64 flex flex-col items-center justify-center">
                                            {isMounted ? (
                                                monthlyData.pieData.length > 0 ? (
                                                    <div className="relative w-full h-full">
                                                        <ResponsiveContainer width="100%" height="90%">
                                                            <PieChart>
                                                                <Pie
                                                                    data={monthlyData.pieData}
                                                                    cx="50%"
                                                                    cy="50%"
                                                                    innerRadius={45}
                                                                    outerRadius={75}
                                                                    paddingAngle={4}
                                                                    dataKey="value"
                                                                >
                                                                    {monthlyData.pieData.map((entry, index) => (
                                                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                                    ))}
                                                                </Pie>
                                                                <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                            </PieChart>
                                                        </ResponsiveContainer>
                                                        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                                                            {monthlyData.pieData.map((entry, index) => (
                                                                <div key={index} className="flex items-center gap-1 text-[10px]">
                                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                                                    <span className="text-gray-600 font-semibold">{entry.name}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-center text-gray-400 text-xs">Belum ada data pembayaran.</div>
                                                )
                                            ) : (
                                                <div className="h-full w-full bg-gray-50 animate-pulse rounded-2xl" />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Top Selling Products & Treatments */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* Top Treatments */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Top 5 Treatment</h4>
                                        <div className="space-y-2">
                                            {monthlyData.topTreatments.map((item, idx) => (
                                                <div key={item.name} className="flex justify-between items-center text-xs p-2 rounded-xl hover:bg-gray-50">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-purple-700 w-4">{idx + 1}.</span>
                                                        <span className="font-semibold text-gray-700 truncate max-w-[150px]">{item.name}</span>
                                                    </div>
                                                    <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-bold">{item.qty}x</span>
                                                </div>
                                            ))}
                                            {monthlyData.topTreatments.length === 0 && <p className="text-center text-gray-400 text-xs py-4">Belum ada data.</p>}
                                        </div>
                                    </div>

                                    {/* Top Products */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Top 5 Produk</h4>
                                        <div className="space-y-2">
                                            {monthlyData.topProducts.map((item, idx) => (
                                                <div key={item.name} className="flex justify-between items-center text-xs p-2 rounded-xl hover:bg-gray-50">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-orange-700 w-4">{idx + 1}.</span>
                                                        <span className="font-semibold text-gray-700 truncate max-w-[150px]">{item.name}</span>
                                                    </div>
                                                    <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded font-bold">{item.qty}x</span>
                                                </div>
                                            ))}
                                            {monthlyData.topProducts.length === 0 && <p className="text-center text-gray-400 text-xs py-4">Belum ada data.</p>}
                                        </div>
                                    </div>

                                    {/* Top Coupons */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Top 5 Kupon Paket</h4>
                                        <div className="space-y-2">
                                            {monthlyData.topCoupons.map((item, idx) => (
                                                <div key={item.name} className="flex justify-between items-center text-xs p-2 rounded-xl hover:bg-gray-50">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-pink-700 w-4">{idx + 1}.</span>
                                                        <span className="font-semibold text-gray-700 truncate max-w-[150px]">{item.name}</span>
                                                    </div>
                                                    <span className="bg-pink-50 text-pink-700 px-2 py-0.5 rounded font-bold">{item.qty}x</span>
                                                </div>
                                            ))}
                                            {monthlyData.topCoupons.length === 0 && <p className="text-center text-gray-400 text-xs py-4">Belum ada data.</p>}
                                        </div>
                                    </div>
                                </div>

                                {/* Branch breakdown table */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                    <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown per Cabang Bulan Ini</h4>
                                    <table className="whitespace-nowrap w-full text-left text-xs">
                                        <thead>
                                            <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                                <th className="p-3">Cabang</th>
                                                <th className="p-3 text-center">Jumlah Transaksi</th>
                                                <th className="p-3 text-right">Total Pendapatan</th>
                                                <th className="p-3 text-right text-violet-700">Biaya Tambahan QRIS (0.3%)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {monthlyData.branchBreakdown.map(b => (
                                                <tr key={b.name} className="hover:bg-gray-50/50">
                                                    <td className="p-3 font-bold text-gray-700">{b.name}</td>
                                                    <td className="p-3 text-center font-bold text-gray-600">{b.count}</td>
                                                    <td className="p-3 text-right font-bold text-gray-800">{formatCurrency(b.total)}</td>
                                                    <td className="p-3 text-right font-bold text-violet-700">{formatCurrency(b.qrisFee || 0)}</td>
                                                </tr>
                                            ))}
                                            {monthlyData.branchBreakdown.length === 0 && (
                                                <tr><td colSpan="4" className="p-3 text-center text-gray-400">Tidak ada data.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 5: LAPORAN TAHUNAN */}
                {/* ======================================================== */}
                {activeMainTab === 'yearly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Tahun:</label>
                                <select
                                    value={yearlyReportYear}
                                    onChange={(e) => setYearlyReportYear(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-36 shadow-sm"
                                >
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Tahunan', `Tahunan_${yearlyReportYear}`, yearlyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Tahunan', `Tahunan_${yearlyReportYear}`, yearlyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {isYearlyLoading ? (
                            <div className="p-16 text-center text-gray-400 bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center gap-3">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ayumi-primary"></div>
                                <span className="text-sm font-semibold text-gray-500">Memuat laporan tahunan...</span>
                            </div>
                        ) : (
                            <>
                                {/* Yearly summaries */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Tahun Ini</h5>
                                        <p className="text-2xl font-black text-gray-800">{yearlyData.totalTx}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan Setahun</h5>
                                        <p className="text-2xl font-black text-green-600 ">{formatCurrency(yearlyData.revenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Bulan Terbaik (Pendapatan)</h5>
                                        <p className="text-xl font-black text-ayumi-primary">{yearlyData.bestMonth}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">YoY Growth</h5>
                                        <span className={`text-lg font-black ${yearlyData.growthPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {yearlyData.growthPercent >= 0 ? `▲ +${yearlyData.growthPercent.toFixed(1)}%` : `▼ ${yearlyData.growthPercent.toFixed(1)}%`}
                                        </span>
                                    </div>
                                </div>

                                {/* Chart: Revenue per month */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Bulan</h4>
                                    <div className="h-64">
                                        {isMounted ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={yearlyData.monthlyRevenue} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                    <Line type="monotone" dataKey="pendapatan" stroke="#6B3A5A" strokeWidth={3} activeDot={{ r: 6 }} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                        )}
                                    </div>
                                </div>

                                {/* Best Selling Items of the Year */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-purple-50/20 p-5 rounded-2xl border border-purple-100/50">
                                    <div>
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Treatment Tahun Ini</h5>
                                        <p className="text-base font-extrabold text-purple-900">{yearlyData.topTreatment}</p>
                                    </div>
                                    <div>
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Produk Tahun Ini</h5>
                                        <p className="text-base font-extrabold text-orange-700">{yearlyData.topProduct}</p>
                                    </div>
                                    <div>
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Kupon Tahun Ini</h5>
                                        <p className="text-base font-extrabold text-pink-700">{yearlyData.topCoupon}</p>
                                    </div>
                                </div>

                                {/* Pivot comparison table */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                    <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Tabel Perbandingan Cabang per Bulan</h4>
                                    <table className="whitespace-nowrap w-full text-left text-[11px] border-collapse min-w-[700px]">
                                        <thead>
                                            <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                                                <th className="p-2">Cabang</th>
                                                {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].map(m => (
                                                    <th key={m} className="p-2 text-right">{m}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 font-medium text-gray-700">
                                            {yearlyData.branchPivotList.map(row => (
                                                <tr key={row.branchName} className="hover:bg-gray-50/50">
                                                    <td className="p-2 font-bold text-gray-900">{row.branchName}</td>
                                                    {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].map(m => (
                                                        <td key={m} className="p-2 text-right  text-[10px]">{row[m] > 0 ? formatCurrency(row[m]).substring(3) : '-'}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                            {yearlyData.branchPivotList.length === 0 && (
                                                <tr><td colSpan="13" className="p-4 text-center text-gray-400">Tidak ada data.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 6: CUSTOM REPORT */}
                {/* ======================================================== */}
                {activeMainTab === 'custom' && (
                    <div className="space-y-6">
                        <div className="card-ayumi p-5 bg-gradient-to-r from-pink-50/30 to-purple-50/30 border border-pink-100/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                            <div className="col-span-1 sm:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 mb-1">Rentang Tanggal Custom</label>
                                <DateRangePicker 
                                    startDate={customTabStart}
                                    endDate={customTabEnd}
                                    onChange={(range) => {
                                        setCustomTabStart(range.startDate);
                                        setCustomTabEnd(range.endDate);
                                    }}
                                    inputClassName="text-xs font-semibold bg-white py-2 w-full"
                                />
                            </div>
                            {(!dbUser || dbUser.role === 'owner') ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Cabang</label>
                                    <select
                                        value={customTabBranch}
                                        onChange={(e) => setCustomTabBranch(e.target.value)}
                                        className="input-ayumi text-sm bg-white"
                                    >
                                        <option value="">Semua Cabang</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="text-xs font-bold text-ayumi-secondary bg-white p-3 rounded-xl border border-pink-100">
                                    Cabang: {branches.find(b => b.id === customTabBranch)?.name || 'Klinik Anda'}
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Tipe Item</label>
                                <select
                                    value={customTabTxType}
                                    onChange={(e) => setCustomTabTxType(e.target.value)}
                                    className="input-ayumi text-sm bg-white"
                                >
                                    <option value="">Semua Tipe</option>
                                    <option value="treatment">Treatment</option>
                                    <option value="product">Produk</option>
                                    <option value="coupon">Kupon Paket</option>
                                </select>
                            </div>

                            <div className="sm:col-span-2 lg:col-span-4 flex justify-between gap-3 pt-2">
                                <button
                                    onClick={handleGenerateCustomReport}
                                    disabled={isCustomGenerating}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex-1 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                                >
                                    {isCustomGenerating ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            <span>Memuat Laporan...</span>
                                        </>
                                    ) : (
                                        'Generate Laporan'
                                    )}
                                </button>
                                {customReportResult && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleExcelExport('Custom', `Custom_${customTabStart}_s.d_${customTabEnd}`, customReportResult.txList)}
                                            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer"
                                        >
                                            Export Excel
                                        </button>
                                        <button
                                            onClick={() => handlePDFExport('Custom', `Custom_${customTabStart}_s.d_${customTabEnd}`, customReportResult.txList)}
                                            className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                            Cetak PDF
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Render generated report result */}
                        {customReportResult ? (
                            <div className="space-y-6">
                                {/* Custom summaries */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi</h5>
                                        <p className="text-xl font-black text-gray-800">{customReportResult.totalTx}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                        <p className="text-xl font-black text-green-600 ">{formatCurrency(customReportResult.revenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-purple-500 uppercase tracking-wider mb-1">Pendapatan Treatment</h5>
                                        <p className="text-xl font-black text-purple-700 ">{formatCurrency(customReportResult.treatmentRevenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-orange-500 uppercase tracking-wider mb-1">Pendapatan Produk</h5>
                                        <p className="text-xl font-black text-orange-700 ">{formatCurrency(customReportResult.productRevenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-violet-100 bg-violet-50/30 shadow-sm flex flex-col justify-center">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <h5 className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Biaya QRIS</h5>
                                            <span className="text-[9px] font-extrabold text-violet-700 bg-violet-100 px-1 py-0.2 rounded">0.3% MDR</span>
                                        </div>
                                        <p className="text-xl font-black text-violet-900">{formatCurrency(customReportResult.totalQrisFee)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rata-rata Penjualan</h5>
                                        <p className="text-xl font-black text-purple-700 ">{formatCurrency(customReportResult.avg)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center sm:col-span-2 lg:col-span-2">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 font-semibold text-gray-400">Total Item Terjual</h5>
                                        <div className="flex justify-between items-center text-[10px] font-bold text-gray-600 mt-1">
                                            <span>Trt: {customReportResult.treatmentQty}</span>
                                            <span>Prd: {customReportResult.productQty}</span>
                                            <span>Kpn: {customReportResult.couponQty}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Custom matching transactions list table */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-ayumi-secondary">Detail Pencarian Laporan</h4>
                                    {customReportResult.txList.length === 0 ? (
                                        <div className="text-center p-5 md:p-8 text-gray-400 bg-gray-50 rounded-xl">Tidak ada transaksi yang cocok.</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                                                <thead>
                                                    <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-100">
                                                        <th className="p-3">No. Transaksi</th>
                                                        <th className="p-3">Tanggal</th>
                                                        <th className="p-3">Cabang</th>
                                                        <th className="p-3">Pasien</th>
                                                        <th className="p-3">Metode</th>
                                                        <th className="p-3 text-right">Total</th>
                                                        <th className="p-3 text-center">Detail</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {customReportResult.txList.map(tx => (
                                                        <tr key={tx.id} onClick={() => openDetailModal(tx)} className="hover:bg-gray-50/50 cursor-pointer">
                                                            <td className="p-3 font-bold text-gray-800">{tx.transaction_number}</td>
                                                            <td className="p-3 text-gray-500">{formatDate(tx.created_at)}</td>
                                                            <td className="p-3 text-gray-500 font-semibold">{tx.branches?.name || '-'}</td>
                                                            <td className="p-3 font-bold text-gray-700">{tx.patients?.full_name || 'Walk-in'}</td>
                                                            <td className="p-3 uppercase font-bold text-gray-500 text-[10px]">{tx.payment_method}</td>
                                                            <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(tx.total)}</td>
                                                            <td className="p-3 text-center">
                                                                <button className="text-xs text-ayumi-primary font-semibold hover:underline">Lihat</button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-12 text-gray-400 bg-gray-50 rounded-2xl font-semibold">Tentukan rentang tanggal dan klik &quot;Generate Laporan&quot;.</div>
                        )}
                    </div>
                )}

            </div>


            {/* ======================================================== */}
            {/* TRANSACTION DETAIL MODAL */}
            {/* ======================================================== */}
            {isDetailModalOpen && selectedTx && (
                <TransactionDetailModal
                    selectedTx={selectedTx}
                    dbUser={dbUser}
                    productCatalogMap={productCatalogMap}
                    isEditingTx={isEditingTx}
                    setIsEditingTx={setIsEditingTx}
                    editTxData={editTxData}
                    setEditTxData={setEditTxData}
                    isDeletingTx={isDeletingTx}
                    closeDetailModal={closeDetailModal}
                    handleSaveEditedTx={handleSaveEditedTx}
                    handleVoidTx={handleVoidTx}
                    handleDeleteTx={handleDeleteTx}
                    handleSendWA={handleSendWA}
                    formatCurrency={formatCurrency}
                    formatDate={formatDate}
                    formatGenderAge={formatGenderAge}
                    getCleanTxPricing={getCleanTxPricing}
                    getCustomerStatus={getCustomerStatus}
                />
            )}

            {/* MODAL: RINCIAN PENUKARAN SESI KUPON (REDEEM) */}
            {isCouponRedeemModalOpen && (
                <CouponRedeemModal
                    customStartDate={customStartDate}
                    customEndDate={customEndDate}
                    filterBranch={filterBranch}
                    branches={branches}
                    couponRedeemedData={couponRedeemedData}
                    couponRedeemedTotals={couponRedeemedTotals}
                    gdCouponRedeemed={gdCouponRedeemed}
                    couponRedeemSearch={couponRedeemSearch}
                    setCouponRedeemSearch={setCouponRedeemSearch}
                    setIsCouponRedeemModalOpen={setIsCouponRedeemModalOpen}
                    formatCurrency={formatCurrency}
                />
            )}

        </div>
    )
}
