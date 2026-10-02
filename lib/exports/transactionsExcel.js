import { toLocalYYYYMMDD } from '@/lib/localDate'
import { getNetTransactionRevenue } from '@/lib/paymentUtils'

/**
 * Membuat dan mengunduh Excel laporan halaman Transaksi.
 * Dipindah apa adanya dari app/transactions/page.js (handleExcelExport).
 *
 * Fungsi format dan status pelanggan diteruskan dari halaman karena
 * getCustomerStatus bergantung pada data transaksi pertama tiap pasien.
 *
 * @param {object} params
 * @param {string} params.reportType   Jenis laporan, ikut menjadi nama file.
 * @param {string} params.title        Judul periode laporan.
 * @param {Array}  params.dataset      Transaksi yang dilaporkan.
 * @param {Array}  params.branches     Daftar cabang.
 * @param {string} params.filterBranch Cabang terpilih ('' = semua cabang).
 * @param {Function} params.formatDate
 * @param {Function} params.formatGenderAge
 * @param {Function} params.getCleanTxPricing
 * @param {Function} params.getCustomerStatus
 */
export async function exportTransactionsExcel({ reportType, title, dataset, branches, filterBranch, formatDate, formatGenderAge, getCleanTxPricing, getCustomerStatus }) {
    if (!dataset || dataset.length === 0) {
        alert('Tidak ada data untuk diexport.')
        return
    }

    const todayStr = toLocalYYYYMMDD()
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
    // xlsx (~860 KB) dimuat hanya saat benar-benar dipakai -- setelah pengecekan data
    // kosong di atas, supaya pesan 'tidak ada data' tetap muncul seketika.
    const XLSX = await import('xlsx')
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)

    // Sheet 2: Detail Transaksi
    const detailRows = dataset.map((tx, idx) => {
        const custStatus = getCustomerStatus(tx)
        const therapistName = tx.treatment_records?.therapist?.full_name || "-"
        const pricing = getCleanTxPricing(tx)
        return {
            "No.": idx + 1,
            "No. Transaksi": tx.transaction_number,
            "Tanggal": formatDate(tx.created_at),
            "Cabang": tx.branches?.name || "-",
            "Pasien": tx.patients?.full_name || "Walk-in Customer",
            "Tipe Pelanggan": custStatus.fullLabel || custStatus.label,
            "Gender & Usia": formatGenderAge(tx.patients) || "-",
            "WhatsApp": tx.patients?.whatsapp || "-",
            "Item Ringkasan": tx.transaction_items?.map(i => `${i.name} (x${i.quantity})`).join(', ') || "-",
            "Terapis": therapistName,
            "Metode Bayar": tx.payment_method?.toUpperCase(),
            "Sebelum Diskon": pricing.sebelumDiskon,
            "Diskon": pricing.discount,
            "Redeem Kupon": pricing.couponRedeem,
            "Total Bayar": pricing.total,
            "Status": (tx.payment_status || 'paid').toUpperCase(),
            "Kasir": tx.users?.full_name || "-"
        }
    })

    // Hitung total untuk Detail Transaksi
    const sumSubtotal = detailRows.reduce((a, b) => a + b["Sebelum Diskon"], 0)
    const sumDiscount = detailRows.reduce((a, b) => a + b["Diskon"], 0)
    const sumRedeem = detailRows.reduce((a, b) => a + b["Redeem Kupon"], 0)
    const sumTotal = detailRows.reduce((a, b) => a + b["Total Bayar"], 0)

    // Append Total Row to Detail Transaksi
    detailRows.push({
        "No.": "TOTAL",
        "No. Transaksi": "",
        "Tanggal": "",
        "Cabang": "",
        "Pasien": "",
        "Tipe Pelanggan": "",
        "WhatsApp": "",
        "Item Ringkasan": "",
        "Terapis": "",
        "Metode Bayar": "",
        "Sebelum Diskon": sumSubtotal,
        "Diskon": sumDiscount,
        "Redeem Kupon": sumRedeem,
        "Total Bayar": sumTotal,
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
