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
                patients (full_name),
                branches (name)
            `)
            .eq('therapist_id', dbUser.id)
            .order('treatment_date', { ascending: false })

        if (filterBranch) {
            query = query.eq('branch_id', filterBranch)
        }
        
        if (filterMonth) {
            const [year, month] = filterMonth.split('-')
            const startDate = new Date(year, month - 1, 1).toISOString()
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString()
            
            query = query.gte('treatment_date', startDate).lte('treatment_date', endDate)
        }

        const { data } = await query
        if (data) {
            setRecords(data)
        }
        setLoading(false)
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-end">
                <div className="bg-pink-50 border border-pink-100 px-6 py-3 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-ayumi-primary text-white rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div>
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Total Bulan Ini</div>
                        <div className="text-2xl font-extrabold text-ayumi-text">{records.length} <span className="text-sm font-semibold text-gray-400">pasien</span></div>
                    </div>
                </div>
            </div>

            <div className="card-ayumi p-6">
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input 
                        type="month" 
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs"
                    />
                    <select 
                        value={filterBranch}
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white flex-1 md:max-w-xs"
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
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary text-sm font-bold">
                                <tr>
                                    <th className="p-4 rounded-tl-xl">Tanggal</th>
                                    <th className="p-4">Pasien</th>
                                    <th className="p-4">Cabang</th>
                                    <th className="p-4">Hasil Treatment</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto text-pink-300">
                                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">Belum ada riwayat treatment.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    records.map(r => (
                                        <tr key={r.id} className="hover:bg-ayumi-table-hover transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-gray-800">{new Date(r.treatment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                            </td>
                                            <td className="p-4 font-bold text-ayumi-text">
                                                {r.patients?.full_name}
                                            </td>
                                            <td className="p-4 text-gray-600 font-medium">{r.branches?.name}</td>
                                            <td className="p-4">
                                                <div className="text-sm text-gray-600 max-w-xs truncate">{r.treatment_result || '-'}</div>
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
