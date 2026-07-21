'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import DateRangePicker from "../../../../components/DateRangePicker"

export default function TherapistDetailPage() {
    const params = useParams()
    const therapistId = params.id
    const router = useRouter()

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [isLoading, setIsLoading] = useState(true)
    const [isOwner, setIsOwner] = useState(false)
    const [userBranchId, setUserBranchId] = useState(null)
    const [userLoaded, setUserLoaded] = useState(false)

    // Meta details
    const [therapistInfo, setTherapistInfo] = useState(null)
    const [branches, setBranches] = useState([])

    // Filters
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [selectedBranch, setSelectedBranch] = useState('all')
    const [patientSearch, setPatientSearch] = useState('')

    // Raw action data
    const [treatmentRecords, setTreatmentRecords] = useState([])

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    useEffect(() => {
        // Initialize default dates (first day of current month to today)
        const now = new Date()
        const firstDay = getLocalYYYYMMDD(new Date(now.getFullYear(), now.getMonth(), 1))
        const todayStr = getLocalYYYYMMDD(now)
        setStartDate(firstDay)
        setEndDate(todayStr)
    }, [])

    useEffect(() => {
        checkAccessAndFetchInitialData()
    }, [therapistId])

    useEffect(() => {
        if (userLoaded && startDate && endDate) {
            fetchDetailData()
        }
    }, [userLoaded, startDate, endDate, selectedBranch])

    const checkAccessAndFetchInitialData = async () => {
        if (!therapistId) return

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('role, branch_id').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'owner') {
            alert('Akses ditolak. Halaman ini khusus untuk Owner.')
            router.push('/dashboard')
            return
        }

        setIsOwner(true)
        setUserBranchId(userData.branch_id)

        // Fetch Therapist Details
        const { data: therapistData, error: thError } = await supabase
            .from('users')
            .select('id, full_name, role, branch_id, branches(name)')
            .eq('id', therapistId)
            .maybeSingle()

        if (thError || !therapistData || therapistData.role !== 'therapist') {
            alert('Terapis tidak ditemukan.')
            router.push('/reports/therapists')
            return
        }

        setTherapistInfo(therapistData)

        // Fetch Branches
        const { data: branchData } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        if (branchData) setBranches(branchData)

        // Restrict branch filter for admin
        if (!isOwner && userData.branch_id) {
            setSelectedBranch(userData.branch_id)
        }

        setUserLoaded(true)
    }

    const fetchDetailData = async () => {
        setIsLoading(true)

        let query = supabase
            .from('treatment_record_items')
            .select(`
                id,
                price_at_time,
                original_price,
                discount_percent,
                commission_percent,
                notes,
                treatment_records!inner(
                    id,
                    treatment_date,
                    treatment_time,
                    branch_id,
                    branches(name),
                    patient_id,
                    patients(full_name, whatsapp)
                ),
                treatments(id, name)
            `)
            .eq('treatment_records.performed_by', therapistId)
            .gte('treatment_records.treatment_date', startDate)
            .lte('treatment_records.treatment_date', endDate)

        if (selectedBranch !== 'all') {
            query = query.eq('treatment_records.branch_id', selectedBranch)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching therapist detail report:', error)
        } else {
            // Sort treatment_records manually by date and time descending
            const sortedData = (data || []).sort((a, b) => {
                const dateA = new Date(`${a.treatment_records.treatment_date}T${a.treatment_records.treatment_time || '00:00:00'}`)
                const dateB = new Date(`${b.treatment_records.treatment_date}T${b.treatment_records.treatment_time || '00:00:00'}`)
                return dateB - dateA
            })
            setTreatmentRecords(sortedData)
        }

        setIsLoading(false)
    }

    // Filters patient name on the list
    const filteredRecords = useMemo(() => {
        return treatmentRecords.filter(r => {
            const patientName = r.treatment_records?.patients?.full_name?.toLowerCase() || ''
            return patientName.includes(patientSearch.toLowerCase())
        })
    }, [treatmentRecords, patientSearch])

    // Key Stats Calculation
    const stats = useMemo(() => {
        const totalIncome = treatmentRecords.reduce((acc, curr) => acc + Number(curr.price_at_time || 0), 0)
        const totalCommission = treatmentRecords.reduce((acc, curr) => {
            const price = Number(curr.price_at_time || 0)
            const commPercent = Number(curr.commission_percent || 0)
            return acc + Math.round(price * (commPercent / 100))
        }, 0)
        const totalTreatments = treatmentRecords.length
        return {
            totalIncome,
            totalCommission,
            totalTreatments
        }
    }, [treatmentRecords])

    // Charts calculations
    const chartData = useMemo(() => {
        // Line chart: Daily revenue
        const dailyMap = {}
        
        // Populate days between start date and end date
        const start = new Date(startDate)
        const end = new Date(endDate)
        const daysDiff = Math.min(Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1, 62) // Cap at 2 months for display safety
        
        for (let i = 0; i < daysDiff; i++) {
            const currentDay = new Date(start)
            currentDay.setDate(start.getDate() + i)
            const dateStr = currentDay.toISOString().split('T')[0]
            dailyMap[dateStr] = 0
        }

        // Fill in daily revenues
        treatmentRecords.forEach(item => {
            const dateStr = item.treatment_records?.treatment_date
            if (dateStr && dailyMap[dateStr] !== undefined) {
                dailyMap[dateStr] += Number(item.price_at_time || 0)
            }
        })

        const lineChart = Object.entries(dailyMap).map(([date, revenue]) => {
            const d = new Date(date)
            const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
            return { date, dateLabel, revenue }
        }).sort((a, b) => new Date(a.date) - new Date(b.date))

        // Bar Chart: Top 5 treatments
        const treatmentCounts = {}
        treatmentRecords.forEach(item => {
            const tName = item.treatments?.name || 'Unknown'
            treatmentCounts[tName] = (treatmentCounts[tName] || 0) + 1
        })

        const barChart = Object.entries(treatmentCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

        return {
            lineChart,
            barChart
        }
    }, [treatmentRecords, startDate, endDate])

    // Indonesian months helper
    const indonesianMonths = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ]

    // Export to Excel
    const handleExportExcel = () => {
        if (treatmentRecords.length === 0) {
            alert('Tidak ada data untuk diekspor pada filter terpilih.')
            return
        }

        // Map data to custom format for Excel rows
        const rows = filteredRecords.map((r, idx) => {
            const price = Number(r.price_at_time || 0)
            const commPercent = Number(r.commission_percent || 0)
            const commAmount = Math.round(price * (commPercent / 100))
            return {
                'No': idx + 1,
                'Tanggal': r.treatment_records?.treatment_date || '',
                'Waktu': r.treatment_records?.treatment_time?.substring(0, 5) || '',
                'Nama Pasien': r.treatment_records?.patients?.full_name || 'Tidak Diketahui',
                'WhatsApp': r.treatment_records?.patients?.whatsapp || '',
                'Treatment': r.treatments?.name || 'Tidak Diketahui',
                'Harga Treatment': price,
                'Komisi (%)': commPercent,
                'Komisi (Rp)': commAmount,
                'Cabang': r.treatment_records?.branches?.name || 'Pusat',
                'Status': 'Completed'
            }
        })

        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Riwayat_Treatment")

        // Parse date for filename
        const start = new Date(startDate)
        const monthStr = indonesianMonths[start.getMonth()]
        const yearStr = start.getFullYear()
        const therapistCleanName = (therapistInfo?.full_name || 'Terapis').replace(/[^a-zA-Z0-9]/g, '_')
        const filename = `Laporan_${therapistCleanName}_${monthStr}${yearStr}.xlsx`

        XLSX.writeFile(wb, filename)
    }

    const formatWA = (wa) => {
        if (!wa) return null
        let num = wa.replace(/[^0-9]/g, '')
        if (num.startsWith('0')) num = '62' + num.substring(1)
        return num
    }

    if (!userLoaded || !therapistInfo) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Mengambil Data Terapis...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 pb-16">
            
            {/* Top Navigation & Excel Export */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => router.push('/reports/therapists')}
                        className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-colors border border-gray-100 flex items-center justify-center"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-ayumi-secondary">Kembali ke Ringkasan</h1>
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

            {/* Profile Header Card */}
            <div className="card-ayumi p-5 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-5">
                    <div className="w-16 h-16 bg-pink-100 rounded-2xl flex items-center justify-center font-bold text-2xl text-ayumi-primary shadow-inner">
                        {therapistInfo.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-ayumi-secondary mb-1">{therapistInfo.full_name}</h2>
                        <span className="bg-purple-50 text-[#6B3A5A] px-3 py-1 rounded-md text-xs font-bold">
                            Cabang Penempatan: {therapistInfo.branches?.name || 'Tidak ada cabang'}
                        </span>
                    </div>
                </div>
                
                <div className="flex gap-6 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-8">
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Treatment</p>
                        <h4 className="text-2xl font-black text-ayumi-secondary mt-1 ">{stats.totalTreatments} Sesi</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-sans">Total Pendapatan</p>
                        <h4 className="text-2xl font-black text-ayumi-primary mt-1 ">Rp {stats.totalIncome.toLocaleString('id-ID')}</h4>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest font-sans">Total Komisi</p>
                        <h4 className="text-2xl font-black text-emerald-600 mt-1 ">Rp {stats.totalCommission.toLocaleString('id-ID')}</h4>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    {/* Date picker range */}
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

                    {/* Cabang dropdown */}
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={!isOwner}
                        className="input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg max-w-[200px]"
                    >
                        {isOwner && <option value="all">Semua Cabang (Tindakan)</option>}
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>

                {/* Patient Search */}
                <div className="relative w-full md:w-72">
                    <svg className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input 
                        type="text" 
                        placeholder="Cari pasien..."
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        className="input-ayumi pl-9 bg-gray-50 focus:bg-white text-xs"
                    />
                </div>
            </div>

            {/* Charts Visualizations */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Daily Revenue (Line Chart) */}
                <div className="card-ayumi p-4 md:p-6 lg:col-span-2">
                    <div className="border-b border-gray-100 pb-3 mb-6">
                        <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Tren Pendapatan Harian</h3>
                        <p className="text-[10px] text-ayumi-text-muted mt-0.5">Analisis pendapatan terapis dari hari ke hari dalam periode filter.</p>
                    </div>
                    <div className="h-64 w-full">
                        {isLoading ? (
                            <div className="h-full w-full bg-gray-50 animate-pulse rounded-lg" />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData.lineChart}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis dataKey="dateLabel" stroke="#8c7d73" fontSize={10} />
                                    <YAxis tickFormatter={(v) => `Rp ${v >= 1000000 ? (v/1000000) + 'M' : v >= 1000 ? (v/1000) + 'K' : v}`} stroke="#8c7d73" fontSize={10} />
                                    <RechartsTooltip formatter={(v) => 'Rp ' + v.toLocaleString('id-ID')} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                    <Line type="monotone" dataKey="revenue" stroke="#D46221" strokeWidth={3} dot={{ stroke: '#B5531B', strokeWidth: 1.5, r: 2 }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Top 5 Treatments (Bar Chart) */}
                <div className="card-ayumi p-4 md:p-6">
                    <div className="border-b border-gray-100 pb-3 mb-6">
                        <h3 className="text-sm font-bold text-ayumi-secondary uppercase tracking-wide">Top 5 Treatment Paling Sering</h3>
                        <p className="text-[10px] text-ayumi-text-muted mt-0.5">Jenis tindakan yang paling banyak dikerjakan terapis ini.</p>
                    </div>
                    <div className="h-64 w-full">
                        {isLoading ? (
                            <div className="h-full w-full bg-gray-50 animate-pulse rounded-lg" />
                        ) : chartData.barChart.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-xs text-gray-400 italic">Belum ada data treatment.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData.barChart} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis dataKey="name" stroke="#8c7d73" fontSize={8} tickFormatter={(t) => t.substring(0, 12) + (t.length > 12 ? '..' : '')} />
                                    <YAxis stroke="#8c7d73" fontSize={10} />
                                    <RechartsTooltip formatter={(v) => v + ' tindakan'} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                    <Bar dataKey="count" fill="#4E2A12" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Treatment History Table */}
            <div className="card-ayumi overflow-hidden">
                <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
                    <h3 className="text-lg font-bold text-ayumi-secondary">Riwayat Tindakan</h3>
                    <p className="text-xs text-ayumi-text-muted mt-1">Daftar lengkap sesi treatment yang ditangani terapis ini.</p>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block animate-spin w-8 h-8 border-4 border-ayumi-primary border-t-transparent rounded-full mb-3"></div>
                        <p className="text-sm text-gray-500 font-medium">Memuat riwayat tindakan...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="whitespace-nowrap w-full text-left text-sm">
                            <thead className="bg-ayumi-table-header text-ayumi-secondary font-bold uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-4">Tanggal & Waktu</th>
                                    <th className="px-6 py-4">Pasien</th>
                                    <th className="px-6 py-4">Treatment</th>
                                    <th className="px-6 py-4 text-center">Cabang</th>
                                    <th className="px-6 py-4 text-right">Harga</th>
                                    <th className="px-6 py-4 text-right">Komisi</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-center">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-gray-700 bg-white">
                                {filteredRecords.length === 0 ? (
                                    <tr><td colSpan="8" className="px-6 py-12 text-center text-gray-400">Tidak ada riwayat tindakan terapis ditemukan untuk filter ini.</td></tr>
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
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-gray-800">{r.treatment_records?.patients?.full_name || 'Tidak Diketahui'}</div>
                                                    <div className="text-xs text-gray-500 font-medium">{r.treatment_records?.patients?.whatsapp || '-'}</div>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">
                                                    {r.treatments?.name || 'Tindakan'}
                                                    {r.notes && <p className="text-xs text-gray-400 font-normal mt-0.5 italic">{r.notes}</p>}
                                                </td>
                                                <td className="px-6 py-4 text-center font-semibold text-xs text-gray-600">
                                                    <span className="bg-purple-50 text-[#6B3A5A] px-2.5 py-1 rounded-md font-bold">
                                                        {r.treatment_records?.branches?.name || 'Pusat'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-gray-800 ">
                                                    Rp {Number(r.price_at_time || 0).toLocaleString('id-ID')}
                                                </td>
                                                <td className="px-6 py-4 text-right ">
                                                    {(() => {
                                                        const price = Number(r.price_at_time || 0)
                                                        const commPercent = Number(r.commission_percent || 0)
                                                        const commAmount = Math.round(price * (commPercent / 100))
                                                        return commAmount > 0 ? (
                                                            <div className="flex flex-col items-end">
                                                                <span className="font-bold text-emerald-600">Rp {commAmount.toLocaleString('id-ID')}</span>
                                                                <span className="text-[10px] text-gray-400 mt-0.5">{commPercent}%</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400">Rp 0</span>
                                                        )
                                                    })()}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full text-xs font-bold border border-green-200">
                                                        Completed
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Link href={`/treatment-records/${r.treatment_records?.id}`}>
                                                            <button className="text-xs bg-pink-50 text-ayumi-primary hover:bg-pink-100 px-3 py-1.5 rounded-lg transition-colors font-bold uppercase tracking-wider">
                                                                Detail Record
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
