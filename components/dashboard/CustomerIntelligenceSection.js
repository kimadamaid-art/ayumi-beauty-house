'use client'

import LazyRecharts from '@/components/charts/LazyRecharts'

/**
 * Section 6 Dashboard owner: Demografi & Retensi Pelanggan (Customer Intelligence).
 * Hanya tampilan; data dan state buka-tutup dikelola app/dashboard/page.js.
 */
export default function CustomerIntelligenceSection({
    collapsedSections,
    demographicAge,
    demographicGender,
    isMounted,
    retentionStats,
    retentionTab,
    setRetentionTab,
    toggleSection
}) {
    return (
        <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-4 sm:space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${collapsedSections.customerIntelligence ? '' : 'pb-4 border-b border-gray-200'}`}>
                <div>
                    <div 
                        onClick={() => toggleSection('customerIntelligence')}
                        className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                        title={collapsedSections.customerIntelligence ? "Buka modul" : "Lipat modul"}
                    >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-purple-500 group-hover:bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.customerIntelligence ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-purple-600 transition-colors">
                            Intelijen Pelanggan: Demografi & Retensi Pasien
                        </h3>
                    </div>
                    <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                        Analisis profil gender, rentang usia, serta rasio & kontribusi omset pasien baru vs pasien setia/lama.
                    </p>
                </div>
            </div>

            {!collapsedSections.customerIntelligence ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
                    {/* Card 1: Demografi Pelanggan (Gender & Usia) */}
                    <div className="p-5 sm:p-6 bg-stone-50/60 border border-purple-100/90 rounded-2xl sm:rounded-3xl space-y-5 flex flex-col justify-between">
                    <div>
                        <div className="pb-3 border-b border-gray-200">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-6 bg-purple-500 rounded-full"></div>
                                <h3 className="text-base sm:text-lg font-extrabold text-gray-900">
                                    Demografi Pasien (Jenis Kelamin & Usia)
                                </h3>
                            </div>
                            <p className="text-xs text-gray-500 font-semibold mt-1 pl-4">
                                Sebaran profil pasien yang bertransaksi pada periode ini.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch pt-4">
                            {/* Box A: Donut Chart - Gender */}
                            <div className="p-3.5 bg-stone-50/60 border border-stone-200/70 rounded-2xl flex flex-col justify-between space-y-2">
                                <div className="border-b border-stone-200/70 pb-2">
                                    <p className="text-xs font-extrabold text-gray-900">Komposisi Jenis Kelamin</p>
                                    <p className="text-[10px] text-gray-500 font-semibold">Proporsi pengunjung wanita vs pria</p>
                                </div>

                                <div className="h-44 w-full relative flex items-center justify-center my-auto">
                                    {isMounted && demographicGender.length > 0 ? (
                                        <>
                                            <LazyRecharts render={(R) => (
                                            <R.ResponsiveContainer width="100%" height="100%">
                                                <R.PieChart>
                                                    <R.Pie
                                                        data={demographicGender}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={50}
                                                        outerRadius={72}
                                                        paddingAngle={4}
                                                    >
                                                        <R.Cell fill="#EC4899" />
                                                        <R.Cell fill="#06B6D4" />
                                                    </R.Pie>
                                                    <R.Tooltip formatter={(val, name) => [`${val} Pasien`, name]} />
                                                </R.PieChart>
                                            </R.ResponsiveContainer>
                                            )} />
                                            {/* Center Stat Inside Donut */}
                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                <span className="text-xl font-black text-[#EC4899] leading-none">
                                                    {demographicGender[0]?.percent || 0}%
                                                </span>
                                                <span className="text-[10px] font-black uppercase tracking-wider text-pink-700/80 mt-1">
                                                    {demographicGender[0]?.name || 'Wanita'}
                                                </span>
                                                <span className="text-[9px] font-semibold text-gray-400 mt-0.5">
                                                    Dominan
                                                </span>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-xs text-gray-400">Memuat gender...</p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-200/70 text-xs">
                                    <div className="p-2 sm:p-2.5 rounded-xl bg-pink-50/70 border border-pink-100 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="w-2.5 h-2.5 rounded-full bg-[#EC4899] shrink-0"></span>
                                            <span className="font-bold text-gray-700 truncate text-[11px]">Wanita</span>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="font-black text-[#EC4899] block text-xs">{demographicGender[0]?.value || 0}</span>
                                            <span className="text-[10px] font-bold text-pink-600">{demographicGender[0]?.percent || 0}%</span>
                                        </div>
                                    </div>
                                    <div className="p-2 sm:p-2.5 rounded-xl bg-cyan-50/70 border border-cyan-100 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="w-2.5 h-2.5 rounded-full bg-[#06B6D4] shrink-0"></span>
                                            <span className="font-bold text-gray-700 truncate text-[11px]">Pria</span>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="font-black text-[#06B6D4] block text-xs">{demographicGender[1]?.value || 0}</span>
                                            <span className="text-[10px] font-bold text-cyan-600">{demographicGender[1]?.percent || 0}%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Box B: Distribusi Rentang Usia */}
                            <div className="p-3.5 bg-stone-50/60 border border-stone-200/70 rounded-2xl flex flex-col justify-between space-y-2.5">
                                <div>
                                    <div className="flex items-center justify-between border-b border-stone-200/70 pb-2">
                                        <div>
                                            <p className="text-xs font-extrabold text-gray-900">Distribusi Rentang Usia</p>
                                            <p className="text-[10px] text-gray-500 font-semibold">Berdasarkan data pasien terverifikasi</p>
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-600 bg-white border border-stone-200 px-2 py-0.5 rounded-full shadow-2xs">
                                            {demographicAge.filter(d => d.group !== 'Lainnya').reduce((s, a) => s + a.count, 0)} Terdata
                                        </span>
                                    </div>

                                    <div className="space-y-2 pt-2 max-h-48 overflow-y-auto pr-0.5">
                                        {demographicAge.length > 0 ? (
                                            (() => {
                                                const validGroups = demographicAge.filter(d => d.group !== 'Lainnya' && (d.count > 0 || ['19-24 Thn', '25-34 Thn', '35-44 Thn', '45+ Thn'].includes(d.group)))
                                                const maxCount = Math.max(...validGroups.map(d => d.count), 1)

                                                return validGroups.map((item) => {
                                                    const barWidth = item.count > 0 ? `${Math.max(Math.round((item.count / maxCount) * 100), 4)}%` : '0%'
                                                    return (
                                                        <div key={item.group} className="space-y-1">
                                                            <div className="flex justify-between items-center text-[11px]">
                                                                <span className="font-bold text-gray-800">
                                                                    {item.group}
                                                                </span>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="font-extrabold text-gray-900 text-xs">
                                                                        {item.count} <span className="text-[10px] font-medium text-gray-500">Pasien</span>
                                                                    </span>
                                                                    <span className="text-[10px] font-black px-1.5 py-0.2 rounded-md bg-orange-100 text-orange-800 border border-orange-200/60">
                                                                        {item.percent}%
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="h-2 w-full bg-stone-200/60 rounded-full overflow-hidden p-0.2">
                                                                <div 
                                                                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-amber-400 to-orange-500"
                                                                    style={{ width: barWidth }}
                                                                ></div>
                                                            </div>
                                                        </div>
                                                    )
                                                })
                                            })()
                                        ) : (
                                            <p className="text-xs text-gray-400 text-center py-6">Memuat usia...</p>
                                        )}
                                    </div>
                                </div>

                                {/* Subtle disclaimer for unrecorded birth dates */}
                                {(() => {
                                    const unknownItem = demographicAge.find(d => d.group === 'Lainnya')
                                    if (!unknownItem || unknownItem.count <= 0) return null
                                    return (
                                        <div className="p-2 rounded-xl bg-stone-100/80 border border-stone-200/80 flex items-center justify-between text-[10px] text-gray-500 font-semibold">
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3 h-3 text-stone-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                Belum Lengkap Tgl Lahir
                                            </span>
                                            <span className="font-extrabold text-stone-700">
                                                {unknownItem.count} Pasien ({unknownItem.percent}%)
                                            </span>
                                        </div>
                                    )
                                })()}
                            </div>
                        </div>
                    </div>

                    {/* Executive Demographic Highlights Strip */}
                    <div className="pt-3.5 border-t border-stone-200/80">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-50/80 to-white border border-purple-100/90 shadow-2xs space-y-1">
                                <div className="flex items-center gap-1 text-purple-800">
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    <span className="text-[10px] font-black uppercase tracking-wider">Usia Terbanyak</span>
                                </div>
                                <p className="text-xs font-black text-gray-900">19–34 Tahun</p>
                                <p className="text-[10px] font-bold text-purple-700">
                                    {(() => {
                                        const u19_34 = (demographicAge.find(d => d.group === '19-24 Thn')?.count || 0) + (demographicAge.find(d => d.group === '25-34 Thn')?.count || 0)
                                        const knownTotal = demographicAge.filter(d => d.group !== 'Lainnya').reduce((s, a) => s + a.count, 0)
                                        const pct = knownTotal > 0 ? ((u19_34 / knownTotal) * 100).toFixed(1) : 0
                                        return `${pct}% usia terdata`
                                    })()}
                                </p>
                            </div>

                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-pink-50/80 to-white border border-pink-100/90 shadow-2xs space-y-1">
                                <div className="flex items-center gap-1 text-[#B5588A]">
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                                    <span className="text-[10px] font-black uppercase tracking-wider">Dominasi Gender</span>
                                </div>
                                <p className="text-xs font-black text-gray-900">
                                    Wanita ({demographicGender[0]?.percent || 0}%)
                                </p>
                                <p className="text-[10px] font-bold text-pink-700">
                                    {demographicGender[0]?.value || 0} dari {(demographicGender[0]?.value || 0) + (demographicGender[1]?.value || 0)} pasien
                                </p>
                            </div>

                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-stone-50 to-white border border-stone-200/90 shadow-2xs space-y-1">
                                <div className="flex items-center gap-1 text-stone-700">
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    <span className="text-[10px] font-black uppercase tracking-wider">Kelengkapan Profil</span>
                                </div>
                                <p className="text-xs font-black text-gray-900">
                                    {(() => {
                                        const knownTotal = demographicAge.filter(d => d.group !== 'Lainnya').reduce((s, a) => s + a.count, 0)
                                        const totalPats = (demographicGender[0]?.value || 0) + (demographicGender[1]?.value || 0)
                                        const pct = totalPats > 0 ? ((knownTotal / totalPats) * 100).toFixed(1) : 0
                                        return `${pct}% Tercatat`
                                    })()}
                                </p>
                                <p className="text-[10px] font-semibold text-stone-500">
                                    {demographicAge.filter(d => d.group !== 'Lainnya').reduce((s, a) => s + a.count, 0)} data tanggal lahir
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card 2: Perbandingan Kostumer Baru vs Lama (Customer Retention) */}
                <div className="p-5 sm:p-6 bg-stone-50/60 border border-emerald-150 rounded-2xl sm:rounded-3xl space-y-5 flex flex-col justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200/80">
                        <div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-6 bg-emerald-500 rounded-full"></div>
                                <h3 className="text-base sm:text-lg font-extrabold text-gray-900">
                                    Perbandingan Kostumer Baru vs Lama
                                </h3>
                            </div>
                            <p className="text-xs text-gray-500 font-semibold mt-1 pl-4">
                                Retensi loyalitas pelanggan (repeat) vs akuisisi pelanggan baru.
                            </p>
                        </div>

                        {/* Segmented Filter Tab */}
                        <div className="flex items-center gap-1 p-1 bg-stone-100 border border-stone-200 rounded-xl shrink-0 self-start sm:self-auto">
                            <button
                                type="button"
                                onClick={() => setRetentionTab('all')}
                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    retentionTab === 'all'
                                        ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                        : 'text-stone-500 hover:text-stone-800'
                                }`}
                            >
                                Semua
                            </button>
                            <button
                                type="button"
                                onClick={() => setRetentionTab('treatment')}
                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    retentionTab === 'treatment'
                                        ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                        : 'text-stone-500 hover:text-stone-800'
                                }`}
                            >
                                Treatment
                            </button>
                            <button
                                type="button"
                                onClick={() => setRetentionTab('product')}
                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    retentionTab === 'product'
                                        ? 'bg-white text-stone-900 shadow-sm font-extrabold'
                                        : 'text-stone-500 hover:text-stone-800'
                                }`}
                            >
                                Produk
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4">
                            {/* 1. Treatment Retention Section */}
                            {(retentionTab === 'all' || retentionTab === 'treatment') && (() => {
                                const totalPats = retentionStats.treatment.newCount + retentionStats.treatment.oldCount
                                const newPct = totalPats > 0 ? ((retentionStats.treatment.newCount / totalPats) * 100).toFixed(1) : 0
                                const oldPct = totalPats > 0 ? ((retentionStats.treatment.oldCount / totalPats) * 100).toFixed(1) : 0
                                const totalRev = retentionStats.treatment.newRevenue + retentionStats.treatment.oldRevenue
                                const newRevPct = totalRev > 0 ? ((retentionStats.treatment.newRevenue / totalRev) * 100).toFixed(1) : 0
                                const oldRevPct = totalRev > 0 ? ((retentionStats.treatment.oldRevenue / totalRev) * 100).toFixed(1) : 0

                                return (
                                    <div className="p-4 sm:p-5 rounded-2xl bg-stone-50/60 border border-stone-200/80 space-y-3.5">
                                        {/* Header Category */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-pink-100/80 text-[#B5588A] flex items-center justify-center shrink-0 shadow-inner">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                                </div>
                                                <div>
                                                    <h4 className="font-extrabold text-xs sm:text-sm text-gray-900 leading-tight">
                                                        Layanan Treatment
                                                    </h4>
                                                    <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
                                                        Tingkat repeat order perawatan klinik
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[11px] font-extrabold px-3 py-1 rounded-full bg-white border border-stone-200 text-stone-700 shadow-xs">
                                                Total: {totalPats} Pasien
                                            </span>
                                        </div>

                                        {/* Circular Donut & Metric Cards Container */}
                                        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 pt-1">
                                            {/* Donut Chart (Lingkaran) */}
                                            <div className="flex flex-col items-center shrink-0">
                                                <div className="w-36 h-36 relative flex items-center justify-center">
                                                    {isMounted && totalPats > 0 ? (
                                                        <>
                                                            <LazyRecharts render={(R) => (
                                                            <R.ResponsiveContainer width="100%" height="100%">
                                                                <R.PieChart>
                                                                    <R.Pie
                                                                        data={[
                                                                            { name: 'Pasien Baru', value: retentionStats.treatment.newCount },
                                                                            { name: 'Pasien Loyal (Repeat)', value: retentionStats.treatment.oldCount }
                                                                        ]}
                                                                        dataKey="value"
                                                                        nameKey="name"
                                                                        cx="50%"
                                                                        cy="50%"
                                                                        innerRadius={38}
                                                                        outerRadius={56}
                                                                        paddingAngle={4}
                                                                        stroke="#ffffff"
                                                                        strokeWidth={2.5}
                                                                    >
                                                                        <R.Cell fill="#10B981" />
                                                                        <R.Cell fill="#B5588A" />
                                                                    </R.Pie>
                                                                    <R.Tooltip formatter={(val, name) => [`${val} Pasien`, name]} />
                                                                </R.PieChart>
                                                            </R.ResponsiveContainer>
                                                            )} />
                                                            {/* Center Stat inside Circle */}
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                                <span className="text-xl font-black text-[#B5588A] tracking-tight leading-none">
                                                                    {oldPct}%
                                                                </span>
                                                                <span className="text-[9px] font-black uppercase tracking-wider text-pink-700 bg-pink-100/70 px-1.5 py-0.5 rounded-md mt-1">
                                                                    Repeat
                                                                </span>
                                                                <span className="text-[8px] font-bold text-gray-400 mt-0.5">
                                                                    {retentionStats.treatment.oldCount} Pasien
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="w-full h-full rounded-full border-4 border-stone-100 flex items-center justify-center text-[10px] text-gray-400 font-semibold">
                                                            Nihil
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Micro Legend */}
                                                <div className="flex items-center justify-center gap-3 mt-1.5">
                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100"></span>
                                                        Baru ({newPct}%)
                                                    </span>
                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                                                        <span className="w-2 h-2 rounded-full bg-[#B5588A] ring-2 ring-pink-100"></span>
                                                        Repeat ({oldPct}%)
                                                    </span>
                                                </div>
                                            </div>

                                            {/* 2 Split Metric Cards */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 w-full">
                                                {/* Card Baru */}
                                                <div className="p-3.5 rounded-2xl bg-white border border-emerald-200/80 shadow-xs space-y-2 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                            Pasien Baru
                                                        </span>
                                                        <span className="text-xs font-black text-emerald-700">
                                                            {newPct}%
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-baseline gap-1.5">
                                                            <span className="text-lg font-black text-gray-900">
                                                                {retentionStats.treatment.newCount}
                                                            </span>
                                                            <span className="text-xs font-semibold text-gray-500">Pasien</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-emerald-50">
                                                            <span className="text-xs font-extrabold text-emerald-700">
                                                                Rp {retentionStats.treatment.newRevenue.toLocaleString('id-ID')}
                                                            </span>
                                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                                                {newRevPct}% omset
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Card Repeat */}
                                                <div className="p-3.5 rounded-2xl bg-white border border-pink-200/80 shadow-xs space-y-2 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-[#B5588A] bg-pink-50 px-2 py-0.5 rounded-md border border-pink-200/60 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-[#B5588A]"></span>
                                                            Loyal (Repeat)
                                                        </span>
                                                        <span className="text-xs font-black text-[#B5588A]">
                                                            {oldPct}%
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-baseline gap-1.5">
                                                            <span className="text-lg font-black text-gray-900">
                                                                {retentionStats.treatment.oldCount}
                                                            </span>
                                                            <span className="text-xs font-semibold text-gray-500">Pasien</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-pink-50">
                                                            <span className="text-xs font-extrabold text-[#B5588A]">
                                                                Rp {retentionStats.treatment.oldRevenue.toLocaleString('id-ID')}
                                                            </span>
                                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-pink-50 text-[#B5588A]">
                                                                {oldRevPct}% omset
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Deep-dive note if filtered */}
                                        {retentionTab === 'treatment' && (
                                            <div className="p-2.5 rounded-xl bg-pink-50/60 border border-pink-100 text-[11px] font-bold text-gray-700 flex items-center justify-between">
                                                <span>Kontribusi Omset Loyal:</span>
                                                <span className="font-extrabold text-[#B5588A]">
                                                    {oldRevPct}% dari total omset treatment
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}

                            {/* 2. Product Retention Section */}
                            {(retentionTab === 'all' || retentionTab === 'product') && (() => {
                                const totalPats = retentionStats.product.newCount + retentionStats.product.oldCount
                                const newPct = totalPats > 0 ? ((retentionStats.product.newCount / totalPats) * 100).toFixed(1) : 0
                                const oldPct = totalPats > 0 ? ((retentionStats.product.oldCount / totalPats) * 100).toFixed(1) : 0
                                const totalRev = retentionStats.product.newRevenue + retentionStats.product.oldRevenue
                                const newRevPct = totalRev > 0 ? ((retentionStats.product.newRevenue / totalRev) * 100).toFixed(1) : 0
                                const oldRevPct = totalRev > 0 ? ((retentionStats.product.oldRevenue / totalRev) * 100).toFixed(1) : 0

                                return (
                                    <div className="p-4 sm:p-5 rounded-2xl bg-stone-50/60 border border-stone-200/80 space-y-3.5">
                                        {/* Header Category */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-cyan-100/80 text-[#06B6D4] flex items-center justify-center shrink-0 shadow-inner">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                                </div>
                                                <div>
                                                    <h4 className="font-extrabold text-xs sm:text-sm text-gray-900 leading-tight">
                                                        Penjualan Produk Skincare
                                                    </h4>
                                                    <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
                                                        Tingkat repeat order produk kecantikan
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[11px] font-extrabold px-3 py-1 rounded-full bg-white border border-stone-200 text-stone-700 shadow-xs">
                                                Total: {totalPats} Pasien
                                            </span>
                                        </div>

                                        {/* Circular Donut & Metric Cards Container */}
                                        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 pt-1">
                                            {/* Donut Chart (Lingkaran) */}
                                            <div className="flex flex-col items-center shrink-0">
                                                <div className="w-36 h-36 relative flex items-center justify-center">
                                                    {isMounted && totalPats > 0 ? (
                                                        <>
                                                            <LazyRecharts render={(R) => (
                                                            <R.ResponsiveContainer width="100%" height="100%">
                                                                <R.PieChart>
                                                                    <R.Pie
                                                                        data={[
                                                                            { name: 'Pembeli Baru', value: retentionStats.product.newCount },
                                                                            { name: 'Pembeli Loyal (Repeat)', value: retentionStats.product.oldCount }
                                                                        ]}
                                                                        dataKey="value"
                                                                        nameKey="name"
                                                                        cx="50%"
                                                                        cy="50%"
                                                                        innerRadius={38}
                                                                        outerRadius={56}
                                                                        paddingAngle={4}
                                                                        stroke="#ffffff"
                                                                        strokeWidth={2.5}
                                                                    >
                                                                        <R.Cell fill="#10B981" />
                                                                        <R.Cell fill="#06B6D4" />
                                                                    </R.Pie>
                                                                    <R.Tooltip formatter={(val, name) => [`${val} Pasien`, name]} />
                                                                </R.PieChart>
                                                            </R.ResponsiveContainer>
                                                            )} />
                                                            {/* Center Stat inside Circle */}
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                                <span className="text-xl font-black text-[#06B6D4] tracking-tight leading-none">
                                                                    {oldPct}%
                                                                </span>
                                                                <span className="text-[9px] font-black uppercase tracking-wider text-cyan-800 bg-cyan-100/70 px-1.5 py-0.5 rounded-md mt-1">
                                                                    Repeat
                                                                </span>
                                                                <span className="text-[8px] font-bold text-gray-400 mt-0.5">
                                                                    {retentionStats.product.oldCount} Pasien
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="w-full h-full rounded-full border-4 border-stone-100 flex items-center justify-center text-[10px] text-gray-400 font-semibold">
                                                            Nihil
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Micro Legend */}
                                                <div className="flex items-center justify-center gap-3 mt-1.5">
                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                                                        <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100"></span>
                                                        Baru ({newPct}%)
                                                    </span>
                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                                                        <span className="w-2 h-2 rounded-full bg-[#06B6D4] ring-2 ring-cyan-100"></span>
                                                        Repeat ({oldPct}%)
                                                    </span>
                                                </div>
                                            </div>

                                            {/* 2 Split Metric Cards */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 w-full">
                                                {/* Card Baru */}
                                                <div className="p-3.5 rounded-2xl bg-white border border-emerald-200/80 shadow-xs space-y-2 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                            Pembeli Baru
                                                        </span>
                                                        <span className="text-xs font-black text-emerald-700">
                                                            {newPct}%
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-baseline gap-1.5">
                                                            <span className="text-lg font-black text-gray-900">
                                                                {retentionStats.product.newCount}
                                                            </span>
                                                            <span className="text-xs font-semibold text-gray-500">Pasien</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-emerald-50">
                                                            <span className="text-xs font-extrabold text-emerald-700">
                                                                Rp {retentionStats.product.newRevenue.toLocaleString('id-ID')}
                                                            </span>
                                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                                                {newRevPct}% omset
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Card Repeat */}
                                                <div className="p-3.5 rounded-2xl bg-white border border-cyan-200/80 shadow-xs space-y-2 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-200/60 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4]"></span>
                                                            Loyal (Repeat)
                                                        </span>
                                                        <span className="text-xs font-black text-[#06B6D4]">
                                                            {oldPct}%
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-baseline gap-1.5">
                                                            <span className="text-lg font-black text-gray-900">
                                                                {retentionStats.product.oldCount}
                                                            </span>
                                                            <span className="text-xs font-semibold text-gray-500">Pasien</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-cyan-50">
                                                            <span className="text-xs font-extrabold text-[#06B6D4]">
                                                                Rp {retentionStats.product.oldRevenue.toLocaleString('id-ID')}
                                                            </span>
                                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-cyan-50 text-[#06B6D4]">
                                                                {oldRevPct}% omset
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Deep-dive note if filtered */}
                                        {retentionTab === 'product' && (
                                            <div className="p-2.5 rounded-xl bg-cyan-50/60 border border-cyan-100 text-[11px] font-bold text-gray-700 flex items-center justify-between">
                                                <span>Kontribusi Omset Loyal:</span>
                                                <span className="font-extrabold text-[#06B6D4]">
                                                    {oldRevPct}% dari total omset produk skincare
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
