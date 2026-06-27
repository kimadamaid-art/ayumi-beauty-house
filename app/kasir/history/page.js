'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import DateRangePicker from "../../../components/DateRangePicker"

export default function TransactionsHistoryPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [transactions, setTransactions] = useState([])
    const [branches, setBranches] = useState([])
    const [dbUser, setDbUser] = useState(null)
    const [isLoading, setIsLoading] = useState(true)

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


    const totalIncome = transactions.reduce((sum, trx) => sum + trx.total, 0)

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
            <div className="card-ayumi p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Riwayat Transaksi</h2>
                        <p className="text-sm text-gray-500">Pantau dan kelola laporan penjualan harian klinik.</p>
                    </div>
                    <div className="bg-gradient-to-r from-pink-50 to-purple-50 px-6 py-3 rounded-xl border border-pink-100/50">
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Total Pendapatan</p>
                        <p className="text-2xl font-extrabold text-ayumi-primary font-mono">Rp {totalIncome.toLocaleString('id-ID')}</p>
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
                    <div className="p-8 text-center text-gray-500 animate-pulse">Memuat riwayat transaksi...</div>
                ) : transactions.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Tidak ada transaksi pada periode ini.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
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
                                                <span className="font-semibold text-ayumi-primary">{trx.patients.full_name}</span>
                                            ) : (
                                                <span className="text-gray-400 italic">Walk-in</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-gray-600 uppercase text-xs font-bold tracking-wider">
                                            {trx.payment_method}
                                        </td>
                                        <td className="p-4 text-right font-mono font-bold text-gray-800">
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
