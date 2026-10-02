import { toast } from 'react-hot-toast'
import { getLogoBase64 } from '@/lib/pdfLogo'

/**
 * Membuat dan mengunduh PDF "Executive Summary" omset dari Dashboard owner.
 * Dipindah apa adanya dari app/dashboard/page.js (handlePrintSummary);
 * data yang dicetak diteruskan dari state halaman.
 */
export async function exportDashboardSummaryPdf({ branchDailyComparison, branchTotals, branches, dbUser, endDate, paymentBreakdown, startDate, topProducts, topTreatments }) {
    const toastId = toast.loading('Menyiapkan dokumen PDF Rekap Omset...')
    try {
        const { jsPDF } = await import('jspdf')
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        })

        const formatCurrency = (val) => "Rp " + Number(val || 0).toLocaleString('id-ID')
        const primaryColor = [212, 98, 33]    // #D46221
        const secondaryColor = [78, 42, 18]   // #4E2A12
        const accentColor = [242, 216, 195]   // #F2D8C3
        const darkText = [44, 30, 22]         // #2C1E16
        const mutedText = [140, 125, 115]     // #8C7D73

        let y = 15
        const pageHeight = 297
        const margin = 15
        const contentWidth = 180
        let pageNum = 1

        const addHeaderFooter = (d, isFirstPage = false) => {
            if (!isFirstPage) {
                d.setFont('helvetica', 'bold')
                d.setFontSize(8)
                d.setTextColor(...mutedText)
                d.text('EXECUTIVE BUSINESS SUMMARY - AYUMI BEAUTY HOUSE', margin, 10)
                d.setDrawColor(245, 238, 230)
                d.setLineWidth(0.3)
                d.line(margin, 12, margin + contentWidth, 12)
            }
            d.setFont('helvetica', 'normal')
            d.setFontSize(7.5)
            d.setTextColor(...mutedText)
            d.text(`Ayumi Beauty House  |  Dicetak pada: ${new Date().toLocaleString('id-ID')}`, margin, pageHeight - 10)
            d.text(`Halaman ${pageNum}`, margin + contentWidth - 15, pageHeight - 10)
        }

        const logoBase64 = await getLogoBase64()

        // --- 1. KOP SURAT ---
        doc.setFillColor(...primaryColor)
        doc.rect(margin, y, contentWidth, 2.5, 'F')
        y += 6

        let textStartX = margin
        if (logoBase64) {
            try {
                doc.addImage(logoBase64, 'PNG', margin, y, 16, 16)
                textStartX = margin + 19
            } catch (e) {
                console.error('Failed to embed logo in dashboard PDF:', e)
            }
        }

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(15)
        doc.setTextColor(...secondaryColor)
        doc.text('AYUMI BEAUTY HOUSE', textStartX, y + 4)

        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...mutedText)
        doc.text('Kecantikan, Kosmetik & Perawatan Diri', textStartX, y + 8)

        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...primaryColor)
        doc.text('EXECUTIVE SUMMARY - REKAP OMSET PERUSAHAAN', textStartX, y + 13.5)

        // Metadata Right Side (No overlap)
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...darkText)
        const printDateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        const printedBy = dbUser?.full_name || 'Owner'

        const metaX = margin + 120
        doc.text(`Periode: ${startDate} s.d ${endDate}`, metaX, y + 2.5)
        doc.text(`Cakupan: ${branches.length} Cabang Klinik`, metaX, y + 6.2)
        doc.text(`Tanggal Cetak: ${printDateStr}`, metaX, y + 9.9)
        doc.text(`Pencetak: ${printedBy}`, metaX, y + 13.6)

        y += 19
        doc.setDrawColor(...accentColor)
        doc.setLineWidth(0.4)
        doc.line(margin, y, margin + contentWidth, y)
        y += 7

        // --- 2. DUA KARTU KPI UTAMA (50% - 50%) ---
        const cardW = 86
        const cardGap = 8
        const cardH = 17

        // Card 1: Total Pendapatan Perusahaan
        doc.setFillColor(254, 252, 250)
        doc.setDrawColor(...accentColor)
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, cardW, cardH, 2, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...mutedText)
        doc.text('TOTAL PENDAPATAN PERUSAHAAN', margin + 4, y + 5)
        doc.setFontSize(11)
        doc.setTextColor(...primaryColor)
        doc.text(formatCurrency(branchTotals.rangeIncome), margin + 4, y + 11.5)
        doc.setFontSize(6.5)
        doc.setTextColor(...darkText)
        doc.text(`Akumulasi Seluruh (${branches.length}) Cabang Klinik`, margin + 4, y + 15)

        // Card 2: Total Transaksi Perusahaan
        const c2X = margin + cardW + cardGap
        doc.roundedRect(c2X, y, cardW, cardH, 2, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...mutedText)
        doc.text('TOTAL TRANSAKSI PERUSAHAAN', c2X + 4, y + 5)
        doc.setFontSize(11)
        doc.setTextColor(...darkText)
        doc.text(`${branchTotals.rangeTxCount} Transaksi`, c2X + 4, y + 11.5)
        doc.setFontSize(6.5)
        doc.setTextColor(...mutedText)
        doc.text('Total Seluruh Transaksi Kasir POS', c2X + 4, y + 15)

        y += cardH + 7

        // --- 3. SEBARAN METODE PEMBAYARAN ---
        if (paymentBreakdown && paymentBreakdown.length > 0) {
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(8)
            doc.setTextColor(...secondaryColor)
            doc.text('SEBARAN METODE PEMBAYARAN', margin, y)
            y += 3.5

            let pX = margin
            paymentBreakdown.forEach((pm) => {
                const methodLabel = pm.method || 'CASH'
                const methodAmt = formatCurrency(pm.amount || 0)
                const methodPct = `${pm.percent || 0}%`
                const pText = `${methodLabel}: ${methodAmt} (${methodPct})`

                doc.setFont('helvetica', 'bold')
                doc.setFontSize(7)
                doc.setTextColor(...darkText)
                doc.setFillColor(254, 252, 250)
                doc.setDrawColor(...accentColor)
                doc.setLineWidth(0.2)

                const pWidth = (doc.getStringUnitWidth(pText) * 7 * 25.4) / 72 + 6
                if (pX + pWidth > margin + contentWidth) {
                    pX = margin
                    y += 6
                }
                doc.roundedRect(pX, y - 3.2, pWidth, 4.8, 1, 1, 'FD')
                doc.text(pText, pX + 3, y)
                pX += pWidth + 3
            })
            y += 8
        }

        // --- 4. TABEL RINCIAN PERFORMA & OMSET PER CABANG ---
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...secondaryColor)
        doc.text('RINCIAN PERFORMA & OMSET PER CABANG', margin, y)
        y += 3.5

        const bHeaders = ['Nama Cabang', 'Omset Treatment', 'Omset Produk', 'Kupon Terjual', 'Pemakaian Sesi', 'Total Omset', 'Trx']
        const bWidths = [38, 26, 26, 24, 26, 28, 12]

        const drawBranchHeader = () => {
            doc.setFillColor(...primaryColor)
            doc.rect(margin, y, contentWidth, 6, 'F')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7)
            doc.setTextColor(255, 255, 255)

            let curX = margin
            bHeaders.forEach((h, idx) => {
                const align = idx === 0 ? 'left' : 'right'
                const textX = align === 'right' ? curX + bWidths[idx] - 2 : curX + 2
                doc.text(h, textX, y + 4, { align })
                curX += bWidths[idx]
            })
            y += 6
        }

        drawBranchHeader()

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)

        let totalTreatAll = 0
        let totalProdAll = 0
        let totalCouponSalesAll = 0
        let totalCouponUsedAll = 0
        let totalGrandOmset = 0
        let totalTrxAll = 0

        branchDailyComparison.forEach((b, idx) => {
            if (y + 7 > pageHeight - 15) {
                addHeaderFooter(doc)
                doc.addPage()
                pageNum++
                y = 15
                drawBranchHeader()
            }

            if (idx % 2 === 1) {
                doc.setFillColor(254, 252, 250)
                doc.rect(margin, y, contentWidth, 5.5, 'F')
            }

            doc.setTextColor(...darkText)
            let curX = margin

            const treatVal = Number(b.treatmentIncome || 0)
            const prodVal = Number(b.productIncome || 0)
            const cSalesVal = Number(b.couponSalesIncome || 0)
            const cUsedVal = Number(b.couponUsedValue || 0)
            const totVal = Number(b.totalIncome || 0)
            const trxVal = Number(b.transactionCount || 0)

            totalTreatAll += treatVal
            totalProdAll += prodVal
            totalCouponSalesAll += cSalesVal
            totalCouponUsedAll += cUsedVal
            totalGrandOmset += totVal
            totalTrxAll += trxVal

            const rowData = [
                b.branchName || 'Cabang',
                treatVal.toLocaleString('id-ID'),
                prodVal.toLocaleString('id-ID'),
                cSalesVal.toLocaleString('id-ID'),
                cUsedVal.toLocaleString('id-ID'),
                totVal.toLocaleString('id-ID'),
                trxVal.toString()
            ]

            rowData.forEach((val, colIdx) => {
                const align = colIdx === 0 ? 'left' : 'right'
                const textX = align === 'right' ? curX + bWidths[colIdx] - 2 : curX + 2
                if (colIdx === 5) {
                    doc.setFont('helvetica', 'bold')
                    doc.setTextColor(...primaryColor)
                } else {
                    doc.setFont('helvetica', 'normal')
                    doc.setTextColor(...darkText)
                }
                doc.text(val, textX, y + 3.8, { align })
                curX += bWidths[colIdx]
            })

            doc.setDrawColor(242, 216, 195)
            doc.setLineWidth(0.15)
            doc.line(margin, y + 5.5, margin + contentWidth, y + 5.5)

            y += 5.5
        })

        // Baris Total Keseluruhan di Tabel
        doc.setFillColor(242, 216, 195)
        doc.rect(margin, y, contentWidth, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(...secondaryColor)

        let curTotX = margin
        const summaryRowData = [
            'TOTAL KESELURUHAN',
            totalTreatAll.toLocaleString('id-ID'),
            totalProdAll.toLocaleString('id-ID'),
            totalCouponSalesAll.toLocaleString('id-ID'),
            totalCouponUsedAll.toLocaleString('id-ID'),
            totalGrandOmset.toLocaleString('id-ID'),
            totalTrxAll.toString()
        ]

        summaryRowData.forEach((val, colIdx) => {
            const align = colIdx === 0 ? 'left' : 'right'
            const textX = align === 'right' ? curTotX + bWidths[colIdx] - 2 : curTotX + 2
            doc.text(val, textX, y + 4, { align })
            curTotX += bWidths[colIdx]
        })

        y += 10

        // --- 5. TOP TREATMENT & TOP PRODUK (2 Columns side-by-side) ---
        if (y + 36 > pageHeight - 15) {
            addHeaderFooter(doc)
            doc.addPage()
            pageNum++
            y = 15
        }

        const colW = 86
        const colGap = 8

        // Top Treatments Box
        doc.setFillColor(254, 252, 250)
        doc.setDrawColor(...accentColor)
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, colW, 35, 2, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...secondaryColor)
        doc.text('TOP TREATMENT TERLARIS', margin + 3.5, y + 5)

        let tY = y + 9.5;
        const safeTopTreatments = topTreatments && Array.isArray(topTreatments) ? topTreatments.slice(0, 5) : [];
        safeTopTreatments.forEach((t, idx) => {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(6.8)
            doc.setTextColor(...darkText)
            doc.text(`${idx + 1}. ${(t.name || '-').substring(0, 24)}`, margin + 3.5, tY)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...primaryColor)
            doc.text(`${t.count}x (${formatCurrency(t.revenue)})`, margin + colW - 3.5, tY, { align: 'right' })
            tY += 4.8
        });

        // Top Products Box
        const pBoxX = margin + colW + colGap
        doc.setFillColor(254, 252, 250)
        doc.roundedRect(pBoxX, y, colW, 35, 2, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...secondaryColor)
        doc.text('TOP PRODUK TERLARIS', pBoxX + 3.5, y + 5)

        let prY = y + 9.5;
        const safeTopProducts = topProducts && Array.isArray(topProducts) ? topProducts.slice(0, 5) : [];
        safeTopProducts.forEach((p, idx) => {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(6.8)
            doc.setTextColor(...darkText)
            doc.text(`${idx + 1}. ${(p.name || '-').substring(0, 24)}`, pBoxX + 3.5, prY)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...primaryColor)
            doc.text(`${p.count}x (${formatCurrency(p.revenue)})`, pBoxX + colW - 3.5, prY, { align: 'right' })
            prY += 4.8
        });

        addHeaderFooter(doc, pageNum === 1)

        doc.save(`Executive_Summary_Omset_${startDate}_sd_${endDate}.pdf`)
        toast.success('Laporan Eksekutif PDF berhasil diunduh!', { id: toastId })
    } catch (err) {
        console.error('Error generating Executive PDF:', err)
        toast.error('Gagal membuat PDF: ' + err.message, { id: toastId })
    }
}
