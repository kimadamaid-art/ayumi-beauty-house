'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

export default function TherapistHistory() {
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    
    // Filters
    const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7)) // YYYY-MM
    const [filterBranch, setFilterBranch] = useState('')

    useEffect(() => {
        fetchInitial()
    }, [])

    useEffect(() => {
        if (dbUser) {
            fetchHistory()
        }
    }, [dbUser, filterMonth, filterBranch])

    const fetchInitial = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }

        setDbUser(userData)

        // Fetch Branches for filter
        const { data: branchData } = await supabase.from('branches').select('id, name')
        if (branchData) setBranches(branchData)
    }

    const fetchHistory = async () => {
        setLoading(true)
        
        let query = supabase
            .from('treatment_records')
            .select(`
                *,
                patients (id, full_name, whatsapp),
                branches (name),
                treatment_record_items (
                    id, price_at_time, discount_percent, notes,
                    treatments (name)
                )
            `)
            .eq('performed_by', dbUser.id)
            .order('treatment_date', { ascending: false })

        if (filterBranch) {
            query = query.eq('branch_id', filterBranch)
        }
        
        if (filterMonth) {
            const startDate = `${filterMonth}-01`
            const endDate = `${filterMonth}-31`
            query = query.gte('treatment_date', startDate).lte('treatment_date', endDate)
        }

        const { data, error } = await query
        if (error) console.error("Error fetching therapist history:", error)
        if (data) {
            setRecords(data)
        }
        setLoading(false)
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-3xl border border-gray-150 shadow-sm">
                <div>
                    <h2 className="text-base font-extrabold text-gray-900 leading-tight">Riwayat Perawatan Terapis</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Daftar tindakan treatment dan rekam medis yang telah Anda selesaikan.</p>
                </div>
                <div className="bg-pink-50 border border-pink-100 px-5 py-2.5 rounded-2xl flex items-center gap-3 shrink-0">
                    <div className="w-9 h-9 bg-ayumi-primary text-white rounded-xl flex items-center justify-center font-bold text-sm">
                        📋
                    </div>
                    <div>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Total Bulan Ini</div>
                        <div className="text-lg font-black text-ayumi-primary leading-none mt-0.5">{records.length} <span className="text-xs font-bold text-gray-500">pasien</span></div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 md:p-6">
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input 
                        type="month" 
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs font-bold text-sm"
                    />
                    <select 
                        value={filterBranch}
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs font-bold text-sm"
                    >
                        <option value="">Semua Cabang</option>
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                        <p className="text-gray-500 font-medium">Memuat riwayat...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                        <table className="whitespace-nowrap w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-pink-50/60 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider">
                                    <th className="p-4">Tanggal & Waktu</th>
                                    <th className="p-4">Pasien</th>
                                    <th className="p-4">Cabang</th>
                                    <th className="p-4">Treatment & Catatan SOAP</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center border-none">
                                            <div className="w-14 h-14 bg-pink-50 rounded-full flex items-center justify-center mb-3 mx-auto text-ayumi-primary font-bold text-xl">
                                                🔍
                                            </div>
                                            <p className="text-gray-600 font-extrabold text-base mb-1">Belum Ada Riwayat Perawatan</p>
                                            <p className="text-gray-400 text-xs">Belum ada catatan rekam medis yang tersimpan untuk filter ini.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    records.map(r => (
                                        <tr key={r.id} className="hover:bg-pink-50/20 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-gray-900">
                                                    {new Date(r.treatment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                </div>
                                                <div className="text-xs text-gray-400 mt-0.5">{r.treatment_time || ''}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="font-bold text-gray-900">{r.patients?.full_name || '-'}</div>
                                                <div className="text-xs text-gray-400 mt-0.5">{r.patients?.whatsapp || ''}</div>
                                            </td>
                                            <td className="p-4 text-xs font-semibold text-gray-600">
                                                {r.branches?.name || '-'}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-wrap gap-1.5 mb-1">
                                                    {r.treatment_record_items && r.treatment_record_items.length > 0 ? (
                                                        r.treatment_record_items.map(item => (
                                                            <span key={item.id} className="px-2.5 py-0.5 bg-pink-100 text-ayumi-primary text-xs font-bold rounded-lg border border-pink-200">
                                                                {item.treatments?.name || 'Treatment'}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-xs text-gray-400 font-medium">-</span>
                                                    )}
                                                </div>
                                                {(r.result_notes || r.recommendation || r.complaints) && (
                                                    <p className="text-xs text-gray-500 font-medium max-w-sm truncate mt-1">
                                                        📝 {r.result_notes || r.recommendation || r.complaints}
                                                    </p>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
