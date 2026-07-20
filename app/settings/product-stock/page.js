'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProductStockPageRedirect() {
    const router = useRouter()

    useEffect(() => {
        router.replace('/settings/products')
    }, [router])

    return (
        <div className="p-8 text-center text-gray-500">
            Mengalihkan ke halaman Master & Stok Produk...
        </div>
    )
}
