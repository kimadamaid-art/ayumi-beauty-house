'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getCachedUser, getCachedBranches } from '@/lib/cachedBranches'
import Link from 'next/link'
import DateRangePicker from "../../../components/DateRangePicker"
import { getNetTransactionRevenue, getQrisFee } from '@/lib/paymentUtils'
import { getProductVariants, getProductOriginalPrice } from '@/lib/productVariants'
import toast from 'react-hot-toast'

const getLocalYYYYMMDD = (d = new Date()) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export default function TransactionsHistoryPage() {
    const [transactions, setTransactions] = useState([])
    const [branches, setBranches] = useState([])
    const [dbUser, setDbUser] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isDeletingId, setIsDeletingId] = useState(null)

    // Filters
    const [startDate, setStartDate] = useState(() => getLocalYYYYMMDD())
    const [endDate, setEndDate] = useState(() => getLocalYYYYMMDD())
    const [selectedBranch, setSelectedBranch] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('')

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(25)
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
                console.warn('Could not load products catalog for pricing in kasir history:', err)
            }
        }
        loadProductCatalog()
        return () => { isMounted = false }
    }, [])

    const isInitializedRef = useRef(false)

    // Fetch transactions helper
    const fetchTransactions = async (activeBranch = selectedBranch, activeStart = startDate, activeEnd = endDate, activeMethod = paymentMethod) => {
        setIsLoading(true)
        try {
            let query = supabase
                .from('transactions')
                .select(`
                    *,
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
                        )
                    ),
                    transaction_items (
                        id,
                        name,
                        item_type,
                        product_id,
                        quantity,
                        price,
                        subtotal,
                        original_price,
                        discount_percent,
                        products (id, name, price, description)
                    )
                `)
                .order('created_at', { ascending: false })

            // Apply filters with local timezone conversion
            if (activeStart) {
                query = query.gte('created_at', new Date(`${activeStart}T00:00:00`).toISOString())
            }
            if (activeEnd) {
                query = query.lte('created_at', new Date(`${activeEnd}T23:59:59.999`).toISOString())
            }
            if (activeBranch) {
                query = query.eq('branch_id', activeBranch)
            }
            if (activeMethod) {
                query = query.eq('payment_method', activeMethod)
            }

            const { data, error } = await query
            if (error) throw error
            if (data) setTransactions(data)
        } catch (err) {
            console.error('Error fetching transactions:', err)
            toast.error('Gagal memuat transaksi: ' + (err.message || ''))
        } finally {
            setIsLoading(false)
        }
    }

    // Single Initial Load
    useEffect(() => {
        let isCurrent = true
        async function fetchInitialData() {
            setIsLoading(true)
            try {
                const [{ dbUser: profile }, branchesData] = await Promise.all([
                    getCachedUser(),
                    getCachedBranches()
                ])

                if (!isCurrent) return

                let initialBranch = ''
                if (profile) {
                    setDbUser(profile)
                    if (profile.role !== 'owner') {
                        initialBranch = profile.branch_id || ''
                        setSelectedBranch(initialBranch)
                    }
                }

                if (branchesData) setBranches(branchesData)

                await fetchTransactions(initialBranch, startDate, endDate, paymentMethod)
            } catch (err) {
                console.error('Error in initial load:', err)
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

    // Re-fetch when filters change (ONLY after initialization)
    useEffect(() => {
        if (!isInitializedRef.current) return
        fetchTransactions(selectedBranch, startDate, endDate, paymentMethod)
    }, [startDate, endDate, selectedBranch, paymentMethod])

    // Single derived state: ONLY transactions with payment_status === 'paid' for financial calculations
    const validTransactions = useMemo(
        () => transactions.filter(tx => tx.payment_status === 'paid'),
        [transactions]
    )

    const totalIncome = useMemo(
        () => validTransactions.reduce((sum, trx) => sum + getNetTransactionRevenue(trx), 0),
        [validTransactions]
    )

    const totalQrisFee = useMemo(
        () => validTransactions.reduce((sum, trx) => sum + getQrisFee(trx), 0),
        [validTransactions]
    )

    // Pagination calculations
    const totalPages = Math.ceil(transactions.length / pageSize) || 1
    const safePage = Math.min(currentPage, totalPages)
    const paginatedTransactions = useMemo(() => {
        if (pageSize === -1) return transactions
        const start = (safePage - 1) * pageSize
        return transactions.slice(start, start + pageSize)
    }, [transactions, safePage, pageSize])

    // Resolusi transaksi pertama per pasien untuk deteksi New Customer vs Repeat
    useEffect(() => {
        let isCurrent = true
        async function resolveFirstTransactions() {
            const patientIds = [...new Set(transactions.map(t => t.patient_id).filter(Boolean))]
            if (patientIds.length === 0) {
                if (isCurrent) setPatientFirstTxMap({})
                return
            }
            try {
                const batchSize = 100
                const batches = []
                for (let i = 0; i < patientIds.length; i += batchSize) {
                    batches.push(patientIds.slice(i, i + batchSize))
                }
                const results = await Promise.all(
                    batches.map(chunk =>
                        supabase
                            .from('transactions')
                            .select('id, patient_id, created_at')
                            .in('patient_id', chunk)
                            .order('created_at', { ascending: true })
                    )
                )
                if (!isCurrent) return
                const map = {}
                results.forEach(({ data, error }) => {
                    if (!error && data) {
                        data.forEach(t => {
                            if (t.patient_id && !map[t.patient_id]) {
                                map[t.patient_id] = { id: t.id, created_at: t.created_at }
                            }
                        })
                    }
                })
                setPatientFirstTxMap(map)
            } catch (e) {
                console.error('Error resolving patient first transactions in kasir history:', e)
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

    // Helper kalkulasi akurat harga sebelum diskon, total diskon, dan total bayar
    const getCleanTxPricing = (tx) => {
        if (!tx) return { sebelumDiskon: 0, total: 0, discount: 0 }

        const subtotal = Number(tx.subtotal) || 0
        const total = Number(tx.total) || 0
        const cartDiscount = Number(tx.discount) || 0

        // 1. Treatment record items map (menampung promo/diskon tindakan yang dimasukkan terapis)
        const triList = tx.treatment_records?.treatment_record_items || []
        const triMap = new Map()
        for (const tri of triList) {
            const orig = Number(tri.original_price) || Number(tri.treatments?.price) || Number(tri.price_at_time) || 0
            const charged = Number(tri.price_at_time) || 0
            const key = (tri.treatments?.name || tri.notes || '').trim().toLowerCase()
            if (key) triMap.set(key, { orig, charged })
        }

        // 2. Gross items sum from transaction_items
        let sumGrossItems = 0
        let sumChargedItems = 0
        if (tx.transaction_items && tx.transaction_items.length > 0) {
            for (const item of tx.transaction_items) {
                const qty = Number(item.quantity) || 1
                const charged = Number(item.price) || 0
                let orig = Number(item.original_price) || 0

                const key = (item.name || '').trim().toLowerCase()
                if (orig <= charged && triMap.has(key)) {
                    const tri = triMap.get(key)
                    if (tri.orig > charged) {
                        orig = tri.orig
                    }
                }

                // Kalkulasi harga asli sebelum diskon untuk produk skincare
                if (item.item_type === 'product') {
                    const prod = item.products || productCatalogMap?.get(item.product_id) || productCatalogMap?.get(key)
                    if (prod) {
                        const pOrig = getProductOriginalPrice(item, prod)
                        if (pOrig > charged && (orig <= charged || pOrig > orig)) {
                            orig = pOrig
                        }
                    }
                }

                const unitGross = orig > charged ? orig : charged
                sumGrossItems += unitGross * qty
                sumChargedItems += charged * qty
            }
        }

        const itemDiscount = Math.max(0, sumGrossItems - sumChargedItems)

        let sebelumDiskon = 0
        let finalDiscount = 0

        if (cartDiscount > 0) {
            if (subtotal > total) {
                sebelumDiskon = Math.max(sumGrossItems, subtotal)
                finalDiscount = cartDiscount + itemDiscount
            } else {
                sebelumDiskon = Math.max(sumGrossItems, total + cartDiscount)
                finalDiscount = cartDiscount + itemDiscount
            }
        } else if (itemDiscount > 0) {
            sebelumDiskon = sumGrossItems
            finalDiscount = itemDiscount
        } else {
            sebelumDiskon = subtotal > 0 ? subtotal : total
            finalDiscount = 0
        }

        if (sebelumDiskon < total && finalDiscount === 0) {
            sebelumDiskon = subtotal > 0 ? subtotal : total
        }

        return {
            sebelumDiskon,
            total,
            discount: finalDiscount
        }
    }

    const getCustomerStatus = (tx) => {
        if (!tx || !tx.patient_id) {
            return {
                type: 'walk-in',
                label: 'Walk-in',
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
                badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
            }
        }
        return {
            type: 'repeat',
            label: 'Repeat',
            badgeClass: 'bg-blue-50 text-blue-700 border-blue-200/80'
        }
    }

    const handleDeleteTx = async (trx) => {
        if (!trx) return
        if (dbUser?.role !== 'owner') {
            toast.error('Hanya Owner yang memiliki izin menghapus transaksi.')
            return
        }

        const confirmText = window.prompt(
            `⚠️ PERINGATAN HAPUS PERMANEN (KHUSUS OWNER)\n\nApakah Anda yakin ingin menghapus transaksi "${trx.transaction_number}" secara permanen?\n\n- Data transaksi akan dihapus BERSIH dari database dan laporan omzet.\n- Stok produk yang terjual akan otomatis dikembalikan (jika belum di-void).\n\nKetik "HAPUS" untuk konfirmasi:`
        )

        if (confirmText !== 'HAPUS') {
            if (confirmText !== null) {
                toast.error('Penghapusan dibatalkan. Kata kunci konfirmasi tidak sesuai.')
            }
            return
        }

        setIsDeletingId(trx.id)
        const loadToast = toast.loading(`Menghapus transaksi ${trx.transaction_number}...`)
        try {
            const res = await fetch(`/api/transactions/${trx.id}`, {
                method: 'DELETE'
            })
            const resData = await res.json()

            if (!res.ok) {
                throw new Error(resData.error || 'Gagal menghapus transaksi.')
            }

            toast.success(resData.message || `Transaksi ${trx.transaction_number} berhasil dihapus.`, { id: loadToast })
            fetchTransactions(selectedBranch, startDate, endDate, paymentMethod)
        } catch (err) {
            console.error('Error deleting transaction:', err)
            toast.error(err.message || 'Gagal menghapus transaksi.', { id: loadToast })
        } finally {
            setIsDeletingId(null)
        }
    }

    const formatDate = (isoString) => {
        const date = new Date(isoString)
        return date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    return (
        <div className="space-y-6">
            {/* Header & Filters */}
            <div className="card-ayumi p-4 md:p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Riwayat Transaksi</h2>
                        <p className="text-sm text-gray-500">Pantau dan kelola laporan penjualan harian klinik.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="bg-gradient-to-r from-pink-50 to-purple-50 px-5 py-2.5 rounded-xl border border-pink-100/50">
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">Total Pendapatan</p>
                            <p className="text-xl font-extrabold text-ayumi-primary">Rp {totalIncome.toLocaleString('id-ID')}</p>
                        </div>
                        <div className="bg-violet-50 px-5 py-2.5 rounded-xl border border-violet-100">
                            <div className="flex items-center gap-1 mb-0.5">
                                <p className="text-[10px] text-violet-600 font-bold uppercase tracking-wider">Biaya QRIS</p>
                                <span className="text-[9px] font-extrabold text-violet-700 bg-violet-100 px-1 py-0.2 rounded">0.3%</span>
                            </div>
                            <p className="text-xl font-extrabold text-violet-900">Rp {totalQrisFee.toLocaleString('id-ID')}</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="col-span-1 sm:col-span-2 flex flex-col relative z-20">
                        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Rentang Tanggal</label>
                        <DateRangePicker 
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(range) => {
                                setStartDate(range.startDate);
                                setEndDate(range.endDate);
                                setCurrentPage(1);
                            }}
                            inputClassName="w-full input-ayumi bg-gray-50 text-sm"
                        />
                    </div>
                    {(!dbUser || dbUser.role === 'owner') && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Cabang</label>
                            <select
                                value={selectedBranch}
                                onChange={(e) => {
                                    setSelectedBranch(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="input-ayumi bg-gray-50 text-sm w-full"
                            >
                                <option value="">Semua Cabang</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Metode Bayar</label>
                        <select
                            value={paymentMethod}
                            onChange={(e) => {
                                setPaymentMethod(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="input-ayumi bg-gray-50 text-sm w-full"
                        >
                            <option value="">Semua Metode</option>
                            <option value="cash">Cash</option>
                            <option value="transfer">Transfer Bank</option>
                            <option value="qris">QRIS</option>
                            <option value="debit">Debit</option>
                            <option value="credit">Credit</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="card-ayumi overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-gray-50/50">
                    <div className="text-xs font-bold text-gray-500">
                        Total {transactions.length} Transaksi Terpilih
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 font-semibold">Tampilkan:</label>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value))
                                setCurrentPage(1)
                            }}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white font-medium focus:outline-none focus:ring-1 focus:ring-ayumi-primary"
                        >
                            <option value={10}>10 baris</option>
                            <option value={25}>25 baris</option>
                            <option value={50}>50 baris</option>
                            <option value={100}>100 baris</option>
                            <option value={-1}>Semua ({transactions.length})</option>
                        </select>
                    </div>
                </div>

                {isLoading ? (
                    <div className="p-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                        <div className="animate-spin w-8 h-8 border-3 border-ayumi-primary border-t-transparent rounded-full"></div>
                        <span className="text-sm font-semibold text-gray-500">Memuat riwayat transaksi...</span>
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="p-10 text-center text-gray-400">Tidak ada transaksi pada periode ini.</div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="whitespace-nowrap w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="bg-ayumi-table-header text-ayumi-secondary border-b border-[#E8D0BD]">
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[14%] min-w-[150px]">No. Transaksi</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[10%] min-w-[110px]">Tanggal</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[11%] min-w-[110px]">Cabang</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[20%] min-w-[185px]">Pelanggan</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary w-[11%] min-w-[110px]">Terapis</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-center w-[10%] min-w-[95px]">Metode</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-right w-[10%] min-w-[105px]">Sebelum Diskon</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-right w-[10%] min-w-[115px]">Total (Rp)</th>
                                        <th className="py-3.5 px-4 text-xs font-bold tracking-tight text-ayumi-secondary text-center w-[4%] min-w-[70px]">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 text-sm">
                                    {paginatedTransactions.map((trx) => {
                                        const custStatus = getCustomerStatus(trx)
                                        const therapistName = trx.treatment_records?.therapist?.full_name
                                        const pricing = getCleanTxPricing(trx)

                                        return (
                                            <tr key={trx.id} className={`hover:bg-pink-50/35 transition-colors ${trx.payment_status === 'void' ? 'opacity-70 bg-rose-50/20' : ''}`}>
                                                <td className="p-4 font-mono font-bold text-gray-800 text-xs">
                                                    <span className={trx.payment_status === 'void' ? 'line-through text-gray-400' : ''}>
                                                        {trx.transaction_number}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-gray-600 text-xs">
                                                    {formatDate(trx.created_at)}
                                                </td>
                                                <td className="p-4 text-gray-600 text-xs font-semibold">
                                                    {trx.branches?.name || '-'}
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex flex-col items-start gap-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {trx.patient_id ? (
                                                                <Link 
                                                                    href={`/patients/${trx.patient_id}`}
                                                                    className="font-bold text-gray-900 hover:text-ayumi-primary hover:underline transition-colors text-sm inline-flex items-center gap-1 group/p"
                                                                    title="Buka Profil & Riwayat Pasien"
                                                                >
                                                                    <span>{trx.patients?.full_name || 'Walk-in Customer'}</span>
                                                                    <span className="text-[11px] text-gray-400 group-hover/p:text-ayumi-primary group-hover/p:translate-x-0.5 group-hover/p:-translate-y-0.5 transition-transform">↗</span>
                                                                </Link>
                                                            ) : (
                                                                <span className="font-bold text-gray-800 text-sm">{trx.patients?.full_name || 'Walk-in Customer'}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${custStatus.badgeClass}`}>
                                                                {custStatus.label}
                                                            </span>
                                                            {formatGenderAge(trx.patients) && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200/80">
                                                                    {formatGenderAge(trx.patients)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-xs">
                                                    {therapistName ? (
                                                        <div className="inline-flex items-center gap-1.5 font-bold text-gray-800 bg-pink-50/50 px-2.5 py-1 rounded-lg border border-pink-100/80">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-ayumi-primary shrink-0"></span>
                                                            <span>{therapistName}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 font-medium px-2">-</span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-gray-600 uppercase text-xs font-bold tracking-wider">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{trx.payment_method}</span>
                                                        {trx.payment_status === 'void' ? (
                                                            <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[9px] font-black">VOID</span>
                                                        ) : (
                                                            <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-black">LUNAS</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right text-xs align-middle">
                                                    <span className={`font-bold ${pricing.discount > 0 ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                                        Rp {pricing.sebelumDiskon.toLocaleString('id-ID')}
                                                    </span>
                                                </td>
                                                <td className={`p-4 text-right align-middle ${trx.payment_status === 'void' ? 'text-gray-400 line-through font-bold' : 'text-gray-900 font-extrabold'}`}>
                                                    <div className="flex flex-col items-end justify-center">
                                                        <span className="text-sm font-extrabold text-gray-900 tracking-tight">
                                                            Rp {pricing.total.toLocaleString('id-ID')}
                                                        </span>
                                                        {pricing.discount > 0 && (
                                                            <div className="mt-1 flex items-center justify-end">
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200/90 shadow-2xs">
                                                                    <svg className="w-2.5 h-2.5 text-rose-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                                        <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                                                    </svg>
                                                                    <span>Disc -Rp {pricing.discount.toLocaleString('id-ID')}</span>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Link href={`/kasir/transactions/${trx.id}`}>
                                                        <button 
                                                            className="text-ayumi-primary hover:text-ayumi-secondary p-1.5 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors flex items-center gap-1.5 px-3 text-xs font-semibold"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                            Detail
                                                        </button>
                                                    </Link>
                                                    {dbUser?.role === 'owner' && (
                                                        <button
                                                            onClick={() => handleDeleteTx(trx)}
                                                            disabled={isDeletingId === trx.id}
                                                            className="text-rose-600 hover:text-rose-700 p-1.5 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors flex items-center gap-1 px-2.5 text-xs font-semibold disabled:opacity-50"
                                                            title="Hapus Transaksi Permanen (Khusus Owner)"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                            <span>{isDeletingId === trx.id ? '...' : 'Hapus'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Bar */}
                        {pageSize !== -1 && transactions.length > pageSize && (
                            <div className="px-5 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-gray-50/40">
                                <span className="text-gray-500 font-medium">
                                    Menampilkan {((safePage - 1) * pageSize) + 1} - {Math.min(safePage * pageSize, transactions.length)} dari {transactions.length} transaksi
                                </span>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={safePage === 1}
                                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        &larr; Prev
                                    </button>
                                    <div className="flex items-center gap-1 px-1">
                                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                                            .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
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
                                                        safePage === p
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
                                        disabled={safePage === totalPages}
                                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                    >
                                        Next &rarr;
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
