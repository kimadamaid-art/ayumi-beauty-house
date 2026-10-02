'use client'

import Link from 'next/link'

/**
 * Modal "Rincian Pemakaian Sesi Kupon" di Dashboard.
 * Hanya tampilan; kondisi buka-tutup, filter, dan data dikelola app/dashboard/page.js.
 */
export default function CouponUsageModal({
    branchDailyComparison,
    couponUsageModalBranch,
    couponUsageSearch,
    endDate,
    filteredCouponLogs,
    formatLogDateTime,
    setCouponUsageSearch,
    setIsCouponUsageModalOpen,
    startDate
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden">
                <div className="p-5 border-b border-stone-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-base font-extrabold text-stone-900">Rincian Pemakaian Sesi Kupon</h3>
                        <p className="text-xs text-stone-500 font-medium">Periode {startDate} s/d {endDate} ({couponUsageModalBranch.name})</p>
                    </div>
                    <button onClick={() => setIsCouponUsageModalOpen(false)} className="text-stone-400 hover:text-stone-700 text-sm font-bold">✕</button>
                </div>
                <div className="p-3.5 bg-stone-50 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <span className="text-xs font-bold text-stone-700">Total: {filteredCouponLogs.length} Sesi</span>
                        <span className="text-xs font-bold text-amber-800 bg-amber-100/80 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                            Valuasi Redeem: Rp {filteredCouponLogs.reduce((acc, log) => {
                                const item = log.patient_coupon_items
                                const tP = Number(item?.treatments?.price || 0)
                                const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                                const tS = Number(item?.total_sessions || 1)
                                return acc + (tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0))
                            }, 0).toLocaleString('id-ID')}
                        </span>
                    </div>
                    <input
                        type="text"
                        value={couponUsageSearch}
                        onChange={(e) => setCouponUsageSearch(e.target.value)}
                        placeholder="Cari nama pasien / layanan..."
                        className="px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#5c3316]"
                    />
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                    {(() => {
                        // Sesi dari nota migrasi GD Cashier tidak punya log per pasien, jadi hanya
                        // ringkasannya yang ditampilkan di sini.
                        const gdRows = (branchDailyComparison || []).filter(b => !couponUsageModalBranch.id || b.branchId === couponUsageModalBranch.id)
                        const gdSessions = gdRows.reduce((acc, b) => acc + (b.gdCouponUsedSessions || 0), 0)
                        const gdValue = gdRows.reduce((acc, b) => acc + (b.gdCouponUsedValue || 0), 0)
                        if (gdSessions === 0 || couponUsageSearch.trim()) return null
                        return (
                            <p className="mb-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-medium">
                                Ditambah <strong>{gdSessions} sesi (Rp {gdValue.toLocaleString('id-ID')})</strong> dari nota migrasi GD Cashier. Rincian per pasien untuk nota GD dapat dilihat di Riwayat Transaksi.
                            </p>
                        )
                    })()}
                    {filteredCouponLogs.length === 0 ? (
                        <p className="text-xs text-stone-400 py-10 text-center">Tidak ditemukan riwayat pemakaian sesi kupon.</p>
                    ) : (
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-stone-50 text-stone-700 font-bold border-b border-stone-200 uppercase text-[11px]">
                                    <th className="p-2.5">Waktu</th>
                                    <th className="p-2.5">Pasien</th>
                                    <th className="p-2.5">Paket & Layanan</th>
                                    <th className="p-2.5 text-center">Status Sesi</th>
                                    <th className="p-2.5 text-right">Nilai Sesi</th>
                                    <th className="p-2.5">Petugas</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filteredCouponLogs.map((log, idx) => {
                                    const item = log.patient_coupon_items
                                    const tP = Number(item?.treatments?.price || 0)
                                    const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                                    const tS = Number(item?.total_sessions || 1)
                                    const val = tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0)

                                    return (
                                        <tr key={log.id || idx} className="hover:bg-stone-50/50">
                                            <td className="p-2.5 text-stone-500 whitespace-nowrap">{formatLogDateTime(log.used_at)}</td>
                                            <td className="p-2.5 whitespace-nowrap">
                                                {log.patients?.id ? (
                                                    <Link 
                                                        href={`/patients/${log.patients.id}`}
                                                        className="font-bold text-stone-900 hover:text-ayumi-primary hover:underline transition-colors inline-flex items-center gap-1 group/cp"
                                                        title="Buka Profil & Riwayat Pasien"
                                                    >
                                                        <span>{log.patients?.full_name || 'Pasien'}</span>
                                                        <span className="text-[11px] text-ayumi-primary font-bold group-hover/cp:translate-x-0.5 group-hover/cp:-translate-y-0.5 transition-transform">↗</span>
                                                    </Link>
                                                ) : (
                                                    <span className="font-bold text-stone-900">{log.patients?.full_name || 'Pasien'}</span>
                                                )}
                                            </td>
                                            <td className="p-2.5">
                                                <p className="font-bold text-stone-900">{log.patient_coupon_items?.treatments?.name || 'Treatment'}</p>
                                                <p className="text-[10px] text-stone-400">{log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || 'Paket'}</p>
                                            </td>
                                            <td className="p-2.5 text-center">
                                                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                                                    Sesi {log.patient_coupon_items?.used_sessions || 1}/{log.patient_coupon_items?.total_sessions || 1}
                                                </span>
                                            </td>
                                            <td className="p-2.5 text-right font-bold text-amber-900 whitespace-nowrap tabular-nums">
                                                Rp {val.toLocaleString('id-ID')}
                                            </td>
                                            <td className="p-2.5 text-stone-600">{log.users?.full_name || '-'}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="p-3.5 border-t border-stone-100 flex justify-end">
                    <button onClick={() => setIsCouponUsageModalOpen(false)} className="px-4 py-2 bg-stone-100 text-stone-700 rounded-xl text-xs font-bold">Tutup</button>
                </div>
            </div>
        </div>
    )
}
