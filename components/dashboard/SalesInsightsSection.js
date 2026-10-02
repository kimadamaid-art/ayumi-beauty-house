'use client'

import LazyRecharts from '@/components/charts/LazyRecharts'

/**
 * Section 4 Dashboard owner: Sales Insights (hari & jam teramai).
 * Hanya tampilan; data dan state metrik/buka-tutup dikelola app/dashboard/page.js.
 */
export default function SalesInsightsSection({
    collapsedSections,
    dayOfWeekStats,
    hourlyStats,
    isMounted,
    salesInsightMetric,
    setSalesInsightMetric,
    toggleSection
}) {
    return (
        <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
            {/* Section Header with Metric Toggle */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.salesInsights ? '' : 'pb-4 border-b border-gray-200'}`}>
                <div>
                    <div 
                        onClick={() => toggleSection('salesInsights')}
                        className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                        title={collapsedSections.salesInsights ? "Buka modul" : "Lipat modul"}
                    >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-orange-500 group-hover:bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.salesInsights ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-orange-600 transition-colors">
                            Sales Insights: Pola Waktu Penjualan Teramai
                        </h3>
                    </div>
                    <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                        Analisis transaksi harian dan jam operasional sibuk untuk optimasi jadwal kerja dan promo klinik.
                    </p>
                </div>

                <div className="flex items-center gap-1.5 p-1 bg-stone-100 border border-stone-200 rounded-2xl shrink-0 self-start sm:self-auto">
                    <button
                        type="button"
                        onClick={() => setSalesInsightMetric('sales')}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            salesInsightMetric === 'sales'
                                ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                : 'text-stone-500 hover:text-stone-800'
                        }`}
                    >
                        Nominal Omset (Rp)
                    </button>
                    <button
                        type="button"
                        onClick={() => setSalesInsightMetric('count')}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            salesInsightMetric === 'count'
                                ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                : 'text-stone-500 hover:text-stone-800'
                        }`}
                    >
                        Volume Transaksi (Trx)
                    </button>
                </div>
            </div>

            {!collapsedSections.salesInsights ? (
                /* Two Charts: Day of the Week & Hourly Sales */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
                    {/* 1. Day of the Week */}
                    <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-extrabold text-sm text-gray-900">
                                    Penjualan Berdasarkan Hari (Day of the Week)
                                </h4>
                                <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                    Akumulasi aktivitas transaksi Senin s/d Minggu
                                </p>
                            </div>
                            {dayOfWeekStats.length > 0 && (
                                <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                    Puncak: {
                                        salesInsightMetric === 'sales'
                                            ? dayOfWeekStats.reduce((max, d) => (d.sales > (max?.sales || 0) ? d : max), dayOfWeekStats[0])?.day
                                            : dayOfWeekStats.reduce((max, d) => (d.count > (max?.count || 0) ? d : max), dayOfWeekStats[0])?.day
                                    }
                                </span>
                            )}
                        </div>
                        <div className="h-60 sm:h-64 w-full pt-2">
                            {isMounted && dayOfWeekStats.length > 0 ? (
                                <LazyRecharts render={(R) => (
                                <R.ResponsiveContainer width="100%" height="100%">
                                    <R.BarChart data={dayOfWeekStats} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                                        <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <R.XAxis dataKey="day" tick={{ fontSize: 11, fontWeight: 700, fill: '#334155' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                                        <R.YAxis 
                                            width={salesInsightMetric === 'sales' ? 45 : 30}
                                            tickFormatter={(val) => {
                                                if (salesInsightMetric === 'sales') {
                                                    if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                                    if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                    return val
                                                }
                                                return val
                                            }}
                                            tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} 
                                        />
                                        <R.Tooltip 
                                            formatter={(value) => [
                                                salesInsightMetric === 'sales'
                                                    ? 'Rp ' + Number(value).toLocaleString('id-ID')
                                                    : `${value} Transaksi`,
                                                salesInsightMetric === 'sales' ? 'Omset Kotor' : 'Volume'
                                            ]}
                                            contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #fdba74' }}
                                        />
                                        <R.Bar 
                                            dataKey={salesInsightMetric === 'sales' ? 'sales' : 'count'} 
                                            fill="#f97316" 
                                            radius={[6, 6, 0, 0]} 
                                            maxBarSize={36} 
                                        />
                                    </R.BarChart>
                                </R.ResponsiveContainer>
                                )} />
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat data harian...</div>
                            )}
                        </div>
                    </div>

                    {/* 2. Hourly Sales Amount */}
                    <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-extrabold text-sm text-gray-900">
                                    Jam Sibuk Penjualan (Hourly Sales)
                                </h4>
                                <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                                    Distribusi keramaian transaksi jam 08:00 - 21:00
                                </p>
                            </div>
                            {hourlyStats.length > 0 && (
                                <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                                    Puncak: {
                                        salesInsightMetric === 'sales'
                                            ? hourlyStats.reduce((max, h) => (h.sales > (max?.sales || 0) ? h : max), hourlyStats[0])?.hour
                                            : hourlyStats.reduce((max, h) => (h.count > (max?.count || 0) ? h : max), hourlyStats[0])?.hour
                                    }
                                </span>
                            )}
                        </div>
                        <div className="h-60 sm:h-64 w-full pt-2">
                            {isMounted && hourlyStats.length > 0 ? (
                                <LazyRecharts render={(R) => (
                                <R.ResponsiveContainer width="100%" height="100%">
                                    <R.BarChart data={hourlyStats} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                                        <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <R.XAxis dataKey="hour" tick={{ fontSize: 10, fontWeight: 700, fill: '#334155' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                                        <R.YAxis 
                                            width={salesInsightMetric === 'sales' ? 45 : 30}
                                            tickFormatter={(val) => {
                                                if (salesInsightMetric === 'sales') {
                                                    if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                                    if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                                    return val
                                                }
                                                return val
                                            }}
                                            tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} 
                                        />
                                        <R.Tooltip 
                                            formatter={(value) => [
                                                salesInsightMetric === 'sales'
                                                    ? 'Rp ' + Number(value).toLocaleString('id-ID')
                                                    : `${value} Transaksi`,
                                                salesInsightMetric === 'sales' ? 'Omset Kotor' : 'Volume'
                                            ]}
                                            contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #fdba74' }}
                                        />
                                        <R.Bar 
                                            dataKey={salesInsightMetric === 'sales' ? 'sales' : 'count'} 
                                            fill="#ea580c" 
                                            radius={[5, 5, 0, 0]} 
                                            maxBarSize={22} 
                                        />
                                    </R.BarChart>
                                </R.ResponsiveContainer>
                                )} />
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat data jam sibuk...</div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
