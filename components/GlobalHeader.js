'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'react-hot-toast'

export default function GlobalHeader({ onMenuToggle }) {
    const pathname = usePathname()
    const router = useRouter()
    const [user, setUser] = useState(null)
    const [dbUser, setDbUser] = useState(null)
    
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)

    useEffect(() => {
        let isMounted = true
        const fetchUser = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!isMounted) return
                if (user) {
                    setUser(user)
                    const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
                    if (!isMounted) return
                    if (userData) {
                        setDbUser(userData)
                    } else {
                        setDbUser({ role: 'owner', full_name: user.email })
                    }
                }
            } catch (err) {
                console.error('Error fetching user profile in header:', err)
            }
        }
        fetchUser()
        return () => { isMounted = false }
    }, [])

    const fetchNotifications = async (userId) => {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('recipient_id', userId)
            .order('created_at', { ascending: false })
            .limit(10)
        
        if (data) {
            setNotifications(data)
        }
    }

    const fetchUnreadCount = async (userId) => {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('recipient_id', userId)
            .eq('is_read', false)
        if (count !== null) setUnreadCount(count)
    }

    const playNotificationSound = () => {
        // Hanya berbunyi untuk role admin dan therapist sesuai permintaan
        const role = dbUser?.role
        if (role !== 'admin' && role !== 'therapist') {
            return
        }

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext
            if (!AudioContext) return
            const audioCtx = new AudioContext()

            const now = audioCtx.currentTime

            // Nada 1: D5 (587.33 Hz) - warm bell chime
            const osc1 = audioCtx.createOscillator()
            const gain1 = audioCtx.createGain()
            osc1.type = 'sine'
            osc1.frequency.setValueAtTime(587.33, now)
            gain1.gain.setValueAtTime(0, now)
            gain1.gain.linearRampToValueAtTime(0.2, now + 0.03)
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
            osc1.connect(gain1)
            gain1.connect(audioCtx.destination)
            osc1.start(now)
            osc1.stop(now + 0.28)

            // Nada 2: A5 (880 Hz) - bright ringing chime
            const osc2 = audioCtx.createOscillator()
            const gain2 = audioCtx.createGain()
            osc2.type = 'sine'
            osc2.frequency.setValueAtTime(880, now + 0.12)
            gain2.gain.setValueAtTime(0, now + 0.12)
            gain2.gain.linearRampToValueAtTime(0.25, now + 0.16)
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
            osc2.connect(gain2)
            gain2.connect(audioCtx.destination)
            osc2.start(now + 0.12)
            osc2.stop(now + 0.55)
        } catch (e) {
            console.warn('Failed to play audio notification', e)
        }
    }

    useEffect(() => {
        if (!user) return

        fetchNotifications(user.id)
        fetchUnreadCount(user.id)

        // Subscribe to notifications changes
        const channel = supabase
            .channel(`notifications-user-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'notifications',
                    filter: `recipient_id=eq.${user.id}`
                },
                (payload) => {
                    fetchNotifications(user.id)
                    fetchUnreadCount(user.id)
                    if (payload.eventType === 'INSERT') {
                        playNotificationSound()
                        const newNotif = payload.new
                        if (newNotif) {
                            // Show beautiful visual toast notification
                            toast((t) => (
                                <div 
                                    className="flex flex-col gap-1.5 cursor-pointer text-left w-full"
                                    onClick={() => {
                                        toast.dismiss(t.id)
                                        handleMarkAsRead(newNotif.id, newNotif.appointment_id, newNotif.type)
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                                        </span>
                                        <span className="font-extrabold text-sm text-ayumi-secondary">{newNotif.title}</span>
                                    </div>
                                    <div className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                                        {newNotif.message}
                                    </div>
                                    <div className="text-[10px] font-bold text-ayumi-primary hover:underline flex items-center gap-1 mt-1">
                                        {newNotif.type === 'treatment_completed' ? 'Klik untuk proses pembayaran di Kasir' : 'Klik untuk melihat detail'}
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </div>
                            ), {
                                duration: 8000,
                                position: 'top-right',
                                style: {
                                    borderRadius: '1rem',
                                    border: '1px solid #fbcfe8',
                                    padding: '12px 16px',
                                    background: '#ffffff',
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                                    maxWidth: '350px'
                                }
                            })
                        }
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user, dbUser])

    const handleToggleDropdown = () => {
        const nextState = !isDropdownOpen
        setIsDropdownOpen(nextState)
        // Otomatis bersihkan badge merah saat lonceng dibuka
        if (nextState && unreadCount > 0 && user) {
            setUnreadCount(0)
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
            supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('recipient_id', user.id)
                .eq('is_read', false)
                .then(() => {
                    fetchNotifications(user.id)
                })
        }
    }

    const handleMarkAsRead = async (id, appointmentId, type) => {
        // Optimistic UI Update
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
        setUnreadCount(prev => Math.max(0, prev - 1))
        setIsDropdownOpen(false)

        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)

        if (appointmentId) {
            if (dbUser?.role === 'therapist') {
                if (type === 'patient_arrived') {
                    router.push(`/therapist/treatment-input/${appointmentId}`)
                } else {
                    router.push('/therapist/dashboard')
                }
            } else if (type === 'treatment_completed') {
                router.push(`/kasir?appointmentId=${appointmentId}`)
            } else {
                router.push('/appointments')
            }
        }
    }

    const handleDismissNotification = async (e, id) => {
        e.stopPropagation()
        setNotifications(prev => prev.filter(n => n.id !== id))
        setUnreadCount(prev => Math.max(0, prev - 1))
        await supabase.from('notifications').delete().eq('id', id)
    }

    const handleClearAllNotifications = async () => {
        if (!user) return
        setNotifications([])
        setUnreadCount(0)
        await supabase.from('notifications').delete().eq('recipient_id', user.id)
        toast.success('Daftar notifikasi berhasil dibersihkan.')
    }

    const handleMarkAllAsRead = async () => {
        if (!user) return
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
        setUnreadCount(0)
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('recipient_id', user.id)
            .eq('is_read', false)
        if (!error) {
            toast.success('Semua notifikasi ditandai sudah dibaca.')
            fetchNotifications(user.id)
            fetchUnreadCount(user.id)
        }
    }

    const formatTimeAgo = (dateStr) => {
        const date = new Date(dateStr)
        const seconds = Math.floor((new Date() - date) / 1000)

        if (seconds < 60) return 'Baru saja'
        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) return `${minutes} menit lalu`
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return `${hours} jam lalu`
        const days = Math.floor(hours / 24)
        return `${days} hari lalu`
    }

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    // Determine Page Title
    const getPageTitle = () => {
        if (pathname.startsWith('/dashboard')) return 'Dashboard Overview'
        if (pathname.startsWith('/patients/new')) return 'Tambah Pasien Baru'
        if (pathname.match(/^\/patients\/[^/]+$/)) return 'Detail Pasien'
        if (pathname.startsWith('/patients')) return 'Manajemen Pasien'
        if (pathname.startsWith('/appointments/new')) return 'Buat Jadwal Janji Temu'
        if (pathname.startsWith('/appointments')) return 'Jadwal Janji Temu Pasien'
        if (pathname.startsWith('/treatment-records/new')) return 'Buat Rekam Medis'
        if (pathname.startsWith('/treatment-records')) return 'Rekam Medis & Riwayat'
        if (pathname.startsWith('/kasir/history')) return 'Riwayat Transaksi Kasir'
        if (pathname.startsWith('/kasir')) return 'Kasir & POS Penjualan'
        if (pathname.startsWith('/transactions')) return 'Laporan Transaksi'
        if (pathname.startsWith('/crm')) return 'Customer Relationship (CRM)'
        if (pathname.startsWith('/coupons')) return 'Kupon & Loyalty'
        if (pathname.startsWith('/reports/therapists')) return 'Laporan Komisi Terapis'
        if (pathname.startsWith('/reports/treatments')) return 'Laporan Treatment'
        if (pathname.startsWith('/reports')) return 'Laporan & Analitik'
        if (pathname.startsWith('/settings/branches')) return 'Manajemen Cabang'
        if (pathname.startsWith('/settings/users')) return 'Manajemen Karyawan'
        if (pathname.startsWith('/settings/treatments')) return 'Master Layanan'
        if (pathname.startsWith('/settings/products')) return 'Master Produk'
        if (pathname.startsWith('/settings/product-stock')) return 'Stok Produk Cabang'
        if (pathname.startsWith('/settings/backup')) return 'Backup & Keamanan Data'
        if (pathname.startsWith('/settings')) return 'Pengaturan Sistem'
        if (pathname.startsWith('/therapist/dashboard')) return 'Dashboard Terapis'
        if (pathname.startsWith('/therapist/appointments')) return 'Riwayat & Komisi Terapis'
        return 'Ayumi Beauty House'
    }

    return (
        <header className="bg-white border-b border-gray-100 h-16 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
            <div className="flex items-center gap-3">
                <button 
                    onClick={onMenuToggle}
                    className="md:hidden text-gray-500 hover:text-ayumi-primary p-2 rounded-xl bg-gray-50 hover:bg-pink-50 transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>

                <h2 className="text-lg md:text-xl font-extrabold text-ayumi-primary tracking-tight">Ayumi Beauty House</h2>
            </div>
            
            <div className="flex items-center gap-3 md:gap-6">
                {/* Lonceng Notifikasi */}
                {user && (
                    <div className="relative">
                        <button 
                            onClick={handleToggleDropdown}
                            className="text-gray-500 hover:text-ayumi-primary p-2.5 rounded-xl bg-gray-50 hover:bg-pink-50 transition-all border border-gray-100 flex items-center justify-center relative cursor-pointer"
                            title="Notifikasi Sistem"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                            {unreadCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold w-5 h-5 flex items-center justify-center rounded-full animate-bounce">
                                    {unreadCount}
                                </span>
                            )}
                        </button>
                        
                        {isDropdownOpen && (
                            <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-fade-in-up">
                                <div className="p-3.5 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
                                    <div className="flex items-center gap-1.5">
                                        <h4 className="font-extrabold text-xs text-gray-800 uppercase tracking-wider">Notifikasi</h4>
                                        {notifications.length > 0 && (
                                            <span className="text-[10px] bg-pink-100 text-pink-700 font-black px-1.5 py-0.2 rounded-full">
                                                {notifications.length}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {notifications.some(n => !n.is_read) && (
                                            <button 
                                                onClick={handleMarkAllAsRead}
                                                className="text-[10.5px] font-bold text-ayumi-primary hover:underline transition-colors cursor-pointer"
                                            >
                                                Tandai Dibaca
                                            </button>
                                        )}
                                        {notifications.length > 0 && (
                                            <button 
                                                onClick={handleClearAllNotifications}
                                                className="text-[10.5px] font-bold text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                                                title="Hapus semua riwayat notifikasi"
                                            >
                                                Bersihkan
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center text-xs text-gray-400 italic">
                                            <span>✨ Tidak ada notifikasi baru.</span>
                                        </div>
                                    ) : (
                                        notifications.map(n => {
                                            const timeAgo = formatTimeAgo(n.created_at)
                                            return (
                                                <div 
                                                    key={n.id}
                                                    onClick={() => handleMarkAsRead(n.id, n.appointment_id, n.type)}
                                                    className={`p-3.5 cursor-pointer hover:bg-gray-50 transition-colors flex gap-2.5 text-left group relative ${!n.is_read ? 'bg-pink-50/50' : ''}`}
                                                >
                                                    <div className="shrink-0 mt-0.5">
                                                        {n.type === 'patient_arrived' ? (
                                                            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs shadow-2xs">
                                                                🙋‍♀️
                                                            </div>
                                                        ) : n.type === 'therapist_ready' ? (
                                                            <div className="w-8 h-8 rounded-xl bg-green-100 text-green-600 flex items-center justify-center font-bold text-xs shadow-2xs">
                                                                💆‍♀️
                                                            </div>
                                                        ) : n.type === 'treatment_completed' ? (
                                                            <div className="w-8 h-8 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center font-bold text-xs shadow-2xs">
                                                                🧾
                                                            </div>
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center font-bold text-xs shadow-2xs">
                                                                🔔
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs font-black text-gray-900 truncate">{n.title}</span>
                                                            {!n.is_read && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0"></span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-gray-600 mt-0.5 line-clamp-2 leading-tight">{n.message}</p>
                                                        <span className="text-[9.5px] text-gray-400 mt-1 block font-semibold">{timeAgo}</span>
                                                    </div>

                                                    {/* Tombol Hapus / Dismiss Per Notifikasi */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleDismissNotification(e, n.id)}
                                                        className="absolute right-2.5 top-3 text-gray-300 hover:text-red-500 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                                        title="Hapus notifikasi ini"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="hidden sm:block text-right">
                    <p className="text-sm font-bold text-ayumi-secondary">{dbUser?.full_name || user?.email || 'Loading...'}</p>
                    <p className="text-xs text-ayumi-primary font-semibold uppercase tracking-wider">{dbUser?.role || 'Admin'}</p>
                </div>
                
                <button 
                    onClick={handleLogout}
                    className="text-sm bg-red-50 hover:bg-red-100 text-red-600 p-2.5 rounded-xl font-bold transition-all border border-red-100 flex items-center justify-center"
                    title="Keluar"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                </button>
            </div>
        </header>
    )
}

