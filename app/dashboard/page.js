'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getLogoBase64 } from '@/lib/pdfLogo'
import DateRangePicker from '../../components/DateRangePicker'
import BranchFilter from '@/components/ui/BranchFilter'
import StatCard from '@/components/ui/StatCard'
import { parsePaymentSplits, getNetTransactionRevenue } from '@/lib/paymentUtils'
import { 
    LineChart, 
    Line, 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip as RechartsTooltip, 
    ResponsiveContainer, 
    Legend,
    PieChart,
    Pie,
    Cell
} from 'recharts'

export default function Dashboard() {
    const router = useRouter()
    
    // Auth & Role States
    const [authUser, setAuthUser] = useState(null)
    const [dbUser, setDbUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isMounted, setIsMounted] = useState(false)

    // Filter State
    const [branches, setBranches] = useState([])
    const [selectedBranch, setSelectedBranch] = useState('')

    // Date Range State (Defaults to current month: from 1st of month to today)
    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const [startDate, setStartDate] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    })
    const [endDate, setEndDate] = useState(() => {
        return getLocalYYYYMMDD()
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

    // Operational Widget States
    const [statAppointments, setStatAppointments] = useState(0)
    const [statFollowups, setStatFollowups] = useState(0)
    const [statBirthdays, setStatBirthdays] = useState(0)
    const [statDormant, setStatDormant] = useState(0)
    const [statNewPatients, setStatNewPatients] = useState(0)
    const [statExpiringCoupons, setStatExpiringCoupons] = useState(0)

    // Financial & Performance States
    const [statTodayIncome, setStatTodayIncome] = useState(0)
    const [statTodayTx, setStatTodayTx] = useState(0)
    const [statTodayCouponSessions, setStatTodayCouponSessions] = useState(0)
    const [statTopPaymentMethod, setStatTopPaymentMethod] = useState('-')
    const [sparklineData, setSparklineData] = useState([])

    // Detailed Metrics States (Unified for Owner & Admin)
    const [branchDailyComparison, setBranchDailyComparison] = useState([])
    const [branchMonthlyTargetData, setBranchMonthlyTargetData] = useState([])
    const [topTreatments, setTopTreatments] = useState([])
    const [topProducts, setTopProducts] = useState([])
    const [paymentBreakdown, setPaymentBreakdown] = useState([])
    const [recentBranchTransactions, setRecentBranchTransactions] = useState([])

    const [branchTotals, setBranchTotals] = useState({
        monthlyTarget: 0,
        rangeIncome: 0,
        treatmentIncome: 0,
        productIncome: 0,
        couponSalesIncome: 0,
        couponUsedValue: 0,
        couponUsedSessions: 0,
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
            
            // For Owner: evaluate all active branches or selected branch
            // For Admin/Staff: strictly evaluate their assigned branch
            let targetBranches = branchList.filter(b => b.is_active !== false)
            if (!isOwner && userBranchId) {
                targetBranches = targetBranches.filter(b => b.id === userBranchId)
            } else if (isOwner && selectedBranch) {
                targetBranches = targetBranches.filter(b => b.id === selectedBranch)
            }
            targetBranches = sortBranchesWithPangandaranLast(targetBranches)

            const sDate = startStr || startDate
            const eDate = endStr || endDate
            const tMonth = targetMonthVal || targetMonth
            
            // 1. Fetch transactions for selected date range with transaction items
            let txQuery = supabase
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
                    created_at,
                    patients (id, full_name, whatsapp),
                    branches (id, name),
                    transaction_items (
                        id,
                        item_type,
                        name,
                        quantity,
                        subtotal,
                        original_price,
                        discount_percent
                    )
                `)
                .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                .order('created_at', { ascending: false })

            if (!isOwner && userBranchId) {
                txQuery = txQuery.eq('branch_id', userBranchId)
            } else if (isOwner && selectedBranch) {
                txQuery = txQuery.eq('branch_id', selectedBranch)
            }

            let { data: rangeTrx, error: trxError } = await txQuery

            if (trxError) {
                console.warn('Full transaction query failed, falling back:', trxError.message)
                let fallbackQuery = supabase
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
                        created_at,
                        patients (id, full_name, whatsapp),
                        branches (id, name),
                        transaction_items (
                            id,
                            item_type,
                            name,
                            quantity,
                            subtotal
                        )
                    `)
                    .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                    .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                    .order('created_at', { ascending: false })

                if (!isOwner && userBranchId) {
                    fallbackQuery = fallbackQuery.eq('branch_id', userBranchId)
                } else if (isOwner && selectedBranch) {
                    fallbackQuery = fallbackQuery.eq('branch_id', selectedBranch)
                }
                const fallback = await fallbackQuery
                rangeTrx = fallback.data
            }

            // Save recent transactions for the table (up to 15)
            setRecentBranchTransactions(rangeTrx ? rangeTrx.slice(0, 15) : [])

            const rangeMap = {}
            let grandTotalRange = 0
            let grandTreatmentRange = 0
            let grandProductRange = 0
            let grandCouponSalesRange = 0
            let grandCouponUsedRange = 0
            let totalTxCountRange = 0
            const methodMap = {}
            const treatmentMap = {}
            const productMap = {}

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
                    cashIncome: 0,
                    totalIncome: 0,
                    transactionCount: 0
                }
            })

            if (rangeTrx) {
                rangeTrx.forEach(tx => {
                    // Only calculate revenue for completed/paid transactions (not voided)
                    const isPaid = tx.payment_status !== 'void'
                    if (tx && tx.branch_id && rangeMap[tx.branch_id] && isPaid) {
                        const branchObj = rangeMap[tx.branch_id]
                        branchObj.transactionCount += 1
                        totalTxCountRange += 1

                        const splits = parsePaymentSplits(tx)
                        Object.entries(splits).forEach(([m, amt]) => {
                            const pMethod = m.toUpperCase()
                            methodMap[pMethod] = (methodMap[pMethod] || 0) + amt
                        })
                        
                        let txTreatment = 0
                        let txProduct = 0
                        let txCouponSales = 0
                        let txCouponUsed = 0
                        let txCouponSessions = 0
                        let txOther = 0

                        if (tx.transaction_items && tx.transaction_items.length > 0) {
                            tx.transaction_items.forEach(item => {
                                const itemSub = Number(item.subtotal || 0)
                                const itemQty = Number(item.quantity || 1)
                                const itemName = item.name || 'Item Perawatan/Produk'
                                const discPct = Number(item.discount_percent || 0)
                                const origPrice = Number(item.original_price || 0)
                                const isCouponUsed = discPct >= 100 && origPrice > 0
                                const couponValue = isCouponUsed ? origPrice * itemQty : 0

                                if (item.item_type === 'treatment') {
                                    if (isCouponUsed) {
                                        txCouponUsed += couponValue
                                        txCouponSessions += itemQty
                                    } else {
                                        txTreatment += itemSub
                                    }
                                    const effectiveRevenue = itemSub + couponValue
                                    if (!treatmentMap[itemName]) {
                                        treatmentMap[itemName] = { name: itemName, count: 0, revenue: 0 }
                                    }
                                    treatmentMap[itemName].count += itemQty
                                    treatmentMap[itemName].revenue += effectiveRevenue
                                } else if (item.item_type === 'product') {
                                    txProduct += itemSub
                                    if (!productMap[itemName]) {
                                        productMap[itemName] = { name: itemName, count: 0, revenue: 0 }
                                    }
                                    productMap[itemName].count += itemQty
                                    productMap[itemName].revenue += itemSub
                                } else if (item.item_type === 'coupon') {
                                    txCouponSales += itemSub
                                } else {
                                    txOther += itemSub
                                }
                            })
                        } else {
                            txTreatment += Number(tx.total || 0)
                        }

                        branchObj.treatmentIncome += txTreatment
                        branchObj.productIncome += txProduct
                        branchObj.couponSalesIncome += txCouponSales
                        branchObj.couponUsedValue += txCouponUsed
                        branchObj.couponUsedSessions += txCouponSessions
                        branchObj.otherIncome += txOther
                        
                        const realCash = getNetTransactionRevenue(tx)
                        const totalValuation = realCash + txCouponUsed

                        branchObj.cashIncome += realCash
                        branchObj.totalIncome += totalValuation
                        grandTotalRange += realCash
                        grandTreatmentRange += txTreatment
                        grandProductRange += txProduct
                        grandCouponSalesRange += txCouponSales
                        grandCouponUsedRange += txCouponUsed
                    }
                })
            }

            // Fetch coupon usage logs in the selected date range
            let couponLogsData = []
            try {
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
                                coupon_packages (id, name)
                            )
                        ),
                        users:users!coupon_usage_logs_used_by_fkey (id, full_name)
                    `)
                    .is('voided_at', null)
                    .gte('used_at', new Date(`${sDate}T00:00:00`).toISOString())
                    .lte('used_at', new Date(`${eDate}T23:59:59.999`).toISOString())
                    .order('used_at', { ascending: false })

                if (!isOwner && userBranchId) {
                    logsQuery = logsQuery.eq('branch_id', userBranchId)
                } else if (isOwner && selectedBranch) {
                    logsQuery = logsQuery.eq('branch_id', selectedBranch)
                }

                const { data: usageLogs } = await logsQuery
                if (usageLogs) couponLogsData = usageLogs
            } catch (errLogs) {
                console.warn('Warning fetching coupon_usage_logs for dashboard:', errLogs)
            }

            setCouponUsageLogsList(couponLogsData)

            let grandCouponUsedSessions = 0
            targetBranches.forEach(b => {
                const bLogs = couponLogsData.filter(l => l.branch_id === b.id)
                const logSessionCount = bLogs.length
                const fallbackCount = rangeMap[b.id]?.couponUsedSessions || 0
                const finalSessionCount = logSessionCount > 0 ? logSessionCount : fallbackCount
                rangeMap[b.id].couponUsedSessions = finalSessionCount
                grandCouponUsedSessions += finalSessionCount
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

            // Top 5 treatments & products
            const sortedTreatments = Object.values(treatmentMap)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5)
            const sortedProducts = Object.values(productMap)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5)

            setTopTreatments(sortedTreatments)
            setTopProducts(sortedProducts)

            // Formatted payment breakdown
            const formattedMethods = Object.entries(methodMap).map(([m, amt]) => ({
                method: m,
                amount: amt,
                percent: grandTotalRange > 0 ? ((amt / grandTotalRange) * 100).toFixed(1) : '0'
            })).sort((a, b) => b.amount - a.amount)
            setPaymentBreakdown(formattedMethods)

            // 2. Fetch selected month transactions for monthly target calculation
            const [tYearStr, tMonthStr] = (tMonth || '').split('-')
            const tYear = parseInt(tYearStr, 10) || new Date().getFullYear()
            const tMonthIdx = (parseInt(tMonthStr, 10) || (new Date().getMonth() + 1)) - 1

            const startOfMonth = new Date(tYear, tMonthIdx, 1, 0, 0, 0).toISOString()
            const endOfMonth = new Date(tYear, tMonthIdx + 1, 0, 23, 59, 59, 999).toISOString()

            let monthlyTrxQuery = supabase
                .from('transactions')
                .select('id, branch_id, total, subtotal, discount, payment_method, notes')
                .eq('payment_status', 'paid')
                .gte('created_at', startOfMonth)
                .lte('created_at', endOfMonth)

            if (!isOwner && userBranchId) {
                monthlyTrxQuery = monthlyTrxQuery.eq('branch_id', userBranchId)
            } else if (isOwner && selectedBranch) {
                monthlyTrxQuery = monthlyTrxQuery.eq('branch_id', selectedBranch)
            }

            const { data: monthlyTrx } = await monthlyTrxQuery

            const monthlyMap = {}
            let totalCompanyTarget = 0

            targetBranches.forEach(b => {
                const targetVal = Number(b.monthly_target || 0)
                totalCompanyTarget += targetVal
                monthlyMap[b.id] = {
                    branchId: b.id,
                    branchName: b.name,
                    monthlyTarget: targetVal,
                    monthlyIncome: 0
                }
            })

            if (monthlyTrx) {
                monthlyTrx.forEach(tx => {
                    if (tx && tx.branch_id && monthlyMap[tx.branch_id]) {
                        const amt = getNetTransactionRevenue(tx)
                        monthlyMap[tx.branch_id].monthlyIncome += amt
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

            setBranchTotals({
                monthlyTarget: totalCompanyTarget,
                rangeIncome: grandTotalRange,
                treatmentIncome: grandTreatmentRange,
                productIncome: grandProductRange,
                couponSalesIncome: grandCouponSalesRange,
                couponUsedValue: grandCouponUsedRange,
                couponUsedSessions: grandCouponUsedSessions,
                rangeTxCount: totalTxCountRange,
                topBranchName: topBranch !== '-' ? topBranch : (formattedRangeComp[0]?.branchName || '-')
            })

        } catch (e) {
            console.error('Error fetching dashboard metrics:', e)
        }
    }, [startDate, endDate, targetMonth, selectedBranch, dbUser])

    const fetchInitialData = async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            
            if (!user) {
                router.push('/login')
                return
            }
            setAuthUser(user)

            const { data: userData } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .maybeSingle()
                
            let activeUserData = userData
            if (!activeUserData) {
                console.warn('User not found in public.users, unauthorized access')
                activeUserData = { role: 'unauthorized', full_name: user.email, id: user.id }
            }

            if (activeUserData.role === 'therapist') {
                router.push('/therapist/dashboard')
                return
            }
            
            setDbUser(activeUserData)
            
            const { data: branchData } = await supabase
                .from('branches')
                .select('id, name, monthly_target, is_active')

            let sorted = []
            if (branchData) {
                sorted = sortBranchesWithPangandaranLast(branchData)
                setBranches(sorted)
            }

            if (activeUserData.role === 'owner') {
                setSelectedBranch('')
            } else {
                setSelectedBranch(activeUserData.branch_id || '')
            }

            // Fetch initial metrics
            if (sorted.length > 0) {
                await fetchDashboardMetrics(sorted, startDate, endDate, targetMonth, activeUserData)
            }
            await fetchOperationalStats(activeUserData)
        } catch (err) {
            console.error('Error initializing dashboard:', err)
        } finally {
            setLoading(false)
        }
    }

    const fetchOperationalStats = async (userObj) => {
        try {
            const currentUser = userObj || dbUser
            const isOwner = currentUser?.role === 'owner'
            const effectiveBranch = isOwner ? selectedBranch : (currentUser?.branch_id || '')
            const todayDateStr = getLocalYYYYMMDD()
            const now = new Date()

            const applyBranch = (query, col = 'branch_id') => {
                if (effectiveBranch) return query.eq(col, effectiveBranch)
                return query
            }

            // 1. Appointments Today
            let aptQuery = supabase.from('appointments').select('id, start_time, end_time, status, patients(full_name, whatsapp)', { count: 'exact' })
                .eq('appointment_date', todayDateStr)
                .order('start_time', { ascending: true })
            aptQuery = applyBranch(aptQuery)

            // 2. Followups Pending
            let fuQuery = supabase.from('followup_queue').select('id, followup_type, priority, scheduled_date, patients(full_name, whatsapp)', { count: 'exact' })
                .eq('status', 'pending')
                .lte('scheduled_date', todayDateStr)
                .order('priority', { ascending: false })
            fuQuery = applyBranch(fuQuery)

            // 3. Birthdays This Month
            const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0')
            let bdayQuery = supabase.from('patients').select('id, birth_date')
                .not('birth_date', 'is', null)
            bdayQuery = applyBranch(bdayQuery)

            // 4. Dormant Patients (>60 days no visit)
            const sixtyDaysAgo = new Date()
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
            let dormantQuery = supabase.from('patients').select('id', { count: 'exact', head: true })
                .or(`last_visit.lt.${sixtyDaysAgo.toISOString()},last_visit.is.null`)
                .eq('is_active', true)
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

            // 7. Today's Financial Quick Stats
            let trxTodayQuery = supabase.from('transactions').select('total, payment_method, notes')
                .eq('payment_status', 'paid')
                .gte('created_at', new Date(`${todayDateStr}T00:00:00`).toISOString())
                .lte('created_at', new Date(`${todayDateStr}T23:59:59.999`).toISOString())
            trxTodayQuery = applyBranch(trxTodayQuery)

            // 8. Today's Coupon Sessions
            let couponLogsTodayQuery = supabase.from('coupon_usage_logs').select('id', { count: 'exact', head: true })
                .is('voided_at', null)
                .gte('used_at', new Date(`${todayDateStr}T00:00:00`).toISOString())
                .lte('used_at', new Date(`${todayDateStr}T23:59:59.999`).toISOString())
            couponLogsTodayQuery = applyBranch(couponLogsTodayQuery)

            // 9. 7-Day Sparkline
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
            sevenDaysAgo.setHours(0,0,0,0)
            let sparklineQuery = supabase.from('transactions').select('total, created_at')
                .eq('payment_status', 'paid')
                .gte('created_at', sevenDaysAgo.toISOString())
            sparklineQuery = applyBranch(sparklineQuery)

            const [
                aptRes,
                fuRes,
                bdayRes,
                dormantRes,
                newPatRes,
                couponsRes,
                trxTodayRes,
                couponLogsTodayRes,
                sparkRes
            ] = await Promise.all([
                aptQuery,
                fuQuery,
                bdayQuery,
                dormantQuery,
                newPatQuery,
                couponsQuery,
                trxTodayQuery,
                couponLogsTodayQuery,
                sparklineQuery
            ])

            setStatAppointments(aptRes?.count || aptRes?.data?.length || 0)
            setRecentAppointments(aptRes?.data ? aptRes.data.slice(0, 5) : [])

            setStatFollowups(fuRes?.count || fuRes?.data?.length || 0)
            setRecentFollowups(fuRes?.data ? fuRes.data.slice(0, 5) : [])

            // Filter birthdays in current month
            const bdayCount = (bdayRes?.data || []).filter(p => {
                if (!p.birth_date) return false
                const parts = p.birth_date.split('-')
                return parts[1] === currentMonthStr
            }).length
            setStatBirthdays(bdayCount)

            setStatDormant(dormantRes?.count || 0)
            setStatNewPatients(newPatRes?.count || 0)
            setStatExpiringCoupons(couponsRes?.count || 0)
            setStatTodayCouponSessions(couponLogsTodayRes?.count || 0)

            // Today's Income & Transactions
            let todayInc = 0
            let todayCount = 0
            const methodCounts = {}
            if (trxTodayRes?.data) {
                todayCount = trxTodayRes.data.length
                trxTodayRes.data.forEach(tx => {
                    todayInc += getNetTransactionRevenue(tx)
                    const splits = parsePaymentSplits(tx)
                    Object.entries(splits).forEach(([m, amt]) => {
                        if (amt > 0) methodCounts[m] = (methodCounts[m] || 0) + 1
                    })
                })
            }
            setStatTodayIncome(todayInc)
            setStatTodayTx(todayCount)

            let topM = '-'
            let maxMCount = 0
            Object.entries(methodCounts).forEach(([m, count]) => {
                if (count > maxMCount) {
                    maxMCount = count
                    topM = m.toUpperCase()
                }
            })
            setStatTopPaymentMethod(topM)

            // 7-Day Sparkline formatting
            const dailyMap = {}
            for (let i = 0; i < 7; i++) {
                const d = new Date()
                d.setDate(d.getDate() - i)
                dailyMap[getLocalYYYYMMDD(d)] = 0
            }
            if (sparkRes?.data) {
                sparkRes.data.forEach(tx => {
                    if (tx?.created_at) {
                        const dStr = getLocalYYYYMMDD(new Date(tx.created_at))
                        if (dailyMap[dStr] !== undefined) {
                            dailyMap[dStr] += getNetTransactionRevenue(tx)
                        }
                    }
                })
            }
            const formattedSpark = Object.entries(dailyMap)
                .map(([date, total]) => {
                    const d = new Date(date)
                    const label = d.toLocaleDateString('id-ID', { weekday: 'short' })
                    return { date, label, total }
                })
                .sort((a, b) => new Date(a.date) - new Date(b.date))
            setSparklineData(formattedSpark)

        } catch (err) {
            console.error('Error fetching operational stats:', err)
        }
    }

    useEffect(() => {
        fetchInitialData()
    }, [])

    useEffect(() => {
        if (dbUser && branches.length > 0) {
            fetchDashboardMetrics(branches, startDate, endDate, targetMonth, dbUser)
            fetchOperationalStats(dbUser)
        }
    }, [startDate, endDate, targetMonth, selectedBranch, dbUser, branches, fetchDashboardMetrics])

    // Target modal handlers for owner
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
            toast.success('Target bulanan cabang berhasil diperbarui!')
            setIsTargetModalOpen(false)
            
            // Refresh branches
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

    // PDF Export Function
    const handleExportExecutiveSummaryPDF = async () => {
        const toastId = toast.loading('Menyiapkan dokumen PDF Rekap Omset...')
        try {
            const { jsPDF } = await import('jspdf')
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            const pageWidth = doc.internal.pageSize.getWidth()
            let cursorY = 20

            // Header Banner
            doc.setFillColor(92, 51, 22) // #5c3316
            doc.rect(0, 0, pageWidth, 38, 'F')

            doc.setTextColor(255, 255, 255)
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(16)
            doc.text('AYUMI BEAUTY HOUSE', 14, 16)

            doc.setFontSize(10)
            doc.setFont('helvetica', 'normal')
            doc.text('Laporan Ringkasan Eksekutif & Kinerja Omset', 14, 23)
            doc.setFontSize(8)
            doc.text(`Periode Data: ${startDate} s/d ${endDate} | Dicetak: ${new Date().toLocaleString('id-ID')}`, 14, 30)

            cursorY = 48

            // Summary Table
            doc.setTextColor(92, 51, 22)
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(12)
            doc.text('1. Ringkasan Omset Finansial', 14, cursorY)
            cursorY += 8

            doc.setFillColor(254, 242, 242)
            doc.rect(14, cursorY, pageWidth - 28, 24, 'F')
            doc.setDrawColor(254, 205, 211)
            doc.rect(14, cursorY, pageWidth - 28, 24, 'D')

            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(30, 41, 59)
            doc.text(`Total Omset Tunai: Rp ${branchTotals.rangeIncome.toLocaleString('id-ID')}`, 18, cursorY + 7)
            doc.text(`Omset Treatment: Rp ${branchTotals.treatmentIncome.toLocaleString('id-ID')}`, 18, cursorY + 14)
            doc.text(`Omset Produk: Rp ${branchTotals.productIncome.toLocaleString('id-ID')}`, 18, cursorY + 20)

            doc.text(`Penjualan Kupon: Rp ${branchTotals.couponSalesIncome.toLocaleString('id-ID')}`, 110, cursorY + 7)
            doc.text(`Sesi Kupon Terpakai: ${branchTotals.couponUsedSessions} Sesi`, 110, cursorY + 14)
            doc.text(`Total Transaksi: ${branchTotals.rangeTxCount} Tx`, 110, cursorY + 20)

            cursorY += 34

            // Breakdown Per Cabang
            doc.setFontSize(12)
            doc.setTextColor(92, 51, 22)
            doc.text('2. Breakdown Kinerja per Cabang', 14, cursorY)
            cursorY += 8

            branchDailyComparison.forEach(b => {
                doc.setFontSize(10)
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(15, 23, 42)
                doc.text(b.branchName, 14, cursorY)
                cursorY += 6

                doc.setFontSize(8)
                doc.setFont('helvetica', 'normal')
                doc.setTextColor(71, 85, 105)
                doc.text(`• Omset Treatment: Rp ${b.treatmentIncome.toLocaleString('id-ID')} | Produk: Rp ${b.productIncome.toLocaleString('id-ID')} | Penjualan Kupon: Rp ${b.couponSalesIncome.toLocaleString('id-ID')}`, 18, cursorY)
                cursorY += 5
                doc.text(`• Pemakaian Sesi: ${b.couponUsedSessions} Sesi | Total Omset Tunai: Rp ${b.cashIncome.toLocaleString('id-ID')} (${b.transactionCount} Tx)`, 18, cursorY)
                cursorY += 8
            })

            doc.save(`Executive_Summary_Omset_${startDate}_sd_${endDate}.pdf`)
            toast.success('Laporan Eksekutif PDF berhasil diunduh!', { id: toastId })
        } catch (err) {
            console.error('Error generating Executive PDF:', err)
            toast.error('Gagal membuat PDF: ' + err.message, { id: toastId })
        }
    }

    const userBranchName = useMemo(() => {
        if (!dbUser?.branch_id || !branches) return 'Semua Cabang'
        const found = branches.find(b => b.id === dbUser.branch_id)
        return found ? found.name : 'Semua Cabang'
    }, [dbUser, branches])

    const isOwner = dbUser?.role === 'owner'
    const currentBranchInfo = useMemo(() => {
        if (!isOwner && dbUser?.branch_id) {
            return branches.find(b => b.id === dbUser.branch_id) || null
        }
        if (isOwner && selectedBranch) {
            return branches.find(b => b.id === selectedBranch) || null
        }
        return null
    }, [isOwner, dbUser, selectedBranch, branches])

    return (
        <div className="space-y-6 pb-12">
            {/* 1. TOP BANNER & HEADER */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#5c3316] via-[#7a441e] to-[#43230c] p-6 sm:p-8 text-white shadow-xl">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5 mb-2">
                            <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-black tracking-wider uppercase border border-white/20">
                                {dbUser?.role ? dbUser.role.toUpperCase() : 'USER'} PORTAL
                            </span>
                            <span className="px-3 py-1 rounded-full bg-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-1.5 border border-emerald-400/30">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                Live Monitoring
                            </span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                            Selamat Datang, {dbUser?.full_name || authUser?.email || 'Sahabat Ayumi'}!
                        </h1>
                        <p className="text-xs sm:text-sm text-pink-100/90 font-medium mt-1">
                            {isOwner 
                                ? 'Pusat kontrol eksekutif dan monitoring kinerja multi-cabang Ayumi Beauty House secara real-time.' 
                                : `Pusat operasional dan rekapitulasi data cabang ${userBranchName}. Pantau performa dan layanan klinik Anda.`
                            }
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        {isOwner ? (
                            <>
                                <button
                                    onClick={handleExportExecutiveSummaryPDF}
                                    className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/30 text-white rounded-2xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    <span>Unduh Rekap PDF</span>
                                </button>
                                <button
                                    onClick={() => router.push('/kasir')}
                                    className="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white rounded-2xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                                    <span>Buka Kasir</span>
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="px-3.5 py-2 rounded-2xl bg-white/10 border border-white/20 text-xs font-extrabold flex items-center gap-2">
                                    <span>🏥 {userBranchName}</span>
                                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-black">LOCKED</span>
                                </div>
                                <button
                                    onClick={() => router.push('/kasir')}
                                    className="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white rounded-2xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                                    <span>Buka Kasir</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* 2. TOOLBAR FILTER (Rentang Waktu & Pilihan Cabang untuk Owner) */}
            <div className="card-ayumi p-4 sm:p-5 bg-white shadow-sm border border-gray-200 rounded-2xl sm:rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-pink-100 text-ayumi-primary flex items-center justify-center font-extrabold shrink-0 shadow-inner">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                    </div>
                    <div>
                        <h3 className="text-sm sm:text-base font-extrabold text-gray-900">Filter Analitik & Laporan</h3>
                        <p className="text-xs text-gray-500 font-semibold">Sesuaikan rentang tanggal untuk memperbarui seluruh grafik dan ringkasan omset.</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Branch selector for Owner */}
                    {isOwner && (
                        <div className="w-full sm:w-auto">
                            <BranchFilter 
                                branches={branches} 
                                selectedBranch={selectedBranch} 
                                onBranchChange={setSelectedBranch} 
                            />
                        </div>
                    )}

                    {/* DateRangePicker */}
                    <div className="flex flex-col gap-1 w-full sm:w-auto">
                        <DateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onChange={({ startDate: s, endDate: e }) => {
                                setStartDate(s)
                                setEndDate(e)
                            }}
                            align="right"
                            inputClassName="w-full sm:w-auto bg-pink-50 hover:bg-pink-100/70 text-ayumi-secondary border border-pink-200 font-extrabold text-xs px-3.5 py-2.5 rounded-2xl shadow-sm transition-colors cursor-pointer justify-between"
                        />
                    </div>
                </div>
            </div>

            {/* 3. KARTU RINGKASAN OMSET FINANSIAL (Treatment, Produk, Kupon, Total) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                {/* 1. Total Omset */}
                <div 
                    onClick={() => router.push('/transactions')}
                    className="p-4 rounded-3xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-white border border-emerald-200 hover:border-emerald-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center font-black shadow-md shadow-emerald-500/20">
                            Rp
                        </div>
                        <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                            {branchTotals.rangeTxCount} Tx
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Total Omset Tunai</p>
                        <h3 className="text-lg font-black text-emerald-950 tracking-tight mt-0.5">
                            Rp {branchTotals.rangeIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[10px] text-emerald-700 font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>Buka Riwayat ➔</span>
                        </p>
                    </div>
                </div>

                {/* 2. Omset Treatment */}
                <div 
                    onClick={() => router.push('/reports/treatments')}
                    className="p-4 rounded-3xl bg-gradient-to-br from-pink-500/10 via-pink-500/5 to-white border border-pink-200 hover:border-pink-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-[#EC4899] text-white flex items-center justify-center font-black shadow-md shadow-pink-500/20">
                            ✨
                        </div>
                        <span className="text-[10px] font-black text-pink-800 bg-pink-100 px-2 py-0.5 rounded-full">
                            Treatment
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Omset Treatment</p>
                        <h3 className="text-lg font-black text-gray-900 tracking-tight mt-0.5">
                            Rp {branchTotals.treatmentIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[10px] text-[#EC4899] font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>Laporan Treatment ➔</span>
                        </p>
                    </div>
                </div>

                {/* 3. Omset Produk */}
                <div 
                    onClick={() => router.push('/transactions')}
                    className="p-4 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-white border border-cyan-200 hover:border-cyan-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-[#06B6D4] text-white flex items-center justify-center font-black shadow-md shadow-cyan-500/20">
                            🧴
                        </div>
                        <span className="text-[10px] font-black text-cyan-800 bg-cyan-100 px-2 py-0.5 rounded-full">
                            Skincare
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Omset Produk</p>
                        <h3 className="text-lg font-black text-gray-900 tracking-tight mt-0.5">
                            Rp {branchTotals.productIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[10px] text-[#06B6D4] font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>Penjualan Produk ➔</span>
                        </p>
                    </div>
                </div>

                {/* 4. Penjualan Kupon */}
                <div 
                    onClick={() => router.push('/coupons')}
                    className="p-4 rounded-3xl bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-white border border-purple-200 hover:border-purple-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center font-black shadow-md shadow-purple-500/20">
                            💳
                        </div>
                        <span className="text-[10px] font-black text-purple-800 bg-purple-100 px-2 py-0.5 rounded-full">
                            Paket Kupon
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Jual Paket Kupon</p>
                        <h3 className="text-lg font-black text-purple-950 tracking-tight mt-0.5">
                            Rp {branchTotals.couponSalesIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[10px] text-purple-700 font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>Kelola Paket ➔</span>
                        </p>
                    </div>
                </div>

                {/* 5. Pemakaian Sesi Kupon */}
                <div 
                    onClick={() => openCouponUsageModal(isOwner ? selectedBranch : dbUser?.branch_id, userBranchName)}
                    className="p-4 rounded-3xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-white border border-amber-200 hover:border-amber-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    title="Klik untuk membuka rincian pemakaian sesi"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md shadow-amber-500/20">
                            🎟️
                        </div>
                        <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                            Klaim Sesi
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pakai Sesi Kupon</p>
                        <h3 className="text-lg font-black text-amber-950 tracking-tight mt-0.5">
                            {branchTotals.couponUsedSessions} <span className="text-xs font-semibold text-amber-700">Sesi</span>
                        </h3>
                        <p className="text-[10px] text-amber-700 font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>Lihat Rincian Sesi ↗</span>
                        </p>
                    </div>
                </div>

                {/* 6. Transaksi Hari Ini */}
                <div 
                    onClick={() => router.push('/kasir/history')}
                    className="p-4 rounded-3xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-white border border-blue-200 hover:border-blue-400 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black shadow-md shadow-blue-500/20">
                            🕒
                        </div>
                        <span className="text-[10px] font-black text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full">
                            Hari Ini
                        </span>
                    </div>
                    <div className="mt-3">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Omset Hari Ini</p>
                        <h3 className="text-lg font-black text-blue-950 tracking-tight mt-0.5">
                            Rp {statTodayIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[10px] text-blue-700 font-semibold mt-1 flex items-center gap-1 group-hover:underline">
                            <span>{statTodayTx} Transaksi Hari Ini ➔</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* 4. MONITORING TARGET BULANAN */}
            <div className="card-ayumi p-5 sm:p-7 bg-white space-y-5 shadow-md border border-gray-200 rounded-3xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-200">
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                            <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316]">
                                Monitoring Target Bulanan ({currentMonthLabel})
                            </h3>
                        </div>
                        <p className="text-xs text-gray-600 font-semibold mt-1 pl-4">
                            Pantau persentase pencapaian omset bulan ini dibanding target operasional cabang.
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                        {isOwner && (
                            <button
                                type="button"
                                onClick={handleOpenTargetModal}
                                className="flex items-center gap-1.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white text-xs font-bold px-3.5 py-2 rounded-2xl shadow-sm transition-all cursor-pointer"
                            >
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                <span>Atur Target</span>
                            </button>
                        )}

                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                                className="flex items-center gap-2 bg-pink-50 hover:bg-pink-100 text-ayumi-primary border border-pink-200 text-xs font-extrabold px-3.5 py-2 rounded-2xl shadow-sm transition-all cursor-pointer"
                            >
                                <svg className="w-4 h-4 text-ayumi-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>Bulan: {currentMonthLabel}</span>
                                <svg className={`w-3.5 h-3.5 text-ayumi-primary transition-transform ${isMonthPickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {isMonthPickerOpen && (
                                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-pink-150 shadow-2xl p-4 z-50 space-y-3">
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
                                                            ? 'bg-ayumi-primary text-white shadow-md font-black' 
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

                {/* Target Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {branchMonthlyTargetData.map(item => {
                        const rawPct = Number(item.rawPercent || 0)
                        const isTargetSet = item.monthlyTarget > 0

                        let barColor = 'bg-rose-500'
                        let badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200'

                        if (rawPct >= 100) {
                            barColor = 'bg-emerald-600'
                            badgeStyle = 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        } else if (rawPct >= 50) {
                            barColor = 'bg-amber-500'
                            badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200'
                        }

                        if (!isTargetSet) {
                            return (
                                <div 
                                    key={item.branchId} 
                                    onClick={isOwner ? handleOpenTargetModal : undefined}
                                    className={`p-5 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 hover:bg-white hover:border-pink-300 transition-all flex flex-col justify-between group space-y-3 ${isOwner ? 'cursor-pointer' : ''}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-extrabold text-base text-gray-900 group-hover:text-ayumi-primary transition-colors">{item.branchName}</h4>
                                            <p className="text-xs text-gray-500 font-semibold mt-0.5">Target Operasional Cabang</p>
                                        </div>
                                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-500 border border-gray-200">
                                            Belum Diatur
                                        </span>
                                    </div>

                                    <div className="py-2 flex items-center justify-between">
                                        <span className="text-xs text-gray-500 font-medium">Omset Saat Ini: <strong className="text-gray-900 font-bold">Rp {item.monthlyIncome.toLocaleString('id-ID')}</strong></span>
                                        {isOwner && (
                                            <span className="text-xs font-bold text-ayumi-primary group-hover:underline flex items-center gap-1">
                                                + Set Target
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        }

                        return (
                            <div 
                                key={item.branchId} 
                                className="p-5 rounded-2xl border border-gray-200/90 bg-white hover:border-pink-300 transition-all shadow-sm space-y-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="font-extrabold text-base text-gray-900">{item.branchName}</h4>
                                        <p className="text-xs text-gray-500 font-semibold mt-0.5">Target Operasional Cabang</p>
                                    </div>
                                    <span className={`text-xs font-bold px-3 py-1 rounded-lg border ${badgeStyle}`}>
                                        {rawPct >= 100 ? `${rawPct.toFixed(1)}% (Tercapai)` : `${rawPct.toFixed(1)}%`}
                                    </span>
                                </div>

                                <div className="space-y-1.5 pt-1">
                                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full ${barColor} rounded-full transition-all duration-500`}
                                            style={{ width: `${Math.min(100, Math.max(0, rawPct))}%` }}
                                        ></div>
                                    </div>
                                    <div className="flex justify-between items-center text-xs pt-1">
                                        <span className="text-gray-600 font-semibold">Terkumpul: <strong className="text-emerald-700 font-bold">Rp {item.monthlyIncome.toLocaleString('id-ID')}</strong></span>
                                        <span className="text-gray-600 font-semibold">Target: <strong className="text-gray-900 font-bold">Rp {item.monthlyTarget.toLocaleString('id-ID')}</strong></span>
                                    </div>
                                </div>

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
            </div>

            {/* 5. GRAFIK KOMPOSISI OMSET & METODE PEMBAYARAN */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Bar Chart Komposisi Treatment vs Produk */}
                <div className="lg:col-span-2 card-ayumi p-5 sm:p-7 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                        <div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                <h3 className="text-base sm:text-lg font-extrabold text-[#5c3316]">
                                    Komposisi Omset: Treatment vs Produk vs Kupon
                                </h3>
                            </div>
                            <p className="text-xs text-gray-500 font-semibold mt-0.5 pl-4">
                                Rincian perolehan pendapatan untuk rentang tanggal terpilih ({startDate} s/d {endDate}).
                            </p>
                        </div>
                    </div>

                    <div className="h-64 sm:h-72 w-full pt-2">
                        {isMounted && branchDailyComparison.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart 
                                    data={branchDailyComparison} 
                                    barGap={4} 
                                    barCategoryGap="20%"
                                    margin={{ top: 15, right: 10, left: 0, bottom: 20 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis 
                                        dataKey="branchName" 
                                        interval={0}
                                        tickFormatter={(val) => (val ? val.replace(/^Ayumi\s+/i, '') : val)}
                                        tick={{ fontSize: 11, fontWeight: 700, fill: '#1e293b' }} 
                                        axisLine={{ stroke: '#cbd5e1' }}
                                        tickLine={false} 
                                    />
                                    <YAxis 
                                        width={48}
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
                                    <RechartsTooltip 
                                        formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                        labelStyle={{ fontWeight: 'bold', color: '#5c3316', fontSize: '13px' }}
                                        contentStyle={{ borderRadius: '16px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #f472b6', padding: '10px 14px' }}
                                    />
                                    <Legend 
                                        verticalAlign="top" 
                                        align="center"
                                        wrapperStyle={{ paddingTop: '0px', paddingBottom: '12px', fontWeight: '800', fontSize: '11px', color: '#0f172a' }} 
                                    />
                                    <Bar dataKey="treatmentIncome" name="Omset Treatment" fill="#EC4899" radius={[5, 5, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="productIncome" name="Omset Produk" fill="#06B6D4" radius={[5, 5, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="couponSalesIncome" name="Penjualan Kupon" fill="#10B981" radius={[5, 5, 0, 0]} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                                Mengambil data grafik...
                            </div>
                        )}
                    </div>
                </div>

                {/* Metode Pembayaran Breakdown */}
                <div className="card-ayumi p-5 sm:p-7 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
                            <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                            <h3 className="text-base sm:text-lg font-extrabold text-[#5c3316]">Metode Pembayaran</h3>
                        </div>
                        <p className="text-xs text-gray-500 font-semibold mt-1">Distribusi saluran pembayaran kasir periode ini.</p>
                    </div>

                    <div className="space-y-3 my-auto py-2">
                        {paymentBreakdown.length === 0 ? (
                            <p className="text-xs text-gray-400 font-medium py-8 text-center">Belum ada transaksi pembayaran pada periode ini.</p>
                        ) : (
                            paymentBreakdown.map((pm) => (
                                <div key={pm.method} className="p-3 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <span className="w-8 h-8 rounded-xl bg-pink-100 text-pink-700 flex items-center justify-center text-xs font-black">
                                            {pm.method.substring(0, 3)}
                                        </span>
                                        <div>
                                            <p className="text-xs font-black text-gray-900 uppercase">{pm.method}</p>
                                            <p className="text-[10px] font-bold text-gray-500">{pm.percent}% dari total</p>
                                        </div>
                                    </div>
                                    <span className="text-xs font-black text-gray-900">
                                        Rp {pm.amount.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-xs font-bold text-gray-600">
                        <span>Total Pembayaran:</span>
                        <strong className="text-emerald-700 text-sm font-black">Rp {branchTotals.rangeIncome.toLocaleString('id-ID')}</strong>
                    </div>
                </div>
            </div>

            {/* 6. TOP TREATMENT & TOP PRODUK TERLARIS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top 5 Treatment */}
                <div className="card-ayumi p-6 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                    <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
                        <div className="w-9 h-9 rounded-2xl bg-pink-100/80 text-[#B5588A] flex items-center justify-center shrink-0 shadow-inner">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                        </div>
                        <div>
                            <h3 className="text-base sm:text-lg font-extrabold text-gray-900">Top Perawatan (Treatment) Terlaris</h3>
                            <p className="text-xs text-gray-500 font-semibold mt-0.5">Layanan paling diminati periode ini di {userBranchName}.</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {topTreatments.length === 0 ? (
                            <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi treatment pada periode ini.</p>
                        ) : (
                            topTreatments.map((t, idx) => (
                                <div key={t.name} className="flex items-center justify-between p-3.5 rounded-2xl bg-pink-50/40 border border-pink-100/60 hover:bg-pink-50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className="w-7 h-7 rounded-xl bg-pink-100 text-[#B5588A] font-black text-xs flex items-center justify-center shrink-0">
                                            #{idx + 1}
                                        </span>
                                        <div>
                                            <p className="font-extrabold text-xs text-gray-900">{t.name}</p>
                                            <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{t.count} Sesi Terlaksana</p>
                                        </div>
                                    </div>
                                    <span className="font-extrabold text-xs text-[#B5588A] tracking-tight">
                                        Rp {t.revenue.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Top 5 Produk */}
                <div className="card-ayumi p-6 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                    <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
                        <div className="w-9 h-9 rounded-2xl bg-cyan-100/80 text-[#06B6D4] flex items-center justify-center shrink-0 shadow-inner">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                        </div>
                        <div>
                            <h3 className="text-base sm:text-lg font-extrabold text-gray-900">Top Produk Skincare Terlaris</h3>
                            <p className="text-xs text-gray-500 font-semibold mt-0.5">Produk skincare paling laris periode ini di {userBranchName}.</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {topProducts.length === 0 ? (
                            <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada penjualan produk pada periode ini.</p>
                        ) : (
                            topProducts.map((p, idx) => (
                                <div key={p.name} className="flex items-center justify-between p-3.5 rounded-2xl bg-cyan-50/40 border border-cyan-100/60 hover:bg-cyan-50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className="w-7 h-7 rounded-xl bg-cyan-100 text-[#06B6D4] font-black text-xs flex items-center justify-center shrink-0">
                                            #{idx + 1}
                                        </span>
                                        <div>
                                            <p className="font-extrabold text-xs text-gray-900">{p.name}</p>
                                            <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{p.count} Unit Terjual</p>
                                        </div>
                                    </div>
                                    <span className="font-extrabold text-xs text-[#06B6D4] tracking-tight">
                                        Rp {p.revenue.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 7. TABEL RIWAYAT TRANSAKSI TERKINI */}
            <div className="card-ayumi p-5 sm:p-7 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200">
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                            <h3 className="text-base sm:text-lg font-extrabold text-[#5c3316]">
                                Riwayat Transaksi Terkini ({userBranchName})
                            </h3>
                        </div>
                        <p className="text-xs text-gray-500 font-semibold mt-0.5 pl-4">
                            Daftar transaksi kasir terkini untuk periode {startDate} s/d {endDate}.
                        </p>
                    </div>
                    <button
                        onClick={() => router.push('/transactions')}
                        className="text-xs font-extrabold text-ayumi-primary hover:underline flex items-center gap-1 shrink-0"
                    >
                        <span>Lihat Semua Transaksi ➔</span>
                    </button>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-gray-100">
                    {recentBranchTransactions.length === 0 ? (
                        <div className="py-12 text-center text-gray-400 text-xs font-semibold">
                            Tidak ada data transaksi pada rentang tanggal ini.
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-pink-50/50 text-[#5c3316] font-extrabold border-b border-pink-100 uppercase tracking-wider text-[11px]">
                                    <th className="p-3">Waktu</th>
                                    <th className="p-3">No. Transaksi</th>
                                    <th className="p-3">Pasien</th>
                                    <th className="p-3">Rincian Item</th>
                                    <th className="p-3 text-right">Total Bayar</th>
                                    <th className="p-3 text-center">Metode</th>
                                    <th className="p-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {recentBranchTransactions.map(tx => {
                                    const isVoid = tx.payment_status === 'void'
                                    return (
                                        <tr key={tx.id} className="hover:bg-pink-50/20 transition-colors">
                                            <td className="p-3 font-semibold text-gray-600 whitespace-nowrap">
                                                {formatLogDateTime(tx.created_at)}
                                            </td>
                                            <td className="p-3 font-bold text-gray-900 whitespace-nowrap">
                                                <Link href="/transactions" className="hover:text-pink-600 hover:underline">
                                                    {tx.transaction_number || tx.id.slice(0, 8)}
                                                </Link>
                                            </td>
                                            <td className="p-3 font-extrabold text-gray-900">
                                                {tx.patients?.full_name || 'Pasien Umum'}
                                                {tx.patients?.whatsapp && (
                                                    <p className="text-[10px] text-gray-400 font-normal">{tx.patients.whatsapp}</p>
                                                )}
                                            </td>
                                            <td className="p-3 text-gray-600">
                                                {tx.transaction_items && tx.transaction_items.length > 0 ? (
                                                    <div className="space-y-0.5">
                                                        {tx.transaction_items.slice(0, 2).map((item, i) => (
                                                            <p key={i} className="text-[11px]">
                                                                • {item.name} <span className="text-gray-400">({item.quantity}x)</span>
                                                            </p>
                                                        ))}
                                                        {tx.transaction_items.length > 2 && (
                                                            <p className="text-[10px] text-pink-600 font-bold">
                                                                +{tx.transaction_items.length - 2} item lainnya
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400">-</span>
                                                )}
                                            </td>
                                            <td className={`p-3 text-right font-black text-sm whitespace-nowrap ${isVoid ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                                                Rp {Number(tx.total || 0).toLocaleString('id-ID')}
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                <span className="px-2.5 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-[10px] font-extrabold uppercase">
                                                    {tx.payment_method || 'CASH'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                {isVoid ? (
                                                    <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black border border-red-200">
                                                        VOID
                                                    </span>
                                                ) : (
                                                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-200">
                                                        LUNAS
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* 8. WIDGET OPERASIONAL & CRM HARIAN */}
            <div className="space-y-6">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316]">
                        Operasional & Retensi Pasien ({userBranchName})
                    </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {/* 1. Appointment Hari Ini */}
                    <div 
                        onClick={() => router.push('/appointments')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-blue-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            </div>
                            <span className="bg-blue-50 text-blue-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-blue-200/60 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                Buka Modul ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statAppointments}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Appointment Hari Ini</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Jadwal konsultasi/treatment terdaftar</p>
                        </div>
                    </div>

                    {/* 2. Follow Up Hari Ini */}
                    <div 
                        onClick={() => router.push('/crm')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-orange-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-orange-100 text-orange-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                            </div>
                            <span className="bg-orange-50 text-orange-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-orange-200/60 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                Kelola CRM ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statFollowups}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Tugas CRM Hari Ini</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Antrean follow up perlu dihubungi</p>
                        </div>
                    </div>

                    {/* 3. Birthday Bulan Ini */}
                    <div 
                        onClick={() => router.push('/crm')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-pink-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-pink-100 text-pink-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                🎂
                            </div>
                            <span className="bg-pink-50 text-pink-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-pink-200/60 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                Kirim Ucapan ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statBirthdays}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Ulang Tahun Bulan Ini</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Pasien berulang tahun di {currentMonthLabel}</p>
                        </div>
                    </div>

                    {/* 4. Pasien Dormant (>60 Hari) */}
                    <div 
                        onClick={() => router.push('/crm')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-red-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-red-100 text-red-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-red-600 group-hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <span className="bg-red-50 text-red-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-red-200/60 group-hover:bg-red-600 group-hover:text-white transition-colors">
                                Re-Engage ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statDormant}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Pasien Dormant (&gt;60 Hari)</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Pasien lama belum berkunjung ulang</p>
                        </div>
                    </div>

                    {/* 5. Pasien Baru Bulan Ini */}
                    <div 
                        onClick={() => router.push('/patients')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-emerald-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            </div>
                            <span className="bg-emerald-50 text-emerald-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-emerald-200/60 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                Data Pasien ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statNewPatients}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Pasien Baru Bulan Ini</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Registrasi pasien baru di {currentMonthLabel}</p>
                        </div>
                    </div>

                    {/* 6. Kupon Expired (30 Hari) */}
                    <div 
                        onClick={() => router.push('/coupons')}
                        className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-pink-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                    >
                        <div className="flex items-center justify-between">
                            <div className="w-12 h-12 bg-pink-100 text-pink-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                            </div>
                            <span className="bg-pink-50 text-pink-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-pink-200/60 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                Kelola Kupon ➔
                            </span>
                        </div>
                        <div className="mt-4">
                            <h3 className={`text-3xl font-black tracking-tight ${statExpiringCoupons > 0 ? 'text-red-600' : 'text-gray-900'}`}>{statExpiringCoupons}</h3>
                            <p className="text-xs font-bold text-gray-800 mt-1">Kupon Expired (30 Hari)</p>
                            <p className="text-[11px] font-semibold text-gray-500 mt-1">Kupon mendekati batas kedaluwarsa</p>
                        </div>
                    </div>
                </div>

                {/* Grid Tabel Janji Temu & Follow Up */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Janji Temu Terdekat Hari Ini */}
                    <div className="card-ayumi overflow-hidden flex flex-col bg-white hover:shadow-md transition-shadow duration-300 rounded-3xl border border-gray-200">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-pink-50/50 via-purple-50/30 to-white">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                <h3 className="font-extrabold text-ayumi-secondary text-base">Janji Temu Terdekat Hari Ini</h3>
                            </div>
                            <button onClick={() => router.push('/appointments')} className="text-xs font-extrabold text-ayumi-primary hover:underline flex items-center gap-1">
                                Kelola Semua ➔
                            </button>
                        </div>
                        <div className="p-5 flex-1 flex flex-col justify-center">
                            {recentAppointments.length === 0 ? (
                                <div className="py-8 text-center space-y-3">
                                    <div className="w-12 h-12 bg-pink-50 text-ayumi-primary rounded-2xl flex items-center justify-center mx-auto border border-pink-100">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    </div>
                                    <div>
                                        <p className="text-sm font-extrabold text-gray-800">Belum Ada Jadwal Appointment Hari Ini</p>
                                        <p className="text-xs text-gray-500 font-medium mt-0.5">Buat jadwal reservasi perawatan untuk pasien klinik Anda.</p>
                                    </div>
                                    <button 
                                        onClick={() => router.push('/appointments')}
                                        className="btn-primary text-xs px-4 py-2 font-extrabold shadow-sm inline-flex items-center gap-1.5"
                                    >
                                        <span>+ Buat Appointment Baru</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2.5">
                                    {recentAppointments.map(apt => {
                                        const initial = apt.patients?.full_name ? apt.patients.full_name.charAt(0).toUpperCase() : '?';
                                        return (
                                            <div 
                                                key={apt.id} 
                                                onClick={() => router.push('/appointments')}
                                                className="flex items-center justify-between p-3.5 bg-gray-50/60 hover:bg-pink-50/60 rounded-2xl transition-all cursor-pointer border border-gray-100 hover:border-pink-200 group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-pink-100 text-ayumi-primary flex items-center justify-center font-extrabold text-xs shadow-inner">
                                                        {initial}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-extrabold text-gray-900 text-xs group-hover:text-ayumi-primary transition-colors">
                                                            {apt.patients?.full_name || 'Pasien Tanpa Nama'}
                                                        </h4>
                                                        <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                                            Jam: {apt.start_time?.slice(0, 5)} - {apt.end_time?.slice(0, 5)} WIB
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-blue-50 text-blue-700 border border-blue-200">
                                                    {apt.status}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Antrean Follow-Up CRM */}
                    <div className="card-ayumi overflow-hidden flex flex-col bg-white hover:shadow-md transition-shadow duration-300 rounded-3xl border border-gray-200">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-orange-50/50 via-pink-50/30 to-white">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-6 bg-orange-500 rounded-full"></div>
                                <h3 className="font-extrabold text-ayumi-secondary text-base">Tugas Follow-Up CRM</h3>
                            </div>
                            <button onClick={() => router.push('/crm')} className="text-xs font-extrabold text-orange-600 hover:underline flex items-center gap-1">
                                Kelola CRM ➔
                            </button>
                        </div>
                        <div className="p-5 flex-1 flex flex-col justify-center">
                            {recentFollowups.length === 0 ? (
                                <div className="py-8 text-center space-y-3">
                                    <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center mx-auto border border-orange-100">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                    </div>
                                    <div>
                                        <p className="text-sm font-extrabold text-gray-800">Tidak Ada Antrean Follow-Up Tertunda</p>
                                        <p className="text-xs text-gray-500 font-medium mt-0.5">Semua pasien telah dihubungi atau tidak ada jadwal hari ini.</p>
                                    </div>
                                    <button 
                                        onClick={() => router.push('/crm')}
                                        className="btn-primary text-xs px-4 py-2 font-extrabold shadow-sm inline-flex items-center gap-1.5"
                                    >
                                        <span>Buka Modul CRM</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2.5">
                                    {recentFollowups.map(fu => {
                                        const initial = fu.patients?.full_name ? fu.patients.full_name.charAt(0).toUpperCase() : '?';
                                        const isHigh = fu.priority === 'high' || fu.priority === 'urgent'
                                        return (
                                            <div 
                                                key={fu.id} 
                                                onClick={() => router.push('/crm')}
                                                className="flex items-center justify-between p-3.5 bg-gray-50/60 hover:bg-orange-50/60 rounded-2xl transition-all cursor-pointer border border-gray-100 hover:border-orange-200 group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-extrabold text-xs shadow-inner">
                                                        {initial}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-extrabold text-gray-900 text-xs group-hover:text-orange-600 transition-colors">
                                                            {fu.patients?.full_name || 'Pasien Tanpa Nama'}
                                                        </h4>
                                                        <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                                            Tipe: {fu.followup_type ? fu.followup_type.replace(/_/g, ' ') : 'Pesan Retensi'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase border ${isHigh ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                                                    {fu.priority || 'Normal'}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* MODAL: ATUR TARGET OMSET BULANAN (OWNER ONLY) */}
            {isTargetModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-lg w-full overflow-hidden space-y-5 p-6">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <div>
                                <h3 className="text-lg font-black text-gray-900">Atur Target Omset Cabang</h3>
                                <p className="text-xs text-gray-500 font-semibold">Tentukan target omset per bulan untuk setiap cabang operasional.</p>
                            </div>
                            <button onClick={() => setIsTargetModalOpen(false)} className="text-gray-400 hover:text-red-500 p-2 rounded-xl">
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                            {branches.map(b => (
                                <div key={b.id} className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
                                    <label className="text-xs font-extrabold text-gray-800 flex items-center justify-between">
                                        <span>{b.name}</span>
                                        <span className="text-[10px] text-gray-400 font-normal">ID: {b.id.slice(0, 8)}</span>
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-xs">Rp</span>
                                        <input
                                            type="number"
                                            value={targetFormData[b.id] ?? ''}
                                            onChange={(e) => setTargetFormData({ ...targetFormData, [b.id]: e.target.value })}
                                            placeholder="Contoh: 65000000"
                                            className="w-full pl-10 pr-3.5 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setIsTargetModalOpen(false)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveTargets}
                                disabled={isSavingTargets}
                                className="px-6 py-2 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 text-white rounded-xl text-xs font-black shadow-md transition-all disabled:opacity-50"
                            >
                                {isSavingTargets ? 'Menyimpan...' : 'Simpan Target'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: RINCIAN PEMAKAIAN SESI KUPON */}
            {isCouponUsageModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden">
                        <div className="p-5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md shadow-amber-500/20 text-lg shrink-0">
                                    🎟️
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-gray-900">Rincian Pemakaian Sesi Kupon</h3>
                                    <p className="text-xs text-amber-800 font-semibold mt-0.5">
                                        Histori penukaran sesi kupon periode {startDate} s/d {endDate} ({couponUsageModalBranch.name})
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsCouponUsageModalOpen(false)} 
                                className="text-gray-400 hover:text-red-500 p-2 rounded-xl"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
                            {isOwner ? (
                                <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
                                    <button
                                        type="button"
                                        onClick={() => setCouponUsageModalBranch({ id: '', name: 'Semua Cabang' })}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                            couponUsageModalBranch.id === ''
                                                ? 'bg-amber-600 text-white shadow-sm'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                                        }`}
                                    >
                                        Semua Cabang
                                    </button>
                                    {branches.filter(b => b.is_active !== false).map(b => (
                                        <button
                                            key={b.id}
                                            type="button"
                                            onClick={() => setCouponUsageModalBranch({ id: b.id, name: b.name })}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                                couponUsageModalBranch.id === b.id
                                                    ? 'bg-amber-600 text-white shadow-sm'
                                                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                                            }`}
                                        >
                                            {b.name}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <span className="px-3.5 py-1.5 rounded-xl bg-amber-100 text-amber-900 font-black text-xs border border-amber-200 shadow-sm">
                                    🏥 {userBranchName}
                                </span>
                            )}

                            <div className="relative w-full sm:w-64 shrink-0">
                                <input
                                    type="text"
                                    value={couponUsageSearch}
                                    onChange={(e) => setCouponUsageSearch(e.target.value)}
                                    placeholder="Cari pasien / perawatan..."
                                    className="w-full pl-3.5 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                            </div>
                        </div>

                        <div className="px-5 py-2.5 bg-amber-50/50 border-b border-amber-100 flex items-center justify-between text-xs shrink-0">
                            <span className="font-bold text-amber-900">
                                Ditemukan: <strong className="text-amber-700 font-extrabold">{filteredCouponLogs.length} Sesi Terpakai</strong>
                            </span>
                            <span className="text-[11px] text-gray-500 font-medium">
                                Cabang Terpilih: <strong>{couponUsageModalBranch.name}</strong>
                            </span>
                        </div>

                        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                            {filteredCouponLogs.length === 0 ? (
                                <div className="text-center py-12 px-4 space-y-3">
                                    <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto text-2xl">
                                        🎟️
                                    </div>
                                    <p className="text-sm font-extrabold text-gray-700">Belum Ada Pemakaian Sesi Kupon</p>
                                    <p className="text-xs text-gray-500 max-w-md mx-auto">
                                        Tidak ditemukan transaksi atau klaim pemakaian sesi kupon untuk periode dan cabang yang dipilih.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border border-gray-100">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="bg-amber-50/80 text-amber-900 font-extrabold border-b border-amber-100 uppercase tracking-wider text-[11px]">
                                                <th className="p-3">Waktu</th>
                                                <th className="p-3">Pasien</th>
                                                <th className="p-3">Cabang</th>
                                                <th className="p-3">Paket & Perawatan</th>
                                                <th className="p-3 text-center">Status Sesi</th>
                                                <th className="p-3">Petugas</th>
                                                <th className="p-3">Catatan / Ref</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {filteredCouponLogs.map((log, idx) => {
                                                const pkgName = log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || 'Paket Kupon'
                                                const trName = log.patient_coupon_items?.treatments?.name || 'Perawatan Sesi'
                                                const used = log.patient_coupon_items?.used_sessions || 1
                                                const total = log.patient_coupon_items?.total_sessions || 1
                                                const remaining = log.patient_coupon_items?.remaining_sessions || 0

                                                return (
                                                    <tr key={log.id || idx} className="hover:bg-amber-50/40 transition-colors">
                                                        <td className="p-3 font-semibold text-gray-600 whitespace-nowrap">
                                                            {formatLogDateTime(log.used_at)}
                                                        </td>
                                                        <td className="p-3 font-extrabold text-gray-900">
                                                            {log.patients?.full_name || 'Pasien'}
                                                            {log.patients?.whatsapp && (
                                                                <p className="text-[10px] text-gray-400 font-medium">{log.patients.whatsapp}</p>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-gray-600 font-bold whitespace-nowrap">
                                                            <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-[10px] font-bold">
                                                                {log.branches?.name || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="p-3">
                                                            <p className="font-extrabold text-gray-900">{trName}</p>
                                                            <p className="text-[10px] text-gray-500 font-semibold">{pkgName}</p>
                                                        </td>
                                                        <td className="p-3 text-center whitespace-nowrap">
                                                            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                                                                Sesi {used}/{total} (Sisa: {remaining})
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-gray-700 font-semibold whitespace-nowrap">
                                                            {log.users?.full_name || '-'}
                                                        </td>
                                                        <td className="p-3 text-gray-500 text-[11px]">
                                                            {log.notes || '-'}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                            <Link
                                href="/coupons"
                                className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold transition-all shadow-sm"
                            >
                                🎟️ Buka Menu Kupon Lengkap ➔
                            </Link>
                            <button 
                                type="button"
                                onClick={() => setIsCouponUsageModalOpen(false)}
                                className="btn-primary px-6 py-2 text-xs font-bold rounded-xl shadow-md"
                            >
                                Tutup
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
