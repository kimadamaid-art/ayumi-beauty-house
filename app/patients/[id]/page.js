'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'

export default function PatientDetailPage() {
    const params = useParams()
    const router = useRouter()
    const id = params.id

    const [activeTab, setActiveTab] = useState('profile')
    const [isLoading, setIsLoading] = useState(true)
    const [patient, setPatient] = useState(null)
    const [crmStatus, setCrmStatus] = useState('New')
    
    // Tab data states
    const [treatmentHistory, setTreatmentHistory] = useState([])
    const [filterTreatmentBranch, setFilterTreatmentBranch] = useState('All')
    const [branches, setBranches] = useState([]) // For the filter dropdown
    const [photos, setPhotos] = useState([])
    const [crmHistory, setCrmHistory] = useState([])
    const [pendingFollowups, setPendingFollowups] = useState([])
    const [patientCoupons, setPatientCoupons] = useState([])
    const [patientTransactions, setPatientTransactions] = useState([])
    const [hasExpiringCoupons, setHasExpiringCoupons] = useState(false)
    
    const [editExpiryModal, setEditExpiryModal] = useState({ isOpen: false, coupon: null, newDate: '' })
    const [editSessionModal, setEditSessionModal] = useState({ isOpen: false, item: null, coupon: null, usedSessions: 0, totalSessions: 0 })
    const [isUpdating, setIsUpdating] = useState(false)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const handleUpdateExpiry = async () => {
        if (!editExpiryModal.newDate || !editExpiryModal.coupon) return
        
        setIsUpdating(true)
        const { error } = await supabase
            .from('patient_coupons')
            .update({ expired_at: new Date(editExpiryModal.newDate).toISOString() })
            .eq('id', editExpiryModal.coupon.id)
            
        setIsUpdating(false)
        if (error) {
            alert('Gagal update tanggal expired: ' + error.message)
        } else {
            alert('Tanggal expired berhasil diperbarui!')
            setEditExpiryModal({ isOpen: false, coupon: null, newDate: '' })
            window.location.reload()
        }
    }

    const handleUpdateSessions = async () => {
        if (!editSessionModal.item) return
        
        setIsUpdating(true)
        const used = Math.min(editSessionModal.totalSessions, Math.max(0, Number(editSessionModal.usedSessions) || 0))
        const remaining = Math.max(0, editSessionModal.totalSessions - used)
        const itemStatus = remaining === 0 ? 'completed' : 'active'

        const { error: itemErr } = await supabase
            .from('patient_coupon_items')
            .update({
                used_sessions: used,
                remaining_sessions: remaining,
                status: itemStatus
            })
            .eq('id', editSessionModal.item.id)

        if (itemErr) {
            alert('Gagal memperbarui sesi kupon: ' + itemErr.message)
            setIsUpdating(false)
            return
        }

        // Check parent coupon status
        if (editSessionModal.coupon?.id) {
            const { data: siblings } = await supabase
                .from('patient_coupon_items')
                .select('status, remaining_sessions')
                .eq('patient_coupon_id', editSessionModal.coupon.id)

            const allDone = siblings ? siblings.every(s => s.remaining_sessions === 0 || s.status === 'completed' || s.status === 'fully_used') : true
            if (allDone) {
                await supabase
                    .from('patient_coupons')
                    .update({ status: 'completed' })
                    .eq('id', editSessionModal.coupon.id)
            }
        }

        alert('Sesi kupon berhasil diperbarui!')
        setIsUpdating(false)
        setEditSessionModal({ isOpen: false, item: null, coupon: null, usedSessions: 0, totalSessions: 0 })
        window.location.reload()
    }

    useEffect(() => {
        if (!id) return
        
        const fetchPatientData = async () => {
            setIsLoading(true)

            // 1. Fetch Patient Info
            const { data: ptData, error: ptError } = await supabase
                .from('patients')
                .select('*')
                .eq('id', id)
                .single()
            
            if (ptError || !ptData) {
                alert('Pasien tidak ditemukan')
                router.push('/patients')
                return
            }
            setPatient(ptData)

            // 2. Fetch Treatment History
            const { data: trData } = await supabase
                .from('treatment_records')
                .select(`
                    *,
                    branches(name),
                    users:users!treatment_records_performed_by_fkey(full_name),
                    treatment_record_items(
                        id,
                        treatment_id,
                        treatments(name)
                    )
                `)
                .eq('patient_id', id)
                .order('treatment_date', { ascending: false })
            
            if (trData) {
                setTreatmentHistory(trData)
                
                // Kalkulasi CRM Status dari kunjungan terakhir
                if (trData.length > 0) {
                    const lastVisit = new Date(trData[0].treatment_date)
                    const diffTime = Math.abs(new Date() - lastVisit)
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
                    
                    
                    if (diffDays <= 60) setCrmStatus('Active')
                    else if (diffDays <= 90) setCrmStatus('Warm')
                    else setCrmStatus('Dormant')
                }

                // Extract unique branches for the filter
                const uniqueBranches = []
                const branchIds = new Set()
                trData.forEach(tr => {
                    if (tr.branch_id && tr.branches && !branchIds.has(tr.branch_id)) {
                        branchIds.add(tr.branch_id)
                        uniqueBranches.push({ id: tr.branch_id, name: tr.branches.name })
                    }
                })
                setBranches(uniqueBranches)
            }

            // 3. Fetch Photos (Before After)
            const { data: phData } = await supabase
                .from('patient_photos')
                .select('*')
                .eq('patient_id', id)
                .order('created_at', { ascending: false })
            
            if (phData) setPhotos(phData)

            // 4. Fetch CRM Follow-up Logs & Pending Queue
            const { data: crmData } = await supabase
                .from('followup_logs')
                .select('*, users(full_name)')
                .eq('patient_id', id)
                .order('performed_at', { ascending: false })
            
            if (crmData) setCrmHistory(crmData)

            const { data: queueData } = await supabase
                .from('followup_queue')
                .select('*')
                .eq('patient_id', id)
                .eq('status', 'pending')
                .order('scheduled_date', { ascending: true })

            if (queueData) setPendingFollowups(queueData)

            // 5. Fetch Patient Coupons
            const { data: pcData } = await supabase
                .from('patient_coupons')
                .select(`
                    *,
                    coupon_packages (name),
                    patient_coupon_items (
                        id, total_sessions, used_sessions, remaining_sessions, status,
                        treatments (name)
                    )
                `)
                .eq('patient_id', id)
                .order('purchased_at', { ascending: false })
            
            if (pcData) {
                setPatientCoupons(pcData)
                const hasExpiring = pcData.some(c => {
                    if (c.status !== 'active') return false
                    const diffDays = Math.ceil((new Date(c.expired_at) - new Date()) / (1000 * 60 * 60 * 24))
                    return diffDays <= 7 && diffDays >= 0
                })
                setHasExpiringCoupons(hasExpiring)
            }

            // 6. Fetch Patient Transactions
            const { data: txData } = await supabase
                .from('transactions')
                .select(`
                    *,
                    branches (name),
                    transaction_items (*)
                `)
                .eq('patient_id', id)
                .order('created_at', { ascending: false })
            
            if (txData) setPatientTransactions(txData)

            setIsLoading(false)
        }

        fetchPatientData()
    }, [id, supabase, router])

    const getCRMStatusBadge = (status) => {
        switch(status) {
            case 'Active': return <span className="bg-green-100 text-green-700 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">Active</span>
            case 'Warm': return <span className="bg-yellow-100 text-yellow-700 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">Warm</span>
            case 'Dormant': return <span className="bg-red-100 text-red-700 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">Dormant</span>
            case 'New': return <span className="bg-gray-100 text-gray-600 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">New</span>
            default: return null
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-[#B5588A] border-t-transparent rounded-full mb-4"></div>
                <p className="text-[#B5588A] font-semibold">Memuat profil pasien...</p>
            </div>
        )
    }

    if (!patient) return null

    return (
        <div className="max-w-6xl mx-auto space-y-6 pt-4 sm:pt-6">
            <div className="flex items-center gap-3">
                <Link href="/patients" className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-gray-600 hover:text-ayumi-primary bg-white px-3.5 py-2 rounded-xl border border-gray-200/80 shadow-sm transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    <span>Kembali ke Daftar Pasien</span>
                </Link>
            </div>

            {/* Header Profile */}
            <div className="card-ayumi p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden bg-white border border-gray-150 shadow-sm rounded-3xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-pink-50 rounded-full mix-blend-multiply filter blur-3xl opacity-70 translate-x-1/2 -translate-y-1/2"></div>
                
                <div className="flex flex-col md:flex-row items-center gap-6 z-10 w-full md:w-auto">
                    <div className="w-24 h-24 sm:w-28 sm:h-28 bg-gradient-to-br from-ayumi-primary to-ayumi-secondary rounded-full flex items-center justify-center text-white text-3xl sm:text-4xl font-black shadow-lg flex-shrink-0">
                        {patient.full_name.substring(0, 2).toUpperCase()}
                    </div>
                    
                    <div className="text-center md:text-left space-y-2">
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{patient.full_name}</h1>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-gray-500 font-semibold text-xs sm:text-sm">
                            <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                                <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                {patient.whatsapp || 'No WA belum diisi'}
                            </div>
                            <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                                <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                {patient.birth_date ? new Date(patient.birth_date).toLocaleDateString('id-ID') : 'Tgl Lahir -'}
                            </div>
                            {patient.instagram && (
                                <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                                    <svg className="w-4 h-4 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                    {patient.instagram}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-row md:flex-col items-center md:items-end z-10 gap-3 w-full md:w-auto justify-between md:justify-center border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">CRM STATUS</span>
                        {getCRMStatusBadge(crmStatus)}
                    </div>
                    <Link href={`/patients/${patient.id}/edit`}>
                        <button className="text-xs bg-pink-50 text-ayumi-primary border border-pink-200/60 hover:bg-ayumi-primary hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm">
                            Edit Profil
                        </button>
                    </Link>
                </div>
            </div>

            {hasExpiringCoupons && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div>
                        <p className="font-bold text-red-800">Perhatian: Kupon Hampir Kedaluwarsa!</p>
                        <p className="text-sm text-red-700">Pasien ini memiliki paket kupon yang akan hangus dalam 7 hari atau kurang. Silakan jadwalkan treatment segera.</p>
                    </div>
                </div>
            )}

            {/* Modern Segment Tabs Navigation */}
            <div className="bg-gray-100/80 p-1.5 rounded-2xl border border-gray-200/60 shadow-inner flex flex-wrap gap-1">
                {[
                    { id: 'profile', label: 'Profil Medis' },
                    { id: 'treatment_history', label: 'Riwayat Treatment' },
                    { id: 'riwayat_transaksi', label: 'Riwayat Transaksi' },
                    { id: 'coupons', label: 'Kupon Paket' },
                    { id: 'gallery', label: 'Before After' },
                    { id: 'crm', label: 'Riwayat CRM' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-xs sm:text-sm font-bold transition-all rounded-xl ${
                            activeTab === tab.id 
                            ? 'bg-white text-ayumi-primary shadow-sm font-extrabold' 
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content Container */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 md:p-8 min-h-[400px]">
                
                {/* PROFILE TAB */}
                {activeTab === 'profile' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div>
                            <h3 className="text-lg font-bold text-ayumi-secondary mb-4 border-b border-gray-100 pb-2">Informasi Demografis</h3>
                            <ul className="space-y-4">
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Gender</span>
                                    <span className="font-medium text-gray-800">{patient.gender === 'female' ? 'Wanita' : patient.gender === 'male' ? 'Pria' : 'Lainnya'}</span>
                                </li>
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Alamat Lengkap</span>
                                    <span className="font-medium text-gray-800">{patient.address || '-'}</span>
                                </li>
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Terdaftar Sejak</span>
                                    <span className="font-medium text-gray-800">{new Date(patient.created_at).toLocaleDateString('id-ID')}</span>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-ayumi-secondary mb-4 border-b border-gray-100 pb-2">Kondisi Medis & Kulit</h3>
                            <ul className="space-y-4">
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Tipe Kulit Dasar</span>
                                    <span className="font-medium text-gray-800">{patient.skin_type || '-'}</span>
                                </li>
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase mb-1">Keluhan / Catatan Kulit</span>
                                    <p className="font-medium text-gray-800 bg-gray-50 p-3 rounded-xl text-sm whitespace-pre-wrap">{patient.skin_concerns && patient.skin_concerns.length > 0 ? patient.skin_concerns.join(', ') : '-'}</p>
                                </li>
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Riwayat Alergi</span>
                                    <span className="font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">{patient.allergies || '-'}</span>
                                </li>
                                <li>
                                    <span className="block text-xs font-semibold text-gray-400 uppercase">Catatan Medis</span>
                                    <p className="font-medium text-gray-800 bg-gray-50 p-3 rounded-xl text-sm">{patient.medical_notes || 'Tidak ada catatan.'}</p>
                                </li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* TREATMENT HISTORY TAB */}
                {activeTab === 'treatment_history' && (
                    <div>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                            <h3 className="text-lg font-bold text-gray-900">Riwayat Kunjungan & Treatment</h3>
                            <div className="flex items-center gap-3 w-full sm:w-auto">
                                {branches.length > 0 && (
                                    <select 
                                        value={filterTreatmentBranch}
                                        onChange={e => setFilterTreatmentBranch(e.target.value)}
                                        className="input-ayumi py-2 text-xs bg-white rounded-xl border-gray-200"
                                    >
                                        <option value="All">Semua Cabang</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                )}
                                <Link href={`/treatment-records/new?patientId=${patient.id}`} className="shrink-0">
                                    <button className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold whitespace-nowrap transition-all shadow-md shadow-pink-500/20 flex items-center gap-1.5">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                        <span>Tambah Rekam Medis</span>
                                    </button>
                                </Link>
                            </div>
                        </div>
                        {treatmentHistory.length === 0 ? (
                            <div className="text-center p-10 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                                <p className="text-gray-500 text-sm font-medium">Pasien ini belum memiliki riwayat treatment.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                <table className="whitespace-nowrap w-full text-left border-collapse">
                                    <thead className="bg-pink-50/60 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider">
                                        <tr>
                                            <th className="p-4">Tanggal</th>
                                            <th className="p-4">Cabang</th>
                                            <th className="p-4">Treatment</th>
                                            <th className="p-4">Dokter/Terapis</th>
                                            <th className="p-4">Catatan</th>
                                            <th className="p-4 text-center">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                        {treatmentHistory.filter(tr => filterTreatmentBranch === 'All' || tr.branch_id === filterTreatmentBranch).map((tr) => (
                                            <tr key={tr.id} className="hover:bg-pink-50/20 transition-colors">
                                                <td className="p-4 text-gray-700 font-semibold">{new Date(tr.treatment_date).toLocaleDateString('id-ID')}</td>
                                                <td className="p-4">
                                                    <span className="bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1 rounded-lg text-xs font-bold">
                                                        {tr.branches?.name || 'Pusat'}
                                                    </span>
                                                </td>
                                                <td className="p-4 font-bold text-gray-900">
                                                    {tr.treatment_record_items?.map(item => item.treatments?.name).filter(Boolean).join(', ') || 'Unknown'}
                                                </td>
                                                <td className="p-4 text-gray-800 font-extrabold text-xs">
                                                    {tr.therapist?.full_name || tr.users?.full_name || '-'}
                                                </td>
                                                <td className="p-4 text-gray-500 italic text-xs max-w-xs truncate">{tr.result_notes || '-'}</td>
                                                <td className="p-4 text-center">
                                                    <Link href={`/treatment-records/${tr.id}`}>
                                                        <button className="bg-pink-50 text-ayumi-primary hover:bg-ayumi-primary hover:text-white px-3 py-1.5 rounded-xl transition-all font-bold text-xs shadow-sm">
                                                            Detail
                                                        </button>
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* GALLERY TAB */}
                {activeTab === 'gallery' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-ayumi-secondary">Galeri Before After</h3>
                        </div>
                        {photos.length === 0 ? (
                            <div className="text-center p-10 bg-gray-50 rounded-2xl">
                                <p className="text-gray-500">Belum ada foto dokumentasi untuk pasien ini.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {photos.map((photo) => (
                                    <div key={photo.id} className="bg-gray-100 aspect-square rounded-2xl overflow-hidden relative group">
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">Image {photo.id}</div>
                                        {/* If image URL exists: <img src={photo.image_url} alt="BA" className="object-cover w-full h-full" /> */}
                                        <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs p-2 translate-y-full group-hover:translate-y-0 transition-transform">
                                            {new Date(photo.created_at).toLocaleDateString('id-ID')} - {photo.label || 'Treatment'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* CRM HISTORY TAB */}
                {activeTab === 'crm' && (
                    <div className="space-y-8">
                        {/* 1. PENDING SCHEDULES SECTION */}
                        <div>
                            <h3 className="text-lg font-bold text-ayumi-secondary mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                Antrean Jadwal Follow-up
                            </h3>
                            {pendingFollowups.length === 0 ? (
                                <div className="p-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-center">
                                    <p className="text-sm text-gray-500">Tidak ada jadwal follow-up aktif untuk pasien ini.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {pendingFollowups.map((q) => {
                                        const typeLabels = {
                                            'followup_2minggu': { label: '📋 Cek Progres 2 Minggu', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                                            'followup_3minggu': { label: '📋 Cek Progres 3 Minggu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                                            'followup_1bulan': { label: '📋 Cek Progres 1 Bulan', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                                            'reminder_besok': { label: '⏰ Reminder Besok Treatment', color: 'bg-red-50 text-red-700 border-red-200' },
                                            'treatment_reminder': { label: '🔔 Pengingat Perawatan', color: 'bg-pink-50 text-[#B5588A] border-pink-200' },
                                            'dormant_reminder': { label: '💤 Sapaan Pasien Dormant', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                                            'birthday': { label: '🎂 Ucapan Ulang Tahun', color: 'bg-rose-50 text-rose-700 border-rose-200' }
                                        }
                                        const info = typeLabels[q.followup_type] || { label: q.followup_type?.replace(/_/g, ' ') || 'Follow Up', color: 'bg-gray-50 text-gray-700 border-gray-200' }
                                        return (
                                            <div key={q.id} className="bg-white border border-gray-100 p-4 rounded-2xl flex items-center justify-between shadow-sm">
                                                <div className="space-y-1">
                                                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${info.color}`}>
                                                        {info.label}
                                                    </span>
                                                    <p className="text-xs text-gray-500 pt-1">Rencana: <strong className="text-gray-700">{q.scheduled_date}</strong></p>
                                                    {q.notes && <p className="text-xs text-gray-600 italic">"{q.notes}"</p>}
                                                </div>
                                                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-md ${q.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                                                    {q.priority}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <hr className="border-gray-100" />

                        {/* 2. HISTORY LOGS SECTION */}
                        <div>
                            <h3 className="text-lg font-bold text-ayumi-secondary mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                                Riwayat Kontak & Interaksi (Logs)
                            </h3>
                            {crmHistory.length === 0 ? (
                                <div className="text-center p-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                                    <p className="text-gray-500">Belum ada riwayat follow-up yang tercatat.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {crmHistory.map((crm) => {
                                        const typeLabels = {
                                            'followup_2minggu': { label: '📋 Cek Progres 2 Minggu', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                                            'followup_3minggu': { label: '📋 Cek Progres 3 Minggu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                                            'followup_1bulan': { label: '📋 Cek Progres 1 Bulan', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                                            'reminder_besok': { label: '⏰ Reminder Besok Treatment', color: 'bg-red-50 text-red-700 border-red-200' },
                                            'treatment_reminder': { label: '🔔 Pengingat Perawatan', color: 'bg-pink-50 text-[#B5588A] border-pink-200' },
                                            'dormant_reminder': { label: '💤 Sapaan Pasien Dormant', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                                            'birthday': { label: '🎂 Ucapan Ulang Tahun', color: 'bg-rose-50 text-rose-700 border-rose-200' }
                                        }
                                        const outcomeLabels = {
                                            'booked': { label: '📅 Booking Jadwal', color: 'bg-green-100 text-green-800' },
                                            'responded': { label: '💬 Merespon', color: 'bg-blue-100 text-blue-800' },
                                            'no_response': { label: '🔇 Tidak Merespon', color: 'bg-gray-100 text-gray-700' },
                                            'pending': { label: '⏳ Pending', color: 'bg-yellow-100 text-yellow-800' }
                                        }
                                        const info = typeLabels[crm.followup_type] || { label: crm.followup_type?.replace(/_/g, ' ') || 'Follow Up', color: 'bg-gray-50 text-gray-700 border-gray-200' }
                                        const outcomeInfo = outcomeLabels[crm.outcome] || { label: crm.outcome || '-', color: 'bg-gray-100 text-gray-700' }

                                        return (
                                            <div key={crm.id} className="bg-white border border-gray-100 shadow-sm p-5 rounded-2xl flex gap-4 hover:border-gray-200 transition-all">
                                                <div className="bg-green-50 text-green-600 w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0">
                                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${info.color}`}>
                                                            {info.label}
                                                        </span>
                                                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${outcomeInfo.color}`}>
                                                            Hasil: {outcomeInfo.label}
                                                        </span>
                                                        <span className="text-xs text-gray-400 ml-auto">
                                                            {new Date(crm.performed_at || crm.created_at).toLocaleString('id-ID')}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                                        {crm.notes || <span className="text-gray-400 italic">Tidak ada catatan</span>}
                                                    </p>
                                                    <div className="flex justify-between items-center text-xs text-gray-400">
                                                        <span>Saluran: <strong className="text-gray-600 capitalize">{crm.channel || 'WhatsApp'}</strong></span>
                                                        <span>Oleh: <strong className="text-gray-600">{crm.users?.full_name || 'Staf'}</strong></span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TRANSACTION HISTORY TAB */}
                {activeTab === 'riwayat_transaksi' && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                            <h3 className="text-lg font-bold text-ayumi-secondary">Riwayat Belanja & Transaksi</h3>
                        </div>

                        {/* Summary Metrics */}
                        {(() => {
                            const ltv = patientTransactions.reduce((sum, tx) => sum + Number(tx.total || 0), 0)
                            const avgVisit = patientTransactions.length > 0 ? ltv / patientTransactions.length : 0
                            const lastTx = patientTransactions[0] || null

                            return (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                    <div className="card-ayumi p-5 bg-gradient-to-br from-pink-50/50 to-purple-50/50 border-pink-100">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Lifetime Value (LTV)</h5>
                                        <p className="text-xl font-black text-ayumi-primary ">Rp {ltv.toLocaleString('id-ID')}</p>
                                    </div>
                                    <div className="card-ayumi p-5 bg-gradient-to-br from-pink-50/50 to-purple-50/50 border-pink-100">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 font-bold">Rata-rata per Kunjungan</h5>
                                        <p className="text-xl font-black text-ayumi-secondary ">Rp {avgVisit.toLocaleString('id-ID')}</p>
                                    </div>
                                    <div className="card-ayumi p-5 bg-gradient-to-br from-pink-50/50 to-purple-50/50 border-pink-100">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Transaksi Terakhir</h5>
                                        {lastTx ? (
                                            <div>
                                                <p className="text-sm font-bold text-gray-800 ">{lastTx.transaction_number}</p>
                                                <p className="text-[10px] text-gray-500 font-semibold">{new Date(lastTx.created_at).toLocaleDateString('id-ID')} - <strong className=" text-ayumi-primary">Rp {lastTx.total.toLocaleString('id-ID')}</strong></p>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-400 font-bold italic">Belum ada transaksi</p>
                                        )}
                                    </div>
                                </div>
                            )
                        })()}

                        {/* Transactions Table */}
                        {patientTransactions.length === 0 ? (
                            <div className="text-center p-10 bg-gray-50 rounded-2xl">
                                <p className="text-gray-500 font-semibold">Pasien ini belum memiliki riwayat transaksi.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                                    <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold">
                                        <tr>
                                            <th className="p-3">No. Transaksi</th>
                                            <th className="p-3">Tanggal</th>
                                            <th className="p-3">Cabang</th>
                                            <th className="p-3">Item Belanja</th>
                                            <th className="p-3 text-center">Metode</th>
                                            <th className="p-3 text-right">Total</th>
                                            <th className="p-3 text-center">Detail</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {patientTransactions.map((tx) => {
                                            let t = 0, p = 0, c = 0
                                            tx.transaction_items?.forEach(i => {
                                                if (i.item_type === 'treatment') t += i.quantity
                                                if (i.item_type === 'product') p += i.quantity
                                                if (i.item_type === 'coupon') c += i.quantity
                                            })
                                            const itemsSummary = [
                                                t > 0 ? `${t} Treatment` : null,
                                                p > 0 ? `${p} Produk` : null,
                                                c > 0 ? `${c} Kupon` : null
                                            ].filter(Boolean).join(', ') || '0 Item'

                                            return (
                                                <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                                                    <td className="p-3 font-bold text-gray-800 ">{tx.transaction_number}</td>
                                                    <td className="p-3 text-gray-500">
                                                        {new Date(tx.created_at).toLocaleDateString('id-ID', {
                                                            day: 'numeric',
                                                            month: 'short',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </td>
                                                    <td className="p-3 text-gray-600 font-semibold">{tx.branches?.name || '-'}</td>
                                                    <td className="p-3 text-gray-600 font-semibold">{itemsSummary}</td>
                                                    <td className="p-3 text-center">
                                                        <span className="bg-pink-50 text-ayumi-primary border border-pink-100 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">{tx.payment_method}</span>
                                                    </td>
                                                    <td className="p-3 text-right  font-bold text-gray-800">Rp {tx.total.toLocaleString('id-ID')}</td>
                                                    <td className="p-3 text-center">
                                                        <Link href={`/kasir/transactions/${tx.id}`}>
                                                            <button className="text-ayumi-primary hover:text-ayumi-secondary bg-pink-50 hover:bg-pink-100 px-3 py-1 rounded-lg transition-colors font-bold text-[10px] uppercase">
                                                                Struk
                                                            </button>
                                                        </Link>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* COUPONS TAB */}
                {activeTab === 'coupons' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-ayumi-secondary">Daftar Kupon Paket</h3>
                            <Link href="/kasir">
                                <button className="btn-primary py-2 text-sm">Beli Kupon Baru</button>
                            </Link>
                        </div>
                        
                        {patientCoupons.length === 0 ? (
                            <div className="text-center p-10 bg-gray-50 rounded-2xl">
                                <p className="text-gray-500">Pasien ini belum memiliki paket kupon.</p>
                            </div>
                        ) : (
                            <div className="grid gap-6 md:grid-cols-2">
                                {patientCoupons.map((coupon) => {
                                    let badgeClass = "bg-gray-100 text-gray-700"
                                    if (coupon.status === 'active') badgeClass = "bg-green-100 text-green-700"
                                    else if (coupon.status === 'expired') badgeClass = "bg-red-100 text-red-700"
                                    
                                    const daysUntilExpiry = Math.ceil((new Date(coupon.expired_at) - new Date()) / (1000 * 60 * 60 * 24))
                                    const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry >= 0

                                    return (
                                        <div key={coupon.id} className={`bg-white border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow ${isExpiringSoon ? 'border-red-300' : 'border-gray-100'}`}>
                                            <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
                                                <div>
                                                    <h4 className="font-bold text-gray-800 text-lg mb-1">{coupon.coupon_packages?.name}</h4>
                                                    <p className="text-xs text-gray-500">
                                                        Dibeli: {new Date(coupon.purchased_at).toLocaleDateString('id-ID')}
                                                    </p>
                                                    <p className={`text-xs mt-0.5 flex items-center gap-2 ${isExpiringSoon ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                                                        <span>Berlaku s/d: {new Date(coupon.expired_at).toLocaleDateString('id-ID')}</span>
                                                        <button onClick={() => setEditExpiryModal({ isOpen: true, coupon: coupon, newDate: new Date(coupon.expired_at).toISOString().split('T')[0] })} className="text-ayumi-primary hover:text-ayumi-secondary" title="Edit Tanggal Expired">
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                        </button>
                                                        {isExpiringSoon && <span>({daysUntilExpiry} hari lagi)</span>}
                                                    </p>
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                                                    {coupon.status.replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="p-5 space-y-4">
                                                {coupon.patient_coupon_items?.map(item => {
                                                    const percent = (item.used_sessions / item.total_sessions) * 100
                                                    return (
                                                        <div key={item.id} className="relative bg-gray-50/70 p-3 rounded-2xl border border-gray-150">
                                                            <div className="flex flex-wrap justify-between items-center text-sm mb-1.5 gap-2">
                                                                <span className="font-bold text-gray-800">{item.treatments?.name}</span>
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-md ${item.remaining_sessions === 0 ? 'bg-gray-100 text-gray-500 line-through' : 'text-ayumi-primary bg-pink-50'}`}>
                                                                        {item.remaining_sessions} / {item.total_sessions} tersisa
                                                                    </span>
                                                                    <button
                                                                        onClick={() => setEditSessionModal({
                                                                            isOpen: true,
                                                                            item: item,
                                                                            coupon: coupon,
                                                                            usedSessions: item.used_sessions,
                                                                            totalSessions: item.total_sessions
                                                                        })}
                                                                        className="text-[10px] font-bold bg-white text-ayumi-primary hover:bg-ayumi-primary hover:text-white border border-pink-200 px-2 py-1 rounded-lg transition-all shadow-sm"
                                                                        title="Sesuaikan Sesi Terpakai"
                                                                    >
                                                                        ✏️ Edit Sesi
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden border border-gray-200/50">
                                                                <div className="bg-gradient-to-r from-ayumi-primary to-ayumi-secondary h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                                            </div>
                                                            <div className="flex justify-between items-center text-[10px] text-gray-400 mt-1.5">
                                                                <span>Terpakai: <strong>{item.used_sessions}</strong> sesi</span>
                                                                {item.remaining_sessions === 0 && <span className="text-gray-500 font-extrabold uppercase tracking-wider">🎉 Selesai / Habis</span>}
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
                    </div>
                )}

            </div>

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
                                disabled={isUpdating || !editExpiryModal.newDate}
                                className="btn-ayumi px-4 py-2 text-sm"
                            >
                                {isUpdating ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Edit Sesi Kupon */}
            {editSessionModal.isOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-5 md:p-6 w-full max-w-sm shadow-2xl space-y-4">
                        <div className="border-b border-gray-100 pb-3">
                            <h3 className="text-lg font-extrabold text-gray-900">Sesuaikan Sesi Kupon</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{editSessionModal.item?.treatments?.name}</p>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Jumlah Sesi Terpakai</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0"
                                        max={editSessionModal.totalSessions}
                                        className="input-ayumi w-full font-bold text-center text-lg"
                                        value={editSessionModal.usedSessions}
                                        onChange={(e) => setEditSessionModal({ ...editSessionModal, usedSessions: Number(e.target.value) })}
                                    />
                                    <span className="text-sm font-bold text-gray-400">/ {editSessionModal.totalSessions} Total</span>
                                </div>
                            </div>

                            <div className="bg-pink-50 p-3 rounded-2xl border border-pink-100 text-xs text-ayumi-primary font-bold flex justify-between items-center">
                                <span>Sisa Sesi Hasil Edit:</span>
                                <span className="text-sm font-black">{Math.max(0, editSessionModal.totalSessions - (Number(editSessionModal.usedSessions) || 0))} Sesi</span>
                            </div>

                            <button
                                type="button"
                                onClick={() => setEditSessionModal({ ...editSessionModal, usedSessions: editSessionModal.totalSessions })}
                                className="w-full text-xs font-extrabold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 py-2.5 rounded-xl transition-all"
                            >
                                ⚡ Tandai Semua Sesi Habis ({editSessionModal.totalSessions}/{editSessionModal.totalSessions})
                            </button>
                        </div>

                        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                            <button
                                onClick={() => setEditSessionModal({ isOpen: false, item: null, coupon: null, usedSessions: 0, totalSessions: 0 })}
                                className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleUpdateSessions}
                                disabled={isUpdating}
                                className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2 text-xs font-extrabold rounded-xl shadow-md transition-all"
                            >
                                {isUpdating ? 'Menyimpan...' : 'Simpan Sesi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
