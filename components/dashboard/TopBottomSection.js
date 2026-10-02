'use client'


/**
 * Section 3 Dashboard owner: Top & Bottom Treatment serta Top Produk.
 * Hanya tampilan; data dan state buka-tutup dikelola app/dashboard/page.js.
 */
export default function TopBottomSection({
    bottomTreatments,
    collapsedSections,
    toggleSection,
    topProducts,
    topTreatments
}) {
    return (
        <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.topBottom ? '' : 'pb-4 border-b border-gray-200'}`}>
                <div>
                    <div 
                        onClick={() => toggleSection('topBottom')}
                        className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                        title={collapsedSections.topBottom ? "Buka modul" : "Lipat modul"}
                    >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#B5588A] group-hover:bg-[#9c4372] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.topBottom ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-ayumi-primary transition-colors">
                            Peringkat Layanan & Produk Terlaris vs Evaluasi Terendah
                        </h3>
                    </div>
                    <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                        Peringkat 5 teratas treatment dan produk skincare paling laris, serta treatment dengan peminat terendah untuk evaluasi promo.
                    </p>
                </div>
            </div>

            {!collapsedSections.topBottom ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 pt-1">
                    {/* 1. Top 5 Treatment Terfavorit */}
                    <div className="p-5 sm:p-6 bg-stone-50/60 border border-pink-100/90 rounded-2xl sm:rounded-3xl space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-pink-100">
                            <div className="w-9 h-9 rounded-2xl bg-pink-100/80 text-[#B5588A] flex items-center justify-center shrink-0 shadow-inner">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                            </div>
                            <div>
                                <h3 className="text-base font-extrabold text-gray-900">Top Perawatan (Treatment)</h3>
                                <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Layanan paling banyak diminati periode ini.</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {topTreatments.length === 0 ? (
                                <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi treatment pada periode ini.</p>
                            ) : (
                                topTreatments.map((t, idx) => (
                                    <div key={t.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-pink-100 hover:border-pink-200 transition-colors shadow-2xs">
                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                            <span className="w-6 h-6 rounded-xl bg-pink-100 text-[#B5588A] font-black text-xs flex items-center justify-center shrink-0">
                                                #{idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="font-extrabold text-xs text-gray-900 truncate">{t.name}</p>
                                                <p className="text-[10px] font-semibold text-gray-500 mt-0.5">{t.count} Sesi Terjual</p>
                                            </div>
                                        </div>
                                        <span className="font-extrabold text-xs text-[#B5588A] tracking-tight shrink-0">
                                            Rp {t.revenue.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 2. Top 5 Produk Terlaris */}
                    <div className="p-5 sm:p-6 bg-stone-50/60 border border-cyan-100/90 rounded-2xl sm:rounded-3xl space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-cyan-100">
                            <div className="w-9 h-9 rounded-2xl bg-cyan-100/80 text-[#06B6D4] flex items-center justify-center shrink-0 shadow-inner">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                            </div>
                            <div>
                                <h3 className="text-base font-extrabold text-gray-900">Top Penjualan Produk</h3>
                                <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Produk skincare paling laris periode ini.</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {topProducts.length === 0 ? (
                                <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada penjualan produk pada periode ini.</p>
                            ) : (
                                topProducts.map((p, idx) => (
                                    <div key={p.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-cyan-100 hover:border-cyan-200 transition-colors shadow-2xs">
                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                            <span className="w-6 h-6 rounded-xl bg-cyan-100 text-[#06B6D4] font-black text-xs flex items-center justify-center shrink-0">
                                                #{idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="font-extrabold text-xs text-gray-900 truncate">{p.name}</p>
                                                <p className="text-[10px] font-semibold text-gray-500 mt-0.5">{p.count} Unit Terjual</p>
                                            </div>
                                        </div>
                                        <span className="font-extrabold text-xs text-[#06B6D4] tracking-tight shrink-0">
                                            Rp {p.revenue.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 3. Perawatan (Treatment) Terendah - Evaluasi Promo (Khusus Owner) */}
                    <div className="p-5 sm:p-6 bg-stone-50/60 border border-amber-150 rounded-2xl sm:rounded-3xl space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-amber-200/80">
                            <div className="w-9 h-9 rounded-2xl bg-amber-100/80 text-amber-700 flex items-center justify-center shrink-0 shadow-inner">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <h3 className="text-base font-extrabold text-gray-900">Treatment Terendah</h3>
                                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                        Evaluasi
                                    </span>
                                </div>
                                <p className="text-[11px] text-gray-500 font-semibold mt-0.5">Layanan paling sedikit diminati (perlu promo).</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {bottomTreatments.length === 0 ? (
                                <p className="text-xs text-gray-400 font-medium py-6 text-center">Data treatment tidak mencukupi untuk evaluasi.</p>
                            ) : (
                                bottomTreatments.map((t, idx) => (
                                    <div key={t.name} className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-white border border-amber-200/70 hover:border-amber-300 transition-colors shadow-2xs">
                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                            <span className="w-6 h-6 rounded-xl bg-amber-100 text-amber-800 font-black text-xs flex items-center justify-center shrink-0">
                                                #{idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="font-extrabold text-xs text-gray-900 truncate">{t.name}</p>
                                                <p className="text-[10px] font-semibold text-amber-800/80 mt-0.5">{t.count} Sesi Terjual</p>
                                            </div>
                                        </div>
                                        <span className="font-extrabold text-xs text-amber-900 tracking-tight shrink-0">
                                            Rp {t.revenue.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
