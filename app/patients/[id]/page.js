'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import { isInfusionTreatment } from '@/lib/commissionUtils'
import { getCachedUser } from '@/lib/cachedUser'
import RotatedPhoto, { normalizeRotation } from '@/components/ui/RotatedPhoto'
import { getPhotoAngle } from '@/lib/photoAngle'

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
    const [galleryViewMode, setGalleryViewMode] = useState('sessions') // 'sessions' | 'compare'
    const [compareSessionKeys, setCompareSessionKeys] = useState({ before: '', after: '' })
    const [photoAngleFilter, setPhotoAngleFilter] = useState('all') // 'all' | 'depan' | 'kiri' | 'kanan'
    const [selectedPhotoZoom, setSelectedPhotoZoom] = useState(null)
    const [crmHistory, setCrmHistory] = useState([])
    const [pendingFollowups, setPendingFollowups] = useState([])
    const [patientCoupons, setPatientCoupons] = useState([])
    const [couponLogs, setCouponLogs] = useState([])
    const [patientTransactions, setPatientTransactions] = useState([])
    const [hasExpiringCoupons, setHasExpiringCoupons] = useState(false)
    
    const [editExpiryModal, setEditExpiryModal] = useState({ isOpen: false, coupon: null, newDate: '' })
    const [editSessionModal, setEditSessionModal] = useState({ isOpen: false, item: null, coupon: null, usedSessions: 0, totalSessions: 0 })
    const [isUpdating, setIsUpdating] = useState(false)
    const [userRole, setUserRole] = useState(null)
    const [userBranchId, setUserBranchId] = useState(null)
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, confirmName: '' })
    const [isDeleting, setIsDeleting] = useState(false)
    const [positionEditor, setPositionEditor] = useState(null) // { title, ids, drafts: { [id]: { rotation, angle } } }
    const [isSavingPositions, setIsSavingPositions] = useState(false)

    const photoSessionKey = (p) => p.treatment_record_id || (p.created_at ? p.created_at.split('T')[0] : 'other')

    // Editor "Atur Posisi Foto": semua foto satu sesi diatur sekaligus (putar & sudut),
    // baru disimpan saat tombol Simpan ditekan.
    const openPositionEditor = (photo) => {
        const sessionPhotos = photos.filter(p => photoSessionKey(p) === photoSessionKey(photo))
        const drafts = {}
        sessionPhotos.forEach(p => {
            drafts[p.id] = { rotation: normalizeRotation(p.rotation), angle: getPhotoAngleCategory(p.caption, p.storage_path) }
        })
        const d = photo.treatment_records?.treatment_date || photo.created_at?.split('T')[0]
        setSelectedPhotoZoom(null)
        const order = { depan: 0, kiri: 1, kanan: 2, other: 3 }
        setPositionEditor({
            title: d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Foto Treatment',
            // Urutan dikunci saat dibuka agar kartu tidak berpindah ketika sudutnya diganti.
            ids: sessionPhotos.map(p => p.id).sort((a, b) => order[drafts[a].angle] - order[drafts[b].angle]),
            drafts
        })
    }

    const rotateDraft = (id, delta) => setPositionEditor(prev => ({
        ...prev,
        drafts: { ...prev.drafts, [id]: { ...prev.drafts[id], rotation: normalizeRotation(prev.drafts[id].rotation + delta) } }
    }))

    // Pilih sudut untuk satu foto saja; foto lain di sesi ini tidak ikut berubah.
    const setDraftAngle = (id, angle) => setPositionEditor(prev => ({
        ...prev,
        drafts: { ...prev.drafts, [id]: { ...prev.drafts[id], angle } }
    }))

    const swapDraftSides = () => setPositionEditor(prev => {
        const drafts = { ...prev.drafts }
        Object.keys(drafts).forEach(k => {
            if (drafts[k].angle === 'kiri') drafts[k] = { ...drafts[k], angle: 'kanan' }
            else if (drafts[k].angle === 'kanan') drafts[k] = { ...drafts[k], angle: 'kiri' }
        })
        return { ...prev, drafts }
    })

    // Tukar foto Samping Kiri <-> Samping Kanan satu sesi, langsung tersimpan.
    const [swappingSessionKey, setSwappingSessionKey] = useState(null)
    const swapSessionSides = async (session) => {
        if (swappingSessionKey) return
        const sidePhotos = session.photos.filter(p => ['kiri', 'kanan'].includes(getPhotoAngleCategory(p.caption, p.storage_path)))
        if (sidePhotos.length === 0) return
        const updates = sidePhotos.map(p => ({
            id: p.id,
            from: p.caption,
            to: getPhotoAngleCategory(p.caption, p.storage_path) === 'kiri' ? 'foto_kanan' : 'foto_kiri'
        }))
        const apply = (field) => {
            const map = Object.fromEntries(updates.map(u => [u.id, u[field]]))
            setPhotos(prev => prev.map(p => (p.id in map ? { ...p, caption: map[p.id] } : p)))
        }
        apply('to')
        setSwappingSessionKey(session.key)
        try {
            for (const u of updates) {
                const { data, error } = await supabase.from('patient_photos').update({ caption: u.to }).eq('id', u.id).select('id')
                if (error) throw error
                if (!data || data.length === 0) throw new Error('Perubahan foto tidak tersimpan. Akun ini mungkin tidak punya izin mengubah foto.')
            }
            toast.success('Foto kiri dan kanan sudah ditukar.')
        } catch (err) {
            console.warn('Swap photo sides error:', err)
            apply('from')
            for (const u of updates) {
                await supabase.from('patient_photos').update({ caption: u.from }).eq('id', u.id)
            }
            toast.error(err?.message?.startsWith('Perubahan foto') ? err.message : getFriendlyErrorMessage(err))
        } finally {
            setSwappingSessionKey(null)
        }
    }

    const savePositions = async () => {
        if (!positionEditor || isSavingPositions) return
        const updates = []
        positionEditor.ids.forEach(id => {
            const photo = photos.find(p => p.id === id)
            const draft = positionEditor.drafts[id]
            if (!photo || !draft) return
            const payload = {}
            if (draft.rotation !== normalizeRotation(photo.rotation)) payload.rotation = draft.rotation
            if (draft.angle !== getPhotoAngleCategory(photo.caption, photo.storage_path)) {
                payload.caption = draft.angle === 'other' ? 'foto_lain' : `foto_${draft.angle}`
            }
            if (Object.keys(payload).length > 0) updates.push({ id, payload })
        })
        if (updates.length === 0) {
            setPositionEditor(null)
            return
        }

        setIsSavingPositions(true)
        try {
            for (const u of updates) {
                // .select() memastikan baris benar-benar berubah (update yang ditolak RLS tidak memberi error).
                const { data, error } = await supabase.from('patient_photos').update(u.payload).eq('id', u.id).select('id')
                if (error) throw error
                if (!data || data.length === 0) throw new Error('Perubahan foto tidak tersimpan. Akun ini mungkin tidak punya izin mengubah foto.')
            }
            const byId = Object.fromEntries(updates.map(u => [u.id, u.payload]))
            setPhotos(prev => prev.map(p => (byId[p.id] ? { ...p, ...byId[p.id] } : p)))
            toast.success('Posisi foto tersimpan.')
            setPositionEditor(null)
        } catch (err) {
            console.warn('Save photo positions error:', err)
            const missingColumn = err?.code === 'PGRST204' || err?.code === '42703'
            toast.error(missingColumn
                ? 'Fitur posisi foto belum aktif di database. Jalankan SQL 20261002_patient_photos_rotation.sql.'
                : (err?.message?.startsWith('Perubahan foto') ? err.message : getFriendlyErrorMessage(err)))
        } finally {
            setIsSavingPositions(false)
        }
    }

    useEffect(() => {
        getCachedUser().then(({ dbUser }) => {
            setUserRole(dbUser?.role || null)
            setUserBranchId(dbUser?.branch_id || null)
        }).catch(() => {})
    }, [])

    // Owner: semua pasien. Admin: pasien cabangnya sendiri. Pasien yang sudah punya
    // riwayat transaksi/treatment/kupon ditolak oleh fungsi delete_patient di database.
    const canDeletePatient = userRole === 'owner' || (userRole === 'admin' && patient?.branch_id === userBranchId)
    const hasPatientHistory = treatmentHistory.length > 0 || patientTransactions.length > 0 || patientCoupons.length > 0

    const handleDeletePatient = async () => {
        if (!patient || isDeleting) return
        setIsDeleting(true)
        try {
            const { error } = await supabase.rpc('delete_patient', { p_patient_id: patient.id })
            if (error) throw error
            toast.success(`Data pasien ${patient.full_name} berhasil dihapus.`)
            router.push('/patients')
        } catch (err) {
            console.warn('Delete patient error:', err)
            const msg = err?.code === 'PGRST202'
                ? 'Fitur hapus pasien belum aktif di database. Jalankan SQL 20261002_delete_patient.sql terlebih dahulu.'
                : (err?.message?.includes('tidak bisa dihapus') || err?.message?.includes('Hanya') || err?.message?.includes('cabang lain'))
                    ? err.message
                    : getFriendlyErrorMessage(err)
            toast.error(msg, { duration: 7000 })
            setIsDeleting(false)
        }
    }

    const getPhotoAngleCategory = (caption, storagePath) => getPhotoAngle(caption, storagePath) || 'other'

    const formatPhotoLabel = (caption, storagePath) => {
        const cat = getPhotoAngleCategory(caption, storagePath)
        if (cat === 'depan') return 'Foto Depan'
        if (cat === 'kiri') return 'Foto Samping Kiri'
        if (cat === 'kanan') return 'Foto Samping Kanan'
        return caption || 'Foto Dokumentasi'
    }

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
                        notes,
                        commission_percent,
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
                .select(`
                    *,
                    treatment_records (
                        id,
                        treatment_date,
                        branches (name)
                    )
                `)
                .eq('patient_id', id)
                .order('created_at', { ascending: false })
            
            if (phData) {
                const photosWithUrls = phData.map(photo => {
                    let fullUrl = photo.storage_path || photo.photo_url || photo.image_url
                    if (fullUrl && !fullUrl.startsWith('http')) {
                        const { data: pubData } = supabase.storage
                            .from('patient-photos')
                            .getPublicUrl(fullUrl)
                        fullUrl = pubData?.publicUrl || fullUrl
                    }
                    return {
                        ...photo,
                        fullUrl
                    }
                })
                setPhotos(photosWithUrls)
            }

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

            // Fetch Coupon Usage History for this Patient
            const { data: cpLogData } = await supabase
                .from('coupon_usage_logs')
                .select(`
                    *,
                    branches (name),
                    users:users!coupon_usage_logs_used_by_fkey (full_name),
                    patient_coupon_items (
                        treatments (name),
                        patient_coupons (
                            coupon_packages (name)
                        )
                    )
                `)
                .is('voided_at', null)
                .eq('patient_id', id)
                .order('used_at', { ascending: false })

            if (cpLogData) setCouponLogs(cpLogData)

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
                    <div className="flex items-center gap-2">
                        <Link href={`/patients/${patient.id}/edit`}>
                            <button className="text-xs bg-pink-50 text-ayumi-primary border border-pink-200/60 hover:bg-ayumi-primary hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm">
                                Edit Profil
                            </button>
                        </Link>
                        {canDeletePatient && (
                            <button
                                type="button"
                                onClick={() => setDeleteModal({ isOpen: true, confirmName: '' })}
                                className="text-xs bg-white text-red-600 border border-red-200 hover:bg-red-600 hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm cursor-pointer"
                            >
                                Hapus Pasien
                            </button>
                        )}
                    </div>
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
                                                    {(() => {
                                                        const trItems = tr.treatment_record_items || []
                                                        const hasWorker = trItems.some(i => i.notes?.includes('[WORKER]') || isInfusionTreatment(i.treatments?.name || '', i.notes || ''))
                                                        const hasTherapistItem = trItems.some(i => !i.notes?.includes('[WORKER]') && !isInfusionTreatment(i.treatments?.name || '', i.notes || ''))
                                                        const therapistName = tr.therapist?.full_name || tr.users?.full_name

                                                        if (therapistName) {
                                                            if (hasWorker && hasTherapistItem) {
                                                                return (
                                                                    <div className="flex flex-col gap-1 items-start">
                                                                        <span className="font-bold text-gray-800 text-xs inline-flex items-center gap-1 bg-purple-50 text-purple-800 px-2 py-0.5 rounded-md border border-purple-100 shadow-2xs">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                                                            {therapistName}
                                                                        </span>
                                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                                                            + Worker (Infus)
                                                                        </span>
                                                                    </div>
                                                                )
                                                            }
                                                            return (
                                                                <span className="font-bold text-gray-800 text-xs inline-flex items-center gap-1 bg-purple-50 text-purple-800 px-2 py-0.5 rounded-md border border-purple-100 shadow-2xs">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                                                    {therapistName}
                                                                </span>
                                                            )
                                                        }

                                                        if (hasWorker || tr.result_notes?.includes('Worker') || tr.complaints?.includes('WORKER') || !tr.performed_by) {
                                                            return (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                                                    {tr.result_notes?.includes('PKM') ? 'Worker (PKM)' : 'Worker (Infus)'}
                                                                </span>
                                                            )
                                                        }
                                                        return '-'
                                                    })()}
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
                {activeTab === 'gallery' && (() => {
                    const angleSpecs = [
                        { key: 'depan', label: 'Tampak Depan', short: 'Depan' },
                        { key: 'kiri', label: 'Samping Kiri', short: 'Kiri' },
                        { key: 'kanan', label: 'Samping Kanan', short: 'Kanan' }
                    ]
                    const photoDate = (p) => p.treatment_records?.treatment_date || p.created_at?.split('T')[0]
                    const formatShortDate = (d) => d
                        ? new Date(d + (d.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'

                    // Satu kotak foto: bingkai 3:4, label sudut, tombol putar, klik untuk memperbesar.
                    const renderPhotoTile = ({ key, photo, badge, caption }) => (
                        <div key={key} className="group">
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedPhotoZoom(photo)}
                                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedPhotoZoom(photo) }}
                                className="relative rounded-2xl overflow-hidden bg-slate-100 ring-1 ring-slate-200 group-hover:ring-ayumi-primary/40 transition-all cursor-zoom-in"
                            >
                                <RotatedPhoto src={photo.fullUrl} alt={formatPhotoLabel(photo.caption, photo.storage_path)} rotation={photo.rotation} fit="auto" imgClassName="group-hover:scale-[1.03]" />
                                {badge && (
                                    <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-slate-700 shadow-sm backdrop-blur-sm">
                                        {badge}
                                    </span>
                                )}
                            </div>
                            {caption && <div className="mt-1.5 px-0.5">{caption}</div>}
                        </div>
                    )

                    const renderEmptyTile = ({ key, label }) => (
                        <div key={key} className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 flex flex-col items-center justify-center gap-1 text-slate-400" style={{ aspectRatio: 3 / 4 }}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            <span className="text-[10px] font-semibold">{label}</span>
                            <span className="text-[10px]">Tidak ada foto</span>
                        </div>
                    )

                    // Kelompokkan per sesi treatment (atau per tanggal bila foto tanpa rekam).
                    const sessionsMap = {}
                    photos.forEach(photo => {
                        const key = photo.treatment_record_id || (photo.created_at ? photo.created_at.split('T')[0] : 'other')
                        if (!sessionsMap[key]) {
                            sessionsMap[key] = {
                                key,
                                id: photo.treatment_record_id,
                                date: photoDate(photo),
                                branch: photo.treatment_records?.branches?.name || null,
                                photos: []
                            }
                        }
                        sessionsMap[key].photos.push(photo)
                    })
                    const sessions = Object.values(sessionsMap).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                    const anglePhotos = photoAngleFilter === 'all'
                        ? []
                        : photos.filter(p => getPhotoAngleCategory(p.caption, p.storage_path) === photoAngleFilter)

                    return (
                        <div className="space-y-4">
                            {/* Judul + kontrol */}
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-extrabold text-slate-900">Foto Treatment</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {photos.length} foto dari {sessions.length} sesi · kiri–kanan tertukar? klik ⇄ di antara fotonya
                                    </p>
                                </div>
                                {photos.length >= 2 && (
                                    <div className="inline-flex p-1 bg-slate-100 rounded-xl">
                                        {[
                                            { key: 'sessions', label: 'Per Sesi' },
                                            { key: 'compare', label: 'Bandingkan' }
                                        ].map(m => (
                                            <button
                                                key={m.key}
                                                type="button"
                                                onClick={() => setGalleryViewMode(m.key)}
                                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                    galleryViewMode === m.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                                                }`}
                                            >
                                                {m.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {photos.length === 0 ? (
                                <div className="text-center py-12 px-6 bg-white rounded-2xl border border-dashed border-slate-200">
                                    <p className="font-bold text-slate-700 text-sm">Belum ada foto treatment</p>
                                    <p className="text-xs text-slate-400 mt-1">Foto tersimpan otomatis saat terapis mengisi rekam medis (SOAP).</p>
                                </div>
                            ) : galleryViewMode === 'compare' ? (
                                /* MODE BANDINGKAN: pilih tanggal sebelum & sesudah, lalu tiap sudut
                                   ditampilkan berdampingan (Depan, Kiri, Kanan). */
                                (() => {
                                    const oldest = sessions[sessions.length - 1]
                                    const newest = sessions[0]
                                    const beforeSession = sessions.find(s => s.key === compareSessionKeys.before) || oldest
                                    const afterSession = sessions.find(s => s.key === compareSessionKeys.after) || newest
                                    const sessionLabel = (s) => `${formatShortDate(s.date)}${s.branch ? ` · ${s.branch.replace('Ayumi ', '')}` : ''} (${s.photos.length} foto)`
                                    const findAngle = (session, key) => session?.photos.find(p => getPhotoAngleCategory(p.caption, p.storage_path) === key)
                                    const sessionSelect = (side, value, accent) => (
                                        <div className="min-w-0">
                                            <label className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${accent}`}>
                                                {side === 'before' ? 'Sebelum' : 'Sesudah'}
                                            </label>
                                            <select
                                                value={value}
                                                onChange={(e) => setCompareSessionKeys(prev => ({
                                                    before: prev.before || beforeSession.key,
                                                    after: prev.after || afterSession.key,
                                                    [side]: e.target.value
                                                }))}
                                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-2.5 py-2 bg-white text-slate-800 outline-none focus:border-ayumi-primary"
                                            >
                                                {sessions.map(s => (
                                                    <option key={s.key} value={s.key}>{sessionLabel(s)}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )

                                    return (
                                        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 space-y-4">
                                            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-3">
                                                {sessionSelect('before', beforeSession.key, 'text-indigo-600')}
                                                <button
                                                    type="button"
                                                    onClick={() => setCompareSessionKeys({ before: afterSession.key, after: beforeSession.key })}
                                                    className="h-[34px] px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                                    title="Tukar sebelum dan sesudah"
                                                >
                                                    ⇄
                                                </button>
                                                {sessionSelect('after', afterSession.key, 'text-ayumi-primary')}
                                            </div>

                                            {sessions.length === 1 && (
                                                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                                    Baru ada 1 sesi foto. Perbandingan akan berguna setelah ada foto dari treatment berikutnya.
                                                </p>
                                            )}

                                            <div className="space-y-4">
                                                {angleSpecs.map(angle => {
                                                    const beforePhoto = findAngle(beforeSession, angle.key)
                                                    const afterPhoto = findAngle(afterSession, angle.key)
                                                    if (!beforePhoto && !afterPhoto) return null
                                                    return (
                                                        <div key={angle.key} className="max-w-2xl mx-auto">
                                                            <h5 className="text-xs font-extrabold text-slate-700 mb-2">{angle.label}</h5>
                                                            <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                                                {beforePhoto
                                                                    ? renderPhotoTile({ key: 'before', photo: beforePhoto, badge: formatShortDate(beforeSession.date) })
                                                                    : renderEmptyTile({ key: 'before', label: angle.label })}
                                                                {afterPhoto
                                                                    ? renderPhotoTile({ key: 'after', photo: afterPhoto, badge: formatShortDate(afterSession.date) })
                                                                    : renderEmptyTile({ key: 'after', label: angle.label })}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })()
                            ) : (
                                /* MODE PER SESI */
                                <div className="space-y-4">
                                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                                        {[{ key: 'all', label: 'Semua' }, ...angleSpecs.map(a => ({ key: a.key, label: a.label }))].map(btn => {
                                            const count = btn.key === 'all'
                                                ? photos.length
                                                : photos.filter(p => getPhotoAngleCategory(p.caption, p.storage_path) === btn.key).length
                                            const active = photoAngleFilter === btn.key
                                            return (
                                                <button
                                                    key={btn.key}
                                                    type="button"
                                                    onClick={() => setPhotoAngleFilter(btn.key)}
                                                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer border ${
                                                        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    {btn.label} <span className={active ? 'text-white/60' : 'text-slate-400'}>{count}</span>
                                                </button>
                                            )
                                        })}
                                    </div>

                                    {photoAngleFilter !== 'all' ? (
                                        anglePhotos.length === 0 ? (
                                            <div className="text-center py-10 bg-white rounded-2xl border border-slate-100 text-sm font-semibold text-slate-500">
                                                Belum ada foto {angleSpecs.find(a => a.key === photoAngleFilter)?.label.toLowerCase()}.
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                                                {anglePhotos.map(photo => renderPhotoTile({
                                                    key: photo.id,
                                                    photo,
                                                    caption: (
                                                        <div className="flex items-center justify-between gap-2 text-[11px]">
                                                            <span className="font-bold text-slate-700">{formatShortDate(photoDate(photo))}</span>
                                                            {photo.treatment_records?.branches?.name && (
                                                                <span className="text-slate-400 truncate">{photo.treatment_records.branches.name.replace('Ayumi ', '')}</span>
                                                            )}
                                                        </div>
                                                    )
                                                }))}
                                            </div>
                                        )
                                    ) : (
                                        sessions.map((session, sIdx) => {
                                            const dateDisplay = session.date
                                                ? new Date(session.date + (session.date.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                                                : 'Dokumentasi Klinis'
                                            // Foto tanpa sudut standar, atau foto kedua dengan sudut yang sama, tetap ditampilkan.
                                            const slotPhotoIds = new Set(angleSpecs
                                                .map(slot => session.photos.find(p => getPhotoAngleCategory(p.caption, p.storage_path) === slot.key)?.id)
                                                .filter(Boolean))
                                            const extraPhotos = session.photos.filter(p => !slotPhotoIds.has(p.id))
                                            return (
                                                <div key={session.id || sIdx} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
                                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <h4 className="font-extrabold text-slate-900 text-sm">{dateDisplay}</h4>
                                                            {session.branch && (
                                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-50 text-ayumi-primary">
                                                                    {session.branch}
                                                                </span>
                                                            )}
                                                            <span className="text-[11px] text-slate-400">{session.photos.length} foto</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => openPositionEditor(session.photos[0])}
                                                                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                                                            >
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                                Atur Posisi Foto
                                                            </button>
                                                            {session.id && (
                                                                <Link
                                                                    href={`/treatment-records/${session.id}`}
                                                                    className="text-xs font-bold text-ayumi-primary hover:underline"
                                                                >
                                                                    Rekam Medis (SOAP) →
                                                                </Link>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                                                        {(() => {
                                                            const slotTile = (slot) => {
                                                                const photo = session.photos.find(p => getPhotoAngleCategory(p.caption, p.storage_path) === slot.key)
                                                                return photo
                                                                    ? renderPhotoTile({ key: slot.key, photo, badge: slot.short })
                                                                    : renderEmptyTile({ key: slot.key, label: slot.label })
                                                            }
                                                            const hasSide = session.photos.some(p => ['kiri', 'kanan'].includes(getPhotoAngleCategory(p.caption, p.storage_path)))
                                                            const swapping = swappingSessionKey === session.key
                                                            return (
                                                                <>
                                                                    {slotTile(angleSpecs[0])}
                                                                    {/* Kiri & Kanan dengan tombol tukar di tengahnya */}
                                                                    <div className="col-span-2 relative grid grid-cols-2 gap-2.5 sm:gap-4">
                                                                        {slotTile(angleSpecs[1])}
                                                                        {slotTile(angleSpecs[2])}
                                                                        {hasSide && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => swapSessionSides(session)}
                                                                                disabled={swapping}
                                                                                className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white text-slate-800 border-2 border-slate-200 shadow-lg hover:bg-ayumi-primary hover:text-white hover:border-ayumi-primary flex items-center justify-center transition-colors cursor-pointer disabled:opacity-70"
                                                                                title="Tukar foto Samping Kiri dan Samping Kanan"
                                                                                aria-label="Tukar foto Samping Kiri dan Samping Kanan"
                                                                            >
                                                                                <svg className={`w-5 h-5 ${swapping ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </>
                                                            )
                                                        })()}
                                                        {extraPhotos.map(photo => renderPhotoTile({
                                                            key: photo.id,
                                                            photo,
                                                            badge: formatPhotoLabel(photo.caption, photo.storage_path)
                                                        }))}
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })()}

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
                            const validTxs = patientTransactions.filter(tx => tx.payment_status === 'paid')
                            const ltv = validTxs.reduce((sum, tx) => sum + Number(tx.total || 0), 0)
                            const avgVisit = validTxs.length > 0 ? ltv / validTxs.length : 0
                            const lastTx = validTxs[0] || null

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
                                                <tr key={tx.id} className={`hover:bg-gray-50/50 transition-colors ${tx.payment_status === 'void' ? 'opacity-70 bg-rose-50/20' : ''}`}>
                                                    <td className="p-3 font-bold text-gray-800 ">
                                                        <span className={tx.payment_status === 'void' ? 'line-through text-gray-400' : ''}>{tx.transaction_number}</span>
                                                    </td>
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
                                                        <div className="flex items-center justify-center gap-1">
                                                            <span className="bg-pink-50 text-ayumi-primary border border-pink-100 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">{tx.payment_method}</span>
                                                            {tx.payment_status === 'void' && (
                                                                <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded text-[9px] font-black uppercase">VOID</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className={`p-3 text-right font-bold ${tx.payment_status === 'void' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                                                        Rp {tx.total.toLocaleString('id-ID')}
                                                    </td>
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
                                    const allDone = coupon.patient_coupon_items && coupon.patient_coupon_items.length > 0 && coupon.patient_coupon_items.every(i => i.remaining_sessions <= 0 || i.status === 'fully_used' || i.status === 'completed')
                                    const currentStatus = allDone ? 'fully_used' : (new Date(coupon.expired_at) < new Date() ? 'expired' : coupon.status)
                                    let badgeClass = "bg-gray-100 text-gray-500 border border-gray-200"
                                    let badgeLabel = "Fully Used"
                                    if (currentStatus === 'active') {
                                        badgeClass = "bg-green-100 text-green-700 border border-green-200"
                                        badgeLabel = "Active"
                                    } else if (currentStatus === 'expired') {
                                        badgeClass = "bg-red-100 text-red-700 border border-red-200"
                                        badgeLabel = "Expired"
                                    }
                                    
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
                                                    {badgeLabel}
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

                        {/* Riwayat Penggunaan Kupon Pasien Ini */}
                        <div className="mt-8 pt-6 border-t border-gray-100">
                            <h4 className="text-base font-bold text-ayumi-secondary mb-4 flex items-center gap-2">
                                <span>📜 Riwayat Penggunaan / Klaim Sesi Kupon Pasien Ini</span>
                            </h4>
                            {couponLogs.length === 0 ? (
                                <div className="text-center p-6 bg-gray-50 rounded-2xl text-xs text-gray-500 font-semibold">
                                    Belum ada riwayat sesi kupon yang digunakan oleh pasien ini.
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
                                    <table className="whitespace-nowrap w-full text-left text-xs">
                                        <thead className="bg-pink-50/60 text-ayumi-secondary uppercase font-extrabold">
                                            <tr>
                                                <th className="p-3">Waktu Klaim</th>
                                                <th className="p-3">Treatment (Klaim)</th>
                                                <th className="p-3">Paket Asal</th>
                                                <th className="p-3">Cabang</th>
                                                <th className="p-3">Diproses Oleh</th>
                                                <th className="p-3">Catatan</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white font-medium text-gray-700">
                                            {couponLogs.map(log => (
                                                <tr key={log.id} className="hover:bg-pink-50/20">
                                                    <td className="p-3 font-semibold text-gray-600">
                                                        {new Date(log.used_at || log.created_at).toLocaleString('id-ID')}
                                                    </td>
                                                    <td className="p-3 font-extrabold text-ayumi-primary">
                                                        {log.patient_coupon_items?.treatments?.name || '-'}
                                                    </td>
                                                    <td className="p-3 text-gray-600 font-semibold">
                                                        {log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || '-'}
                                                    </td>
                                                    <td className="p-3 text-gray-600 font-semibold">{log.branches?.name || '-'}</td>
                                                    <td className="p-3 text-gray-600 font-semibold">{log.users?.full_name || 'Kasir'}</td>
                                                    <td className="p-3 text-gray-500 italic">{log.notes || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Modal Hapus Pasien */}
            {deleteModal.isOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !isDeleting && setDeleteModal({ isOpen: false, confirmName: '' })}>
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900">Hapus Data Pasien</h3>
                        </div>

                        {hasPatientHistory ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 space-y-1">
                                <p className="font-bold">Pasien ini tidak bisa dihapus.</p>
                                <p>
                                    Sudah ada riwayat: {[
                                        patientTransactions.length > 0 && `${patientTransactions.length} transaksi`,
                                        treatmentHistory.length > 0 && `${treatmentHistory.length} treatment`,
                                        patientCoupons.length > 0 && `${patientCoupons.length} kupon paket`
                                    ].filter(Boolean).join(', ')}. Riwayat ini dipakai laporan omzet dan komisi, jadi datanya harus tetap ada.
                                </p>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-gray-600">
                                    Data pasien <span className="font-bold text-gray-900">{patient.full_name}</span> akan dihapus permanen,
                                    beserta jadwal, antrean follow-up CRM, dan fotonya. Tindakan ini tidak bisa dibatalkan.
                                </p>
                                <label className="block text-xs font-semibold text-gray-500 mt-4 mb-1.5">
                                    Ketik nama pasien untuk konfirmasi
                                </label>
                                <input
                                    type="text"
                                    value={deleteModal.confirmName}
                                    onChange={(e) => setDeleteModal(prev => ({ ...prev, confirmName: e.target.value }))}
                                    placeholder={patient.full_name}
                                    className="input-ayumi focus:bg-white"
                                    autoFocus
                                />
                            </>
                        )}

                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                type="button"
                                onClick={() => setDeleteModal({ isOpen: false, confirmName: '' })}
                                disabled={isDeleting}
                                className="px-5 py-2.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer"
                            >
                                {hasPatientHistory ? 'Tutup' : 'Batal'}
                            </button>
                            {!hasPatientHistory && (
                                <button
                                    type="button"
                                    onClick={handleDeletePatient}
                                    disabled={isDeleting || deleteModal.confirmName.trim().toLowerCase() !== (patient.full_name || '').trim().toLowerCase()}
                                    className="px-5 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                                >
                                    {isDeleting ? 'Menghapus...' : 'Hapus Permanen'}
                                </button>
                            )}
                        </div>
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
            {/* Modal Atur Posisi Foto (per sesi) */}
            {positionEditor && (
                <div
                    className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm"
                    onClick={() => !isSavingPositions && setPositionEditor(null)}
                >
                    <div
                        className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[94vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="font-extrabold text-slate-900">Atur Posisi Foto</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{positionEditor.title} · putar foto agar tegak, lalu pastikan sudutnya benar</p>
                            </div>
                            {Object.values(positionEditor.drafts).some(d => d.angle === 'kiri' || d.angle === 'kanan') && (
                                <button
                                    type="button"
                                    onClick={swapDraftSides}
                                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                                >
                                    ⇄ Tukar Kiri–Kanan
                                </button>
                            )}
                        </div>

                        <div className="p-4 sm:p-5 overflow-y-auto">
                            {(() => {
                                const used = Object.values(positionEditor.drafts).map(d => d.angle).filter(a => a !== 'other')
                                const dup = ['depan', 'kiri', 'kanan'].filter(a => used.filter(u => u === a).length > 1)
                                return dup.length > 0 && (
                                    <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                        Ada lebih dari satu foto bersudut {dup.map(a => ({ depan: 'Depan', kiri: 'Kiri', kanan: 'Kanan' })[a]).join(' dan ')}. Boleh disimpan, tapi pastikan memang begitu.
                                    </p>
                                )
                            })()}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {positionEditor.ids
                                    .map(id => {
                                        const photo = photos.find(p => p.id === id)
                                        const draft = positionEditor.drafts[id]
                                        if (!photo) return null
                                        return (
                                            <div key={id} className="rounded-2xl border border-slate-200 p-3 space-y-3">
                                                <div className="grid grid-cols-3 p-0.5 bg-slate-100 rounded-xl">
                                                    {[
                                                        { key: 'depan', label: 'Depan' },
                                                        { key: 'kiri', label: 'Kiri' },
                                                        { key: 'kanan', label: 'Kanan' }
                                                    ].map(a => (
                                                        <button
                                                            key={a.key}
                                                            type="button"
                                                            onClick={() => setDraftAngle(id, a.key)}
                                                            className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                                draft.angle === a.key ? 'bg-white text-ayumi-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'
                                                            }`}
                                                        >
                                                            {a.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <RotatedPhoto
                                                    src={photo.fullUrl}
                                                    alt={formatPhotoLabel(photo.caption, photo.storage_path)}
                                                    rotation={draft.rotation}
                                                    className="w-full max-w-[280px] mx-auto rounded-xl bg-slate-900"
                                                />
                                                <div className="grid grid-cols-2 gap-2">
                                                    {[
                                                        { delta: -90, label: 'Putar Kiri', path: 'M3 10h11a5 5 0 015 5v2M3 10l5-5M3 10l5 5' },
                                                        { delta: 90, label: 'Putar Kanan', path: 'M21 10H10a5 5 0 00-5 5v2m16-7l-5-5m5 5l-5 5' }
                                                    ].map(btn => (
                                                        <button
                                                            key={btn.delta}
                                                            type="button"
                                                            onClick={() => rotateDraft(id, btn.delta)}
                                                            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={btn.path} /></svg>
                                                            {btn.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    })}
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPositionEditor(null)}
                                disabled={isSavingPositions}
                                className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={savePositions}
                                disabled={isSavingPositions}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-ayumi-primary hover:opacity-90 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                            >
                                {isSavingPositions ? 'Menyimpan...' : 'Simpan Posisi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal Zoom / Preview Foto Dokumentasi */}
            {selectedPhotoZoom && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
                    onClick={() => setSelectedPhotoZoom(null)}
                >
                    <div
                        className="bg-white rounded-3xl overflow-hidden max-w-xl w-full shadow-2xl flex flex-col max-h-[94vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                            <div className="min-w-0">
                                <h4 className="font-bold text-gray-900 text-sm">
                                    {formatPhotoLabel(selectedPhotoZoom.caption, selectedPhotoZoom.storage_path)}
                                </h4>
                                <p className="text-xs text-gray-500 mt-0.5 truncate">
                                    {selectedPhotoZoom.treatment_records?.treatment_date
                                        ? new Date(selectedPhotoZoom.treatment_records.treatment_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                                        : new Date(selectedPhotoZoom.created_at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                    {selectedPhotoZoom.treatment_records?.branches?.name && ` • ${selectedPhotoZoom.treatment_records.branches.name}`}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedPhotoZoom(null)}
                                className="text-gray-400 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="bg-slate-950 flex items-center justify-center p-3">
                            <RotatedPhoto
                                src={selectedPhotoZoom.fullUrl}
                                alt={selectedPhotoZoom.caption || 'Foto Dokumentasi'}
                                rotation={selectedPhotoZoom.rotation}
                                className="w-[min(100%,calc(66vh*3/4))]"
                            />
                        </div>
                        <div className="px-4 py-3 bg-white border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => openPositionEditor(selectedPhotoZoom)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Atur Posisi Foto
                            </button>
                            {selectedPhotoZoom.treatment_record_id && (
                                <Link
                                    href={`/treatment-records/${selectedPhotoZoom.treatment_record_id}`}
                                    className="text-xs font-bold text-ayumi-primary hover:underline"
                                >
                                    Buka Rekam Medis (SOAP) →
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
