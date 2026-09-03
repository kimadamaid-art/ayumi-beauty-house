'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import DateRangePicker from "../../../components/DateRangePicker"
import { getNetTransactionRevenue } from '@/lib/paymentUtils'
import toast from 'react-hot-toast'

export default function TransactionsHistoryPage() {
    const [transactions, setTransactions] = useState([])
    const [branches, setBranches] = useState([])
    const [dbUser, setDbUser] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isDeletingId, setIsDeletingId] = useState(null)

    // Filters
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
    const [selectedBranch, setSelectedBranch] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('')

    async function fetchInitialData() {
        setIsLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data: uData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (uData) {
                setDbUser(uData)
                if (uData.role !== 'owner') {
                    setSelectedBranch(uData.branch_id || '')
                }
            } else {
                setDbUser({ role: 'owner', id: user.id })
            }
        }

        const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
        if (brData) setBranches(brData)
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchInitialData()
    }, [supabase])

    async function fetchTransactions() {
        setIsLoading(true)
        
        let query = supabase
            .from('transactions')
            .select(`
                *,
                branches (name),
                patients (full_name),
                users:users!transactions_cashier_id_fkey(full_name)
            `)
            .order('created_at', { ascending: false })

        // Apply filters
        if (startDate) {
            query = query.gte('created_at', `${startDate}T00:00:00Z`)
        }
        if (endDate) {
            query = query.lte('created_at', `${endDate}T23:59:59Z`)
        }
        if (selectedBranch) {
            query = query.eq('branch_id', selectedBranch)
        }
        if (paymentMethod) {
            query = query.eq('payment_method', paymentMethod)
        }

        const { data, error } = await query
        
        if (data) setTransactions(data)
        setIsLoading(false)
    }

    useEffect(() => {
        if (dbUser) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchTransactions()
        }
    }, [dbUser, startDate, endDate, selectedBranch, paymentMethod])

    // Single derived state: ONLY transactions with payment_status === 'paid' for financial calculations
    const validTransactions = useMemo(
        () => transactions.filter(tx => tx.payment_status === 'paid'),
        [transactions]
    )

    const totalIncome = useMemo(
        () => validTransactions.reduce((sum, trx) => sum + getNetTransactionRevenue(trx), 0),
        [validTransactions]
    )

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
            fetchTransactions()
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
                    <div className="bg-gradient-to-r from-pink-50 to-purple-50 px-6 py-3 rounded-xl border border-pink-100/50">
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Total Pendapatan</p>
                        <p className="text-2xl font-extrabold text-ayumi-primary ">Rp {totalIncome.toLocaleString('id-ID')}</p>
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
                            }}
                            inputClassName="w-full input-ayumi bg-gray-50 text-sm"
                        />
                    </div>
                    {(!dbUser || dbUser.role === 'owner') && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Cabang</label>
                            <select
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
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
                            onChange={(e) => setPaymentMethod(e.target.value)}
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
                {isLoading ? (
                    <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat riwayat transaksi...</div>
                ) : transactions.length === 0 ? (
                    <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada transaksi pada periode ini.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                    <th className="p-4 font-semibold">No. Transaksi</th>
                                    <th className="p-4 font-semibold">Tanggal</th>
                                    <th className="p-4 font-semibold">Cabang</th>
                                    <th className="p-4 font-semibold">Pelanggan</th>
                                    <th className="p-4 font-semibold">Metode</th>
                                    <th className="p-4 font-semibold text-right">Total (Rp)</th>
                                    <th className="p-4 font-semibold text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm">
                                {transactions.map((trx) => (
                                    <tr key={trx.id} className="hover:bg-ayumi-table-hover transition-colors">
                                        <td className="p-4 font-bold text-gray-800 text-xs">
                                            {trx.transaction_number}
                                        </td>
                                        <td className="p-4 text-gray-600">
                                            {formatDate(trx.created_at)}
                                        </td>
                                        <td className="p-4 text-gray-600">
                                            {trx.branches?.name || '-'}
                                        </td>
                                        <td className="p-4">
                                            {trx.patients?.full_name ? (
                                                trx.patient_id ? (
                                                    <Link
                                                        href={`/patients/${trx.patient_id}`}
                                                        className="font-bold text-ayumi-primary hover:text-ayumi-secondary hover:underline transition-colors inline-flex items-center gap-1 group"
                                                        title="Buka Profil & Riwayat Pasien"
                                                    >
                                                        <span>{trx.patients.full_name}</span>
                                                        <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                                                    </Link>
                                                ) : (
                                                    <span className="font-semibold text-ayumi-primary">{trx.patients.full_name}</span>
                                                )
                                            ) : (
                                                <span className="text-gray-400 italic">Walk-in</span>
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
                                        <td className={`p-4 text-right font-bold ${trx.payment_status === 'void' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                                            {trx.total.toLocaleString('id-ID')}
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
