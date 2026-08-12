'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import DateRangePicker from '@/components/DateRangePicker'

function TherapistAppointmentsContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialTab = searchParams.get('tab') === 'history' ? 'history' : 'appointments'

    const [activeTab, setActiveTab] = useState(initialTab)
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)

    // Data lists
    const [appointments, setAppointments] = useState([])
    const [records, setRecords] = useState([])

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Filters for Tab 1 (Jadwal) - default to Today
    const [aptStartDate, setAptStartDate] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [aptEndDate, setAptEndDate] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [aptFilterStatus, setAptFilterStatus] = useState('')

    // Filters for Tab 2 (Riwayat & Komisi) - default to Today
    const [recPreset, setRecPreset] = useState('today') // 'today' | 'week' | 'month' | 'custom'
    const [recStartDate, setRecStartDate] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [recEndDate, setRecEndDate] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [recFilterBranch, setRecFilterBranch] = useState('')

    useEffect(() => {
        fetchInitial()
    }, [])

    useEffect(() => {
        if (dbUser) {
            if (activeTab === 'appointments') {
                fetchAppointments()
            } else {
                fetchHistoryRecords()
            }
        }
    }, [dbUser, activeTab, aptFilterStatus, aptStartDate, aptEndDate, recStartDate, recEndDate, recFilterBranch])

    const fetchInitial = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }

        setDbUser(userData)

        const { data: branchData } = await supabase.from('branches').select('id, name')
        if (branchData) setBranches(branchData)

        // Initial fetch
        if (initialTab === 'history') {
            fetchHistoryRecords(userData.id)
        } else {
            fetchAppointments(userData.id)
        }
    }

    const fetchAppointments = async (userId = dbUser?.id) => {
        if (!userId) return
        setLoading(true)
        let query = supabase
            .from('appointments')
            .select(`
                *,
                patients (id, full_name, whatsapp),
                branches (name)
            `)
            .eq('therapist_id', userId)
            .order('appointment_date', { ascending: false })
            .order('start_time', { ascending: true })

        if (aptFilterStatus) query = query.eq('status', aptFilterStatus)
        if (aptStartDate && aptEndDate) {
            query = query.gte('appointment_date', aptStartDate).lte('appointment_date', aptEndDate)
        }

        const { data } = await query
        if (data) setAppointments(data)
        setLoading(false)
    }

    const fetchHistoryRecords = async (userId = dbUser?.id) => {
        if (!userId) return
        setLoading(true)
        let query = supabase
            .from('treatment_records')
            .select(`
                *,
                patients (id, full_name, whatsapp),
                branches (name),
                treatment_record_items (
                    id, price_at_time, original_price, discount_percent, commission_percent, notes,
                    treatments (name)
                )
            `)
            .eq('performed_by', userId)
            .order('treatment_date', { ascending: false })

        if (recFilterBranch) query = query.eq('branch_id', recFilterBranch)
        if (recStartDate && recEndDate) {
            query = query.gte('treatment_date', recStartDate).lte('treatment_date', recEndDate)
        }

        const { data } = await query
        if (data) setRecords(data)
        setLoading(false)
    }

    const handleRecPresetChange = (preset) => {
        setRecPreset(preset)
        const now = new Date()
        if (preset === 'today') {
            const dateStr = getLocalYYYYMMDD(now)
            setRecStartDate(dateStr)
            setRecEndDate(dateStr)
        } else if (preset === 'week') {
            const d = new Date()
            const dayOfWeek = d.getDay()
            const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
            const monday = new Date(d.setDate(diffToMon))
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            setRecStartDate(getLocalYYYYMMDD(monday))
            setRecEndDate(getLocalYYYYMMDD(sunday))
        } else if (preset === 'month') {
            const y = now.getFullYear()
            const m = now.getMonth()
            const first = new Date(y, m, 1)
            const last = new Date(y, m + 1, 0)
            setRecStartDate(getLocalYYYYMMDD(first))
            setRecEndDate(getLocalYYYYMMDD(last))
        }
    }

    const historyCommissionSummary = useMemo(() => {
        let totalRevenue = 0
        let totalCommission = 0
        let totalTreatmentItems = 0

        records.forEach(r => {
            if (r.treatment_record_items) {
                r.treatment_record_items.forEach(item => {
                    const priceAtTime = Number(item.price_at_time || 0)
                    const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                        ? Number(item.original_price)
                        : priceAtTime
                    const commPercent = Number(item.commission_percent || 0)
                    const commAmount = Math.round(basePrice * (commPercent / 100))

                    totalRevenue += priceAtTime
                    totalCommission += commAmount
                    totalTreatmentItems += 1
                })
            }
        })

        return {
            totalRevenue,
            totalCommission,
            totalTreatmentItems,
            recordCount: records.length
        }
    }, [records])

    const getStatusBadge = (status) => {
        const badges = {
            'scheduled': 'bg-blue-100 text-blue-700 border-blue-200',
            'confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200',
            'completed': 'bg-gray-100 text-gray-700 border-gray-200',
            'cancelled': 'bg-red-100 text-red-700 border-red-200',
            'no_show': 'bg-amber-100 text-amber-700 border-amber-200'
        }
        const labels = {
            'scheduled': 'Terjadwal',
            'confirmed': 'Dikonfirmasi',
            'completed': 'Selesai',
            'cancelled': 'Dibatalkan',
            'no_show': 'No Show'
        }
        return (
            <span className={`px-3 py-1 rounded-full text-xs font-extrabold border ${badges[status] || 'bg-gray-100 text-gray-700'}`}>
                {labels[status] || status}
            </span>
        )
    }

    const formatPeriodLabel = (startDate, endDate) => {
        if (!startDate || !endDate) return 'Semua Periode'
        const s = new Date(startDate + 'T00:00:00')
        const e = new Date(endDate + 'T00:00:00')
        if (startDate === endDate) {
            return s.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        }
        return `${s.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${e.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }

    return (
        <div className="w-full space-y-6">
            {/* Header Summary Card */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-3xl border border-gray-150 shadow-sm">
                <div>
                    <h2 className="text-base font-extrabold text-gray-900 leading-tight">Modul Perawatan Terapis</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Kelola jadwal janji temu pasien dan riwayat tindakan treatment Anda dalam satu tempat.</p>
                </div>

                <div className="bg-pink-50 border border-pink-100 px-5 py-2.5 rounded-2xl flex items-center gap-3 shrink-0">
                    <div className="w-9 h-9 bg-ayumi-primary text-white rounded-xl flex items-center justify-center font-bold text-sm">
                        {activeTab === 'appointments' ? '📅' : '📋'}
                    </div>
                    <div>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                            {activeTab === 'appointments' ? formatPeriodLabel(aptStartDate, aptEndDate) : formatPeriodLabel(recStartDate, recEndDate)}
                        </div>
                        <div className="text-lg font-black text-ayumi-primary leading-none mt-0.5">
                            {activeTab === 'appointments' ? appointments.length : records.length} <span className="text-xs font-bold text-gray-500">pasien</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* UNIFIED SEGMENT TABS */}
            <div className="bg-white p-2 rounded-3xl border border-gray-150 shadow-sm flex flex-wrap sm:flex-nowrap gap-2">
                <button
                    onClick={() => {
                        setActiveTab('appointments')
                        router.replace('/therapist/appointments')
                    }}
                    className={`flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'appointments' ? 'bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white shadow-md font-extrabold' : 'text-gray-600 hover:bg-pink-50/50 hover:text-ayumi-primary'}`}
                >
                    <span>📅 Jadwal & Janji Temu</span>
                    {appointments.length > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'appointments' ? 'bg-white/20 text-white' : 'bg-pink-100 text-ayumi-primary'}`}>
                            {appointments.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => {
                        setActiveTab('history')
                        router.replace('/therapist/appointments?tab=history')
                    }}
                    className={`flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'history' ? 'bg-gradient-to-r from-ayumi-secondary to-ayumi-primary text-white shadow-md font-extrabold' : 'text-gray-600 hover:bg-pink-50/50 hover:text-ayumi-primary'}`}
                >
                    <span>📜 Riwayat Treatment Selesai</span>
                    {records.length > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-pink-100 text-ayumi-primary'}`}>
                            {records.length}
                        </span>
                    )}
                </button>
            </div>

            {/* TAB CONTENT CONTAINER */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 md:p-6">
                
                {/* ─── TAB 1: JADWAL TREATMENT ────────────────────────────────────────── */}
                {activeTab === 'appointments' && (
                    <div className="space-y-6">
                        {/* Filter row with DateRangePicker */}
                        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                            <div className="flex-1 sm:max-w-xs relative z-20">
                                <DateRangePicker
                                    startDate={aptStartDate}
                                    endDate={aptEndDate}
                                    onChange={(range) => {
                                        setAptStartDate(range.startDate)
                                        setAptEndDate(range.endDate)
                                    }}
                                    inputClassName="w-full input-ayumi bg-white border-2 border-pink-200 hover:border-ayumi-primary focus:bg-white text-xs font-bold py-2.5 px-4 rounded-2xl cursor-pointer"
                                    align="left"
                                />
                            </div>
                            <select
                                value={aptFilterStatus}
                                onChange={(e) => setAptFilterStatus(e.target.value)}
                                className="input-ayumi bg-white border-2 border-pink-200 hover:border-ayumi-primary focus:bg-white flex-1 sm:max-w-xs font-bold text-sm rounded-2xl cursor-pointer py-2.5"
                            >
                                <option value="">Semua Status</option>
                                <option value="scheduled">Scheduled (Terjadwal)</option>
                                <option value="confirmed">Confirmed (Dikonfirmasi)</option>
                                <option value="completed">Completed (Selesai)</option>
                            </select>
                        </div>

                        {loading ? (
                            <div className="text-center py-20">
                                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                                <p className="text-gray-500 font-medium">Memuat jadwal treatment...</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                <table className="whitespace-nowrap w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-pink-50/60 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider">
                                            <th className="p-4">Tanggal & Waktu</th>
                                            <th className="p-4">Pasien</th>
                                            <th className="p-4">Cabang</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4 text-center">Aksi / Tindakan</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                        {appointments.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-12 text-center border-none">
                                                    <div className="w-14 h-14 bg-pink-50 rounded-full flex items-center justify-center mb-3 mx-auto text-ayumi-primary font-bold text-xl">
                                                        📅
                                                    </div>
                                                    <p className="text-gray-600 font-extrabold text-base mb-1">Belum Ada Jadwal Treatment</p>
                                                    <p className="text-gray-400 text-xs">Belum ada janji temu pasien yang ditugaskan kepada Anda untuk rentang tanggal ini.</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            appointments.map(apt => (
                                                <tr key={apt.id} className="hover:bg-pink-50/20 transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-gray-900">
                                                            {new Date(apt.appointment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                        </div>
                                                        <div className="text-xs text-ayumi-primary font-bold mt-0.5">
                                                            {apt.start_time ? apt.start_time.substring(0, 5) : '-'} - {apt.end_time ? apt.end_time.substring(0, 5) : '-'}
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-gray-900">{apt.patients?.full_name || '-'}</div>
                                                        <div className="text-xs text-gray-400 mt-0.5">{apt.patients?.whatsapp || ''}</div>
                                                    </td>
                                                    <td className="p-4 text-xs font-semibold text-gray-600">
                                                        {apt.branches?.name || '-'}
                                                    </td>
                                                    <td className="p-4">
                                                        {getStatusBadge(apt.status)}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {apt.status !== 'completed' && apt.status !== 'cancelled' ? (
                                                            <Link href={`/therapist/treatment-input/${apt.id}`}>
                                                                <button className="bg-ayumi-primary hover:bg-[#9a4b75] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 mx-auto cursor-pointer">
                                                                    <span>📝 Input Treatment & SOAP</span>
                                                                </button>
                                                            </Link>
                                                        ) : (
                                                            <span className="text-xs text-gray-400 font-medium">Tindakan Selesai</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── TAB 2: RIWAYAT TREATMENT & KOMISI SELESAI ─────────────────────────────── */}
                {activeTab === 'history' && (
                    <div className="space-y-6">
                        {/* Summary Cards Header */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-gradient-to-br from-ayumi-secondary to-ayumi-primary rounded-2xl p-4 text-white shadow-sm flex flex-col justify-between">
                                <div className="text-[11px] font-bold text-pink-200 uppercase tracking-wider">Total Komisi Periode Ini</div>
                                <div className="text-2xl font-black mt-1">
                                    Rp {historyCommissionSummary.totalCommission.toLocaleString('id-ID')}
                                </div>
                                <div className="text-[10px] text-pink-100 mt-2 font-medium">Akumulasi komisi seluruh tindakan</div>
                            </div>
                            <div className="bg-pink-50/70 border border-pink-200 rounded-2xl p-4 flex flex-col justify-between">
                                <div className="text-[11px] font-bold text-ayumi-secondary uppercase tracking-wider">Jumlah Treatment Selesai</div>
                                <div className="text-2xl font-black text-gray-900 mt-1">
                                    {historyCommissionSummary.totalTreatmentItems} <span className="text-xs font-bold text-gray-500">Tindakan</span>
                                </div>
                                <div className="text-[10px] text-gray-500 mt-2 font-medium">Dari {historyCommissionSummary.recordCount} kunjungan pasien</div>
                            </div>
                        </div>

                        {/* Filter row with presets, DateRangePicker, and Branch selector */}
                        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between border-t border-gray-100 pt-4">
                            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                                <div className="bg-pink-50 p-1 rounded-2xl border border-pink-100 flex flex-wrap gap-1">
                                    <button
                                        onClick={() => handleRecPresetChange('today')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${recPreset === 'today' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                                    >
                                        Hari Ini
                                    </button>
                                    <button
                                        onClick={() => handleRecPresetChange('week')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${recPreset === 'week' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                                    >
                                        Minggu Ini
                                    </button>
                                    <button
                                        onClick={() => handleRecPresetChange('month')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${recPreset === 'month' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                                    >
                                        Bulan Ini
                                    </button>
                                    <button
                                        onClick={() => setRecPreset('custom')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${recPreset === 'custom' ? 'bg-ayumi-primary text-white shadow-sm' : 'text-gray-600 hover:text-ayumi-primary'}`}
                                    >
                                        Custom
                                    </button>
                                </div>

                                {recPreset === 'custom' && (
                                    <div className="w-full sm:w-auto z-20">
                                        <DateRangePicker
                                            startDate={recStartDate}
                                            endDate={recEndDate}
                                            onChange={(range) => {
                                                setRecStartDate(range.startDate)
                                                setRecEndDate(range.endDate)
                                            }}
                                            inputClassName="w-full input-ayumi bg-white border-2 border-pink-200 hover:border-ayumi-primary text-xs font-bold py-2 px-3 rounded-2xl cursor-pointer"
                                            align="left"
                                        />
                                    </div>
                                )}
                            </div>

                            <select
                                value={recFilterBranch}
                                onChange={(e) => setRecFilterBranch(e.target.value)}
                                className="input-ayumi bg-white border-2 border-pink-200 hover:border-ayumi-primary focus:bg-white w-full lg:w-48 font-bold text-xs rounded-2xl cursor-pointer py-2"
                            >
                                <option value="">Semua Cabang</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>

                        {loading ? (
                            <div className="text-center py-20">
                                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                                <p className="text-gray-500 font-medium">Memuat riwayat treatment & komisi...</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-2xl border border-gray-200/80 shadow-sm">
                                <table className="whitespace-nowrap w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-pink-50/60 text-ayumi-secondary text-xs uppercase font-extrabold tracking-wider">
                                            <th className="p-4">Tanggal & Waktu</th>
                                            <th className="p-4">Pasien</th>
                                            <th className="p-4">Cabang</th>
                                            <th className="p-4">Treatment & SOAP</th>
                                            <th className="p-4 text-right">Rincian Komisi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-sm bg-white">
                                        {records.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-12 text-center border-none">
                                                    <div className="w-14 h-14 bg-pink-50 rounded-full flex items-center justify-center mb-3 mx-auto text-ayumi-primary font-bold text-xl">
                                                        🔍
                                                    </div>
                                                    <p className="text-gray-600 font-extrabold text-base mb-1">Belum Ada Riwayat Perawatan</p>
                                                    <p className="text-gray-400 text-xs">Belum ada rekam medis & komisi tersimpan untuk periode ini.</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            records.map(r => {
                                                let totalRecordCommission = 0
                                                const itemsList = r.treatment_record_items || []

                                                itemsList.forEach(item => {
                                                    const priceAtTime = Number(item.price_at_time || 0)
                                                    const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                                                        ? Number(item.original_price)
                                                        : priceAtTime
                                                    const commPercent = Number(item.commission_percent || 0)
                                                    totalRecordCommission += Math.round(basePrice * (commPercent / 100))
                                                })

                                                return (
                                                    <tr key={r.id} className="hover:bg-pink-50/20 transition-colors">
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-900">
                                                                {new Date(r.treatment_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                            </div>
                                                            <div className="text-xs text-gray-400 mt-0.5">{r.treatment_time || ''}</div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="font-bold text-gray-900">{r.patients?.full_name || '-'}</div>
                                                            <div className="text-xs text-gray-400 mt-0.5">{r.patients?.whatsapp || ''}</div>
                                                        </td>
                                                        <td className="p-4 text-xs font-semibold text-gray-600">
                                                            {r.branches?.name || '-'}
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex flex-col gap-1">
                                                                {itemsList.length > 0 ? (
                                                                    itemsList.map(item => (
                                                                        <div key={item.id} className="flex items-center gap-2">
                                                                            <span className="px-2.5 py-0.5 bg-pink-100 text-ayumi-primary text-xs font-bold rounded-lg border border-pink-200">
                                                                                {item.treatments?.name || 'Treatment'}
                                                                            </span>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <span className="text-xs text-gray-400 font-medium">-</span>
                                                                )}
                                                            </div>
                                                            {(r.result_notes || r.recommendation || r.complaints) && (
                                                                <p className="text-xs text-gray-500 font-medium max-w-xs truncate mt-1">
                                                                    📝 {r.result_notes || r.recommendation || r.complaints}
                                                                </p>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-right">
                                                            <div className="flex flex-col items-end gap-1">
                                                                <span className="text-sm font-black text-emerald-600">
                                                                    +Rp {totalRecordCommission.toLocaleString('id-ID')}
                                                                </span>
                                                                <div className="flex flex-wrap justify-end gap-1">
                                                                    {itemsList.map(item => {
                                                                        const priceAtTime = Number(item.price_at_time || 0)
                                                                        const basePrice = (priceAtTime === 0 && Number(item.original_price || 0) > 0)
                                                                            ? Number(item.original_price)
                                                                            : priceAtTime
                                                                        const commPercent = Number(item.commission_percent || 0)
                                                                        const itemComm = Math.round(basePrice * (commPercent / 100))

                                                                        return (
                                                                            <span key={item.id} className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-bold" title={`${item.treatments?.name}: ${commPercent}%`}>
                                                                                {commPercent}% (Rp {itemComm.toLocaleString('id-ID')})
                                                                            </span>
                                                                        )
                                                                    })}
                                                                </div>
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
                )}

            </div>
        </div>
    )
}

export default function TherapistAppointments() {
    return (
        <Suspense fallback={
            <div className="text-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ayumi-primary mx-auto mb-4"></div>
                <p className="text-gray-500 font-medium">Memuat modul terapis...</p>
            </div>
        }>
            <TherapistAppointmentsContent />
        </Suspense>
    )
}
