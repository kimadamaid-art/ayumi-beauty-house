'use client'

import { useEffect, useState, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import DateRangePicker from "../../components/DateRangePicker"

export default function TreatmentRecordsPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchInput, setSearchInput] = useState('')
    const [searchQuery, setSearchQuery] = useState('')

    // Owner filters
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [userRole, setUserRole] = useState(null)
    const [branches, setBranches] = useState([])
    const [selectedBranchFilter, setSelectedBranchFilter] = useState('all')
    const [startDate, setStartDate] = useState(() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    })
    const [userLoaded, setUserLoaded] = useState(false)
    
    // Therapist filter & pagination states
    const [therapists, setTherapists] = useState([])
    const [selectedTherapistFilter, setSelectedTherapistFilter] = useState('')
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const PAGE_SIZE = 50

    useEffect(() => {
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        let owner = false
        let branchId = null

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData) {
                owner = userData.role === 'owner'
                setIsOwner(owner)
                setUserBranchId(userData.branch_id)
                setUserRole(userData.role)
                branchId = userData.branch_id
            } else {
                setIsOwner(true)
                owner = true
            }
        }
        setUserLoaded(true)

        // Fetch branches if owner
        if (owner) {
            const { data: branchData } = await supabase.from('branches').select('id, name').order('name')
            if (branchData) setBranches(branchData)
        }

        // Fetch active therapists for filtering
        let thQuery = supabase.from('users').select('id, full_name, branch_id').eq('role', 'therapist').eq('is_active', true)
        if (!owner && branchId) {
            thQuery = thQuery.eq('branch_id', branchId)
        }
        const { data: thData } = await thQuery.order('full_name')
        if (thData) setTherapists(thData)
    }

    // Debounce search input
    useEffect(() => {
        const handler = setTimeout(() => {
            setSearchQuery(searchInput)
            setPage(1) // Reset to page 1 on new search
        }, 500)
        return () => clearTimeout(handler)
    }, [searchInput])

    // Reset page whenever filters change
    useEffect(() => {
        setPage(1)
    }, [selectedBranchFilter, selectedTherapistFilter, startDate, endDate])

    useEffect(() => {
        if (userLoaded) {
            fetchRecords()
        }
    }, [userLoaded, selectedBranchFilter, selectedTherapistFilter, startDate, endDate, page, searchQuery])

    const fetchRecords = async () => {
        setLoading(true)

        let query = supabase
            .from('treatment_records')
            .select(`
                id,
                treatment_date,
                treatment_time,
                branch_id,
                branches(name),
                patients!inner(full_name, whatsapp),
                users!treatment_records_performed_by_fkey(full_name),
                therapist:users!treatment_records_therapist_id_fkey(full_name)
            `)
            .order('treatment_date', { ascending: false })
            .order('treatment_time', { ascending: false })
            
        if (!isOwner && userBranchId) {
            query = query.eq('branch_id', userBranchId)
        } else if (isOwner && selectedBranchFilter !== 'all') {
            query = query.eq('branch_id', selectedBranchFilter)
        }

        if (startDate) {
            query = query.gte('treatment_date', startDate)
        }
        if (endDate) {
            query = query.lte('treatment_date', endDate)
        }

        if (selectedTherapistFilter) {
            query = query.eq('therapist_id', selectedTherapistFilter)
        }

        if (searchQuery.trim() !== '') {
            query = query.or(`full_name.ilike.%${searchQuery}%,whatsapp.ilike.%${searchQuery}%`, { foreignTable: 'patients' })
        }

        // Apply range pagination
        const from = (page - 1) * PAGE_SIZE
        const to = page * PAGE_SIZE - 1
        query = query.range(from, to)

        const { data, error } = await query

        if (!error && data) {
            if (page === 1) {
                setRecords(data)
            } else {
                setRecords(prev => [...prev, ...data])
            }
            setHasMore(data.length === PAGE_SIZE)
        }
        setLoading(false)
    }

    // Filter therapists dropdown dynamically based on branch filter if owner
    const filteredTherapists = useMemo(() => {
        if (!isOwner || selectedBranchFilter === 'all') {
            return therapists
        }
        return therapists.filter(t => t.branch_id === selectedBranchFilter)
    }, [therapists, isOwner, selectedBranchFilter])

    const filteredRecords = records

    return (
        <div className="space-y-6">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto flex-wrap">
                    {isOwner && (
                        <select
                            value={selectedBranchFilter}
                            onChange={(e) => {
                                setSelectedBranchFilter(e.target.value)
                                setSelectedTherapistFilter('') // Reset therapist when branch changes
                            }}
                            className="input-ayumi bg-white w-full sm:w-auto text-sm"
                        >
                            <option value="all">Semua Cabang</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    )}
                    <select
                        value={selectedTherapistFilter}
                        onChange={(e) => setSelectedTherapistFilter(e.target.value)}
                        className="input-ayumi bg-white w-full sm:w-auto text-sm"
                    >
                        <option value="">Semua Terapis</option>
                        {filteredTherapists.map(t => (
                            <option key={t.id} value={t.id}>{t.full_name}</option>
                        ))}
                    </select>
                    <div className="w-full sm:w-[290px] relative z-20">
                        <DateRangePicker 
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(range) => {
                                setStartDate(range.startDate);
                                setEndDate(range.endDate);
                            }}
                            inputClassName="w-full input-ayumi bg-white text-sm"
                        />
                    </div>
                    {(startDate || endDate || selectedTherapistFilter || (isOwner && selectedBranchFilter !== 'all')) && (
                        <button 
                            onClick={() => {
                                setStartDate('')
                                setEndDate('')
                                setSelectedTherapistFilter('')
                                setSelectedBranchFilter('all')
                            }}
                            className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-2 whitespace-nowrap"
                        >
                            Reset Filter
                        </button>
                    )}
                </div>
                
                {/* Search Bar */}
                <div className="relative w-full sm:w-72 xl:ml-auto">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                    <input 
                        type="text" 
                        placeholder="Cari pasien atau WA..."
                        className="input-ayumi bg-white w-full pl-10 text-sm"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>
            </div>

            {page === 1 && loading ? (
                <div className="flex justify-center p-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary"></div>
                </div>
            ) : (
                <div className="card-ayumi overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-sm text-left text-gray-600">
                            <thead className="text-xs text-ayumi-secondary uppercase bg-ayumi-table-header font-bold">
                                <tr>
                                    <th className="px-6 py-4">Waktu & Cabang</th>
                                    <th className="px-6 py-4">Pasien</th>
                                    <th className="px-6 py-4">Ditangani Oleh</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRecords.length > 0 ? (
                                    filteredRecords.map((r) => (
                                        <tr key={r.id} className="bg-white border-b border-gray-50 hover:bg-ayumi-table-hover transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">
                                                    {new Date(r.treatment_date).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}
                                                </div>
                                                <div className="text-xs text-gray-500 font-semibold mt-1">
                                                    {r.treatment_time?.substring(0,5) || '-'} • {r.branches?.name || 'Pusat'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{r.patients?.full_name}</div>
                                                <div className="text-xs text-gray-500">{r.patients?.whatsapp}</div>
                                            </td>
                                            <td className="px-6 py-4 font-semibold text-gray-700">
                                                <div className="text-sm text-gray-800">Terapis: {r.therapist?.full_name || '-'}</div>
                                                <div className="text-xs text-gray-500 mt-1">Admin: {r.users?.full_name || '-'}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Link href={`/treatment-records/${r.id}`}>
                                                        <button className="text-xs bg-pink-50 text-ayumi-primary border border-transparent hover:border-ayumi-primary hover:bg-pink-100 px-3 py-2 rounded-lg font-bold transition-colors">
                                                            Lihat Detail
                                                        </button>
                                                    </Link>
                                                    {(isOwner || userRole === 'admin') && (
                                                        <Link href={`/kasir?pendingRecordId=${r.id}`}>
                                                            <button className="text-xs bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white px-3 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                                                Kasir
                                                            </button>
                                                        </Link>
                                                    )}
                                                    {r.patients?.whatsapp && (() => {
                                                        let waNumber = r.patients.whatsapp.replace(/[^0-9]/g, '');
                                                        if (waNumber.startsWith('0')) {
                                                            waNumber = '62' + waNumber.substring(1);
                                                        }
                                                        return (
                                                            <a 
                                                                href={`https://wa.me/${waNumber}`} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer" 
                                                                className="text-xs bg-green-50 text-green-700 border border-transparent hover:border-green-600 hover:bg-green-100 px-3 py-2 rounded-lg font-bold transition-colors"
                                                            >
                                                                Chat WA
                                                            </a>
                                                        );
                                                    })()}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center flex flex-col items-center border-none">
                                            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4 mx-auto">
                                                <svg className="w-8 h-8 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">Tidak ada data rekam medis.</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {hasMore && (
                <div className="flex justify-center mt-4">
                    <button 
                        onClick={() => setPage(prev => prev + 1)}
                        disabled={loading}
                        className="btn-secondary px-8 py-2.5 font-bold flex items-center gap-2"
                    >
                        {loading ? (
                            <>
                                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
                                Memuat...
                            </>
                        ) : (
                            'Muat Lebih Banyak'
                        )}
                    </button>
                </div>
            )}
        </div>
    )
}
