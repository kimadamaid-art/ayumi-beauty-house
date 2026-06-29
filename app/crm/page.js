'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

export default function CRMPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [activeTab, setActiveTab] = useState('queue')
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    // Data states
    const [queue, setQueue] = useState([])
    const [birthdays, setBirthdays] = useState([])
    const [dormant, setDormant] = useState([])
    const [logs, setLogs] = useState([])
    const [allPatients, setAllPatients] = useState([])

    // Modal States
    const [showOutcomeModal, setShowOutcomeModal] = useState(false)
    const [selectedQueueId, setSelectedQueueId] = useState(null)
    const [selectedPatientId, setSelectedPatientId] = useState(null)
    const [selectedBranchId, setSelectedBranchId] = useState(null)
    const [outcomeForm, setOutcomeForm] = useState({ outcome: 'responded', notes: '' })

    const [showRescheduleModal, setShowRescheduleModal] = useState(false)
    const [rescheduleDate, setRescheduleDate] = useState('')

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)
        
        let userBranchId = null
        let isOwner = false

        if (user) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
            if (userData) {
                isOwner = userData.role === 'owner'
                userBranchId = userData.branch_id
            } else {
                isOwner = true
            }
        }

        const todayDateStr = new Date().toISOString().split('T')[0]

        // 1. Fetch Follow Up Queue (pending or rescheduled, scheduled_date <= today)
        let qQuery = supabase
            .from('followup_queue')
            .select(`
                *,
                patients!inner(full_name, whatsapp),
                treatment_records (treatment_date, branch_id)
            `)
            .in('status', ['pending', 'rescheduled'])
            .lte('scheduled_date', todayDateStr)

        const { data: rawQData } = await qQuery.order('priority', { ascending: false })
            
        let qData = []
        if (rawQData) {
            if (!isOwner && userBranchId) {
                // Filter where the followup belongs to the user's branch
                // A followup belongs to user's branch if its explicitly set, or if its tied to a treatment at that branch, or if patient's branch is that branch (fallback)
                qData = rawQData.filter(q => {
                    if (q.branch_id === userBranchId) return true
                    if (q.treatment_records && q.treatment_records.branch_id === userBranchId) return true
                    if (!q.branch_id && !q.treatment_records && q.patients.branch_id === userBranchId) return true
                    return false
                })
            } else {
                qData = rawQData
            }
        }
            
        if (qData && qData.length > 0) {
            // Sort manually: high > medium > low
            const priorityWeight = { high: 3, normal: 2, medium: 2, low: 1 }
            qData.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0))
            setQueue(qData)
        }

        // 2. Fetch Patients for Birthdays
        let pQuery = supabase.from('patients').select('id, full_name, whatsapp, birth_date').eq('is_active', true).not('birth_date', 'is', null)
        if (!isOwner && userBranchId) {
            pQuery = pQuery.eq('branch_id', userBranchId)
        }
        const { data: pData } = await pQuery
        if (pData) {
            setAllPatients(pData)
            const today = new Date()
            today.setHours(0,0,0,0)
            
            const upcoming = pData.map(pt => {
                const bDate = new Date(pt.birth_date)
                const thisYearBday = new Date(today.getFullYear(), bDate.getMonth(), bDate.getDate())
                
                // If birthday passed this year, look at next year
                if (thisYearBday < today) {
                    thisYearBday.setFullYear(today.getFullYear() + 1)
                }
                
                const diffTime = Math.abs(thisYearBday - today)
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                const age = thisYearBday.getFullYear() - bDate.getFullYear()
                
                return { ...pt, nextBday: thisYearBday, diffDays, age }
            }).filter(pt => pt.diffDays <= 7).sort((a, b) => a.diffDays - b.diffDays)
            
            setBirthdays(upcoming)
        }

        // 3. Fetch Treatment Records for Dormant
        // We fetch all latest treatments for all patients, then filter by branch_id if needed
        let trQuery = supabase.from('treatment_records').select('patient_id, treatment_date, branch_id, patients!inner(full_name, whatsapp)')
        
        const { data: trData } = await trQuery
        if (trData) {
            // Group by patient_id to find latest date overall
            const latestRecords = {}
            trData.forEach(r => {
                if (!r.patients) return
                const d = new Date(r.treatment_date)
                if (!latestRecords[r.patient_id] || d > latestRecords[r.patient_id].date) {
                    latestRecords[r.patient_id] = {
                        patient_id: r.patient_id,
                        full_name: r.patients.full_name,
                        whatsapp: r.patients.whatsapp,
                        branch_id: r.branch_id, // The branch of the latest treatment
                        date: d,
                        dateStr: r.treatment_date
                    }
                }
            })

            const today = new Date()
            let dormantList = Object.values(latestRecords).map(r => {
                const diffTime = Math.abs(today - r.date)
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                return { ...r, diffDays }
            }).filter(r => r.diffDays > 90) // > 90 days = Dormant
            
            // Filter out patients who did not have their LAST treatment at the user's branch
            if (!isOwner && userBranchId) {
                dormantList = dormantList.filter(r => r.branch_id === userBranchId)
            }

            dormantList.sort((a, b) => b.diffDays - a.diffDays) // sort by longest dormant

            setDormant(dormantList)
        }

        // 4. Fetch Logs for Analytics (Current Month)
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
        let logsQuery = supabase
            .from('followup_logs')
            .select('*')
            .gte('created_at', firstDayOfMonth)
        if (!isOwner && userBranchId) {
            logsQuery = logsQuery.eq('branch_id', userBranchId)
        }
        const { data: logData } = await logsQuery
            
        if (logData) setLogs(logData)

        setLoading(false)
    }

    const handleSelesaiClick = (q) => {
        setSelectedQueueId(q.id)
        setSelectedPatientId(q.patient_id)
        setSelectedBranchId(q.branch_id || (q.treatment_records && q.treatment_records.branch_id) || null)
        setShowOutcomeModal(true)
    }

    const handleTundaClick = (q) => {
        setSelectedQueueId(q.id)
        setShowRescheduleModal(true)
    }

    const submitOutcome = async () => {
        if (!outcomeForm.outcome) return
        
        // 1. Insert Log
        await supabase.from('followup_logs').insert([{
            followup_queue_id: selectedQueueId,
            patient_id: selectedPatientId,
            branch_id: selectedBranchId,
            performed_by: user?.id,
            followup_type: 'treatment_reminder', // Fallback, could fetch from queue
            channel: 'whatsapp',
            outcome: outcomeForm.outcome,
            notes: outcomeForm.notes,
            performed_at: new Date().toISOString()
        }])

        // 2. Update Queue
        await supabase.from('followup_queue').update({
            status: 'done',
            completed_by: user?.id,
            completed_at: new Date().toISOString()
        }).eq('id', selectedQueueId)

        setShowOutcomeModal(false)
        setOutcomeForm({ outcome: 'responded', notes: '' })
        toast.success('Follow up berhasil diselesaikan!')
        fetchData() // Refresh
    }

    const submitReschedule = async () => {
        if (!rescheduleDate) return
        
        await supabase.from('followup_queue').update({
            status: 'rescheduled',
            rescheduled_to: rescheduleDate,
            scheduled_date: rescheduleDate // Update scheduled_date so it hides from today
        }).eq('id', selectedQueueId)

        setShowRescheduleModal(false)
        setRescheduleDate('')
        toast.success('Follow up berhasil ditunda.')
        fetchData()
    }

    const handleManualFollowup = async (dormantPatient) => {
        await supabase.from('followup_queue').insert([{
            patient_id: dormantPatient.patient_id,
            branch_id: dormantPatient.branch_id, // ensure it's assigned to the branch of their last treatment
            followup_type: 'dormant_reminder',
            scheduled_date: new Date().toISOString().split('T')[0],
            priority: 'high',
            status: 'pending',
            created_by: user?.id
        }])
        toast.success('Follow up manual berhasil ditambahkan ke antrean hari ini.')
        fetchData()
    }

    // Analytics Calculations
    const totalLogs = logs.length
    const respondedCount = logs.filter(l => l.outcome === 'responded' || l.outcome === 'booked').length
    const bookedCount = logs.filter(l => l.outcome === 'booked').length
    
    const responseRate = totalLogs > 0 ? Math.round((respondedCount / totalLogs) * 100) : 0
    const conversionRate = totalLogs > 0 ? Math.round((bookedCount / totalLogs) * 100) : 0

    return (
        <div className="space-y-6">
            {/* TABS */}
            <div className="flex overflow-x-auto gap-2 p-1 bg-white rounded-2xl shadow-sm border border-gray-100">
                <button 
                    onClick={() => setActiveTab('queue')}
                    className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'queue' ? 'bg-ayumi-primary text-white shadow-md' : 'text-gray-500 hover:bg-pink-50 hover:text-ayumi-primary'}`}
                >
                    Follow Up Queue
                    {queue.length > 0 && <span className="ml-2 bg-white text-ayumi-primary px-2 py-0.5 rounded-full text-xs">{queue.length}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('birthday')}
                    className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'birthday' ? 'bg-ayumi-primary text-white shadow-md' : 'text-gray-500 hover:bg-pink-50 hover:text-ayumi-primary'}`}
                >
                    Birthday
                    {birthdays.length > 0 && <span className="ml-2 bg-pink-100 text-ayumi-primary px-2 py-0.5 rounded-full text-xs">{birthdays.length}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('dormant')}
                    className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'dormant' ? 'bg-ayumi-primary text-white shadow-md' : 'text-gray-500 hover:bg-pink-50 hover:text-ayumi-primary'}`}
                >
                    Dormant
                </button>
                <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'analytics' ? 'bg-ayumi-primary text-white shadow-md' : 'text-gray-500 hover:bg-pink-50 hover:text-ayumi-primary'}`}
                >
                    Analytics
                </button>
            </div>

            {/* CONTENT */}
            <div className="card-ayumi min-h-[500px]">
                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                        <p className="text-gray-500 font-medium">Memuat data CRM...</p>
                    </div>
                ) : (
                    <>
                        {/* TAB: QUEUE */}
                        {activeTab === 'queue' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-bold text-ayumi-secondary mb-4">Harus Dihubungi Hari Ini</h3>
                                {queue.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                        <p className="text-gray-500 font-medium">Tidak ada antrean follow-up untuk hari ini. Luar biasa! 🎉</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="whitespace-nowrap w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-ayumi-table-header text-ayumi-secondary text-sm">
                                                    <th className="p-4 font-bold rounded-tl-xl">Pasien</th>
                                                    <th className="p-4 font-bold">Terakhir Ttmt</th>
                                                    <th className="p-4 font-bold">Jenis / Prioritas</th>
                                                    <th className="p-4 font-bold text-center rounded-tr-xl">Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {queue.map(q => (
                                                    <tr key={q.id} className="border-b border-gray-50 hover:bg-ayumi-table-hover">
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-800">{q.patients?.full_name}</div>
                                                            <div className="text-sm text-gray-500">{q.patients?.whatsapp}</div>
                                                        </td>
                                                        <td className="p-4 text-sm text-gray-600">
                                                            {q.treatment_records?.treatment_date || '-'}
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="text-sm font-semibold text-ayumi-secondary uppercase">{q.followup_type?.replace('_', ' ')}</div>
                                                            <div className={`text-xs font-bold inline-block px-2 py-0.5 rounded-md mt-1 ${q.priority === 'high' ? 'bg-red-100 text-red-700' : (q.priority === 'normal' || q.priority === 'medium') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                                                {q.priority}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <a href={`https://wa.me/${q.patients?.whatsapp}`} target="_blank" rel="noreferrer" className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                                                    Buka WA
                                                                </a>
                                                                <button onClick={() => handleSelesaiClick(q)} className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                                                    Selesai
                                                                </button>
                                                                <button onClick={() => handleTundaClick(q)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                                                    Tunda
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB: BIRTHDAY */}
                        {activeTab === 'birthday' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-bold text-ayumi-secondary mb-4">Ulang Tahun (7 Hari ke Depan)</h3>
                                {birthdays.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                        <p className="text-gray-500 font-medium">Tidak ada pasien yang berulang tahun dalam 7 hari ke depan.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {birthdays.map(pt => (
                                            <div key={pt.id} className="bg-pink-50 p-5 rounded-2xl border border-pink-100 flex justify-between items-center">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="bg-pink-200 text-ayumi-primary text-xs font-bold px-2 py-0.5 rounded-full">
                                                            {pt.diffDays === 0 ? 'HARI INI!' : `H-${pt.diffDays}`}
                                                        </span>
                                                        <span className="text-sm font-semibold text-gray-500">
                                                            {new Date(pt.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}
                                                        </span>
                                                    </div>
                                                    <h4 className="font-bold text-gray-800 text-lg">{pt.full_name}</h4>
                                                    <p className="text-sm text-ayumi-primary font-medium">Ulang tahun ke-{pt.age}</p>
                                                </div>
                                                <a href={`https://wa.me/${pt.whatsapp}?text=Halo%20${pt.full_name},%20Selamat%20Ulang%20Tahun!`} target="_blank" rel="noreferrer" className="bg-green-100 hover:bg-green-200 text-green-700 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 shadow-sm">
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                    Kirim WA
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB: DORMANT */}
                        {activeTab === 'dormant' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-bold text-ayumi-secondary mb-4">Pasien Dormant (&gt;90 Hari Tidak Datang)</h3>
                                {dormant.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                        <p className="text-gray-500 font-medium">Bagus! Semua pasien masih aktif berkunjung.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="whitespace-nowrap w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-ayumi-table-header text-ayumi-secondary text-sm">
                                                    <th className="p-4 font-bold rounded-tl-xl">Pasien</th>
                                                    <th className="p-4 font-bold">Kunjungan Terakhir</th>
                                                    <th className="p-4 font-bold">Lama Menghilang</th>
                                                    <th className="p-4 font-bold text-center rounded-tr-xl">Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dormant.map(d => (
                                                    <tr key={d.patient_id} className="border-b border-gray-50 hover:bg-ayumi-table-hover">
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-800">{d.full_name}</div>
                                                            <div className="text-sm text-gray-500">{d.whatsapp}</div>
                                                        </td>
                                                        <td className="p-4 text-sm text-gray-600">
                                                            {new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                        </td>
                                                        <td className="p-4">
                                                            <span className="text-red-600 font-bold">{d.diffDays} Hari</span>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <a href={`https://wa.me/${d.whatsapp}`} target="_blank" rel="noreferrer" className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                                                    Buka WA
                                                                </a>
                                                                <button onClick={() => handleManualFollowup(d)} className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                                                    Buat Follow Up
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB: ANALYTICS */}
                        {activeTab === 'analytics' && (
                            <div className="space-y-6">
                                <h3 className="text-lg font-bold text-ayumi-secondary mb-4">Performa Follow Up (Bulan Ini)</h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
                                        <div className="text-4xl font-extrabold text-ayumi-primary mb-2">{totalLogs}</div>
                                        <div className="text-sm font-semibold text-gray-500">Total Follow Up Selesai</div>
                                    </div>
                                    <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
                                        <div className="text-4xl font-extrabold text-blue-500 mb-2">{responseRate}%</div>
                                        <div className="text-sm font-semibold text-gray-500">Response Rate (Pasien Merespons)</div>
                                    </div>
                                    <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
                                        <div className="text-4xl font-extrabold text-green-500 mb-2">{conversionRate}%</div>
                                        <div className="text-sm font-semibold text-gray-500">Conversion Rate (Booking Baru)</div>
                                    </div>
                                </div>

                                <div className="bg-gray-50 rounded-2xl p-4 md:p-6 border border-gray-100">
                                    <h4 className="font-bold text-gray-700 mb-4">Grafik Outcome Bulan Ini</h4>
                                    <div className="flex flex-wrap gap-4">
                                        {['responded', 'no_response', 'booked', 'not_interested', 'wrong_number'].map(out => {
                                            const count = logs.filter(l => l.outcome === out).length
                                            const pct = totalLogs > 0 ? (count / totalLogs) * 100 : 0
                                            return (
                                                <div key={out} className="w-full flex items-center gap-4">
                                                    <div className="w-32 text-sm font-semibold text-gray-600 capitalize">{out.replace('_', ' ')}</div>
                                                    <div className="flex-1 bg-gray-200 h-6 rounded-full overflow-hidden">
                                                        <div className="bg-ayumi-primary h-full" style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                    <div className="w-10 text-right text-sm font-bold text-gray-700">{count}</div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal Outcome (Selesai) */}
            {showOutcomeModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-sm w-full p-5 md:p-8 shadow-2xl border border-gray-100">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Hasil Follow Up</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Outcome *</label>
                                <select 
                                    value={outcomeForm.outcome}
                                    onChange={e => setOutcomeForm({...outcomeForm, outcome: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50"
                                >
                                    <option value="responded">Responded</option>
                                    <option value="no_response">No Response</option>
                                    <option value="booked">Booked (Janji Temu Baru)</option>
                                    <option value="not_interested">Not Interested</option>
                                    <option value="wrong_number">Wrong Number</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Catatan</label>
                                <textarea 
                                    value={outcomeForm.notes}
                                    onChange={e => setOutcomeForm({...outcomeForm, notes: e.target.value})}
                                    rows="3"
                                    className="input-ayumi focus:bg-gray-50 resize-none"
                                    placeholder="Detail percakapan..."
                                ></textarea>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6">
                            <button onClick={() => setShowOutcomeModal(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                                Batal
                            </button>
                            <button onClick={submitOutcome} className="btn-primary px-5 py-2.5">
                                Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Reschedule (Tunda) */}
            {showRescheduleModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-sm w-full p-5 md:p-8 shadow-2xl border border-gray-100">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Tunda Follow Up</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Pilih Tanggal Baru *</label>
                                <input 
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={e => setRescheduleDate(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6">
                            <button onClick={() => setShowRescheduleModal(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                                Batal
                            </button>
                            <button onClick={submitReschedule} className="btn-primary px-5 py-2.5">
                                Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
