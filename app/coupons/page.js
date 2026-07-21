'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import DateRangePicker from "../../components/DateRangePicker"

export default function CouponsDashboardPage() {
    const [activeTab, setActiveTab] = useState('master') // 'master', 'patients', 'usage', 'history'
    const [isLoading, setIsLoading] = useState(false)
    const [dbUser, setDbUser] = useState(null)
    const [userLoaded, setUserLoaded] = useState(false)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    useEffect(() => {
        fetchUser()
    }, [])

    const fetchUser = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (data) setDbUser(data)
        }
        setUserLoaded(true)
    }

    // --- STATES FOR TAB 1: MASTER PAKET ---
    const [packages, setPackages] = useState([])
    const [masterCategoryFilter, setMasterCategoryFilter] = useState('')

    // --- STATES FOR TAB 2: KUPON PASIEN ---
    const [patientCoupons, setPatientCoupons] = useState([])
    const [pcSearchQuery, setPcSearchQuery] = useState('')
    const [pcStatusFilter, setPcStatusFilter] = useState('')
    const [expandedCouponId, setExpandedCouponId] = useState(null)

    // --- STATES FOR TAB 3: PENGGUNAAN KUPON ---
    const [usageSearchPatient, setUsageSearchPatient] = useState('')
    const [usagePatients, setUsagePatients] = useState([])
    const [usageSelectedPatient, setUsageSelectedPatient] = useState(null)
    const [usageActiveCoupons, setUsageActiveCoupons] = useState([])
    const [usageSelectedCouponItem, setUsageSelectedCouponItem] = useState(null)
    const [usageNotes, setUsageNotes] = useState('')
    const [isProcessingUsage, setIsProcessingUsage] = useState(false)
    const [editExpiryModal, setEditExpiryModal] = useState({ isOpen: false, coupon: null, newDate: '' })

    // --- STATES FOR TAB 4: RIWAYAT PENGGUNAAN ---
    const [historyLogs, setHistoryLogs] = useState([])
    const [histStartDate, setHistStartDate] = useState(new Date().toISOString().split('T')[0])
    const [histEndDate, setHistEndDate] = useState(new Date().toISOString().split('T')[0])
    const [histBranchFilter, setHistBranchFilter] = useState('')
    const [branches, setBranches] = useState([])

    useEffect(() => {
        if (!userLoaded) return
        if (activeTab === 'master') fetchPackages()
        else if (activeTab === 'patients') fetchPatientCoupons()
        else if (activeTab === 'history') fetchHistoryLogs()
        
        if (activeTab === 'history' && branches.length === 0) fetchBranches()
    }, [activeTab, userLoaded, dbUser])

    const fetchBranches = async () => {
        const { data } = await supabase.from('branches').select('id, name')
        if (data) setBranches(data)
    }

    // --- TAB 1: MASTER PAKET LOGIC ---
    const fetchPackages = async () => {
        setIsLoading(true)
        const { data } = await supabase
            .from('coupon_packages')
            .select(`
                *,
                coupon_package_items (
                    id, quantity,
                    treatments (id, name)
                )
            `)
            .order('name')
        
        if (data) setPackages(data)
        setIsLoading(false)
    }

    const togglePackageStatus = async (pkg) => {
        if (dbUser?.role !== 'owner') {
            alert('Akses Ditolak: Hanya Owner yang bisa mengaktifkan/menonaktifkan paket.')
            return
        }
        const { error } = await supabase
            .from('coupon_packages')
            .update({ is_active: !pkg.is_active })
            .eq('id', pkg.id)
        if (!error) fetchPackages()
    }

    const filteredPackages = packages.filter(p => !masterCategoryFilter || p.category === masterCategoryFilter)
    const categories = [...new Set(packages.map(p => p.category).filter(Boolean))]

    const fetchPatientCoupons = async () => {
        setIsLoading(true)
        
        let query = supabase
            .from('patient_coupons')
            .select(`
                *,
                patients (full_name, whatsapp),
                coupon_packages (name),
                patient_coupon_items (
                    id, total_sessions, used_sessions, remaining_sessions, status,
                    treatments (name)
                )
            `)
            .order('purchased_at', { ascending: false })

        const { data } = await query
        if (data) setPatientCoupons(data)
        setIsLoading(false)
    }

    const filteredPatientCoupons = patientCoupons.filter(pc => {
        const matchSearch = !pcSearchQuery || pc.patients?.full_name?.toLowerCase().includes(pcSearchQuery.toLowerCase()) || pc.patients?.whatsapp?.includes(pcSearchQuery)
        const matchStatus = !pcStatusFilter || pc.status === pcStatusFilter
        return matchSearch && matchStatus
    })

    useEffect(() => {
        if (!userLoaded) return
        if (activeTab === 'usage' && usageSearchPatient.length >= 2 && !usageSelectedPatient) {
            const searchPts = async () => {
                let pQuery = supabase
                    .from('patients')
                    .select('id, full_name, whatsapp')
                    .or(`full_name.ilike.%${usageSearchPatient}%,whatsapp.ilike.%${usageSearchPatient}%`)
                    
                if (dbUser && dbUser.role !== 'owner' && dbUser.branch_id) {
                    pQuery = pQuery.eq('branch_id', dbUser.branch_id)
                }

                const { data } = await pQuery.limit(5)
                if (data) setUsagePatients(data)
            }
            searchPts()
        } else if (usageSearchPatient.length < 2) {
            setUsagePatients([])
        }
    }, [usageSearchPatient, userLoaded, dbUser])

    const selectPatientForUsage = async (patient) => {
        setUsageSelectedPatient(patient)
        setUsageSearchPatient('')
        setUsagePatients([])
        
        // Fetch active coupons for this patient
        setIsLoading(true)
        const { data } = await supabase
            .from('patient_coupons')
            .select(`
                *,
                coupon_packages (name),
                patient_coupon_items (
                    id, total_sessions, used_sessions, remaining_sessions, status,
                    treatments (id, name)
                )
            `)
            .eq('patient_id', patient.id)
            .eq('status', 'active')
            .gt('expired_at', new Date().toISOString())
            
        if (data) setUsageActiveCoupons(data)
        setIsLoading(false)
    }

    const handleUseCoupon = async () => {
        if (!usageSelectedCouponItem) return
        setIsProcessingUsage(true)

        try {
            // 1. Log the usage
            const { error: logError } = await supabase.from('coupon_usage_logs').insert([{
                patient_coupon_item_id: usageSelectedCouponItem.item.id,
                patient_id: usageSelectedPatient.id,
                branch_id: dbUser?.branch_id || null, // Might be null for owner
                used_by: dbUser?.id,
                notes: usageNotes
            }])
            if (logError) throw logError

            // 2. Update patient_coupon_items (decrease remaining, increase used)
            const newRemaining = usageSelectedCouponItem.item.remaining_sessions - 1
            const newUsed = usageSelectedCouponItem.item.used_sessions + 1
            const newItemStatus = newRemaining === 0 ? 'fully_used' : 'active'

            const { error: updateItemError } = await supabase
                .from('patient_coupon_items')
                .update({ 
                    remaining_sessions: newRemaining,
                    used_sessions: newUsed,
                    status: newItemStatus
                })
                .eq('id', usageSelectedCouponItem.item.id)
            if (updateItemError) throw updateItemError

            // 3. Check if all items in the coupon are fully used
            const { data: allItems } = await supabase
                .from('patient_coupon_items')
                .select('status')
                .eq('patient_coupon_id', usageSelectedCouponItem.coupon.id)
            
            const allFullyUsed = allItems.every(i => i.status === 'fully_used')
            if (allFullyUsed) {
                await supabase
                    .from('patient_coupons')
                    .update({ status: 'fully_used' })
                    .eq('id', usageSelectedCouponItem.coupon.id)
            }

            alert('Kupon berhasil digunakan!')
            
            // Refresh
            setUsageSelectedCouponItem(null)
            setUsageNotes('')
            selectPatientForUsage(usageSelectedPatient) // re-fetch

        } catch (err) {
            console.error(err)
            alert('Gagal menggunakan kupon: ' + err.message)
        } finally {
            setIsProcessingUsage(false)
        }
    }

    const handleUpdateExpiry = async () => {
        if (!editExpiryModal.newDate || !editExpiryModal.coupon) return
        
        setIsLoading(true)
        const { error } = await supabase
            .from('patient_coupons')
            .update({ expired_at: new Date(editExpiryModal.newDate).toISOString() })
            .eq('id', editExpiryModal.coupon.id)
            
        setIsLoading(false)
        if (error) {
            alert('Gagal update tanggal expired: ' + error.message)
        } else {
            alert('Tanggal expired berhasil diperbarui!')
            setEditExpiryModal({ isOpen: false, coupon: null, newDate: '' })
            if (activeTab === 'patients') fetchPatientCoupons()
            if (activeTab === 'usage' && usageSelectedPatient) selectPatientForUsage(usageSelectedPatient)
        }
    } // --- TAB 4: RIWAYAT PENGGUNAAN LOGIC ---
    const fetchHistoryLogs = async () => {
        setIsLoading(true)
        
        let query = supabase
            .from('coupon_usage_logs')
            .select(`
                *,
                patients (full_name, whatsapp),
                patient_coupon_items (
                    treatments (name),
                    patient_coupons (
                        coupon_packages (name)
                    )
                ),
                branches (name),
                users (full_name)
            `)
            .order('used_at', { ascending: false })

        if (histStartDate) query = query.gte('used_at', `${histStartDate}T00:00:00Z`)
        if (histEndDate) query = query.lte('used_at', `${histEndDate}T23:59:59Z`)
        
        if (dbUser && dbUser.role !== 'owner' && dbUser.branch_id) {
            query = query.eq('branch_id', dbUser.branch_id)
        } else if (histBranchFilter) {
            query = query.eq('branch_id', histBranchFilter)
        }

        const { data, error } = await query
        if (error) console.error('Error fetching history logs:', error)
        if (data) setHistoryLogs(data)
        setIsLoading(false)
    }

    useEffect(() => {
        if (!userLoaded) return
        if (activeTab === 'history') fetchHistoryLogs()
    }, [histStartDate, histEndDate, histBranchFilter, userLoaded, dbUser])

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric'
        })
    }

    const formatDateTime = (isoString) => {
        return new Date(isoString).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
    }

    if (!userLoaded) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memeriksa Hak Akses...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {activeTab === 'master' && dbUser?.role === 'owner' && (
                <div className="flex justify-end mb-4">
                    <Link href="/coupons/packages/new">
                        <button className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm justify-center shadow-pink-500/30 shadow-lg cursor-pointer">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            Tambah Paket Baru
                        </button>
                    </Link>
                </div>
            )}

            {/* Tabs Header */}
            <div className="flex overflow-x-auto border-b border-gray-200 hide-scrollbar">
                {[
                    { id: 'master', label: 'Paket Kupon (Master)' },
                    { id: 'patients', label: 'Kupon Pasien' },
                    { id: 'usage', label: 'Penggunaan Kupon' },
                    { id: 'history', label: 'Riwayat Penggunaan' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-6 py-3 text-sm font-semibold whitespace-nowrap transition-all border-b-2 ${activeTab === tab.id ? 'border-ayumi-primary text-ayumi-primary bg-pink-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* TAB 1: MASTER PAKET */}
            {activeTab === 'master' && (
                <div className="space-y-4">
                    <div className="flex justify-end mb-4">
                        <select 
                            value={masterCategoryFilter} 
                            onChange={(e) => setMasterCategoryFilter(e.target.value)}
                            className="input-ayumi bg-white w-48 text-sm"
                        >
                            <option value="">Semua Kategori</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    {isLoading ? (
                        <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat data paket...</div>
                    ) : filteredPackages.length === 0 ? (
                        <div className="card-ayumi p-10 text-center text-gray-500">Belum ada paket kupon yang ditambahkan.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredPackages.map(pkg => (
                                <div key={pkg.id} className={`card-ayumi overflow-hidden flex flex-col ${!pkg.is_active ? 'opacity-70 bg-gray-50' : ''}`}>
                                    <div className="p-5 border-b border-gray-100 flex-1">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">
                                                {pkg.category || 'Tanpa Kategori'}
                                            </span>
                                            <button 
                                                onClick={() => togglePackageStatus(pkg)}
                                                disabled={dbUser?.role !== 'owner'}
                                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pkg.is_active ? 'bg-ayumi-primary' : 'bg-gray-300'} ${dbUser?.role !== 'owner' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pkg.is_active ? 'translate-x-4.5' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                        <h3 className="text-lg font-bold text-gray-800 mb-1">{pkg.name}</h3>
                                        <p className="text-xl font-extrabold text-ayumi-primary  mb-4">Rp {pkg.price.toLocaleString('id-ID')}</p>
                                        
                                        <div className="space-y-2 mt-4">
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Isi Paket:</p>
                                            {pkg.coupon_package_items?.map(item => (
                                                <div key={item.id} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded-lg">
                                                    <span className="text-gray-700 font-medium">{item.treatments?.name}</span>
                                                    <span className=" font-bold text-ayumi-secondary">{item.quantity}x</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 p-3 flex justify-between items-center border-t border-gray-100">
                                        <span className="text-xs text-gray-400">{pkg.is_active ? 'Aktif' : 'Nonaktif'}</span>
                                        {dbUser?.role === 'owner' && (
                                            <Link href={`/coupons/packages/${pkg.id}`}>
                                                <button className="text-sm font-semibold text-ayumi-primary hover:text-ayumi-secondary">Edit Paket</button>
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: KUPON PASIEN */}
            {activeTab === 'patients' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4 mb-4">
                        <input 
                            type="text" 
                            placeholder="Cari nama pasien..." 
                            value={pcSearchQuery}
                            onChange={(e) => setPcSearchQuery(e.target.value)}
                            className="input-ayumi bg-white flex-1"
                        />
                        <select 
                            value={pcStatusFilter}
                            onChange={(e) => setPcStatusFilter(e.target.value)}
                            className="input-ayumi bg-white w-full sm:w-48"
                        >
                            <option value="">Semua Status</option>
                            <option value="active">Active</option>
                            <option value="expired">Expired</option>
                            <option value="fully_used">Fully Used</option>
                        </select>
                    </div>

                    <div className="card-ayumi overflow-hidden">
                        {isLoading ? (
                            <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat kupon pasien...</div>
                        ) : filteredPatientCoupons.length === 0 ? (
                            <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada kupon yang ditemukan.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="whitespace-nowrap w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                            <th className="p-4 font-semibold">Pasien</th>
                                            <th className="p-4 font-semibold">Paket</th>
                                            <th className="p-4 font-semibold">Tgl Beli</th>
                                            <th className="p-4 font-semibold">Expired</th>
                                            <th className="p-4 font-semibold text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-sm">
                                        {filteredPatientCoupons.map((pc) => {
                                            const isExpanded = expandedCouponId === pc.id
                                            let badgeClass = "bg-gray-100 text-gray-700"
                                            if (pc.status === 'active') badgeClass = "bg-green-100 text-green-700"
                                            else if (pc.status === 'expired') badgeClass = "bg-red-100 text-red-700"

                                            return (
                                                <React.Fragment key={pc.id}>
                                                    <tr 
                                                        onClick={() => setExpandedCouponId(isExpanded ? null : pc.id)}
                                                        className={`hover:bg-ayumi-table-hover transition-colors cursor-pointer ${isExpanded ? 'bg-pink-50/30' : ''}`}
                                                    >
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-800">{pc.patients?.full_name}</div>
                                                            <div className="text-xs text-gray-500">{pc.patients?.whatsapp}</div>
                                                        </td>
                                                        <td className="p-4 font-semibold text-ayumi-primary">{pc.coupon_packages?.name}</td>
                                                        <td className="p-4 text-gray-600">{formatDate(pc.purchased_at)}</td>
                                                        <td className="p-4 text-gray-600">
                                                            <div className="flex items-center gap-2">
                                                                <span>{formatDate(pc.expired_at)}</span>
                                                                <button onClick={(e) => { e.stopPropagation(); setEditExpiryModal({ isOpen: true, coupon: pc, newDate: new Date(pc.expired_at).toISOString().split('T')[0] }) }} className="text-ayumi-primary hover:text-ayumi-secondary" title="Edit Tanggal Expired">
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                                </button>
                                                            </div>
                                                            {new Date(pc.expired_at) < new Date() && pc.status === 'active' && (
                                                                <div className="text-xs text-red-500 font-bold mt-1">(Expired!)</div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                                                                {pc.status.replace('_', ' ')}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="bg-gray-50">
                                                            <td colSpan="5" className="p-4">
                                                                <div className="pl-4 border-l-2 border-pink-300 py-1">
                                                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Detail Sesi Kupon</p>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                        {pc.patient_coupon_items?.map(item => {
                                                                            const percent = (item.used_sessions / item.total_sessions) * 100
                                                                            return (
                                                                                <div key={item.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                                                                                    <div className="flex justify-between text-sm mb-1">
                                                                                        <span className="font-semibold text-gray-700">{item.treatments?.name}</span>
                                                                                        <span className=" text-xs font-bold text-ayumi-primary">{item.remaining_sessions} / {item.total_sessions} tersisa</span>
                                                                                    </div>
                                                                                    <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                                                                                        <div className="bg-gradient-to-r from-ayumi-primary to-ayumi-secondary h-2 rounded-full" style={{ width: `${percent}%` }}></div>
                                                                                    </div>
                                                                                    <div className="text-[10px] text-gray-400 text-right">Terpakai: {item.used_sessions} sesi</div>
                                                                                </div>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: PENGGUNAAN KUPON */}
            {activeTab === 'usage' && (
                <div className="flex flex-col lg:flex-row gap-6">
                    {/* Left Pane: Search & Select */}
                    <div className="w-full lg:w-1/3 space-y-4">
                        <div className="card-ayumi p-5">
                            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                Cari Pasien
                            </h3>
                            {!usageSelectedPatient ? (
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Ketik Nama atau No WA..."
                                        value={usageSearchPatient}
                                        onChange={(e) => setUsageSearchPatient(e.target.value)}
                                        className="input-ayumi w-full bg-gray-50"
                                    />
                                    {usagePatients.length > 0 && (
                                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 shadow-xl rounded-xl max-h-60 overflow-y-auto">
                                            {usagePatients.map(p => (
                                                <div 
                                                    key={p.id} 
                                                    onClick={() => selectPatientForUsage(p)}
                                                    className="px-4 py-3 hover:bg-pink-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors"
                                                >
                                                    <p className="font-bold text-gray-800">{p.full_name}</p>
                                                    <p className="text-xs text-gray-500">{p.whatsapp}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-pink-50/50 border border-pink-100 p-4 rounded-xl flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-ayumi-primary">{usageSelectedPatient.full_name}</p>
                                        <p className="text-xs text-gray-500">{usageSelectedPatient.whatsapp}</p>
                                    </div>
                                    <button 
                                        onClick={() => { setUsageSelectedPatient(null); setUsageActiveCoupons([]); setUsageSelectedCouponItem(null); }}
                                        className="text-gray-400 hover:text-red-500 bg-white p-1.5 rounded-full shadow-sm"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Pane: Active Coupons & Form */}
                    <div className="w-full lg:w-2/3">
                        {!usageSelectedPatient ? (
                            <div className="card-ayumi p-16 flex flex-col items-center justify-center text-center">
                                <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center mb-4">
                                    <svg className="w-10 h-10 text-pink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                                </div>
                                <h3 className="text-xl font-bold text-gray-700 mb-2">Pilih Pasien Terlebih Dahulu</h3>
                                <p className="text-gray-500 max-w-md">Cari pasien untuk melihat daftar kupon aktif yang mereka miliki dan melakukan klaim sesi perawatan.</p>
                            </div>
                        ) : isLoading ? (
                            <div className="card-ayumi p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat kupon...</div>
                        ) : (
                            <div className="space-y-4">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    Kupon Aktif Milik <span className="text-ayumi-primary">{usageSelectedPatient.full_name}</span>
                                </h3>
                                
                                {usageActiveCoupons.length === 0 ? (
                                    <div className="card-ayumi p-5 md:p-8 text-center text-red-500 bg-red-50 border border-red-100">
                                        Pasien ini tidak memiliki kupon aktif yang bisa digunakan.
                                    </div>
                                ) : (
                                    <div className="grid gap-4">
                                        {usageActiveCoupons.map(coupon => {
                                            // Warn if expires in <= 7 days
                                            const daysUntilExpiry = Math.ceil((new Date(coupon.expired_at) - new Date()) / (1000 * 60 * 60 * 24))
                                            const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry >= 0

                                            return (
                                                <div key={coupon.id} className={`card-ayumi overflow-hidden border-2 ${isExpiringSoon ? 'border-red-300' : 'border-transparent'}`}>
                                                    <div className={`p-3 text-white flex justify-between items-center ${isExpiringSoon ? 'bg-red-500' : 'bg-gradient-to-r from-ayumi-primary to-ayumi-secondary'}`}>
                                                        <div className="font-bold">{coupon.coupon_packages?.name}</div>
                                                        <div className="text-xs bg-white/20 px-2 py-1 rounded-lg flex items-center gap-2">
                                                            <span>{isExpiringSoon ? `Expired dalam ${daysUntilExpiry} hari!` : `Exp: ${formatDate(coupon.expired_at)}`}</span>
                                                            <button onClick={(e) => { e.stopPropagation(); setEditExpiryModal({ isOpen: true, coupon: coupon, newDate: new Date(coupon.expired_at).toISOString().split('T')[0] }) }} className="hover:text-white/80 transition-colors bg-white/20 p-1 rounded" title="Edit Tanggal Expired">
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="p-4 bg-white space-y-3">
                                                        {coupon.patient_coupon_items?.map(item => {
                                                            if (item.status === 'fully_used' || item.remaining_sessions === 0) return null
                                                            
                                                            const isSelected = usageSelectedCouponItem?.item.id === item.id
                                                            return (
                                                                <div 
                                                                    key={item.id} 
                                                                    onClick={() => setUsageSelectedCouponItem({ coupon, item })}
                                                                    className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-ayumi-primary bg-pink-50' : 'border-gray-100 hover:border-pink-200'}`}
                                                                >
                                                                    <div>
                                                                        <p className={`font-bold ${isSelected ? 'text-ayumi-primary' : 'text-gray-800'}`}>{item.treatments?.name}</p>
                                                                        <p className="text-xs text-gray-500 mt-1">Sisa sesi: <span className=" font-bold text-gray-800">{item.remaining_sessions}</span></p>
                                                                    </div>
                                                                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-ayumi-primary bg-ayumi-primary text-white' : 'border-gray-300'}`}>
                                                                        {isSelected && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}

                                {/* Action Form */}
                                {usageSelectedCouponItem && (
                                    <div className="card-ayumi p-5 border-2 border-ayumi-primary/30 mt-6 bg-pink-50/20 shadow-lg">
                                        <h4 className="font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Konfirmasi Penggunaan Kupon</h4>
                                        
                                        <div className="bg-white p-4 rounded-xl border border-gray-100 mb-4">
                                            <p className="text-sm text-gray-600 mb-1">Anda akan menggunakan <strong>1 sesi</strong> untuk:</p>
                                            <p className="text-lg font-extrabold text-ayumi-primary">{usageSelectedCouponItem.item.treatments?.name}</p>
                                            <p className="text-xs text-gray-500 mt-2">Dari paket: {usageSelectedCouponItem.coupon.coupon_packages?.name}</p>
                                        </div>

                                        <div className="mb-4">
                                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Catatan Tambahan (Opsional)</label>
                                            <textarea
                                                value={usageNotes}
                                                onChange={(e) => setUsageNotes(e.target.value)}
                                                className="input-ayumi bg-white w-full h-20 resize-none"
                                                placeholder="Contoh: Klaim sesi ke-2, ditangani oleh Terapis Siska"
                                            ></textarea>
                                        </div>

                                        <div className="flex gap-3 justify-end">
                                            <button 
                                                onClick={() => setUsageSelectedCouponItem(null)}
                                                className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                                            >
                                                Batal
                                            </button>
                                            <button 
                                                onClick={handleUseCoupon}
                                                disabled={isProcessingUsage}
                                                className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-ayumi-primary to-ayumi-secondary hover:shadow-lg rounded-xl transition-all disabled:opacity-70 flex items-center gap-2"
                                            >
                                                {isProcessingUsage ? 'Memproses...' : 'Gunakan 1 Sesi Sekarang'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 4: RIWAYAT PENGGUNAAN */}
            {activeTab === 'history' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                        <div className="col-span-1 sm:col-span-2 flex flex-col relative z-20">
                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Rentang Tanggal</label>
                            <DateRangePicker 
                                startDate={histStartDate}
                                endDate={histEndDate}
                                onChange={(range) => {
                                    setHistStartDate(range.startDate);
                                    setHistEndDate(range.endDate);
                                }}
                                inputClassName="w-full input-ayumi bg-gray-50 text-sm"
                            />
                        </div>
                        {(!dbUser || dbUser.role === 'owner') && (
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Cabang</label>
                                <select
                                    value={histBranchFilter}
                                    onChange={(e) => setHistBranchFilter(e.target.value)}
                                    className="input-ayumi bg-gray-50 text-sm w-full"
                                >
                                    <option value="">Semua Cabang</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="card-ayumi overflow-hidden">
                        {isLoading ? (
                            <div className="p-5 md:p-8 text-center text-gray-500 animate-pulse">Memuat riwayat...</div>
                        ) : historyLogs.length === 0 ? (
                            <div className="p-5 md:p-8 text-center text-gray-500">Tidak ada riwayat penggunaan kupon pada periode ini.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="whitespace-nowrap w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-ayumi-table-header border-b border-gray-100 text-ayumi-secondary text-sm">
                                            <th className="p-4 font-semibold">Tanggal & Waktu</th>
                                            <th className="p-4 font-semibold">Pasien</th>
                                            <th className="p-4 font-semibold">Treatment (Klaim)</th>
                                            <th className="p-4 font-semibold">Paket Asal</th>
                                            <th className="p-4 font-semibold">Cabang</th>
                                            <th className="p-4 font-semibold">Diproses Oleh</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-sm">
                                        {historyLogs.map((log) => (
                                            <tr key={log.id} className="hover:bg-ayumi-table-hover transition-colors">
                                                <td className="p-4 text-gray-600  text-xs">{formatDateTime(log.used_at || log.created_at)}</td>
                                                <td className="p-4 font-bold text-gray-800">{log.patients?.full_name}</td>
                                                <td className="p-4 font-semibold text-ayumi-primary">{log.patient_coupon_items?.treatments?.name}</td>
                                                <td className="p-4 text-gray-600 text-xs">{log.patient_coupon_items?.patient_coupons?.coupon_packages?.name}</td>
                                                <td className="p-4 text-gray-600">{log.branches?.name || '-'}</td>
                                                <td className="p-4 text-gray-600 text-xs">{log.users?.full_name || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Edit Expired Date */}
            {editExpiryModal.isOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-4 md:p-6 w-full max-w-sm shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Edit Tanggal Expired</h3>
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Tanggal Expired Baru</label>
                            <input
                                type="date"
                                className="w-full input-ayumi"
                                value={editExpiryModal.newDate}
                                onChange={(e) => setEditExpiryModal({ ...editExpiryModal, newDate: e.target.value })}
                            />
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setEditExpiryModal({ isOpen: false, coupon: null, newDate: '' })}
                                className="px-4 py-2 text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleUpdateExpiry}
                                disabled={isLoading || !editExpiryModal.newDate}
                                className="btn-ayumi px-4 py-2 text-sm"
                            >
                                {isLoading ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
