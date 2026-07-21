'use client'

import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import DateRangePicker from '../../components/DateRangePicker'
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
    Legend 
} from 'recharts'

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

    // Date Range State for Owner View (Defaults to current month)
    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const [startDate, setStartDate] = useState(() => {
        const now = new Date()
        return getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1))
    })
    const [endDate, setEndDate] = useState(() => {
        const now = new Date()
        return getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    })

    // Widget States (Non-owner)
    const [statAppointments, setStatAppointments] = useState(0)
    const [statFollowups, setStatFollowups] = useState(0)
    const [statBirthdays, setStatBirthdays] = useState(0)
    const [statDormant, setStatDormant] = useState(0)
    const [statNewPatients, setStatNewPatients] = useState(0)
    const [statExpiringCoupons, setStatExpiringCoupons] = useState(0)

    // Financial Widget States (Non-owner)
    const [statTodayIncome, setStatTodayIncome] = useState(0)
    const [statTodayTx, setStatTodayTx] = useState(0)
    const [statTopPaymentMethod, setStatTopPaymentMethod] = useState('-')
    const [sparklineData, setSparklineData] = useState([])

    // Table States (Non-owner)
    const [recentAppointments, setRecentAppointments] = useState([])
    const [recentFollowups, setRecentFollowups] = useState([])

    // Owner Specific States
    const [branchDailyComparison, setBranchDailyComparison] = useState([])
    const [branchMonthlyTargetData, setBranchMonthlyTargetData] = useState([])
    const [topTreatments, setTopTreatments] = useState([])
    const [topProducts, setTopProducts] = useState([])
    const [paymentBreakdown, setPaymentBreakdown] = useState([])

    const [companyTotals, setCompanyTotals] = useState({
        monthlyTarget: 0,
        rangeIncome: 0,
        rangeTxCount: 0,
        topBranchName: '-'
    })

    // Modal States for Target Editing
    const [isTargetModalOpen, setIsTargetModalOpen] = useState(false)
    const [targetFormData, setTargetFormData] = useState({})
    const [isSavingTargets, setIsSavingTargets] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    // Helper to sort branches putting Pangandaran always at the far right (last)
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

    const fetchOwnerBranchMetrics = useCallback(async (branchList, startStr, endStr) => {
        if (!branchList || branchList.length === 0) return

        try {
            const activeBranches = sortBranchesWithPangandaranLast(branchList.filter(b => b.is_active !== false))
            const sDate = startStr || startDate
            const eDate = endStr || endDate
            
            // 1. Fetch transactions for selected date range with transaction items
            const { data: rangeTrx } = await supabase
                .from('transactions')
                .select(`
                    id, 
                    branch_id, 
                    total,
                    payment_method,
                    transaction_items (
                        item_type,
                        name,
                        quantity,
                        subtotal
                    )
                `)
                .gte('created_at', new Date(`${sDate}T00:00:00`).toISOString())
                .lte('created_at', new Date(`${eDate}T23:59:59.999`).toISOString())

            const rangeMap = {}
            let grandTotalRange = 0
            let totalTxCountRange = 0
            const methodMap = {}
            const treatmentMap = {}
            const productMap = {}

            activeBranches.forEach(b => {
                rangeMap[b.id] = {
                    branchId: b.id,
                    branchName: b.name,
                    treatmentIncome: 0,
                    productIncome: 0,
                    otherIncome: 0,
                    totalIncome: 0,
                    transactionCount: 0
                }
            })

            if (rangeTrx) {
                rangeTrx.forEach(tx => {
                    if (tx && tx.branch_id && rangeMap[tx.branch_id]) {
                        const branchObj = rangeMap[tx.branch_id]
                        branchObj.transactionCount += 1
                        totalTxCountRange += 1

                        // Payment method count
                        const pMethod = (tx.payment_method || 'CASH').toUpperCase()
                        methodMap[pMethod] = (methodMap[pMethod] || 0) + Number(tx.total || 0)
                        
                        let txTreatment = 0
                        let txProduct = 0
                        let txOther = 0

                        if (tx.transaction_items && tx.transaction_items.length > 0) {
                            tx.transaction_items.forEach(item => {
                                const itemSub = Number(item.subtotal || 0)
                                const itemQty = Number(item.quantity || 1)
                                const itemName = item.name || 'Item Perawatan/Produk'

                                if (item.item_type === 'treatment') {
                                    txTreatment += itemSub
                                    if (!treatmentMap[itemName]) {
                                        treatmentMap[itemName] = { name: itemName, count: 0, revenue: 0 }
                                    }
                                    treatmentMap[itemName].count += itemQty
                                    treatmentMap[itemName].revenue += itemSub
                                } else if (item.item_type === 'product') {
                                    txProduct += itemSub
                                    if (!productMap[itemName]) {
                                        productMap[itemName] = { name: itemName, count: 0, revenue: 0 }
                                    }
                                    productMap[itemName].count += itemQty
                                    productMap[itemName].revenue += itemSub
                                } else {
                                    txOther += itemSub
                                }
                            })
                        } else {
                            txTreatment += Number(tx.total || 0)
                        }

                        branchObj.treatmentIncome += txTreatment
                        branchObj.productIncome += txProduct
                        branchObj.otherIncome += txOther
                        
                        const totalTxAmt = (txTreatment + txProduct + txOther) || Number(tx.total || 0)
                        branchObj.totalIncome += totalTxAmt
                        grandTotalRange += totalTxAmt
                    }
                })
            }

            let topBranch = '-'
            let maxIncome = -1

            const formattedRangeComp = activeBranches.map(b => {
                const item = rangeMap[b.id]
                if (item.totalIncome > maxIncome && item.totalIncome > 0) {
                    maxIncome = item.totalIncome
                    topBranch = item.branchName
                }

                return {
                    ...item
                }
            })

            setBranchDailyComparison(formattedRangeComp)

            // Formatted top 5 treatments & products
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

            // 2. Fetch current month transactions for monthly target calculation
            const now = new Date()
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

            const { data: monthlyTrx } = await supabase
                .from('transactions')
                .select('id, branch_id, total')
                .gte('created_at', startOfMonth)
                .lte('created_at', endOfMonth)

            const monthlyMap = {}
            let totalCompanyTarget = 0

            activeBranches.forEach(b => {
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
                        const amt = Number(tx.total || 0)
                        monthlyMap[tx.branch_id].monthlyIncome += amt
                    }
                })
            }

            const formattedMonthlyTargets = activeBranches.map(b => {
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

            setCompanyTotals({
                monthlyTarget: totalCompanyTarget,
                rangeIncome: grandTotalRange,
                rangeTxCount: totalTxCountRange,
                topBranchName: topBranch !== '-' ? topBranch : (formattedRangeComp[0]?.branchName || '-')
            })

        } catch (e) {
            console.error('Error fetching owner branch metrics:', e)
        }
    }, [startDate, endDate, supabase])

    useEffect(() => {
        fetchInitialData()
    }, [])

    useEffect(() => {
        if (dbUser) {
            fetchStatistics()
        }
    }, [selectedBranch, dbUser])

    useEffect(() => {
        if (dbUser?.role === 'owner' && branches.length > 0) {
            fetchOwnerBranchMetrics(branches, startDate, endDate)
        }
    }, [startDate, endDate, branches, dbUser, fetchOwnerBranchMetrics])

    const fetchInitialData = async () => {
        setLoading(true)
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
            
        if (userData) {
            if (userData.role === 'therapist') {
                router.push('/therapist/dashboard')
                return
            }
            
            setDbUser(userData)
            
            const { data: branchData } = await supabase
                .from('branches')
                .select('id, name, monthly_target, is_active')

            if (branchData) {
                const sorted = sortBranchesWithPangandaranLast(branchData)
                setBranches(sorted)
                if (userData.role === 'owner') {
                    fetchOwnerBranchMetrics(sorted, startDate, endDate)
                }
            }

            // Role Security Rule:
            // ONLY Owner can select/switch branches (selectedBranch = '')
            // Admin, Kasir, Therapist are STRICTLY locked to their assigned branch_id!
            if (userData.role === 'owner') {
                setSelectedBranch('')
            } else {
                setSelectedBranch(userData.branch_id || '')
            }
        } else {
            console.warn('User not found in public.users, unauthorized access')
            setDbUser({ role: 'unauthorized', full_name: user.email, id: user.id })
            
            const { data: branchData } = await supabase.from('branches').select('id, name, monthly_target, is_active')
            if (branchData) {
                const sorted = sortBranchesWithPangandaranLast(branchData)
                setBranches(sorted)
            }
            setSelectedBranch('')
        }
    }

    const fetchStatistics = async () => {
        setLoading(true)
        try {
            const todayDateStr = new Date().toISOString().split('T')[0]
            
            // STRICT BRANCH ISOLATION:
            // Non-owner roles MUST ALWAYS be filtered strictly by their assigned dbUser.branch_id
            const applyBranchFilter = (query, columnName = 'branch_id') => {
                if (dbUser?.role !== 'owner') {
                    const effectiveBranch = dbUser?.branch_id || selectedBranch
                    if (effectiveBranch) {
                        return query.eq(columnName, effectiveBranch)
                    }
                    return query
                }
                if (selectedBranch) {
                    return query.eq(columnName, selectedBranch)
                }
                return query
            }

            // 1. Appointments Today
            let aptQuery = supabase.from('appointments').select('id', { count: 'exact' })
                .eq('appointment_date', todayDateStr)
            aptQuery = applyBranchFilter(aptQuery)

            // 2. Followups Today
            let fuQuery = supabase.from('followup_queue').select('id', { count: 'exact' })
                .eq('status', 'pending')
                .lte('scheduled_date', todayDateStr)
            fuQuery = applyBranchFilter(fuQuery)

            // 3. Birthdays This Month
            const now = new Date()
            let bdayQuery = supabase.from('patients').select('id', { count: 'exact' })
            bdayQuery = applyBranchFilter(bdayQuery)

            // 4. Dormant Patients (>60 days no visit)
            const sixtyDaysAgo = new Date()
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
            let dormantQuery = supabase.from('patients').select('id', { count: 'exact' })
                .or(`last_visit.lt.${sixtyDaysAgo.toISOString()},last_visit.is.null`)
            dormantQuery = applyBranchFilter(dormantQuery)

            // 5. New Patients This Month
            const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
            let newPatQuery = supabase.from('patients').select('id', { count: 'exact' })
                .gte('created_at', startOfMonthIso)
            newPatQuery = applyBranchFilter(newPatQuery)

            // 6. Expiring Coupons (30 days)
            const in30Days = new Date()
            in30Days.setDate(in30Days.getDate() + 30)
            const couponsQuery = supabase.from('patient_coupons').select('id', { count: 'exact' })
                .eq('status', 'active')
                .gte('expired_at', new Date().toISOString())
                .lte('expired_at', in30Days.toISOString())

            // Tables Recent
            let tableAptQuery = supabase.from('appointments').select('id, start_time, end_time, status, patients(full_name, whatsapp)')
                .eq('appointment_date', todayDateStr)
                .order('start_time', { ascending: true })
                .limit(5)
            tableAptQuery = applyBranchFilter(tableAptQuery)

            let tableFuQuery = supabase.from('followup_queue').select('id, followup_type, priority, patients(full_name, whatsapp)')
                .eq('status', 'pending')
                .lte('scheduled_date', todayDateStr)
                .order('priority', { ascending: false })
                .limit(5)
            tableFuQuery = applyBranchFilter(tableFuQuery)

            // Transactions Today
            let trxTodayQuery = supabase.from('transactions').select('total, payment_method')
                .gte('created_at', new Date(`${todayDateStr}T00:00:00`).toISOString())
                .lte('created_at', new Date(`${todayDateStr}T23:59:59.999`).toISOString())
            trxTodayQuery = applyBranchFilter(trxTodayQuery)

            // Sparkline 7 Days
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
            sevenDaysAgo.setHours(0,0,0,0)
            let sparklineQuery = supabase.from('transactions').select('total, created_at')
                .gte('created_at', sevenDaysAgo.toISOString())
            sparklineQuery = applyBranchFilter(sparklineQuery)

            const [
                aptResult,
                fuResult,
                bdayResult,
                dormantResult,
                newPatResult,
                couponsResult,
                tableAptResult,
                tableFuResult,
                trxTodayResult,
                sparkResult
            ] = await Promise.all([
                aptQuery,
                fuQuery,
                bdayQuery,
                dormantQuery,
                newPatQuery,
                couponsQuery,
                tableAptQuery,
                tableFuQuery,
                trxTodayQuery,
                sparklineQuery
            ])

            setStatAppointments(aptResult?.count || 0)
            setStatFollowups(fuResult?.count || 0)
            setStatBirthdays(bdayResult?.count || 0)
            setStatDormant(dormantResult?.count || 0)
            setStatNewPatients(newPatResult?.count || 0)
            setStatExpiringCoupons(couponsResult?.count || 0)

            if (tableAptResult && tableAptResult.data) {
                setRecentAppointments(tableAptResult.data)
            }

            if (tableFuResult && tableFuResult.data) {
                setRecentFollowups(tableFuResult.data)
            }

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

    const handleOpenTargetModal = () => {
        const formData = {}
        branches.forEach(b => {
            formData[b.id] = b.monthly_target || 0
        })
        setTargetFormData(formData)
        setIsTargetModalOpen(true)
    }

    const handleSaveAllTargets = async (e) => {
        e.preventDefault()
        setIsSavingTargets(true)

        try {
            const updates = Object.entries(targetFormData).map(([branchId, val]) => 
                supabase
                    .from('branches')
                    .update({ monthly_target: Number(val || 0), updated_at: new Date().toISOString() })
                    .eq('id', branchId)
            )

            await Promise.all(updates)

            toast.success('Target bulanan seluruh cabang berhasil disimpan!')
            setIsTargetModalOpen(false)

            const { data: updatedBranches } = await supabase.from('branches').select('id, name, monthly_target, is_active')
            if (updatedBranches) {
                const sorted = sortBranchesWithPangandaranLast(updatedBranches)
                setBranches(sorted)
                fetchOwnerBranchMetrics(sorted, startDate, endDate)
            }
        } catch (err) {
            console.error('Gagal menyimpan target:', err)
            toast.error('Gagal menyimpan target bulanan.')
        } finally {
            setIsSavingTargets(false)
        }
    }

    const handleSetPresetTarget = (branchId, amount) => {
        setTargetFormData(prev => ({
            ...prev,
            [branchId]: amount
        }))
    }

    const handlePrintSummary = () => {
        window.print()
    }

    const currentMonthLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    const userBranchName = branches.find(b => b.id === (dbUser?.branch_id || selectedBranch))?.name || 'Cabang Klinik'

    if (loading && !dbUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-ayumi-bg">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6 relative pb-10">
            {loading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-3xl">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            )}
            
            {/* HERO BANNER OWNER / NON-OWNER */}
            {dbUser?.role === 'owner' ? (
                /* HERO BANNER EKSKLUSIF OWNER - BISA PILIH SEMUA CABANG */
                <div className="bg-gradient-to-r from-ayumi-secondary via-[#5c3316] to-[#6d3e1d] rounded-3xl p-6 md:p-8 text-white shadow-xl relative border border-white/10">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/15">
                        <div className="space-y-1">
                            <span className="bg-white/15 text-pink-100 text-[10px] uppercase font-extrabold tracking-[0.2em] px-3.5 py-1 rounded-full border border-white/15 shadow-sm">
                                EXECUTIVE BUSINESS SUMMARY
                            </span>
                            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white mt-1.5">
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
                                className="bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs px-4 py-2.5 rounded-2xl border border-white/20 shadow-sm transition-all flex items-center gap-2"
                            >
                                <svg className="w-4 h-4 text-ayumi-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                <span>Cetak Laporan</span>
                            </button>
                        </div>
                    </div>

                    {/* 3 KPI Cards: Total Omset Perusahaan, Total Transaksi, Top Branch */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-5 pt-6">
                        <div className="p-5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md space-y-1.5 shadow-inner">
                            <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">Total Omset Perusahaan</span>
                            <p className="text-2xl font-extrabold tracking-tight text-emerald-300">Rp {companyTotals.rangeIncome.toLocaleString('id-ID')}</p>
                            <p className="text-[11px] text-emerald-100/80 font-semibold">Periode Terpilih ({branches.length} Cabang)</p>
                        </div>

                        <div className="p-5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md space-y-1.5 shadow-inner">
                            <span className="text-[10px] font-bold text-pink-200 uppercase tracking-widest">Total Transaksi Perusahaan</span>
                            <p className="text-2xl font-extrabold tracking-tight text-white">{companyTotals.rangeTxCount} <span className="text-sm font-sans font-bold">Transaksi</span></p>
                            <p className="text-[11px] text-pink-100/70 font-semibold">Akumulasi Seluruh Cabang</p>
                        </div>

                        <div className="p-5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md space-y-1.5 shadow-inner">
                            <span className="text-[10px] font-bold text-ayumi-accent uppercase tracking-widest">Top Performing Branch</span>
                            <p className="text-xl font-black text-ayumi-accent truncate">{companyTotals.topBranchName}</p>
                            <p className="text-[11px] text-pink-100/70 font-semibold">Omset Tertinggi Periode Terpilih</p>
                        </div>
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
            ) : (
                /* BANNER FUTURISTIK ADMIN / STAF / KASIR - CABANG DIKUNCI KHUSUS CABANG TERCATAT */
                <div className="bg-gradient-to-r from-ayumi-secondary via-[#5c3316] to-[#6d3e1d] rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="relative z-10 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="bg-white/15 text-pink-100 text-[10px] uppercase font-extrabold tracking-[0.2em] px-3.5 py-1 rounded-full border border-white/15 shadow-sm">
                                {dbUser?.role ? dbUser.role.toUpperCase() : 'ADMIN'} PORTAL
                            </span>
                            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold px-3 py-1 rounded-full border border-emerald-400/30 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                Live Monitoring
                            </span>
                        </div>
                        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                            Selamat Datang, <span className="text-ayumi-accent">{dbUser?.full_name || 'Staf Klinik'}</span>!
                        </h2>
                        <p className="text-xs text-pink-100/80 max-w-xl font-medium">
                            Pusat operasional harian cabang Anda. Klik kartu apa saja untuk membuka modul yang sesuai.
                        </p>
                    </div>

                    <div className="relative z-10 shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        {/* Cabang Dikunci Sesuai Penugasan Admin (Keamanan Akses Data) */}
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-pink-200 uppercase tracking-widest pl-1">Cabang Ditugaskan</span>
                            <div className="flex items-center gap-2 bg-white/15 border border-white/25 px-4 py-2.5 rounded-2xl shadow-inner backdrop-blur-md">
                                <svg className="w-4 h-4 text-ayumi-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                <span className="text-white text-xs font-extrabold tracking-tight">
                                    {userBranchName}
                                </span>
                                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-md text-pink-100 font-bold ml-1">LOCKED</span>
                            </div>
                        </div>

                        {/* Quick POS Button */}
                        <div className="flex items-end">
                            <button 
                                onClick={() => router.push('/kasir')}
                                className="bg-gradient-to-r from-ayumi-primary to-pink-600 hover:from-pink-600 hover:to-ayumi-primary text-white font-extrabold text-xs px-5 py-2.5 rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                                <span>Buka Kasir</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* WIDGET KEUANGAN UTAMA (NON-OWNER / ADMIN ONLY) - TERHUBUNG INTERAKTIF */}
            {dbUser?.role !== 'owner' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {/* Card 1: Pendapatan Hari Ini */}
                    <div 
                        onClick={() => router.push('/transactions')}
                        className="p-4 rounded-3xl bg-white border border-gray-200 hover:border-emerald-300 hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer group flex items-center justify-between"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center font-extrabold shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                                <h3 className="text-base font-extrabold text-emerald-900 tracking-tight">Rp {statTodayIncome.toLocaleString('id-ID')}</h3>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pendapatan Hari Ini</p>
                            </div>
                        </div>
                        <span className="text-emerald-400 group-hover:text-emerald-600 font-extrabold text-xs group-hover:translate-x-1 transition-transform">➔</span>
                    </div>

                    {/* Card 2: Transaksi Hari Ini */}
                    <div 
                        onClick={() => router.push('/kasir/history')}
                        className="p-4 rounded-3xl bg-white border border-gray-200 hover:border-blue-300 hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer group flex items-center justify-between"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-blue-100/80 text-blue-700 flex items-center justify-center font-extrabold shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H2" /></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-blue-900 tracking-tight">{statTodayTx} <span className="text-xs font-normal text-gray-500">Tx</span></h3>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Transaksi Hari Ini</p>
                            </div>
                        </div>
                        <span className="text-blue-400 group-hover:text-blue-600 font-extrabold text-xs group-hover:translate-x-1 transition-transform">➔</span>
                    </div>

                    {/* Card 3: Top Metode Bayar */}
                    <div 
                        onClick={() => router.push('/transactions')}
                        className="p-4 rounded-3xl bg-white border border-gray-200 hover:border-rose-300 hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer group flex items-center justify-between"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-rose-100/80 text-rose-700 flex items-center justify-center font-extrabold shrink-0 group-hover:bg-rose-600 group-hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-rose-900 uppercase tracking-tight">{statTopPaymentMethod}</h3>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Metode Bayar Top</p>
                            </div>
                        </div>
                        <span className="text-rose-400 group-hover:text-rose-600 font-extrabold text-xs group-hover:translate-x-1 transition-transform">➔</span>
                    </div>

                    {/* Card 4: Tren Pendapatan (7 Hari) */}
                    <div 
                        onClick={() => router.push('/reports/treatments')}
                        className="p-3.5 rounded-3xl bg-white border border-gray-200 hover:border-ayumi-primary hover:-translate-y-1 hover:shadow-md transition-all duration-300 cursor-pointer group flex flex-col justify-between h-[80px]"
                    >
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Tren Pendapatan (7 Hari)</span>
                            <span className="text-ayumi-primary group-hover:translate-x-1 transition-transform text-xs font-bold">➔</span>
                        </div>
                        <div className="h-8 w-full overflow-hidden">
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
            )}

            {/* DASHBOARD KHUSUS OWNER */}
            {dbUser?.role === 'owner' ? (
                <div className="space-y-6">
                    {/* SECTION 1: PERBANDINGAN OMSET (TREATMENT vs PRODUK) ANTA CABANG */}
                    <div className="card-ayumi p-6 md:p-7 bg-white space-y-5 shadow-md border border-gray-200 rounded-3xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                    <h3 className="text-xl font-extrabold text-[#5c3316]">Perbandingan Omset (Treatment & Produk) per Cabang</h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-4">
                                    Visualisasi perbandingan omset treatment dan produk antar cabang untuk rentang periode terpilih.
                                </p>
                            </div>

                            {/* Toolbar Kontrol: Rentang Waktu (DateRangePicker) & Cabang Selector */}
                            <div className="flex flex-wrap items-center gap-3 shrink-0">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Rentang Waktu</span>
                                    <DateRangePicker
                                        startDate={startDate}
                                        endDate={endDate}
                                        onChange={({ startDate: s, endDate: e }) => {
                                            setStartDate(s)
                                            setEndDate(e)
                                        }}
                                        align="right"
                                        inputClassName="bg-pink-50 hover:bg-pink-100/70 text-ayumi-secondary border border-pink-200 font-extrabold text-xs px-3.5 py-2 rounded-2xl shadow-sm transition-colors cursor-pointer"
                                    />
                                </div>

                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Cabang Terpilih</span>
                                    <div className="flex items-center gap-2 bg-pink-50 border border-pink-200 px-3.5 py-2 rounded-2xl shadow-sm transition-colors">
                                        <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 5h2a2 2 0 002-2v-1a2 2 0 00-2-2h-2a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>
                                        <select 
                                            value={selectedBranch}
                                            onChange={(e) => setSelectedBranch(e.target.value)}
                                            className="bg-transparent border-none text-ayumi-secondary text-xs focus:ring-0 cursor-pointer font-extrabold outline-none pr-4"
                                        >
                                            <option value="" className="text-gray-800">Semua Cabang (Global)</option>
                                            {branches.map(b => (
                                                <option key={b.id} value={b.id} className="text-gray-800">{b.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Recharts Bar Chart Grouped */}
                        <div className="h-72 w-full pt-2">
                            {isMounted && branchDailyComparison.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart 
                                        data={branchDailyComparison} 
                                        barGap={6} 
                                        barCategoryGap="28%"
                                        margin={{ top: 25, right: 20, left: 15, bottom: 20 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis 
                                            dataKey="branchName" 
                                            tick={{ fontSize: 13, fontWeight: 700, fill: '#1e293b' }} 
                                            axisLine={{ stroke: '#cbd5e1' }}
                                            tickLine={false} 
                                        />
                                        <YAxis 
                                            tickFormatter={(val) => val >= 1000000 ? (val/1000000).toFixed(1) + ' Jt' : val.toLocaleString('id-ID')}
                                            tick={{ fontSize: 12, fontWeight: 600, fill: '#475569' }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <RechartsTooltip 
                                            formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                            itemSorter={(item) => (item.name.includes('Treatment') ? -1 : 1)}
                                            labelStyle={{ fontWeight: 'bold', color: '#5c3316', fontSize: '14px' }}
                                            contentStyle={{ borderRadius: '16px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #f472b6', padding: '12px 16px' }}
                                        />
                                        <Legend 
                                            verticalAlign="top" 
                                            align="center"
                                            wrapperStyle={{ paddingTop: '0px', paddingBottom: '12px', fontWeight: '800', fontSize: '13px', color: '#0f172a' }} 
                                        />
                                        <Bar dataKey="treatmentIncome" name="Omset Treatment" fill="#B5588A" radius={[6, 6, 0, 0]} maxBarSize={38} />
                                        <Bar dataKey="productIncome" name="Omset Produk" fill="#06B6D4" radius={[6, 6, 0, 0]} maxBarSize={38} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                                    Mengambil data cabang...
                                </div>
                            )}
                        </div>

                        {/* Cards Breakdown Omset per Cabang */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                            {branchDailyComparison.map(b => (
                                <div key={b.branchId} className="p-4 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 space-y-2.5 shadow-sm hover:shadow-md transition-all group">
                                    <div className="pb-1.5 border-b border-gray-100">
                                        <h4 className="font-extrabold text-base text-gray-900">
                                            {b.branchName}
                                        </h4>
                                    </div>

                                    <div className="space-y-1.5 pt-0.5">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-gray-700 font-bold flex items-center gap-1.5">
                                                <span className="w-2.5 h-2.5 rounded-full bg-[#B5588A] shrink-0"></span>
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
                                    </div>

                                    <div className="pt-2 border-t border-gray-100 flex justify-between items-baseline">
                                        <div>
                                            <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Total Omset</p>
                                            <p className="text-lg font-black text-[#5c3316] tracking-tight">Rp {b.totalIncome.toLocaleString('id-ID')}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SECTION 2: MONITORING TARGET BULANAN PER CABANG */}
                    <div className="card-ayumi p-6 md:p-7 bg-white space-y-6 shadow-sm border border-gray-200 rounded-3xl">
                        {/* Header Section */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-ayumi-primary rounded-full"></div>
                                    <h3 className="text-xl font-extrabold text-[#5c3316]">Monitoring Target Bulanan per Cabang</h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-1 pl-4">
                                    Pantau persentase pencapaian omset bulan ini dibanding target operasional tiap cabang.
                                </p>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                <span className="bg-pink-50 text-ayumi-primary border border-pink-200 text-xs font-bold px-3.5 py-1.5 rounded-xl">
                                    Periode: {currentMonthLabel}
                                </span>
                            </div>
                        </div>

                        {/* Akumulasi Global Perusahaan */}
                        {companyTotals.monthlyTarget > 0 && (
                            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Ringkasan Total Perusahaan</p>
                                        <p className="text-sm font-extrabold text-gray-900 mt-0.5">
                                            Total Omset: <span className="text-emerald-700 font-bold">Rp {companyTotals.rangeIncome?.toLocaleString('id-ID') || 0}</span> <span className="text-gray-500 font-normal text-xs">/ Rp {companyTotals.monthlyTarget.toLocaleString('id-ID')}</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-amber-200/80 pt-3 md:pt-0 md:pl-5 shrink-0">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Pencapaian Global</p>
                                        <p className="text-base font-extrabold text-amber-900">
                                            {((companyTotals.rangeIncome / companyTotals.monthlyTarget) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                    <div className="w-32 h-2.5 bg-amber-200/60 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-amber-600 rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(100, Math.max(0, (companyTotals.rangeIncome / companyTotals.monthlyTarget) * 100))}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Grid Cards Target per Cabang */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
                                            onClick={handleOpenTargetModal}
                                            className="p-5 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 hover:bg-white hover:border-pink-300 transition-all cursor-pointer flex flex-col justify-between group space-y-3"
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
                                                <span className="text-xs font-bold text-ayumi-primary group-hover:underline flex items-center gap-1">
                                                    + Set Target
                                                </span>
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
                /* OPERASIONAL STAF / ADMIN / KASIR - PERAPIHAN RAPI + LOCK CABANG HANYA UNTUK CABANG PENUGASAN */
                <div className="space-y-6">
                    {/* GRID 6 KARTU INTERAKTIF DENGAN ACTION ONBOARDING JIKA KOSONG */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {/* 1. Appointment Hari Ini -> /appointments */}
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
                                {statAppointments === 0 ? (
                                    <p className="text-[11px] font-semibold text-blue-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Buat Jadwal Janji Temu Baru</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-gray-500 mt-1">Jadwal konsultasi/treatment terdaftar</p>
                                )}
                            </div>
                        </div>

                        {/* 2. Follow Up Hari Ini -> /crm */}
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
                                <p className="text-xs font-bold text-gray-800 mt-1">Follow Up Hari Ini</p>
                                {statFollowups === 0 ? (
                                    <p className="text-[11px] font-semibold text-orange-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Buat Antrean Follow Up</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-gray-500 mt-1">Tugas CRM perlu dihubungi</p>
                                )}
                            </div>
                        </div>

                        {/* 3. Birthday Minggu Ini -> /crm */}
                        <div 
                            onClick={() => router.push('/crm')}
                            className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-pink-300 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                        >
                            <div className="flex items-center justify-between">
                                <div className="w-12 h-12 bg-pink-100 text-pink-700 rounded-2xl flex items-center justify-center font-extrabold shrink-0 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 01-3 0 2.701 2.701 0 00-1.5-.454M9 6v2m3-2v2m3-2v2M9 3h.01M12 3h.01M15 3h.01M21 21v-7a2 2 0 00-2-2H5a2 2 0 00-2 2v7h18zm-3-9v-2a2 2 0 00-2-2H8a2 2 0 00-2 2v2h12z" /></svg>
                                </div>
                                <span className="bg-pink-50 text-pink-700 text-[10px] font-extrabold px-3 py-1 rounded-full border border-pink-200/60 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                                    Kirim Ucapan ➔
                                </span>
                            </div>
                            <div className="mt-4">
                                <h3 className="text-3xl font-black text-gray-900 tracking-tight">{statBirthdays}</h3>
                                <p className="text-xs font-bold text-gray-800 mt-1">Birthday Minggu Ini</p>
                                {statBirthdays === 0 ? (
                                    <p className="text-[11px] font-semibold text-pink-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Cek Kalender Ulang Tahun Pasien</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-gray-500 mt-1">Pasien berulang tahun periode ini</p>
                                )}
                            </div>
                        </div>

                        {/* 4. Pasien Dormant -> /crm */}
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
                                {statDormant === 0 ? (
                                    <p className="text-[11px] font-semibold text-red-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Tinjau Retensi Pasien Lama</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-gray-500 mt-1">Tidak berkunjung &gt;60 hari</p>
                                )}
                            </div>
                        </div>

                        {/* 5. Pasien Baru Bulan Ini -> /patients */}
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
                                {statNewPatients === 0 ? (
                                    <p className="text-[11px] font-semibold text-emerald-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Registrasi Pasien Baru</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-gray-500 mt-1">Pasien terdaftar bulan ini</p>
                                )}
                            </div>
                        </div>

                        {/* 6. Kupon Expired -> /coupons */}
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
                                {statExpiringCoupons === 0 ? (
                                    <p className="text-[11px] font-semibold text-pink-600 mt-1.5 flex items-center gap-1 group-hover:underline">
                                        <span>+ Terbitkan Kupon Promo</span>
                                    </p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-red-500 mt-1">Kupon mendekati kedaluwarsa</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* TABEL JANJI TEMU & CRM */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                                                        <div className="w-10 h-10 bg-pink-100 text-ayumi-primary rounded-xl flex items-center justify-center font-extrabold text-sm shadow-inner shrink-0 group-hover:bg-ayumi-primary group-hover:text-white transition-colors">
                                                            {initial}
                                                        </div>
                                                        <div>
                                                            <div className="font-extrabold text-gray-900 text-sm">{apt.patients?.full_name}</div>
                                                            <div className="text-xs text-gray-500 mt-0.5">{apt.patients?.whatsapp || '-'}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        <div className="text-right">
                                                            <div className="text-xs font-extrabold text-ayumi-secondary flex items-center gap-1">
                                                                <svg className="w-3.5 h-3.5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                {apt.start_time ? apt.start_time.substring(0,5) : '-'}
                                                            </div>
                                                        </div>
                                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${
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

                        <div className="card-ayumi overflow-hidden flex flex-col bg-white hover:shadow-md transition-shadow duration-300 rounded-3xl border border-gray-200">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-orange-50/50 via-amber-50/30 to-white">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-6 bg-orange-400 rounded-full"></div>
                                    <h3 className="font-extrabold text-ayumi-secondary text-base">Tugas Follow-Up CRM</h3>
                                </div>
                                <button onClick={() => router.push('/crm')} className="text-xs font-extrabold text-orange-600 hover:underline flex items-center gap-1">
                                    Kelola CRM ➔
                                </button>
                            </div>
                            <div className="p-5 flex-1 flex flex-col justify-center">
                                {recentFollowups.length === 0 ? (
                                    <div className="py-8 text-center space-y-3">
                                        <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mx-auto border border-orange-100">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                        </div>
                                        <div>
                                            <p className="text-sm font-extrabold text-gray-800">Semua Tugas Follow Up Hari Ini Selesai</p>
                                            <p className="text-xs text-gray-500 font-medium mt-0.5">Kelola antrean pelanggan dormant atau ulang tahun di CRM.</p>
                                        </div>
                                        <button 
                                            onClick={() => router.push('/crm')}
                                            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-extrabold shadow-sm inline-flex items-center gap-1.5 transition-colors"
                                        >
                                            <span>+ Buka CRM & Follow Up</span>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-2.5">
                                        {recentFollowups.map(fu => {
                                            const initial = fu.patients?.full_name ? fu.patients.full_name.charAt(0).toUpperCase() : '?';
                                            return (
                                                <div 
                                                    key={fu.id} 
                                                    onClick={() => router.push('/crm')}
                                                    className="flex items-center justify-between p-3.5 bg-gray-50/60 hover:bg-orange-50/60 rounded-2xl transition-all cursor-pointer border border-gray-100 hover:border-orange-200 group"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-orange-100 text-orange-700 rounded-xl flex items-center justify-center font-extrabold text-sm shadow-inner shrink-0 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                                                            {initial}
                                                        </div>
                                                        <div>
                                                            <div className="font-extrabold text-gray-900 text-sm">{fu.patients?.full_name}</div>
                                                            <div className="text-xs text-gray-500 mt-0.5">{fu.patients?.whatsapp || '-'}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[10px] font-extrabold text-gray-600 uppercase bg-gray-100 px-2 py-1 rounded-lg">
                                                            {fu.followup_type ? fu.followup_type.replace('_', ' ') : '-'}
                                                        </span>
                                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${
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
            )}

            {/* MODAL KELOLA TARGET BULANAN SELURUH CABANG */}
            {isTargetModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-md">
                    <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-fade-in-up border border-pink-100">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-pink-50 via-purple-50 to-white">
                            <div>
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    <h3 className="text-xl font-black text-ayumi-secondary">Pengaturan Target Bulanan Cabang</h3>
                                </div>
                                <p className="text-xs text-gray-600 font-semibold mt-0.5">
                                    Tentukan target omset bulanan untuk masing-masing cabang ({currentMonthLabel}).
                                </p>
                            </div>
                            <button onClick={() => setIsTargetModalOpen(false)} className="text-gray-400 hover:text-red-500 p-1 rounded-lg transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSaveAllTargets} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                            <div className="space-y-4 divide-y divide-gray-100">
                                {branches.map(b => (
                                    <div key={b.id} className="pt-4 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="space-y-0.5">
                                            <h4 className="font-extrabold text-gray-900 text-sm">{b.name}</h4>
                                            <p className="text-[11px] text-gray-500 font-semibold">{b.city || 'Cabang Klinik'}</p>
                                        </div>

                                        <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
                                            <div className="relative w-full sm:w-64">
                                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-xs">Rp</span>
                                                <input 
                                                    type="number"
                                                    min="0"
                                                    step="1000000"
                                                    value={targetFormData[b.id] ?? (b.monthly_target || 0)}
                                                    onChange={(e) => setTargetFormData({ ...targetFormData, [b.id]: e.target.value })}
                                                    className="input-ayumi bg-gray-50 focus:bg-white border-gray-300 pl-10 font-bold text-sm text-gray-900 w-full"
                                                    placeholder="0"
                                                />
                                            </div>

                                            {/* Quick Preset Buttons */}
                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] font-bold text-gray-500 mr-1">Preset:</span>
                                                {[25000000, 50000000, 100000000, 200000000].map(amt => (
                                                    <button 
                                                        key={amt}
                                                        type="button"
                                                        onClick={() => handleSetPresetTarget(b.id, amt)}
                                                        className="px-2 py-0.5 text-[10px] font-extrabold rounded-lg bg-pink-50 hover:bg-pink-100 text-ayumi-primary transition-colors border border-pink-200"
                                                    >
                                                        {amt / 1000000} Jt
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-4 flex items-center justify-between border-t border-gray-100">
                                <span className="text-xs font-bold text-gray-600">
                                    Total Target Perusahaan: <strong className="text-emerald-700 font-black text-sm">Rp {Object.values(targetFormData).reduce((acc, v) => acc + Number(v || 0), 0).toLocaleString('id-ID')}</strong>
                                </span>

                                <div className="flex items-center gap-3">
                                    <button 
                                        type="button" 
                                        onClick={() => setIsTargetModalOpen(false)} 
                                        className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors text-xs"
                                    >
                                        Batal
                                    </button>
                                    <button 
                                        type="submit" 
                                        disabled={isSavingTargets}
                                        className="btn-primary px-6 py-2.5 text-xs font-extrabold flex items-center gap-2 shadow-md"
                                    >
                                        {isSavingTargets ? 'Menyimpan...' : 'Simpan Semua Target'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
