'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import Link from 'next/link'
import { normalizeIndonesianPhone } from '@/lib/phoneNormalization'

/*
 * Daftar tabel yang dicadangkan, URUT AMAN untuk pemulihan:
 * master data lebih dulu, baru data operasional yang merujuk padanya.
 * Urutan array ini dipakai apa adanya saat impor agar foreign key tidak gagal.
 */
const BACKUP_TABLES = [
    // --- MASTER DATA ---
    { name: 'branches', label: 'Cabang', group: 'master' },
    { name: 'users', label: 'Akun Staf & Owner', group: 'master' },
    { name: 'treatment_categories', label: 'Kategori Tindakan', group: 'master' },
    { name: 'treatments', label: 'Katalog Tindakan', group: 'master' },
    { name: 'products', label: 'Master Produk', group: 'master' },
    { name: 'product_stock', label: 'Stok Produk per Cabang', group: 'master' },
    { name: 'coupon_packages', label: 'Paket Kupon', group: 'master' },
    { name: 'coupon_package_items', label: 'Isi Paket Kupon', group: 'master' },

    // --- DATA OPERASIONAL ---
    { name: 'patients', label: 'Pasien', group: 'operasional' },
    { name: 'patient_photos', label: 'Foto Pasien (data, bukan file)', group: 'operasional' },
    { name: 'appointments', label: 'Jadwal Appointment', group: 'operasional' },
    { name: 'appointment_treatments', label: 'Tindakan per Appointment', group: 'operasional' },
    { name: 'treatment_records', label: 'Rekam Medis', group: 'operasional' },
    { name: 'treatment_record_items', label: 'Rincian Rekam Medis', group: 'operasional' },
    { name: 'transactions', label: 'Transaksi', group: 'operasional' },
    { name: 'transaction_items', label: 'Item Transaksi', group: 'operasional' },
    { name: 'patient_coupons', label: 'Kupon Pasien', group: 'operasional' },
    { name: 'patient_coupon_items', label: 'Sesi Kupon Pasien', group: 'operasional' },
    { name: 'coupon_usage_logs', label: 'Riwayat Pemakaian Kupon', group: 'operasional' },
    { name: 'followup_queue', label: 'Antrian Follow-up', group: 'operasional' },
    { name: 'followup_logs', label: 'Riwayat Follow-up', group: 'operasional' },
    {
        name: 'daily_transaction_counters',
        label: 'Nomor Urut Transaksi Harian',
        group: 'operasional',
        orderBy: ['counter_date', 'branch_id'],
        onConflict: 'branch_id,counter_date'
    },
]

// PostgREST memotong hasil di 1000 baris. Tanpa paginasi, .select('*') biasa
// akan membuang sisa data TANPA pesan error -- backup terlihat sukses padahal tidak lengkap.
const PAGE_SIZE = 1000

// Upsert dipecah agar payload tidak terlalu besar saat memulihkan tabel bervolume tinggi.
const UPSERT_CHUNK = 500

async function fetchAllRows(table, orderBy = ['id']) {
    const rows = []

    for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase.from(table).select('*')
        for (const col of orderBy) {
            query = query.order(col, { ascending: true })
        }

        const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`Tabel "${table}": ${error.message}`)
        if (!data || data.length === 0) break

        rows.push(...data)
        if (data.length < PAGE_SIZE) break
    }

    return rows
}

function formatCount(n) {
    return Number(n || 0).toLocaleString('id-ID')
}

