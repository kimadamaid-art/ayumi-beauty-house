import toast from 'react-hot-toast'
import { getLogoBase64 } from '@/lib/pdfLogo'
import { parsePaymentSplits, getNetTransactionRevenue } from '@/lib/paymentUtils'

/**
 * Membuat dan mengunduh PDF Laporan Keuangan halaman Transaksi.
 * Dipindah apa adanya dari app/transactions/page.js (handlePDFExport).
 *
 * @param {object} params
 * @param {string} params.reportType   Jenis laporan, ikut menjadi nama file.
 * @param {string} params.title        Judul periode laporan.
 * @param {Array}  params.dataset      Transaksi yang dilaporkan.
 * @param {Array}  params.branches     Daftar cabang, untuk nama cabang di kop.
 * @param {object} params.dbUser       Pengguna yang mencetak.
 * @param {string} params.filterBranch Cabang terpilih ('' = semua cabang).
 * @param {(val: number) => string} params.formatCurrency Format Rupiah halaman Transaksi.
 */
export async function exportTransactionsPdf({ reportType, title, dataset, branches, dbUser, filterBranch, formatCurrency }) {
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
