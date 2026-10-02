'use client'

import LazyRecharts from '@/components/charts/LazyRecharts'

/**
 * Section 5 Dashboard owner: Analisis Penjualan per Kategori.
 * Hanya tampilan; data dan state tab/buka-tutup dikelola app/dashboard/page.js.
 */
export default function CategoryAnalyticsSection({
    categorySalesStats,
    categoryVolumeStats,
    collapsedSections,
    isMounted,
    selectedCategoryTab,
    setSelectedCategoryTab,
    setShowAllCategoryItems,
    showAllCategoryItems,
    toggleSection
}) {
    return (
        <div className="card-ayumi p-4 sm:p-6 md:p-7 bg-white space-y-5 shadow-md border border-gray-200 rounded-2xl sm:rounded-3xl">
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${collapsedSections.categoryAnalytics ? '' : 'pb-4 border-b border-gray-200'}`}>
                <div>
                    <div 
                        onClick={() => toggleSection('categoryAnalytics')}
                        className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none"
                        title={collapsedSections.categoryAnalytics ? "Buka modul" : "Lipat modul"}
                    >
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-pink-500 group-hover:bg-pink-600 text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 group-hover:scale-105">
                            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsedSections.categoryAnalytics ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#5c3316] group-hover:text-pink-600 transition-colors">
                            Analisis Penjualan per Kategori (Treatment & Produk)
                        </h3>
                    </div>
                    <p className="text-xs text-gray-600 font-semibold mt-1 pl-9.5 sm:pl-11">
                        Peringkat performa setiap kategori layanan dan kategori produk skincare.
                    </p>
                </div>
            </div>

            {!collapsedSections.categoryAnalytics ? (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
                {/* 1. Category by Volume */}
                <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                    <div>
                        <h4 className="font-extrabold text-sm text-gray-900">
                            Kategori Berdasarkan Kuantitas (Volume Item Terjual)
                        </h4>
                        <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                            Total unit produk & sesi treatment terjual per kategori
                        </p>
                    </div>
                    <div className="h-64 sm:h-72 w-full pt-2">
                        {isMounted && categoryVolumeStats.length > 0 ? (
                            <LazyRecharts render={(R) => (
                            <R.ResponsiveContainer width="100%" height="100%">
                                <R.BarChart data={categoryVolumeStats} margin={{ top: 15, right: 10, left: 0, bottom: 40 }}>
                                    <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <R.XAxis 
                                        dataKey="category" 
                                        interval={0}
                                        angle={-25}
                                        textAnchor="end"
                                        tick={{ fontSize: 9, fontWeight: 700, fill: '#334155' }} 
                                        axisLine={{ stroke: '#cbd5e1' }} 
                                        tickLine={false} 
                                    />
                                    <R.YAxis tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} width={30} />
                                    <R.Tooltip 
                                        formatter={(value) => [`${value} Item / Sesi`, 'Kuantitas Terjual']}
                                        contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #f472b6' }}
                                    />
                                    <R.Bar 
                                        dataKey="volume" 
                                        fill="#f97316" 
                                        radius={[6, 6, 0, 0]} 
                                        maxBarSize={32} 
                                        onClick={(entry) => {
                                            if (entry && entry.category) setSelectedCategoryTab(entry.category)
                                        }}
                                        className="cursor-pointer"
                                    />
                                </R.BarChart>
                            </R.ResponsiveContainer>
                            )} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat kategori...</div>
                        )}
                    </div>
                </div>

                {/* 2. Category by Sales */}
                <div className="p-4 rounded-2xl bg-stone-50/50 border border-stone-200/80 space-y-3">
                    <div>
                        <h4 className="font-extrabold text-sm text-gray-900">
                            Kategori Berdasarkan Omset Penjualan (Bersih)
                        </h4>
                        <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                            Kontribusi omzet bersih (setelah diskon) dari setiap kategori
                        </p>
                    </div>
                    <div className="h-64 sm:h-72 w-full pt-2">
                        {isMounted && categorySalesStats.length > 0 ? (
                            <LazyRecharts render={(R) => (
                            <R.ResponsiveContainer width="100%" height="100%">
                                <R.BarChart data={categorySalesStats} margin={{ top: 15, right: 10, left: 0, bottom: 40 }}>
                                    <R.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <R.XAxis 
                                        dataKey="category" 
                                        interval={0}
                                        angle={-25}
                                        textAnchor="end"
                                        tick={{ fontSize: 9, fontWeight: 700, fill: '#334155' }} 
                                        axisLine={{ stroke: '#cbd5e1' }} 
                                        tickLine={false} 
                                    />
                                    <R.YAxis 
                                        width={46}
                                        tickFormatter={(val) => {
                                            if (val >= 1000000) return (val / 1000000).toFixed(0) + ' Jt'
                                            if (val >= 1000) return (val / 1000).toFixed(0) + ' Rb'
                                            return val
                                        }}
                                        tick={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} 
                                    />
                                    <R.Tooltip 
                                        formatter={(value) => ['Rp ' + Number(value).toLocaleString('id-ID'), 'Total Omset']}
                                        contentStyle={{ borderRadius: '14px', backgroundColor: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', border: '1px solid #f472b6' }}
                                    />
                                    <R.Bar 
                                        dataKey="sales" 
                                        fill="#ec4899" 
                                        radius={[6, 6, 0, 0]} 
                                        maxBarSize={32} 
                                        onClick={(entry) => {
                                            if (entry && entry.category) setSelectedCategoryTab(entry.category)
                                        }}
                                        className="cursor-pointer"
                                    />
                                </R.BarChart>
                            </R.ResponsiveContainer>
                            )} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold">Memuat kategori...</div>
                        )}
                    </div>
                </div>
            </div>

            {/* CATEGORY DRILLDOWN: MASTER-DETAIL SPLIT VIEW */}
            <div className="pt-4 border-t border-gray-200 space-y-4">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-5 bg-pink-500 rounded-full"></div>
                        <h4 className="font-extrabold text-sm sm:text-base text-gray-900">
                            Rincian Layanan & Produk Terlaris per Kategori
                        </h4>
                    </div>
                    <p className="text-[11px] text-gray-500 font-semibold pl-3.5 mt-0.5">
                        Pilih kategori di panel kiri untuk meninjau rincian item, kuantitas terjual, dan kontribusi omsetnya.
                    </p>
                </div>

                {/* Master-Detail Layout */}
                <div className="flex flex-col lg:flex-row gap-5 items-start">
                    {/* LEFT PANEL: Category Selector List */}
                    <div className="w-full lg:w-[320px] xl:w-[360px] shrink-0 bg-stone-50/70 border border-stone-200 rounded-2xl p-3 sm:p-3.5 space-y-2">
                        <div className="flex items-center justify-between pb-2 border-b border-stone-200/80 px-1">
                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">
                                Kategori Klinik
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-600 shadow-2xs">
                                {categorySalesStats.length} Kategori
                            </span>
                        </div>

                        {/* Category Buttons List */}
                        <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
                            {/* Option: Summary / Top 1 per category */}
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedCategoryTab('all')
                                    setShowAllCategoryItems(false)
                                }}
                                className={`w-full text-left p-3 rounded-2xl transition-all cursor-pointer space-y-1.5 ${
                                    selectedCategoryTab === 'all'
                                        ? 'bg-white border-2 border-[#B5588A] shadow-sm text-gray-900'
                                        : 'bg-white/60 border border-stone-200/80 hover:bg-white text-gray-700'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${
                                            selectedCategoryTab === 'all' ? 'bg-[#B5588A]' : 'bg-stone-300'
                                        }`}></span>
                                        <span className="font-extrabold text-xs">
                                            Semua Kategori (Juara #1)
                                        </span>
                                    </div>
                                    <span className={`text-[10px] font-black px-1.5 py-0.2 rounded ${
                                        selectedCategoryTab === 'all'
                                            ? 'bg-pink-100 text-[#B5588A]'
                                            : 'bg-stone-100 text-stone-600'
                                    }`}>
                                        Ringkasan
                                    </span>
                                </div>
                                <p className="text-[10px] text-gray-500 font-semibold pl-4">
                                    Item terlaris nomor 1 dari setiap kategori
                                </p>
                            </button>

                            {/* Category Items */}
                            {categorySalesStats.map((cat, idx) => {
                                const isSelected = selectedCategoryTab === cat.category
                                const totalOmsetAll = categorySalesStats.reduce((sum, c) => sum + (c.sales || 0), 0)
                                const catShare = totalOmsetAll > 0 ? ((cat.sales / totalOmsetAll) * 100).toFixed(1) : 0

                                return (
                                    <button
                                        key={cat.category}
                                        type="button"
                                        onClick={() => {
                                            setSelectedCategoryTab(cat.category)
                                            setShowAllCategoryItems(false)
                                        }}
                                        className={`w-full text-left p-3 rounded-2xl transition-all cursor-pointer space-y-2 ${
                                            isSelected
                                                ? 'bg-white border-2 border-[#B5588A] shadow-sm text-gray-900'
                                                : 'bg-white/60 border border-stone-200/80 hover:bg-white text-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className={`w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center shrink-0 ${
                                                    isSelected 
                                                        ? 'bg-pink-100 text-[#B5588A]' 
                                                        : idx === 0 
                                                            ? 'bg-amber-100 text-amber-800' 
                                                            : 'bg-stone-100 text-stone-600'
                                                }`}>
                                                    #{idx + 1}
                                                </span>
                                                <span className="font-extrabold text-xs truncate">
                                                    {cat.category}
                                                </span>
                                            </div>
                                            <span className="font-extrabold text-xs text-[#B5588A] shrink-0">
                                                Rp {cat.sales.toLocaleString('id-ID')}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500">
                                            <span>{cat.volume} terjual</span>
                                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-stone-100 text-stone-700">
                                                {catShare}% omset
                                            </span>
                                        </div>

                                        {/* Mini Category Share Bar - Full width, clean */}
                                        <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                                            <div 
                                                className={`h-full rounded-full transition-all duration-300 ${
                                                    isSelected ? 'bg-gradient-to-r from-pink-400 to-[#B5588A]' : 'bg-stone-300'
                                                }`}
                                                style={{ width: `${Math.max(Number(catShare), 2)}%` }}
                                            ></div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Detailed Items View */}
                    <div className="flex-1 min-w-0 w-full bg-stone-50/40 border border-stone-200 rounded-2xl p-4 sm:p-5 space-y-4">
                        {/* CASE 1: Specific Category Selected */}
                        {selectedCategoryTab !== 'all' ? (() => {
                            const currentCat = categorySalesStats.find(c => c.category === selectedCategoryTab) || categorySalesStats[0]
                            if (!currentCat) return <p className="text-xs text-gray-400">Pilih kategori untuk melihat rincian.</p>

                            const topItems = currentCat.topItems || []
                            const totalSales = currentCat.sales || 0
                            const displayedItems = showAllCategoryItems ? topItems : topItems.slice(0, 8)

                            return (
                                <div className="space-y-4">
                                    {/* Header Detail */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h5 className="text-base sm:text-lg font-black text-gray-900">
                                                    {currentCat.category}
                                                </h5>
                                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-pink-100 text-[#B5588A] border border-pink-200">
                                                    {topItems.length} Layanan / Produk
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 font-semibold mt-0.5">
                                                Daftar urutan layanan dan produk terlaris berdasarkan kontribusi penjualan.
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="px-3 py-1.5 rounded-xl bg-white border border-stone-200 shadow-2xs">
                                                <p className="text-[10px] font-semibold text-gray-500">Total Terjual</p>
                                                <p className="text-xs font-black text-gray-900">{currentCat.volume} Item / Sesi</p>
                                            </div>
                                            <div className="px-3 py-1.5 rounded-xl bg-pink-50 border border-pink-200 shadow-2xs">
                                                <p className="text-[10px] font-semibold text-[#B5588A]">Total Omset</p>
                                                <p className="text-xs font-black text-[#B5588A]">Rp {totalSales.toLocaleString('id-ID')}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Items Grid (2 Columns, perfectly balanced & tidy typography) */}
                                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${showAllCategoryItems ? 'max-h-[500px] overflow-y-auto pr-1' : ''}`}>
                                        {displayedItems.map((item, idx) => {
                                            const itemPct = totalSales > 0 ? ((item.revenue / totalSales) * 100).toFixed(1) : 0
                                            const isTop1 = idx === 0
                                            const isTop2 = idx === 1
                                            const isTop3 = idx === 2
                                            const cleanName = (item.name || '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')

                                            return (
                                                <div 
                                                    key={item.name} 
                                                    className={`p-3.5 rounded-2xl transition-all space-y-2 ${
                                                        isTop1 
                                                            ? 'bg-gradient-to-br from-amber-50/70 via-white to-white border border-amber-300/80 shadow-2xs ring-1 ring-amber-200/50' 
                                                            : isTop2
                                                                ? 'bg-gradient-to-br from-pink-50/40 via-white to-white border border-pink-200 shadow-2xs'
                                                                : isTop3
                                                                    ? 'bg-gradient-to-br from-orange-50/30 via-white to-white border border-orange-200/80'
                                                                    : 'bg-white border border-stone-200 hover:border-stone-300 shadow-2xs'
                                                    }`}
                                                >
                                                    {/* Baris 1: Peringkat, Nama, dan Harga */}
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center shrink-0 ${
                                                                isTop1 
                                                                    ? 'bg-amber-100 text-amber-800 border border-amber-300/60' 
                                                                    : isTop2 
                                                                        ? 'bg-pink-100 text-[#B5588A] border border-pink-200' 
                                                                        : isTop3
                                                                            ? 'bg-orange-100 text-orange-800 border border-orange-200'
                                                                            : 'bg-stone-100 text-stone-600 border border-stone-200'
                                                            }`}>
                                                                #{idx + 1}
                                                            </span>
                                                            <p className="font-extrabold text-xs text-gray-900 truncate leading-snug" title={cleanName}>
                                                                {cleanName}
                                                            </p>
                                                        </div>
                                                        <span className="font-black text-xs text-gray-900 tracking-tight shrink-0">
                                                            Rp {item.revenue.toLocaleString('id-ID')}
                                                        </span>
                                                    </div>

                                                    {/* Baris 2: Terjual & Porsi Kontribusi */}
                                                    <div className="flex items-center justify-between text-[11px] font-semibold pt-0.5">
                                                        <span className="text-gray-500 flex items-center gap-1">
                                                            <span className="font-extrabold text-gray-800">{item.count}</span>
                                                            <span>terjual</span>
                                                        </span>
                                                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                                                            isTop1 
                                                                ? 'bg-amber-100/70 text-amber-800 border border-amber-200/80' 
                                                                : isTop2 
                                                                    ? 'bg-pink-100/70 text-[#B5588A] border border-pink-200/80' 
                                                                    : 'bg-stone-100 text-stone-600 border border-stone-200/70'
                                                        }`}>
                                                            {itemPct}% porsi
                                                        </span>
                                                    </div>

                                                    {/* Baris 3: Progress Bar */}
                                                    <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                                                        <div 
                                                            className={`h-full rounded-full transition-all duration-500 ${
                                                                isTop1 
                                                                    ? 'bg-gradient-to-r from-amber-400 to-[#B5588A]' 
                                                                    : isTop2 
                                                                        ? 'bg-gradient-to-r from-pink-400 to-[#B5588A]'
                                                                        : 'bg-gradient-to-r from-stone-300 to-[#B5588A]'
                                                            }`}
                                                            style={{ width: `${Math.max(Number(itemPct), 2)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* Expand / Collapse Button if more than 8 items */}
                                    {topItems.length > 8 && (
                                        <div className="pt-2 text-center">
                                            <button
                                                type="button"
                                                onClick={() => setShowAllCategoryItems(!showAllCategoryItems)}
                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 shadow-2xs hover:border-[#B5588A] hover:text-[#B5588A] transition-all cursor-pointer"
                                            >
                                                {showAllCategoryItems ? (
                                                    <>
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" /></svg>
                                                        <span>Ciutkan ke Top 8 Layanan</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                                        <span>Lihat Semua ({topItems.length} Layanan / Produk)</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })() : (
                            /* CASE 2: Summary View (Top 1 from Every Category) */
                            <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200">
                                    <div>
                                        <h5 className="text-base sm:text-lg font-black text-gray-900">
                                            Juara #1 Terlaris di Setiap Kategori
                                        </h5>
                                        <p className="text-xs text-gray-500 font-semibold mt-0.5">
                                            Produk dan layanan paling dominan dari masing-masing kategori klinik.
                                        </p>
                                    </div>
                                    <span className="text-[11px] font-bold text-gray-500 bg-white border border-stone-200 px-3 py-1 rounded-xl shadow-2xs">
                                        Pilih kategori di kiri untuk rincian lengkap
                                    </span>
                                </div>

                                {/* Summary Grid (2 Columns, clean) */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    {categorySalesStats.map((cat, idx) => {
                                        const top1 = cat.topItems && cat.topItems[0]
                                        if (!top1) return null
                                        const top1Pct = cat.sales > 0 ? ((top1.revenue / cat.sales) * 100).toFixed(1) : 0

                                        return (
                                            <div 
                                                key={cat.category}
                                                onClick={() => setSelectedCategoryTab(cat.category)}
                                                className="p-3.5 rounded-2xl bg-white border border-stone-200 hover:border-[#B5588A] hover:shadow-sm transition-all cursor-pointer space-y-2 group"
                                            >
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="font-extrabold text-stone-700 group-hover:text-[#B5588A] transition-colors">
                                                        {cat.category}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-gray-500">
                                                        Total: Rp {cat.sales.toLocaleString('id-ID')}
                                                    </span>
                                                </div>

                                                <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="w-4 h-4 rounded-md bg-amber-100 text-amber-800 text-[9px] font-black flex items-center justify-center shrink-0">
                                                                #1
                                                            </span>
                                                            <p className="font-extrabold text-xs text-gray-900 truncate" title={top1.name}>
                                                                {(top1.name || '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')}
                                                            </p>
                                                        </div>
                                                        <p className="text-[10px] font-semibold text-gray-500 pl-5.5 mt-0.5">
                                                            {top1.count} terjual • {top1Pct}% porsi omset
                                                        </p>
                                                    </div>
                                                    <span className="font-black text-xs text-[#B5588A] shrink-0">
                                                        Rp {top1.revenue.toLocaleString('id-ID')}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    ) : null}
</div>
    )
}
