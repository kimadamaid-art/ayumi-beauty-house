'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import GlobalSidebar from '@/components/GlobalSidebar'
import GlobalHeader from '@/components/GlobalHeader'

const getPageMeta = (pathname) => {
    // Settings Sub-Pages (Match more specific first)
    if (pathname === '/settings/treatments') return { title: 'Layanan Treatment', subtitle: 'Kelola daftar layanan perawatan kecantikan yang tersedia.', backPath: '/settings' }
    if (pathname === '/settings/treatment-categories') return { title: 'Kategori Treatment', subtitle: 'Kelola kategori dan klasifikasi menu layanan treatment.', backPath: '/settings' }
    if (pathname === '/settings/branches') return { title: 'Cabang Klinik', subtitle: 'Kelola daftar cabang klinik fisik Ayumi Beauty House.', backPath: '/settings' }
    if (pathname === '/settings/users') return { title: 'Manajemen Pengguna', subtitle: 'Kelola akun staf, terapis, kasir, dan hak akses sistem.', backPath: '/settings' }
    if (pathname === '/settings/products') return { title: 'Daftar Produk', subtitle: 'Kelola master data produk kecantikan yang dijual di klinik.', backPath: '/settings' }
    if (pathname === '/settings/product-stock') return { title: 'Stok Produk', subtitle: 'Kelola dan pantau kuantitas stok produk di masing-masing cabang.', backPath: '/settings' }
    if (pathname === '/settings') return { title: 'Pengaturan Sistem', subtitle: 'Konfigurasi parameter sistem, manajemen data master, dan otorisasi.', backPath: '/dashboard' }

    // Coupon Package Sub-Pages
    if (pathname === '/coupons/packages/new') return { title: 'Tambah Paket Kupon Baru', subtitle: 'Buat paket kupon baru beserta sesi treatment di dalamnya.', backPath: '/coupons' }
    if (pathname.match(/^\/coupons\/packages\/[^/]+$/)) return { title: 'Edit Paket Kupon', subtitle: 'Ubah detail sesi dan harga paket kupon.', backPath: '/coupons' }

    // Therapist Sub-Pages
    if (pathname === '/therapist/dashboard') return { title: 'Dashboard Terapis', subtitle: 'Pantau jadwal dan performa treatment Anda.' }
    if (pathname === '/therapist/appointments') return { title: 'Jadwal Treatment Anda', subtitle: 'Daftar janji temu pasien yang ditugaskan kepada Anda hari ini.', backPath: '/therapist/dashboard' }
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
    if (pathname === '/crm') return { title: 'Customer Relationship (CRM)', subtitle: 'Kelola follow-up, retensi pasien, dan lihat performa klinik.' }
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
                    <div className="px-6 md:px-8 py-6 md:py-8 space-y-6">
                        {pageMeta && (
                            <div className="flex items-center gap-4">
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
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}
