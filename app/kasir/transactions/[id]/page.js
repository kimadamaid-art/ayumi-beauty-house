'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { openWhatsApp } from '@/lib/whatsapp'
import html2canvas from 'html2canvas'
import { toast } from 'react-hot-toast'

export default function ReceiptPage() {
    const { id } = useParams()
    const router = useRouter()
    
    const [transaction, setTransaction] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isBluetoothPrinting, setIsBluetoothPrinting] = useState(false)
    const [isGeneratingImage, setIsGeneratingImage] = useState(false)

    async function fetchTransaction() {
        setIsLoading(true)
        const { data, error } = await supabase
            .from('transactions')
            .select(`
                *,
                branches (name, address, phone),
                patients (full_name, whatsapp),
                users:users!transactions_cashier_id_fkey(full_name),
                transaction_items (
                    *,
                    treatments (price),
                    products (price)
                )
            `)
            .eq('id', id)
            .single()
            
        if (data) {
            setTransaction(data)
        } else {
            console.error(error)
            alert('Transaksi tidak ditemukan!')
            router.push('/kasir')
        }
        setIsLoading(false)
    }

    useEffect(() => {
        if (id) fetchTransaction()
    }, [id])

    useEffect(() => {
        if (transaction?.transaction_number) {
            const cleanPatient = transaction.patients?.full_name 
                ? `_${transaction.patients.full_name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
                : ''
            const pdfName = `Struk_${transaction.transaction_number}${cleanPatient}`
            document.title = pdfName
        }
        return () => {
            document.title = 'Ayumi Beauty House'
        }
    }, [transaction])

    const handlePrint = () => {
        if (transaction?.transaction_number) {
            const cleanPatient = transaction.patients?.full_name 
                ? `_${transaction.patients.full_name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
                : ''
            document.title = `Struk_${transaction.transaction_number}${cleanPatient}`
        }
        window.print()
    }

    // --- Direct Web Bluetooth Thermal Printer (ESC/POS) ---
    const handlePrintBluetooth = async () => {
        if (!navigator.bluetooth) {
            alert('Browser Anda tidak mendukung Web Bluetooth API. Gunakan Google Chrome / Edge di Android atau Laptop.')
            return
        }

        setIsBluetoothPrinting(true)
        try {
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    '000018f0-0000-1000-8000-00805f9b34fb',
                    '0000e025-0000-1000-8000-00805f9b34fb',
                    '0000ff00-0000-1000-8000-00805f9b34fb',
                    '00001101-0000-1000-8000-00805f9b34fb',
                    'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
                ]
            })

            if (!device || !device.gatt) {
                setIsBluetoothPrinting(false)
                return
            }

            const server = await device.gatt.connect()
            const services = await server.getPrimaryServices()
            let writeChar = null

            for (const s of services) {
                const chars = await s.getCharacteristics()
                for (const c of chars) {
                    if (c.properties.write || c.properties.writeWithoutResponse) {
                        writeChar = c
                        break
                    }
                }
                if (writeChar) break
            }

            if (!writeChar) {
                throw new Error('Tidak dapat menemukan jalur tulis (write characteristic) pada printer ini.')
            }

            const encoder = new TextEncoder()
            const esc = (txt) => encoder.encode(txt)
            const concatBytes = (arrs) => {
                const total = arrs.reduce((a, c) => a + c.length, 0)
                const res = new Uint8Array(total)
                let offset = 0
                for (const a of arrs) {
                    res.set(a, offset)
                    offset += a.length
                }
                return res
            }

            // ESC/POS Command Codes
            const INIT = new Uint8Array([0x1b, 0x40])
            const ALIGN_CENTER = new Uint8Array([0x1b, 0x61, 0x01])
            const ALIGN_LEFT = new Uint8Array([0x1b, 0x61, 0x00])
            const BOLD_ON = new Uint8Array([0x1b, 0x45, 0x01])
            const BOLD_OFF = new Uint8Array([0x1b, 0x45, 0x00])
            const FEED_CUT = new Uint8Array([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00])

            const line = (t = '') => esc(t + '\n')
            const divider = esc('--------------------------------\n')

            const chunks = [
                INIT,
                ALIGN_CENTER,
                BOLD_ON,
                line('AYUMI BEAUTY HOUSE'),
                BOLD_OFF,
                line(transaction.branches?.name || 'Ayumi Clinic'),
                line(transaction.branches?.phone || ''),
                divider,
                ALIGN_LEFT,
                line(`No  : ${transaction.transaction_number}`),
                line(`Tgl : ${new Date(transaction.created_at).toLocaleDateString('id-ID')} ${new Date(transaction.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`),
                line(`Kasir: ${transaction.users?.full_name || '-'}`),
                line(`Pasien: ${transaction.patients?.full_name || 'Walk-in Customer'}`),
                divider,
                BOLD_ON,
                line('ITEM          QTY     SUBTOTAL'),
                BOLD_OFF,
                divider
            ]

            transaction.transaction_items?.forEach(item => {
                const name = item.name.length > 32 ? item.name.slice(0, 32) : item.name
                chunks.push(line(name))
                
                const catalogPrice = item.item_type === 'treatment' 
                    ? Number(item.treatments?.price || 0)
                    : item.item_type === 'product' 
                        ? Number(item.products?.price || 0)
                        : 0

                const origPrice = Number(item.original_price) || catalogPrice || (item.discount_percent && item.discount_percent < 100 ? Math.round(item.price / (1 - item.discount_percent / 100)) : item.price)
                const hasDisc = origPrice > (Number(item.price) + 1)
                const discPct = item.discount_percent || (hasDisc ? Math.round(((origPrice - item.price) / origPrice) * 100) : 0)
                
                let priceStr = `${item.quantity}x @${Number(item.price).toLocaleString('id-ID')}`
                if (hasDisc && discPct > 0) {
                    priceStr += ` (-${discPct}%)`
                }
                const subStr = `Rp ${Number(item.subtotal).toLocaleString('id-ID')}`
                const padSpaces = Math.max(1, 32 - priceStr.length - subStr.length)
                chunks.push(line(priceStr + ' '.repeat(padSpaces) + subStr))
            })

            chunks.push(divider)
            const subtotalVal = Number(transaction.subtotal || 0)
            const discountRupiah = Number(transaction.discount || 0)
            let percentLabel = ''
            if (discountRupiah > 0 && subtotalVal > 0) {
                const calcPct = Math.round((discountRupiah / subtotalVal) * 100)
                if (calcPct > 0 && calcPct <= 100) {
                    percentLabel = ` (${calcPct}%)`
                }
            }

            chunks.push(line(`Subtotal: Rp ${subtotalVal.toLocaleString('id-ID')}`))

            if (discountRupiah > 0) {
                chunks.push(line(`Diskon${percentLabel} : -Rp ${discountRupiah.toLocaleString('id-ID')}`))
            }

            const netTotal = Math.max(0, subtotalVal - discountRupiah)
            const qrisFee = transaction.payment_method?.toLowerCase() === 'qris' ? Math.round(netTotal * 0.003) : 0
            if (qrisFee > 0) {
                chunks.push(line(`QRIS(0.3%): +Rp ${qrisFee.toLocaleString('id-ID')}`))
            }

            chunks.push(divider)
            chunks.push(BOLD_ON)
            chunks.push(line(`TOTAL   : Rp ${Number(transaction.total).toLocaleString('id-ID')}`))
            chunks.push(line(`BAYAR   : ${transaction.payment_method?.toUpperCase()}`))
            chunks.push(BOLD_OFF)
            chunks.push(divider)

            chunks.push(ALIGN_CENTER)
            chunks.push(line('Terima Kasih Atas'))
            chunks.push(line('Kunjungan Anda'))
            chunks.push(line('IG: @ayumibeautyhouse'))
            chunks.push(FEED_CUT)

            const fullData = concatBytes(chunks)
            const chunkSize = 100

            for (let i = 0; i < fullData.length; i += chunkSize) {
                const chunk = fullData.slice(i, i + chunkSize)
                if (writeChar.properties.writeWithoutResponse) {
                    await writeChar.writeValueWithoutResponse(chunk)
                } else {
                    await writeChar.writeValue(chunk)
                }
                await new Promise(r => setTimeout(r, 40))
            }

            setTimeout(() => {
                if (server.connected) server.disconnect()
            }, 1000)

            alert('Struk berhasil dikirim ke Printer Bluetooth! 📱🖨️')
        } catch (err) {
            console.error(err)
            alert('Gagal cetak via Bluetooth: ' + err.message)
        } finally {
            setIsBluetoothPrinting(false)
        }
    }

    const handleSendReceiptImage = async (mode = 'wa_image') => {
        let phone = transaction.patients?.whatsapp || ''
        if (!phone) {
            const inputPhone = window.prompt(
                'Nomor WhatsApp pasien belum terdaftar.\nSilakan masukkan nomor WhatsApp tujuan (contoh: 08123456789):'
            )
            if (!inputPhone || !inputPhone.trim()) return
            phone = inputPhone.trim()
        }

        const receiptEl = document.getElementById('receipt-area')
        if (!receiptEl) {
            handleSendWA()
            return
        }

        try {
            setIsGeneratingImage(true)
            toast.loading('Memproses foto struk...', { id: 'receipt-img' })

            // Generate high-resolution canvas
            const canvas = await html2canvas(receiptEl, {
                scale: 3,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                windowWidth: 420
            })

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    toast.error('Gagal membuat gambar struk', { id: 'receipt-img' })
                    setIsGeneratingImage(false)
                    return
                }

                const fileName = `Struk_Ayumi_${transaction.transaction_number || 'TRX'}.png`

                // Jika mode unduh
                if (mode === 'download') {
                    const link = document.createElement('a')
                    link.download = fileName
                    link.href = URL.createObjectURL(blob)
                    link.click()
                    toast.success('📥 Foto struk berhasil diunduh!', { id: 'receipt-img' })
                    setIsGeneratingImage(false)
                    return
                }

                // Jika perangkat mendukung Web Share API dengan file (misal HP / Mac share sheet)
                const file = new File([blob], fileName, { type: 'image/png' })
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `Struk Pembayaran ${transaction.transaction_number}`,
                            text: `Berikut bukti pembayaran transaksi ${transaction.transaction_number} di Ayumi Beauty House.`,
                            files: [file]
                        })
                        toast.success('✅ Berhasil dibagikan!', { id: 'receipt-img' })
                        setIsGeneratingImage(false)
                        return
                    } catch (shareErr) {
                        if (shareErr.name === 'AbortError') {
                            toast.dismiss('receipt-img')
                            setIsGeneratingImage(false)
                            return
                        }
                    }
                }

                // Desktop browser: Copy gambar langsung ke clipboard
                let copied = false
                if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                    try {
                        const item = new ClipboardItem({ 'image/png': blob })
                        await navigator.clipboard.write([item])
                        copied = true
                    } catch (clipErr) {
                        console.warn('Clipboard write failed:', clipErr)
                    }
                }

                const customerName = transaction.patients?.full_name || 'Pelanggan Ayumi'
                const captionText = `Halo *${customerName}*,\n\nTerima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House ✨\nBerikut adalah foto struk bukti pembayaran untuk transaksi *${transaction.transaction_number}*.\n\n_Silakan simpan bukti pembayaran ini. Sampai jumpa kembali!_`

                if (copied) {
                    toast.success('📸 Foto struk disalin ke Clipboard! Tekan Paste (Ctrl+V / Cmd+V) di chat WhatsApp.', { 
                        id: 'receipt-img',
                        duration: 6000 
                    })
                } else {
                    toast.success('Membuka WhatsApp...', { id: 'receipt-img' })
                }

                // Buka WhatsApp Web menggunakan tab yang sama
                openWhatsApp(phone, captionText)
                setIsGeneratingImage(false)
            }, 'image/png')
        } catch (err) {
            console.error('Error generating receipt image:', err)
            toast.error('Gagal memproses foto struk: ' + err.message, { id: 'receipt-img' })
            setIsGeneratingImage(false)
            handleSendWA()
        }
    }

    const handleSendWA = () => {
        let phone = transaction.patients?.whatsapp || ''
        if (!phone) {
            const inputPhone = window.prompt(
                'Nomor WhatsApp pasien belum terdaftar.\nSilakan masukkan nomor WhatsApp tujuan (contoh: 08123456789):'
            )
            if (!inputPhone || !inputPhone.trim()) {
                return
            }
            phone = inputPhone.trim()
        }

        const itemsText = transaction.transaction_items
            ?.map(i => {
                const catalogPrice = i.item_type === 'treatment' 
                    ? Number(i.treatments?.price || 0)
                    : i.item_type === 'product' 
                        ? Number(i.products?.price || 0)
                        : 0

                const origPrice = Number(i.original_price) || catalogPrice || (i.discount_percent && i.discount_percent < 100 ? Math.round(i.price / (1 - i.discount_percent / 100)) : i.price)
                const hasDisc = origPrice > (Number(i.price) + 1)
                const discPct = i.discount_percent || (hasDisc ? Math.round(((origPrice - i.price) / origPrice) * 100) : 0)

                const strikeStr = hasDisc ? ` ~Rp ${Number(origPrice).toLocaleString('id-ID')}~` : ''
                const discTag = discPct > 0 ? ` (-${discPct}%)` : ''
                return `- ${i.name} (${i.quantity}x)${strikeStr}${discTag} : Rp ${Number(i.subtotal).toLocaleString('id-ID')}`
            })
            .join('\n') || ''

        const subtotalVal = Number(transaction.subtotal || 0)
        const discountRupiah = Number(transaction.discount || 0)
        let percentLabel = ''
        if (discountRupiah > 0 && subtotalVal > 0) {
            const calcPct = Math.round((discountRupiah / subtotalVal) * 100)
            if (calcPct > 0 && calcPct <= 100) {
                percentLabel = ` (${calcPct}%)`
            }
        }
        const netTotal = Math.max(0, subtotalVal - discountRupiah)
        const qrisFee = transaction.payment_method?.toLowerCase() === 'qris' ? Math.round(netTotal * 0.003) : 0

        const discountText = discountRupiah > 0 ? `\n*Diskon${percentLabel}:* -Rp ${discountRupiah.toLocaleString('id-ID')}` : ''
        const qrisText = qrisFee > 0 ? `\n*Biaya Layanan QRIS (0.3%):* +Rp ${qrisFee.toLocaleString('id-ID')}` : ''
        const customerName = transaction.patients?.full_name || 'Pelanggan Ayumi'

        const text = `Halo *${customerName}*,\n\nTerima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House.\nBerikut adalah rincian transaksi Anda:\n\nNo. Transaksi: *${transaction.transaction_number}*\nTanggal: ${formatDate(transaction.created_at)}\nCabang: ${transaction.branches?.name || 'Ayumi Clinic'}\n\n*Item:*\n${itemsText}\n\n*Subtotal:* Rp ${Number(transaction.subtotal).toLocaleString('id-ID')}${discountText}${qrisText}\n*Total Bayar:* *Rp ${Number(transaction.total).toLocaleString('id-ID')}*\n*Metode Pembayaran:* ${transaction.payment_method?.toUpperCase() || '-'}\nStatus: LUNAS\n\nHubungi kami jika ada pertanyaan. Sampai jumpa kembali!`

        openWhatsApp(phone, text)
    }

    if (isLoading) return <div className="p-5 md:p-8 text-center animate-pulse">Memuat struk transaksi...</div>
    if (!transaction) return null

    const formatDate = (isoString) => {
        const date = new Date(isoString)
        return date.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const subtotalVal = Number(transaction.subtotal || 0)
    const totalVal = Number(transaction.total || 0)
    const discountRupiah = Number(transaction.discount || 0)
    
    // Hitung label persentase diskon secara otomatis dari nilai rupiah terhadap subtotal
    let percentLabel = ''
    if (discountRupiah > 0 && subtotalVal > 0) {
        const calcPct = Math.round((discountRupiah / subtotalVal) * 100)
        if (calcPct > 0 && calcPct <= 100) {
            percentLabel = ` (${calcPct}%)`
        }
    }

    const netTotal = Math.max(0, subtotalVal - discountRupiah)
    const qrisFee = transaction.payment_method?.toLowerCase() === 'qris' ? Math.round(netTotal * 0.003) : 0

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <style jsx global>{`
                @media print {
                    /* Hide EVERYTHING on the page by default */
                    body * {
                        visibility: hidden !important;
                    }

                    /* Explicitly hide layout elements & action buttons */
                    header, nav, aside, footer, .print-hide, .no-print, [data-print-hide="true"] {
                        display: none !important;
                        visibility: hidden !important;
                    }

                    /* Make ONLY #receipt-area and its children visible */
                    #receipt-area, #receipt-area * {
                        visibility: visible !important;
                    }

                    /* Position receipt card at the very top of the printed page / PDF */
                    #receipt-area {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        box-shadow: none !important;
                        border: none !important;
                        background: #ffffff !important;
                    }

                    body, html, main {
                        background: #ffffff !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    @page {
                        size: auto;
                        margin: 5mm;
                    }
                }
            `}</style>

            {/* Header Actions - hidden on print */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 print-hide bg-white p-4 rounded-2xl border border-pink-100/50 shadow-sm">
                <Link href="/kasir" className="text-gray-500 hover:text-ayumi-primary flex items-center gap-2 text-sm font-semibold transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Kembali ke POS
                </Link>
                <div className="flex flex-wrap gap-2 justify-center">
                    {!transaction.treatment_record_id && transaction.patient_id && transaction.transaction_items?.some(i => i.item_type === 'treatment') && (
                        <Link href={`/treatment-records/new?transactionId=${transaction.id}`} className="px-3 py-2 bg-pink-100 hover:bg-pink-200 text-ayumi-primary rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Buat Rekam Medis
                        </Link>
                    )}
                    {transaction.treatment_record_id && (
                        <Link href={`/treatment-records/${transaction.treatment_record_id}`} className="px-3 py-2 bg-pink-100 hover:bg-pink-200 text-ayumi-primary rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Kirim Rekam Medis (WA)
                        </Link>
                    )}
                    <Link href="/kasir" className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-colors shadow-sm">
                        Transaksi Baru
                    </Link>
                    <Link href="/transactions" className="px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold transition-colors shadow-sm">
                        Riwayat Transaksi
                    </Link>
                    
                    {/* Tombol Utama: Kirim Foto Struk WA */}
                    <button 
                        onClick={() => handleSendReceiptImage('wa_image')}
                        disabled={isGeneratingImage}
                        className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                        title="Salin Foto Struk ke Clipboard & Buka WhatsApp"
                    >
                        {isGeneratingImage ? (
                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent"></div>
                        ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        )}
                        📸 Kirim Foto Struk WA
                    </button>

                    {/* Tombol Unduh Foto Struk */}
                    <button 
                        onClick={() => handleSendReceiptImage('download')}
                        disabled={isGeneratingImage}
                        className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        title="Unduh Gambar Struk dalam format PNG"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Unduh Foto Struk
                    </button>

                    {/* Tombol Kirim Teks WA Biasa */}
                    <button 
                        onClick={handleSendWA}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        title="Kirim Struk format Teks Rincian ke WhatsApp"
                    >
                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993L2 22l5.233-1.371a9.946 9.946 0 004.787 1.226h.005c5.502 0 9.985-4.479 9.986-9.987 0-2.67-1.037-5.178-2.924-7.065A9.923 9.923 0 0012.012 2zm4.857 13.913c-.266.747-1.545 1.399-2.113 1.488-.517.081-1.19.122-1.921-.112-.733-.234-1.637-.621-2.738-1.096-1.83-.791-3.23-2.56-3.32-2.682-.092-.121-.75-.992-.75-1.884v-.001c0-.893.468-1.332.635-1.514.167-.182.365-.228.487-.228.121 0 .243.002.348.006.112.005.263-.042.412.316.152.366.52.1.626.471.106.371.076.66-.046.903-.121.243-.243.402-.365.548-.121.146-.248.304-.106.548.142.244.632 1.039 1.36 1.688.937.834 1.728 1.093 1.972 1.214.244.121.385.101.527-.061.142-.162.608-.71.77-1.016.162-.304.324-.254.548-.172.223.081 1.42.67 1.663.792.244.121.405.182.466.284.061.101.061.589-.203 1.337z"/></svg>
                        Kirim WA (Teks)
                    </button>

                    <button 
                        onClick={handlePrintBluetooth}
                        disabled={isBluetoothPrinting}
                        className="px-3 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                        title="Cetak Langsung via Bluetooth Thermal Printer (ESC/POS)"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        {isBluetoothPrinting ? 'Mencetak...' : 'Print Bluetooth'}
                    </button>
                    <button 
                        onClick={handlePrint}
                        className="px-3 py-2 bg-ayumi-primary hover:bg-ayumi-secondary text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
                        title="Cetak/Simpan PDF lewat Dialog Browser"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                        Simpan PDF / Print
                    </button>
                </div>
            </div>

            {/* Receipt Area (Only this block prints!) */}
            <div id="receipt-area" className="bg-white p-5 md:p-8 rounded-2xl shadow-xl print:shadow-none print:p-0 print:border-none mx-auto max-w-[400px]">
                <div className="text-center mb-6">
                    <img 
                        src="/logo-ab.png" 
                        alt="Ayumi Beauty House" 
                        className="h-16 w-auto mx-auto mb-3 object-contain"
                    />
                    <h1 className="font-extrabold text-xl text-gray-900 tracking-wide">Ayumi Beauty House</h1>
                    <p className="text-sm text-gray-500 font-medium">{transaction.branches?.name}</p>
                    {transaction.branches?.address && <p className="text-xs text-gray-400 mt-1">{transaction.branches.address}</p>}
                    {transaction.branches?.phone && <p className="text-xs text-gray-400">{transaction.branches.phone}</p>}
                </div>

                {transaction.payment_status === 'void' && (
                    <div className="mb-4 p-2.5 bg-red-100 text-red-800 border-2 border-red-500 rounded-lg text-center font-black text-xs uppercase tracking-widest">
                        *** TRANSAKSI DIBATALKAN (VOID) ***
                    </div>
                )}

                <div className="border-t border-dashed border-gray-300 py-4 mb-4">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">No. Transaksi</span>
                        <span className="font-bold text-gray-800">{transaction.transaction_number}</span>
                    </div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">Tanggal</span>
                        <span className="text-gray-800">{formatDate(transaction.created_at)}</span>
                    </div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500">Kasir</span>
                        <span className="text-gray-800">{transaction.users?.full_name || '-'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Pelanggan</span>
                        <span className="font-bold text-gray-800">{transaction.patients?.full_name || 'Walk-in Customer'}</span>
                    </div>
                </div>

                <div className="mb-4 border-b border-dashed border-gray-300 pb-4">
                    <div className="grid grid-cols-12 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        <div className="col-span-6">Item</div>
                        <div className="col-span-2 text-center">Qty</div>
                        <div className="col-span-4 text-right">Subtotal</div>
                    </div>
                    
                    <div className="space-y-3">
                        {transaction.transaction_items?.map((item) => {
                            const catalogPrice = item.item_type === 'treatment' 
                                ? Number(item.treatments?.price || 0)
                                : item.item_type === 'product' 
                                    ? Number(item.products?.price || 0)
                                    : 0

                            const origPrice = Number(item.original_price) || catalogPrice || (item.discount_percent && item.discount_percent < 100 ? Math.round(item.price / (1 - item.discount_percent / 100)) : item.price)
                            const hasDiscount = origPrice > (Number(item.price) + 1)
                            const discPct = item.discount_percent || (hasDiscount ? Math.round(((origPrice - item.price) / origPrice) * 100) : 0)
                            
                            return (
                                <div key={item.id} className="grid grid-cols-12 text-sm items-start">
                                    <div className="col-span-6">
                                        <p className="font-bold text-gray-800 leading-tight pr-2">{item.name}</p>
                                        {hasDiscount ? (
                                            <div className="flex items-center gap-1.5 flex-wrap text-[10px] mt-0.5">
                                                <span className="line-through text-gray-400 font-medium">
                                                    Rp {Number(origPrice).toLocaleString('id-ID')}
                                                </span>
                                                <span className="text-ayumi-primary font-extrabold">
                                                    Rp {Number(item.price).toLocaleString('id-ID')}
                                                </span>
                                                {discPct > 0 && (
                                                    <span className="bg-rose-50 text-rose-600 font-extrabold px-1 rounded text-[9px] border border-rose-100">
                                                        -{discPct}%
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-[10px] text-gray-400">Rp {Number(item.price).toLocaleString('id-ID')}</p>
                                        )}
                                    </div>
                                    <div className="col-span-2 text-center text-gray-600">x{item.quantity}</div>
                                    <div className="col-span-4 text-right font-bold text-gray-800">
                                        Rp {Number(item.subtotal).toLocaleString('id-ID')}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="space-y-1 mb-6">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Subtotal</span>
                        <span className=" text-gray-800">Rp {Number(transaction.subtotal).toLocaleString('id-ID')}</span>
                    </div>
                    {discountRupiah > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500 font-medium">Diskon{percentLabel}</span>
                            <span className="text-rose-600 font-bold">- Rp {discountRupiah.toLocaleString('id-ID')}</span>
                        </div>
                    )}
                    {qrisFee > 0 && (
                        <div className="flex justify-between text-sm text-blue-700 font-semibold">
                            <span>Biaya QRIS (0,3%)</span>
                            <span className="">+ Rp {qrisFee.toLocaleString('id-ID')}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-lg mt-3 pt-3 border-t border-gray-100">
                        <span className="font-bold text-gray-800 uppercase tracking-wider">TOTAL</span>
                        <span className="font-extrabold text-xl text-ayumi-primary ">Rp {Number(transaction.total).toLocaleString('id-ID')}</span>
                    </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 mb-6 flex justify-between items-center border border-gray-100">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Metode Bayar</span>
                    <span className="font-bold text-gray-800 uppercase">{transaction.payment_method}</span>
                </div>

                <div className="text-center">
                    <p className="text-xs text-gray-500 italic mb-2">&ldquo;Terima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House&rdquo;</p>
                    <p className="text-[10px] text-gray-400 font-semibold tracking-widest">IG: @ayumibeautyhouse</p>
                </div>
            </div>
        </div>
    )
}
