'use client'

import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'

export default function CRMPage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [activeTab, setActiveTab] = useState('queue')
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    // Auth & Branch States
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [branches, setBranches] = useState([])

    // Data states
    const [queue, setQueue] = useState([])
    const [birthdays, setBirthdays] = useState([])
    const [dormant, setDormant] = useState([])
    const [logs, setLogs] = useState([])
    const [allPatients, setAllPatients] = useState([])

    // Search & Filter states
    const [searchTerm, setSearchTerm] = useState('')
    const [priorityFilter, setPriorityFilter] = useState('All')
    const [branchFilter, setBranchFilter] = useState('All')

    // Modal States
    const [showOutcomeModal, setShowOutcomeModal] = useState(false)
    const [selectedQueueId, setSelectedQueueId] = useState(null)
    const [selectedPatientId, setSelectedPatientId] = useState(null)
    const [selectedBranchId, setSelectedBranchId] = useState(null)
    const [outcomeForm, setOutcomeForm] = useState({ outcome: 'responded', notes: '' })

    const [showRescheduleModal, setShowRescheduleModal] = useState(false)
    const [rescheduleDate, setRescheduleDate] = useState('')

    // WhatsApp template modal states
    const [showWaModal, setShowWaModal] = useState(false)
    const [waForm, setWaForm] = useState({
        queueId: null,
        patientId: '',
        patientName: '',
        whatsapp: '',
        message: '',
        templateType: 'treatment_reminder',
        branchId: null,
        outcome: 'responded',
        notes: ''
    })

    // Manual follow-up modal states
    const [showManualModal, setShowManualModal] = useState(false)

    // Bulk WA Send states
    const [selectedBirthdayIds, setSelectedBirthdayIds] = useState([])
    const [selectedDormantIds, setSelectedDormantIds] = useState([])
    const [bulkQueue, setBulkQueue] = useState([]) // list of patient objects for bulk processing
    const [bulkIndex, setBulkIndex] = useState(0)
    const [showBulkWaModal, setShowBulkWaModal] = useState(false)
    const [bulkTemplate, setBulkTemplate] = useState('birthday')
    const [bulkForm, setBulkForm] = useState({
        message: '',
        outcome: 'responded',
        notes: ''
    })
    const [manualForm, setManualForm] = useState({
        patientId: '',
        branchId: '',
        followupType: 'treatment_reminder',
        scheduledDate: '',
        priority: 'normal',
        notes: ''
    })
    const [patientSearch, setPatientSearch] = useState('')
    const [showPatientDropdown, setShowPatientDropdown] = useState(false)

    useEffect(() => {
        fetchData()
    }, [])

    // Set default date when manual modal is opened
    useEffect(() => {
        if (showManualModal) {
            setManualForm(prev => ({
                ...prev,
                scheduledDate: new Date().toISOString().split('T')[0],
                branchId: userBranchId || ''
            }))
        }
    }, [showManualModal, userBranchId])

    const fetchData = async () => {
        setLoading(true)
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        setUser(currentUser)
        
        let userBranch = null
        let ownerFlag = false

        if (currentUser) {
            const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', currentUser.id).maybeSingle()
            if (userData) {
                ownerFlag = userData.role === 'owner'
                userBranch = userData.branch_id
            } else {
                ownerFlag = true
            }
        }
        setIsOwner(ownerFlag)
        setUserBranchId(userBranch)

        if (ownerFlag) {
            const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
            if (brData) setBranches(brData)
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
            if (!ownerFlag && userBranch) {
                qData = rawQData.filter(q => {
                    if (q.branch_id === userBranch) return true
                    if (q.treatment_records && q.treatment_records.branch_id === userBranch) return true
                    if (!q.branch_id && !q.treatment_records && q.patients.branch_id === userBranch) return true
                    return false
                })
            } else {
                qData = rawQData
            }
        }
            
        if (qData) {
            const priorityWeight = { high: 3, normal: 2, medium: 2, low: 1 }
            qData.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0))
            setQueue(qData)
        }

        // 2. Fetch Patients for Birthdays
        let pQuery = supabase.from('patients').select('id, full_name, whatsapp, birth_date, branch_id').eq('is_active', true).not('birth_date', 'is', null)
        if (!ownerFlag && userBranch) {
            pQuery = pQuery.eq('branch_id', userBranch)
        }
        const { data: pData } = await pQuery
        if (pData) {
            const today = new Date()
            today.setHours(0,0,0,0)
            
            const upcoming = pData.map(pt => {
                const bDate = new Date(pt.birth_date)
                const thisYearBday = new Date(today.getFullYear(), bDate.getMonth(), bDate.getDate())
                
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
        let trQuery = supabase.from('treatment_records').select('patient_id, treatment_date, branch_id, patients!inner(full_name, whatsapp)')
        const { data: trData } = await trQuery
        if (trData) {
            const latestRecords = {}
            trData.forEach(r => {
                if (!r.patients) return
                const d = new Date(r.treatment_date)
                if (!latestRecords[r.patient_id] || d > latestRecords[r.patient_id].date) {
                    latestRecords[r.patient_id] = {
                        patient_id: r.patient_id,
                        full_name: r.patients.full_name,
                        whatsapp: r.patients.whatsapp,
                        branch_id: r.branch_id,
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
            }).filter(r => r.diffDays > 90)
            
            if (!ownerFlag && userBranch) {
                dormantList = dormantList.filter(r => r.branch_id === userBranch)
            }

            dormantList.sort((a, b) => b.diffDays - a.diffDays)
            setDormant(dormantList)
        }

        // 4. Fetch All Active Patients (for manual follow-up selection)
        let allPQuery = supabase.from('patients').select('id, full_name, whatsapp, branch_id').eq('is_active', true)
        if (!ownerFlag && userBranch) {
            allPQuery = allPQuery.eq('branch_id', userBranch)
        }
        const { data: allPData } = await allPQuery
        if (allPData) {
            setAllPatients(allPData)
        }

        // 5. Fetch Logs for Analytics (Current Month)
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
        let logsQuery = supabase
            .from('followup_logs')
            .select('*')
            .gte('created_at', firstDayOfMonth)
        if (!ownerFlag && userBranch) {
            logsQuery = logsQuery.eq('branch_id', userBranch)
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

    const handleDeleteQueue = async (id, patientName) => {
        if (!window.confirm(`Apakah Anda yakin ingin menghapus antrean follow-up untuk ${patientName}?`)) return
        
        const { error } = await supabase.from('followup_queue').delete().eq('id', id)
        if (error) {
            toast.error('Gagal menghapus antrean: ' + getFriendlyErrorMessage(error))
        } else {
            toast.success('Antrean follow-up berhasil dihapus.')
            fetchData()
        }
    }

    const submitOutcome = async () => {
        if (!outcomeForm.outcome) return
        
        await supabase.from('followup_logs').insert([{
            followup_queue_id: selectedQueueId,
            patient_id: selectedPatientId,
            branch_id: selectedBranchId || userBranchId || null,
            performed_by: user?.id,
            followup_type: 'treatment_reminder',
            channel: 'whatsapp',
            outcome: outcomeForm.outcome,
            notes: outcomeForm.notes,
            performed_at: new Date().toISOString()
        }])

        await supabase.from('followup_queue').update({
            status: 'done',
            completed_by: user?.id,
            completed_at: new Date().toISOString()
        }).eq('id', selectedQueueId)

        setShowOutcomeModal(false)
        setOutcomeForm({ outcome: 'responded', notes: '' })
        toast.success('Follow up berhasil diselesaikan!')
        fetchData()
    }

    const submitReschedule = async () => {
        if (!rescheduleDate) return
        
        await supabase.from('followup_queue').update({
            status: 'rescheduled',
            rescheduled_to: rescheduleDate,
            scheduled_date: rescheduleDate
        }).eq('id', selectedQueueId)

        setShowRescheduleModal(false)
        setRescheduleDate('')
        toast.success('Follow up berhasil ditunda.')
        fetchData()
    }

    const handleManualFollowup = async (dormantPatient) => {
        await supabase.from('followup_queue').insert([{
            patient_id: dormantPatient.patient_id,
            branch_id: dormantPatient.branch_id,
            followup_type: 'dormant_reminder',
            scheduled_date: new Date().toISOString().split('T')[0],
            priority: 'high',
            status: 'pending',
            created_by: user?.id
        }])
        toast.success('Follow up manual berhasil ditambahkan ke antrean hari ini.')
        fetchData()
    }

    // --- WHATSAPP TEMPLATES & UTILITIES ---
    const generateWaMessage = (type, patientName) => {
        switch (type) {
            case 'followup_2minggu':
                return `Hallo kak *${patientName}*, apa kabar🤗\nUdah dua minggu nih dari treatment sebelumnya ya. Aku mau tanya, gimana kondisi kulitnya setelah 2 minggu, apakah sudah terasa makin sehat dan halus?😍`
            case 'followup_3minggu':
                return `Hallo kak *${patientName}*, apa kabar🤗\nUdah genap tiga minggu dari treatment sebelumnya ya. Aku mau tanya, gimana progres hasilnya setelah treatment 3 minggu yang lalu, apakah sudah terlihat hasilnya?😍`
            case 'followup_1bulan':
                return `Halo kak *${patientName}* 🥰 gimana kabarnya? Btw udah sebulan nih dari treatment kemarin, kulitnya gimana sekarang? Semoga makin oke ya ✨\nMau aku cekin slot kosong buat kakak?🥰\n\n\nAyumi Beauty House siap melayani dan merawat kulitmu.. 💕`
            case 'reminder_besok':
                return `Halo kak *${patientName}* 😊\n\nIni dari *Ayumi Beauty House* ya kak. Mau mengingatkan bahwa kakak ada jadwal treatment *besok*. Jangan lupa datang tepat waktu ya biar treatmentnya maksimal hasilnya! ✨\n\nKalau ada perubahan jadwal, kabari kami segera ya kak. Ditunggu kedatangannya! 🥰\n\nAyumi Beauty House siap melayani dan merawat kulitmu.. 💕`
            case 'treatment_reminder':
                return `Halo Kak *${patientName}*,\n\nKami dari *Ayumi Beauty House* ingin menanyakan kabar Anda setelah perawatan terakhir. 😊\n\nSudah saatnya untuk melakukan perawatan rutin berikutnya agar kulit tetap sehat terawat dan hasilnya maksimal. ✨\n\nYuk, booking jadwal treatment Kakak kembali! Terapis kami siap melayani. Hubungi kami untuk reservasi slot ya. Terima kasih! 💖`
            case 'birthday':
                return `Halo Kak *${patientName}*,\n\n*Selamat Ulang Tahun!* 🎉🎂\n\nSebagai kado spesial di hari ulang tahun Kakak, *Ayumi Beauty House* memberikan promo potongan diskon khusus untuk treatment hari ini! 💕\n\nYuk manjakan diri di hari spesial Kakak. Hubungi kami untuk info promo selengkapnya dan reservasi slot treatment ya. Semoga sehat dan bahagia selalu! 🥰`
            case 'dormant_reminder':
                return `Halo Kak *${patientName}*,\n\nSudah cukup lama Kakak tidak berkunjung ke *Ayumi Beauty House*. Kami merindukan kehadiran Kakak! 🥰\n\nSaat ini kami sedang ada penawaran promo treatment spesial khusus untuk Kakak bulan ini. Yuk luangkan waktu untuk memanjakan diri kembali. ✨\n\nHubungi kami jika ingin berkonsultasi atau langsung booking slot ya. Ditunggu kedatangannya! 🌸`
            default:
                return `Halo Kak *${patientName}*,\n\nKami dari *Ayumi Beauty House* ingin menyapa Kakak...`
        }
    }

    const handleOpenWaModal = (item, defaultTemplate = 'treatment_reminder') => {
        const isQueueItem = !!item.id && !!item.scheduled_date
        const patientName = item.patients?.full_name || item.full_name || ''
        const whatsapp = item.patients?.whatsapp || item.whatsapp || ''
        const patientId = item.patient_id || item.id || ''
        const queueId = isQueueItem ? item.id : null
        const branchId = item.branch_id || (item.treatment_records && item.treatment_records.branch_id) || null

        // Format whatsapp format 62xxx
        let formattedWa = whatsapp.trim().replace(/[^0-9]/g, '')
        if (formattedWa.startsWith('0')) {
            formattedWa = '62' + formattedWa.slice(1)
        }

        const message = generateWaMessage(defaultTemplate, patientName)

        setWaForm({
            queueId,
            patientId,
            patientName,
            whatsapp: formattedWa,
            message,
            templateType: defaultTemplate,
            branchId,
            outcome: 'responded',
            notes: ''
        })
        setShowWaModal(true)
    }

    const handleWaTemplateChange = (type) => {
        const message = generateWaMessage(type, waForm.patientName)
        setWaForm(prev => ({ ...prev, templateType: type, message }))
    }

    const sendWhatsAppOnly = () => {
        const encodedText = encodeURIComponent(waForm.message)
        window.open(`https://wa.me/${waForm.whatsapp}?text=${encodedText}`, '_blank', 'noreferrer')
    }

    const saveWaLogOnly = async () => {
        // Insert log
        const { error: logErr } = await supabase.from('followup_logs').insert([{
            followup_queue_id: waForm.queueId,
            patient_id: waForm.patientId,
            branch_id: waForm.branchId || userBranchId || null,
            performed_by: user?.id,
            followup_type: waForm.templateType,
            channel: 'whatsapp',
            outcome: waForm.outcome,
            notes: waForm.notes,
            performed_at: new Date().toISOString()
        }])

        if (logErr) {
            toast.error('Gagal menyimpan log: ' + getFriendlyErrorMessage(logErr))
            return false
        }

        // Update queue to done if it exists
        if (waForm.queueId) {
            const { error: qErr } = await supabase.from('followup_queue').update({
                status: 'done',
                completed_by: user?.id,
                completed_at: new Date().toISOString()
            }).eq('id', waForm.queueId)

            if (qErr) {
                toast.error('Gagal memperbarui antrean: ' + getFriendlyErrorMessage(qErr))
                return false
            }
        }

        toast.success('Log follow-up berhasil disimpan!')
        setShowWaModal(false)
        fetchData()
        return true
    }

    const sendWaAndSaveLog = async () => {
        const ok = await saveWaLogOnly()
        if (ok) {
            sendWhatsAppOnly()
        }
    }

    // --- BULK WHATSAPP FOLLOW-UP ---
    const handleStartBulk = (patients, defaultTemplate) => {
        if (patients.length === 0) {
            toast.error('Tidak ada pasien terpilih.')
            return
        }
        setBulkQueue(patients)
        setBulkIndex(0)
        setBulkTemplate(defaultTemplate)
        
        const firstPatient = patients[0]
        const msg = generateWaMessage(defaultTemplate, firstPatient.full_name || '')
        setBulkForm({
            message: msg,
            outcome: 'responded',
            notes: ''
        })
        setShowBulkWaModal(true)
    }

    const handleBulkTemplateChange = (template) => {
        setBulkTemplate(template)
        const currentPatient = bulkQueue[bulkIndex]
        if (currentPatient) {
            setBulkForm(prev => ({
                ...prev,
                message: generateWaMessage(template, currentPatient.full_name || '')
            }))
        }
    }

    const handleBulkSubmit = async (sendWa = true) => {
        const currentPatient = bulkQueue[bulkIndex]
        if (!currentPatient) return

        const patientId = currentPatient.patient_id || currentPatient.id
        const whatsapp = currentPatient.whatsapp || ''
        const branchId = currentPatient.branch_id || (currentPatient.treatment_records && currentPatient.treatment_records.branch_id) || null

        let formattedWa = whatsapp.trim().replace(/[^0-9]/g, '')
        if (formattedWa.startsWith('0')) {
            formattedWa = '62' + formattedWa.slice(1)
        }

        // 1. Send WA if requested
        if (sendWa && formattedWa) {
            const encodedText = encodeURIComponent(bulkForm.message)
            window.open(`https://wa.me/${formattedWa}?text=${encodedText}`, '_blank', 'noreferrer')
        }

        // 2. Save log
        const { error: logErr } = await supabase.from('followup_logs').insert([{
            patient_id: patientId,
            branch_id: branchId || userBranchId || null,
            performed_by: user?.id,
            followup_type: bulkTemplate,
            channel: 'whatsapp',
            outcome: bulkForm.outcome,
            notes: bulkForm.notes,
            performed_at: new Date().toISOString()
        }])

        if (logErr) {
            toast.error('Gagal menyimpan log untuk ' + currentPatient.full_name + ': ' + getFriendlyErrorMessage(logErr))
            return
        }

        // 3. Next or finish
        if (bulkIndex + 1 < bulkQueue.length) {
            const nextIndex = bulkIndex + 1
            setBulkIndex(nextIndex)
            const nextPatient = bulkQueue[nextIndex]
            setBulkForm({
                message: generateWaMessage(bulkTemplate, nextPatient.full_name || ''),
                outcome: 'responded',
                notes: ''
            })
        } else {
            toast.success('Semua pesan bulk berhasil dikirim & dicatat!')
            setShowBulkWaModal(false)
            setSelectedBirthdayIds([])
            setSelectedDormantIds([])
            fetchData()
        }
    }

    // --- MANUAL FOLLOW-UP ---
    const submitManualFollowup = async (e) => {
        e.preventDefault()
        if (!manualForm.patientId) {
            toast.error('Silakan pilih pasien terlebih dahulu.')
            return
        }
        if (!manualForm.scheduledDate) {
            toast.error('Silakan tentukan tanggal penjadwalan.')
            return
        }

        const selectedPatient = allPatients.find(p => p.id === manualForm.patientId)
        const finalBranchId = manualForm.branchId || selectedPatient?.branch_id || userBranchId || null

        const { error } = await supabase.from('followup_queue').insert([{
            patient_id: manualForm.patientId,
            branch_id: finalBranchId,
            followup_type: manualForm.followupType,
            scheduled_date: manualForm.scheduledDate,
            priority: manualForm.priority,
            status: 'pending',
            notes: manualForm.notes,
            created_by: user?.id
        }])

        if (error) {
            toast.error('Gagal menjadwalkan: ' + getFriendlyErrorMessage(error))
        } else {
            toast.success('Follow-up manual berhasil dijadwalkan!')
            setShowManualModal(false)
            setManualForm({
                patientId: '',
                branchId: userBranchId || '',
                followupType: 'treatment_reminder',
                scheduledDate: new Date().toISOString().split('T')[0],
                priority: 'normal',
                notes: ''
            })
            setPatientSearch('')
            fetchData()
        }
    }

    // Filter patients autocomplete list
    const filteredPatientOptions = useMemo(() => {
        if (!patientSearch.trim()) return []
        return allPatients.filter(p => 
            p.full_name?.toLowerCase().includes(patientSearch.toLowerCase()) || 
            p.whatsapp?.includes(patientSearch)
        ).slice(0, 10)
    }, [allPatients, patientSearch])

    // --- FILTERED DATA LISTS ---
    const filteredQueue = useMemo(() => {
        return queue.filter(q => {
            const matchSearch = !searchTerm || 
                q.patients?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                q.patients?.whatsapp?.includes(searchTerm);
            const matchPriority = priorityFilter === 'All' || q.priority === priorityFilter;
            const matchBranch = branchFilter === 'All' || 
                q.branch_id === branchFilter || 
                (q.treatment_records && q.treatment_records.branch_id === branchFilter);
            return matchSearch && matchPriority && matchBranch;
        })
    }, [queue, searchTerm, priorityFilter, branchFilter])

    const filteredBirthdays = useMemo(() => {
        return birthdays.filter(pt => {
            const matchSearch = !searchTerm || 
                pt.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                pt.whatsapp?.includes(searchTerm);
            const matchBranch = branchFilter === 'All' || pt.branch_id === branchFilter;
            return matchSearch && matchBranch;
        })
    }, [birthdays, searchTerm, branchFilter])

    const filteredDormant = useMemo(() => {
        return dormant.filter(d => {
            const matchSearch = !searchTerm || 
                d.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                d.whatsapp?.includes(searchTerm);
            const matchBranch = branchFilter === 'All' || d.branch_id === branchFilter;
            return matchSearch && matchBranch;
        })
    }, [dormant, searchTerm, branchFilter])

    // Analytics Calculations
    const totalLogs = logs.length
    const respondedCount = logs.filter(l => l.outcome === 'responded' || l.outcome === 'booked').length
    const bookedCount = logs.filter(l => l.outcome === 'booked').length
    
    const responseRate = totalLogs > 0 ? Math.round((respondedCount / totalLogs) * 100) : 0
    const conversionRate = totalLogs > 0 ? Math.round((bookedCount / totalLogs) * 100) : 0

    return (
        <div className="space-y-6">
            {/* TOP BAR / ACTION ROW */}
            <div className="flex justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Modul Retensi & Follow-up Pasien</span>
                </div>
                <button
                    onClick={() => setShowManualModal(true)}
                    className="w-full sm:w-auto bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4.5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold shadow-md shadow-pink-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                    <span>Tambah Follow Up Manual</span>
                </button>
            </div>

            {/* SEGMENT TABS */}
            <div className="bg-gray-100/80 p-1.5 rounded-2xl border border-gray-200/60 shadow-inner flex flex-wrap gap-1">
                <button 
                    onClick={() => setActiveTab('queue')}
                    className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'queue' ? 'bg-white text-ayumi-primary shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    <span>📋 Antrean Follow Up</span>
                    {filteredQueue.length > 0 && <span className="bg-pink-100 text-ayumi-primary px-2 py-0.5 rounded-full text-xs font-black">{filteredQueue.length}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('birthday')}
                    className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'birthday' ? 'bg-white text-ayumi-primary shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    <span>🎂 Ulang Tahun</span>
                    {filteredBirthdays.length > 0 && <span className="bg-pink-100 text-ayumi-primary px-2 py-0.5 rounded-full text-xs font-black">{filteredBirthdays.length}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('dormant')}
                    className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'dormant' ? 'bg-white text-ayumi-primary shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    <span>💤 Pasien Dormant</span>
                    {filteredDormant.length > 0 && <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-xs font-black">{filteredDormant.length}</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === 'analytics' ? 'bg-white text-ayumi-primary shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    <span>📊 Analitik CRM</span>
                </button>
            </div>

            {/* SEARCH & FILTER CONTROLS */}
            {activeTab !== 'analytics' && (
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full md:w-80">
                        <input
                            type="text"
                            placeholder="Cari nama pasien atau WA..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input-ayumi py-2.5 pl-10 pr-4 text-sm focus:bg-gray-50"
                        />
                        <svg className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>

                    <div className="flex flex-wrap gap-4 w-full md:w-auto justify-end">
                        {/* Priority Filter (Only in Follow Up Queue tab) */}
                        {activeTab === 'queue' && (
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Prioritas:</span>
                                <select
                                    value={priorityFilter}
                                    onChange={(e) => setPriorityFilter(e.target.value)}
                                    className="input-ayumi py-2 text-sm max-w-[150px] focus:bg-gray-50"
                                >
                                    <option value="All">Semua</option>
                                    <option value="high">Tinggi</option>
                                    <option value="normal">Normal</option>
                                    <option value="low">Rendah</option>
                                </select>
                            </div>
                        )}

                        {/* Branch Filter (Only visible if Owner) */}
                        {isOwner && (
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Cabang:</span>
                                <select
                                    value={branchFilter}
                                    onChange={(e) => setBranchFilter(e.target.value)}
                                    className="input-ayumi py-2 text-sm max-w-[180px] focus:bg-gray-50"
                                >
                                    <option value="All">Semua Cabang</option>
                                    {branches.map(br => (
                                        <option key={br.id} value={br.id}>{br.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* CONTENT */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 md:p-8 min-h-[500px]">
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
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Harus Dihubungi Hari Ini</h3>
                                {filteredQueue.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                                        <p className="text-gray-500 text-sm font-medium">Tidak ada antrean follow-up untuk hari ini. Luar biasa! 🎉</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                        <table className="whitespace-nowrap w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-pink-50/60 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider">
                                                    <th className="p-4">Pasien</th>
                                                    <th className="p-4">Terakhir Treatment</th>
                                                    <th className="p-4">Jenis / Prioritas</th>
                                                    <th className="p-4 text-center">Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                                {filteredQueue.map(q => (
                                                    <tr key={q.id} className="hover:bg-pink-50/20 transition-colors">
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-900">{q.patients?.full_name}</div>
                                                            <div className="text-xs text-gray-400 mt-0.5">{q.patients?.whatsapp || 'No WA -'}</div>
                                                        </td>
                                                        <td className="p-4 text-xs font-semibold text-gray-600">
                                                            {q.treatment_records?.treatment_date || '-'}
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="text-xs font-bold uppercase">
                                                                {(() => {
                                                                    const typeLabels = {
                                                                        'followup_2minggu': { label: 'Cek Progres 2 Minggu', color: 'text-indigo-700' },
                                                                        'followup_3minggu': { label: 'Cek Progres 3 Minggu', color: 'text-blue-700' },
                                                                        'followup_1bulan': { label: 'Cek Progres 1 Bulan', color: 'text-purple-700' },
                                                                        'reminder_besok': { label: 'Reminder Besok Treatment', color: 'text-red-700' },
                                                                        'treatment_reminder': { label: 'Pengingat Perawatan', color: 'text-ayumi-primary' },
                                                                        'dormant_reminder': { label: 'Sapaan Dormant', color: 'text-orange-700' },
                                                                        'birthday': { label: 'Ulang Tahun', color: 'text-pink-700' }
                                                                    }
                                                                    const info = typeLabels[q.followup_type] || { label: q.followup_type?.replace(/_/g, ' ') || '-', color: 'text-gray-600' }
                                                                    return <span className={info.color}>{info.label}</span>
                                                                })()}
                                                            </div>
                                                            <div className={`text-[10px] font-extrabold inline-block px-2 py-0.5 rounded-md mt-1 uppercase ${q.priority === 'high' ? 'bg-red-100 text-red-700' : (q.priority === 'normal' || q.priority === 'medium') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                                                {q.priority}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    onClick={() => handleOpenWaModal(q, q.followup_type || 'treatment_reminder')}
                                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                                >
                                                                    💬 Hubungi WA
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleSelesaiClick(q)} 
                                                                    className="bg-pink-50 hover:bg-ayumi-primary text-ayumi-primary hover:text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                                                                >
                                                                    Selesai
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleTundaClick(q)} 
                                                                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                                                                >
                                                                    Tunda
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleDeleteQueue(q.id, q.patients?.full_name)} 
                                                                    className="text-gray-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-xl transition-all cursor-pointer"
                                                                    title="Hapus"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
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
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-lg font-bold text-ayumi-secondary">Ulang Tahun (7 Hari ke Depan)</h3>
                                </div>
                                {filteredBirthdays.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                        <p className="text-gray-500 font-medium">Tidak ada pasien yang berulang tahun dalam 7 hari ke depan.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Bulk action bar */}
                                        <div className="flex justify-between items-center bg-pink-50/50 p-4 rounded-2xl border border-pink-100">
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="checkbox" 
                                                    id="select-all-birthdays"
                                                    checked={selectedBirthdayIds.length === filteredBirthdays.length && filteredBirthdays.length > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedBirthdayIds(filteredBirthdays.map(p => p.id))
                                                        } else {
                                                            setSelectedBirthdayIds([])
                                                        }
                                                    }}
                                                    className="w-4.5 h-4.5 rounded border-gray-300 text-ayumi-primary focus:ring-ayumi-primary cursor-pointer"
                                                />
                                                <label htmlFor="select-all-birthdays" className="text-sm font-semibold text-gray-700 cursor-pointer select-none">
                                                    Pilih Semua ({filteredBirthdays.length})
                                                </label>
                                            </div>
                                            {selectedBirthdayIds.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        const selectedPatients = filteredBirthdays.filter(p => selectedBirthdayIds.includes(p.id))
                                                        handleStartBulk(selectedPatients, 'birthday')
                                                    }}
                                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                                                >
                                                    Kirim WA Terpilih ({selectedBirthdayIds.length})
                                                </button>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {filteredBirthdays.map(pt => (
                                                <div key={pt.id} className="bg-pink-50 p-5 rounded-2xl border border-pink-100 flex justify-between items-center relative pl-12">
                                                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                                                        <input 
                                                            type="checkbox"
                                                            checked={selectedBirthdayIds.includes(pt.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedBirthdayIds(prev => [...prev, pt.id])
                                                                } else {
                                                                    setSelectedBirthdayIds(prev => prev.filter(id => id !== pt.id))
                                                                }
                                                            }}
                                                            className="w-4.5 h-4.5 rounded border-gray-300 text-ayumi-primary focus:ring-ayumi-primary cursor-pointer"
                                                        />
                                                    </div>
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
                                                    <button
                                                        onClick={() => handleOpenWaModal(pt, 'birthday')}
                                                        className="bg-green-100 hover:bg-green-200 text-green-700 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 shadow-sm"
                                                    >
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                        Hubungi
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB: DORMANT */}
                        {activeTab === 'dormant' && (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-lg font-bold text-ayumi-secondary">Pasien Dormant (&gt;90 Hari Tidak Datang)</h3>
                                </div>
                                {filteredDormant.length === 0 ? (
                                    <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                        <p className="text-gray-500 font-medium">Bagus! Semua pasien masih aktif berkunjung.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Bulk action bar */}
                                        <div className="flex justify-between items-center bg-pink-50/50 p-4 rounded-2xl border border-pink-100">
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="checkbox" 
                                                    id="select-all-dormant"
                                                    checked={selectedDormantIds.length === filteredDormant.length && filteredDormant.length > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedDormantIds(filteredDormant.map(d => d.patient_id))
                                                        } else {
                                                            setSelectedDormantIds([])
                                                        }
                                                    }}
                                                    className="w-4.5 h-4.5 rounded border-gray-300 text-ayumi-primary focus:ring-ayumi-primary cursor-pointer"
                                                />
                                                <label htmlFor="select-all-dormant" className="text-sm font-semibold text-gray-700 cursor-pointer select-none">
                                                    Pilih Semua ({filteredDormant.length})
                                                </label>
                                            </div>
                                            {selectedDormantIds.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        const selectedPatients = filteredDormant.filter(d => selectedDormantIds.includes(d.patient_id))
                                                        handleStartBulk(selectedPatients, 'dormant_reminder')
                                                    }}
                                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                                                >
                                                    Kirim WA Terpilih ({selectedDormantIds.length})
                                                </button>
                                            )}
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="whitespace-nowrap w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-ayumi-table-header text-ayumi-secondary text-sm">
                                                        <th className="p-4 w-10 font-bold rounded-tl-xl"></th>
                                                        <th className="p-4 font-bold">Pasien</th>
                                                        <th className="p-4 font-bold">Kunjungan Terakhir</th>
                                                        <th className="p-4 font-bold">Lama Menghilang</th>
                                                        <th className="p-4 font-bold text-center rounded-tr-xl">Aksi</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredDormant.map(d => (
                                                        <tr key={d.patient_id} className="border-b border-gray-50 hover:bg-ayumi-table-hover">
                                                            <td className="p-4">
                                                                <input 
                                                                    type="checkbox"
                                                                    checked={selectedDormantIds.includes(d.patient_id)}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            setSelectedDormantIds(prev => [...prev, d.patient_id])
                                                                        } else {
                                                                            setSelectedDormantIds(prev => prev.filter(id => id !== d.patient_id))
                                                                        }
                                                                    }}
                                                                    className="w-4.5 h-4.5 rounded border-gray-300 text-ayumi-primary focus:ring-ayumi-primary cursor-pointer"
                                                                />
                                                            </td>
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
                                                                    <button
                                                                        onClick={() => handleOpenWaModal(d, 'dormant_reminder')}
                                                                        className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                                                    >
                                                                        Hubungi WA
                                                                    </button>
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

            {/* Modal Outcome (Selesai Manual) */}
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
                                    <option value="responded">Responded (Merespon)</option>
                                    <option value="no_response">No Response (Tidak Ada Jawaban)</option>
                                    <option value="booked">Booked (Janji Temu Baru)</option>
                                    <option value="not_interested">Not Interested (Tidak Tertarik)</option>
                                    <option value="wrong_number">Wrong Number (Salah Nomor)</option>
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
                            <button onClick={submitOutcome} className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-5 py-2.5 rounded-xl font-bold transition-colors">
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
                            <button onClick={submitReschedule} className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-5 py-2.5 rounded-xl font-bold transition-colors">
                                Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hubungi & Log WhatsApp Modal */}
            {showWaModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-gray-100 my-8">
                        <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                            <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                            Hubungi & Log WhatsApp
                        </h3>
                        <p className="text-sm text-gray-500 mb-6">Hubungi pasien *{waForm.patientName}* (+{waForm.whatsapp}) dengan template pesan pilihan.</p>

                        <div className="space-y-4">
                            {/* Template selector */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Template Pesan</label>
                                <select 
                                    value={waForm.templateType}
                                    onChange={e => handleWaTemplateChange(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50"
                                >
                                    <optgroup label="── Follow Up Berkala ──">
                                        <option value="followup_2minggu">📋 Cek Progres 2 Minggu</option>
                                        <option value="followup_3minggu">📋 Cek Progres 3 Minggu</option>
                                        <option value="followup_1bulan">📋 Cek Progres 1 Bulan</option>
                                    </optgroup>
                                    <optgroup label="── Pengingat Jadwal ──">
                                        <option value="reminder_besok">⏰ Reminder Besok Treatment</option>
                                        <option value="treatment_reminder">🔔 Pengingat Perawatan Umum</option>
                                    </optgroup>
                                    <optgroup label="── Lainnya ──">
                                        <option value="birthday">🎂 Ucapan Ulang Tahun</option>
                                        <option value="dormant_reminder">💤 Sapaan Pasien Dormant</option>
                                        <option value="custom">✏️ Kustom (Tulis Sendiri)</option>
                                    </optgroup>
                                </select>
                            </div>

                            {/* Message editor */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Pratinjau & Edit Pesan</label>
                                <textarea 
                                    value={waForm.message}
                                    onChange={e => setWaForm({...waForm, message: e.target.value})}
                                    rows="6"
                                    className="input-ayumi focus:bg-gray-50 resize-none font-sans text-sm leading-relaxed"
                                    placeholder="Ketik pesan di sini..."
                                ></textarea>
                            </div>

                            {/* Log outcome fields */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <h4 className="font-bold text-sm text-gray-800 mb-3">Pencatatan Hasil Log (Sistem)</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hasil Kontak (Outcome)</label>
                                        <select 
                                            value={waForm.outcome}
                                            onChange={e => setWaForm({...waForm, outcome: e.target.value})}
                                            className="input-ayumi py-2 text-sm focus:bg-gray-50"
                                        >
                                            <option value="responded">Merespon (Responded)</option>
                                            <option value="no_response">Tidak Ada Jawaban (No Response)</option>
                                            <option value="booked">Booking Janji Temu (Booked)</option>
                                            <option value="not_interested">Tidak Tertarik (Not Interested)</option>
                                            <option value="wrong_number">Salah Nomor (Wrong Number)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Catatan Staf</label>
                                        <input 
                                            type="text"
                                            value={waForm.notes}
                                            onChange={e => setWaForm({...waForm, notes: e.target.value})}
                                            className="input-ayumi py-2 text-sm focus:bg-gray-50"
                                            placeholder="e.g. Pasien ingin booking lusa..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col sm:flex-row gap-2.5 justify-end mt-8 border-t border-gray-100 pt-5">
                            <button onClick={() => setShowWaModal(false)} className="order-4 sm:order-1 px-4 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-sm">
                                Batal
                            </button>
                            <button onClick={saveWaLogOnly} className="order-3 sm:order-2 px-4 py-2.5 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors text-sm">
                                Hanya Simpan Log
                            </button>
                            <button onClick={sendWhatsAppOnly} className="order-2 sm:order-3 px-4 py-2.5 rounded-xl font-bold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors text-sm">
                                Hanya Kirim WA
                            </button>
                            <button onClick={sendWaAndSaveLog} className="order-1 sm:order-4 bg-ayumi-primary hover:bg-[#9a4b75] text-white px-5 py-2.5 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-1.5 shadow-md">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                Kirim & Simpan Log
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Hubungi & Log WhatsApp Modal */}
            {showBulkWaModal && bulkQueue.length > 0 && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-gray-100 my-8">
                        <div className="flex justify-between items-center mb-3">
                            <span className="bg-pink-100 text-ayumi-primary text-xs font-bold px-3 py-1 rounded-full">
                                Pasien {bulkIndex + 1} dari {bulkQueue.length}
                            </span>
                            <span className="text-sm font-semibold text-gray-500">Mode Bulk Send</span>
                        </div>
                        
                        <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                            <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                            Hubungi Massal: {bulkQueue[bulkIndex]?.full_name}
                        </h3>
                        <p className="text-sm text-gray-500 mb-6">Penerima saat ini: <strong className="text-gray-700">+{bulkQueue[bulkIndex]?.whatsapp || bulkQueue[bulkIndex]?.patients?.whatsapp}</strong></p>

                        <div className="space-y-4">
                            {/* Template selector */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Template Pesan</label>
                                <select 
                                    value={bulkTemplate}
                                    onChange={e => handleBulkTemplateChange(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50"
                                >
                                    <optgroup label="── Follow Up Berkala ──">
                                        <option value="followup_2minggu">📋 Cek Progres 2 Minggu</option>
                                        <option value="followup_3minggu">📋 Cek Progres 3 Minggu</option>
                                        <option value="followup_1bulan">📋 Cek Progres 1 Bulan</option>
                                    </optgroup>
                                    <optgroup label="── Pengingat Jadwal ──">
                                        <option value="reminder_besok">⏰ Reminder Besok Treatment</option>
                                        <option value="treatment_reminder">🔔 Pengingat Perawatan Umum</option>
                                    </optgroup>
                                    <optgroup label="── Lainnya ──">
                                        <option value="birthday">🎂 Ucapan Ulang Tahun</option>
                                        <option value="dormant_reminder">💤 Sapaan Pasien Dormant</option>
                                        <option value="custom">✏️ Kustom (Tulis Sendiri)</option>
                                    </optgroup>
                                </select>
                            </div>

                            {/* Message editor */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Pratinjau & Edit Pesan</label>
                                <textarea 
                                    value={bulkForm.message}
                                    onChange={e => setBulkForm({...bulkForm, message: e.target.value})}
                                    rows="6"
                                    className="input-ayumi focus:bg-gray-50 resize-none font-sans text-sm leading-relaxed"
                                    placeholder="Ketik pesan di sini..."
                                ></textarea>
                            </div>

                            {/* Log outcome fields */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <h4 className="font-bold text-sm text-gray-800 mb-3">Pencatatan Hasil Log (Sistem)</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hasil Kontak (Outcome)</label>
                                        <select 
                                            value={bulkForm.outcome}
                                            onChange={e => setBulkForm({...bulkForm, outcome: e.target.value})}
                                            className="input-ayumi py-2 text-sm focus:bg-gray-50"
                                        >
                                            <option value="responded">Merespon (Responded)</option>
                                            <option value="no_response">Tidak Ada Jawaban (No Response)</option>
                                            <option value="booked">Booking Janji Temu (Booked)</option>
                                            <option value="not_interested">Tidak Tertarik (Not Interested)</option>
                                            <option value="wrong_number">Salah Nomor (Wrong Number)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Catatan Staf</label>
                                        <input 
                                            type="text"
                                            value={bulkForm.notes}
                                            onChange={e => setBulkForm({...bulkForm, notes: e.target.value})}
                                            className="input-ayumi py-2 text-sm focus:bg-gray-50"
                                            placeholder="Catatan hasil percakapan..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col sm:flex-row gap-2.5 justify-end mt-8 border-t border-gray-100 pt-5">
                            <button onClick={() => setShowBulkWaModal(false)} className="order-3 sm:order-1 px-4 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-sm">
                                Berhenti / Batal
                            </button>
                            <button onClick={() => handleBulkSubmit(false)} className="order-2 sm:order-2 px-4 py-2.5 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors text-sm">
                                Lewati & Simpan Log Saja
                            </button>
                            <button onClick={() => handleBulkSubmit(true)} className="order-1 sm:order-3 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-1.5 shadow-md">
                                Kirim WA & Lanjut ({bulkIndex + 1}/{bulkQueue.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Tambah Follow Up Manual */}
            {showManualModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 md:p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                            Jadwalkan Follow Up Baru
                        </h3>
                        <form onSubmit={submitManualFollowup} className="space-y-4">
                            {/* Patient Searchable input */}
                            <div className="relative">
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Pilih Pasien *</label>
                                <input
                                    type="text"
                                    placeholder="Ketik nama atau nomor whatsapp..."
                                    value={patientSearch}
                                    onChange={(e) => {
                                        setPatientSearch(e.target.value)
                                        setShowPatientDropdown(true)
                                    }}
                                    onFocus={() => setShowPatientDropdown(true)}
                                    className="input-ayumi focus:bg-gray-50"
                                />
                                {showPatientDropdown && filteredPatientOptions.length > 0 && (
                                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                                        {filteredPatientOptions.map(p => (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => {
                                                    setManualForm({ ...manualForm, patientId: p.id })
                                                    setPatientSearch(p.full_name)
                                                    setShowPatientDropdown(false)
                                                }}
                                                className="w-full text-left px-4 py-2 hover:bg-pink-50 text-sm border-b border-gray-50 last:border-0"
                                            >
                                                <div className="font-semibold text-gray-800">{p.full_name}</div>
                                                <div className="text-xs text-gray-500">{p.whatsapp}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Type selector */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Jenis Follow Up *</label>
                                <select 
                                    value={manualForm.followupType}
                                    onChange={e => setManualForm({...manualForm, followupType: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50"
                                >
                                    <option value="followup_2minggu">Cek Progres 2 Minggu (14 Hari)</option>
                                    <option value="followup_3minggu">Cek Progres 3 Minggu (21 Hari)</option>
                                    <option value="followup_1bulan">Cek Progres 1 Bulan (30 Hari)</option>
                                    <option value="treatment_reminder">Pengingat Perawatan (Treatment Reminder)</option>
                                    <option value="dormant_reminder">Sapaan Pasien Dormant (Dormant Reminder)</option>
                                    <option value="custom_reminder">Follow Up Kustom (Custom Reminder)</option>
                                </select>
                            </div>

                            {/* Scheduled date */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tanggal Dijadwalkan *</label>
                                <input 
                                    type="date"
                                    value={manualForm.scheduledDate}
                                    onChange={e => setManualForm({...manualForm, scheduledDate: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Priority */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prioritas</label>
                                    <select 
                                        value={manualForm.priority}
                                        onChange={e => setManualForm({...manualForm, priority: e.target.value})}
                                        className="input-ayumi focus:bg-gray-50"
                                    >
                                        <option value="high">Tinggi (High)</option>
                                        <option value="normal">Normal (Medium)</option>
                                        <option value="low">Rendah (Low)</option>
                                    </select>
                                </div>

                                {/* Branch Selector (Only for Owner) */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Cabang</label>
                                    {isOwner ? (
                                        <select 
                                            value={manualForm.branchId}
                                            onChange={e => setManualForm({...manualForm, branchId: e.target.value})}
                                            className="input-ayumi focus:bg-gray-50"
                                        >
                                            <option value="">Pilih Cabang</option>
                                            {branches.map(br => (
                                                <option key={br.id} value={br.id}>{br.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input 
                                            type="text" 
                                            value="Cabang Saat Ini" 
                                            disabled 
                                            className="input-ayumi bg-gray-50 text-gray-500 cursor-not-allowed"
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Catatan Pengingat</label>
                                <textarea 
                                    value={manualForm.notes}
                                    onChange={e => setManualForm({...manualForm, notes: e.target.value})}
                                    rows="3"
                                    className="input-ayumi focus:bg-gray-50 resize-none text-sm"
                                    placeholder="Detail catatan untuk follow up ini..."
                                ></textarea>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 justify-end mt-6 border-t border-gray-100 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowManualModal(false)
                                        setPatientSearch('')
                                    }}
                                    className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-sm"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-5 py-2.5 rounded-xl font-bold transition-colors text-sm"
                                >
                                    Simpan & Jadwalkan
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
