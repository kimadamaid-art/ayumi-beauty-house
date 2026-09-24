'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getCachedUser, getCachedBranches } from '@/lib/cachedBranches'
import { useRouter } from 'next/navigation'
import DateRangePicker from '../../../components/DateRangePicker'
import BranchFilter from '@/components/ui/BranchFilter'

// Laporan fee penjualan kupon.
//
// Fee dibayar sekali kepada terapis yang menjual paket, bukan per sesi pemakaian,
// dan nominalnya ditentukan per paket oleh owner. Paket yang tidak memberi fee
// (misalnya paket infus) cukup diisi 0 dan tidak akan muncul di sini.
//
// Yang dipakai adalah seller_fee_at_time, yaitu tarif saat paket terjual, supaya
// laporan periode lalu tidak berubah ketika owner menaikkan fee.
//
// Hanya nota berstatus lunas yang dihitung, sehingga transaksi yang di-void
// otomatis gugur beserta fee-nya.
export default function CouponSalesReportPage() {
    const router = useRouter()

    const [isLoading, setIsLoading] = useState(true)
    const [branches, setBranches] = useState([])
    const [userLoaded, setUserLoaded] = useState(false)

    const firstDayOfMonth = () => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }
    const todayStr = () => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    const [startDate, setStartDate] = useState(firstDayOfMonth)
    const [endDate, setEndDate] = useState(todayStr)
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [rows, setRows] = useState([])
    const [expandedId, setExpandedId] = useState(null)

    useEffect(() => {
        checkAccessAndInit()
    }, [])

    useEffect(() => {
        if (userLoaded && startDate && endDate) {
            fetchReportData()
        }
    }, [userLoaded, startDate, endDate, selectedBranch])

    const checkAccessAndInit = async () => {
        try {
            const [{ user, dbUser: userData }, branchData] = await Promise.all([
                getCachedUser(),
                getCachedBranches()
            ])

            if (!user) {
                router.push('/login')
                return
            }
            if (!userData || userData.role !== 'owner') {
                alert('Akses ditolak. Halaman ini khusus untuk Owner.')
                router.push('/dashboard')
                return
            }
            if (branchData) setBranches(branchData)
            setUserLoaded(true)
        } catch (err) {
            console.error('Error loading coupon sales report init:', err)
            setUserLoaded(true)
        }
    }

    const fetchReportData = async () => {
        if (!startDate || !endDate) return
        setIsLoading(true)

        const buildQuery = () => {
            let q = supabase
                .from('patient_coupons')
                .select(`
                    id,
                    purchased_at,
                    created_at,
                    sold_by,
                    seller_fee_at_time,
                    status,
                    coupon_packages(name),
                    patients(full_name),
                    users:sold_by(full_name, is_active),
                    transactions!inner(id, transaction_number, payment_status, branch_id, branches(name))
                `)
                .not('sold_by', 'is', null)
                .gt('seller_fee_at_time', 0)
                .eq('transactions.payment_status', 'paid')
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59`)

            if (selectedBranch !== 'all') {
                q = q.eq('transactions.branch_id', selectedBranch)
            }
            return q.order('created_at', { ascending: false })
        }

        const collected = []
        for (let from = 0; ; from += 1000) {
            const { data, error } = await buildQuery().range(from, from + 999)
            if (error) {
                console.error('Error fetching coupon sales report:', error)
                break
            }
            collected.push(...(data || []))
            if (!data || data.length < 1000) break
        }

        setRows(collected)
        setIsLoading(false)
    }

    const sellerGroups = useMemo(() => {
        const groups = {}
        rows.forEach(r => {
            const id = r.sold_by
            if (!groups[id]) {
                groups[id] = {
                    id,
                    name: r.users?.full_name || 'Terapis tidak dikenal',
                    total: 0,
                    count: 0,
                    rows: []
                }
            }
            groups[id].total += Number(r.seller_fee_at_time || 0)
            groups[id].count += 1
            groups[id].rows.push(r)
        })
        return Object.values(groups).sort((a, b) => b.total - a.total)
    }, [rows])

    const grandTotal = sellerGroups.reduce((s, g) => s + g.total, 0)
    const grandCount = sellerGroups.reduce((s, g) => s + g.count, 0)
    const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

    return (
        <div className="space-y-6 py-6">
            <div>
                <h1 className="text-xl md:text-2xl font-black text-gray-800">Laporan Fee Penjualan Kupon</h1>
                <p className="text-sm text-ayumi-text-muted mt-1">
                    Bonus untuk terapis yang menjual paket kupon, dibayar sekali saat notanya lunas. Transaksi yang dibatalkan tidak dihitung.
                </p>
            </div>

            <div className="card-ayumi p-4 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                <DateRangePicker
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(range) => {
                        setStartDate(range.startDate)
                        setEndDate(range.endDate)
                    }}
                    inputClassName="text-sm font-semibold"
                />
                <BranchFilter
                    value={selectedBranch}
                    onChange={setSelectedBranch}
                    branches={branches}
                    userRole="owner"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card-ayumi p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase">Total Fee Penjualan</p>
                    <p className="text-2xl font-black text-indigo-600 mt-1">{isLoading ? '...' : rupiah(grandTotal)}</p>
                </div>
                <div className="card-ayumi p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase">Paket Terjual</p>
                    <p className="text-2xl font-black text-gray-800 mt-1">{isLoading ? '...' : grandCount}</p>
                </div>
                <div className="card-ayumi p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase">Terapis Penjual</p>
                    <p className="text-2xl font-black text-gray-800 mt-1">{isLoading ? '...' : sellerGroups.length}</p>
                </div>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : sellerGroups.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                        Belum ada penjualan paket kupon berfee yang lunas pada periode ini.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {sellerGroups.map(group => (
                            <div key={group.id}>
                                <button
                                    type="button"
                                    onClick={() => setExpandedId(expandedId === group.id ? null : group.id)}
                                    className="w-full flex items-center justify-between gap-3 p-4 hover:bg-ayumi-table-hover transition-colors text-left cursor-pointer"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-black shrink-0">
                                            {group.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-800 truncate">{group.name}</p>
                                            <p className="text-xs text-gray-500">{group.count} paket terjual</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="font-black text-indigo-600">{rupiah(group.total)}</span>
                                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === group.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </button>

                                {expandedId === group.id && (
                                    <div className="overflow-x-auto bg-gray-50/60 border-t border-gray-100">
                                        <table className="w-full text-left border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr className="text-[11px] uppercase text-gray-500">
                                                    <th className="px-4 py-2 font-bold">Tanggal</th>
                                                    <th className="px-4 py-2 font-bold">Paket</th>
                                                    <th className="px-4 py-2 font-bold">Pasien</th>
                                                    <th className="px-4 py-2 font-bold">Nota</th>
                                                    <th className="px-4 py-2 font-bold">Cabang</th>
                                                    <th className="px-4 py-2 font-bold text-right">Fee</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-sm divide-y divide-gray-100">
                                                {group.rows.map(r => (
                                                    <tr key={r.id}>
                                                        <td className="px-4 py-2 text-gray-600">
                                                            {new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </td>
                                                        <td className="px-4 py-2 font-semibold text-gray-800">{r.coupon_packages?.name || '-'}</td>
                                                        <td className="px-4 py-2 text-gray-600">{r.patients?.full_name || '-'}</td>
                                                        <td className="px-4 py-2 text-gray-500">{r.transactions?.transaction_number || '-'}</td>
                                                        <td className="px-4 py-2 text-gray-500">{r.transactions?.branches?.name || '-'}</td>
                                                        <td className="px-4 py-2 text-right font-bold text-indigo-600">{rupiah(r.seller_fee_at_time)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
                Nominal yang ditampilkan adalah fee yang berlaku saat paket terjual, sehingga perubahan tarif di kemudian hari tidak mengubah laporan periode ini.
                Fee dibayarkan sekali per paket terjual, bukan per sesi pemakaian.
            </p>
        </div>
    )
}
