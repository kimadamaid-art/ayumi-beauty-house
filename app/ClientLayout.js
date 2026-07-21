'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, Component } from 'react'
import GlobalSidebar from '@/components/GlobalSidebar'
import GlobalHeader from '@/components/GlobalHeader'

class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-6 md:p-10 bg-red-50/30 border border-red-100 rounded-3xl text-center space-y-4 shadow-sm my-4">
                    <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
                        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <h2 className="text-lg font-bold text-red-800">Gagal Memuat Halaman</h2>
                    <p className="text-sm text-red-600/80 max-w-md mx-auto">
                        Terjadi kesalahan saat memuat komponen halaman ini. Silakan coba muat ulang halaman atau hubungi administrator jika masalah berlanjut.
                    </p>
                    <button 
                        onClick={() => {
                            this.setState({ hasError: false, error: null })
                            window.location.reload()
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors cursor-pointer inline-flex items-center gap-2"
                    >
                        Muat Ulang Halaman
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}

const getPageMeta = (pathname) => {
    // Settings Sub-Pages (Match more specific first)
    if (pathname === '/settings/treatments') return { title: 'Layanan Treatment', subtitle: 'Kelola daftar layanan perawatan kecantikan yang tersedia.', backPath: '/settings' }
    if (pathname === '/settings/treatment-categories') return { title: 'Kategori Treatment', subtitle: 'Kelola kategori dan klasifikasi menu layanan treatment.', backPath: '/settings' }
    if (pathname === '/settings/branches') return { title: 'Cabang Klinik', subtitle: 'Kelola daftar cabang klinik fisik Ayumi Beauty House.', backPath: '/settings' }
    if (pathname === '/settings/users') return { title: 'Manajemen Pengguna', subtitle: 'Kelola akun staf, terapis, kasir, dan hak akses sistem.', backPath: '/settings' }
    if (pathname === '/settings/products') return { title: 'Master & Stok Produk', subtitle: 'Kelola catalog produk kecantikan dan stok inventaris di seluruh cabang.', backPath: '/settings' }
    if (pathname === '/settings/product-stock') return { title: 'Stok Produk', subtitle: 'Kelola dan pantau kuantitas stok produk di masing-masing cabang.', backPath: '/settings' }
    if (pathname === '/settings') return { title: 'Pengaturan Sistem', subtitle: 'Konfigurasi parameter sistem, manajemen data master, dan otorisasi.', backPath: '/dashboard' }

    // Coupon Package Sub-Pages
    if (pathname === '/coupons/packages/new') return { title: 'Tambah Paket Kupon Baru', subtitle: 'Buat paket kupon baru beserta sesi treatment di dalamnya.', backPath: '/coupons' }
    if (pathname.match(/^\/coupons\/packages\/[^/]+$/)) return { title: 'Edit Paket Kupon', subtitle: 'Ubah detail sesi dan harga paket kupon.', backPath: '/coupons' }

    // Therapist Sub-Pages
    if (pathname === '/therapist/dashboard') return { title: 'Dashboard Terapis', subtitle: 'Pantau jadwal dan performa treatment Anda.' }
    if (pathname === '/therapist/appointments') return { title: 'Jadwal & Riwayat Treatment', subtitle: 'Daftar janji temu dan catatan riwayat treatment pasien dalam satu tempat.', backPath: '/therapist/dashboard' }
    if (pathname === '/therapist/history') return { title: 'Riwayat Treatment', subtitle: 'Catatan seluruh treatment yang telah Anda selesaikan.', backPath: '/therapist/dashboard' }
    if (pathname.startsWith('/therapist/treatment-input/')) return { title: 'Input Treatment & SOAP', subtitle: 'Masukkan detail tindakan treatment dan catatan SOAP pasien.', backPath: '/therapist/dashboard' }

    // Patients Sub-Pages
    if (pathname === '/patients/new') return { title: 'Tambah Pasien Baru', subtitle: 'Daftarkan pasien baru ke dalam sistem Ayumi Beauty House.', backPath: '/patients' }
    if (pathname.match(/^\/patients\/[^/]+\/edit$/)) {
        const match = pathname.match(/^\/patients\/([^/]+)\/edit$/)
        return { title: 'Edit Data Pasien', subtitle: 'Ubah informasi profil dan data demografis pasien.', backPath: `/patients/${match[1]}` }
    }
    if (pathname.match(/^\/patients\/[^/]+$/)) return { title: 'Detail Pasien', subtitle: 'Informasi lengkap pasien, rekam medis, dan kupon yang dimiliki.', backPath: '/patients' }
    if (pathname.startsWith('/patients')) return { title: 'Manajemen Pasien', subtitle: 'Kelola data demografis dan status CRM seluruh pasien.' }

    // Leads Sub-Pages
    if (pathname === '/leads/new') return { title: 'Tambah Lead Baru', subtitle: 'Daftarkan prospek/calon pasien baru ke dalam sistem.', backPath: '/leads' }
    if (pathname.match(/^\/leads\/[^/]+$/)) return { title: 'Detail Lead', subtitle: 'Informasi prospek, riwayat interaksi, dan status konversi.', backPath: '/leads' }
    if (pathname.startsWith('/leads')) return { title: 'Manajemen Leads', subtitle: 'Kelola data prospek pasien baru dan status konversi.' }

    // Appointment Sub-Pages
    if (pathname === '/appointments/new') return { title: 'Buat Janji Temu', subtitle: 'Buat jadwal kunjungan atau treatment baru untuk pasien.', backPath: '/appointments' }
    if (pathname.match(/^\/appointments\/[^/]+\/edit$/)) {
        const match = pathname.match(/^\/appointments\/([^/]+)\/edit$/)
        return { title: 'Edit Janji Temu', subtitle: 'Ubah tanggal, waktu, atau detail janji temu pasien.', backPath: `/appointments/${match[1]}` }
    }
    if (pathname.match(/^\/appointments\/[^/]+$/)) return { title: 'Detail Janji Temu', subtitle: 'Informasi lengkap janji temu dan status kedatangan.', backPath: '/appointments' }
    if (pathname.startsWith('/appointments')) return { title: 'Kalender & Janji Temu', subtitle: 'Kelola reservasi dan jadwal kedatangan pasien klinik secara terpusat.' }

    // Treatment Records Sub-Pages
    if (pathname === '/treatment-records/new') return { title: 'Tambah Rekam Medis', subtitle: 'Catat rekam medis baru setelah sesi treatment selesai.', backPath: '/treatment-records' }
    if (pathname.match(/^\/treatment-records\/[^/]+\/edit$/)) {
        const match = pathname.match(/^\/treatment-records\/([^/]+)\/edit$/)
        return { title: 'Edit Rekam Medis', subtitle: 'Ubah data rekam medis, tindakan, atau catatan SOAP.', backPath: `/treatment-records/${match[1]}` }
    }
    if (pathname.match(/^\/treatment-records\/[^/]+$/)) return { title: 'Detail Rekam Medis', subtitle: 'Riwayat rekam medis, tindakan treatment, dan keluhan SOAP.', backPath: '/treatment-records' }
    if (pathname.startsWith('/treatment-records')) return { title: 'Rekam Medis', subtitle: 'Kelola riwayat rekam medis, keluhan SOAP, dan riwayat treatment pasien.' }

    // Transactions and Reports
    if (pathname.startsWith('/kasir/transactions/')) return { title: 'Detail Transaksi Pembayaran', subtitle: 'Struk bukti transaksi pembayaran layanan dan produk.', backPath: '/transactions' }
    if (pathname.startsWith('/transactions')) return { title: 'Riwayat Transaksi & Laporan', subtitle: 'Pantau catatan transaksi penjualan, pencetakan struk, dan laporan berkala.' }
    if (pathname.startsWith('/reports/therapists/')) return { title: 'Laporan Analisa Per Terapis', subtitle: 'Analisis performa, sesi treatment, dan kontribusi omset per terapis.', backPath: '/transactions' }
    if (pathname.startsWith('/reports/treatments/')) return { title: 'Laporan Analitik Treatment', subtitle: 'Analisis menu treatment terlaris dan kontribusi omset per layanan.', backPath: '/transactions' }

    // Main layouts
    if (pathname === '/dashboard') return { title: 'Dashboard Overview', subtitle: 'Pantau metrik utama klinik Anda secara real-time.' }
    if (pathname === '/crm') return { title: 'Customer Relationship (CRM)', subtitle: 'Kelola follow-up, retensi pasien, pengingat ulang tahun, dan pasien dormant.' }
    if (pathname === '/coupons') return { title: 'Dashboard Kupon Paket', subtitle: 'Kelola master paket, riwayat kupon pasien, dan klaim sesi perawatan.' }
    if (pathname === '/kasir') return { title: 'Kasir & Pembayaran', subtitle: 'Proses pembayaran treatment, pembelian produk, atau pembelian paket kupon.' }

    return null
}

export default function ClientLayout({ children }) {
    const pathname = usePathname()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const isLogin = pathname === '/login' || pathname === '/' // Assuming / redirects to login or is public

    if (isLogin) {
        return <>{children}</>
    }

    const pageMeta = getPageMeta(pathname)

    return (
        <div className="flex min-h-screen bg-ayumi-bg">
            <GlobalSidebar isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
            <div className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
                <GlobalHeader onMenuToggle={() => setIsMobileMenuOpen(true)} />
                <main className="flex-1 overflow-y-auto relative bg-ayumi-bg">
                    <div className="px-4 md:px-8 py-4 md:py-8 space-y-6">
                        {pageMeta && (
                            <div className="flex items-center gap-4 print-hide no-print">
                                {pageMeta.backPath && (
                                    <Link href={pageMeta.backPath}>
                                        <button className="text-ayumi-secondary hover:text-ayumi-primary bg-white p-2.5 rounded-full shadow-sm transition-all border border-pink-100/50 flex items-center justify-center cursor-pointer">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                            </svg>
                                        </button>
                                    </Link>
                                )}
                                <div className="border-l-4 border-ayumi-primary pl-4 py-1">
                                    <h1 className="text-2xl font-bold text-gray-800 leading-tight">{pageMeta.title}</h1>
                                    {pageMeta.subtitle && (
                                        <p className="text-sm text-gray-500 mt-1 font-medium">{pageMeta.subtitle}</p>
                                    )}
                                </div>
                            </div>
                        )}
                        <ErrorBoundary key={pathname}>
                            {children}
                        </ErrorBoundary>
                    </div>
                </main>
            </div>
        </div>
    )
}
