'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ReceiptPage() {
    const { id } = useParams()
    const router = useRouter()
    
    const [transaction, setTransaction] = useState(null)
    const [isLoading, setIsLoading] = useState(true)

    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    async function fetchTransaction() {
        setIsLoading(true)
        const { data, error } = await supabase
            .from('transactions')
            .select(`
                *,
                branches (name, address, phone),
                patients (full_name, whatsapp),
                users:users!transactions_cashier_id_fkey(full_name),
                transaction_items (*)
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (id) fetchTransaction()
    }, [id])

    const handlePrint = () => {
        window.print()
    }

    const handleSendWA = () => {
        if (!transaction.patients?.whatsapp) {
            alert('Nomor WhatsApp pasien tidak ditemukan!')
            return
        }

        let cleanPhone = transaction.patients.whatsapp.replace(/\D/g, '')
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '62' + cleanPhone.slice(1)
        }

        const itemsText = transaction.transaction_items
            ?.map(i => `- ${i.name} (${i.quantity}x) : Rp ${Number(i.subtotal).toLocaleString('id-ID')}`)
            .join('%0A') || ''

        const text = `Halo *${transaction.patients?.full_name}*,%0A%0ATerima kasih telah mempercayakan kecantikan Anda kepada Ayumi Beauty House.%0ABerikut adalah rincian transaksi Anda:%0A%0ANo. Transaksi: *${transaction.transaction_number}*%0ATanggal: ${formatDate(transaction.created_at)}%0ACabang: ${transaction.branches?.name || 'Ayumi Clinic'}%0A%0A*Item:*%0A${itemsText}%0A%0A*Subtotal:* Rp ${Number(transaction.subtotal).toLocaleString('id-ID')}%0A*Diskon:* Rp ${Number(transaction.discount).toLocaleString('id-ID')}%0A*Total Bayar:* *Rp ${Number(transaction.total).toLocaleString('id-ID')}*%0A*Metode Pembayaran:* ${transaction.payment_method.toUpperCase()}%0AStatus: LUNAS%0A%0AHubungi kami jika ada pertanyaan. Sampai jumpa kembali!`

        window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank')
    }

    if (isLoading) return <div className="p-8 text-center animate-pulse">Memuat struk transaksi...</div>
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

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            {/* Header Actions - hidden on print */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 print:hidden bg-white p-4 rounded-2xl border border-pink-100/50 shadow-sm">
                <Link href="/kasir" className="text-gray-500 hover:text-ayumi-primary flex items-center gap-2 text-sm font-semibold transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Kembali ke POS
                </Link>
                <div className="flex flex-wrap gap-2 justify-center">
                    {/* Show Buat Rekam Medis button if there's no treatment_record_id yet and there's a patient and the cart has treatments */}
                    {!transaction.treatment_record_id && transaction.patient_id && transaction.transaction_items?.some(i => i.item_type === 'treatment') && (
                        <Link href={`/treatment-records/new?transactionId=${transaction.id}`} className="px-3 py-2 bg-pink-100 hover:bg-pink-200 text-ayumi-primary rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Buat Rekam Medis
                        </Link>
                    )}
                    <Link href="/kasir" className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-colors shadow-sm">
                        Transaksi Baru
                    </Link>
                    <Link href="/transactions" className="px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold transition-colors shadow-sm">
                        Lihat di Riwayat Transaksi
                    </Link>
                    <button 
                        onClick={handleSendWA}
                        disabled={!transaction.patients?.whatsapp}
                        className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993L2 22l5.233-1.371a9.946 9.946 0 004.787 1.226h.005c5.502 0 9.985-4.479 9.986-9.987 0-2.67-1.037-5.178-2.924-7.065A9.923 9.923 0 0012.012 2zm4.857 13.913c-.266.747-1.545 1.399-2.113 1.488-.517.081-1.19.122-1.921-.112-.733-.234-1.637-.621-2.738-1.096-1.83-.791-3.23-2.56-3.32-2.682-.092-.121-.75-.992-.75-1.884v-.001c0-.893.468-1.332.635-1.514.167-.182.365-.228.487-.228.121 0 .243.002.348.006.112.005.263-.042.412.316.152.366.52.1.626.471.106.371.076.66-.046.903-.121.243-.243.402-.365.548-.121.146-.248.304-.106.548.142.244.632 1.039 1.36 1.688.937.834 1.728 1.093 1.972 1.214.244.121.385.101.527-.061.142-.162.608-.71.77-1.016.162-.304.324-.254.548-.172.223.081 1.42.67 1.663.792.244.121.405.182.466.284.061.101.061.589-.203 1.337z"/></svg>
                        Kirim Struk WA
                    </button>
                    <button 
                        onClick={handlePrint}
                        className="px-3 py-2 bg-ayumi-primary hover:bg-ayumi-secondary text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                        Print Struk
                    </button>
                </div>
            </div>

            {/* Receipt Area */}
            <div className="bg-white p-8 rounded-2xl shadow-xl print:shadow-none print:p-0 print:border-none mx-auto max-w-[400px]">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-ayumi-secondary to-ayumi-primary rounded-full mx-auto flex items-center justify-center mb-3">
                        <span className="text-white font-extrabold text-2xl tracking-tighter">ab</span>
                    </div>
                    <h1 className="font-extrabold text-xl text-gray-900 tracking-wide">Ayumi Beauty House</h1>
                    <p className="text-sm text-gray-500 font-medium">{transaction.branches?.name}</p>
                    {transaction.branches?.address && <p className="text-xs text-gray-400 mt-1">{transaction.branches.address}</p>}
                    {transaction.branches?.phone && <p className="text-xs text-gray-400">{transaction.branches.phone}</p>}
                </div>

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
                        {transaction.transaction_items?.map((item) => (
                            <div key={item.id} className="grid grid-cols-12 text-sm items-start">
                                <div className="col-span-6">
                                    <p className="font-bold text-gray-800 leading-tight pr-2">{item.name}</p>
                                    <p className="text-[10px] text-gray-400">Rp {item.price.toLocaleString('id-ID')}</p>
                                </div>
                                <div className="col-span-2 text-center text-gray-600 font-mono">x{item.quantity}</div>
                                <div className="col-span-4 text-right font-mono font-bold text-gray-800">
                                    Rp {item.subtotal.toLocaleString('id-ID')}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-1 mb-6">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Subtotal</span>
                        <span className="font-mono text-gray-800">Rp {transaction.subtotal.toLocaleString('id-ID')}</span>
                    </div>
                    {transaction.discount > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Diskon</span>
                            <span className="font-mono text-gray-800">- Rp {transaction.discount.toLocaleString('id-ID')}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-lg mt-3 pt-3 border-t border-gray-100">
                        <span className="font-bold text-gray-800 uppercase tracking-wider">TOTAL</span>
                        <span className="font-extrabold text-xl text-ayumi-primary font-mono">Rp {transaction.total.toLocaleString('id-ID')}</span>
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
