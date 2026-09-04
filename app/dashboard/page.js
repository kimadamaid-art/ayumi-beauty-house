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
import { getNetTransactionRevenue, getQrisFee, parsePaymentSplits } from '@/lib/paymentUtils'
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip as RechartsTooltip, 
    ResponsiveContainer, 
    Legend
} from 'recharts'

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
            
            // 1. Fetch transactions for selected date range with items
            let txQuery = supabase
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
                        patient_id,
                        total,
                        subtotal,
                        discount,
                        payment_method,
                        payment_status,
                        created_at,
                        notes,
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
                }
                const fallback = await fallbackQuery
                rangeTrx = fallback.data
            }

            // Save recent transactions for the table (10 latest)
            setRecentBranchTransactions(rangeTrx ? rangeTrx.slice(0, 10) : [])

            const rangeMap = {}
            let grandTotalRange = 0
            let grandTreatmentRange = 0
            let grandProductRange = 0
            let grandCouponSalesRange = 0
            let grandCouponUsedRange = 0
            let grandQrisFeeRange = 0
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
                    qrisFee: 0,
                    transactionCount: 0
                }
            })

            if (rangeTrx) {
                rangeTrx.forEach(tx => {
                    const isPaid = tx.payment_status !== 'void'
                    if (tx && tx.branch_id && rangeMap[tx.branch_id] && isPaid) {
                        const branchObj = rangeMap[tx.branch_id]
                        branchObj.transactionCount += 1
                        totalTxCountRange += 1
                        
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
                            txTreatment += getNetTransactionRevenue(tx)
                        }

                        branchObj.treatmentIncome += txTreatment
                        branchObj.productIncome += txProduct
                        branchObj.couponSalesIncome += txCouponSales
                        branchObj.couponUsedValue += txCouponUsed
                        branchObj.couponUsedSessions += txCouponSessions
                        branchObj.otherIncome += txOther
                        
                        const realCash = getNetTransactionRevenue(tx)
                        const txQrisFee = getQrisFee(tx)
                        const totalValuation = realCash + txCouponUsed

                        branchObj.cashIncome += realCash
                        branchObj.totalIncome += totalValuation
                        branchObj.qrisFee += txQrisFee

                        grandTotalRange += realCash
                        grandTreatmentRange += txTreatment
                        grandProductRange += txProduct
                        grandCouponSalesRange += txCouponSales
                        grandCouponUsedRange += txCouponUsed
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
                    monthlyIncome: 0,
                    monthlyQrisFee: 0
                }
            })

            if (monthlyTrx) {
                monthlyTrx.forEach(tx => {
                    if (tx && tx.branch_id && monthlyMap[tx.branch_id]) {
                        const amt = getNetTransactionRevenue(tx)
                        const qFee = getQrisFee(tx)
                        monthlyMap[tx.branch_id].monthlyIncome += amt
                        monthlyMap[tx.branch_id].monthlyQrisFee += qFee
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
                qrisFee: grandQrisFeeRange,
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
            let aptQuery = supabase.from('appointments').select('id, start_time, end_time, status, patient_id, patients(id, full_name, whatsapp)', { count: 'exact' })
                .eq('appointment_date', todayDateStr)
                .order('start_time', { ascending: true })
            aptQuery = applyBranch(aptQuery)

            // 2. Followups Pending
            let fuQuery = supabase.from('followup_queue').select('id, followup_type, priority, scheduled_date, patient_id, patients(id, full_name, whatsapp)', { count: 'exact' })
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
        if (dbUser && branches.length > 0) {
            fetchDashboardMetrics(branches, startDate, endDate, targetMonth, dbUser)
            fetchOperationalStats(dbUser)
        }
    }, [startDate, endDate, targetMonth, selectedBranch, dbUser, branches, fetchDashboardMetrics])

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

    const handlePrintSummary = async () => {
        const toastId = toast.loading('Menyiapkan dokumen PDF Rekap Omset...')
        try {
            const { jsPDF } = await import('jspdf')
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            const formatCurrency = (val) => "Rp " + Number(val || 0).toLocaleString('id-ID')
            const primaryColor = [212, 98, 33]    // #D46221
            const secondaryColor = [78, 42, 18]   // #4E2A12
            const accentColor = [242, 216, 195]   // #F2D8C3
            const darkText = [44, 30, 22]         // #2C1E16
            const mutedText = [140, 125, 115]     // #8C7D73

            let y = 15
            const pageHeight = 297
            const margin = 15
            const contentWidth = 180
            let pageNum = 1

            const addHeaderFooter = (d, isFirstPage = false) => {
                if (!isFirstPage) {
                    d.setFont('helvetica', 'bold')
                    d.setFontSize(8)
                    d.setTextColor(...mutedText)
                    d.text('EXECUTIVE BUSINESS SUMMARY - AYUMI BEAUTY HOUSE', margin, 10)
                    d.setDrawColor(245, 238, 230)
                    d.setLineWidth(0.3)
                    d.line(margin, 12, margin + contentWidth, 12)
                }
                d.setFont('helvetica', 'normal')
                d.setFontSize(7.5)
                d.setTextColor(...mutedText)
                d.text(`Ayumi Beauty House  |  Dicetak pada: ${new Date().toLocaleString('id-ID')}`, margin, pageHeight - 10)
                d.text(`Halaman ${pageNum}`, margin + contentWidth - 15, pageHeight - 10)
            }

            const logoBase64 = await getLogoBase64()

            // --- 1. KOP SURAT ---
            doc.setFillColor(...primaryColor)
            doc.rect(margin, y, contentWidth, 2.5, 'F')
            y += 6

            let textStartX = margin
            if (logoBase64) {
                try {
                    doc.addImage(logoBase64, 'PNG', margin, y, 16, 16)
                    textStartX = margin + 19
                } catch (e) {
                    console.error('Failed to embed logo in dashboard PDF:', e)
                }
            }

            doc.setFont('helvetica', 'bold')
            doc.setFontSize(15)
            doc.setTextColor(...secondaryColor)
            doc.text('AYUMI BEAUTY HOUSE', textStartX, y + 4)

            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...mutedText)
            doc.text('Kecantikan, Kosmetik & Perawatan Diri', textStartX, y + 8)

            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...primaryColor)
            doc.text('EXECUTIVE SUMMARY - REKAP OMSET PERUSAHAAN', textStartX, y + 13.5)

            // Metadata Right Side (No overlap)
            doc.setFontSize(7)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...darkText)
            const printDateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            const printedBy = dbUser?.full_name || 'Owner'

            const metaX = margin + 120
            doc.text(`Periode: ${startDate} s.d ${endDate}`, metaX, y + 2.5)
            doc.text(`Cakupan: ${branches.length} Cabang Klinik`, metaX, y + 6.2)
            doc.text(`Tanggal Cetak: ${printDateStr}`, metaX, y + 9.9)
            doc.text(`Pencetak: ${printedBy}`, metaX, y + 13.6)

            y += 19
            doc.setDrawColor(...accentColor)
            doc.setLineWidth(0.4)
            doc.line(margin, y, margin + contentWidth, y)
            y += 7

            // --- 2. DUA KARTU KPI UTAMA (50% - 50%) ---
            const cardW = 86
            const cardGap = 8
            const cardH = 17

            // Card 1: Total Pendapatan Perusahaan
            doc.setFillColor(254, 252, 250)
            doc.setDrawColor(...accentColor)
            doc.setLineWidth(0.3)
            doc.roundedRect(margin, y, cardW, cardH, 2, 2, 'FD')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7.5)
            doc.setTextColor(...mutedText)
            doc.text('TOTAL PENDAPATAN PERUSAHAAN', margin + 4, y + 5)
            doc.setFontSize(11)
            doc.setTextColor(...primaryColor)
            doc.text(formatCurrency(branchTotals.rangeIncome), margin + 4, y + 11.5)
            doc.setFontSize(6.5)
            doc.setTextColor(...darkText)
            doc.text(`Akumulasi Seluruh (${branches.length}) Cabang Klinik`, margin + 4, y + 15)

            // Card 2: Total Transaksi Perusahaan
            const c2X = margin + cardW + cardGap
            doc.roundedRect(c2X, y, cardW, cardH, 2, 2, 'FD')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7.5)
            doc.setTextColor(...mutedText)
            doc.text('TOTAL TRANSAKSI PERUSAHAAN', c2X + 4, y + 5)
            doc.setFontSize(11)
            doc.setTextColor(...darkText)
            doc.text(`${branchTotals.rangeTxCount} Transaksi`, c2X + 4, y + 11.5)
            doc.setFontSize(6.5)
            doc.setTextColor(...mutedText)
            doc.text('Total Seluruh Transaksi Kasir POS', c2X + 4, y + 15)

            y += cardH + 7

            // --- 3. SEBARAN METODE PEMBAYARAN ---
            if (paymentBreakdown && paymentBreakdown.length > 0) {
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(8)
                doc.setTextColor(...secondaryColor)
                doc.text('SEBARAN METODE PEMBAYARAN', margin, y)
                y += 3.5

                let pX = margin
                paymentBreakdown.forEach((pm) => {
                    const methodLabel = pm.method || 'CASH'
                    const methodAmt = formatCurrency(pm.amount || 0)
                    const methodPct = `${pm.percent || 0}%`
                    const pText = `${methodLabel}: ${methodAmt} (${methodPct})`

                    doc.setFont('helvetica', 'bold')
                    doc.setFontSize(7)
                    doc.setTextColor(...darkText)
                    doc.setFillColor(254, 252, 250)
                    doc.setDrawColor(...accentColor)
                    doc.setLineWidth(0.2)

                    const pWidth = (doc.getStringUnitWidth(pText) * 7 * 25.4) / 72 + 6
                    if (pX + pWidth > margin + contentWidth) {
                        pX = margin
                        y += 6
                    }
                    doc.roundedRect(pX, y - 3.2, pWidth, 4.8, 1, 1, 'FD')
                    doc.text(pText, pX + 3, y)
                    pX += pWidth + 3
                })
                y += 8
            }

            // --- 4. TABEL RINCIAN PERFORMA & OMSET PER CABANG ---
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(8)
            doc.setTextColor(...secondaryColor)
            doc.text('RINCIAN PERFORMA & OMSET PER CABANG', margin, y)
            y += 3.5

            const bHeaders = ['Nama Cabang', 'Omset Treatment', 'Omset Produk', 'Kupon Terjual', 'Pemakaian Sesi', 'Total Omset', 'Trx']
            const bWidths = [38, 26, 26, 24, 26, 28, 12]

            const drawBranchHeader = () => {
                doc.setFillColor(...primaryColor)
                doc.rect(margin, y, contentWidth, 6, 'F')
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7)
                doc.setTextColor(255, 255, 255)

                let curX = margin
                bHeaders.forEach((h, idx) => {
                    const align = idx === 0 ? 'left' : 'right'
                    const textX = align === 'right' ? curX + bWidths[idx] - 2 : curX + 2
                    doc.text(h, textX, y + 4, { align })
                    curX += bWidths[idx]
                })
                y += 6
            }

            drawBranchHeader()

            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7)

            let totalTreatAll = 0
            let totalProdAll = 0
            let totalCouponSalesAll = 0
            let totalCouponUsedAll = 0
            let totalGrandOmset = 0
            let totalTrxAll = 0

            branchDailyComparison.forEach((b, idx) => {
                if (y + 7 > pageHeight - 15) {
                    addHeaderFooter(doc)
                    doc.addPage()
                    pageNum++
                    y = 15
                    drawBranchHeader()
                }

                if (idx % 2 === 1) {
                    doc.setFillColor(254, 252, 250)
                    doc.rect(margin, y, contentWidth, 5.5, 'F')
                }

                doc.setTextColor(...darkText)
                let curX = margin

                const treatVal = Number(b.treatmentIncome || 0)
                const prodVal = Number(b.productIncome || 0)
                const cSalesVal = Number(b.couponSalesIncome || 0)
                const cUsedVal = Number(b.couponUsedValue || 0)
                const totVal = Number(b.totalIncome || 0)
                const trxVal = Number(b.transactionCount || 0)

                totalTreatAll += treatVal
                totalProdAll += prodVal
                totalCouponSalesAll += cSalesVal
                totalCouponUsedAll += cUsedVal
                totalGrandOmset += totVal
                totalTrxAll += trxVal

                const rowData = [
                    b.branchName || 'Cabang',
                    treatVal.toLocaleString('id-ID'),
                    prodVal.toLocaleString('id-ID'),
                    cSalesVal.toLocaleString('id-ID'),
                    cUsedVal.toLocaleString('id-ID'),
                    totVal.toLocaleString('id-ID'),
                    trxVal.toString()
                ]

                rowData.forEach((val, colIdx) => {
                    const align = colIdx === 0 ? 'left' : 'right'
                    const textX = align === 'right' ? curX + bWidths[colIdx] - 2 : curX + 2
                    if (colIdx === 5) {
                        doc.setFont('helvetica', 'bold')
                        doc.setTextColor(...primaryColor)
                    } else {
                        doc.setFont('helvetica', 'normal')
                        doc.setTextColor(...darkText)
                    }
                    doc.text(val, textX, y + 3.8, { align })
                    curX += bWidths[colIdx]
                })

                doc.setDrawColor(242, 216, 195)
                doc.setLineWidth(0.15)
                doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                y += 5.5
            })

            // Baris Total Keseluruhan di Tabel
            doc.setFillColor(242, 216, 195)
            doc.rect(margin, y, contentWidth, 6, 'F')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7)
            doc.setTextColor(...secondaryColor)

            let curTotX = margin
            const summaryRowData = [
                'TOTAL KESELURUHAN',
                totalTreatAll.toLocaleString('id-ID'),
                totalProdAll.toLocaleString('id-ID'),
                totalCouponSalesAll.toLocaleString('id-ID'),
                totalCouponUsedAll.toLocaleString('id-ID'),
                totalGrandOmset.toLocaleString('id-ID'),
                totalTrxAll.toString()
            ]

            summaryRowData.forEach((val, colIdx) => {
                const align = colIdx === 0 ? 'left' : 'right'
                const textX = align === 'right' ? curTotX + bWidths[colIdx] - 2 : curTotX + 2
                doc.text(val, textX, y + 4, { align })
                curTotX += bWidths[colIdx]
            })

            y += 10

            // --- 5. TOP TREATMENT & TOP PRODUK (2 Columns side-by-side) ---
            if (y + 36 > pageHeight - 15) {
                addHeaderFooter(doc)
                doc.addPage()
                pageNum++
                y = 15
            }

            const colW = 86
            const colGap = 8

            // Top Treatments Box
            doc.setFillColor(254, 252, 250)
            doc.setDrawColor(...accentColor)
            doc.setLineWidth(0.3)
            doc.roundedRect(margin, y, colW, 35, 2, 2, 'FD')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7.5)
            doc.setTextColor(...secondaryColor)
            doc.text('TOP TREATMENT TERLARIS', margin + 3.5, y + 5)

            let tY = y + 9.5;
            const safeTopTreatments = topTreatments && Array.isArray(topTreatments) ? topTreatments.slice(0, 5) : [];
            safeTopTreatments.forEach((t, idx) => {
                doc.setFont('helvetica', 'normal')
                doc.setFontSize(6.8)
                doc.setTextColor(...darkText)
                doc.text(`${idx + 1}. ${(t.name || '-').substring(0, 24)}`, margin + 3.5, tY)
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(...primaryColor)
                doc.text(`${t.count}x (${formatCurrency(t.revenue)})`, margin + colW - 3.5, tY, { align: 'right' })
                tY += 4.8
            });

            // Top Products Box
            const pBoxX = margin + colW + colGap
            doc.setFillColor(254, 252, 250)
            doc.roundedRect(pBoxX, y, colW, 35, 2, 2, 'FD')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7.5)
            doc.setTextColor(...secondaryColor)
            doc.text('TOP PRODUK TERLARIS', pBoxX + 3.5, y + 5)

            let prY = y + 9.5;
            const safeTopProducts = topProducts && Array.isArray(topProducts) ? topProducts.slice(0, 5) : [];
            safeTopProducts.forEach((p, idx) => {
                doc.setFont('helvetica', 'normal')
                doc.setFontSize(6.8)
                doc.setTextColor(...darkText)
                doc.text(`${idx + 1}. ${(p.name || '-').substring(0, 24)}`, pBoxX + 3.5, prY)
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(...primaryColor)
                doc.text(`${p.count}x (${formatCurrency(p.revenue)})`, pBoxX + colW - 3.5, prY, { align: 'right' })
                prY += 4.8
            });

            addHeaderFooter(doc, pageNum === 1)

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

    if (loading && !dbUser) {
        return (
            <div className="min-h-[400px] flex flex-col items-center justify-center gap-3 text-stone-500 font-sans">
                <div className="w-8 h-8 border-2 border-stone-300 border-t-[#5c3316] rounded-full animate-spin" />
                <p className="text-xs font-semibold tracking-wide text-stone-400">Memuat data dashboard...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 pb-12 font-sans text-stone-900 relative">
            {loading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-3xl">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
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

                        {/* 3 KPI Cards: Total Pendapatan Perusahaan, Total Transaksi, Biaya Tambahan QRIS */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 pt-5 sm:pt-6">
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
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316]">Perbandingan Omset (Treatment & Produk) per Cabang</h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-4">
                                    Visualisasi perbandingan omset treatment dan produk antar cabang untuk rentang periode terpilih.
                                </p>
                            </div>

                            {/* Toolbar Kontrol: Rentang Waktu (DateRangePicker) */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto shrink-0">
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

                        {/* Recharts Bar Chart Grouped */}
                        <div className="h-64 sm:h-72 w-full pt-2">
                            {isMounted && branchDailyComparison.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        data={branchDailyComparison} 
                                        barGap={4} 
                                        barCategoryGap="18%"
                                        margin={{ top: 15, right: 10, left: 0, bottom: 20 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis 
                                            dataKey="branchName" 
                                            interval={0}
                                            tickFormatter={(val) => (val ? val.replace(/^Ayumi\s+/i, '') : val)}
                                            tick={{ fontSize: 10, fontWeight: 700, fill: '#1e293b' }} 
                                            axisLine={{ stroke: '#cbd5e1' }}
                                            tickLine={false} 
                                        />
                                        <YAxis 
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
                                        <RechartsTooltip 
                                            formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                            itemSorter={(item) => (item.name.includes('Treatment') ? -1 : 1)}
                                            labelStyle={{ fontWeight: 'bold', color: '#5c3316', fontSize: '13px' }}
                                            contentStyle={{ borderRadius: '16px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #f472b6', padding: '10px 14px' }}
                                        />
                                        <Legend 
                                            verticalAlign="top" 
                                            align="center"
                                            wrapperStyle={{ paddingTop: '0px', paddingBottom: '12px', fontWeight: '800', fontSize: '12px', color: '#0f172a' }} 
                                        />
                                        <Bar dataKey="treatmentIncome" name="Omset Treatment" fill="#EC4899" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <Bar dataKey="productIncome" name="Omset Produk" fill="#06B6D4" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <Bar dataKey="couponSalesIncome" name="Penjualan Kupon" fill="#10B981" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <Bar dataKey="couponUsedValue" name="Pemakaian Sesi" fill="#F59E0B" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                                    Mengambil data cabang...
                                </div>
                            )}
                        </div>

                        {/* Cards Breakdown Omset per Cabang */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 pt-1">
                            {branchDailyComparison.map(b => (
                                <div key={b.branchId} className="p-4 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 space-y-2.5 shadow-sm hover:shadow-md transition-all group flex flex-col justify-between">
                                    <div>
                                        <div className="pb-2 mb-2 border-b border-gray-100">
                                            <h4 className="font-extrabold text-base text-gray-900">
                                                {b.branchName}
                                            </h4>
                                        </div>

                                        <div className="space-y-1.5 pt-0.5">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-gray-700 font-bold flex items-center gap-1.5">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-[#EC4899] shrink-0"></span>
                                                    Treatment:
                                                </span>
                                                <strong className="text-gray-900 font-extrabold tracking-tight">Rp {b.treatmentIncome.toLocaleString('id-ID')}</strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-gray-700 font-bold flex items-center gap-1.5">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-[#06B6D4] shrink-0"></span>
                                                    Produk:
                                                </span>
                                                <strong className="text-gray-900 font-extrabold tracking-tight">Rp {b.productIncome.toLocaleString('id-ID')}</strong>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
                                                    Penjualan Kupon:
                                                </span>
                                                <strong className="text-emerald-700 font-extrabold tracking-tight">Rp {b.couponSalesIncome.toLocaleString('id-ID')}</strong>
                                            </div>
                                            <div 
                                                onClick={() => openCouponUsageModal(b.branchId, b.branchName)}
                                                className="flex justify-between items-center text-xs pt-1 border-t border-dashed border-gray-200 hover:bg-amber-50/70 p-1 -mx-1 rounded-lg transition-all cursor-pointer group/sesi"
                                                title="Klik untuk melihat rincian pemakaian sesi kupon"
                                            >
                                                <span className="text-amber-700 font-bold flex items-center gap-1.5">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                                                    Pemakaian Sesi:
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    <strong className="text-amber-700 font-extrabold tracking-tight">
                                                        {b.couponUsedSessions || 0} Sesi
                                                    </strong>
                                                    <span className="text-[10px] text-amber-700 bg-amber-100/90 group-hover/sesi:bg-amber-200 px-1.5 py-0.5 rounded font-bold transition-colors">
                                                        Rincian ↗
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-gray-100 flex justify-between items-end">
                                        <div>
                                            <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Total Pendapatan Tunai</p>
                                            <p className="text-base font-black text-[#5c3316] tracking-tight">Rp {b.cashIncome.toLocaleString('id-ID')}</p>
                                        </div>
                                        {b.couponUsedSessions > 0 && (
                                            <div 
                                                onClick={() => openCouponUsageModal(b.branchId, b.branchName)}
                                                className="text-right cursor-pointer hover:opacity-80 transition-opacity"
                                                title="Klik untuk melihat rincian pemakaian sesi"
                                            >
                                                <p className="text-[9px] text-amber-600 font-bold uppercase">+ Pemakaian Sesi</p>
                                                <p className="text-xs font-extrabold text-amber-600">{b.couponUsedSessions} Sesi</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SECTION 2: MONITORING TARGET BULANAN PER CABANG */}
                    <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-6 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
                        {/* Header Section */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-gray-200">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                    <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316]">Monitoring Target Bulanan per Cabang</h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-4">
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

                        {/* Akumulasi Global Perusahaan */}
                        {branchTotals.monthlyTarget > 0 && (
                            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Ringkasan Total Perusahaan</p>
                                        <p className="text-sm font-extrabold text-gray-900 mt-0.5">
                                            Total Omset Tunai: <span className="text-emerald-700 font-bold">Rp {branchTotals.rangeIncome?.toLocaleString('id-ID') || 0}</span> <span className="text-gray-500 font-normal text-xs">/ Rp {branchTotals.monthlyTarget.toLocaleString('id-ID')}</span>
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
                                                    <span>🎟️ Pemakaian Sesi: <strong>{(branchTotals.couponUsedSessions || 0)} Sesi</strong></span>
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
                                            {((branchTotals.rangeIncome / branchTotals.monthlyTarget) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                    <div className="w-32 h-2.5 bg-amber-200/60 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-amber-600 rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(100, Math.max(0, (branchTotals.rangeIncome / branchTotals.monthlyTarget) * 100))}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Grid Cards Target per Cabang */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
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

                                return (
                                    <div key={item.branchId} className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 shadow-sm space-y-3 transition-all group">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="font-extrabold text-base text-gray-900">{item.branchName}</h4>
                                                <p className="text-xs text-gray-500 font-semibold mt-0.5">Target Operasional Cabang</p>
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
                    </div>

                    {/* SECTION 3: TOP TREATMENT & TOP PRODUK TERLARIS PERUSAHAAN */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Top 5 Treatment Terfavorit */}
                        <div className="card-ayumi p-6 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                            <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
                                <div className="w-9 h-9 rounded-2xl bg-pink-100/80 text-[#B5588A] flex items-center justify-center shrink-0 shadow-inner">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-extrabold text-gray-900">Top Perawatan (Treatment) Terlaris</h3>
                                    <p className="text-xs text-gray-500 font-semibold mt-0.5">Layanan treatment paling banyak diminati periode ini.</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {topTreatments.length === 0 ? (
                                    <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi treatment pada periode ini.</p>
                                ) : (
                                    topTreatments.map((t, idx) => (
                                        <div key={t.name} className="flex items-center justify-between p-3 rounded-2xl bg-pink-50/40 border border-pink-100/60 hover:bg-pink-50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="w-7 h-7 rounded-xl bg-pink-100 text-[#B5588A] font-black text-xs flex items-center justify-center shrink-0">
                                                    #{idx + 1}
                                                </span>
                                                <div>
                                                    <p className="font-extrabold text-xs text-gray-900">{t.name}</p>
                                                    <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{t.count} Sesi Terjual</p>
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

                        {/* Top 5 Produk Terlaris */}
                        <div className="card-ayumi p-6 bg-white space-y-4 shadow-md border border-gray-200 rounded-3xl">
                            <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
                                <div className="w-9 h-9 rounded-2xl bg-cyan-100/80 text-[#06B6D4] flex items-center justify-center shrink-0 shadow-inner">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-extrabold text-gray-900">Top Penjualan Produk Terlaris</h3>
                                    <p className="text-xs text-gray-500 font-semibold mt-0.5">Produk skincare paling laris dijual periode ini.</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {topProducts.length === 0 ? (
                                    <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada penjualan produk pada periode ini.</p>
                                ) : (
                                    topProducts.map((p, idx) => (
                                        <div key={p.name} className="flex items-center justify-between p-3 rounded-2xl bg-cyan-50/40 border border-cyan-100/60 hover:bg-cyan-50 transition-colors">
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
                </div>
            ) : (
                /* ========================================================================= */
                /* DASHBOARD ADMIN CABANG (CURRENT EXACT LAYOUT PRESERVED UNCHANGED)        */
                /* ========================================================================= */
                <div className="space-y-6">
                    {/* 1. TOP HEADER & TOOLBAR (Systematic & Clean) */}
            <div className="bg-white border border-stone-200/90 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                            {dbUser?.role ? dbUser.role.toUpperCase() : 'PORTAL'}
                        </span>
                        <span className="text-xs font-bold text-stone-600">
                            • {isOwner ? 'Semua Cabang' : userBranchName}
                        </span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 tracking-tight">
                        Ringkasan Operasional & Omset
                    </h1>
                    <p className="text-xs text-stone-500 font-medium">
                        {isOwner 
                            ? 'Pantau metrik pendapatan dan performa seluruh cabang Ayumi Beauty House.' 
                            : `Analitik performa layanan dan transaksi kasir cabang ${userBranchName}.`
                        }
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {/* Branch selector for Owner */}
                    {isOwner && (
                        <BranchFilter 
                            branches={branches} 
                            selectedBranch={selectedBranch} 
                            onBranchChange={setSelectedBranch} 
                        />
                    )}

                    {/* DateRangePicker */}
                    <DateRangePicker
                        startDate={startDate}
                        endDate={endDate}
                        onChange={({ startDate: s, endDate: e }) => {
                            setStartDate(s)
                            setEndDate(e)
                        }}
                        align="right"
                        inputClassName="bg-stone-50 hover:bg-stone-100 text-stone-800 border border-stone-200 font-bold text-xs px-3.5 py-2 rounded-xl shadow-none transition-colors cursor-pointer justify-between"
                    />

                    <button
                        onClick={() => router.push('/kasir')}
                        className="px-4 py-2 bg-[#5c3316] hover:bg-[#43230c] text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                        <span>Buka Kasir</span>
                    </button>
                </div>
            </div>

            {/* 2. RINGKASAN PENDAPATAN & OMSET FINANSIAL (5 KPI Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                {/* 1. Pendapatan */}
                <div 
                    onClick={() => router.push('/transactions')}
                    className="p-5 rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:border-stone-400 transition-all cursor-pointer flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Pendapatan</span>
                        <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                            {branchTotals.rangeTxCount} Transaksi
                        </span>
                    </div>
                    <div className="mt-4">
                        <h3 className="text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums">
                            Rp {branchTotals.rangeIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-1">
                            Penerimaan kasir periode {startDate} s/d {endDate}
                        </p>
                    </div>
                </div>

                {/* 2. Omset Treatment */}
                <div 
                    onClick={() => router.push('/reports/treatments')}
                    className="p-5 rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:border-pink-300 transition-all cursor-pointer flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Layanan Treatment</span>
                        <span className="text-[11px] font-bold text-pink-800 bg-pink-50 border border-pink-200/80 px-2 py-0.5 rounded-md">
                            Tindakan
                        </span>
                    </div>
                    <div className="mt-4">
                        <h3 className="text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums">
                            Rp {branchTotals.treatmentIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-1">
                            Total nilai layanan perawatan
                        </p>
                    </div>
                </div>

                {/* 3. Omset Produk */}
                <div 
                    onClick={() => router.push('/transactions')}
                    className="p-5 rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:border-cyan-300 transition-all cursor-pointer flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Produk Skincare</span>
                        <span className="text-[11px] font-bold text-cyan-800 bg-cyan-50 border border-cyan-200/80 px-2 py-0.5 rounded-md">
                            Produk
                        </span>
                    </div>
                    <div className="mt-4">
                        <h3 className="text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums">
                            Rp {branchTotals.productIncome.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-1">
                            Penjualan produk skincare & kosmetik
                        </p>
                    </div>
                </div>

                {/* 4. Sesi Kupon Terpakai */}
                <div 
                    onClick={() => openCouponUsageModal(isOwner ? selectedBranch : dbUser?.branch_id, userBranchName)}
                    className="p-5 rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:border-amber-300 transition-all cursor-pointer flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Sesi Terpakai</span>
                        <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
                            Rincian ↗
                        </span>
                    </div>
                    <div className="mt-4">
                        <h3 className="text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums">
                            {branchTotals.couponUsedSessions} Sesi
                        </h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-1">
                            Klaim sesi kupon perawatan periode ini
                        </p>
                    </div>
                </div>

                {/* 5. Biaya Tambahan QRIS */}
                <div 
                    onClick={() => router.push('/transactions')}
                    className="p-5 rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:border-violet-300 transition-all cursor-pointer flex flex-col justify-between"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Biaya Tambahan QRIS</span>
                        <span className="text-[11px] font-bold text-violet-800 bg-violet-50 border border-violet-200/80 px-2 py-0.5 rounded-md">
                            0.3% MDR
                        </span>
                    </div>
                    <div className="mt-4">
                        <h3 className="text-2xl font-extrabold text-stone-900 tracking-tight tabular-nums">
                            Rp {branchTotals.qrisFee.toLocaleString('id-ID')}
                        </h3>
                        <p className="text-[11px] text-stone-500 font-medium mt-1">
                            Biaya layanan QRIS periode ini
                        </p>
                    </div>
                </div>
            </div>

            {/* 3. TARGET BULANAN & KOMPOSISI OMSET */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Target Bulanan Cabang */}
                <div className="card-ayumi p-6 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                            <div>
                                <h3 className="text-sm font-extrabold text-stone-900">Target Bulanan ({currentMonthLabel})</h3>
                                <p className="text-xs text-stone-500 font-medium mt-0.5">Pencapaian omset bulan ini</p>
                            </div>

                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                                    className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors"
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

                        <div className="space-y-4 pt-4">
                            {branchMonthlyTargetData.map(item => {
                                const rawPct = Number(item.rawPercent || 0)
                                const isTargetSet = item.monthlyTarget > 0

                                let barColor = 'bg-stone-400'
                                if (rawPct >= 100) barColor = 'bg-emerald-600'
                                else if (rawPct >= 50) barColor = 'bg-amber-500'
                                else barColor = 'bg-[#5c3316]'

                                return (
                                    <div key={item.branchId} className="space-y-2">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-extrabold text-stone-900">{item.branchName}</span>
                                            <span className="font-black text-stone-700">
                                                {isTargetSet ? `${rawPct.toFixed(1)}%` : 'Belum diatur'}
                                            </span>
                                        </div>

                                        <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                                            <div 
                                                className={`h-full ${barColor} rounded-full transition-all duration-500`}
                                                style={{ width: `${Math.min(100, Math.max(0, rawPct))}%` }}
                                            ></div>
                                        </div>

                                        <div className="flex justify-between items-center text-[11px] text-stone-500 font-medium">
                                            <span>Terkumpul: <strong className="text-stone-900 font-bold">Rp {item.monthlyIncome.toLocaleString('id-ID')}</strong></span>
                                            <span>Target: <strong className="text-stone-900 font-bold">Rp {item.monthlyTarget.toLocaleString('id-ID')}</strong></span>
                                        </div>

                                        {item.monthlyQrisFee > 0 && (
                                            <div className="flex justify-between items-center text-[10px] text-stone-400 font-medium pt-0.5">
                                                <span>Biaya Tambahan QRIS (0.3%):</span>
                                                <span className="font-bold text-violet-700">Rp {item.monthlyQrisFee.toLocaleString('id-ID')}</span>
                                            </div>
                                        )}

                                        {isTargetSet && (
                                            <p className="text-[11px] font-semibold text-stone-600 pt-1">
                                                {rawPct >= 100 ? (
                                                    <span className="text-emerald-700 font-bold">✓ Target tercapai (Surplus Rp {item.surplusTarget.toLocaleString('id-ID')})</span>
                                                ) : (
                                                    <span>Sisa target: <strong className="text-[#5c3316]">Rp {item.remainingTarget.toLocaleString('id-ID')}</strong></span>
                                                )}
                                            </p>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

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

                {/* Grafik Komposisi Omset */}
                <div className="lg:col-span-2 card-ayumi p-6 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                        <div>
                            <h3 className="text-sm font-extrabold text-stone-900">
                                Komposisi Pendapatan ({startDate} s/d {endDate})
                            </h3>
                            <p className="text-xs text-stone-500 font-medium mt-0.5">
                                Perbandingan omset treatment, produk skincare, dan penjualan paket kupon
                            </p>
                        </div>
                    </div>

                    <div className="h-60 w-full pt-2">
                        {isMounted && branchDailyComparison.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart 
                                    data={branchDailyComparison} 
                                    barGap={4} 
                                    barCategoryGap="25%"
                                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis 
                                        dataKey="branchName" 
                                        interval={0}
                                        tickFormatter={(val) => (val ? val.replace(/^Ayumi\s+/i, '') : val)}
                                        tick={{ fontSize: 11, fontWeight: 700, fill: '#334155' }} 
                                        axisLine={{ stroke: '#e2e8f0' }}
                                        tickLine={false} 
                                    />
                                    <YAxis 
                                        width={45}
                                        tickFormatter={(val) => {
                                            if (val === 0) return '0'
                                            if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                            if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                            return val
                                        }}
                                        tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false} 
                                    />
                                    <RechartsTooltip 
                                        formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                        contentStyle={{ borderRadius: '12px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                    />
                                    <Legend 
                                        verticalAlign="top" 
                                        align="right"
                                        wrapperStyle={{ paddingBottom: '8px', fontSize: '11px', fontWeight: '700' }} 
                                    />
                                    <Bar dataKey="treatmentIncome" name="Treatment" fill="#EC4899" radius={[4, 4, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="productIncome" name="Produk" fill="#06B6D4" radius={[4, 4, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="couponSalesIncome" name="Kupon" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs font-semibold text-stone-400">
                                Memuat data grafik...
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 4. TOP 5 LAYANAN & PRODUK TERLARIS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Treatments */}
                <div className="card-ayumi p-6 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                        <div>
                            <h3 className="text-sm font-extrabold text-stone-900">5 Treatment Terlaris</h3>
                            <p className="text-xs text-stone-500 font-medium mt-0.5">Layanan paling banyak diambil periode ini</p>
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        {topTreatments.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-8 text-center">Belum ada data tindakan treatment pada periode ini.</p>
                        ) : (
                            topTreatments.map((t, idx) => (
                                <div key={t.name} className="flex items-center justify-between p-3 rounded-xl bg-stone-50/80 border border-stone-100">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 rounded-lg bg-stone-200/80 text-stone-800 font-black text-xs flex items-center justify-center shrink-0">
                                            {idx + 1}
                                        </span>
                                        <div>
                                            <p className="font-extrabold text-xs text-stone-900">{t.name}</p>
                                            <p className="text-[11px] text-stone-500 font-medium">{t.count} Sesi</p>
                                        </div>
                                    </div>
                                    <span className="font-extrabold text-xs text-stone-900 tabular-nums">
                                        Rp {t.revenue.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Top Produk */}
                <div className="card-ayumi p-6 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                        <div>
                            <h3 className="text-sm font-extrabold text-stone-900">5 Produk Skincare Terlaris</h3>
                            <p className="text-xs text-stone-500 font-medium mt-0.5">Produk paling banyak terjual periode ini</p>
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        {topProducts.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-8 text-center">Belum ada data penjualan produk pada periode ini.</p>
                        ) : (
                            topProducts.map((p, idx) => (
                                <div key={p.name} className="flex items-center justify-between p-3 rounded-xl bg-stone-50/80 border border-stone-100">
                                    <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 rounded-lg bg-stone-200/80 text-stone-800 font-black text-xs flex items-center justify-center shrink-0">
                                            {idx + 1}
                                        </span>
                                        <div>
                                            <p className="font-extrabold text-xs text-stone-900">{p.name}</p>
                                            <p className="text-[11px] text-stone-500 font-medium">{p.count} Unit</p>
                                        </div>
                                    </div>
                                    <span className="font-extrabold text-xs text-stone-900 tabular-nums">
                                        Rp {p.revenue.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 5. TABEL RIWAYAT TRANSAKSI TERKINI */}
            <div className="card-ayumi p-6 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-stone-100">
                    <div>
                        <h3 className="text-sm font-extrabold text-stone-900">
                            Transaksi Terkini ({userBranchName})
                        </h3>
                        <p className="text-xs text-stone-500 font-medium mt-0.5">
                            Histori pembayaran kasir pada rentang waktu terpilih
                        </p>
                    </div>
                    <Link
                        href="/transactions"
                        className="text-xs font-bold text-[#5c3316] hover:underline"
                    >
                        Buka Semua Transaksi ➔
                    </Link>
                </div>

                <div className="overflow-x-auto rounded-xl border border-stone-200/80">
                    {recentBranchTransactions.length === 0 ? (
                        <div className="py-10 text-center text-stone-400 text-xs font-semibold">
                            Tidak ada data transaksi pada rentang tanggal ini.
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-stone-50 text-stone-700 font-bold border-b border-stone-200 uppercase tracking-wider text-[11px]">
                                    <th className="p-3">Waktu</th>
                                    <th className="p-3">No. Transaksi</th>
                                    <th className="p-3">Pasien</th>
                                    <th className="p-3">Item Layanan/Produk</th>
                                    <th className="p-3 text-right">Total</th>
                                    <th className="p-3 text-center">Metode</th>
                                    <th className="p-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {recentBranchTransactions.map(tx => {
                                    const isVoid = tx.payment_status === 'void'
                                    const patientId = tx.patient_id || tx.patients?.id
                                    const patientName = tx.patients?.full_name || 'Pasien Umum'
                                    return (
                                        <tr key={tx.id} className="hover:bg-stone-50/60 transition-colors">
                                            <td className="p-3 font-medium text-stone-500 whitespace-nowrap">
                                                {formatLogDateTime(tx.created_at)}
                                            </td>
                                            <td className="p-3 font-bold text-stone-900 whitespace-nowrap">
                                                <Link href="/transactions" className="hover:text-pink-600 hover:underline">
                                                    {tx.transaction_number || tx.id.slice(0, 8)}
                                                </Link>
                                            </td>
                                            <td className="p-3 whitespace-nowrap">
                                                {patientId ? (
                                                    <Link 
                                                        href={`/patients/${patientId}`}
                                                        className="font-bold text-stone-900 hover:text-ayumi-primary hover:underline transition-colors inline-flex items-center gap-1 group/pat"
                                                        title="Buka Profil & Riwayat Pasien"
                                                    >
                                                        <span>{patientName}</span>
                                                        <span className="text-[11px] text-ayumi-primary font-bold group-hover/pat:translate-x-0.5 group-hover/pat:-translate-y-0.5 transition-transform">↗</span>
                                                    </Link>
                                                ) : (
                                                    <span className="font-bold text-stone-900">{patientName}</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-stone-600">
                                                {tx.transaction_items && tx.transaction_items.length > 0 ? (
                                                    <div className="space-y-0.5">
                                                        {tx.transaction_items.slice(0, 2).map((item, i) => (
                                                            <p key={i} className="text-[11px]">
                                                                • {item.name} <span className="text-stone-400">({item.quantity}x)</span>
                                                            </p>
                                                        ))}
                                                        {tx.transaction_items.length > 2 && (
                                                            <p className="text-[10px] text-pink-600 font-bold">
                                                                +{tx.transaction_items.length - 2} item lainnya
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-stone-400">-</span>
                                                )}
                                            </td>
                                            <td className={`p-3 text-right font-extrabold whitespace-nowrap tabular-nums ${isVoid ? 'line-through text-stone-400' : 'text-stone-900'}`}>
                                                Rp {Number(tx.total || 0).toLocaleString('id-ID')}
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-bold uppercase">
                                                    {tx.payment_method || 'CASH'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                {isVoid ? (
                                                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-bold border border-red-200">
                                                        VOID
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] font-bold border border-emerald-200">
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

            {/* 6. OPERASIONAL & RETENSI CRM PASIEN */}
            <div className="space-y-4">
                <div className="flex items-center justify-between pb-1">
                    <div>
                        <h3 className="text-sm font-extrabold text-stone-900">Operasional Harian & CRM Pasien</h3>
                        <p className="text-xs text-stone-500 font-medium">Status janji temu, antrean follow-up, dan retensi klinik</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div onClick={() => router.push('/appointments')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Janji Temu Hari Ini</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statAppointments}</h4>
                    </div>
                    <div onClick={() => router.push('/crm')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Follow-Up Pending</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statFollowups}</h4>
                    </div>
                    <div onClick={() => router.push('/crm')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Ultah Bulan Ini</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statBirthdays}</h4>
                    </div>
                    <div onClick={() => router.push('/patients')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Pasien Baru</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statNewPatients}</h4>
                    </div>
                    <div onClick={() => router.push('/crm')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Dormant (&gt;60h)</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statDormant}</h4>
                    </div>
                    <div onClick={() => router.push('/coupons')} className="p-4 rounded-xl bg-white border border-stone-200/90 hover:border-stone-400 transition-all cursor-pointer">
                        <p className="text-[11px] font-bold text-stone-500">Kupon Expired (30h)</p>
                        <h4 className="text-xl font-black text-stone-900 mt-1 tabular-nums">{statExpiringCoupons}</h4>
                    </div>
                </div>

                {/* Grid 2 Kolom: Janji Temu Hari Ini & Antrean Follow Up */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                    {/* Janji Temu Terdekat */}
                    <div className="card-ayumi p-5 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-stone-100">
                            <h4 className="text-xs font-extrabold text-stone-900 uppercase tracking-wider">Jadwal Janji Temu Hari Ini</h4>
                            <Link href="/appointments" className="text-xs font-bold text-[#5c3316] hover:underline">Kelola ➔</Link>
                        </div>
                        {recentAppointments.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-6 text-center">Belum ada appointment terjadwal hari ini.</p>
                        ) : (
                            <div className="space-y-2">
                                {recentAppointments.map(apt => {
                                    const aptPatientId = apt.patient_id || apt.patients?.id
                                    return (
                                        <div key={apt.id} onClick={() => router.push('/appointments')} className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50/80 hover:bg-stone-100 transition-colors cursor-pointer text-xs">
                                            <div>
                                                {aptPatientId ? (
                                                    <Link 
                                                        href={`/patients/${aptPatientId}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="font-extrabold text-stone-900 hover:text-ayumi-primary hover:underline transition-colors inline-flex items-center gap-1 group/apt"
                                                        title="Buka Profil & Riwayat Pasien"
                                                    >
                                                        <span>{apt.patients?.full_name || 'Pasien'}</span>
                                                        <span className="text-[10px] text-ayumi-primary font-bold group-hover/apt:translate-x-0.5 group-hover/apt:-translate-y-0.5 transition-transform">↗</span>
                                                    </Link>
                                                ) : (
                                                    <p className="font-extrabold text-stone-900">{apt.patients?.full_name || 'Pasien'}</p>
                                                )}
                                                <p className="text-[11px] text-stone-500">{apt.start_time?.slice(0, 5)} - {apt.end_time?.slice(0, 5)} WIB</p>
                                            </div>
                                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold uppercase border border-blue-200">
                                                {apt.status}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Antrean Follow-Up CRM */}
                    <div className="card-ayumi p-5 bg-white border border-stone-200/90 rounded-2xl shadow-sm space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-stone-100">
                            <h4 className="text-xs font-extrabold text-stone-900 uppercase tracking-wider">Antrean Follow-Up CRM</h4>
                            <Link href="/crm" className="text-xs font-bold text-[#5c3316] hover:underline">Buka CRM ➔</Link>
                        </div>
                        {recentFollowups.length === 0 ? (
                            <p className="text-xs text-stone-400 font-medium py-6 text-center">Semua tugas follow up pasien sudah selesai.</p>
                        ) : (
                            <div className="space-y-2">
                                {recentFollowups.map(fu => {
                                    const fuPatientId = fu.patient_id || fu.patients?.id
                                    return (
                                        <div key={fu.id} onClick={() => router.push('/crm')} className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50/80 hover:bg-stone-100 transition-colors cursor-pointer text-xs">
                                            <div>
                                                {fuPatientId ? (
                                                    <Link 
                                                        href={`/patients/${fuPatientId}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="font-extrabold text-stone-900 hover:text-ayumi-primary hover:underline transition-colors inline-flex items-center gap-1 group/fu"
                                                        title="Buka Profil & Riwayat Pasien"
                                                    >
                                                        <span>{fu.patients?.full_name || 'Pasien'}</span>
                                                        <span className="text-[10px] text-ayumi-primary font-bold group-hover/fu:translate-x-0.5 group-hover/fu:-translate-y-0.5 transition-transform">↗</span>
                                                    </Link>
                                                ) : (
                                                    <p className="font-extrabold text-stone-900">{fu.patients?.full_name || 'Pasien'}</p>
                                                )}
                                                <p className="text-[11px] text-stone-500">Tipe: {fu.followup_type?.replace(/_/g, ' ') || 'Pesan'}</p>
                                            </div>
                                            <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 text-[10px] font-bold uppercase border border-orange-200">
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
                    <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-3xl w-full h-[80vh] flex flex-col overflow-hidden">
                        <div className="p-5 border-b border-stone-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-extrabold text-stone-900">Rincian Pemakaian Sesi Kupon</h3>
                                <p className="text-xs text-stone-500 font-medium">Periode {startDate} s/d {endDate} ({couponUsageModalBranch.name})</p>
                            </div>
                            <button onClick={() => setIsCouponUsageModalOpen(false)} className="text-stone-400 hover:text-stone-700 text-sm font-bold">✕</button>
                        </div>
                        <div className="p-3.5 bg-stone-50 border-b border-stone-100 flex items-center justify-between gap-3">
                            <span className="text-xs font-bold text-stone-700">Total: {filteredCouponLogs.length} Sesi</span>
                            <input
                                type="text"
                                value={couponUsageSearch}
                                onChange={(e) => setCouponUsageSearch(e.target.value)}
                                placeholder="Cari nama pasien / layanan..."
                                className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#5c3316]"
                            />
                        </div>
                        <div className="p-4 overflow-y-auto flex-1">
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
                                            <th className="p-2.5">Petugas</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {filteredCouponLogs.map((log, idx) => (
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
                                                <td className="p-2.5 text-stone-600">{log.users?.full_name || '-'}</td>
                                            </tr>
                                        ))}
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
