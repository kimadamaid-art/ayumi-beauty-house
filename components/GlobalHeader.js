'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { toast } from 'react-hot-toast'

export default function GlobalHeader() {
    const pathname = usePathname()
    const router = useRouter()
    const [user, setUser] = useState(null)
    const [dbUser, setDbUser] = useState(null)
    
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                setUser(user)
                const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
                if (userData) {
                    setDbUser(userData)
                } else {
                    setDbUser({ role: 'owner', full_name: user.email })
                }
            }
        }
        fetchUser()
    }, [supabase])

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
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
            const oscillator = audioCtx.createOscillator()
            const gainNode = audioCtx.createGain()

            oscillator.connect(gainNode)
            gainNode.connect(audioCtx.destination)

            oscillator.type = 'sine'
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime)
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime)
            
            oscillator.start()
            oscillator.stop(audioCtx.currentTime + 0.15)
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
    }, [user])

    const handleMarkAsRead = async (id, appointmentId, type) => {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
        if (!error) {
            fetchNotifications(user.id)
            fetchUnreadCount(user.id)
            setIsDropdownOpen(false)
            if (appointmentId) {
                if (type === 'treatment_completed') {
                    router.push(`/kasir?appointmentId=${appointmentId}`)
                } else {
                    router.push(`/appointments/${appointmentId}`)
                }
            }
        }
    }

    const handleMarkAllAsRead = async () => {
        if (!user) return
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('recipient_id', user.id)
            .eq('is_read', false)
        if (!error) {
            toast.success('Semua notifikasi ditandai dibaca.')
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
        
        if (pathname.startsWith('/leads/new')) return 'Tambah Lead Baru'
        if (pathname.match(/^\/leads\/[^/]+$/)) return 'Detail Lead'
        if (pathname.startsWith('/leads')) return 'Manajemen Leads'

        if (pathname.startsWith('/appointments/new')) return 'Buat Janji Temu'
        if (pathname.startsWith('/appointments')) return 'Kalender & Jadwal'

        if (pathname.startsWith('/treatment-records/new')) return 'Tambah Rekam Medis'
        if (pathname.startsWith('/treatment-records')) return 'Rekam Medis'

        if (pathname.startsWith('/crm')) return 'Customer Relationship (CRM)'
        if (pathname.startsWith('/transactions')) return 'Riwayat Transaksi & Laporan'
        
        if (pathname.startsWith('/settings/treatments')) return 'Layanan Treatment'
        if (pathname.startsWith('/settings/treatment-categories')) return 'Kategori Treatment'
        if (pathname.startsWith('/settings/branches')) return 'Cabang Klinik'
        if (pathname.startsWith('/settings/users')) return 'Manajemen Pengguna'
        if (pathname.startsWith('/settings')) return 'Pengaturan Sistem'

        return 'Ayumi Beauty House'
    }

    return (
        <header className="bg-white border-b border-gray-100 shadow-sm px-8 py-4 flex justify-between items-center z-30 sticky top-0">
            <div>
                <h2 className="text-xl font-bold text-ayumi-secondary">{getPageTitle()}</h2>
            </div>
            
            <div className="flex items-center gap-6">
                {/* Lonceng Notifikasi */}
                {user && (
                    <div className="relative">
                        <button 
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className="text-gray-500 hover:text-ayumi-primary p-2.5 rounded-xl bg-gray-50 hover:bg-pink-50 transition-all border border-gray-100 flex items-center justify-center relative"
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
                            <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-fade-in-up">
                                <div className="p-4 border-b border-gray-50 flex justify-between items-center bg-gray-50">
                                    <h4 className="font-extrabold text-sm text-gray-800">Notifikasi</h4>
                                    {unreadCount > 0 && (
                                        <button 
                                            onClick={handleMarkAllAsRead}
                                            className="text-[10px] font-bold text-ayumi-primary hover:text-ayumi-secondary transition-colors"
                                        >
                                            Tandai Semua Dibaca
                                        </button>
                                    )}
                                </div>
                                
                                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                                    {notifications.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-gray-400">Tidak ada notifikasi.</div>
                                    ) : (
                                        notifications.map(n => {
                                            const timeAgo = formatTimeAgo(n.created_at)
                                            return (
                                                <div 
                                                    key={n.id}
                                                    onClick={() => handleMarkAsRead(n.id, n.appointment_id, n.type)}
                                                    className={`p-3.5 cursor-pointer hover:bg-gray-50 transition-colors flex gap-3 text-left ${!n.is_read ? 'bg-pink-50/40' : ''}`}
                                                >
                                                    <div className="shrink-0 mt-0.5">
                                                        {n.type === 'patient_arrived' ? (
                                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                            </div>
                                                        ) : n.type === 'therapist_ready' ? (
                                                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            </div>
                                                        ) : n.type === 'treatment_completed' ? (
                                                            <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                                                            </div>
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-bold text-gray-800 truncate">{n.title}</div>
                                                        <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{n.message}</div>
                                                        <div className="text-[9px] text-gray-400 mt-1 font-semibold">{timeAgo}</div>
                                                    </div>
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

