'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { getFriendlyErrorMessage } from '@/lib/errorMessages'
import BranchFilter from '@/components/ui/BranchFilter'
import ConfirmModal from '@/components/ui/ConfirmModal'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { openWhatsApp } from '@/lib/whatsapp'

export default function CRMPage() {

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
    const [typeFilter, setTypeFilter] = useState('All')
    const [timeframeFilter, setTimeframeFilter] = useState('due')
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
    }, [timeframeFilter])

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

        // 1. Fetch Follow Up Queue
        let qQuery = supabase
            .from('followup_queue')
            .select(`
                *,
                patients!inner(full_name, whatsapp),
                treatment_records (treatment_date, branch_id)
            `)
            .in('status', ['pending', 'rescheduled'])

        if (timeframeFilter === 'due') {
            qQuery = qQuery.lte('scheduled_date', todayDateStr).order('scheduled_date', { ascending: false })
        } else if (timeframeFilter === 'upcoming_7') {
            const d = new Date()
            d.setDate(d.getDate() + 7)
            qQuery = qQuery.gte('scheduled_date', todayDateStr).lte('scheduled_date', d.toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
        } else if (timeframeFilter === 'upcoming_14') {
            const d = new Date()
            d.setDate(d.getDate() + 14)
            qQuery = qQuery.gte('scheduled_date', todayDateStr).lte('scheduled_date', d.toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
        } else if (timeframeFilter === 'upcoming_30') {
            const d = new Date()
            d.setDate(d.getDate() + 30)
            qQuery = qQuery.gte('scheduled_date', todayDateStr).lte('scheduled_date', d.toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
        } else {
            qQuery = qQuery.order('scheduled_date', { ascending: false })
        }

        const { data: rawQData } = await qQuery
            
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
        let trQuery = supabase.from('treatment_records').select('id, patient_id, treatment_date, branch_id, patients!inner(full_name, whatsapp)')
        const { data: trData } = await trQuery
        if (trData) {
            const latestRecords = {}
            trData.forEach(r => {
                if (!r.patients) return
                const d = new Date(r.treatment_date)
                if (!latestRecords[r.patient_id] || d > latestRecords[r.patient_id].date) {
                    latestRecords[r.patient_id] = {
                        treatment_record_id: r.id,
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
        openWhatsApp(waForm.whatsapp, waForm.message)
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
            openWhatsApp(formattedWa, bulkForm.message)
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

    // Helper to determine effective followup type (supports fallback treatment_reminder)
    const getEffectiveFollowupType = (q) => {
        if (q.followup_type && q.followup_type !== 'treatment_reminder') {
            return q.followup_type
        }
        if (q.treatment_records?.treatment_date && q.scheduled_date) {
            const tDate = new Date(q.treatment_records.treatment_date + 'T00:00:00')
            const sDate = new Date(q.scheduled_date + 'T00:00:00')
            const diffDays = Math.round((sDate - tDate) / (1000 * 60 * 60 * 24))
            if (diffDays >= 25) return 'followup_1bulan'
            if (diffDays >= 18) return 'followup_3minggu'
            if (diffDays >= 10) return 'followup_2minggu'
        }
        return q.followup_type || 'followup_2minggu'
    }

    // --- FILTERED DATA LISTS ---
    const filteredQueue = useMemo(() => {
        return queue.filter(q => {
            const matchSearch = !searchTerm || 
                q.patients?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                q.patients?.whatsapp?.includes(searchTerm);
            const matchPriority = priorityFilter === 'All' || q.priority === priorityFilter;
            const effectiveType = getEffectiveFollowupType(q);
            const matchType = typeFilter === 'All' || effectiveType === typeFilter || q.followup_type === typeFilter;
            const matchBranch = branchFilter === 'All' || 
                q.branch_id === branchFilter || 
                (q.treatment_records && q.treatment_records.branch_id === branchFilter);
            return matchSearch && matchPriority && matchType && matchBranch;
        })
    }, [queue, searchTerm, priorityFilter, typeFilter, branchFilter])

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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm">
                <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 bg-pink-50 text-ayumi-primary rounded-2xl flex items-center justify-center font-bold shadow-sm border border-pink-150">
                        <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-extrabold text-gray-900 leading-tight">Customer Relationship & Retensi Pasien</h2>
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">Kelola antrean follow-up berkala, ucapan ulang tahun, dan sapaan pasien dormant.</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowManualModal(true)}
                    className="w-full sm:w-auto bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold shadow-md shadow-pink-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                    <span>Tambah Follow Up Manual</span>
                </button>
            </div>

            {/* SEGMENT TABS */}
            <div className="bg-white p-2 rounded-3xl border border-gray-200/80 shadow-sm flex flex-wrap md:flex-nowrap gap-2">
                <button 
                    onClick={() => setActiveTab('queue')}
                    className={`flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'queue' ? 'bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white shadow-md font-extrabold' : 'text-gray-600 hover:bg-pink-50/50 hover:text-ayumi-primary'}`}
                >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <span>Antrean Follow Up</span>
                    {filteredQueue.length > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'queue' ? 'bg-white/20 text-white' : 'bg-pink-100 text-ayumi-primary'}`}>
                            {filteredQueue.length}
                        </span>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('birthday')}
                    className={`flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'birthday' ? 'bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white shadow-md font-extrabold' : 'text-gray-600 hover:bg-pink-50/50 hover:text-ayumi-primary'}`}
                >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.701 2.701 0 00-1.5-.454M9 6v2m3-2v2m3-2v2M9 3h.01M12 3h.01M15 3h.01M3 21h18a2 2 0 002-2V9a2 2 0 00-2-2H3a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Ulang Tahun</span>
                    {filteredBirthdays.length > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'birthday' ? 'bg-white/20 text-white' : 'bg-pink-100 text-ayumi-primary'}`}>
                            {filteredBirthdays.length}
                        </span>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('dormant')}
                    className={`flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'dormant' ? 'bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white shadow-md font-extrabold' : 'text-gray-600 hover:bg-pink-50/50 hover:text-ayumi-primary'}`}
                >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Pasien Dormant</span>
                    {filteredDormant.length > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'dormant' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'}`}>
                            {filteredDormant.length}
                        </span>
                    )}
                </button>
            </div>

            {/* SEARCH & FILTER CONTROLS */}
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-200/80 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                    <input
                        type="text"
                        placeholder="Cari nama pasien atau WhatsApp..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input-ayumi py-2.5 pl-10 pr-4 text-sm focus:bg-gray-50 rounded-2xl"
                    />
                    <svg className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>

                <div className="flex flex-wrap gap-4 w-full md:w-auto justify-end">
                    {/* Priority & Timeframe Filter (Only in Follow Up Queue tab) */}
                    {activeTab === 'queue' && (
                        <>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Jadwal:</span>
                                <select
                                    value={timeframeFilter}
                                    onChange={(e) => setTimeframeFilter(e.target.value)}
                                    className="input-ayumi py-2 text-sm max-w-[210px] focus:bg-gray-50 font-bold rounded-xl"
                                >
                                    <option value="due">Jatuh Tempo & Hari Ini</option>
                                    <option value="upcoming_7">7 Hari Mendatang</option>
                                    <option value="upcoming_14">14 Hari Mendatang</option>
                                    <option value="upcoming_30">30 Hari Mendatang (1 Bulan)</option>
                                    <option value="all">Semua Antrean</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Tahap:</span>
                                <select
                                    value={typeFilter}
                                    onChange={(e) => setTypeFilter(e.target.value)}
                                    className="input-ayumi py-2 text-sm max-w-[190px] focus:bg-gray-50 font-bold rounded-xl"
                                >
                                    <option value="All">Semua Tahap</option>
                                    <option value="followup_2minggu">Cek 2 Minggu</option>
                                    <option value="followup_3minggu">Cek 3 Minggu</option>
                                    <option value="followup_1bulan">Cek 1 Bulan</option>
                                    <option value="reminder_besok">Reminder Besok</option>
                                    <option value="treatment_reminder">Pengingat Perawatan</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Prioritas:</span>
                                <select
                                    value={priorityFilter}
                                    onChange={(e) => setPriorityFilter(e.target.value)}
                                    className="input-ayumi py-2 text-sm max-w-[150px] focus:bg-gray-50 font-semibold rounded-xl"
                                >
                                    <option value="All">Semua Prioritas</option>
                                    <option value="high">Prioritas Tinggi</option>
                                    <option value="normal">Prioritas Normal</option>
                                    <option value="low">Prioritas Rendah</option>
                                </select>
                            </div>
                        </>
                    )}

                    {/* Branch Filter (Only visible if Owner) */}
                    {isOwner && (
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Cabang:</span>
                            <select
                                value={branchFilter}
                                onChange={(e) => setBranchFilter(e.target.value)}
                                className="input-ayumi py-2 text-sm max-w-[180px] focus:bg-gray-50 font-semibold rounded-xl"
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
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="text-base font-extrabold text-gray-900">
                                            {timeframeFilter === 'due' && 'Harus Dihubungi Hari Ini & Jatuh Tempo'}
                                            {timeframeFilter === 'upcoming_7' && 'Jadwal Follow-Up 7 Hari Mendatang'}
                                            {timeframeFilter === 'upcoming_14' && 'Jadwal Follow-Up 14 Hari Mendatang'}
                                            {timeframeFilter === 'upcoming_30' && 'Jadwal Follow-Up 30 Hari Mendatang (1 Bulan)'}
                                            {timeframeFilter === 'all' && 'Semua Jadwal Antrean Follow-Up'}
                                        </h3>
                                        <p className="text-xs text-gray-500 mt-0.5">Daftar pasien yang perlu dihubungi berdasarkan riwayat kunjungan.</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 bg-gray-100/70 p-1.5 rounded-2xl border border-gray-200/70">
                                        <button
                                            onClick={() => setTypeFilter('All')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${typeFilter === 'All' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary hover:bg-white'}`}
                                        >
                                            Semua ({queue.length})
                                        </button>
                                        <button
                                            onClick={() => setTypeFilter('followup_2minggu')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${typeFilter === 'followup_2minggu' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary hover:bg-white'}`}
                                        >
                                            2 Minggu ({queue.filter(q => getEffectiveFollowupType(q) === 'followup_2minggu').length})
                                        </button>
                                        <button
                                            onClick={() => setTypeFilter('followup_3minggu')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${typeFilter === 'followup_3minggu' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary hover:bg-white'}`}
                                        >
                                            3 Minggu ({queue.filter(q => getEffectiveFollowupType(q) === 'followup_3minggu').length})
                                        </button>
                                        <button
                                            onClick={() => setTypeFilter('followup_1bulan')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${typeFilter === 'followup_1bulan' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary hover:bg-white'}`}
                                        >
                                            1 Bulan ({queue.filter(q => getEffectiveFollowupType(q) === 'followup_1bulan').length})
                                        </button>
                                    </div>
                                </div>
                                {filteredQueue.length === 0 ? (
                                    <div className="text-center py-12 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200">
                                        <div className="w-12 h-12 rounded-2xl bg-pink-50 text-ayumi-primary flex items-center justify-center mx-auto mb-3 border border-pink-100">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                        </div>
                                        <p className="text-gray-700 font-extrabold text-sm">Tidak ada antrean follow-up</p>
                                        <p className="text-gray-400 text-xs mt-1">Semua follow-up untuk kriteria filter ini telah selesai atau belum jatuh tempo.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                        <table className="whitespace-nowrap w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-pink-50/70 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider border-b border-pink-100">
                                                    <th className="p-4">Pasien</th>
                                                    <th className="p-4">Terakhir Treatment</th>
                                                    <th className="p-4">Jadwal Hubungi</th>
                                                    <th className="p-4">Tahap / Prioritas</th>
                                                    <th className="p-4 text-center">Aksi</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                                {filteredQueue.map(q => {
                                                    const todayStr = new Date().toISOString().split('T')[0];
                                                    const isDue = q.scheduled_date && q.scheduled_date <= todayStr;
                                                    return (
                                                        <tr key={q.id} className="hover:bg-pink-50/20 transition-colors">
                                                            <td className="p-4">
                                                                {q.treatment_record_id ? (
                                                                    <Link 
                                                                        href={`/treatment-records/${q.treatment_record_id}`}
                                                                        className="font-extrabold text-gray-900 hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group"
                                                                        title="Klik untuk melihat detail riwayat treatment terakhir"
                                                                    >
                                                                        <span>{q.patients?.full_name}</span>
                                                                        <span className="text-[10px] text-gray-400 group-hover:text-ayumi-primary group-hover:translate-x-0.5 transition-all">↗</span>
                                                                    </Link>
                                                                ) : q.patient_id ? (
                                                                    <Link 
                                                                        href={`/patients/${q.patient_id}`}
                                                                        className="font-extrabold text-gray-900 hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group"
                                                                        title="Klik untuk melihat profil & riwayat pasien"
                                                                    >
                                                                        <span>{q.patients?.full_name}</span>
                                                                        <span className="text-[10px] text-gray-400 group-hover:text-ayumi-primary group-hover:translate-x-0.5 transition-all">↗</span>
                                                                    </Link>
                                                                ) : (
                                                                    <div className="font-extrabold text-gray-900">{q.patients?.full_name}</div>
                                                                )}
                                                                <div className="text-xs text-gray-400 mt-0.5">{q.patients?.whatsapp || 'No WA -'}</div>
                                                            </td>
                                                            <td className="p-4 text-xs font-semibold text-gray-600">
                                                                {q.treatment_record_id ? (
                                                                    <Link 
                                                                        href={`/treatment-records/${q.treatment_record_id}`}
                                                                        className="hover:text-ayumi-primary hover:underline font-semibold"
                                                                        title="Buka detail rekam medis"
                                                                    >
                                                                        {q.treatment_records?.treatment_date || '-'}
                                                                    </Link>
                                                                ) : (
                                                                    <span>{q.treatment_records?.treatment_date || '-'}</span>
                                                                )}
                                                            </td>
                                                            <td className="p-4 text-xs font-semibold text-gray-700">
                                                                <div className="font-bold text-gray-900">{q.scheduled_date || '-'}</div>
                                                                {isDue ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full mt-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                                                                        Jatuh Tempo
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full mt-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                                                        Terjadwal
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="p-4">
                                                                <div>
                                                                    {(() => {
                                                                        const effType = getEffectiveFollowupType(q)
                                                                        const typeLabels = {
                                                                            'followup_2minggu': { label: 'Cek 2 Minggu', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                                                                            'followup_3minggu': { label: 'Cek 3 Minggu', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
                                                                            'followup_1bulan': { label: 'Cek 1 Bulan', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
                                                                            'reminder_besok': { label: 'Reminder Besok', bg: 'bg-red-50 text-red-700 border-red-200' },
                                                                            'treatment_reminder': { label: 'Pengingat Perawatan', bg: 'bg-pink-50 text-ayumi-primary border-pink-200' },
                                                                            'dormant_reminder': { label: 'Sapaan Dormant', bg: 'bg-orange-50 text-orange-700 border-orange-200' },
                                                                            'birthday': { label: 'Ulang Tahun', bg: 'bg-rose-50 text-rose-700 border-rose-200' }
                                                                        }
                                                                        const info = typeLabels[effType] || { label: effType?.replace(/_/g, ' ') || '-', bg: 'bg-gray-50 text-gray-700 border-gray-200' }
                                                                        return <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${info.bg}`}>{info.label}</span>
                                                                    })()}
                                                                </div>
                                                                <div className="mt-1">
                                                                    <span className={`text-[10px] font-bold inline-block px-2 py-0.5 rounded-md uppercase border ${q.priority === 'high' ? 'bg-red-50 text-red-700 border-red-200' : (q.priority === 'normal' || q.priority === 'medium') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                                                        {q.priority}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <button
                                                                        onClick={() => handleOpenWaModal(q, q.followup_type || 'treatment_reminder')}
                                                                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                                        <span>Hubungi WA</span>
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handleSelesaiClick(q)} 
                                                                        className="h-8 bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-3 py-1 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                                                        <span>Selesai</span>
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handleTundaClick(q)} 
                                                                        className="h-8 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                        <span>Tunda</span>
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handleDeleteQueue(q.id, q.patients?.full_name)} 
                                                                        className="h-8 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center"
                                                                        title="Hapus"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
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
                                    <div>
                                        <h3 className="text-base font-extrabold text-gray-900">Ulang Tahun (7 Hari ke Depan)</h3>
                                        <p className="text-xs text-gray-500 mt-0.5">Daftar pasien yang berulang tahun dalam periode pekan ini untuk diberikan ucapan atau promo.</p>
                                    </div>
                                </div>
                                {filteredBirthdays.length === 0 ? (
                                    <div className="text-center py-12 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200">
                                        <div className="w-12 h-12 rounded-2xl bg-pink-50 text-ayumi-primary flex items-center justify-center mx-auto mb-3 border border-pink-100">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.701 2.701 0 00-1.5-.454M9 6v2m3-2v2m3-2v2M9 3h.01M12 3h.01M15 3h.01M3 21h18a2 2 0 002-2V9a2 2 0 00-2-2H3a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                        <p className="text-gray-700 font-extrabold text-sm">Tidak ada pasien yang berulang tahun</p>
                                        <p className="text-gray-400 text-xs mt-1">Tidak ada jadwal ulang tahun pasien dalam 7 hari ke depan.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Bulk action bar */}
                                        <div className="flex justify-between items-center bg-pink-50/60 p-4 rounded-2xl border border-pink-150">
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
                                                <label htmlFor="select-all-birthdays" className="text-xs sm:text-sm font-extrabold text-gray-800 cursor-pointer select-none">
                                                    Pilih Semua ({filteredBirthdays.length})
                                                </label>
                                            </div>
                                            {selectedBirthdayIds.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        const selectedPatients = filteredBirthdays.filter(p => selectedBirthdayIds.includes(p.id))
                                                        handleStartBulk(selectedPatients, 'birthday')
                                                    }}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                    Kirim WA Terpilih ({selectedBirthdayIds.length})
                                                </button>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {filteredBirthdays.map(pt => (
                                                <div key={pt.id} className="bg-white hover:bg-pink-50/20 p-5 rounded-3xl border border-pink-150 flex justify-between items-center relative pl-12 shadow-sm transition-all">
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
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            {pt.diffDays === 0 ? (
                                                                <span className="bg-gradient-to-r from-pink-500 to-rose-500 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full shadow-sm">
                                                                    HARI INI!
                                                                </span>
                                                            ) : (
                                                                <span className="bg-pink-100 text-ayumi-primary text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-pink-200/60">
                                                                    H-{pt.diffDays}
                                                                </span>
                                                            )}
                                                            <span className="text-xs font-semibold text-gray-500">
                                                                {new Date(pt.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}
                                                            </span>
                                                        </div>
                                                        <Link 
                                                            href={`/patients/${pt.id}`}
                                                            className="font-extrabold text-gray-900 text-base hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group"
                                                            title="Klik untuk melihat profil pasien"
                                                        >
                                                            <span>{pt.full_name}</span>
                                                            <span className="text-xs text-gray-400 group-hover:text-ayumi-primary transition-colors">↗</span>
                                                        </Link>
                                                        <p className="text-xs text-ayumi-primary font-bold mt-0.5">Ulang tahun ke-{pt.age}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleOpenWaModal(pt, 'birthday')}
                                                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                                                    >
                                                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                        <span>Hubungi</span>
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
                                    <div>
                                        <h3 className="text-base font-extrabold text-gray-900">Pasien Dormant (&gt;90 Hari Tidak Datang)</h3>
                                        <p className="text-xs text-gray-500 mt-0.5">Daftar pasien yang sudah lebih dari 3 bulan belum berkunjung kembali ke klinik.</p>
                                    </div>
                                </div>
                                {filteredDormant.length === 0 ? (
                                    <div className="text-center py-12 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200">
                                        <div className="w-12 h-12 rounded-2xl bg-pink-50 text-ayumi-primary flex items-center justify-center mx-auto mb-3 border border-pink-100">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                        </div>
                                        <p className="text-gray-700 font-extrabold text-sm">Semua pasien masih aktif</p>
                                        <p className="text-gray-400 text-xs mt-1">Tidak ada pasien yang melewati batas 90 hari tanpa kunjungan.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Bulk action bar */}
                                        <div className="flex justify-between items-center bg-pink-50/60 p-4 rounded-2xl border border-pink-150">
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
                                                <label htmlFor="select-all-dormant" className="text-xs sm:text-sm font-extrabold text-gray-800 cursor-pointer select-none">
                                                    Pilih Semua ({filteredDormant.length})
                                                </label>
                                            </div>
                                            {selectedDormantIds.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        const selectedPatients = filteredDormant.filter(d => selectedDormantIds.includes(d.patient_id))
                                                        handleStartBulk(selectedPatients, 'dormant_reminder')
                                                    }}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                    Kirim WA Terpilih ({selectedDormantIds.length})
                                                </button>
                                            )}
                                        </div>

                                        <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                            <table className="whitespace-nowrap w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-pink-50/70 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider border-b border-pink-100">
                                                        <th className="p-4 w-10"></th>
                                                        <th className="p-4">Pasien</th>
                                                        <th className="p-4">Kunjungan Terakhir</th>
                                                        <th className="p-4">Lama Menghilang</th>
                                                        <th className="p-4 text-center">Aksi</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                                    {filteredDormant.map(d => (
                                                        <tr key={d.patient_id} className="hover:bg-pink-50/20 transition-colors">
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
                                                                {d.treatment_record_id ? (
                                                                    <Link 
                                                                        href={`/treatment-records/${d.treatment_record_id}`}
                                                                        className="font-extrabold text-gray-900 hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group"
                                                                        title="Klik untuk melihat riwayat treatment terakhir"
                                                                    >
                                                                        <span>{d.full_name}</span>
                                                                        <span className="text-[10px] text-gray-400 group-hover:text-ayumi-primary transition-colors">↗</span>
                                                                    </Link>
                                                                ) : d.patient_id ? (
                                                                    <Link 
                                                                        href={`/patients/${d.patient_id}`}
                                                                        className="font-extrabold text-gray-900 hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group"
                                                                        title="Klik untuk melihat profil pasien"
                                                                    >
                                                                        <span>{d.full_name}</span>
                                                                        <span className="text-[10px] text-gray-400 group-hover:text-ayumi-primary transition-colors">↗</span>
                                                                    </Link>
                                                                ) : (
                                                                    <div className="font-extrabold text-gray-900">{d.full_name}</div>
                                                                )}
                                                                <div className="text-xs text-gray-400 mt-0.5">{d.whatsapp}</div>
                                                            </td>
                                                            <td className="p-4 text-xs font-semibold text-gray-600">
                                                                {d.treatment_record_id ? (
                                                                    <Link 
                                                                        href={`/treatment-records/${d.treatment_record_id}`}
                                                                        className="hover:text-ayumi-primary hover:underline font-semibold"
                                                                        title="Klik untuk melihat riwayat rekam medis terakhir"
                                                                    >
                                                                        {new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                                    </Link>
                                                                ) : (
                                                                    <span>{new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                                                                )}
                                                            </td>
                                                            <td className="p-4">
                                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200">
                                                                    {d.diffDays} Hari
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <button
                                                                        onClick={() => handleOpenWaModal(d, 'dormant_reminder')}
                                                                        className="h-8 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                                        <span>Hubungi WA</span>
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handleManualFollowup(d)} 
                                                                        className="h-8 bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-3 py-1 rounded-xl text-xs font-extrabold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                                                                        <span>Buat Follow Up</span>
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
                    </>
                )}
            </div>

            {/* Modal Outcome (Selesai Manual) */}
            {showOutcomeModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-sm w-full p-6 md:p-8 shadow-2xl border border-gray-100">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="w-9 h-9 rounded-xl bg-pink-50 text-ayumi-primary flex items-center justify-center border border-pink-100">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <h3 className="text-lg font-extrabold text-gray-900">Hasil Follow Up</h3>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Outcome *</label>
                                <select 
                                    value={outcomeForm.outcome}
                                    onChange={e => setOutcomeForm({...outcomeForm, outcome: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm"
                                >
                                    <option value="responded">Responded (Merespon)</option>
                                    <option value="no_response">No Response (Tidak Ada Jawaban)</option>
                                    <option value="booked">Booked (Janji Temu Baru)</option>
                                    <option value="not_interested">Not Interested (Tidak Tertarik)</option>
                                    <option value="wrong_number">Wrong Number (Salah Nomor)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Catatan</label>
                                <textarea 
                                    value={outcomeForm.notes}
                                    onChange={e => setOutcomeForm({...outcomeForm, notes: e.target.value})}
                                    rows="3"
                                    className="input-ayumi focus:bg-gray-50 resize-none rounded-xl text-sm"
                                    placeholder="Detail percakapan..."
                                ></textarea>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6 border-t border-gray-100 pt-4">
                            <button onClick={() => setShowOutcomeModal(false)} className="px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm cursor-pointer">
                                Batal
                            </button>
                            <button onClick={submitOutcome} className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-2xl font-extrabold transition-all text-xs sm:text-sm shadow-md shadow-pink-500/20 cursor-pointer">
                                Simpan
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Reschedule (Tunda) */}
            {showRescheduleModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-sm w-full p-6 md:p-8 shadow-2xl border border-gray-100">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <h3 className="text-lg font-extrabold text-gray-900">Tunda Follow Up</h3>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Pilih Tanggal Baru *</label>
                                <input 
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={e => setRescheduleDate(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6 border-t border-gray-100 pt-4">
                            <button onClick={() => setShowRescheduleModal(false)} className="px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm cursor-pointer">
                                Batal
                            </button>
                            <button onClick={submitReschedule} className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-2xl font-extrabold transition-all text-xs sm:text-sm shadow-md shadow-pink-500/20 cursor-pointer">
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
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-150">
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-gray-900 leading-tight">Hubungi & Log WhatsApp</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Pasien: <strong className="text-gray-800">{waForm.patientName}</strong> (+{waForm.whatsapp})</p>
                            </div>
                        </div>

                        <div className="space-y-4 mt-5">
                            {/* Template selector */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Template Pesan</label>
                                <select 
                                    value={waForm.templateType}
                                    onChange={e => handleWaTemplateChange(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm font-semibold"
                                >
                                    <optgroup label="Follow Up Berkala">
                                        <option value="followup_2minggu">Cek Progres 2 Minggu</option>
                                        <option value="followup_3minggu">Cek Progres 3 Minggu</option>
                                        <option value="followup_1bulan">Cek Progres 1 Bulan</option>
                                    </optgroup>
                                    <optgroup label="Pengingat Jadwal">
                                        <option value="reminder_besok">Reminder Besok Treatment</option>
                                        <option value="treatment_reminder">Pengingat Perawatan Umum</option>
                                    </optgroup>
                                    <optgroup label="Lainnya">
                                        <option value="birthday">Ucapan Ulang Tahun</option>
                                        <option value="dormant_reminder">Sapaan Pasien Dormant</option>
                                        <option value="custom">Kustom (Tulis Sendiri)</option>
                                    </optgroup>
                                </select>
                            </div>

                            {/* Message editor */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Pratinjau & Edit Pesan</label>
                                <textarea 
                                    value={waForm.message}
                                    onChange={e => setWaForm({...waForm, message: e.target.value})}
                                    rows="6"
                                    className="input-ayumi focus:bg-gray-50 resize-none font-sans text-sm leading-relaxed rounded-xl"
                                    placeholder="Ketik pesan di sini..."
                                ></textarea>
                            </div>

                            {/* Catatan Staf (Opsional) */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Catatan Staf (Opsional)</label>
                                <input 
                                    type="text"
                                    value={waForm.notes}
                                    onChange={e => setWaForm({...waForm, notes: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50 text-sm py-2.5 rounded-xl"
                                    placeholder="e.g. Pasien ingin booking lusa pukul 14:00..."
                                />
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-8 border-t border-gray-100 pt-5">
                            <button 
                                onClick={() => setShowWaModal(false)} 
                                className="w-full sm:w-auto px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm cursor-pointer"
                            >
                                Batal
                            </button>
                            <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto">
                                <button 
                                    onClick={saveWaLogOnly} 
                                    className="w-full sm:w-auto px-4 py-2.5 rounded-2xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 transition-colors text-xs sm:text-sm cursor-pointer"
                                >
                                    Hanya Tandai Selesai
                                </button>
                                <button 
                                    onClick={sendWaAndSaveLog} 
                                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-2xl font-extrabold transition-all text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 cursor-pointer"
                                >
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                    <span>Kirim via WhatsApp</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Hubungi & Log WhatsApp Modal */}
            {showBulkWaModal && bulkQueue.length > 0 && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-gray-100 my-8">
                        <div className="flex justify-between items-center mb-3">
                            <span className="bg-pink-100 text-ayumi-primary text-xs font-black px-3 py-1 rounded-full border border-pink-200/60">
                                Pasien {bulkIndex + 1} dari {bulkQueue.length}
                            </span>
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mode Bulk Send</span>
                        </div>
                        
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-150 shrink-0">
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-gray-900 leading-tight">Hubungi Massal: {bulkQueue[bulkIndex]?.full_name}</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Penerima: <strong className="text-gray-800">+{bulkQueue[bulkIndex]?.whatsapp || bulkQueue[bulkIndex]?.patients?.whatsapp}</strong></p>
                            </div>
                        </div>

                        <div className="space-y-4 mt-5">
                            {/* Template selector */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Template Pesan</label>
                                <select 
                                    value={bulkTemplate}
                                    onChange={e => handleBulkTemplateChange(e.target.value)}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm font-semibold"
                                >
                                    <optgroup label="Follow Up Berkala">
                                        <option value="followup_2minggu">Cek Progres 2 Minggu</option>
                                        <option value="followup_3minggu">Cek Progres 3 Minggu</option>
                                        <option value="followup_1bulan">Cek Progres 1 Bulan</option>
                                    </optgroup>
                                    <optgroup label="Pengingat Jadwal">
                                        <option value="reminder_besok">Reminder Besok Treatment</option>
                                        <option value="treatment_reminder">Pengingat Perawatan Umum</option>
                                    </optgroup>
                                    <optgroup label="Lainnya">
                                        <option value="birthday">Ucapan Ulang Tahun</option>
                                        <option value="dormant_reminder">Sapaan Pasien Dormant</option>
                                        <option value="custom">Kustom (Tulis Sendiri)</option>
                                    </optgroup>
                                </select>
                            </div>

                            {/* Message editor */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Pratinjau & Edit Pesan</label>
                                <textarea 
                                    value={bulkForm.message}
                                    onChange={e => setBulkForm({...bulkForm, message: e.target.value})}
                                    rows="6"
                                    className="input-ayumi focus:bg-gray-50 resize-none font-sans text-sm leading-relaxed rounded-xl"
                                    placeholder="Ketik pesan di sini..."
                                ></textarea>
                            </div>

                            {/* Catatan Staf (Opsional) */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Catatan Staf (Opsional)</label>
                                <input 
                                    type="text"
                                    value={bulkForm.notes}
                                    onChange={e => setBulkForm({...bulkForm, notes: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50 text-sm py-2.5 rounded-xl"
                                    placeholder="Catatan hasil percakapan..."
                                />
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-8 border-t border-gray-100 pt-5">
                            <button 
                                onClick={() => setShowBulkWaModal(false)} 
                                className="w-full sm:w-auto px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm cursor-pointer"
                            >
                                Batal
                            </button>
                            <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto">
                                <button 
                                    onClick={() => handleBulkSubmit(false)} 
                                    className="w-full sm:w-auto px-4 py-2.5 rounded-2xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 transition-colors text-xs sm:text-sm cursor-pointer"
                                >
                                    Lewati Pasien Ini
                                </button>
                                <button 
                                    onClick={() => handleBulkSubmit(true)} 
                                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-2xl font-extrabold transition-all text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
                                >
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                    <span>Kirim WA & Lanjut ({bulkIndex + 1}/{bulkQueue.length})</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Tambah Follow Up Manual */}
            {showManualModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 md:p-8 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="w-10 h-10 rounded-2xl bg-pink-50 text-ayumi-primary flex items-center justify-center border border-pink-150">
                                <svg className="w-5 h-5 text-ayumi-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-extrabold text-gray-900 leading-tight">Jadwalkan Follow Up Baru</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Tambahkan jadwal kontak pasien secara manual.</p>
                            </div>
                        </div>
                        <form onSubmit={submitManualFollowup} className="space-y-4">
                            {/* Patient Searchable input */}
                            <div className="relative">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Pilih Pasien *</label>
                                <input
                                    type="text"
                                    placeholder="Ketik nama atau nomor WhatsApp..."
                                    value={patientSearch}
                                    onChange={(e) => {
                                        setPatientSearch(e.target.value)
                                        setShowPatientDropdown(true)
                                    }}
                                    onFocus={() => setShowPatientDropdown(true)}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm"
                                />
                                {showPatientDropdown && filteredPatientOptions.length > 0 && (
                                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-48 overflow-y-auto divide-y divide-gray-50">
                                        {filteredPatientOptions.map(p => (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => {
                                                    setManualForm({ ...manualForm, patientId: p.id })
                                                    setPatientSearch(p.full_name)
                                                    setShowPatientDropdown(false)
                                                }}
                                                className="w-full text-left px-4 py-2.5 hover:bg-pink-50 text-sm transition-colors cursor-pointer"
                                            >
                                                <div className="font-extrabold text-gray-900">{p.full_name}</div>
                                                <div className="text-xs text-gray-500">{p.whatsapp}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Type selector */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Jenis Follow Up *</label>
                                <select 
                                    value={manualForm.followupType}
                                    onChange={e => setManualForm({...manualForm, followupType: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm font-semibold"
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
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Tanggal Dijadwalkan *</label>
                                <input 
                                    type="date"
                                    value={manualForm.scheduledDate}
                                    onChange={e => setManualForm({...manualForm, scheduledDate: e.target.value})}
                                    className="input-ayumi focus:bg-gray-50 rounded-xl text-sm"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Priority */}
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Prioritas</label>
                                    <select 
                                        value={manualForm.priority}
                                        onChange={e => setManualForm({...manualForm, priority: e.target.value})}
                                        className="input-ayumi focus:bg-gray-50 rounded-xl text-sm font-semibold"
                                    >
                                        <option value="high">Tinggi (High)</option>
                                        <option value="normal">Normal (Medium)</option>
                                        <option value="low">Rendah (Low)</option>
                                    </select>
                                </div>

                                {/* Branch Selector (Only for Owner) */}
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Cabang</label>
                                    {isOwner ? (
                                        <select 
                                            value={manualForm.branchId}
                                            onChange={e => setManualForm({...manualForm, branchId: e.target.value})}
                                            className="input-ayumi focus:bg-gray-50 rounded-xl text-sm font-semibold"
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
                                            className="input-ayumi bg-gray-50 text-gray-500 cursor-not-allowed rounded-xl text-sm"
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Catatan Pengingat</label>
                                <textarea 
                                    value={manualForm.notes}
                                    onChange={e => setManualForm({...manualForm, notes: e.target.value})}
                                    rows="3"
                                    className="input-ayumi focus:bg-gray-50 resize-none text-sm rounded-xl"
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
                                    className="px-5 py-2.5 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-xs sm:text-sm cursor-pointer"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-2xl font-extrabold transition-all text-xs sm:text-sm shadow-md shadow-pink-500/20 cursor-pointer"
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
