'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import DateRangePicker from '@/components/DateRangePicker'
import TherapistPatientHistoryModal from '@/components/ui/TherapistPatientHistoryModal'
import { getCommissionBasePrice, calculateTherapistCommission, buildCouponPriceMap, isInfusionTreatment } from '@/lib/commissionUtils'

function TherapistHistoryContent() {
    const router = useRouter()

    const [dbUser, setDbUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [selectedPatientIdForHistory, setSelectedPatientIdForHistory] = useState(null)
    const [records, setRecords] = useState([])

    // Helper Date
    const getLocalDateString = (date = new Date()) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const todayStr = getLocalDateString()

    // Filter States
    const [recPreset, setRecPreset] = useState('month') // 'today' | 'week' | 'month' | 'custom'
    const [recStartDate, setRecStartDate] = useState(todayStr)
    const [recEndDate, setRecEndDate] = useState(todayStr)

    useEffect(() => {
        const now = new Date()
        const first = new Date(now.getFullYear(), now.getMonth(), 1)
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        setRecStartDate(getLocalDateString(first))
        setRecEndDate(getLocalDateString(last))

        fetchUserAndData(getLocalDateString(first), getLocalDateString(last))
    }, [])

    const fetchUserAndData = async (start = recStartDate, end = recEndDate) => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/login')
            return
        }

        const { data: userData } = await supabase
            .from('users')
            .select('*, branches(name)')
            .eq('id', user.id)
            .maybeSingle()

        if (!userData || userData.role !== 'therapist') {
            router.push('/dashboard')
            return
        }

        setDbUser(userData)
        fetchRecords(userData.id, start, end)
    }

    const fetchRecords = async (userId = dbUser?.id, start = recStartDate, end = recEndDate) => {
        if (!userId) return
        setLoading(true)

        let query = supabase
            .from('treatment_records')
            .select(`
                *,
                patients (id, full_name),
                branches (name),
                treatment_record_items (
                    id, price_at_time, original_price, discount_percent, commission_percent, notes,
                    treatments (name)
                )
            `)
            .eq('performed_by', userId)
            .order('treatment_date', { ascending: false })

        if (start && end) {
            query = query.gte('treatment_date', start).lte('treatment_date', end)
        }

        const { data, error } = await query
        if (data) {
            const allPatientIds = Array.from(new Set(data.map(r => r.patient_id).filter(Boolean)))

            if (allPatientIds.length > 0) {
                try {
                    const res = await fetch('/api/therapist/patient-lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: allPatientIds })
                    })
                    if (res.ok) {
                        const { patientsMap } = await res.json()
                        if (patientsMap) {
                            data.forEach(r => {
                                if (r.patient_id && patientsMap[r.patient_id]) {
                                    r.patients = patientsMap[r.patient_id]
                                }
                            })
                        }
                    }
                } catch (e) {
                    console.error('Lookup error in therapist history:', e)
                }
            }

            // Ambil kupon usage logs untuk mencocokkan harga riil sesi kupon
            const { data: cLogs } = await supabase
                .from('coupon_usage_logs')
                .select(`
                    id,
                    treatment_record_id,
                    patient_coupon_items(
                        total_sessions,
                        patient_coupons(
                            package_id,
                            transaction_id,
                            coupon_packages(price),
                            transactions(
                                id,
                                total,
                                subtotal,
                                discount,
                                transaction_items(id, item_type, price, subtotal, discount_percent)
                            )
                        )
                    )
                `)

            const couponMap = buildCouponPriceMap(cLogs || [])
            data.forEach(r => {
                if (r.treatment_record_items) {
                    r.treatment_record_items.forEach(it => {
                        it.proportional_coupon_price = r.id ? couponMap[r.id] : null
                    })
                }
            })

            setRecords([...data])
        }
        setLoading(false)
    }

    const handleRecPresetChange = (preset) => {
        setRecPreset(preset)
        const now = new Date()
        let start = todayStr
        let end = todayStr

        if (preset === 'today') {
            start = todayStr
            end = todayStr
        } else if (preset === 'week') {
            const d = new Date()
            const dayOfWeek = d.getDay()
            const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
            const monday = new Date(d.setDate(diffToMon))
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            start = getLocalDateString(monday)
            end = getLocalDateString(sunday)
        } else if (preset === 'month') {
            const first = new Date(now.getFullYear(), now.getMonth(), 1)
            const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
            start = getLocalDateString(first)
            end = getLocalDateString(last)
        }

        setRecStartDate(start)
        setRecEndDate(end)

        if (preset !== 'custom' && dbUser?.id) {
            fetchRecords(dbUser.id, start, end)
        }
    }

    const historySummary = useMemo(() => {
        let totalCommission = 0
        let totalTreatmentItems = 0

        records.forEach(r => {
            (r.treatment_record_items || []).forEach(item => {
                totalCommission += calculateTherapistCommission(item)
                totalTreatmentItems++
            })
        })

        return {
            totalCommission,
            totalTreatmentItems,
            recordCount: records.length
        }
    }, [records])

    return (
        <div className="space-y-6 w-full pb-10">
            {/* Header Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-3.5">
                    <Link href="/therapist/dashboard">
                        <button className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center transition-colors cursor-pointer" title="Kembali ke Dashboard">
                            ←
                        </button>
                    </Link>
                    <div>
                        <h1 className="text-base font-bold text-slate-900">
                            Riwayat Treatment Pasien
                        </h1>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Daftar rekam medis perawatan & komisi yang telah Anda kerjakan di seluruh cabang.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {dbUser?.branches?.name && (
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span>Cabang: <b className="text-slate-900 font-bold">{dbUser.branches.name}</b></span>
                        </div>
                    )}
                    <Link href="/therapist/dashboard">
                        <button className="text-xs font-bold text-white bg-ayumi-primary hover:bg-[#9a4b75] px-3.5 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer">
                            Dashboard & Jadwal
                        </button>
                    </Link>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-r from-[#ba5d45] via-[#a84c35] to-[#8f3a25] rounded-xl p-5 text-white shadow-sm flex flex-col justify-between">
                    <div className="text-[11px] font-bold text-orange-200 uppercase tracking-wider">
                        Total Komisi Periode Ini
                    </div>
                    <div className="text-2xl lg:text-3xl font-black mt-2 tracking-tight text-white">
                        Rp {historySummary.totalCommission.toLocaleString('id-ID')}
                    </div>
                    <div className="text-[11px] text-orange-100/90 font-medium mt-3">
                        Akumulasi seluruh tindakan
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Jumlah Treatment Selesai
                    </div>
                    <div className="text-2xl lg:text-3xl font-black text-slate-900 mt-2">
                        {historySummary.totalTreatmentItems} <span className="text-xs font-semibold text-slate-400">Tindakan</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        Total tindakan perawatan medis
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Kunjungan Pasien
                    </div>
                    <div className="text-2xl lg:text-3xl font-black text-slate-900 mt-2">
                        {historySummary.recordCount} <span className="text-xs font-semibold text-slate-400">Sesi</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-3">
                        Total sesi kunjungan yang ditangani
                    </div>
                </div>
            </div>

            {/* Filter Row & Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 md:p-6 space-y-4">
                <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
                            <button
                                onClick={() => handleRecPresetChange('today')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    recPreset === 'today' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Hari Ini
                            </button>
                            <button
                                onClick={() => handleRecPresetChange('week')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    recPreset === 'week' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Minggu Ini
                            </button>
                            <button
                                onClick={() => handleRecPresetChange('month')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    recPreset === 'month' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Bulan Ini
                            </button>
                            <button
                                onClick={() => setRecPreset('custom')}
                                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                                    recPreset === 'custom' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Custom
                            </button>
                        </div>

                        {recPreset === 'custom' && (
                            <DateRangePicker
                                startDate={recStartDate}
                                endDate={recEndDate}
                                onChange={(range) => {
                                    setRecStartDate(range.startDate)
                                    setRecEndDate(range.endDate)
                                    if (dbUser?.id) {
                                        fetchRecords(dbUser.id, range.startDate, range.endDate)
                                    }
                                }}
                                inputClassName="text-xs font-semibold py-1 px-3"
                            />
                        )}
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mx-auto mb-3"></div>
                        <p className="text-slate-500 font-medium text-xs">Memuat riwayat treatment...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                    <th className="py-3 px-4">Tanggal & Waktu</th>
                                    <th className="py-3 px-4">Pasien</th>
                                    <th className="py-3 px-4">Cabang</th>
                                    <th className="py-3 px-4">Tindakan & Tarif Transaksi</th>
                                    <th className="py-3 px-4 text-right">Rincian Komisi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="py-12 text-center text-slate-400">
                                            Tidak ada riwayat treatment untuk periode ini.
                                        </td>
                                    </tr>
                                ) : (
                                    records.map(r => {
                                        let totalRecordCommission = 0
                                        const itemsList = r.treatment_record_items || []

                                        itemsList.forEach(item => {
                                            totalRecordCommission += calculateTherapistCommission(item)
                                        })

                                        const patientObj = Array.isArray(r.patients) ? r.patients[0] : (r.patients || r.appointments?.patients)
                                        const patientName = patientObj?.full_name || '-'
                                        const patientId = r.patient_id || patientObj?.id

                                        return (
                                            <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                                                <td className="py-3 px-4">
                                                    <div className="font-bold text-slate-900">
                                                        {new Date(r.treatment_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 mt-0.5">{r.treatment_time || '-'}</div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex flex-col items-start gap-1">
                                                        <span className="font-bold text-slate-900 text-sm">{patientName}</span>
                                                        {patientId && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedPatientIdForHistory(patientId)}
                                                                className="text-[10px] font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                                                            >
                                                                Rekam Medis
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                                                    {r.branches?.name || '-'}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex flex-col gap-1.5">
                                                        {itemsList.length > 0 ? (
                                                            itemsList.map(item => {
                                                                const treatmentName = item.treatments?.name || item.notes || 'Treatment'
                                                                const basePrice = getCommissionBasePrice(item)
                                                                const isWorker = item.notes?.includes('[WORKER]') || isInfusionTreatment(treatmentName, item.notes)
                                                                const isCoupon = Number(item.price_at_time || 0) === 0 && basePrice > 0

                                                                return (
                                                                    <div key={item.id} className="flex items-center gap-2 flex-wrap">
                                                                        <span className="px-2.5 py-1 bg-slate-100 text-slate-800 text-[11px] font-bold rounded-lg border border-slate-200 shadow-2xs">
                                                                            {treatmentName}
                                                                        </span>
                                                                        <span className="text-[11px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                                                            Rp {basePrice.toLocaleString('id-ID')}
                                                                        </span>
                                                                        {isCoupon && (
                                                                            <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded">
                                                                                Kupon
                                                                            </span>
                                                                        )}
                                                                        {isWorker && (
                                                                            <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">
                                                                                Worker (Infus)
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })
                                                        ) : (
                                                            <span className="text-xs text-slate-400">-</span>
                                                        )}
                                                    </div>
                                                    {(r.result_notes || r.recommendation || r.complaints) && (
                                                        <p className="text-[11px] text-slate-500 font-medium max-w-sm truncate mt-1">
                                                            {r.result_notes || r.recommendation || r.complaints}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Komisi:</span>
                                                            <span className="text-sm font-black text-[#ba5d45]">
                                                                +Rp {totalRecordCommission.toLocaleString('id-ID')}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1">
                                                            {itemsList.map(item => {
                                                                const commPercent = Number(item.commission_percent || 0)
                                                                const itemComm = calculateTherapistCommission(item)
                                                                const basePrice = getCommissionBasePrice(item)
                                                                const treatmentName = item.treatments?.name || item.notes || 'Treatment'
                                                                const isWorker = item.notes?.includes('[WORKER]') || isInfusionTreatment(treatmentName, item.notes)

                                                                if (isWorker) {
                                                                    return (
                                                                        <div
                                                                            key={item.id}
                                                                            className="inline-flex items-center gap-1.5 text-[10.5px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md border border-slate-200"
                                                                        >
                                                                            <span className="font-semibold text-slate-600">{treatmentName}</span>
                                                                            <span className="text-slate-400 italic">• Worker (Infus)</span>
                                                                        </div>
                                                                    )
                                                                }
                                                                if (itemComm === 0) {
                                                                    return (
                                                                        <div
                                                                            key={item.id}
                                                                            className="inline-flex items-center gap-1.5 text-[10.5px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md border border-slate-200"
                                                                        >
                                                                            <span className="font-semibold text-slate-600">{treatmentName}</span>
                                                                            <span className="text-slate-400 italic">• 0%</span>
                                                                        </div>
                                                                    )
                                                                }

                                                                return (
                                                                    <div
                                                                        key={item.id}
                                                                        className="inline-flex items-center gap-1.5 text-[11px] bg-amber-50 text-slate-800 px-2.5 py-1 rounded-lg border border-amber-200 font-medium shadow-2xs"
                                                                    >
                                                                        <span className="font-bold text-slate-800">{treatmentName}</span>
                                                                        <span className="text-amber-800 font-semibold">
                                                                            (Rp {basePrice.toLocaleString('id-ID')} × {commPercent}%)
                                                                        </span>
                                                                        <span className="font-black text-[#ba5d45]">
                                                                            = Rp {itemComm.toLocaleString('id-ID')}
                                                                        </span>
                                                                    </div>
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

            {/* Patient History Modal */}
            <TherapistPatientHistoryModal
                patientId={selectedPatientIdForHistory}
                isOpen={!!selectedPatientIdForHistory}
                onClose={() => setSelectedPatientIdForHistory(null)}
            />
        </div>
    )
}

export default function TherapistAppointments() {
    return (
        <Suspense fallback={
            <div className="text-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mx-auto mb-3"></div>
                <p className="text-slate-500 font-medium text-xs">Memuat riwayat...</p>
            </div>
        }>
            <TherapistHistoryContent />
        </Suspense>
    )
}
