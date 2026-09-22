'use client'

import dynamic from 'next/dynamic'

// recharts dimuat sebagai potongan terpisah, setelah halaman tampil, sehingga tidak ikut
// membebani JavaScript awal halaman yang memakainya.
const RechartsRenderer = dynamic(() => import('./RechartsRenderer'), {
    ssr: false,
    // Mengisi penuh wadah grafik (yang tingginya sudah tetap), jadi tata letak halaman
    // tidak bergeser ketika grafik aslinya muncul.
    loading: () => (
        <div className="w-full h-full rounded-xl bg-gray-100/70 animate-pulse" aria-hidden="true" />
    )
})

/**
 * Pemakaian:
 *   <LazyRecharts render={(R) => (
 *       <R.ResponsiveContainer width="100%" height="100%">
 *           <R.BarChart data={data}>...</R.BarChart>
 *       </R.ResponsiveContainer>
 *   )} />
 */
export default function LazyRecharts({ render }) {
    return <RechartsRenderer render={render} />
}
