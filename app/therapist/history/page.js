'use client'

import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function MonthPicker({ value, onChange }) {
    const [isOpen, setIsOpen] = useState(false)
    const ref = useRef(null)
    const now = new Date()

    const [year, monthIdx] = value
        ? [parseInt(value.split('-')[0]), parseInt(value.split('-')[1]) - 1]
        : [now.getFullYear(), now.getMonth()]

    const [pickerYear, setPickerYear] = useState(year)

    useEffect(() => {
        const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setIsOpen(false) }
        document.addEventListener('mousedown', handle)
        return () => document.removeEventListener('mousedown', handle)
    }, [])

    const select = (m) => {
        const val = `${pickerYear}-${String(m + 1).padStart(2, '0')}`
        onChange(val)
        setIsOpen(false)
    }

    const displayLabel = `${MONTH_NAMES[monthIdx]} ${year}`

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => { setPickerYear(year); setIsOpen(o => !o) }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-pink-200 hover:border-ayumi-primary text-sm font-bold text-gray-800 rounded-2xl shadow-sm transition-all cursor-pointer"
            >
                <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{displayLabel}</span>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-xl border border-gray-200 p-4 w-72">
                    {/* Year nav */}
                    <div className="flex items-center justify-between mb-3">
                        <button
                            type="button"
                            onClick={() => setPickerYear(y => y - 1)}
                            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-pink-50 text-gray-500 hover:text-ayumi-primary transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <span className="text-sm font-extrabold text-gray-900">{pickerYear}</span>
                        <button
                            type="button"
                            onClick={() => setPickerYear(y => y + 1)}
                            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-pink-50 text-gray-500 hover:text-ayumi-primary transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                    {/* Month grid */}
                    <div className="grid grid-cols-4 gap-1.5">
                        {SHORT_MONTHS.map((m, i) => {
                            const isActive = pickerYear === year && i === monthIdx
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => select(i)}
                                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                        isActive
                                            ? 'bg-ayumi-primary text-white shadow-sm'
                                            : 'text-gray-600 hover:bg-pink-50 hover:text-ayumi-primary'
                                    }`}
                                >
                                    {m}
                                </button>
                            )
                        })}
                    </div>
                    {/* Quick: Bulan ini */}
                    <button
                        type="button"
                        onClick={() => {
                            const n = new Date()
                            select(n.getMonth(), n.getFullYear())
                            setPickerYear(n.getFullYear())
                        }}
                        className="mt-3 w-full py-1.5 text-xs font-bold text-ayumi-primary bg-pink-50 hover:bg-pink-100 rounded-xl transition-all cursor-pointer"
                    >
                        Bulan Ini
                    </button>
                </div>
            )}
        </div>
    )
}

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
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
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

    const getMonthLabel = () => {
        if (!filterMonth) return 'Bulan Ini'
        const [y, m] = filterMonth.split('-')
        return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-3xl border border-gray-150 shadow-sm">
                <div>
                    <h2 className="text-base font-extrabold text-gray-900 leading-tight">Riwayat Perawatan Terapis</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Daftar tindakan treatment dan rekam medis yang telah Anda selesaikan.</p>
                </div>
                <div className="bg-pink-50 border border-pink-100 px-5 py-2.5 rounded-2xl flex items-center gap-3 shrink-0">
                    <div className="w-9 h-9 bg-ayumi-primary text-white rounded-xl flex items-center justify-center font-bold text-sm">
                        📋
                    </div>
                    <div>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{getMonthLabel()}</div>
                        <div className="text-lg font-black text-ayumi-primary leading-none mt-0.5">{records.length} <span className="text-xs font-bold text-gray-500">pasien</span></div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 md:p-6">
                {/* Filter row */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <MonthPicker value={filterMonth} onChange={setFilterMonth} />
                    <select 
                        value={filterBranch}
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="input-ayumi bg-white border-2 border-pink-200 hover:border-ayumi-primary focus:bg-white flex-1 sm:max-w-xs font-bold text-sm rounded-2xl cursor-pointer"
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
