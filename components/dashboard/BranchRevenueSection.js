'use client'

import DateRangePicker from '@/components/DateRangePicker'
import LazyRecharts from '@/components/charts/LazyRecharts'

/**
 * Section 1 Dashboard owner: Perbandingan Omset (Treatment & Produk) per Cabang.
 * Hanya tampilan; periode, data, dan state buka-tutup dikelola app/dashboard/page.js.
 */
export default function BranchRevenueSection({
    branchDailyComparison,
    collapsedSections,
    endDate,
    isMounted,
    openCouponUsageModal,
    setEndDate,
    setStartDate,
    startDate,
    toggleSection
}) {
    return (
        <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.branchComparison ? '' : 'pb-4 border-b border-gray-200'}`}>
                <div>
                    <div 
                        onClick={() => toggleSection('branchComparison')}
                        className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                        title={collapsedSections.branchComparison ? "Buka modul" : "Lipat modul"}
                    >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#B5588A] group-hover:bg-[#9c4372] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.branchComparison ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-ayumi-primary transition-colors">
                            Perbandingan Omset (Treatment & Produk) per Cabang
                        </h3>
                    </div>
                    <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                        Visualisasi perbandingan omset treatment dan produk antar cabang untuk rentang periode terpilih.
                    </p>
                </div>

                {/* Toolbar Kontrol: Rentang Waktu (DateRangePicker) */}
                <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                    <div className="flex flex-col gap-1 w-full sm:w-auto">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Rentang Waktu</span>
                        <DateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onChange={({ startDate: s, endDate: e }) => {
                                setStartDate(s)
                                setEndDate(e)
                            }}
                            align="right"
                            inputClassName="w-full sm:w-auto bg-pink-50 hover:bg-pink-100/70 text-ayumi-secondary border border-pink-200 font-extrabold text-xs px-3.5 py-2 rounded-2xl shadow-sm transition-colors cursor-pointer justify-between"
                        />
                    </div>
                </div>
            </div>

            {!collapsedSections.branchComparison ? (
                <>
                    {/* Cards Breakdown Omset per Cabang */}
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4 pt-1">
                        {branchDailyComparison.map(b => {
                            const rows = [
                                { key: 'treatment', label: 'Treatment', dot: 'bg-[#EC4899]', gross: b.treatmentGross || 0, redeem: b.treatmentRedeem || 0, net: b.treatmentIncome || 0 },
                                { key: 'product', label: 'Produk', dot: 'bg-[#06B6D4]', gross: b.productGross || 0, redeem: b.productRedeem || 0, net: b.productIncome || 0 },
                                { key: 'coupon', label: 'Penjualan Kupon', shortLabel: 'Kupon', dot: 'bg-emerald-500', gross: b.couponSalesGross || 0, redeem: b.couponSalesRedeem || 0, net: b.couponSalesIncome || 0 },
                                { key: 'other', label: 'Lainnya', dot: 'bg-gray-400', gross: b.otherGross || 0, redeem: b.otherRedeem || 0, net: b.otherIncome || 0, optional: true }
                            ].filter(row => !row.optional || row.gross !== 0 || row.net !== 0)
                            const grossTotal = rows.reduce((acc, row) => acc + row.gross, 0)
                            const redeemTotal = rows.reduce((acc, row) => acc + row.redeem, 0)
                            const netTotal = rows.reduce((acc, row) => acc + row.net, 0)
                            const rp = (n) => Math.round(n).toLocaleString('id-ID')
                            // Tanda minus tipografis agar sejajar dengan angka; nilai 0 ditampilkan redup.
                            const discCell = (n) => Math.round(n) > 0
                                ? <span className="text-rose-600">−{rp(n)}</span>
                                : <span className="text-gray-300">—</span>
                            const redeemCell = (n) => Math.round(n) > 0
                                ? <span className="text-amber-600">−{rp(n)}</span>
                                : <span className="text-gray-300">—</span>
                            const hasActivity = (b.transactionCount || 0) > 0 || (b.couponUsedSessions || 0) > 0
                            return (
                            <div key={b.branchId} className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 hover:border-pink-300 shadow-sm hover:shadow-md transition-all flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-gray-100">
                                    <h4 className="font-extrabold text-base text-gray-900 truncate">{b.branchName}</h4>
                                    <span className="text-[11px] font-bold text-stone-600 bg-stone-100 rounded-full px-2.5 py-0.5 whitespace-nowrap">{b.transactionCount || 0} transaksi</span>
                                </div>

                                {hasActivity ? (
                                    <>
                                        {/* Ukuran huruf & label mengikuti lebar kartu (container query), bukan lebar layar. */}
                                        <div className="@container">
                                        <table className="w-full table-fixed text-[10px] @md:text-[11.5px] @xl:text-[12.5px] tabular-nums">
                                            <colgroup>
                                                <col className="w-[25%] @md:w-[22%] @xl:w-[26%]" />
                                                <col className="w-[19%] @md:w-[20%] @xl:w-[18%]" />
                                                <col className="w-[19%] @xl:w-[18%]" />
                                                <col className="w-[18%] @xl:w-[20%]" />
                                                <col className="w-[19%] @md:w-[21%] @xl:w-[18%]" />
                                            </colgroup>
                                            <thead>
                                                <tr className="text-[9.5px] @xl:text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gray-400">
                                                    <th className="text-left font-semibold pb-2">Kategori</th>
                                                    <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Kotor</th>
                                                    <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Diskon</th>
                                                    <th className="text-right font-semibold pb-2 pl-1 @md:pl-2 whitespace-nowrap" title="Redeem Kupon: nilai sesi kupon yang dipakai; sudah dibayar saat paket dijual">
                                                        <span className="inline-flex items-center gap-1 text-amber-600/80">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                                                            <span className="@xl:hidden">Redeem</span>
                                                            <span className="hidden @xl:inline">Redeem Kupon</span>
                                                        </span>
                                                    </th>
                                                    <th className="text-right font-semibold pb-2 pl-1 @md:pl-2">Bersih</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map(row => (
                                                    <tr key={row.key} className="border-t border-gray-100">
                                                        <td className="py-2.5 pr-2 font-semibold text-gray-800">
                                                            <span className="flex items-center gap-1.5 min-w-0">
                                                                <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`}></span>
                                                                {row.shortLabel ? (
                                                                    <span className="truncate"><span className="@xl:hidden">{row.shortLabel}</span><span className="hidden @xl:inline">{row.label}</span></span>
                                                                ) : (
                                                                    <span className="truncate">{row.label}</span>
                                                                )}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium text-gray-600 whitespace-nowrap">{rp(row.gross)}</td>
                                                        <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium whitespace-nowrap">{discCell(row.gross - row.net - row.redeem)}</td>
                                                        <td className="py-2.5 pl-1 @md:pl-2 text-right font-medium whitespace-nowrap">{redeemCell(row.redeem)}</td>
                                                        <td className="py-2.5 pl-1 @md:pl-2 text-right font-bold text-gray-900 whitespace-nowrap">{rp(row.net)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="border-t border-gray-300">
                                                    <td className="pt-3 font-bold text-gray-900">Total</td>
                                                    <td className="pt-3 pl-1 @md:pl-2 text-right font-bold text-gray-800 whitespace-nowrap">{rp(grossTotal)}</td>
                                                    <td className="pt-3 pl-1 @md:pl-2 text-right font-bold whitespace-nowrap">{discCell(grossTotal - netTotal - redeemTotal)}</td>
                                                    <td className="pt-3 pl-1 @md:pl-2 text-right font-bold whitespace-nowrap">{redeemCell(redeemTotal)}</td>
                                                    <td className="pt-3 pl-1 @md:pl-2 text-right font-extrabold text-[#5c3316] whitespace-nowrap">{rp(netTotal)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                                            <span
                                                className="text-[10px] text-gray-400 font-medium"
                                                title="Treatment termasuk infus. Diskon termasuk bonus gratis. Redeem kupon = sesi kupon yang dipakai; uangnya diterima saat paket dijual."
                                            >
                                                Kotor − Diskon − Redeem Kupon = Bersih
                                            </span>
                                            {(b.couponUsedSessions || 0) > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => openCouponUsageModal(b.branchId, b.branchName)}
                                                    className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-full px-2.5 py-0.5 transition-colors cursor-pointer"
                                                    title="Rincian sesi kupon yang dipakai pada periode ini"
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                    {b.couponUsedSessions} sesi kupon dipakai · Rincian ↗
                                                </button>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-400 font-medium py-6 text-center">Belum ada transaksi pada periode ini.</p>
                                )}

                                <div className="mt-auto pt-3 border-t border-gray-100 flex justify-between items-center gap-3">
                                    <div>
                                        <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Total Omset Cabang</p>
                                        <p className="text-lg font-black text-[#5c3316] tracking-tight tabular-nums leading-tight">
                                            Rp {rp(b.cashIncome || 0)}
                                        </p>
                                    </div>
                                    {(b.qrisFee || 0) > 0 && (
                                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 whitespace-nowrap" title="Omset sudah dikurangi biaya layanan QRIS">
                                            Biaya QRIS −Rp {rp(b.qrisFee)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )})}
                    </div>

                    {/* Recharts Bar Chart Grouped */}
                    <div className="pt-4 sm:pt-6 border-t border-gray-100">
                        <div className="h-64 sm:h-72 w-full">
                            {isMounted && branchDailyComparison.length > 0 ? (
                                <LazyRecharts render={(R) => (
                                <R.ResponsiveContainer width="100%" height="100%">
                                    <R.BarChart 
                                        data={branchDailyComparison} 
                                        barGap={4} 
                                        barCategoryGap="18%"
                                        margin={{ top: 15, right: 10, left: 0, bottom: 20 }}
                                    >
                                        <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <R.XAxis 
                                            dataKey="branchName" 
                                            interval={0}
                                            tickFormatter={(val) => (val ? val.replace(/^Ayumi\s+/i, '') : val)}
                                            tick={{ fontSize: 10, fontWeight: 700, fill: '#1e293b' }} 
                                            axisLine={{ stroke: '#cbd5e1' }}
                                            tickLine={false} 
                                        />
                                        <R.YAxis 
                                            width={42}
                                            tickFormatter={(val) => {
                                                if (val === 0) return '0'
                                                if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.0', '') + ' Jt'
                                                if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                return val
                                            }}
                                            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
                                            axisLine={false}
                                            tickLine={false} 
                                        />
                                        <R.Tooltip 
                                            formatter={(value, name) => ['Rp ' + Number(value).toLocaleString('id-ID'), name]}
                                            itemSorter={(item) => (item.name.includes('Treatment') ? -1 : 1)}
                                            labelStyle={{ fontWeight: 'bold', color: '#5c3316', fontSize: '13px' }}
                                            contentStyle={{ borderRadius: '16px', backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #f472b6', padding: '10px 14px' }}
                                        />
                                        <R.Legend 
                                            verticalAlign="top" 
                                            align="center"
                                            wrapperStyle={{ paddingTop: '0px', paddingBottom: '12px', fontWeight: '800', fontSize: '12px', color: '#0f172a' }} 
                                        />
                                        <R.Bar dataKey="treatmentIncome" name="Omset Treatment" fill="#EC4899" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <R.Bar dataKey="productIncome" name="Omset Produk" fill="#06B6D4" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <R.Bar dataKey="couponSalesIncome" name="Penjualan Kupon" fill="#10B981" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                        <R.Bar dataKey="couponUsedValue" name="Pemakaian Sesi" fill="#F59E0B" radius={[5, 5, 0, 0]} maxBarSize={24} />
                                    </R.BarChart>
                                </R.ResponsiveContainer>
                                )} />
                            ) : (
                                <div className="h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                                    Mengambil data cabang...
                                </div>
                            )}
                        </div>
                    </div>
                </>
            ) : null}
</div>
    )
}
