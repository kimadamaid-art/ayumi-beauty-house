'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import DateRangePicker from "../../components/DateRangePicker"
import BranchFilter from "@/components/ui/BranchFilter"
import toast from 'react-hot-toast'
import { getLogoBase64 } from '@/lib/pdfLogo'
import { openWhatsApp } from '@/lib/whatsapp'
import { parsePaymentSplits, getNetTransactionRevenue } from '@/lib/paymentUtils'

// Recharts components (we only render them on client side to avoid hydration errors)
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell
} from 'recharts'

export default function TransactionsPage() {
    const router = useRouter()

    // Auth & UI States
    const [dbUser, setDbUser] = useState(null)
    const [branches, setBranches] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [isMounted, setIsMounted] = useState(false)
    const [activeMainTab, setActiveMainTab] = useState('all') // 'all' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Filters (Global for main view, tabs have specific sub-filters)
    const [filterPeriod, setFilterPeriod] = useState('custom')
    const [filterBranch, setFilterBranch] = useState('') // empty means 'all'
    const [filterPaymentMethod, setFilterPaymentMethod] = useState('') // empty means 'all'
    const [filterTxType, setFilterTxType] = useState('') // empty means 'all'
    const [customStartDate, setCustomStartDate] = useState(() => {
        return getLocalYYYYMMDD()
    })
    const [customEndDate, setCustomEndDate] = useState(() => {
        return getLocalYYYYMMDD()
    })

    // Data State
    const [transactions, setTransactions] = useState([]) // all loaded transactions for current & comparison periods

    // Detail Modal State
    const [selectedTx, setSelectedTx] = useState(null)
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
    const [isEditingTx, setIsEditingTx] = useState(false)
    const [editTxData, setEditTxData] = useState({ payment_method: '', notes: '', created_at: '' })
    const [isDeletingTx, setIsDeletingTx] = useState(false)

    // Tab-Specific Sub-filters
    const [dailyReportDate, setDailyReportDate] = useState(() => getLocalYYYYMMDD())
    
    // Weekly Report selector (picks a start date)
    const getStartOfWeek = (d) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
        return new Date(date.setDate(diff))
    }
    const [weeklyReportStart, setWeeklyReportStart] = useState(getStartOfWeek(new Date()).toISOString().split('T')[0])

    // Monthly Report selector (Month & Year)
    const [monthlyReportMonth, setMonthlyReportMonth] = useState(new Date().getMonth()) // 0-11
    const [monthlyReportYear, setMonthlyReportYear] = useState(new Date().getFullYear())

    // Yearly Report selector (Year)
    const [yearlyReportYear, setYearlyReportYear] = useState(new Date().getFullYear())

    // Custom Tab filters
    const [customTabStart, setCustomTabStart] = useState(new Date().toISOString().split('T')[0])
    const [customTabEnd, setCustomTabEnd] = useState(new Date().toISOString().split('T')[0])
    const [customTabBranch, setCustomTabBranch] = useState('')
    const [customTabTxType, setCustomTabTxType] = useState('')

    // Fetch initial user and branches
    async function fetchInitialData() {
        setIsLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data: uData } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
            if (uData) {
                setDbUser(uData)
                if (uData.role !== 'owner') {
                    setFilterBranch(uData.branch_id || '')
                    setCustomTabBranch(uData.branch_id || '')
                }
            } else {
                setDbUser({ role: 'owner', id: user.id })
            }
        }

        const { data: brData } = await supabase.from('branches').select('id, name').eq('is_active', true)
        if (brData) setBranches(brData)
        setIsLoading(false)
    }

    useEffect(() => {
        setIsMounted(true)
        fetchInitialData()
    }, [])

    // Query transactions whenever filter branch/dates change
    // We will query from 1 year ago to today, or base it on current tab view to avoid fetching excessive amounts of data
    async function fetchTransactions() {
        if (!isMounted) return
        
        let query = supabase
            .from('transactions')
            .select(`
                *,
                branches (name),
                patients (full_name, whatsapp),
                users:users!transactions_cashier_id_fkey(full_name),
                treatment_records (
                    id,
                    performed_by,
                    therapist:users!treatment_records_performed_by_fkey (full_name)
                ),
                transaction_items (*)
            `)
            .order('created_at', { ascending: false })

        // Apply global branch filter
        if (dbUser && dbUser.role !== 'owner') {
            query = query.eq('branch_id', dbUser.branch_id || '00000000-0000-0000-0000-000000000000')
        } else if (filterBranch) {
            query = query.eq('branch_id', filterBranch)
        }

        const { data, error } = await query
        if (error) {
            console.error(error)
        } else if (data) {
            setTransactions(data)
        }
    }

    useEffect(() => {
        if (isMounted) {
            fetchTransactions()
        }
    }, [isMounted, filterBranch, dbUser])

    // Single derived state: ONLY transactions with payment_status === 'paid' for all financial & quantity calculations
    const validTransactions = useMemo(
        () => transactions.filter(tx => tx.payment_status === 'paid'),
        [transactions]
    )

    // Get filtered valid transactions for Main Tab KPI & summary calculations
    const filteredValidTransactions = useMemo(() => {
        return validTransactions.filter(tx => {
            // 1. Branch Filter
            if (filterBranch && tx.branch_id !== filterBranch) return false

            // 2. Payment Method Filter
            if (filterPaymentMethod && tx.payment_method !== filterPaymentMethod) return false

            // 3. Transaction Type Filter
            if (filterTxType) {
                const hasType = tx.transaction_items?.some(item => item.item_type === filterTxType)
                if (!hasType) return false
            }

            // 4. Period Date Filter
            const txDate = new Date(tx.created_at)
            const start = new Date(customStartDate + 'T00:00:00')
            const end = new Date(customEndDate + 'T23:59:59')
            return txDate >= start && txDate <= end
        })
    }, [validTransactions, filterBranch, filterPaymentMethod, filterTxType, customStartDate, customEndDate])

    // Get current raw transactions list based on main tab filter & parameters (for Table listing so VOID rows remain visible)
    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => {
            // 1. Branch Filter
            if (filterBranch && tx.branch_id !== filterBranch) return false

            // 2. Payment Method Filter
            if (filterPaymentMethod && tx.payment_method !== filterPaymentMethod) return false

            // 3. Transaction Type Filter
            if (filterTxType) {
                const hasType = tx.transaction_items?.some(item => item.item_type === filterTxType)
                if (!hasType) return false
            }

            // 4. Period Date Filter
            const txDate = new Date(tx.created_at)
            const start = new Date(customStartDate + 'T00:00:00')
            const end = new Date(customEndDate + 'T23:59:59')
            return txDate >= start && txDate <= end
        })
    }, [transactions, filterBranch, filterPaymentMethod, filterTxType, customStartDate, customEndDate])

    // Summary calculations for the main view (derived strictly from validTransactions)
    const mainSummary = useMemo(() => {
        let totalRevenue = 0
        let totalTx = 0
        let treatmentQty = 0
        let productQty = 0
        let couponQty = 0
        let treatmentRevenue = 0
        let productRevenue = 0
        let couponRevenue = 0

        filteredValidTransactions.forEach(tx => {
            totalTx += 1
            totalRevenue += getNetTransactionRevenue(tx)
            tx.transaction_items?.forEach(item => {
                const subtotal = Number(item.subtotal || 0)
                if (item.item_type === 'treatment') {
                    treatmentQty += item.quantity || 0
                    treatmentRevenue += subtotal
                } else if (item.item_type === 'product') {
                    productQty += item.quantity || 0
                    productRevenue += subtotal
                } else if (item.item_type === 'coupon') {
                    couponQty += item.quantity || 0
                    couponRevenue += subtotal
                }
            })
        })

        const avgRevenue = totalTx > 0 ? totalRevenue / totalTx : 0

        return {
            totalRevenue,
            totalTx,
            avgRevenue,
            treatmentQty,
            productQty,
            couponQty,
            treatmentRevenue,
            productRevenue,
            couponRevenue
        }
    }, [filteredValidTransactions])

    // Formatter helpers
    const formatCurrency = (val) => {
        return 'Rp ' + Number(val || 0).toLocaleString('id-ID')
    }

    const formatDate = (isoString) => {
        if (!isoString) return '-'
        const date = new Date(isoString)
        return date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    // WA Share Link creator
    const handleSendWA = (tx) => {
        if (!tx) return
        let phoneRaw = tx.patients?.whatsapp || ''
        if (!phoneRaw) {
            const inputPhone = window.prompt(
                'Nomor WhatsApp pasien belum terdaftar.\nSilakan masukkan nomor WhatsApp tujuan (contoh: 08123456789):'
            )
            if (!inputPhone || !inputPhone.trim()) {
                return
            }
            phoneRaw = inputPhone.trim()
        }

        const itemsText = tx.transaction_items
            ?.map(i => `- ${i.name} (${i.quantity}x) : ${formatCurrency(i.subtotal)}`)
            .join('\n') || ''

        const customerName = tx.patients?.full_name || 'Pelanggan Ayumi'
        const text = `Halo *${customerName}*,\n\nTerima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House.\nBerikut adalah rincian transaksi Anda:\n\nNo. Transaksi: *${tx.transaction_number}*\nTanggal: ${formatDate(tx.created_at)}\nCabang: ${tx.branches?.name || 'Ayumi Clinic'}\n\n*Item:*\n${itemsText}\n\n*Subtotal:* ${formatCurrency(tx.subtotal)}\n*Diskon:* ${formatCurrency(tx.discount)}\n*Total Bayar:* *${formatCurrency(tx.total)}*\n*Metode Pembayaran:* ${tx.payment_method?.toUpperCase() || '-'}\nStatus: LUNAS\n\nHubungi kami jika ada pertanyaan. Sampai jumpa kembali!`

        openWhatsApp(phoneRaw, text)
    }

    // Detail Modal Renderer
    const openDetailModal = (tx) => {
        setSelectedTx(tx)
        setIsDetailModalOpen(true)
        setIsEditingTx(false)
        setEditTxData({
            payment_method: tx.payment_method || '',
            notes: tx.notes || '',
            created_at: tx.created_at ? new Date(tx.created_at).toISOString().slice(0, 16) : ''
        })
    }

    const closeDetailModal = () => {
        setSelectedTx(null)
        setIsDetailModalOpen(false)
        setIsEditingTx(false)
    }

    const handleVoidTx = async (tx) => {
        if (!tx) return
        if (tx.payment_status === 'void') {
            alert('Transaksi ini sudah berstatus VOID.')
            return
        }

        const reason = window.prompt(`Konfirmasi Pembatalan Transaksi ${tx.transaction_number}:\nMasukkan alasan pembatalan transaksi secara jelas:`)
        if (!reason || !reason.trim()) {
            alert('Alasan pembatalan wajib diisi.')
            return
        }

        try {
            const { data, error } = await supabase.rpc('void_transaction', {
                p_transaction_id: tx.id,
                p_reason: reason.trim()
            })

            if (error) throw error

            alert(data?.message || 'Transaksi berhasil dibatalkan (VOID).')
            closeDetailModal()
            fetchTransactions()
        } catch (err) {
            console.error('Error voiding transaction:', err)
            alert('Gagal membatalkan transaksi: ' + (err.message || err.error_description || err))
        }
    }

    const handleDeleteTx = async (tx) => {
        if (!tx) return
        if (dbUser?.role !== 'owner') {
            toast.error('Hanya Owner yang memiliki izin menghapus transaksi.')
            return
        }

        const confirmText = window.prompt(
            `⚠️ PERINGATAN HAPUS PERMANEN (KHUSUS OWNER)\n\nApakah Anda yakin ingin menghapus transaksi "${tx.transaction_number}" secara permanen?\n\n- Data transaksi akan dihapus BERSIH dari database dan laporan omzet.\n- Stok produk yang terjual akan otomatis dikembalikan (jika belum di-void).\n\nKetik "HAPUS" untuk konfirmasi:`
        )

        if (confirmText !== 'HAPUS') {
            if (confirmText !== null) {
                toast.error('Penghapusan dibatalkan. Kata kunci konfirmasi tidak sesuai.')
            }
            return
        }

        setIsDeletingTx(true)
        const loadToast = toast.loading(`Menghapus transaksi ${tx.transaction_number}...`)
        try {
            const res = await fetch(`/api/transactions/${tx.id}`, {
                method: 'DELETE'
            })
            const resData = await res.json()

            if (!res.ok) {
                throw new Error(resData.error || 'Gagal menghapus transaksi.')
            }

            toast.success(resData.message || `Transaksi ${tx.transaction_number} berhasil dihapus.`, { id: loadToast })
            closeDetailModal()
            fetchTransactions()
        } catch (err) {
            console.error('Error deleting transaction:', err)
            toast.error(err.message || 'Gagal menghapus transaksi.', { id: loadToast })
        } finally {
            setIsDeletingTx(false)
        }
    }

    const handleSaveEditedTx = async () => {
        if (!selectedTx) return

        try {
            // Hanya update kolom yang diizinkan (payment_method & notes). created_at terkunci permanen!
            const { error: updateErr } = await supabase
                .from('transactions')
                .update({
                    payment_method: editTxData.payment_method,
                    notes: editTxData.notes
                })
                .eq('id', selectedTx.id)

            if (updateErr) throw updateErr

            alert('Transaksi berhasil diperbarui.')
            closeDetailModal()
            fetchTransactions()

        } catch (err) {
            console.error('Error updating transaction:', err)
            alert('Gagal memperbarui transaksi: ' + err.message)
        }
    }

    // Helper for Excel export
    const handleExcelExport = (reportType, title, dataset) => {
        if (!dataset || dataset.length === 0) {
            alert('Tidak ada data untuk diexport.')
            return
        }

        const todayStr = new Date().toISOString().split('T')[0]
        const branchName = branches.find(b => b.id === filterBranch)?.name || 'Semua_Cabang'

        // Sheet 1: Summary (dihitung khusus transaksi lunas)
        const validDataset = dataset.filter(tx => tx.payment_status === 'paid')
        let totalRevenue = 0
        let tQty = 0, pQty = 0, cQty = 0
        validDataset.forEach(tx => {
            totalRevenue += getNetTransactionRevenue(tx)
            tx.transaction_items?.forEach(item => {
                if (item.item_type === 'treatment') tQty += item.quantity || 0
                if (item.item_type === 'product') pQty += item.quantity || 0
                if (item.item_type === 'coupon') cQty += item.quantity || 0
            })
        })

        const summaryRows = [
            ["LAPORAN TRANSAKSI AYUMI BEAUTY HOUSE"],
            [`Laporan: ${title}`],
            [`Cabang: ${branchName}`],
            [`Tanggal Cetak: ${todayStr}`],
            [],
            ["METRIK UTAMA"],
            ["Total Transaksi", dataset.length],
            ["Total Pendapatan", totalRevenue],
            ["Rata-rata per Transaksi", dataset.length > 0 ? totalRevenue / dataset.length : 0],
            [],
            ["BREAKDOWN KUANTITAS ITEM TERJUAL"],
            ["Layanan Treatment", tQty],
            ["Produk Fisik", pQty],
            ["Kupon Paket", cQty]
        ]
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)

        // Sheet 2: Detail Transaksi
        const detailRows = dataset.map((tx, idx) => ({
            "No.": idx + 1,
            "No. Transaksi": tx.transaction_number,
            "Tanggal": formatDate(tx.created_at),
            "Cabang": tx.branches?.name || "-",
            "Pasien": tx.patients?.full_name || "Walk-in Customer",
            "WhatsApp": tx.patients?.whatsapp || "-",
            "Item Ringkasan": tx.transaction_items?.map(i => `${i.name} (x${i.quantity})`).join(', ') || "-",
            "Metode Bayar": tx.payment_method?.toUpperCase(),
            "Subtotal": Number(tx.subtotal || 0),
            "Diskon": Number(tx.discount || 0),
            "Total": Number(tx.total || 0),
            "Status": (tx.payment_status || 'paid').toUpperCase(),
            "Kasir": tx.users?.full_name || "-"
        }))

        // Hitung total untuk Detail Transaksi
        const sumSubtotal = detailRows.reduce((a, b) => a + b["Subtotal"], 0)
        const sumDiscount = detailRows.reduce((a, b) => a + b["Diskon"], 0)
        const sumTotal = detailRows.reduce((a, b) => a + b["Total"], 0)

        // Append Total Row to Detail Transaksi
        detailRows.push({
            "No.": "TOTAL",
            "No. Transaksi": "",
            "Tanggal": "",
            "Cabang": "",
            "Pasien": "",
            "WhatsApp": "",
            "Item Ringkasan": "",
            "Metode Bayar": "",
            "Subtotal": sumSubtotal,
            "Diskon": sumDiscount,
            "Total": sumTotal,
            "Status": "",
            "Kasir": ""
        })
        const wsDetail = XLSX.utils.json_to_sheet(detailRows)

        // Pemisahan Kategori (Treatment, Produk, Kupon)
        const treatmentRows = []
        const productRows = []
        const couponRows = []

        dataset.forEach(tx => {
            const therapistName = tx.treatment_records?.therapist?.full_name || "-"
            const cashierName = tx.users?.full_name || "-"
            tx.transaction_items?.forEach(item => {
                const row = {
                    "No. Transaksi": tx.transaction_number,
                    "Tanggal": new Date(tx.created_at).toLocaleDateString('id-ID'),
                    "Cabang": tx.branches?.name || "-",
                    "Nama Item": item.name,
                    "Terapis / Kasir": item.item_type === 'treatment' ? therapistName : cashierName,
                    "Harga Satuan": Number(item.price),
                    "Kuantitas": item.quantity,
                    "Subtotal": Number(item.subtotal),
                    "Pasien": tx.patients?.full_name || "Walk-in Customer"
                }

                if (item.item_type === 'treatment') {
                    treatmentRows.push(row)
                } else if (item.item_type === 'product') {
                    productRows.push(row)
                } else if (item.item_type === 'coupon') {
                    couponRows.push(row)
                }
            })
        })

        // Hitung total untuk masing-masing kategori
        const totalTQty = treatmentRows.reduce((a, b) => a + b["Kuantitas"], 0)
        const totalTSubtotal = treatmentRows.reduce((a, b) => a + b["Subtotal"], 0)
        if (treatmentRows.length > 0) {
            treatmentRows.push({
                "No. Transaksi": "TOTAL",
                "Tanggal": "",
                "Cabang": "",
                "Nama Item": "",
                "Terapis / Kasir": "",
                "Harga Satuan": 0,
                "Kuantitas": totalTQty,
                "Subtotal": totalTSubtotal,
                "Pasien": ""
            })
        }

        const totalPQty = productRows.reduce((a, b) => a + b["Kuantitas"], 0)
        const totalPSubtotal = productRows.reduce((a, b) => a + b["Subtotal"], 0)
        if (productRows.length > 0) {
            productRows.push({
                "No. Transaksi": "TOTAL",
                "Tanggal": "",
                "Cabang": "",
                "Nama Item": "",
                "Terapis / Kasir": "",
                "Harga Satuan": 0,
                "Kuantitas": totalPQty,
                "Subtotal": totalPSubtotal,
                "Pasien": ""
            })
        }

        const totalCQty = couponRows.reduce((a, b) => a + b["Kuantitas"], 0)
        const totalCSubtotal = couponRows.reduce((a, b) => a + b["Subtotal"], 0)
        if (couponRows.length > 0) {
            couponRows.push({
                "No. Transaksi": "TOTAL",
                "Tanggal": "",
                "Cabang": "",
                "Nama Item": "",
                "Terapis / Kasir": "",
                "Harga Satuan": 0,
                "Kuantitas": totalCQty,
                "Subtotal": totalCSubtotal,
                "Pasien": ""
            })
        }

        const wsTreatment = XLSX.utils.json_to_sheet(treatmentRows)
        const wsProduct = XLSX.utils.json_to_sheet(productRows)
        const wsCoupon = XLSX.utils.json_to_sheet(couponRows)

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, wsSummary, "Summary")
        XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Transaksi")
        XLSX.utils.book_append_sheet(wb, wsTreatment, "Detail Treatment")
        XLSX.utils.book_append_sheet(wb, wsProduct, "Detail Produk Skincare")
        XLSX.utils.book_append_sheet(wb, wsCoupon, "Detail Kupon Paket")

        const fileName = `Laporan_${reportType}_${branchName.replace(/\s+/g, '_')}_${todayStr}.xlsx`
        XLSX.writeFile(wb, fileName)
    }

    const handlePDFExport = async (reportType, title, dataset) => {
        if (!dataset || dataset.length === 0) {
            alert('Tidak ada data untuk diexport.')
            return
        }

        const toastId = toast.loading('Menyiapkan dokumen PDF...')
        try {
            const { jsPDF } = await import('jspdf')
            
            // Inisialisasi dokumen PDF (A4 Portrait)
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            // Definisi warna sesuai tema Ayumi (Premium Orange-Brown)
            const primaryColor = [212, 98, 33]    // #D46221 (Oranye Ayumi)
            const secondaryColor = [78, 42, 18]   // #4E2A12 (Cokelat Tua)
            const accentColor = [242, 216, 195]    // #F2D8C3 (Krem Aksen)
            const bgMuted = [250, 246, 240]        // #FAF6F0 (Warm Off-White)
            const darkText = [44, 30, 22]          // #2C1E16 (Kehitaman)
            const mutedText = [140, 125, 115]      // #8C7D73 (Cokelat Abu-abu)

            let y = 15
            const pageHeight = 297
            const margin = 15
            const contentWidth = 180
            let pageNum = 1

            // Helper untuk memotong teks secara presisi berdasarkan lebar kolom (mm)
            const fitText = (str, widthLimit) => {
                if (!str) return '-';
                let tempStr = str;
                // Hitung lebar string dalam satuan mm pada ukuran font 7
                const getWidthMm = (s) => (doc.getStringUnitWidth(s) * 7 * 25.4) / 72;
                if (getWidthMm(tempStr) <= widthLimit) return tempStr;
                
                while (tempStr.length > 0 && getWidthMm(tempStr + '..') > widthLimit) {
                    tempStr = tempStr.substring(0, tempStr.length - 1);
                }
                return tempStr + '..';
            }

            // Helper untuk menggambar Header dan Footer di setiap halaman
            const addHeaderFooter = (d, isFirstPage = false) => {
                if (!isFirstPage) {
                    d.setFont('helvetica', 'bold')
                    d.setFontSize(8)
                    d.setTextColor(...mutedText)
                    d.text('LAPORAN OMSET & TRANSAKSI DETAIL - AYUMI BEAUTY HOUSE', margin, 10)
                    d.setDrawColor(245, 238, 230)
                    d.setLineWidth(0.3)
                    d.line(margin, 12, margin + contentWidth, 12)
                }

                // Footer di bagian bawah kertas
                d.setFont('helvetica', 'normal')
                d.setFontSize(7.5)
                d.setTextColor(...mutedText)
                d.text(`Ayumi Beauty House  |  Dicetak pada: ${new Date().toLocaleString('id-ID')}`, margin, pageHeight - 10)
                d.text(`Halaman ${pageNum}`, margin + contentWidth - 15, pageHeight - 10)
            }

            const logoBase64 = await getLogoBase64()

            // --- 1. KOP SURAT / HEADER LAPORAN ---
            // Aksen bar atas oranye
            doc.setFillColor(...primaryColor)
            doc.rect(margin, y, contentWidth, 2.5, 'F')
            y += 6.5

            // Logo Klinik
            let textStartX = margin
            if (logoBase64) {
                try {
                    doc.addImage(logoBase64, 'PNG', margin, y, 16, 16)
                    textStartX = margin + 19
                } catch (e) {
                    console.error('Failed to embed logo in PDF:', e)
                }
            }

            // Nama Klinik
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(15)
            doc.setTextColor(...secondaryColor)
            doc.text('AYUMI BEAUTY HOUSE', textStartX, y + 4.5)

            // Tagline Klinik
            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...mutedText)
            doc.text('Kecantikan, Kosmetik & Perawatan Diri', textStartX, y + 8.5)
            
            // Subtitle Laporan
            doc.setFontSize(9.5)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...primaryColor)
            doc.text(`LAPORAN OMSET & KINERJA KEUANGAN (${reportType.toUpperCase()})`, textStartX, y + 14)

            // Metadata Cetak di sisi kanan
            doc.setFontSize(7.5)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...darkText)
            
            const activeBranchName = branches.find(b => b.id === filterBranch)?.name || 'Semua Cabang (Global)'
            const printDateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            const printedBy = dbUser?.full_name || 'Owner/Admin'

            const metaX = margin + 115
            doc.text(`Periode: ${title.replace(/_/g, ' ')}`, metaX, y + 3)
            doc.text(`Cabang: ${activeBranchName}`, metaX, y + 7)
            doc.text(`Tanggal Cetak: ${printDateStr}`, metaX, y + 11)
            doc.text(`Pencetak: ${printedBy}`, metaX, y + 15)

            y += 20

            // Garis pembatas elegan
            doc.setDrawColor(...accentColor)
            doc.setLineWidth(0.4)
            doc.line(margin, y, margin + contentWidth, y)
            y += 8

            // --- 2. PERHITUNGAN RINGKASAN METRIK ---
            const validDataset = dataset.filter(tx => tx.payment_status === 'paid')
            let totalRevenue = 0
            let totalTxCount = validDataset.length
            let treatmentQty = 0
            let productQty = 0
            let couponQty = 0
            const paymentBreakdown = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }

            validDataset.forEach(tx => {
                totalRevenue += getNetTransactionRevenue(tx)
                const splits = parsePaymentSplits(tx)
                Object.entries(splits).forEach(([m, amt]) => {
                    if (paymentBreakdown[m] !== undefined) {
                        paymentBreakdown[m] += amt
                    }
                })
                tx.transaction_items?.forEach(i => {
                    if (i.item_type === 'treatment') treatmentQty += i.quantity
                    if (i.item_type === 'product') productQty += i.quantity
                    if (i.item_type === 'coupon') couponQty += i.quantity
                })
            })

            // --- 3. KARTU METRIK UTAMA (KPI Premium Layout) ---
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9.5)
            doc.setTextColor(...secondaryColor)
            doc.text('RINGKASAN KINERJA KEUANGAN', margin, y)
            y += 4.5

            const cardW = 86
            const cardH = 15
            const gap = 8

            // Helper untuk menggambar kartu metrik premium dengan aksen garis vertikal di kiri
            const drawPremiumCard = (xVal, yVal, label, value, isGreen = false) => {
                doc.setFillColor(254, 252, 250) // background krem ultra-soft
                doc.setDrawColor(242, 230, 218) // border krem lembut
                doc.setLineWidth(0.3)
                doc.roundedRect(xVal, yVal, cardW, cardH, 1, 1, 'FD')
                
                // Garis aksen vertikal oranye di sisi kiri
                doc.setFillColor(...primaryColor)
                doc.rect(xVal, yVal, 2.5, cardH, 'F')
                
                doc.setFontSize(7)
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(...mutedText)
                doc.text(label, xVal + 5, yVal + 4.5)
                
                doc.setFontSize(10.5)
                if (isGreen) {
                    doc.setTextColor(22, 101, 52) // warna hijau sukses
                } else {
                    doc.setTextColor(...darkText)
                }
                doc.text(value, xVal + 5, yVal + 11.2)
            }

            // Card 1: Total Omset
            drawPremiumCard(margin, y, 'TOTAL OMSET (REVENUE)', formatCurrency(totalRevenue), true)

            // Card 2: Total Transaksi
            drawPremiumCard(margin + cardW + gap, y, 'TOTAL TRANSAKSI SUKSES', `${totalTxCount} Transaksi`, false)

            y += cardH + gap - 4.5

            // Card 3: Treatment Qty
            drawPremiumCard(margin, y, 'TINDAKAN TREATMENT DIKERJAKAN', `${treatmentQty} Sesi Treatment`, false)

            // Card 4: Product Qty
            drawPremiumCard(margin + cardW + gap, y, 'PRODUK SKINCARE TERJUAL', `${productQty} Unit Produk`, false)

            y += cardH + gap

            // Ringkasan Metode Bayar
            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...secondaryColor)
            doc.text('Rincian Metode Pembayaran:', margin, y)
            y += 4.5

            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...darkText)
            const payMethodsStr = Object.entries(paymentBreakdown)
                .map(([m, amt]) => `${m.toUpperCase()}: ${formatCurrency(amt)}`)
                .join('   |   ')
            doc.text(payMethodsStr, margin, y)
            y += 9

            // Ekstrak rincian item berdasarkan kategori
            const treatmentItemsList = []
            const productItemsList = []
            const couponItemsList = []

            dataset.forEach(tx => {
                const txDateStr = new Date(tx.created_at).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                })
                const patientName = tx.patients?.full_name || 'Walk-in Customer'
                const cashierName = tx.users?.full_name || '-'
                const therapistName = tx.treatment_records?.therapist?.full_name || '-'

                tx.transaction_items?.forEach(item => {
                    const rowData = {
                        date: txDateStr,
                        txNumber: tx.transaction_number,
                        name: item.name,
                        patient: patientName,
                        qty: item.quantity,
                        subtotal: Number(item.subtotal || 0)
                    }

                    if (item.item_type === 'treatment') {
                        treatmentItemsList.push({
                            ...rowData,
                            therapist: therapistName
                        })
                    } else if (item.item_type === 'product') {
                        productItemsList.push({
                            ...rowData,
                            seller: cashierName
                        })
                    } else if (item.item_type === 'coupon') {
                        couponItemsList.push({
                            ...rowData
                        })
                    }
                })
            })

            // Helper untuk menggambar table header dengan garis batas tebal
            const drawTableHeader = (headers, colWidths, startX, startY) => {
                doc.setDrawColor(220, 200, 180) // border header
                doc.setLineWidth(0.3)
                doc.line(startX, startY, startX + contentWidth, startY)
                
                doc.setFillColor(248, 240, 232) // background krem hangat
                doc.rect(startX, startY, contentWidth, 6.5, 'F')
                
                doc.line(startX, startY + 6.5, startX + contentWidth, startY + 6.5)
                
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7.5)
                doc.setTextColor(...secondaryColor)
                
                let currX = startX
                headers.forEach((h, idx) => {
                    const width = colWidths[idx]
                    if (h === 'Subtotal' || h === 'Total' || h === 'Omset') {
                        doc.text(h, currX + width - 2, startY + 4.5, { align: 'right' })
                    } else if (h === 'No' || h === 'Qty') {
                        doc.text(h, currX + width / 2, startY + 4.5, { align: 'center' })
                    } else {
                        doc.text(h, currX + 2, startY + 4.5)
                    }
                    currX += width
                })
            }

            // Inisialisasi footer halaman pertama
            addHeaderFooter(doc, true)

            // --- 4. TABEL TINDAKAN TREATMENT ---
            y += 2
            if (y + 22 > pageHeight - margin) {
                doc.addPage()
                pageNum++
                y = 15
                addHeaderFooter(doc)
            }

            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9.5)
            doc.setTextColor(...secondaryColor)
            doc.text('A. RINCIAN TINDAKAN TREATMENT (PERAWATAN)', margin, y)
            y += 4.5

            // Lebar kolom terdistribusi rata (total 180)
            const tHeaders = ['No', 'Tanggal', 'No. Transaksi', 'Nama Treatment', 'Terapis', 'Pasien', 'Qty', 'Subtotal']
            const tColWidths = [7, 18, 32, 40, 28, 30, 8, 17]

            drawTableHeader(tHeaders, tColWidths, margin, y)
            y += 6.5

            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7)
            doc.setTextColor(...darkText)

            if (treatmentItemsList.length === 0) {
                doc.setFillColor(255, 255, 255)
                doc.rect(margin, y, contentWidth, 6, 'F')
                doc.text('Tidak ada tindakan treatment pada periode ini.', margin + 5, y + 4.5)
                y += 6
            } else {
                treatmentItemsList.forEach((item, idx) => {
                    if (y + 7.5 > pageHeight - margin) {
                        doc.addPage()
                        pageNum++
                        y = 15
                        addHeaderFooter(doc)
                        drawTableHeader(tHeaders, tColWidths, margin, y)
                        y += 6.5
                        doc.setFont('helvetica', 'normal')
                        doc.setFontSize(7)
                        doc.setTextColor(...darkText)
                    }

                    if (idx % 2 === 1) {
                        doc.setFillColor(253, 251, 248)
                        doc.rect(margin, y, contentWidth, 5.5, 'F')
                    }

                    let currX = margin
                    
                    doc.text(`${idx + 1}`, currX + tColWidths[0] / 2, y + 3.8, { align: 'center' })
                    currX += tColWidths[0]

                    doc.text(item.date, currX + 2, y + 3.8)
                    currX += tColWidths[1]

                    doc.text(item.txNumber, currX + 2, y + 3.8)
                    currX += tColWidths[2]

                    // Potong teks secara dinamis agar tidak menabrak batas kolom
                    const tName = fitText(item.name, tColWidths[3] - 4)
                    doc.text(tName, currX + 2, y + 3.8)
                    currX += tColWidths[3]

                    const thName = fitText(item.therapist, tColWidths[4] - 4)
                    doc.text(thName, currX + 2, y + 3.8)
                    currX += tColWidths[4]

                    const pName = fitText(item.patient, tColWidths[5] - 4)
                    doc.text(pName, currX + 2, y + 3.8)
                    currX += tColWidths[5]

                    doc.text(`${item.qty}`, currX + tColWidths[6] / 2, y + 3.8, { align: 'center' })
                    currX += tColWidths[6]

                    const subStr = item.subtotal.toLocaleString('id-ID')
                    doc.text(subStr, currX + tColWidths[7] - 2, y + 3.8, { align: 'right' })

                    // Garis pembatas baris ultra-tipis
                    doc.setDrawColor(245, 238, 230)
                    doc.setLineWidth(0.2)
                    doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                    y += 5.5
                })

                // --- TOTAL TINDAKAN TREATMENT ---
                const totalTQty = treatmentItemsList.reduce((sum, item) => sum + item.qty, 0)
                const totalTSubtotal = treatmentItemsList.reduce((sum, item) => sum + item.subtotal, 0)

                if (y + 6 > pageHeight - margin) {
                    doc.addPage()
                    pageNum++
                    y = 15
                    addHeaderFooter(doc)
                    drawTableHeader(tHeaders, tColWidths, margin, y)
                    y += 6.5
                }

                doc.setFillColor(254, 248, 242) // warna total krem oranye
                doc.rect(margin, y, contentWidth, 5.5, 'F')
                doc.setDrawColor(220, 200, 180)
                doc.setLineWidth(0.3)
                doc.line(margin, y, margin + contentWidth, y)
                doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7.5)
                doc.setTextColor(...secondaryColor)
                doc.text('TOTAL TINDAKAN TREATMENT', margin + 2, y + 3.8)

                let qtyX = margin + tColWidths.slice(0, 6).reduce((a, b) => a + b, 0)
                doc.text(`${totalTQty}`, qtyX + tColWidths[6] / 2, y + 3.8, { align: 'center' })

                let subX = qtyX + tColWidths[6]
                doc.text(totalTSubtotal.toLocaleString('id-ID'), subX + tColWidths[7] - 2, y + 3.8, { align: 'right' })
                y += 8
            }

            // --- 5. TABEL PENJUALAN PRODUK SKINCARE ---
            y += 4
            if (y + 22 > pageHeight - margin) {
                doc.addPage()
                pageNum++
                y = 15
                addHeaderFooter(doc)
            }

            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9.5)
            doc.setTextColor(...secondaryColor)
            doc.text('B. RINCIAN PENJUALAN PRODUK SKINCARE', margin, y)
            y += 4.5

            const pHeaders = ['No', 'Tanggal', 'No. Transaksi', 'Nama Produk Skincare', 'Kasir/Staf', 'Pasien', 'Qty', 'Subtotal']
            const pColWidths = [7, 18, 32, 40, 28, 30, 8, 17]

            drawTableHeader(pHeaders, pColWidths, margin, y)
            y += 6.5

            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7)
            doc.setTextColor(...darkText)

            if (productItemsList.length === 0) {
                doc.setFillColor(255, 255, 255)
                doc.rect(margin, y, contentWidth, 6, 'F')
                doc.text('Tidak ada penjualan produk skincare pada periode ini.', margin + 5, y + 4.5)
                y += 6
            } else {
                productItemsList.forEach((item, idx) => {
                    if (y + 7.5 > pageHeight - margin) {
                        doc.addPage()
                        pageNum++
                        y = 15
                        addHeaderFooter(doc)
                        drawTableHeader(pHeaders, pColWidths, margin, y)
                        y += 6.5
                        doc.setFont('helvetica', 'normal')
                        doc.setFontSize(7)
                        doc.setTextColor(...darkText)
                    }

                    if (idx % 2 === 1) {
                        doc.setFillColor(253, 251, 248)
                        doc.rect(margin, y, contentWidth, 5.5, 'F')
                    }

                    let currX = margin
                    
                    doc.text(`${idx + 1}`, currX + pColWidths[0] / 2, y + 3.8, { align: 'center' })
                    currX += pColWidths[0]

                    doc.text(item.date, currX + 2, y + 3.8)
                    currX += pColWidths[1]

                    doc.text(item.txNumber, currX + 2, y + 3.8)
                    currX += pColWidths[2]

                    const prodName = fitText(item.name, pColWidths[3] - 4)
                    doc.text(prodName, currX + 2, y + 3.8)
                    currX += pColWidths[3]

                    const sName = fitText(item.seller, pColWidths[4] - 4)
                    doc.text(sName, currX + 2, y + 3.8)
                    currX += pColWidths[4]

                    const pName = fitText(item.patient, pColWidths[5] - 4)
                    doc.text(pName, currX + 2, y + 3.8)
                    currX += pColWidths[5]

                    doc.text(`${item.qty}`, currX + pColWidths[6] / 2, y + 3.8, { align: 'center' })
                    currX += pColWidths[6]

                    const subStr = item.subtotal.toLocaleString('id-ID')
                    doc.text(subStr, currX + pColWidths[7] - 2, y + 3.8, { align: 'right' })

                    doc.setDrawColor(245, 238, 230)
                    doc.setLineWidth(0.2)
                    doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                    y += 5.5
                })

                // --- TOTAL PENJUALAN PRODUK ---
                const totalPQty = productItemsList.reduce((sum, item) => sum + item.qty, 0)
                const totalPSubtotal = productItemsList.reduce((sum, item) => sum + item.subtotal, 0)

                if (y + 6 > pageHeight - margin) {
                    doc.addPage()
                    pageNum++
                    y = 15
                    addHeaderFooter(doc)
                    drawTableHeader(pHeaders, pColWidths, margin, y)
                    y += 6.5
                }

                doc.setFillColor(254, 248, 242)
                doc.rect(margin, y, contentWidth, 5.5, 'F')
                doc.setDrawColor(220, 200, 180)
                doc.setLineWidth(0.3)
                doc.line(margin, y, margin + contentWidth, y)
                doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7.5)
                doc.setTextColor(...secondaryColor)
                doc.text('TOTAL PENJUALAN PRODUK', margin + 2, y + 3.8)

                let qtyX = margin + pColWidths.slice(0, 6).reduce((a, b) => a + b, 0)
                doc.text(`${totalPQty}`, qtyX + pColWidths[6] / 2, y + 3.8, { align: 'center' })

                let subX = qtyX + pColWidths[6]
                doc.text(totalPSubtotal.toLocaleString('id-ID'), subX + pColWidths[7] - 2, y + 3.8, { align: 'right' })
                y += 8
            }

            // --- 6. TABEL PENJUALAN KUPON PAKET ---
            y += 4
            if (y + 22 > pageHeight - margin) {
                doc.addPage()
                pageNum++
                y = 15
                addHeaderFooter(doc)
            }

            doc.setFont('helvetica', 'bold')
            doc.setFontSize(9.5)
            doc.setTextColor(...secondaryColor)
            doc.text('C. RINCIAN PENJUALAN KUPON PAKET', margin, y)
            y += 4.5

            const cHeaders = ['No', 'Tanggal', 'No. Transaksi', 'Nama Paket Kupon', 'Pasien', 'Qty', 'Subtotal']
            const cColWidths = [8, 22, 35, 57, 35, 8, 15]

            drawTableHeader(cHeaders, cColWidths, margin, y)
            y += 6.5

            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7)
            doc.setTextColor(...darkText)

            if (couponItemsList.length === 0) {
                doc.setFillColor(255, 255, 255)
                doc.rect(margin, y, contentWidth, 6, 'F')
                doc.text('Tidak ada penjualan kupon paket pada periode ini.', margin + 5, y + 4.5)
                y += 6
            } else {
                couponItemsList.forEach((item, idx) => {
                    if (y + 7.5 > pageHeight - margin) {
                        doc.addPage()
                        pageNum++
                        y = 15
                        addHeaderFooter(doc)
                        drawTableHeader(cHeaders, cColWidths, margin, y)
                        y += 6.5
                        doc.setFont('helvetica', 'normal')
                        doc.setFontSize(7)
                        doc.setTextColor(...darkText)
                    }

                    if (idx % 2 === 1) {
                        doc.setFillColor(253, 251, 248)
                        doc.rect(margin, y, contentWidth, 5.5, 'F')
                    }

                    let currX = margin
                    
                    doc.text(`${idx + 1}`, currX + cColWidths[0] / 2, y + 3.8, { align: 'center' })
                    currX += cColWidths[0]

                    doc.text(item.date, currX + 2, y + 3.8)
                    currX += cColWidths[1]

                    doc.text(item.txNumber, currX + 2, y + 3.8)
                    currX += cColWidths[2]

                    const cName = fitText(item.name, cColWidths[3] - 4)
                    doc.text(cName, currX + 2, y + 3.8)
                    currX += cColWidths[3]

                    const pName = fitText(item.patient, cColWidths[4] - 4)
                    doc.text(pName, currX + 2, y + 3.8)
                    currX += cColWidths[4]

                    doc.text(`${item.qty}`, currX + cColWidths[5] / 2, y + 3.8, { align: 'center' })
                    currX += cColWidths[5]

                    const subStr = item.subtotal.toLocaleString('id-ID')
                    doc.text(subStr, currX + cColWidths[6] - 2, y + 3.8, { align: 'right' })

                    doc.setDrawColor(245, 238, 230)
                    doc.setLineWidth(0.2)
                    doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                    y += 5.5
                })

                // --- TOTAL PENJUALAN KUPON ---
                const totalCQty = couponItemsList.reduce((sum, item) => sum + item.qty, 0)
                const totalCSubtotal = couponItemsList.reduce((sum, item) => sum + item.subtotal, 0)

                if (y + 6 > pageHeight - margin) {
                    doc.addPage()
                    pageNum++
                    y = 15
                    addHeaderFooter(doc)
                    drawTableHeader(cHeaders, cColWidths, margin, y)
                    y += 6.5
                }

                doc.setFillColor(254, 248, 242)
                doc.rect(margin, y, contentWidth, 5.5, 'F')
                doc.setDrawColor(220, 200, 180)
                doc.setLineWidth(0.3)
                doc.line(margin, y, margin + contentWidth, y)
                doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7.5)
                doc.setTextColor(...secondaryColor)
                doc.text('TOTAL PENJUALAN KUPON PAKET', margin + 2, y + 3.8)

                let qtyX = margin + cColWidths.slice(0, 5).reduce((a, b) => a + b, 0)
                doc.text(`${totalCQty}`, qtyX + cColWidths[5] / 2, y + 3.8, { align: 'center' })

                let subX = qtyX + cColWidths[5]
                doc.text(totalCSubtotal.toLocaleString('id-ID'), subX + cColWidths[6] - 2, y + 3.8, { align: 'right' })
                y += 8
            }

            // Menyimpan file PDF dengan penamaan rapi
            const sanitizedBranch = activeBranchName.replace(/[^a-zA-Z0-9]/g, '_')
            const pdfName = `Laporan_Keuangan_${reportType}_${sanitizedBranch}_${title.replace(/\s+/g, '_')}.pdf`
            doc.save(pdfName)

            toast.success('Laporan PDF berhasil diunduh.', { id: toastId })
        } catch (err) {
            console.error('Error generating PDF:', err)
            toast.error('Gagal membuat PDF: ' + err.message, { id: toastId })
        }
    }


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 2: DAILY REPORT
    // ==========================================
    const dailyData = useMemo(() => {
        const selectedDate = new Date(dailyReportDate)
        const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
        const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999)

        const txList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        let revenue = 0
        const payMethods = { cash: { count: 0, total: 0 }, transfer: { count: 0, total: 0 }, qris: { count: 0, total: 0 }, debit: { count: 0, total: 0 }, credit: { count: 0, total: 0 } }
        const typeBreakdown = { treatment: { qty: 0, total: 0 }, product: { qty: 0, total: 0 }, coupon: { qty: 0, total: 0 } }
        
        // Hour bins 00:00 to 23:00
        const hourlyBins = Array.from({ length: 24 }, (_, i) => ({ hour: `${String(i).padStart(2, '0')}:00`, transaksi: 0, pendapatan: 0 }))

        txList.forEach(tx => {
            const txNet = getNetTransactionRevenue(tx)
            revenue += txNet
            const splits = parsePaymentSplits(tx)
            Object.entries(splits).forEach(([m, amt]) => {
                if (payMethods[m] && amt > 0) {
                    payMethods[m].count++
                    payMethods[m].total += amt
                }
            })

            const h = new Date(tx.created_at).getHours()
            hourlyBins[h].transaksi++
            hourlyBins[h].pendapatan += txNet

            tx.transaction_items?.forEach(item => {
                const type = item.item_type
                if (typeBreakdown[type]) {
                    typeBreakdown[type].qty += item.quantity || 0
                    typeBreakdown[type].total += Number(item.subtotal || 0)
                }
            })
        })

        // Filter hour bins to only show busy times (e.g. 08:00 to 21:00) to keep chart clean
        const activeHours = hourlyBins.filter((_, i) => i >= 8 && i <= 21)

        return {
            txList,
            revenue,
            totalTx: txList.length,
            payMethods,
            typeBreakdown,
            activeHours
        }
    }, [validTransactions, dailyReportDate, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 3: WEEKLY REPORT
    // ==========================================
    const weeklyData = useMemo(() => {
        const start = new Date(weeklyReportStart + 'T00:00:00')
        const end = new Date(start)
        end.setDate(start.getDate() + 7)

        // Previous Week dates for comparison
        const prevStart = new Date(start)
        prevStart.setDate(prevStart.getDate() - 7)
        const prevEnd = new Date(start)

        const txList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate < end
        })

        const prevTxList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate < prevEnd
        })

        let revenue = 0
        const daysOfWeek = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
        const dailyRevenue = daysOfWeek.map(day => ({ name: day, pendapatan: 0, transaksi: 0 }))
        const branchBreakdown = {}

        txList.forEach(tx => {
            const txNet = getNetTransactionRevenue(tx)
            revenue += txNet
            const dayIdx = new Date(tx.created_at).getDay()
            dailyRevenue[dayIdx].pendapatan += txNet
            dailyRevenue[dayIdx].transaksi++

            const brName = tx.branches?.name || 'Tanpa Cabang'
            if (!branchBreakdown[brName]) {
                branchBreakdown[brName] = { name: brName, count: 0, total: 0 }
            }
            branchBreakdown[brName].count++
            branchBreakdown[brName].total += txNet
        })

        // Sort chart starting from Monday
        const orderedRevenue = [
            dailyRevenue[1], // Senin
            dailyRevenue[2], // Selasa
            dailyRevenue[3], // Rabu
            dailyRevenue[4], // Kamis
            dailyRevenue[5], // Jumat
            dailyRevenue[6], // Sabtu
            dailyRevenue[0], // Minggu
        ]

        // Find busy days
        let busiestDay = '-'
        let maxTx = -1
        let highestRevDay = '-'
        let maxRev = -1

        dailyRevenue.forEach((d, idx) => {
            if (d.transaksi > maxTx) {
                maxTx = d.transaksi
                busiestDay = daysOfWeek[idx]
            }
            if (d.pendapatan > maxRev) {
                maxRev = d.pendapatan
                highestRevDay = daysOfWeek[idx]
            }
        })

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        return {
            txList,
            revenue,
            totalTx: txList.length,
            busiestDay: maxTx > 0 ? busiestDay : '-',
            highestRevDay: maxRev > 0 ? highestRevDay : '-',
            orderedRevenue,
            prevRevenue,
            growthPercent,
            branchBreakdown: Object.values(branchBreakdown)
        }
    }, [validTransactions, weeklyReportStart, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 4: MONTHLY REPORT
    // ==========================================
    const monthlyData = useMemo(() => {
        const start = new Date(monthlyReportYear, monthlyReportMonth, 1)
        const end = new Date(monthlyReportYear, monthlyReportMonth + 1, 0, 23, 59, 59, 999)

        const prevStart = new Date(monthlyReportYear, monthlyReportMonth - 1, 1)
        const prevEnd = new Date(monthlyReportYear, monthlyReportMonth, 0, 23, 59, 59, 999)

        const txList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        const prevTxList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate <= prevEnd
        })

        let revenue = 0
        
        // 4 Weekly bins
        const weekBins = [
            { name: 'Minggu 1', pendapatan: 0 },
            { name: 'Minggu 2', pendapatan: 0 },
            { name: 'Minggu 3', pendapatan: 0 },
            { name: 'Minggu 4+', pendapatan: 0 }
        ]

        // Top Selling Counters
        const treatments = {}
        const products = {}
        const coupons = {}
        const branchesMap = {}
        const payMethods = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }

        txList.forEach(tx => {
            const val = getNetTransactionRevenue(tx)
            revenue += val

            // Map payment method (support split payments)
            const splits = parsePaymentSplits(tx)
            Object.entries(splits).forEach(([m, amt]) => {
                if (payMethods[m] !== undefined) {
                    payMethods[m] += amt
                }
            })

            // Map weekly bins
            const day = new Date(tx.created_at).getDate()
            if (day <= 7) weekBins[0].pendapatan += val
            else if (day <= 14) weekBins[1].pendapatan += val
            else if (day <= 21) weekBins[2].pendapatan += val
            else weekBins[3].pendapatan += val

            // Map branches
            const brName = tx.branches?.name || 'Tanpa Cabang'
            if (!branchesMap[brName]) {
                branchesMap[brName] = { name: brName, count: 0, total: 0 }
            }
            branchesMap[brName].count++
            branchesMap[brName].total += val

            // Map top sellers
            tx.transaction_items?.forEach(item => {
                const qty = item.quantity || 0
                const name = item.name
                if (item.item_type === 'treatment') {
                    treatments[name] = (treatments[name] || 0) + qty
                } else if (item.item_type === 'product') {
                    products[name] = (products[name] || 0) + qty
                } else if (item.item_type === 'coupon') {
                    coupons[name] = (coupons[name] || 0) + qty
                }
            })
        })

        const topTreatments = Object.entries(treatments).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)
        const topProducts = Object.entries(products).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)
        const topCoupons = Object.entries(coupons).map(([name, qty]) => ({ name, qty })).sort((a,b) => b.qty - a.qty).slice(0, 5)

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        const daysInMonth = end.getDate()
        const dailyAvg = revenue / daysInMonth

        // Pie Chart Data
        const pieData = Object.entries(payMethods)
            .filter(([_, val]) => val > 0)
            .map(([name, value]) => ({ name: name.toUpperCase(), value }))

        return {
            txList,
            revenue,
            totalTx: txList.length,
            growthPercent,
            dailyAvg,
            weekBins,
            topTreatments,
            topProducts,
            topCoupons,
            branchBreakdown: Object.values(branchesMap),
            pieData
        }
    }, [validTransactions, monthlyReportMonth, monthlyReportYear, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 5: YEARLY REPORT
    // ==========================================
    const yearlyData = useMemo(() => {
        const start = new Date(yearlyReportYear, 0, 1)
        const end = new Date(yearlyReportYear, 11, 31, 23, 59, 59, 999)

        const prevStart = new Date(yearlyReportYear - 1, 0, 1)
        const prevEnd = new Date(yearlyReportYear - 1, 11, 31, 23, 59, 59, 999)

        const txList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= start && txDate <= end
        })

        const prevTxList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            if (filterBranch && tx.branch_id !== filterBranch) return false
            return txDate >= prevStart && txDate <= prevEnd
        })

        let revenue = 0
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
        const monthlyRevenue = months.map(m => ({ name: m, pendapatan: 0, transaksi: 0 }))

        const treatments = {}
        const products = {}
        const coupons = {}
        const branchPivot = {} // { BranchName: { Jan: 0, Feb: 0 ... } }

        txList.forEach(tx => {
            const val = getNetTransactionRevenue(tx)
            revenue += val

            const mIdx = new Date(tx.created_at).getMonth()
            monthlyRevenue[mIdx].pendapatan += val
            monthlyRevenue[mIdx].transaksi++

            // Branch comparison per month
            const brName = tx.branches?.name || 'Tanpa Cabang'
            if (!branchPivot[brName]) {
                branchPivot[brName] = months.reduce((acc, m) => ({ ...acc, [m]: 0 }), {})
            }
            branchPivot[brName][months[mIdx]] += val

            // Top items
            tx.transaction_items?.forEach(item => {
                const qty = item.quantity || 0
                const name = item.name
                if (item.item_type === 'treatment') {
                    treatments[name] = (treatments[name] || 0) + qty
                } else if (item.item_type === 'product') {
                    products[name] = (products[name] || 0) + qty
                } else if (item.item_type === 'coupon') {
                    coupons[name] = (coupons[name] || 0) + qty
                }
            })
        })

        let bestMonth = '-'
        let maxMRev = -1
        monthlyRevenue.forEach((m, idx) => {
            if (m.pendapatan > maxMRev) {
                maxMRev = m.pendapatan
                bestMonth = months[idx]
            }
        })

        // Comparisons
        const prevRevenue = prevTxList.reduce((sum, tx) => sum + getNetTransactionRevenue(tx), 0)
        let growthPercent = 0
        if (prevRevenue > 0) {
            growthPercent = ((revenue - prevRevenue) / prevRevenue) * 100
        } else if (revenue > 0) {
            growthPercent = 100
        }

        const topTreatment = Object.entries(treatments).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'
        const topProduct = Object.entries(products).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'
        const topCoupon = Object.entries(coupons).sort((a,b) => b[1] - a[1])[0]?.[0] || '-'

        // Pivot array helper
        const branchPivotList = Object.entries(branchPivot).map(([branchName, monthlyDataObj]) => ({
            branchName,
            ...monthlyDataObj
        }))

        return {
            txList,
            revenue,
            totalTx: txList.length,
            bestMonth: maxMRev > 0 ? bestMonth : '-',
            growthPercent,
            monthlyRevenue,
            topTreatment,
            topProduct,
            topCoupon,
            branchPivotList
        }
    }, [validTransactions, yearlyReportYear, filterBranch])


    // ==========================================
    // DATA COMPUTATIONS FOR TAB 6: CUSTOM REPORT
    // ==========================================
    const [customReportResult, setCustomReportResult] = useState(null)
    
    const handleGenerateCustomReport = () => {
        const start = new Date(customTabStart + 'T00:00:00')
        const end = new Date(customTabEnd + 'T23:59:59')

        const txList = validTransactions.filter(tx => {
            const txDate = new Date(tx.created_at)
            
            // Branch filter
            if (customTabBranch && tx.branch_id !== customTabBranch) return false

            // Type filter
            if (customTabTxType) {
                const hasType = tx.transaction_items?.some(item => item.item_type === customTabTxType)
                if (!hasType) return false
            }

            return txDate >= start && txDate <= end
        })

        let revenue = 0
        let treatmentQty = 0
        let productQty = 0
        let couponQty = 0
        let treatmentRevenue = 0
        let productRevenue = 0
        let couponRevenue = 0

        txList.forEach(tx => {
            revenue += getNetTransactionRevenue(tx)
            tx.transaction_items?.forEach(item => {
                const subtotal = Number(item.subtotal || 0)
                if (item.item_type === 'treatment') {
                    treatmentQty += item.quantity || 0
                    treatmentRevenue += subtotal
                } else if (item.item_type === 'product') {
                    productQty += item.quantity || 0
                    productRevenue += subtotal
                } else if (item.item_type === 'coupon') {
                    couponQty += item.quantity || 0
                    couponRevenue += subtotal
                }
            })
        })

        setCustomReportResult({
            txList,
            revenue,
            totalTx: txList.length,
            avg: txList.length > 0 ? revenue / txList.length : 0,
            treatmentQty,
            productQty,
            couponQty,
            treatmentRevenue,
            productRevenue,
            couponRevenue
        })
    }

    // Chart Colors
    const COLORS = ['#D46221', '#4E2A12', '#F2D8C3', '#E8B895', '#914214']

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="inline-block animate-spin w-10 h-10 border-4 border-ayumi-primary border-t-transparent rounded-full mb-4"></div>
                <p className="text-ayumi-primary font-semibold">Memuat data transaksi & laporan...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            
            {/* TAMPILAN UTAMA: GLOBAL FILTER BAR */}
            <div className="card-ayumi p-4 md:p-6 flex flex-col gap-4 bg-white relative">
                <div className="flex justify-end items-center gap-2">
                    {/* Excel & PDF Export Buttons in Top Right */}
                    <button
                        onClick={() => handleExcelExport('Main', 'Semua_Transaksi', filteredTransactions)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-green-600/20 flex items-center gap-2 transition-all cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export Excel
                    </button>
                    <button
                        onClick={() => handlePDFExport('Main', 'Semua_Transaksi', filteredTransactions)}
                        className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-orange-600/20 flex items-center gap-2 transition-all cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Cetak Laporan PDF
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 border-t border-gray-100 pt-4">
                    {/* Branch Filter */}
                    <BranchFilter
                        value={filterBranch}
                        onChange={setFilterBranch}
                        branches={branches}
                        userRole={dbUser?.role}
                        userBranchId={dbUser?.branch_id}
                    />

                    {/* Payment Method */}
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Metode Bayar</label>
                        <select
                            value={filterPaymentMethod}
                            onChange={(e) => setFilterPaymentMethod(e.target.value)}
                            className="input-ayumi py-2 text-xs bg-gray-50 font-semibold text-gray-700"
                        >
                            <option value="">Semua Metode</option>
                            <option value="cash">Cash</option>
                            <option value="transfer">Transfer Bank</option>
                            <option value="qris">QRIS</option>
                            <option value="debit">Debit</option>
                            <option value="credit">Credit</option>
                        </select>
                    </div>

                    {/* Tx Type */}
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tipe Item</label>
                        <select
                            value={filterTxType}
                            onChange={(e) => setFilterTxType(e.target.value)}
                            className="input-ayumi py-2 text-xs bg-gray-50 font-semibold text-gray-700"
                        >
                            <option value="">Semua Tipe</option>
                            <option value="treatment">Treatment</option>
                            <option value="product">Produk</option>
                            <option value="coupon">Kupon Paket</option>
                        </select>
                    </div>

                    {/* Rentang Tanggal Filter */}
                    <div className="col-span-1 sm:col-span-2 lg:col-span-2 flex flex-col relative z-20">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rentang Tanggal</label>
                        <DateRangePicker 
                            startDate={customStartDate}
                            endDate={customEndDate}
                            onChange={(range) => {
                                setCustomStartDate(range.startDate);
                                setCustomEndDate(range.endDate);
                            }}
                            inputClassName="w-full input-ayumi bg-gray-50 focus:bg-white text-xs py-2 px-3 rounded-lg"
                            align="right"
                        />
                    </div>
                </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Total Pendapatan */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-emerald-50/50 to-white shadow-sm border border-emerald-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Total Pendapatan</h4>
                        <p className="text-xl font-extrabold text-gray-800 tracking-tight mt-0.5">{formatCurrency(mainSummary.totalRevenue)}</p>
                    </div>
                </div>

                {/* Pendapatan Treatment */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-purple-50/50 to-white shadow-sm border border-purple-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 9.172V5L8 4z" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-purple-600 uppercase tracking-widest">Pendapatan Treatment</h4>
                        <p className="text-xl font-black text-gray-800  mt-0.5">{formatCurrency(mainSummary.treatmentRevenue)}</p>
                    </div>
                </div>

                {/* Pendapatan Skincare */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-gradient-to-br from-orange-50/50 to-white shadow-sm border border-orange-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Pendapatan Produk Skincare</h4>
                        <p className="text-xl font-black text-gray-800  mt-0.5">{formatCurrency(mainSummary.productRevenue)}</p>
                    </div>
                </div>

                {/* Total Transaksi */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-pink-100/50 text-ayumi-primary flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Transaksi</h4>
                        <p className="text-xl font-black text-gray-800 mt-0.5">{mainSummary.totalTx}</p>
                    </div>
                </div>

                {/* Rata-rata Penjualan */}
                <div className="card-ayumi p-5 flex items-center gap-4 bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100/50 text-blue-700 flex items-center justify-center shadow-inner shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    </div>
                    <div>
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rata-rata Penjualan</h4>
                        <p className="text-xl font-black text-gray-800  mt-0.5">{formatCurrency(mainSummary.avgRevenue)}</p>
                    </div>
                </div>

                {/* Item Terjual */}
                <div className="card-ayumi p-5 flex flex-col justify-center bg-white shadow-sm border border-pink-100 hover:shadow-md transition-all duration-300">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Kuantitas Item Terjual</h4>
                    <div className="flex justify-between items-center text-xs font-semibold text-gray-600">
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-purple-600 uppercase font-extrabold tracking-wider">Treatment</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.treatmentQty}</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-orange-600 uppercase font-extrabold tracking-wider">Produk</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.productQty}</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-pink-600 uppercase font-extrabold tracking-wider">Kupon</span>
                            <span className="font-bold text-sm text-gray-800 mt-0.5">{mainSummary.couponQty}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* SIX TABS NAVIGATION */}
            <div className="flex overflow-x-auto gap-2 border-b border-gray-200 hide-scrollbar pt-2">
                {[
                    { id: 'all', label: 'Semua Transaksi' },
                    { id: 'daily', label: 'Laporan Harian' },
                    { id: 'weekly', label: 'Laporan Mingguan' },
                    { id: 'monthly', label: 'Laporan Bulanan' },
                    { id: 'yearly', label: 'Laporan Tahunan' },
                    { id: 'custom', label: 'Custom Report' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveMainTab(tab.id)}
                        className={`px-5 py-3 text-sm font-bold transition-all rounded-t-xl shrink-0 ${
                            activeMainTab === tab.id
                            ? 'bg-white text-ayumi-primary border-t-2 border-x border-[#fce7f3] border-b-0'
                            : 'text-gray-500 hover:text-ayumi-primary hover:bg-white/50 border border-transparent'
                        }`}
                        style={{ marginBottom: activeMainTab === tab.id ? '-1px' : '0' }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* TAB PANES CONTENT CONTAINER */}
            <div className="bg-white rounded-b-2xl rounded-tr-2xl shadow-sm border border-gray-100 p-4 md:p-6 min-h-[400px]">

                {/* ======================================================== */}
                {/* TAB 1: ALL TRANSACTIONS */}
                {/* ======================================================== */}
                {activeMainTab === 'all' && (
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold text-ayumi-secondary">Daftar Transaksi</h3>
                        {filteredTransactions.length === 0 ? (
                            <div className="p-10 text-center text-gray-400">Tidak ada transaksi ditemukan. Silakan ubah filter.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="whitespace-nowrap w-full text-left border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-ayumi-table-header text-ayumi-secondary font-bold border-b border-gray-100">
                                            <th className="p-4">No. Transaksi</th>
                                            <th className="p-4">Tanggal & Jam</th>
                                            <th className="p-4">Pasien</th>
                                            <th className="p-4">Cabang</th>
                                            <th className="p-4">Ringkasan Item</th>
                                            <th className="p-4 text-center">Metode Bayar</th>
                                            <th className="p-4 text-right">Total</th>
                                            <th className="p-4 text-center">Status</th>
                                            <th className="p-4 text-center">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {filteredTransactions.map((tx) => {
                                            // Compute brief summary string
                                            let t = 0, p = 0, c = 0
                                            tx.transaction_items?.forEach(i => {
                                                if (i.item_type === 'treatment') t += i.quantity
                                                if (i.item_type === 'product') p += i.quantity
                                                if (i.item_type === 'coupon') c += i.quantity
                                            })
                                            const summaryStr = [
                                                t > 0 ? `${t} Treatment` : null,
                                                p > 0 ? `${p} Produk` : null,
                                                c > 0 ? `${c} Kupon` : null
                                            ].filter(Boolean).join(', ') || '0 Item'

                                            // Payment Method badge color
                                            let payBadgeClass = "bg-gray-100 text-gray-700 border-gray-200"
                                            if (tx.payment_method === 'cash') payBadgeClass = "bg-pink-50 text-pink-700 border-pink-100"
                                            if (tx.payment_method === 'transfer') payBadgeClass = "bg-blue-50 text-blue-700 border-blue-100"
                                            if (tx.payment_method === 'qris') payBadgeClass = "bg-green-50 text-green-700 border-green-100"
                                            if (tx.payment_method === 'debit' || tx.payment_method === 'credit') payBadgeClass = "bg-purple-50 text-purple-700 border-purple-100"

                                            return (
                                                <tr 
                                                    key={tx.id} 
                                                    onClick={() => openDetailModal(tx)} 
                                                    className={`hover:bg-ayumi-table-hover transition-colors cursor-pointer group ${tx.payment_status === 'void' ? 'opacity-70 bg-rose-50/20' : ''}`}
                                                >
                                                    <td className="p-4 font-bold text-gray-800 text-xs">
                                                        <span className={tx.payment_status === 'void' ? 'line-through text-gray-400' : ''}>{tx.transaction_number}</span>
                                                    </td>
                                                    <td className="p-4 text-gray-600 text-xs">{formatDate(tx.created_at)}</td>
                                                    <td className="p-4">
                                                        {tx.patient_id ? (
                                                            <Link 
                                                                href={`/patients/${tx.patient_id}`}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="font-extrabold text-ayumi-primary hover:text-ayumi-secondary hover:underline transition-colors inline-flex items-center gap-1 group/p text-sm"
                                                                title="Buka Rekam Medis & Riwayat Pasien"
                                                            >
                                                                <span>{tx.patients?.full_name || 'Walk-in Customer'}</span>
                                                                <span className="text-[11px] text-ayumi-primary group-hover/p:translate-x-0.5 group-hover/p:-translate-y-0.5 transition-transform">↗</span>
                                                            </Link>
                                                        ) : (
                                                            <span className="font-extrabold text-gray-800 text-sm">{tx.patients?.full_name || 'Walk-in Customer'}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-gray-500 font-semibold text-xs">{tx.branches?.name || '-'}</td>
                                                    <td className="p-4 text-gray-600 text-xs font-semibold">{summaryStr}</td>
                                                    <td className="p-4 text-center">
                                                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${payBadgeClass}`}>{tx.payment_method}</span>
                                                    </td>
                                                    <td className={`p-4 text-right font-bold ${tx.payment_status === 'void' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                                                        {formatCurrency(tx.total)}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {tx.payment_status === 'void' ? (
                                                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-700 border border-rose-200">
                                                                VOID
                                                            </span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-800 border border-green-200">
                                                                LUNAS
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); openDetailModal(tx) }}
                                                            className="text-xs font-bold text-ayumi-primary hover:text-ayumi-secondary bg-pink-50 hover:bg-pink-100 px-3 py-1 rounded-lg transition-colors"
                                                        >
                                                            Lihat
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 2: LAPORAN HARIAN */}
                {/* ======================================================== */}
                {activeMainTab === 'daily' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Tanggal:</label>
                                <DateRangePicker 
                                    startDate={dailyReportDate}
                                    endDate={dailyReportDate}
                                    singleDate={true}
                                    onChange={(range) => {
                                        if (range.startDate) setDailyReportDate(range.startDate);
                                    }}
                                    inputClassName="text-xs font-semibold py-1.5 bg-white shadow-sm"
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Harian', `Harian_${dailyReportDate}`, dailyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Harian', `Harian_${dailyReportDate}`, dailyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {/* Summary metrics for daily */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
                                <div>
                                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Transaksi Hari Ini</h5>
                                    <p className="text-2xl font-black text-gray-800">{dailyData.totalTx}</p>
                                </div>
                                <div className="text-ayumi-primary bg-pink-50 p-3 rounded-xl"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg></div>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
                                <div>
                                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Pendapatan Hari Ini</h5>
                                    <p className="text-2xl font-black text-gray-800  text-green-600">{formatCurrency(dailyData.revenue)}</p>
                                </div>
                                <div className="text-green-600 bg-green-50 p-3 rounded-xl"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
                            </div>
                        </div>

                        {/* Breakdown tables */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Payment method breakdown */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Metode Pembayaran</h4>
                                <table className="whitespace-nowrap w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                            <th className="p-3">Metode Bayar</th>
                                            <th className="p-3 text-center">Jumlah Transaksi</th>
                                            <th className="p-3 text-right">Pendapatan</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {Object.entries(dailyData.payMethods).map(([method, data]) => (
                                            <tr key={method} className="hover:bg-gray-50/50">
                                                <td className="p-3 font-bold uppercase text-gray-700">{method}</td>
                                                <td className="p-3 text-center font-bold text-gray-600">{data.count}</td>
                                                <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(data.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Item Type breakdown */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Tipe Produk / Layanan</h4>
                                <table className="whitespace-nowrap w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                            <th className="p-3">Tipe Item</th>
                                            <th className="p-3 text-center">Jumlah Terjual</th>
                                            <th className="p-3 text-right">Total Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {Object.entries(dailyData.typeBreakdown).map(([type, data]) => (
                                            <tr key={type} className="hover:bg-gray-50/50">
                                                <td className="p-3 font-bold capitalize text-gray-700">
                                                    {type === 'treatment' ? 'Layanan Treatment' : type === 'product' ? 'Produk Fisik' : 'Kupon Paket'}
                                                </td>
                                                <td className="p-3 text-center font-bold text-gray-600">{data.qty}</td>
                                                <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(data.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Chart: Busy Hours */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Jam Tersibuk (Transaksi Per Jam)</h4>
                            <div className="h-64">
                                {isMounted ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={dailyData.activeHours} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#888' }} />
                                            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#888' }} />
                                            <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Bar dataKey="transaksi" fill="#D46221" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                )}
                            </div>
                        </div>

                        {/* Daily Transactions list */}
                        <div className="space-y-3">
                            <h4 className="text-sm font-bold text-ayumi-secondary">List Transaksi Hari Terkait</h4>
                            {dailyData.txList.length === 0 ? (
                                <div className="text-center p-5 md:p-8 text-gray-400 bg-gray-50 rounded-xl">Tidak ada transaksi pada tanggal ini.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-100">
                                                <th className="p-3">No. Transaksi</th>
                                                <th className="p-3">Waktu</th>
                                                <th className="p-3">Pasien</th>
                                                <th className="p-3">Metode</th>
                                                <th className="p-3 text-right">Total</th>
                                                <th className="p-3 text-center">Status</th>
                                                <th className="p-3 text-center">Detail</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {dailyData.txList.map(tx => (
                                                <tr key={tx.id} onClick={() => openDetailModal(tx)} className="hover:bg-gray-50/50 cursor-pointer">
                                                    <td className="p-3 font-bold text-gray-800">{tx.transaction_number}</td>
                                                    <td className="p-3 text-gray-500">
                                                        {new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="p-3 font-bold text-gray-700">{tx.patients?.full_name || 'Walk-in'}</td>
                                                    <td className="p-3 uppercase font-bold text-gray-500 text-[10px]">{tx.payment_method}</td>
                                                    <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(tx.total)}</td>
                                                    <td className="p-3 text-center"><span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-[9px] font-bold">LUNAS</span></td>
                                                    <td className="p-3 text-center">
                                                        <button className="text-xs text-ayumi-primary font-semibold hover:underline">Lihat</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 3: LAPORAN MINGGUAN */}
                {/* ======================================================== */}
                {activeMainTab === 'weekly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Minggu (Mulai Senin):</label>
                                <DateRangePicker 
                                    startDate={weeklyReportStart}
                                    endDate={(() => {
                                        const d = new Date(weeklyReportStart);
                                        d.setDate(d.getDate() + 6);
                                        return d.toISOString().split('T')[0];
                                    })()}
                                    onChange={(range) => {
                                        if (range.startDate) {
                                            setWeeklyReportStart(getStartOfWeek(range.startDate).toISOString().split('T')[0]);
                                        }
                                    }}
                                    inputClassName="text-xs font-semibold py-1.5 bg-white shadow-sm"
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Mingguan', `Mingguan_Mulai_${weeklyReportStart}`, weeklyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Mingguan', `Mingguan_Mulai_${weeklyReportStart}`, weeklyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {/* Weekly summaries */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Minggu Ini</h5>
                                <p className="text-2xl font-black text-gray-800">{weeklyData.totalTx}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                <p className="text-2xl font-black text-green-600 ">{formatCurrency(weeklyData.revenue)}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Hari Tersibuk (Trx)</h5>
                                <p className="text-lg font-black text-ayumi-primary">{weeklyData.busiestDay}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pendapatan Tertinggi</h5>
                                <p className="text-lg font-black text-purple-700">{weeklyData.highestRevDay}</p>
                            </div>
                        </div>

                        {/* Comparison vs last week */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                            <div>
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Perbandingan dengan Minggu Lalu</h4>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-gray-600">Pendapatan Minggu Lalu: <strong className=" text-gray-800">{formatCurrency(weeklyData.prevRevenue)}</strong></span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${weeklyData.growthPercent >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {weeklyData.growthPercent >= 0 ? `▲ +${weeklyData.growthPercent.toFixed(1)}%` : `▼ ${weeklyData.growthPercent.toFixed(1)}%`}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Chart: Revenue per day */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Hari (Senin - Minggu)</h4>
                            <div className="h-64">
                                {isMounted ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={weeklyData.orderedRevenue} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                            <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Bar dataKey="pendapatan" fill="#6B3A5A" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                )}
                            </div>
                        </div>

                        {/* Branch Breakdown for Owner & Admin */}
                        {(!dbUser || dbUser.role === 'owner') && (
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                                <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown Pendapatan per Cabang</h4>
                                <table className="whitespace-nowrap w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                            <th className="p-3">Cabang</th>
                                            <th className="p-3 text-center">Jumlah Transaksi</th>
                                            <th className="p-3 text-right">Total Pendapatan</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {weeklyData.branchBreakdown.map(b => (
                                            <tr key={b.name} className="hover:bg-gray-50/50">
                                                <td className="p-3 font-bold text-gray-700">{b.name}</td>
                                                <td className="p-3 text-center font-bold text-gray-600">{b.count}</td>
                                                <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(b.total)}</td>
                                            </tr>
                                        ))}
                                        {weeklyData.branchBreakdown.length === 0 && (
                                            <tr><td colSpan="3" className="p-3 text-center text-gray-400">Tidak ada data per cabang.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 4: LAPORAN BULANAN */}
                {/* ======================================================== */}
                {activeMainTab === 'monthly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Bulan & Tahun:</label>
                                <select
                                    value={monthlyReportMonth}
                                    onChange={(e) => setMonthlyReportMonth(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-36 shadow-sm"
                                >
                                    {['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'].map((m, idx) => (
                                        <option key={idx} value={idx}>{m}</option>
                                    ))}
                                </select>
                                <select
                                    value={monthlyReportYear}
                                    onChange={(e) => setMonthlyReportYear(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-28 shadow-sm"
                                >
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Bulanan', `Bulanan_${monthlyReportMonth + 1}_${monthlyReportYear}`, monthlyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Bulanan', `Bulanan_${monthlyReportMonth + 1}_${monthlyReportYear}`, monthlyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {/* Monthly summaries */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Bulan Ini</h5>
                                <p className="text-2xl font-black text-gray-800">{monthlyData.totalTx}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                <p className="text-2xl font-black text-green-600 ">{formatCurrency(monthlyData.revenue)}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pertumbuhan vs Bulan Lalu</h5>
                                <span className={`text-lg font-black ${monthlyData.growthPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {monthlyData.growthPercent >= 0 ? `▲ +${monthlyData.growthPercent.toFixed(1)}%` : `▼ ${monthlyData.growthPercent.toFixed(1)}%`}
                                </span>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rata-rata Pendapatan / Hari</h5>
                                <p className="text-lg font-black text-purple-700 ">{formatCurrency(monthlyData.dailyAvg)}</p>
                            </div>
                        </div>

                        {/* Charts layout */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Revenue by week line chart */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm lg:col-span-2">
                                <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Minggu</h4>
                                <div className="h-64">
                                    {isMounted ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={monthlyData.weekBins} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                                <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                                <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                                <Line type="monotone" dataKey="pendapatan" stroke="#D46221" strokeWidth={3} activeDot={{ r: 6 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                    )}
                                </div>
                            </div>

                            {/* Donut Chart of Payment Methods */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Breakdown Metode Bayar (Volume)</h4>
                                <div className="h-64 flex flex-col items-center justify-center">
                                    {isMounted ? (
                                        monthlyData.pieData.length > 0 ? (
                                            <div className="relative w-full h-full">
                                                <ResponsiveContainer width="100%" height="90%">
                                                    <PieChart>
                                                        <Pie
                                                            data={monthlyData.pieData}
                                                            cx="50%"
                                                            cy="50%"
                                                            innerRadius={60}
                                                            outerRadius={80}
                                                            paddingAngle={3}
                                                            dataKey="value"
                                                        >
                                                            {monthlyData.pieData.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip formatter={(value) => formatCurrency(value)} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                                {/* Legend */}
                                                <div className="flex flex-wrap justify-center gap-2 text-[9px] font-bold text-gray-500 mt-[-20px]">
                                                    {monthlyData.pieData.map((entry, index) => (
                                                        <span key={entry.name} className="flex items-center gap-1">
                                                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                                                            {entry.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-gray-400">Tidak ada data pembayaran.</p>
                                        )
                                    ) : (
                                        <div className="w-40 h-40 rounded-full border-8 border-gray-100 border-t-purple-500 animate-spin" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Top 5 Best Sellers Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Treatments */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-700 border-b border-purple-50 pb-2 mb-3">Top 5 Treatment Terlaris</h4>
                                <ol className="space-y-2 text-xs font-semibold text-gray-700">
                                    {monthlyData.topTreatments.map((item, idx) => (
                                        <li key={item.name} className="flex justify-between items-center py-1">
                                            <span>{idx + 1}. {item.name}</span>
                                            <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold ">{item.qty}x</span>
                                        </li>
                                    ))}
                                    {monthlyData.topTreatments.length === 0 && <p className="text-gray-400 italic">Belum ada data.</p>}
                                </ol>
                            </div>

                            {/* Products */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-orange-600 border-b border-orange-50 pb-2 mb-3">Top 5 Produk Terlaris</h4>
                                <ol className="space-y-2 text-xs font-semibold text-gray-700">
                                    {monthlyData.topProducts.map((item, idx) => (
                                        <li key={item.name} className="flex justify-between items-center py-1">
                                            <span>{idx + 1}. {item.name}</span>
                                            <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold ">{item.qty}x</span>
                                        </li>
                                    ))}
                                    {monthlyData.topProducts.length === 0 && <p className="text-gray-400 italic">Belum ada data.</p>}
                                </ol>
                            </div>

                            {/* Coupons */}
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-pink-600 border-b border-pink-50 pb-2 mb-3">Top 5 Paket Kupon Terlaris</h4>
                                <ol className="space-y-2 text-xs font-semibold text-gray-700">
                                    {monthlyData.topCoupons.map((item, idx) => (
                                        <li key={item.name} className="flex justify-between items-center py-1">
                                            <span>{idx + 1}. {item.name}</span>
                                            <span className="bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full font-bold ">{item.qty}x</span>
                                        </li>
                                    ))}
                                    {monthlyData.topCoupons.length === 0 && <p className="text-gray-400 italic">Belum ada data.</p>}
                                </ol>
                            </div>
                        </div>

                        {/* Branch breakdown table */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                            <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Breakdown per Cabang Bulan Ini</h4>
                            <table className="whitespace-nowrap w-full text-left text-xs">
                                <thead>
                                    <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                                        <th className="p-3">Cabang</th>
                                        <th className="p-3 text-center">Jumlah Transaksi</th>
                                        <th className="p-3 text-right">Total Pendapatan</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {monthlyData.branchBreakdown.map(b => (
                                        <tr key={b.name} className="hover:bg-gray-50/50">
                                            <td className="p-3 font-bold text-gray-700">{b.name}</td>
                                            <td className="p-3 text-center font-bold text-gray-600">{b.count}</td>
                                            <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(b.total)}</td>
                                        </tr>
                                    ))}
                                    {monthlyData.branchBreakdown.length === 0 && (
                                        <tr><td colSpan="3" className="p-3 text-center text-gray-400">Tidak ada data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 5: LAPORAN TAHUNAN */}
                {/* ======================================================== */}
                {activeMainTab === 'yearly' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-pink-50/30 p-4 rounded-2xl border border-pink-100/50">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-bold text-ayumi-secondary">Pilih Tahun:</label>
                                <select
                                    value={yearlyReportYear}
                                    onChange={(e) => setYearlyReportYear(Number(e.target.value))}
                                    className="input-ayumi py-1.5 px-3 text-sm bg-white w-36 shadow-sm"
                                >
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => handleExcelExport('Tahunan', `Tahunan_${yearlyReportYear}`, yearlyData.txList)}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial"
                                >
                                    Export Excel
                                </button>
                                <button
                                    onClick={() => handlePDFExport('Tahunan', `Tahunan_${yearlyReportYear}`, yearlyData.txList)}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Cetak PDF
                                </button>
                            </div>
                        </div>

                        {/* Yearly summaries */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi Tahun Ini</h5>
                                <p className="text-2xl font-black text-gray-800">{yearlyData.totalTx}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan Setahun</h5>
                                <p className="text-2xl font-black text-green-600 ">{formatCurrency(yearlyData.revenue)}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Bulan Terbaik (Pendapatan)</h5>
                                <p className="text-xl font-black text-ayumi-primary">{yearlyData.bestMonth}</p>
                            </div>
                            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">YoY Growth</h5>
                                <span className={`text-lg font-black ${yearlyData.growthPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {yearlyData.growthPercent >= 0 ? `▲ +${yearlyData.growthPercent.toFixed(1)}%` : `▼ ${yearlyData.growthPercent.toFixed(1)}%`}
                                </span>
                            </div>
                        </div>

                        {/* Chart: Revenue per month */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <h4 className="text-sm font-bold text-ayumi-secondary mb-4">Grafik Pendapatan per Bulan</h4>
                            <div className="h-64">
                                {isMounted ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={yearlyData.monthlyRevenue} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
                                            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
                                            <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                                            <Line type="monotone" dataKey="pendapatan" stroke="#6B3A5A" strokeWidth={3} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full bg-gray-50 animate-pulse rounded-2xl" />
                                )}
                            </div>
                        </div>

                        {/* Best Selling Items of the Year */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-purple-50/20 p-5 rounded-2xl border border-purple-100/50">
                            <div>
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Treatment Tahun Ini</h5>
                                <p className="text-base font-extrabold text-purple-900">{yearlyData.topTreatment}</p>
                            </div>
                            <div>
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Produk Tahun Ini</h5>
                                <p className="text-base font-extrabold text-orange-700">{yearlyData.topProduct}</p>
                            </div>
                            <div>
                                <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top Kupon Tahun Ini</h5>
                                <p className="text-base font-extrabold text-pink-700">{yearlyData.topCoupon}</p>
                            </div>
                        </div>

                        {/* Pivot comparison table */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                            <h4 className="text-sm font-bold text-ayumi-secondary mb-3">Tabel Perbandingan Cabang per Bulan</h4>
                            <table className="whitespace-nowrap w-full text-left text-[11px] border-collapse min-w-[700px]">
                                <thead>
                                    <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                                        <th className="p-2">Cabang</th>
                                        {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].map(m => (
                                            <th key={m} className="p-2 text-right">{m}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 font-medium text-gray-700">
                                    {yearlyData.branchPivotList.map(row => (
                                        <tr key={row.branchName} className="hover:bg-gray-50/50">
                                            <td className="p-2 font-bold text-gray-900">{row.branchName}</td>
                                            {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].map(m => (
                                                <td key={m} className="p-2 text-right  text-[10px]">{row[m] > 0 ? formatCurrency(row[m]).substring(3) : '-'}</td>
                                            ))}
                                        </tr>
                                    ))}
                                    {yearlyData.branchPivotList.length === 0 && (
                                        <tr><td colSpan="13" className="p-4 text-center text-gray-400">Tidak ada data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}


                {/* ======================================================== */}
                {/* TAB 6: CUSTOM REPORT */}
                {/* ======================================================== */}
                {activeMainTab === 'custom' && (
                    <div className="space-y-6">
                        <div className="card-ayumi p-5 bg-gradient-to-r from-pink-50/30 to-purple-50/30 border border-pink-100/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                            <div className="col-span-1 sm:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 mb-1">Rentang Tanggal Custom</label>
                                <DateRangePicker 
                                    startDate={customTabStart}
                                    endDate={customTabEnd}
                                    onChange={(range) => {
                                        setCustomTabStart(range.startDate);
                                        setCustomTabEnd(range.endDate);
                                    }}
                                    inputClassName="text-xs font-semibold bg-white py-2 w-full"
                                />
                            </div>
                            {(!dbUser || dbUser.role === 'owner') ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Cabang</label>
                                    <select
                                        value={customTabBranch}
                                        onChange={(e) => setCustomTabBranch(e.target.value)}
                                        className="input-ayumi text-sm bg-white"
                                    >
                                        <option value="">Semua Cabang</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="text-xs font-bold text-ayumi-secondary bg-white p-3 rounded-xl border border-pink-100">
                                    Cabang: {branches.find(b => b.id === customTabBranch)?.name || 'Klinik Anda'}
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Tipe Item</label>
                                <select
                                    value={customTabTxType}
                                    onChange={(e) => setCustomTabTxType(e.target.value)}
                                    className="input-ayumi text-sm bg-white"
                                >
                                    <option value="">Semua Tipe</option>
                                    <option value="treatment">Treatment</option>
                                    <option value="product">Produk</option>
                                    <option value="coupon">Kupon Paket</option>
                                </select>
                            </div>

                            <div className="sm:col-span-2 lg:col-span-4 flex justify-between gap-3 pt-2">
                                <button
                                    onClick={handleGenerateCustomReport}
                                    className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex-1"
                                >
                                    Generate Laporan
                                </button>
                                {customReportResult && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleExcelExport('Custom', `Custom_${customTabStart}_s.d_${customTabEnd}`, customReportResult.txList)}
                                            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer"
                                        >
                                            Export Excel
                                        </button>
                                        <button
                                            onClick={() => handlePDFExport('Custom', `Custom_${customTabStart}_s.d_${customTabEnd}`, customReportResult.txList)}
                                            className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                            Cetak PDF
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Render generated report result */}
                        {customReportResult ? (
                            <div className="space-y-6">
                                {/* Custom summaries */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Transaksi</h5>
                                        <p className="text-xl font-black text-gray-800">{customReportResult.totalTx}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Pendapatan</h5>
                                        <p className="text-xl font-black text-green-600 ">{formatCurrency(customReportResult.revenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-purple-500 uppercase tracking-wider mb-1">Pendapatan Treatment</h5>
                                        <p className="text-xl font-black text-purple-700 ">{formatCurrency(customReportResult.treatmentRevenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-orange-500 uppercase tracking-wider mb-1">Pendapatan Produk</h5>
                                        <p className="text-xl font-black text-orange-700 ">{formatCurrency(customReportResult.productRevenue)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rata-rata Penjualan</h5>
                                        <p className="text-xl font-black text-purple-700 ">{formatCurrency(customReportResult.avg)}</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                                        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 font-semibold text-gray-400">Total Item Terjual</h5>
                                        <div className="flex justify-between items-center text-[10px] font-bold text-gray-600 mt-1">
                                            <span>Trt: {customReportResult.treatmentQty}</span>
                                            <span>Prd: {customReportResult.productQty}</span>
                                            <span>Kpn: {customReportResult.couponQty}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Custom matching transactions list table */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-ayumi-secondary">Detail Pencarian Laporan</h4>
                                    {customReportResult.txList.length === 0 ? (
                                        <div className="text-center p-5 md:p-8 text-gray-400 bg-gray-50 rounded-xl">Tidak ada transaksi yang cocok.</div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="whitespace-nowrap w-full text-left border-collapse text-xs">
                                                <thead>
                                                    <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-100">
                                                        <th className="p-3">No. Transaksi</th>
                                                        <th className="p-3">Tanggal</th>
                                                        <th className="p-3">Cabang</th>
                                                        <th className="p-3">Pasien</th>
                                                        <th className="p-3">Metode</th>
                                                        <th className="p-3 text-right">Total</th>
                                                        <th className="p-3 text-center">Detail</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {customReportResult.txList.map(tx => (
                                                        <tr key={tx.id} onClick={() => openDetailModal(tx)} className="hover:bg-gray-50/50 cursor-pointer">
                                                            <td className="p-3 font-bold text-gray-800">{tx.transaction_number}</td>
                                                            <td className="p-3 text-gray-500">{formatDate(tx.created_at)}</td>
                                                            <td className="p-3 text-gray-500 font-semibold">{tx.branches?.name || '-'}</td>
                                                            <td className="p-3 font-bold text-gray-700">{tx.patients?.full_name || 'Walk-in'}</td>
                                                            <td className="p-3 uppercase font-bold text-gray-500 text-[10px]">{tx.payment_method}</td>
                                                            <td className="p-3 text-right  font-bold text-gray-800">{formatCurrency(tx.total)}</td>
                                                            <td className="p-3 text-center">
                                                                <button className="text-xs text-ayumi-primary font-semibold hover:underline">Lihat</button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-12 text-gray-400 bg-gray-50 rounded-2xl font-semibold">Tentukan rentang tanggal dan klik "Generate Laporan".</div>
                        )}
                    </div>
                )}

            </div>


            {/* ======================================================== */}
            {/* TRANSACTION DETAIL MODAL */}
            {/* ======================================================== */}
            {isDetailModalOpen && selectedTx && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-pink-100 flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-pink-50/30">
                            <div>
                                <h3 className="font-extrabold text-ayumi-secondary text-sm">Rincian Transaksi</h3>
                                <p className="text-[10px] text-gray-400 font-bold tracking-wider uppercase ">{selectedTx.transaction_number}</p>
                            </div>
                            <button
                                onClick={closeDetailModal}
                                className="text-gray-400 hover:text-gray-600 bg-white p-1.5 rounded-full border border-gray-100 shadow-sm"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* Modal Content - Scrollable */}
                        <div className="p-4 md:p-6 overflow-y-auto space-y-4 text-xs font-semibold text-gray-700 flex-1">
                            {/* Void Banner Notice */}
                            {selectedTx.payment_status === 'void' && (
                                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5 text-rose-800">
                                    <span className="text-rose-600 text-lg leading-none">🚫</span>
                                    <div>
                                        <p className="font-black text-rose-900 text-xs tracking-wide">STATUS: DIBATALKAN (VOID)</p>
                                        <p className="text-[11px] font-medium text-rose-700 mt-0.5 leading-relaxed">
                                            Transaksi ini telah dibatalkan dan tidak dihitung ke pendapatan/omzet klinik.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Transaction Info Grid */}
                            <div className="grid grid-cols-2 gap-3 border-b border-dashed border-gray-200 pb-3">
                                <div>
                                    <span className="block text-[9px] text-gray-400 font-bold uppercase">Tanggal (Terkunci)</span>
                                    <span className="text-gray-800 font-bold">{formatDate(selectedTx.created_at)}</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-gray-400 font-bold uppercase">Kasir</span>
                                    <span>{selectedTx.users?.full_name || 'System Admin'}</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-gray-400 font-bold uppercase">Klinik Cabang</span>
                                    <span>{selectedTx.branches?.name || '-'}</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] text-gray-400 font-bold uppercase">Metode Pembayaran</span>
                                    {isEditingTx ? (
                                        <select
                                            value={editTxData.payment_method}
                                            onChange={(e) => setEditTxData(prev => ({ ...prev, payment_method: e.target.value }))}
                                            className="w-full p-1 border rounded text-[10px] focus:outline-none focus:border-ayumi-primary font-bold uppercase text-ayumi-primary bg-white"
                                        >
                                            <option value="cash">CASH</option>
                                            <option value="transfer">TRANSFER</option>
                                            <option value="qris">QRIS</option>
                                            <option value="debit">DEBIT</option>
                                            <option value="credit">CREDIT</option>
                                        </select>
                                    ) : (
                                        <span className="uppercase text-ayumi-primary font-bold">{selectedTx.payment_method}</span>
                                    )}
                                </div>
                            </div>

                            {/* Patient Info */}
                            <div className="bg-gray-50/70 p-3 rounded-xl border border-gray-100 flex items-center justify-between gap-2">
                                <div>
                                    <span className="block text-[9px] text-gray-400 font-bold uppercase mb-0.5">Informasi Pasien</span>
                                    <p className="font-extrabold text-gray-800 text-sm">{selectedTx.patients?.full_name || 'Walk-in Customer'}</p>
                                    {selectedTx.patients?.whatsapp && (
                                        <p className="text-[10px] text-gray-500 mt-0.5">WhatsApp: {selectedTx.patients.whatsapp}</p>
                                    )}
                                </div>
                                {selectedTx.patient_id && (
                                    <Link
                                        href={`/patients/${selectedTx.patient_id}`}
                                        className="px-3.5 py-2 bg-pink-50 hover:bg-pink-100 text-ayumi-primary text-xs font-extrabold rounded-xl transition-colors border border-pink-200 shrink-0 flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
                                        title="Buka Rekam Medis & Riwayat Lengkap Pasien"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        <span>Buka Riwayat Pasien</span>
                                        <span>↗</span>
                                    </Link>
                                )}
                            </div>

                            {/* Itemized Table */}
                            <div>
                                <span className="block text-[9px] text-gray-400 font-bold uppercase mb-2">Item Belanja</span>
                                <div className="space-y-2">
                                    {selectedTx.transaction_items?.map((item) => (
                                        <div key={item.id} className="flex justify-between items-start py-1.5 border-b border-gray-50 last:border-0">
                                            <div className="flex-1">
                                                <p className="font-bold text-gray-800 text-[11px] leading-tight pr-4">{item.name}</p>
                                                <span className="text-[10px] text-gray-400  font-medium">Rp {Number(item.price).toLocaleString('id-ID')} x{item.quantity}</span>
                                            </div>
                                            <span className=" font-bold text-gray-800 text-[11px]">{formatCurrency(item.subtotal)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Calculations */}
                            <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5 font-bold">
                                <div className="flex justify-between text-gray-500">
                                    <span>Subtotal</span>
                                    <span className="">{formatCurrency(selectedTx.subtotal)}</span>
                                </div>
                                {selectedTx.discount > 0 && (
                                    <div className="flex justify-between text-red-500">
                                        <span>Potongan Diskon</span>
                                        <span className="">- {formatCurrency(selectedTx.discount)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm border-t border-gray-100 pt-2 text-gray-900 font-black">
                                    <span>TOTAL BAYAR</span>
                                    <span className=" text-base text-ayumi-secondary">{formatCurrency(selectedTx.total)}</span>
                                </div>
                            </div>

                            {/* Notes if exists */}
                            {(isEditingTx || selectedTx.notes) && (
                                <div className="bg-yellow-50/50 p-2.5 rounded-lg border border-yellow-100 text-[10px] text-yellow-800 leading-relaxed">
                                    <strong>Catatan:</strong>
                                    {isEditingTx ? (
                                        <textarea
                                            value={editTxData.notes}
                                            onChange={(e) => setEditTxData(prev => ({ ...prev, notes: e.target.value }))}
                                            rows="2"
                                            className="w-full mt-1 p-1.5 border border-yellow-200 rounded text-[10px] bg-white text-gray-800 focus:outline-none focus:border-ayumi-primary resize-none"
                                            placeholder="Catatan transaksi..."
                                        />
                                    ) : (
                                        <span> {selectedTx.notes}</span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modal Action Buttons */}
                        <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
                            {isEditingTx ? (
                                <>
                                    <button
                                        onClick={handleSaveEditedTx}
                                        className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all"
                                    >
                                        Simpan
                                    </button>
                                    <button
                                        onClick={() => setIsEditingTx(false)}
                                        className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                    >
                                        Batal
                                    </button>
                                </>
                            ) : (
                                <>
                                    {(dbUser?.role === 'owner' || dbUser?.role === 'admin') && (
                                        <>
                                            <button
                                                onClick={() => setIsEditingTx(true)}
                                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                            >
                                                Edit
                                            </button>
                                            {selectedTx?.payment_status !== 'void' && (
                                                <button
                                                    onClick={() => handleVoidTx(selectedTx)}
                                                    className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                                    title="Batalkan Transaksi (VOID) & Kembalikan Stok/Kupon"
                                                >
                                                    Batalkan (Void)
                                                </button>
                                            )}
                                            {dbUser?.role === 'owner' && (
                                                <button
                                                    onClick={() => handleDeleteTx(selectedTx)}
                                                    disabled={isDeletingTx}
                                                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                                    title="Hapus Transaksi Permanen dari Database (Khusus Owner)"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    <span>{isDeletingTx ? 'Menghapus...' : 'Hapus'}</span>
                                                </button>
                                            )}
                                        </>
                                    )}
                                    <Link
                                        href={`/kasir/transactions/${selectedTx.id}`}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 transition-all"
                                        title="Buka Halaman Struk & Kirim Foto Struk ke WhatsApp"
                                    >
                                        <span>📸</span>
                                        <span>Foto Struk & Kirim WA</span>
                                    </Link>
                                    <button
                                        onClick={() => handleSendWA(selectedTx)}
                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                        title="Kirim Struk Teks WA"
                                    >
                                        <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993L2 22l5.233-1.371a9.946 9.946 0 004.787 1.226h.005c5.502 0 9.985-4.479 9.986-9.987 0-2.67-1.037-5.178-2.924-7.065A9.923 9.923 0 0012.012 2zm4.857 13.913c-.266.747-1.545 1.399-2.113 1.488-.517.081-1.19.122-1.921-.112-.733-.234-1.637-.621-2.738-1.096-1.83-.791-3.23-2.56-3.32-2.682-.092-.121-.75-.992-.75-1.884v-.001c0-.893.468-1.332.635-1.514.167-.182.365-.228.487-.228.121 0 .243.002.348.006.112.005.263-.042.412.316.152.366.52.1.626.471.106.371.076.66-.046.903-.121.243-.243.402-.365.548-.121.146-.248.304-.106.548.142.244.632 1.039 1.36 1.688.937.834 1.728 1.093 1.972 1.214.244.121.385.101.527-.061.142-.162.608-.71.77-1.016.162-.304.324-.254.548-.172.223.081 1.42.67 1.663.792.244.121.405.182.466.284.061.101.061.589-.203 1.337z"/></svg>
                                        <span>Kirim Teks WA</span>
                                    </button>
                                    <button
                                        onClick={() => window.print()}
                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                        Cetak
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
