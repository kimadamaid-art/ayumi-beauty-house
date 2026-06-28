'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { toast } from 'react-hot-toast'

export default function PatientsPage() {
    const [patients, setPatients] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchInput, setSearchInput] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [crmFilter, setCrmFilter] = useState('All')
    const [branchFilter, setBranchFilter] = useState('All')
    const [couponFilter, setCouponFilter] = useState('All')
    const [vipFilter, setVipFilter] = useState('All')
    const [sortBy, setSortBy] = useState('Newest')
    const [branches, setBranches] = useState([])
    const [isOwner, setIsOwner] = useState(false)
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)

    // Excel Import States
    const [showImportModal, setShowImportModal] = useState(false)
    const [importData, setImportData] = useState([])
    const [existingWaList, setExistingWaList] = useState(new Set())
    const [isImporting, setIsImporting] = useState(false)
    const [isLoadingWaList, setIsLoadingWaList] = useState(false)
    const fileInputRef = useRef(null)

    const PAGE_SIZE = 50

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Debounce search input changes
    useEffect(() => {
        const handler = setTimeout(() => {
            setSearchQuery(searchInput)
            setPage(1) // Reset to page 1 on new search
        }, 500)
        return () => clearTimeout(handler)
    }, [searchInput])

    useEffect(() => {
        setPage(1)
    }, [branchFilter])

    useEffect(() => {
        const fetchPatients = async () => {
            setIsLoading(true)

            // Get current user's role and branch
            const { data: { user } } = await supabase.auth.getUser()
            let userBranchId = null
            let isOwner = false

            if (user) {
                const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
                if (userData) {
                    isOwner = userData.role === 'owner'
                    userBranchId = userData.branch_id
                } else {
                    isOwner = true // fallback for unrecorded auth users
                }
            }
            setIsOwner(isOwner)

            if (isOwner && branches.length === 0) {
                const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
                if (brData) setBranches(brData)
            }

            // Fetch patients
            let query = supabase
                .from('patients')
                .select('*, branches(name), treatment_records(treatment_date, branch_id)')
                .order('created_at', { ascending: false })
            
            if (!isOwner && userBranchId) {
                query = query.eq('branch_id', userBranchId)
            } else if (isOwner && branchFilter !== 'All') {
                if (branchFilter === 'pusat') {
                    query = query.is('branch_id', null)
                } else {
                    query = query.eq('branch_id', branchFilter)
                }
            }

            if (searchQuery.trim() !== '') {
                query = query.or(`full_name.ilike.%${searchQuery}%,whatsapp.ilike.%${searchQuery}%`)
            }

            // Apply pagination range
            const from = (page - 1) * PAGE_SIZE
            const to = page * PAGE_SIZE - 1
            query = query.range(from, to)

            const { data, error } = await query
            
            if (!error && data) {
                // Fetch patient coupons in a separate query to prevent crashing if table does not exist
                let couponsMap = {}
                try {
                    const { data: couponsData, error: couponsError } = await supabase
                        .from('patient_coupons')
                        .select('id, patient_id, status')
                    
                    if (!couponsError && couponsData) {
                        couponsData.forEach(c => {
                            if (c.status === 'active') {
                                couponsMap[c.patient_id] = (couponsMap[c.patient_id] || 0) + 1
                            }
                        })
                    }
                } catch (e) {
                    console.error('Error loading patient coupons:', e)
                }

                // Kalkulasi CRM Status dan Last Visit
                const processed = data.map(patient => {
                    let lastVisit = null
                    let crmStatus = 'New'

                    if (patient.treatment_records && patient.treatment_records.length > 0) {
                        // Mencari tanggal terbaru
                        const dates = patient.treatment_records
                            .map(r => new Date(r.treatment_date))
                            .sort((a, b) => b - a)
                        
                        lastVisit = dates[0]
                        
                        const diffTime = Math.abs(new Date() - lastVisit)
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
                        
                        if (diffDays <= 60) crmStatus = 'Active'
                        else if (diffDays <= 90) crmStatus = 'Warm'
                        else crmStatus = 'Dormant'
                    }

                    const activeCouponsCount = couponsMap[patient.id] || 0
                    const totalVisits = patient.treatment_records ? patient.treatment_records.length : 0

                    return {
                        ...patient,
                        lastVisit: lastVisit ? lastVisit.toLocaleDateString('id-ID') : '-',
                        lastVisitDate: lastVisit,
                        totalVisits,
                        crmStatus,
                        activeCouponsCount
                    }
                })

                if (page === 1) {
                    setPatients(processed)
                } else {
                    setPatients(prev => [...prev, ...processed])
                }

                setHasMore(data.length === PAGE_SIZE)
            }
            setIsLoading(false)
        }
        fetchPatients()
    }, [supabase, page, searchQuery, branchFilter])

    // --- EXCEL IMPORT LOGIC ---
    const handleDownloadTemplate = () => {
        const headers = ['full_name', 'whatsapp', 'birth_date', 'gender', 'address', 'instagram', 'skin_type', 'allergies', 'medical_notes', 'notes']
        const ws = XLSX.utils.aoa_to_sheet([headers])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Template_Pasien")
        XLSX.writeFile(wb, "Template_Import_Pasien.xlsx")
    }

    const handleFileUpload = async (e) => {
        const file = e.target.files[0]
        if (!file) return

        setIsLoadingWaList(true)
        const waSet = new Set()
        try {
            let fetchPage = 0
            const fetchPageSize = 1000
            let fetchHasMore = true
            while (fetchHasMore) {
                const { data, error } = await supabase
                    .from('patients')
                    .select('whatsapp')
                    .range(fetchPage * fetchPageSize, (fetchPage + 1) * fetchPageSize - 1)
                
                if (error) throw error
                if (!data || data.length === 0) {
                    fetchHasMore = false
                } else {
                    data.forEach(p => {
                        if (p.whatsapp) {
                            waSet.add(p.whatsapp.replace(/[^0-9]/g, ''))
                        }
                    })
                    if (data.length < fetchPageSize) {
                        fetchHasMore = false
                    } else {
                        fetchPage++
                    }
                }
            }
            setExistingWaList(waSet)
        } catch (err) {
            console.error('Error fetching WA list:', err)
            toast.error("Gagal memvalidasi data duplikat dari server.")
            setIsLoadingWaList(false)
            return
        }
        setIsLoadingWaList(false)

        const reader = new FileReader()
        reader.onload = (evt) => {
            try {
                const bstr = evt.target.result
                const wb = XLSX.read(bstr, { type: 'binary' })
                const wsname = wb.SheetNames[0]
                const ws = wb.Sheets[wsname]
                const data = XLSX.utils.sheet_to_json(ws)
                
                // Process and validate data
                const processedData = data.map((row, index) => {
                    const wa = row.whatsapp ? String(row.whatsapp).replace(/[^0-9]/g, '') : ''
                    const isDuplicate = wa && waSet.has(wa)
                    
                    return {
                        ...row,
                        _isValid: !!row.full_name && !!wa && !isDuplicate,
                        _isDuplicate: isDuplicate,
                        _rowNumber: index + 2 // considering header is row 1
                    }
                })
                
                setImportData(processedData)
                setShowImportModal(true)
            } catch (err) {
                console.error(err)
                toast.error("Gagal membaca file Excel. Pastikan formatnya benar.")
            }
        }
        reader.readAsBinaryString(file)
        e.target.value = null // reset input
    }

    const confirmImport = async () => {
        const validRows = importData.filter(d => d._isValid)
        if (validRows.length === 0) {
            toast.error("Tidak ada data valid yang dapat diimpor.")
            return
        }

        setIsImporting(true)
        try {
            // Get user to attach to created_by if needed
            const { data: { user } } = await supabase.auth.getUser()
            
            // Default branch handling (if owner, maybe let it be null so it acts as Pusat, or get from user)
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user?.id).maybeSingle()
            const userBranchId = userData?.branch_id || null

            const payload = validRows.map(row => ({
                full_name: row.full_name,
                whatsapp: String(row.whatsapp).replace(/[^0-9]/g, ''),
                birth_date: row.birth_date || null,
                gender: row.gender?.toLowerCase() || null,
                address: row.address || null,
                instagram: row.instagram || null,
                skin_type: row.skin_type || null,
                allergies: row.allergies || null,
                medical_notes: row.medical_notes || null,
                notes: row.notes || null,
                branch_id: userBranchId
            }))

            const { error } = await supabase.from('patients').insert(payload)
            if (error) throw error

            const skipCount = importData.length - validRows.length
            toast.success(`Berhasil import ${validRows.length} pasien, Skip ${skipCount} data tidak valid/duplikat.`)
            
            setShowImportModal(false)
            setImportData([])
            
            // Refresh data
            window.location.reload()
            
        } catch (err) {
            console.error(err)
            toast.error("Terjadi kesalahan saat menyimpan data ke server.")
        } finally {
            setIsImporting(false)
        }
    }
    // --------------------------

    const filteredPatients = useMemo(() => {
        let result = patients.filter(p => {
            const matchCRM = crmFilter === 'All' || p.crmStatus === crmFilter
            
            const matchCoupon = couponFilter === 'All' || 
                (couponFilter === 'HasActive' && p.activeCouponsCount > 0)
                
            const matchVip = vipFilter === 'All' ||
                (vipFilter === 'VIP' && p.totalVisits > 5) ||
                (vipFilter === 'Regular' && p.totalVisits <= 5)

            return matchCRM && matchCoupon && matchVip
        })

        if (sortBy === 'LatestVisit') {
            result.sort((a, b) => (b.lastVisitDate?.getTime() || 0) - (a.lastVisitDate?.getTime() || 0))
        } else if (sortBy === 'OldestVisit') {
            result.sort((a, b) => {
                const timeA = a.lastVisitDate?.getTime() || 0
                const timeB = b.lastVisitDate?.getTime() || 0
                if (timeA === 0) return 1
                if (timeB === 0) return -1
                return timeA - timeB
            })
        }

        return result
    }, [patients, crmFilter, couponFilter, vipFilter, sortBy])

    const getCRMStatusBadge = (status) => {
        switch(status) {
            case 'Active': return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">Active</span>
            case 'Warm': return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">Warm</span>
            case 'Dormant': return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">Dormant</span>
            case 'New': return <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold shadow-sm">New</span>
            default: return null
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end gap-3 flex-wrap">
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoadingWaList}
                    className="btn-secondary px-6 py-2 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isLoadingWaList ? (
                        <>
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
                            Memproses...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            Import Excel
                        </>
                    )}
                </button>
                <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                />
                <Link href="/patients/new">
                    <button className="btn-primary px-6 py-2 flex items-center gap-2 cursor-pointer">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                        Tambah Pasien
                    </button>
                </Link>
            </div>

            <div className="card-ayumi overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-white flex flex-col gap-4">
                    {/* Baris 1: Search & Cabang */}
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                        <div className="relative w-full md:w-96">
                            <svg className="w-5 h-5 absolute left-4 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <input 
                                type="text" 
                                placeholder="Cari berdasarkan nama atau no whatsapp..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                className="input-ayumi pl-12 bg-gray-50 focus:bg-white"
                            />
                        </div>
                        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                            {isOwner && (
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <span className="text-sm font-semibold text-ayumi-text-muted whitespace-nowrap">Cabang:</span>
                                    <select 
                                        value={branchFilter}
                                        onChange={(e) => setBranchFilter(e.target.value)}
                                        className="input-ayumi flex-1 bg-gray-50 focus:bg-white text-sm"
                                    >
                                        <option value="All">Semua Cabang</option>
                                        <option value="pusat">Pusat (Tanpa Cabang)</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Baris 2: Advanced Filters (Admin & Owner) */}
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-50">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider w-full md:w-auto mb-1 md:mb-0">Filter Data:</span>
                        
                        <select 
                            value={crmFilter}
                            onChange={(e) => setCrmFilter(e.target.value)}
                            className="input-ayumi py-2 text-sm bg-gray-50 focus:bg-white flex-1 min-w-[140px]"
                        >
                            <option value="All">Semua CRM Status</option>
                            <option value="Active">Active</option>
                            <option value="Warm">Warm</option>
                            <option value="Dormant">Dormant</option>
                            <option value="New">New</option>
                        </select>

                        <select 
                            value={couponFilter}
                            onChange={(e) => setCouponFilter(e.target.value)}
                            className="input-ayumi py-2 text-sm bg-gray-50 focus:bg-white flex-1 min-w-[140px]"
                        >
                            <option value="All">Semua Kupon</option>
                            <option value="HasActive">Punya Kupon Aktif</option>
                        </select>

                        <select 
                            value={vipFilter}
                            onChange={(e) => setVipFilter(e.target.value)}
                            className="input-ayumi py-2 text-sm bg-gray-50 focus:bg-white flex-1 min-w-[150px]"
                        >
                            <option value="All">Semua Kategori (VIP)</option>
                            <option value="VIP">VIP {'>'} 5 Kunjungan</option>
                            <option value="Regular">Regular {'<='} 5 Kunjungan</option>
                        </select>

                        <select 
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="input-ayumi py-2 text-sm bg-gray-50 focus:bg-white flex-1 min-w-[170px]"
                        >
                            <option value="Newest">Pasien Baru</option>
                            <option value="LatestVisit">Kunjungan Terbaru</option>
                            <option value="OldestVisit">Kunjungan Terlama</option>
                        </select>
                    </div>
                </div>

                {page === 1 && isLoading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block animate-spin w-8 h-8 border-4 border-[#B5588A] border-t-transparent rounded-full mb-4"></div>
                        <p className="text-gray-500 font-medium">Memuat data pasien...</p>
                    </div>
                ) : filteredPatients.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                        </div>
                        <p className="text-gray-500 font-medium text-lg">Tidak ada pasien ditemukan.</p>
                        <p className="text-sm text-gray-400 mt-1">Coba sesuaikan kata kunci pencarian atau filter.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary text-sm tracking-wide uppercase font-bold">
                                <tr>
                                    <th className="p-5 font-bold">Nama Pasien</th>
                                    <th className="p-5 font-bold">WhatsApp</th>
                                    <th className="p-5 font-bold">Tgl Lahir</th>
                                    <th className="p-5 font-bold">Cabang</th>
                                    <th className="p-5 font-bold text-center">CRM Status</th>
                                    <th className="p-5 font-bold text-center">Kunjungan Terakhir</th>
                                    <th className="p-5 font-bold text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm bg-white">
                                {filteredPatients.map((p) => (
                                    <tr key={p.id} className="hover:bg-ayumi-table-hover transition-colors group">
                                        <td className="p-5 font-bold text-ayumi-text">
                                            <div>{p.full_name}</div>
                                            {p.activeCouponsCount > 0 && (
                                                <div className="inline-flex items-center gap-1 mt-1 bg-pink-50 text-ayumi-primary text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                                                    {p.activeCouponsCount} Kupon Aktif
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-5 font-medium text-gray-600">{p.whatsapp}</td>
                                        <td className="p-5 text-gray-500">{p.birth_date ? new Date(p.birth_date).toLocaleDateString('id-ID') : '-'}</td>
                                        <td className="p-5 text-gray-600 font-medium">
                                            <span className="bg-purple-50 text-[#6B3A5A] px-3 py-1 rounded-md text-xs font-bold">
                                                {p.branches?.name || 'Pusat'}
                                            </span>
                                            {p.treatment_records && new Set(p.treatment_records.map(r => r.branch_id).filter(Boolean)).size > 1 && (
                                                <span className="ml-2 bg-blue-50 text-blue-600 px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap">
                                                    (Multi Cabang)
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-5 text-center">
                                            {getCRMStatusBadge(p.crmStatus)}
                                        </td>
                                        <td className="p-5 text-center text-gray-500 font-medium">{p.lastVisit}</td>
                                        <td className="p-5 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <Link href={`/patients/${p.id}`}>
                                                    <button className="text-ayumi-primary hover:text-ayumi-primary-hover bg-pink-50 hover:bg-pink-100 px-3 py-1.5 rounded-lg transition-colors font-bold text-xs uppercase tracking-wider">
                                                        Detail
                                                    </button>
                                                </Link>
                                                <Link href={`/patients/${p.id}/edit`}>
                                                    <button className="text-xs bg-gray-50 text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors font-bold uppercase tracking-wider border border-transparent hover:border-gray-200">
                                                        Edit
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

            {hasMore && (
                <div className="flex justify-center mt-4">
                    <button 
                        onClick={() => setPage(prev => prev + 1)}
                        disabled={isLoading}
                        className="btn-secondary px-8 py-2.5 font-bold flex items-center gap-2"
                    >
                        {isLoading ? (
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

            {/* MODAL IMPORT EXCEL */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Preview Import Excel</h3>
                                <p className="text-sm text-gray-500 mt-1">Total {importData.length} baris terbaca. Menampilkan maksimal 5 baris pertama.</p>
                            </div>
                            <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1">
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-sm font-semibold text-gray-600">Pastikan kolom sesuai dengan header format sistem.</span>
                                <button onClick={handleDownloadTemplate} className="text-sm text-blue-600 hover:text-blue-800 font-bold underline flex items-center gap-1">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    Download Template
                                </button>
                            </div>
                            
                            <div className="border rounded-xl overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-100 text-gray-700">
                                        <tr>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">Nama</th>
                                            <th className="p-3">WhatsApp</th>
                                            <th className="p-3">Tgl Lahir</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {importData.slice(0, 5).map((row, idx) => (
                                            <tr key={idx} className={!row._isValid ? 'bg-red-50' : 'bg-white'}>
                                                <td className="p-3">
                                                    {row._isDuplicate ? (
                                                        <span className="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">Skip (WA Duplikat)</span>
                                                    ) : !row.full_name || !row.whatsapp ? (
                                                        <span className="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">Skip (Data Tidak Lengkap)</span>
                                                    ) : (
                                                        <span className="text-green-600 font-bold text-xs bg-green-100 px-2 py-1 rounded">Valid</span>
                                                    )}
                                                </td>
                                                <td className="p-3 font-medium">{row.full_name || '-'}</td>
                                                <td className="p-3">{row.whatsapp || '-'}</td>
                                                <td className="p-3">{row.birth_date || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            
                            {importData.length > 5 && (
                                <p className="text-center text-xs text-gray-500 mt-3 font-medium italic">... dan {importData.length - 5} baris lainnya.</p>
                            )}
                            
                            <div className="mt-6 bg-blue-50 border border-blue-100 p-4 rounded-xl">
                                <h4 className="font-bold text-blue-800 mb-1">Ringkasan Eksekusi</h4>
                                <ul className="text-sm text-blue-700 space-y-1 list-disc ml-4">
                                    <li><strong>{importData.filter(d => d._isValid).length} data</strong> akan disimpan ke database.</li>
                                    <li><strong>{importData.filter(d => !d._isValid).length} data</strong> akan diabaikan karena duplikat atau tidak valid.</li>
                                </ul>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
                            <button onClick={() => setShowImportModal(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors">
                                Batal
                            </button>
                            <button 
                                onClick={confirmImport} 
                                disabled={isImporting || importData.filter(d => d._isValid).length === 0}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isImporting ? (
                                    <>
                                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                                        Menyimpan...
                                    </>
                                ) : (
                                    <>Konfirmasi Import</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
