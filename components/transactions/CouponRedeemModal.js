'use client'

import Link from 'next/link'

/**
 * Modal "Rincian Penukaran Sesi Kupon (Redeem)" di halaman Transaksi.
 * Hanya tampilan; state dan data tetap dikelola app/transactions/page.js.
 */
export default function CouponRedeemModal({
    customStartDate,
    customEndDate,
    filterBranch,
    branches,
    couponRedeemedData,
    couponRedeemedTotals,
    gdCouponRedeemed,
    couponRedeemSearch,
    setCouponRedeemSearch,
    setIsCouponRedeemModalOpen,
    formatCurrency
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                {/* Modal Header */}
                <div className="p-5 sm:p-6 border-b border-stone-100 flex items-center justify-between bg-gradient-to-r from-amber-50/50 via-white to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg shadow-sm">
                            🎟️
                        </div>
                        <div>
                            <h3 className="text-base font-extrabold text-stone-900">Rincian Penukaran Sesi Kupon (Redeem)</h3>
                            <p className="text-xs text-stone-500 font-medium mt-0.5">
                                Periode {customStartDate} s/d {customEndDate} • {filterBranch ? (branches.find(b => b.id === filterBranch)?.name || 'Cabang Terpilih') : 'Semua Cabang'}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsCouponRedeemModalOpen(false)} 
                        className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-stone-800 flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {/* Summary Bar & Search */}
                <div className="p-4 bg-stone-50/80 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs font-extrabold text-stone-700 bg-white border border-stone-200 px-3 py-1 rounded-xl shadow-xs">
                            Total Sesi: <strong className="text-amber-700">{couponRedeemedTotals.sessions}</strong> Sesi
                        </span>
                        <span className="text-xs font-extrabold text-amber-900 bg-amber-100/90 border border-amber-200 px-3 py-1 rounded-xl shadow-xs">
                            Total Valuasi: <strong className="text-amber-800">{formatCurrency(couponRedeemedTotals.value)}</strong>
                        </span>
                    </div>
                    <div className="relative">
                        <input
                            type="text"
                            value={couponRedeemSearch}
                            onChange={(e) => setCouponRedeemSearch(e.target.value)}
                            placeholder="Cari pasien / layanan..."
                            className="pl-8 pr-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 w-56 shadow-xs"
                        />
                        <svg className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                </div>

                {/* Table Content */}
                <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                    {gdCouponRedeemed.sessions > 0 && !couponRedeemSearch && (
                        <p className="mb-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-medium">
                            Termasuk <strong>{gdCouponRedeemed.sessions} sesi ({formatCurrency(gdCouponRedeemed.value)})</strong> dari nota migrasi GD Cashier. Nota GD tidak punya rincian per pasien di sini; lihat daftar transaksi.
                        </p>
                    )}
                    {(() => {
                        const filteredLogs = (couponRedeemedData.logs || []).filter(log => {
                            if (!couponRedeemSearch) return true
                            const q = couponRedeemSearch.toLowerCase()
                            const pName = (log.patients?.full_name || '').toLowerCase()
                            const tName = (log.patient_coupon_items?.treatments?.name || '').toLowerCase()
                            const pkgName = (log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || '').toLowerCase()
                            return pName.includes(q) || tName.includes(q) || pkgName.includes(q)
                        })

                        if (filteredLogs.length === 0) {
                            return (
                                <div className="text-center py-12">
                                    <p className="text-sm font-semibold text-stone-400">Tidak ada penukaran sesi kupon pada periode/filter ini.</p>
                                </div>
                            )
                        }

                        return (
                            <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="bg-stone-50 text-stone-600 font-bold border-b border-stone-200 uppercase text-[10px] tracking-wider">
                                            <th className="p-3">Waktu</th>
                                            <th className="p-3">Pasien</th>
                                            <th className="p-3">Paket & Layanan</th>
                                            <th className="p-3">Cabang</th>
                                            <th className="p-3 text-center">Status Sesi</th>
                                            <th className="p-3 text-right">Nilai Sesi</th>
                                            <th className="p-3">Petugas</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {filteredLogs.map((log, idx) => {
                                            const item = log.patient_coupon_items
                                            const tP = Number(item?.treatments?.price || 0)
                                            const pP = Number(item?.patient_coupons?.coupon_packages?.price || 0)
                                            const tS = Number(item?.total_sessions || 1)
                                            const val = tP > 0 ? tP : (pP > 0 ? Math.round(pP / tS) : 0)

                                            return (
                                                <tr key={log.id || idx} className="hover:bg-amber-50/30 transition-colors">
                                                    <td className="p-3 text-stone-500 whitespace-nowrap">
                                                        {log.used_at ? new Date(log.used_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                    </td>
                                                    <td className="p-3 whitespace-nowrap">
                                                        {log.patients?.id ? (
                                                            <Link 
                                                                href={`/patients/${log.patients.id}`}
                                                                className="font-bold text-stone-900 hover:text-ayumi-primary hover:underline inline-flex items-center gap-1 group/pat"
                                                                title="Lihat Profil Pasien"
                                                            >
                                                                <span>{log.patients?.full_name || 'Pasien'}</span>
                                                                <span className="text-[10px] text-ayumi-primary font-bold group-hover/pat:translate-x-0.5 group-hover/pat:-translate-y-0.5 transition-transform">↗</span>
                                                            </Link>
                                                        ) : (
                                                            <span className="font-bold text-stone-900">{log.patients?.full_name || 'Pasien'}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        <p className="font-bold text-stone-900">{log.patient_coupon_items?.treatments?.name || 'Treatment'}</p>
                                                        <p className="text-[10px] text-stone-400">{log.patient_coupon_items?.patient_coupons?.coupon_packages?.name || 'Paket'}</p>
                                                    </td>
                                                    <td className="p-3 text-stone-600 whitespace-nowrap">
                                                        {log.branches?.name || '-'}
                                                    </td>
                                                    <td className="p-3 text-center whitespace-nowrap">
                                                        <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                                                            Sesi {log.patient_coupon_items?.used_sessions || 1}/{log.patient_coupon_items?.total_sessions || 1}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right font-extrabold text-amber-900 whitespace-nowrap tabular-nums">
                                                        {formatCurrency(val)}
                                                    </td>
                                                    <td className="p-3 text-stone-600 whitespace-nowrap">
                                                        {log.users?.full_name || '-'}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    })()}
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-stone-50 border-t border-stone-100 flex justify-end">
                    <button 
                        onClick={() => setIsCouponRedeemModalOpen(false)} 
                        className="px-5 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    >
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    )
}
