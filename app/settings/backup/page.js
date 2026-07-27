'use client'

import { useEffect, useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import Link from 'next/link'

export default function BackupRestorePage() {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    const router = useRouter()
    const fileInputRef = useRef(null)

    const [isOwner, setIsOwner] = useState(false)
    const [userLoaded, setUserLoaded] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)

    useEffect(() => {
        const checkAccess = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                router.push('/login')
                return
            }

            const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
            if (!userData || userData.role !== 'owner') {
                alert('Akses ditolak. Halaman ini khusus untuk Owner.')
                router.push('/dashboard')
                return
            }

            setIsOwner(true)
            setUserLoaded(true)
        }
        checkAccess()
    }, [supabase, router])

    const handleExportBackup = async () => {
        if (isProcessing) return
        setIsProcessing(true)
        const toastId = toast.loading('Menyiapkan berkas cadangan data (Full Backup)...')
        
        try {
            const [
                { data: patients, error: patErr },
                { data: treatmentRecords, error: trErr },
                { data: treatmentRecordItems, error: triErr },
                { data: transactions, error: txErr },
                { data: transactionItems, error: txiErr },
                { data: patientCoupons, error: pcErr },
                { data: patientCouponItems, error: pciErr },
                { data: couponUsageLogs, error: culErr }
            ] = await Promise.all([
                supabase.from('patients').select('*'),
                supabase.from('treatment_records').select('*'),
                supabase.from('treatment_record_items').select('*'),
                supabase.from('transactions').select('*'),
                supabase.from('transaction_items').select('*'),
                supabase.from('patient_coupons').select('*'),
                supabase.from('patient_coupon_items').select('*'),
                supabase.from('coupon_usage_logs').select('*')
            ])

            if (patErr) throw patErr
            if (trErr) throw trErr
            if (triErr) throw triErr
            if (txErr) throw txErr
            if (txiErr) throw txiErr
            if (pcErr) throw pcErr
            if (pciErr) throw pciErr
            if (culErr) throw culErr

            const backupData = {
                version: "1.0",
                exported_at: new Date().toISOString(),
                data: {
                    patients: patients || [],
                    treatment_records: treatmentRecords || [],
                    treatment_record_items: treatmentRecordItems || [],
                    transactions: transactions || [],
                    transaction_items: transactionItems || [],
                    patient_coupons: patientCoupons || [],
                    patient_coupon_items: patientCouponItems || [],
                    coupon_usage_logs: couponUsageLogs || []
                }
            }

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const dateStr = new Date().toISOString().split('T')[0]
            a.download = `Ayumi_Beauty_House_Full_Backup_${dateStr}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            toast.success('Pencadangan seluruh data klinik berhasil diselesaikan!', { id: toastId })
        } catch (err) {
            console.error('Error exporting backup:', err)
            toast.error('Gagal mengekspor data: ' + err.message, { id: toastId })
        } finally {
            setIsProcessing(false)
        }
    }

    const handleImportBackup = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return

        const confirmRestore = window.confirm(
            "PERINGATAN: Tindakan ini akan menimpa data yang ada jika terjadi kecocokan ID. Apakah Anda yakin ingin melanjutkan proses pemulihan data?"
        )
        if (!confirmRestore) {
            e.target.value = ''
            return
        }

        setIsProcessing(true)
        const reader = new FileReader()
        const toastId = toast.loading('Memvalidasi berkas cadangan...')
        
        reader.onload = async (event) => {
            try {
                const backup = JSON.parse(event.target.result)
                if (!backup.data || typeof backup.data !== 'object') {
                    throw new Error('Format berkas cadangan JSON tidak valid.')
                }

                const { 
                    patients, 
                    treatment_records, 
                    treatment_record_items, 
                    transactions, 
                    transaction_items,
                    patient_coupons,
                    patient_coupon_items,
                    coupon_usage_logs
                } = backup.data

                if (!patients || !treatment_records || !transactions) {
                    throw new Error('Berkas cadangan tidak lengkap (Pastikan memuat pasien, treatment, dan transaksi).')
                }

                // 1. Patients
                toast.loading('Memulihkan data Pasien...', { id: toastId })
                if (patients.length > 0) {
                    const { error } = await supabase.from('patients').upsert(patients)
                    if (error) throw error
                }

                // 2. Treatment Records
                toast.loading('Memulihkan rekam medis Treatment...', { id: toastId })
                if (treatment_records.length > 0) {
                    const { error } = await supabase.from('treatment_records').upsert(treatment_records)
                    if (error) throw error
                }

                // 3. Treatment Record Items
                if (treatment_record_items && treatment_record_items.length > 0) {
                    const { error } = await supabase.from('treatment_record_items').upsert(treatment_record_items)
                    if (error) throw error
                }

                // 4. Transactions
                toast.loading('Memulihkan data Transaksi...', { id: toastId })
                if (transactions.length > 0) {
                    const { error } = await supabase.from('transactions').upsert(transactions)
                    if (error) throw error
                }

                // 5. Transaction Items
                if (transaction_items && transaction_items.length > 0) {
                    const { error } = await supabase.from('transaction_items').upsert(transaction_items)
                    if (error) throw error
                }

                // 6. Patient Coupons
                toast.loading('Memulihkan Kupon Paket Pasien...', { id: toastId })
                if (patient_coupons && patient_coupons.length > 0) {
                    const { error } = await supabase.from('patient_coupons').upsert(patient_coupons)
                    if (error) throw error
                }

                // 7. Patient Coupon Items
                if (patient_coupon_items && patient_coupon_items.length > 0) {
                    const { error } = await supabase.from('patient_coupon_items').upsert(patient_coupon_items)
                    if (error) throw error
                }

                // 8. Coupon Usage Logs
                if (coupon_usage_logs && coupon_usage_logs.length > 0) {
                    const { error } = await supabase.from('coupon_usage_logs').upsert(coupon_usage_logs)
                    if (error) throw error
                }

                toast.success('Seluruh data klinik berhasil dipulihkan dari berkas cadangan!', { id: toastId })
            } catch (err) {
                console.error('Error importing backup:', err)
                toast.error('Gagal memulihkan berkas cadangan: ' + err.message, { id: toastId })
            } finally {
                setIsProcessing(false)
            }
        }

        reader.readAsText(file)
        e.target.value = ''
    }

    if (!userLoaded) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[40vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memeriksa Hak Akses...</p>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            {/* Navigation Back */}
            <div className="flex items-center gap-2">
                <Link href="/settings">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold transition-all">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        Kembali ke Pengaturan
                    </button>
                </Link>
            </div>

            {/* Header info */}
            <div className="bg-gradient-to-br from-amber-50 to-amber-100/30 border border-amber-100 rounded-3xl p-6 shadow-sm flex items-start gap-4">
                <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <div>
                    <h2 className="text-lg font-black text-gray-800">Pusat Backup & Pemulihan Data Klinik</h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        Gunakan halaman ini untuk mencadangkan (ekspor) seluruh database operasional Ayumi Beauty House secara berkala. Berkas backup yang diunduh berformat <strong className="text-amber-700">JSON</strong> dan dapat digunakan kapan saja untuk memulihkan (impor) data klinik jika terjadi kendala pada server.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Column 1: Ekspor */}
                <div className="card-ayumi p-6 flex flex-col justify-between h-full bg-white">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4a3 3 0 00-3-3m3 3a3 3 0 003-3m-3 3v-9" /></svg>
                            </div>
                            <h3 className="text-base font-bold text-gray-800">Ekspor File Cadangan (Full Backup)</h3>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed mb-6">
                            Sistem akan mengambil seluruh catatan data operasional klinik, di antaranya:
                        </p>
                        <ul className="space-y-2 text-xs text-gray-600 mb-8 list-disc pl-4">
                            <li>Daftar Pelanggan / Pasien</li>
                            <li>Catatan Tindakan Treatment (Medical Record)</li>
                            <li>Rincian Tindakan Terapis & Komisi</li>
                            <li>Seluruh Riwayat Transaksi Penjualan</li>
                            <li>Seluruh Detail Item Transaksi (Produk & Sesi)</li>
                        </ul>
                    </div>

                    <button
                        onClick={handleExportBackup}
                        disabled={isProcessing}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none text-white py-3.5 rounded-2xl text-xs font-extrabold tracking-wider transition-all shadow-md shadow-blue-500/10 active:scale-[0.99] flex justify-center items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        UNDUH BERKAS BACKUP
                    </button>
                </div>

                {/* Column 2: Impor */}
                <div className="card-ayumi p-6 flex flex-col justify-between h-full bg-white">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            </div>
                            <h3 className="text-base font-bold text-gray-800">Impor & Pulihkan Data Klinik</h3>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed mb-6">
                            Pulihkan database klinik menggunakan berkas cadangan JSON yang valid. Ketentuan pemulihan:
                        </p>
                        <ul className="space-y-2 text-xs text-gray-600 mb-8 list-disc pl-4">
                            <li>Data baru akan otomatis dimasukkan ke database.</li>
                            <li>Data yang sudah ada (berdasarkan kecocokan ID) akan diperbarui/ditimpa.</li>
                            <li>Tindakan ini aman digunakan berkali-kali tanpa memicu konflik duplikasi.</li>
                        </ul>
                    </div>

                    <div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isProcessing}
                            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:pointer-events-none text-white py-3.5 rounded-2xl text-xs font-extrabold tracking-wider transition-all shadow-md shadow-purple-500/10 active:scale-[0.99] flex justify-center items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            PILIH & UNGGAH BERKAS BACKUP
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImportBackup}
                            accept=".json"
                            className="hidden"
                        />
                    </div>
                </div>

            </div>
        </div>
    )
}
