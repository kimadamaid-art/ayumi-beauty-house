'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function GlobalSidebar({ isOpen, onClose }) {
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const [dbUser, setDbUser] = useState(null)
    const [settingsOpen, setSettingsOpen] = useState(false)

    useEffect(() => {
        fetchUser()
    }, [])

    async function fetchUser() {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (data) {
                setDbUser(data)
            } else {
                setDbUser({ role: 'unauthorized' }) // fallback aman
            }
        }
    }

    const isActive = (path) => pathname === path || pathname.startsWith(`${path}/`)
    const isSettingsActive = pathname.startsWith('/settings')

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity"
                    onClick={onClose}
                />
            )}
            
            <aside className={`w-64 bg-gradient-to-b from-ayumi-secondary to-ayumi-primary shadow-lg fixed top-0 left-0 h-full z-40 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
            <div className="p-6 border-b border-white/10 flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md shrink-0">
                    <span className="font-extrabold text-2xl text-ayumi-primary font-sans tracking-tighter">ab</span>
                </div>
                <div>
                    <h1 className="font-extrabold text-white tracking-wide text-lg leading-tight">Ayumi</h1>
                    <p className="text-[10px] text-white/80 uppercase tracking-widest font-semibold mt-0.5">Beauty House</p>
                </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2 mt-4 px-3">Menu Utama</div>
                
                {dbUser && dbUser.role !== 'therapist' ? (
                    <>
                        <Link href="/dashboard" onClick={onClose}>
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/dashboard') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                                Dashboard
                            </div>
                        </Link>
                        

                        <Link href="/patients" onClick={onClose}>
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/patients') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                Data Pasien
                            </div>
                        </Link>

                        <Link href="/appointments" onClick={onClose}>
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/appointments') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                Appointments
                            </div>
                        </Link>

                        <Link href="/treatment-records" onClick={onClose}>
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/treatment-records') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Treatment Records
                            </div>
                        </Link>

                        <Link href="/crm">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/crm') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                                CRM
                            </div>
                        </Link>

                        <Link href="/coupons">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/coupons') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>
                                Kupon Paket
                            </div>
                        </Link>

                        <Link href="/transactions">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/transactions') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Riwayat Transaksi
                            </div>
                        </Link>

                        <Link href="/kasir">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/kasir') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                                Kasir / POS
                            </div>
                        </Link>

                        <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2 mt-6 px-3">Laporan</div>

                        <Link href="/reports/treatments">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/reports/treatments') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                Laporan Treatment
                            </div>
                        </Link>

                        {dbUser && dbUser.role === 'owner' && (
                            <Link href="/reports/therapists">
                                <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/reports/therapists') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                    Laporan Terapis
                                </div>
                            </Link>
                        )}
                    </>
                ) : dbUser && dbUser.role === 'therapist' ? (
                    <>
                        <Link href="/therapist/dashboard">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/therapist/dashboard') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                                Dashboard Terapis
                            </div>
                        </Link>
                        
                        <Link href="/therapist/appointments">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/therapist/appointments') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                Jadwal Treatment
                            </div>
                        </Link>

                        <Link href="/therapist/history">
                            <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isActive('/therapist/history') ? 'bg-white text-ayumi-primary shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                Riwayat Treatment
                            </div>
                        </Link>
                    </>
                ) : null}

                {dbUser && dbUser.role !== 'therapist' && (
                    <>
                        <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2 mt-8 px-3">Administrasi</div>
                        
                        {/* Settings Accordion Header */}
                        <div 
                            onClick={() => setSettingsOpen(!settingsOpen)}
                            className={`flex items-center justify-between px-3 py-3 rounded-xl transition-all font-semibold cursor-pointer ${isSettingsActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                        >
                            <div className="flex items-center gap-3">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                Settings
                            </div>
                            <svg className={`w-4 h-4 transition-transform ${settingsOpen || isSettingsActive ? 'rotate-180 text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                        </div>

                        {/* Settings Submenu */}
                        {(settingsOpen || isSettingsActive) && (
                            <div className="pl-11 pr-3 py-2 space-y-2 border-l border-white/20 ml-5 mt-1">
                                {dbUser && dbUser.role === 'owner' && (
                                    <>
                                        <Link href="/settings/branches">
                                            <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/branches' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                                Manajemen Cabang
                                            </div>
                                        </Link>
                                        
                                        <Link href="/settings/users">
                                            <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/users' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                                Manajemen User
                                            </div>
                                        </Link>

                                        <Link href="/settings/treatment-categories">
                                            <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/treatment-categories' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                                Kategori Treatment
                                            </div>
                                        </Link>
                                        <Link href="/settings/treatments">
                                            <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/treatments' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                                Master Treatment
                                            </div>
                                        </Link>
                                        <Link href="/settings/products">
                                            <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/products' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                                Master Produk
                                            </div>
                                        </Link>
                                    </>
                                )}
                                <Link href="/settings/product-stock">
                                    <div className={`text-sm font-semibold py-1.5 transition-colors cursor-pointer ${pathname === '/settings/product-stock' ? 'text-white font-bold' : 'text-white/60 hover:text-white'}`}>
                                        Stok Produk
                                    </div>
                                </Link>
                            </div>
                        )}
                    </>
                )}
            </div>
        </aside>
        </>
    )
}