export default function BackupRestorePage() {
    const router = useRouter()
    const fileInputRef = useRef(null)

    const [isOwner, setIsOwner] = useState(false)
    const [userLoaded, setUserLoaded] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [lastSummary, setLastSummary] = useState(null)

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
        setLastSummary(null)
        const toastId = toast.loading('Menyiapkan berkas cadangan data...')

        try {
            const data = {}
            const counts = {}
            const shortfall = []

            for (let i = 0; i < BACKUP_TABLES.length; i++) {
                const table = BACKUP_TABLES[i]
                toast.loading(`Mencadangkan ${table.label}... (${i + 1}/${BACKUP_TABLES.length})`, { id: toastId })

                // Hitung dulu, baru ambil datanya. Urutan ini penting: baris yang masuk
                // saat backup berjalan hanya menambah hasil, jadi tidak memicu peringatan palsu.
                // Sebaliknya, hasil yang LEBIH SEDIKIT dari hitungan awal berarti data benar-benar terpotong.
                const { count: countBefore } = await supabase
                    .from(table.name)
                    .select('*', { count: 'exact', head: true })

                const rows = await fetchAllRows(table.name, table.orderBy)
                data[table.name] = rows
                counts[table.name] = rows.length

                if (typeof countBefore === 'number' && rows.length < countBefore) {
                    shortfall.push(`${table.label}: terunduh ${formatCount(rows.length)} dari ${formatCount(countBefore)}`)
                }
            }

            if (shortfall.length > 0) {
                throw new Error(
                    'Data terunduh tidak lengkap, berkas dibatalkan agar cadangan yang cacat tidak tersimpan. Rincian: ' +
                    shortfall.join('; ')
                )
            }

            const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)

            const backupData = {
                version: '2.0',
                exported_at: new Date().toISOString(),
                table_order: BACKUP_TABLES.map(t => t.name),
                counts,
                total_rows: totalRows,
                catatan: 'File FOTO pasien tidak termasuk dalam berkas ini. Berkas hanya memuat data tabel, termasuk keterangan lokasi foto (storage_path).',
                data
            }

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const now = new Date()
            const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
            a.download = `Ayumi_Backup_${stamp}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            setLastSummary({
                type: 'export',
                at: now.toLocaleString('id-ID'),
                total: totalRows,
                counts
            })
            toast.success(`Backup selesai: ${formatCount(totalRows)} baris dari ${BACKUP_TABLES.length} tabel.`, { id: toastId })
        } catch (err) {
            console.error('Error exporting backup:', err)
            toast.error('Gagal mengekspor data: ' + err.message, { id: toastId, duration: 8000 })
        } finally {
            setIsProcessing(false)
        }
    }

    const sanitizePatients = (patients) => patients.map(p => {
        const normWa = normalizeIndonesianPhone(p.whatsapp) || p.whatsapp
        return {
            ...p,
            full_name: (p.full_name || '').trim(),
            whatsapp: normWa,
            birth_date: p.birth_date && String(p.birth_date).trim() !== '' && p.birth_date !== '-' ? p.birth_date : null,
            address: p.address && String(p.address).trim() !== '' ? String(p.address).trim() : null,
            medical_notes: p.medical_notes && String(p.medical_notes).trim() !== '' ? String(p.medical_notes).trim() : null,
            allergies: p.allergies && String(p.allergies).trim() !== '' ? String(p.allergies).trim() : null,
            notes: p.notes && String(p.notes).trim() !== '' ? String(p.notes).trim() : null,
            instagram: p.instagram && String(p.instagram).trim() !== '' ? String(p.instagram).trim() : null
        }
    })

    const handleImportBackup = async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return

        setIsProcessing(true)
        const toastId = toast.loading('Membaca berkas cadangan...')

        try {
            const text = await file.text()
            const backup = JSON.parse(text)

            if (!backup.data || typeof backup.data !== 'object') {
                throw new Error('Format berkas cadangan JSON tidak valid.')
            }

            // Berkas versi 1.0 hanya memuat 8 tabel operasional tanpa master data.
            // Tetap didukung agar cadangan lama masih bisa dipulihkan.
            const isLegacy = !backup.version || backup.version === '1.0'
            const tablesInFile = BACKUP_TABLES.filter(t => Array.isArray(backup.data[t.name]))

            if (tablesInFile.length === 0) {
                throw new Error('Berkas cadangan tidak memuat tabel yang dikenali.')
            }

            const rincian = tablesInFile
                .filter(t => backup.data[t.name].length > 0)
                .map(t => `- ${t.label}: ${formatCount(backup.data[t.name].length)} baris`)
                .join('\n')

            const totalRows = tablesInFile.reduce((sum, t) => sum + backup.data[t.name].length, 0)

            toast.dismiss(toastId)

            const konfirmasi = window.confirm(
                'PERIKSA SEBELUM MELANJUTKAN\n\n' +
                `Berkas dibuat : ${backup.exported_at ? new Date(backup.exported_at).toLocaleString('id-ID') : 'tidak diketahui'}\n` +
                `Versi berkas  : ${backup.version || '1.0 (lama)'}\n` +
                `Total         : ${formatCount(totalRows)} baris dari ${tablesInFile.length} tabel\n\n` +
                rincian +
                '\n\nData dengan ID yang sama akan DITIMPA oleh isi berkas ini. ' +
                'Tindakan ini tidak bisa dibatalkan.\n\nLanjutkan pemulihan?'
            )

            if (!konfirmasi) {
                setIsProcessing(false)
                toast('Pemulihan dibatalkan.', { icon: 'ℹ️' })
                return
            }

            if (isLegacy) {
                const lanjutLegacy = window.confirm(
                    'Berkas ini versi lama (1.0) dan TIDAK memuat master data ' +
                    '(cabang, akun staf, katalog tindakan, produk, paket kupon).\n\n' +
                    'Jika master data di database saat ini sudah hilang, pemulihan akan gagal ' +
                    'karena data pasien dan transaksi merujuk ke data tersebut.\n\nTetap lanjutkan?'
                )
                if (!lanjutLegacy) {
                    setIsProcessing(false)
                    toast('Pemulihan dibatalkan.', { icon: 'ℹ️' })
                    return
                }
            }

            const restoreToastId = toast.loading('Memulai pemulihan data...')
            const restored = {}

            for (let i = 0; i < tablesInFile.length; i++) {
                const table = tablesInFile[i]
                let rows = backup.data[table.name]
                if (rows.length === 0) continue

                if (table.name === 'patients') {
                    rows = sanitizePatients(rows)
                }

                toast.loading(
                    `Memulihkan ${table.label}... (${i + 1}/${tablesInFile.length})`,
                    { id: restoreToastId }
                )

                for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
                    const chunk = rows.slice(start, start + UPSERT_CHUNK)
                    const options = table.onConflict ? { onConflict: table.onConflict } : undefined
                    const { error } = await supabase.from(table.name).upsert(chunk, options)
                    if (error) {
                        throw new Error(`Gagal pada tabel "${table.label}": ${error.message}`)
                    }
                }

                restored[table.name] = rows.length
            }

            const totalRestored = Object.values(restored).reduce((a, b) => a + b, 0)
            setLastSummary({
                type: 'import',
                at: new Date().toLocaleString('id-ID'),
                total: totalRestored,
                counts: restored
            })
            toast.success(`Pemulihan selesai: ${formatCount(totalRestored)} baris dipulihkan.`, { id: restoreToastId })
        } catch (err) {
            console.error('Error importing backup:', err)
            toast.error('Gagal memulihkan berkas cadangan: ' + err.message, { duration: 10000 })
        } finally {
            setIsProcessing(false)
        }
    }

    if (!userLoaded) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[40vh]">
                <div className="animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memeriksa Hak Akses...</p>
            </div>
        )
    }

    const masterTables = BACKUP_TABLES.filter(t => t.group === 'master')
    const operationalTables = BACKUP_TABLES.filter(t => t.group === 'operasional')

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
                    <h2 className="text-lg font-black text-gray-800">Pusat Backup &amp; Pemulihan Data Klinik</h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        Cadangkan <strong className="text-amber-700">{BACKUP_TABLES.length} tabel</strong> database Ayumi Beauty House ke satu berkas <strong className="text-amber-700">JSON</strong>, mencakup master data maupun data operasional. Sistem memverifikasi kelengkapan berkas sebelum diunduh, sehingga cadangan yang tidak utuh tidak akan tersimpan.
                    </p>
                </div>
            </div>

            {/* Peringatan foto */}
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <p className="text-xs text-rose-800 leading-relaxed">
                    <strong>File foto pasien tidak ikut tercadangkan.</strong> Berkas JSON hanya memuat data tabel beserta keterangan lokasi foto (<code className="bg-rose-100 px-1 rounded">storage_path</code>). File gambarnya sendiri tersimpan di Supabase Storage dan harus diunduh terpisah dari Dashboard Supabase.
                </p>
            </div>

            {/* Ringkasan proses terakhir */}
            {lastSummary && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                    <h3 className="text-sm font-black text-emerald-900 mb-1">
                        {lastSummary.type === 'export' ? 'Backup berhasil dibuat' : 'Pemulihan berhasil'}
                    </h3>
                    <p className="text-xs text-emerald-700 mb-3">
                        {lastSummary.at} &middot; total {formatCount(lastSummary.total)} baris
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                        {BACKUP_TABLES.filter(t => lastSummary.counts[t.name] > 0).map(t => (
                            <div key={t.name} className="flex justify-between text-[11px] text-emerald-800 border-b border-emerald-100 py-0.5">
                                <span className="truncate pr-2">{t.label}</span>
                                <span className="font-bold shrink-0">{formatCount(lastSummary.counts[t.name])}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Column 1: Ekspor */}
                <div className="card-ayumi p-6 flex flex-col justify-between h-full bg-white">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4a3 3 0 00-3-3m3 3a3 3 0 003-3m-3 3v-9" /></svg>
                            </div>
                            <h3 className="text-base font-bold text-gray-800">Ekspor File Cadangan</h3>
                        </div>

                        <p className="text-[11px] font-black text-gray-700 uppercase tracking-wide mb-2">
                            Master Data ({masterTables.length} tabel)
                        </p>
                        <ul className="space-y-1 text-xs text-gray-600 mb-4 list-disc pl-4">
                            {masterTables.map(t => <li key={t.name}>{t.label}</li>)}
                        </ul>

                        <p className="text-[11px] font-black text-gray-700 uppercase tracking-wide mb-2">
                            Data Operasional ({operationalTables.length} tabel)
                        </p>
                        <ul className="space-y-1 text-xs text-gray-600 mb-8 list-disc pl-4">
                            {operationalTables.map(t => <li key={t.name}>{t.label}</li>)}
                        </ul>
                    </div>

                    <button
                        onClick={handleExportBackup}
                        disabled={isProcessing}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none text-white py-3.5 rounded-2xl text-xs font-extrabold tracking-wider transition-all shadow-md shadow-blue-500/10 active:scale-[0.99] flex justify-center items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        {isProcessing ? 'SEDANG DIPROSES...' : 'UNDUH BERKAS BACKUP'}
                    </button>
                </div>

                {/* Column 2: Impor */}
                <div className="card-ayumi p-6 flex flex-col justify-between h-full bg-white">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            </div>
                            <h3 className="text-base font-bold text-gray-800">Impor &amp; Pulihkan Data Klinik</h3>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed mb-4">
                            Pulihkan database menggunakan berkas cadangan JSON. Ketentuan pemulihan:
                        </p>
                        <ul className="space-y-2 text-xs text-gray-600 mb-8 list-disc pl-4">
                            <li>Isi berkas <strong>ditampilkan lebih dulu</strong> untuk Anda periksa sebelum ada perubahan apa pun.</li>
                            <li>Master data dipulihkan lebih dulu, baru data operasional, agar keterkaitan antar data tidak gagal.</li>
                            <li>Data dengan ID yang sama akan <strong className="text-purple-700">ditimpa</strong> oleh isi berkas.</li>
                            <li>Berkas cadangan versi lama (1.0) masih dapat dipulihkan.</li>
                            <li>Aman dijalankan berkali-kali tanpa menimbulkan duplikasi.</li>
                        </ul>
                    </div>

                    <div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isProcessing}
                            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:pointer-events-none text-white py-3.5 rounded-2xl text-xs font-extrabold tracking-wider transition-all shadow-md shadow-purple-500/10 active:scale-[0.99] flex justify-center items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            {isProcessing ? 'SEDANG DIPROSES...' : 'PILIH & UNGGAH BERKAS BACKUP'}
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
