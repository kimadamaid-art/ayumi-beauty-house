'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import DateRangePicker from "../../../../components/DateRangePicker"

export default function TreatmentDetailPage() {
    const params = useParams()
    const treatmentId = params.id
    const router = useRouter()
    const searchParams = useSearchParams()

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [userLoaded, setUserLoaded] = useState(false)

    // Master Meta
    const [treatmentInfo, setTreatmentInfo] = useState(null)
    const [branches, setBranches] = useState([])
    const [therapists, setTherapists] = useState([])

    // Filters
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [selectedTherapist, setSelectedTherapist] = useState('all')
    const [patientSearch, setPatientSearch] = useState('')

    // Data lists
    const [treatmentRecords, setTreatmentRecords] = useState([])
    const [allHistory, setAllHistory] = useState([])

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    useEffect(() => {
        // Read initial filters from query string if available
        const qStart = searchParams.get('start')
        const qEnd = searchParams.get('end')
        const qBranch = searchParams.get('branch')
        
        const now = new Date()
        const firstDay = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1))
        const todayStr = getLocalYYYYMMDD(now)

        setStartDate(qStart || firstDay)
        setEndDate(qEnd || todayStr)
        if (qBranch) setSelectedBranch(qBranch)
    }, [searchParams])

    useEffect(() => {
        checkAccessAndFetchInitialData()
    }, [treatmentId])

    useEffect(() => {
        if (userLoaded && startDate && endDate) {
            fetchDetailData()
        }
    }, [userLoaded, startDate, endDate, selectedBranch])

    const checkAccessAndFetchInitialData = async () => {
        if (!treatmentId) return

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
        if (!userData || (userData.role !== 'owner' && userData.role !== 'admin')) {
            alert('Akses ditolak. Halaman ini khusus untuk Owner dan Admin.')
            router.push('/dashboard')
            return
        }

        const owner = userData.role === 'owner'
        setIsOwner(owner)
        setUserBranchId(userData.branch_id)

        // Fetch Master Treatment Info
        const { data: treatmentData, error: trError } = await supabase
            .from('treatments')
            .select(`
                *,
                treatment_categories(id, name)
            `)
            .eq('id', treatmentId)
            .maybeSingle()

        if (trError || !treatmentData) {
            alert('Treatment tidak ditemukan.')
            router.push('/reports/treatments')
            return
        }

        setTreatmentInfo(treatmentData)

        // Fetch Branches
        const { data: branchData } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        if (branchData) setBranches(branchData)

        // Fetch active therapists
        const { data: therapistData } = await supabase
            .from('users')
            .select('id, full_name')
            .eq('role', 'therapist')
            .eq('is_active', true)
            .order('full_name')
        if (therapistData) setTherapists(therapistData)

        if (!owner && userData.branch_id) {
            setSelectedBranch(userData.branch_id)
        }

        setUserLoaded(true)
    }

    const fetchDetailData = async () => {
        setIsLoading(true)

        // 1. Fetch treatment records in the date range
        let query = supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                original_price,
                discount_percent,
                notes,
                treatment_records!inner(
                    id,
                    treatment_date,
                    treatment_time,
                    branch_id,
                    branches(name),
                    patient_id,
                    patients(full_name, whatsapp),
                    therapist:users!treatment_records_therapist_id_fkey(id, full_name)
                ),
                treatments(name)
            `)
            .eq('treatment_id', treatmentId)
            .gte('treatment_records.treatment_date', startDate)
            .lte('treatment_records.treatment_date', endDate)

        if (selectedBranch !== 'all') {
            query = query.eq('treatment_records.branch_id', selectedBranch)
        }

        const { data: items, error: err } = await query

        if (err) {
            console.error('Error fetching details:', err)
        } else {
            setTreatmentRecords(items || [])
        }

        // 2. Fetch ALL historical treatment records for this treatment to calculate repeat indexes
        const { data: history, error: histErr } = await supabase
            .from('treatment_record_items')
            .select(`
                id,
                treatment_records!inner(
                    id,
                    patient_id,
                    treatment_date,
                    treatment_time
                )
            `)
            .eq('treatment_id', treatmentId)

        if (histErr) {
            console.error('Error fetching history:', histErr)
        } else {
            setAllHistory(history || [])
        }

        setIsLoading(false)
    }

    // Mapping items to chronological order index for "Repeat ke-X"
    const { itemSequenceMap, patientVisits } = useMemo(() => {
        const visits = {}
        allHistory.forEach(item => {
            const pId = item.treatment_records?.patient_id
            if (!pId) return
            if (!visits[pId]) visits[pId] = []
            
            visits[pId].push({
                itemId: item.id,
                dateTime: new Date(`${item.treatment_records.treatment_date}T${item.treatment_records.treatment_time || '00:00:00'}`)
            })
        })

        const sequenceMap = {}
        Object.values(visits).forEach(patientVisitsList => {
            patientVisitsList.sort((a, b) => a.dateTime - b.dateTime)
            patientVisitsList.forEach((v, idx) => {
                sequenceMap[v.itemId] = idx + 1
            })
        })

        return {
            itemSequenceMap: sequenceMap,
            patientVisits: visits
        }
    }, [allHistory])

    // Client-side filtering of therapist and patient name search
    const filteredRecords = useMemo(() => {
        return treatmentRecords.filter(item => {
            const pName = item.treatment_records?.patients?.full_name?.toLowerCase() || ''
            const matchSearch = pName.includes(patientSearch.toLowerCase())
            
            const therapistId = item.treatment_records?.therapist?.id || ''
            const matchTherapist = selectedTherapist === 'all' || therapistId === selectedTherapist

            return matchSearch && matchTherapist
        }).map(r => ({
            ...r,
            sequence: itemSequenceMap[r.id] || 1,
            therapistName: r.treatment_records?.therapist?.full_name || 'Tidak Diketahui'
        }))
    }, [treatmentRecords, patientSearch, selectedTherapist, itemSequenceMap])

    // Statistics Calculations
    const stats = useMemo(() => {
        const totalIncome = filteredRecords.reduce((acc, curr) => acc + Number(curr.price_at_time || 0), 0)
        const totalTreatments = filteredRecords.length
        
        const uniquePatients = new Set(filteredRecords.map(r => r.treatment_records?.patient_id).filter(Boolean))
        
        let newPatientsCount = 0
        let repeatPatientsCount = 0

        filteredRecords.forEach(r => {
            if (r.sequence === 1) {
                newPatientsCount += 1
            } else {
                repeatPatientsCount += 1
            }
        })

        return {
            totalIncome,
            totalTreatments,
            totalUniquePatients: uniquePatients.size,
            newPatientsCount,
            repeatPatientsCount
        }
    }, [filteredRecords])

    // Chart calculations
    const chartData = useMemo(() => {
        // Line chart aggregation (Daily, Weekly, Monthly) based on range days
        const start = new Date(startDate)
        const end = new Date(endDate)
        const diffTime = Math.abs(end - start)
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

        let lineChart = []

        if (diffDays <= 31) {
            // Daily
            const dailyMap = {}
            for (let i = 0; i < diffDays + 1; i++) {
                const d = new Date(start)
                d.setDate(start.getDate() + i)
                const dateStr = d.toISOString().split('T')[0]
                dailyMap[dateStr] = 0
            }
            filteredRecords.forEach(item => {
                const dateStr = item.treatment_records?.treatment_date
                if (dateStr && dailyMap[dateStr] !== undefined) {
                    dailyMap[dateStr] += 1
                }
            })
            lineChart = Object.entries(dailyMap).map(([date, count]) => {
                const d = new Date(date)
                const label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                return { date, label, count }
            }).sort((a, b) => new Date(a.date) - new Date(b.date))
        } else if (diffDays <= 180) {
            // Weekly
            const weeklyMap = {}
            filteredRecords.forEach(item => {
                const date = new Date(item.treatment_records?.treatment_date)
                const day = date.getDay()
                const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Monday
                const monday = new Date(date.setDate(diff)).toISOString().split('T')[0]
                weeklyMap[monday] = (weeklyMap[monday] || 0) + 1
            })
            lineChart = Object.entries(weeklyMap).map(([monday, count]) => {
                const d = new Date(monday)
                const label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                return { date: monday, label: 'Min-' + label, count }
            }).sort((a, b) => new Date(a.date) - new Date(b.date))
        } else {
            // Monthly
            const monthlyMap = {}
            filteredRecords.forEach(item => {
                const dateStr = item.treatment_records?.treatment_date
                if (!dateStr) return
                const monthKey = dateStr.substring(0, 7) // YYYY-MM
                monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + 1
            })
            lineChart = Object.entries(monthlyMap).map(([monthKey, count]) => {
                const [year, month] = monthKey.split('-')
                const d = new Date(year, month - 1, 1)
                const label = d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                return { date: monthKey, label, count }
            }).sort((a, b) => new Date(a.date + '-01') - new Date(b.date + '-01'))
        }

        // Bar Chart: Sessions per Branch
        const branchMap = {}
        filteredRecords.forEach(item => {
            const bName = item.treatment_records?.branches?.name || 'Pusat'
            branchMap[bName] = (branchMap[bName] || 0) + 1
        })
        const barChart = Object.entries(branchMap).map(([name, count]) => ({ name, count }))

        return {
            lineChart,
            barChart
        }
    }, [filteredRecords, startDate, endDate])

    // Retention Analysis calculations
    const retentionAnalysis = useMemo(() => {
        // Retention rate = (number of unique patients with >= 2 visits overall) / total unique patients overall
        const allPatientsCount = Object.keys(patientVisits).length
        const repeatPatientsList = Object.values(patientVisits).filter(visits => visits.length >= 2)
        const repeatPatientsCount = repeatPatientsList.length

        const retentionRate = allPatientsCount > 0 ? Math.round((repeatPatientsCount / allPatientsCount) * 100) : 0

        // Avg interval (days) between visits
        let totalDiffDays = 0
        let diffCount = 0
        Object.values(patientVisits).forEach(visits => {
            if (visits.length < 2) return
            for (let i = 1; i < visits.length; i++) {
                const diffTime = Math.abs(visits[i].dateTime - visits[i - 1].dateTime)
                const diffDays = diffTime / (1000 * 60 * 60 * 24)
                totalDiffDays += diffDays
                diffCount += 1
            }
        })
        const avgInterval = diffCount > 0 ? Math.round((totalDiffDays / diffCount) * 10) / 10 : 0

        return {
            retentionRate,
            avgInterval
        }
    }, [patientVisits])

    // Excel Exporter
    const handleExportExcel = () => {
        if (filteredRecords.length === 0) {
            alert('Tidak ada data untuk diekspor pada filter terpilih.')
            return
        }

        // Construct sheets
        const titleRow = [['LAPORAN DETAIL TREATMENT: ' + (treatmentInfo?.name || '').toUpperCase()]]
        const metaRows = [
            ['Kategori', treatmentInfo?.treatment_categories?.name || ''],
            ['Harga Master', treatmentInfo?.price || 0],
            ['Durasi', (treatmentInfo?.duration_minutes || '') + ' Menit'],
            ['Target Follow Up', (treatmentInfo?.followup_days || '') + ' Hari'],
            ['Periode Filter', startDate + ' s.d ' + endDate],
            [''],
            ['METRIK UTAMA PERIODE'],
            ['Total Sesi Dilakukan', stats.totalTreatments],
            ['Total Pendapatan', stats.totalIncome],
            ['Total Pasien Unik', stats.totalUniquePatients],
            ['Pasien Baru', stats.newPatientsCount],
            ['Pasien Repeat', stats.repeatPatientsCount],
            [''],
            ['DAFTAR DATA PASIEN']
        ]

        const headers = ['No', 'Tanggal', 'Waktu', 'Nama Pasien', 'WhatsApp', 'Cabang', 'Terapis', 'Harga Sesi', 'Status']
        const patientRows = filteredRecords.map((r, idx) => [
            idx + 1,
            r.treatment_records?.treatment_date || '',
            r.treatment_records?.treatment_time?.substring(0, 5) || '',
            r.treatment_records?.patients?.full_name || 'Tidak Diketahui',
            r.treatment_records?.patients?.whatsapp || '',
            r.treatment_records?.branches?.name || 'Pusat',
            r.therapistName,
            r.price_at_time || 0,
            r.sequence === 1 ? 'Baru' : `Repeat ke-${r.sequence}`
        ])

        const allSheetData = [...titleRow, ...metaRows, headers, ...patientRows]
        const ws = XLSX.utils.aoa_to_sheet(allSheetData)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Laporan_Treatment")

        const cleanedTreatmentName = (treatmentInfo?.name || 'Treatment').replace(/[^a-zA-Z0-9]/g, '_')
        const filename = `Laporan_${cleanedTreatmentName}_${startDate}_to_${endDate}.xlsx`

        XLSX.writeFile(wb, filename)
    }

    const formatWA = (wa) => {
        if (!wa) return null
        let num = wa.replace(/[^0-9]/g, '')
        if (num.startsWith('0')) num = '62' + num.substring(1)
        return num
    }

    if (!userLoaded || !treatmentInfo) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memuat Detail Perawatan...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 pb-16">
            
            {/* Top Navigation & Export Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Link href="/reports/treatments">
                        <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors border border-gray-100 flex items-center justify-center">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </button>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-ayumi-secondary">Kembali ke Laporan</h1>
                    </div>
                </div>

                <button 
                    onClick={handleExportExcel}
                    className="btn-secondary px-6 py-2.5 flex items-center gap-2 text-sm font-bold shadow-sm"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Export Excel
                </button>
            </div>

            {/* Profile Header Detail */}
            <div className="card-ayumi p-5 md:p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-white">
                <div className="flex items-center gap-5">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl flex items-center justify-center text-ayumi-primary font-bold shadow-inner shrink-0">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-ayumi-secondary mb-1.5">{treatmentInfo.name}</h2>
                        <div className="flex flex-wrap gap-2 items-center">
                            <span className="bg-pink-50 text-ayumi-primary px-3 py-1 rounded-md text-xs font-bold">
                                Kategori: {treatmentInfo.treatment_categories?.name || 'Tidak ada kategori'}
                            </span>
                            <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-xs font-bold">
                                Rp {treatmentInfo.price?.toLocaleString('id-ID')}
                            </span>
                            <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-md text-xs font-bold">
                                ⏱ {treatmentInfo.duration_minutes || '0'} Menit
                            </span>
                            <span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-md text-xs font-bold">
                                📅 Target F/U: {treatmentInfo.followup_days || '0'} Hari
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t lg:border-t-0 lg:border-l border-gray-100 pt-4 lg:pt-0 lg:pl-8 min-w-[250px]">
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Sesi</p>
                        <h4 className="text-xl font-black text-ayumi-secondary mt-0.5 font-mono">{stats.totalTreatments} Sesi</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Pasien Unik</p>
                        <h4 className="text-xl font-black text-ayumi-secondary mt-0.5 font-mono">{stats.totalUniquePatients} Orang</h4>
                    </div>
                    <div className="col-span-2 mt-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Pendapatan</p>
                        <h4 className="text-2xl font-black text-ayumi-primary mt-0.5 font-mono">Rp {stats.totalIncome.toLocaleString('id-ID')}</h4>
                    </div>
                </div>
            </div>

            {/* Sub-widgets / Ratios */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Rasio Baru vs Repeat */}
                <div className="card-ayumi p-4 md:p-6 flex flex-col justify-between">
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rasio Pengunjung Periode Ini</h4>
                        <p className="text-xs text-ayumi-text-muted mt-1">Pasien pertama kali treatment vs melakukan tindakan ulang.</p>
                    </div>
                    <div className="flex gap-4 mt-6">
                        <div className="flex-1 bg-blue-50 border border-blue-100 p-4 rounded-xl text-center">
                            <h4 className="text-2xl font-black text-blue-700 font-mono">{stats.newPatientsCount}</h4>
                            <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block mt-1">Pasien Baru</span>
                        </div>
                        <div className="flex-1 bg-orange-50 border border-orange-100 p-4 rounded-xl text-center">
                            <h4 className="text-2xl font-black text-orange-700 font-mono">{stats.repeatPatientsCount}</h4>
                            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wider block mt-1">Pasien Repeat</span>
                        </div>
                    </div>
                </div>

                {/* Retention Analysis */}
                <div className="card-ayumi p-4 md:p-6 lg:col-span-2 flex flex-col justify-between">
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Retention & Loyalty Treatment Ini</h4>
                        <p className="text-xs text-ayumi-text-muted mt-1">Seberapa loyal pasien kembali melakukan tindakan yang sama.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div className="flex gap-4 items-center">
                            <div className="w-12 h-12 bg-pink-50 text-ayumi-primary rounded-xl flex items-center justify-center font-black text-lg">
                                {retentionAnalysis.retentionRate}%
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-gray-800">Retention Rate</h4>
                                <p className="text-[10px] text-gray-500 font-medium">Pasien yang kembali {`>=`} 2 kali.</p>
                            </div>
                        </div>

                        <div className="flex gap-4 items-center">
                            <div className="w-12 h-12 bg-amber-50 text-amber-700 rounded-xl flex items-center justify-center font-black text-sm font-mono">
                                {retentionAnalysis.avgInterval} Hari
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-gray-800">Rerata Jarak Kunjungan</h4>
                                <p className="text-[10px] text-gray-500 font-medium">Jarak hari antar sesi treatment.</p>
                            </div>
                        </div>
                    </div>

                    {/* Target followup days comparison */}
                    <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs font-semibold text-gray-700 flex items-center gap-2">
                        <svg className="w-5 h-5 text-ayumi-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>
                            {retentionAnalysis.avgInterval === 0 ? (
                                'Belum ada data repeat untuk menghitung jarak kunjungan.'
                            ) : (() => {
                                const diff = Math.abs(retentionAnalysis.avgInterval - (treatmentInfo.followup_days || 0))
                                const diffClean = Math.round(diff * 10) / 10
                                if (retentionAnalysis.avgInterval > (treatmentInfo.followup_days || 0)) {
                                    return `Rata-rata pasien kembali ${diffClean} hari LEBIH LAMBAT dari jadwal follow-up (${treatmentInfo.followup_days} hari).`
                                } else if (retentionAnalysis.avgInterval < (treatmentInfo.followup_days || 0)) {
                                    return `Rata-rata pasien kembali ${diffClean} hari LEBIH CEPAT dari jadwal follow-up (${treatmentInfo.followup_days} hari).`
                                } else {
                                    return `Rata-rata pasien kembali tepat waktu sesuai jadwal follow-up (${treatmentInfo.followup_days} hari).`
                                }
                            })()}
                        </span>
                    </div>
                </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    
                    {/* Custom range dates */}
                    <div className="w-full sm:w-[290px] relative z-20">
                        <DateRangePicker 
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(range) => {
                                setStartDate(range.startDate);
                                setEndDate(range.endDate);
                            }}
                            inputClassName="w-full input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg"
                        />
                    </div>

                    {/* Branch filter */}
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={!isOwner}
                        className="input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg max-w-[170px]"
                    >
                        {isOwner && <option value="all">Semua Cabang</option>}
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>

                    {/* Therapist filter */}
                    <select
                        value={selectedTherapist}
                        onChange={(e) => setSelectedTherapist(e.target.value)}
                        className="input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg max-w-[170px]"
                    >
                        <option value="all">Semua Terapis</option>
                        {therapists.map(t => (
                            <option key={t.id} value={t.id}>{t.full_name}</option>
                        ))}
                    </select>
                </div>

                {/* Patient Search */}
                <div className="relative w-full md:w-64">
                    <svg className="w-4 h-4 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input 
                        type="text" 
                        placeholder="Cari pasien..."
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        className="input-ayumi pl-9 bg-gray-50 focus:bg-white text-xs py-2"
                    />
                </div>
            </div>

            {/* Visual Charts Detail */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Line Chart Tren Sesi */}
                <div className="card-ayumi p-4 md:p-6 lg:col-span-2">
                    <div className="border-b border-gray-100 pb-3 mb-6">
                        <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Tren Kuantitas Sesi Tindakan</h3>
                    </div>
                    <div className="h-64 w-full">
                        {isLoading ? (
                            <div className="h-full w-full bg-gray-50 animate-pulse rounded-lg" />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData.lineChart}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis dataKey="label" stroke="#8c7d73" fontSize={10} />
                                    <YAxis stroke="#8c7d73" fontSize={10} />
                                    <RechartsTooltip formatter={(v) => v + ' sesi'} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                    <Line type="monotone" dataKey="count" stroke="#D46221" strokeWidth={3} dot={{ stroke: '#B5531B', strokeWidth: 1.5, r: 2 }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Bar Chart Sesi Per Cabang */}
                <div className="card-ayumi p-4 md:p-6">
                    <div className="border-b border-gray-100 pb-3 mb-6">
                        <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Sebaran Sesi Per Cabang</h3>
                    </div>
                    <div className="h-64 w-full">
                        {isLoading ? (
                            <div className="h-full w-full bg-gray-50 animate-pulse rounded-lg" />
                        ) : chartData.barChart.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-xs text-gray-400 italic">Belum ada data treatment per cabang.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData.barChart} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis dataKey="name" stroke="#8c7d73" fontSize={10} />
                                    <YAxis stroke="#8c7d73" fontSize={10} />
                                    <RechartsTooltip formatter={(v) => v + ' sesi'} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                    <Bar dataKey="count" fill="#4E2A12" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Patient Table History */}
            <div className="card-ayumi overflow-hidden">
                <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
                    <h3 className="text-lg font-bold text-ayumi-secondary">Daftar Kunjungan Pasien</h3>
                    <p className="text-xs text-ayumi-text-muted mt-1">Histori lengkap pasien yang melakukan perawatan ini dalam periode filter.</p>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block animate-spin w-8 h-8 border-4 border-ayumi-primary border-t-transparent rounded-full mb-3"></div>
                        <p className="text-sm text-gray-500 font-medium">Memuat data histori...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left text-sm">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-4">Tanggal & Waktu</th>
                                    <th className="px-6 py-4">Pasien</th>
                                    <th className="px-6 py-4">WhatsApp</th>
                                    <th className="px-6 py-4 text-center">Cabang</th>
                                    <th className="px-6 py-4">Terapis</th>
                                    <th className="px-6 py-4 text-right">Harga Sesi</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-gray-700 bg-white">
                                {filteredRecords.length === 0 ? (
                                    <tr><td colSpan="8" className="px-6 py-12 text-center text-gray-400 font-medium">Belum ada riwayat tindakan pasien untuk filter ini.</td></tr>
                                ) : (
                                    filteredRecords.map((r) => {
                                        const waNumber = formatWA(r.treatment_records?.patients?.whatsapp)
                                        return (
                                            <tr key={r.id} className="hover:bg-ayumi-table-hover transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="font-bold text-gray-800">
                                                        {new Date(r.treatment_records.treatment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </div>
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        {r.treatment_records.treatment_time?.substring(0, 5) || '-'} WIB
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">
                                                    {r.treatment_records?.patients?.full_name || 'Tidak Diketahui'}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-gray-500">
                                                    {r.treatment_records?.patients?.whatsapp || '-'}
                                                </td>
                                                <td className="px-6 py-4 text-center font-semibold text-xs text-gray-600">
                                                    <span className="bg-purple-50 text-[#6B3A5A] px-2.5 py-1 rounded-md font-bold">
                                                        {r.treatment_records?.branches?.name || 'Pusat'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">
                                                    {r.therapistName}
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-gray-800 font-mono">
                                                    Rp {Number(r.price_at_time || 0).toLocaleString('id-ID')}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {r.sequence === 1 ? (
                                                        <span className="bg-green-100 text-green-800 px-2.5 py-1 rounded-full text-xs font-bold border border-green-200">
                                                            Baru
                                                        </span>
                                                    ) : (
                                                        <span className="bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full text-xs font-bold border border-blue-200">
                                                            Repeat ke-{r.sequence}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Link href={`/treatment-records/${r.treatment_records?.id}`}>
                                                            <button className="text-xs bg-pink-50 text-ayumi-primary hover:bg-pink-100 px-3 py-1.5 rounded-lg transition-colors font-bold uppercase tracking-wider">
                                                                Record
                                                            </button>
                                                        </Link>
                                                        {waNumber && (
                                                            <a 
                                                                href={`https://wa.me/${waNumber}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors font-bold border border-transparent hover:border-green-300 flex items-center gap-1.5"
                                                            >
                                                                Chat WA
                                                            </a>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
