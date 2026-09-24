'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getCachedUser, getCachedBranches } from '@/lib/cachedBranches'
import { useRouter } from 'next/navigation'
import DateRangePicker from '../../../components/DateRangePicker'
import BranchFilter from '@/components/ui/BranchFilter'

// Laporan upah worker (tenaga infus dan tindakan sejenis).
//
// Upah worker berbentuk nominal rupiah per tindakan, bukan persen dari harga,
// sehingga diskon, harga coret, maupun penebusan kupon tidak mengubah nominalnya.
// Yang dipakai adalah worker_fee_at_time, yaitu tarif yang berlaku saat tindakan
// dilakukan -- bukan tarif master hari ini -- supaya laporan periode lalu tidak
// ikut berubah ketika owner menaikkan tarif.
//
// Sama seperti komisi terapis, upah baru dihitung setelah tindakannya dibayar.
// Tindakan yang ditebus dengan kupon tetap dihitung, karena pasien sudah membayar
// saat membeli paket kuponnya.
export default function WorkersReportPage() {
    const router = useRouter()

    const [isLoading, setIsLoading] = useState(true)
    const [branches, setBranches] = useState([])
    const [userLoaded, setUserLoaded] = useState(false)

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const firstDayOfMonth = () => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }

    const [startDate, setStartDate] = useState(firstDayOfMonth)
    const [endDate, setEndDate] = useState(() => getLocalYYYYMMDD())
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [items, setItems] = useState([])
    const [expandedWorkerId, setExpandedWorkerId] = useState(null)

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
            console.error('Error loading workers report init:', err)
            setUserLoaded(true)
        }
    }

    const fetchReportData = async () => {
        if (!startDate || !endDate) return
        setIsLoading(true)

        // Query dibentuk ulang untuk setiap halaman: satu builder tidak boleh
        // dipakai dua kali dengan range berbeda.
        const buildQuery = () => {
            let q = supabase
                .from('treatment_record_items')
                .select(`
                    id,
                    price_at_time,
                    notes,
                    worker_id,
                    worker_fee_at_time,
                    treatments(name),
                    workers(id, full_name, is_active),
                    treatment_records!inner(
                        id,
                        treatment_date,
                        branch_id,
                        branches(name),
                        patients(full_name),
                        transactions(id, payment_status)
                    )
                `)
                .not('worker_id', 'is', null)
                .gt('worker_fee_at_time', 0)
                .gte('treatment_records.treatment_date', startDate)
                .lte('treatment_records.treatment_date', endDate)

            if (selectedBranch !== 'all') {
                q = q.eq('treatment_records.branch_id', selectedBranch)
            }
            return q.order('id', { ascending: true })
        }

        // Batas 1000 baris per permintaan diatasi dengan penarikan bertahap,
        // supaya periode panjang tidak terpotong diam-diam.
        const collected = []
        for (let from = 0; ; from += 1000) {
            const { data, error } = await buildQuery().range(from, from + 999)
            if (error) {
                console.error('Error fetching worker report:', error)
                break
            }
            collected.push(...(data || []))
            if (!data || data.length < 1000) break
        }

        // Hanya tindakan yang sudah dibayar. Tindakan berkupon (harga Rp 0) tetap
        // dihitung karena pembayarannya terjadi saat paket kupon dibeli.
        const paidOnly = collected.filter(item => {
            const txs = item.treatment_records?.transactions || []
            const hasPaidTx = txs.some(t => t.payment_status === 'paid')
            const isCouponRedeemed = item.notes?.includes('[KUPON_BARU') || item.notes?.includes('[KUPON_LAMA') || Number(item.price_at_time) === 0
            return hasPaidTx || isCouponRedeemed
        })

        setItems(paidOnly)
        setIsLoading(false)
    }

    const workerGroups = useMemo(() => {
        const groups = {}
        items.forEach(item => {
            const id = item.worker_id
            if (!groups[id]) {
                groups[id] = {
                    id,
                    name: item.workers?.full_name || 'Worker tidak dikenal',
                    isActive: item.workers?.is_active !== false,
                    total: 0,
                    count: 0,
                    rows: []
                }
            }
            groups[id].total += Number(item.worker_fee_at_time || 0)
            groups[id].count += 1
            groups[id].rows.push(item)
        })
        return Object.values(groups).sort((a, b) => b.total - a.total)
    }, [items])

    const grandTotal = workerGroups.reduce((sum, g) => sum + g.total, 0)
    const grandCount = workerGroups.reduce((sum, g) => sum + g.count, 0)
    const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

    return (
        <div className="space-y-6 py-6">
            <div>
                <h1 className="text-xl md:text-2xl font-black text-gray-800">Laporan Upah Worker</h1>
                <p className="text-sm text-ayumi-text-muted mt-1">
                    Upah tenaga infus dan tindakan sejenis, dihitung per tindakan dalam nominal rupiah. Hanya tindakan yang sudah dibayar yang dihitung.
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
                    <p className="text-xs font-bold text-gray-500 uppercase">Total Upah Worker</p>
                    <p className="text-2xl font-black text-amber-600 mt-1">{isLoading ? '...' : rupiah(grandTotal)}</p>
                </div>
                <div className="card-ayumi p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase">Jumlah Tindakan</p>
                    <p className="text-2xl font-black text-gray-800 mt-1">{isLoading ? '...' : grandCount}</p>
                </div>
                <div className="card-ayumi p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase">Worker Terlibat</p>
                    <p className="text-2xl font-black text-gray-800 mt-1">{isLoading ? '...' : workerGroups.length}</p>
                </div>
            </div>

            <div className="card-ayumi overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500 animate-pulse">Memuat data...</div>
                ) : workerGroups.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                        Belum ada tindakan berupah worker yang sudah dibayar pada periode ini.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {workerGroups.map(group => (
                            <div key={group.id}>
                                <button
                                    type="button"
                                    onClick={() => setExpandedWorkerId(expandedWorkerId === group.id ? null : group.id)}
                                    className="w-full flex items-center justify-between gap-3 p-4 hover:bg-ayumi-table-hover transition-colors text-left cursor-pointer"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black shrink-0">
                                            {group.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-800 truncate">
                                                {group.name}
                                                {!group.isActive && <span className="ml-2 text-[10px] font-bold text-gray-400 uppercase">nonaktif</span>}
                                            </p>
                                            <p className="text-xs text-gray-500">{group.count} tindakan</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="font-black text-amber-600">{rupiah(group.total)}</span>
                                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedWorkerId === group.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </button>

                                {expandedWorkerId === group.id && (
                                    <div className="overflow-x-auto bg-gray-50/60 border-t border-gray-100">
                                        <table className="w-full text-left border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr className="text-[11px] uppercase text-gray-500">
                                                    <th className="px-4 py-2 font-bold">Tanggal</th>
                                                    <th className="px-4 py-2 font-bold">Tindakan</th>
                                                    <th className="px-4 py-2 font-bold">Pasien</th>
                                                    <th className="px-4 py-2 font-bold">Cabang</th>
                                                    <th className="px-4 py-2 font-bold text-right">Upah</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-sm divide-y divide-gray-100">
                                                {group.rows
                                                    .slice()
                                                    .sort((a, b) => (a.treatment_records?.treatment_date || '').localeCompare(b.treatment_records?.treatment_date || ''))
                                                    .map(row => (
                                                        <tr key={row.id}>
                                                            <td className="px-4 py-2 text-gray-600">
                                                                {row.treatment_records?.treatment_date
                                                                    ? new Date(row.treatment_records.treatment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                                                                    : '-'}
                                                            </td>
                                                            <td className="px-4 py-2 font-semibold text-gray-800">{row.treatments?.name || '-'}</td>
                                                            <td className="px-4 py-2 text-gray-600">{row.treatment_records?.patients?.full_name || '-'}</td>
                                                            <td className="px-4 py-2 text-gray-500">{row.treatment_records?.branches?.name || '-'}</td>
                                                            <td className="px-4 py-2 text-right font-bold text-amber-600">{rupiah(row.worker_fee_at_time)}</td>
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
                Nominal yang ditampilkan adalah tarif yang berlaku saat tindakan dilakukan, sehingga perubahan tarif di kemudian hari tidak mengubah laporan periode ini.
                Tindakan yang ditebus dengan kupon tetap dihitung penuh, karena upah worker tidak bergantung pada harga yang dibayar saat itu.
            </p>
        </div>
    )
}
