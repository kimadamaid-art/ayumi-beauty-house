'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function SettingsDashboard() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [dbUser, setDbUser] = useState(null)

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                const { data } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
                if (data) setDbUser(data)
                else setDbUser({ role: 'owner' }) // fallback
            }
        }
        fetchUser()
    }, [supabase])

    return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                
                {dbUser?.role === 'owner' && (
                    <>
                        {/* Menu: Branches */}
                        <Link href="/settings/branches">
                            <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer group h-full bg-white">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-blue-600 transition-colors">Manajemen Cabang</h3>
                                <p className="text-sm text-gray-500">Kelola daftar cabang klinik, alamat, dan status operasional.</p>
                            </div>
                        </Link>

                        {/* Menu: Users */}
                        <Link href="/settings/users">
                            <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-green-300 hover:bg-green-50 transition-all cursor-pointer group h-full bg-white">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-green-600 transition-colors">Manajemen User</h3>
                                <p className="text-sm text-gray-500">Kelola akses akun staf, terapis, dokter, dan penempatan cabang.</p>
                            </div>
                        </Link>

                        {/* Menu: Treatment Categories */}
                        <Link href="/settings/treatment-categories">
                            <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-pink-300 hover:bg-pink-50 transition-all cursor-pointer group h-full bg-white">
                                <div className="w-12 h-12 bg-pink-100 text-ayumi-primary rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-ayumi-primary transition-colors">Kategori Treatment</h3>
                                <p className="text-sm text-gray-500">Kelola pengelompokan jenis layanan seperti Facial, Injeksi, Peeling, dll.</p>
                            </div>
                        </Link>

                        {/* Menu: Treatments */}
                        <Link href="/settings/treatments">
                            <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-purple-300 hover:bg-purple-50 transition-all cursor-pointer group h-full bg-white">
                                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-purple-600 transition-colors">Daftar Treatment</h3>
                                <p className="text-sm text-gray-500">Kelola harga, durasi, dan prosedur dari masing-masing treatment klinik.</p>
                            </div>
                        </Link>

                        {/* Menu: Products */}
                        <Link href="/settings/products">
                            <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-orange-300 hover:bg-orange-50 transition-all cursor-pointer group h-full bg-white">
                                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-orange-600 transition-colors">Master Produk</h3>
                                <p className="text-sm text-gray-500">Kelola daftar produk skincare, nama, dan harga jual standar.</p>
                            </div>
                        </Link>
                    </>
                )}

                {/* Menu: Product Stock */}
                <Link href="/settings/product-stock">
                    <div className="p-6 border-2 border-gray-100 rounded-2xl hover:border-teal-300 hover:bg-teal-50 transition-all cursor-pointer group h-full bg-white">
                        <div className="w-12 h-12 bg-teal-100 text-teal-600 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        </div>
                        <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-teal-600 transition-colors">Stok Produk</h3>
                        <p className="text-sm text-gray-500">Kelola inventaris dan jumlah stok produk di masing-masing cabang.</p>
                    </div>
                </Link>

            </div>
    )
}
