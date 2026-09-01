/**
 * Payment Utilities for Ayumi Beauty House
 * Menangani parsing dan kalkulasi nominal per metode pembayaran (termasuk Split Payment & Pengurangan Biaya QRIS 0.3%).
 */

/**
 * Menghitung pendapatan bersih klinik dari suatu transaksi.
 * Biaya layanan QRIS (0.3% MDR) tidak dimasukkan ke dalam pendapatan klinik.
 */
export function getNetTransactionRevenue(tx) {
    if (!tx) return 0

    const total = Number(tx.total || 0)
    const method = String(tx.payment_method || '').toLowerCase()
    const subtotal = Number(tx.subtotal || 0)
    const discount = Number(tx.discount || 0)
    const netBase = Math.max(0, subtotal - discount)

    // Jika pembayaran tunggal QRIS
    if (method === 'qris') {
        if (netBase > 0 && total >= netBase) {
            return netBase // Pendapatan murni sebelum biaya QRIS
        }
        // Fallback jika hanya ada total: hilangkan komponen 0.3%
        return Math.round(total / 1.003)
    }

    // Jika Split payment dan ada komponen QRIS
    const notes = String(tx.notes || '')
    if (method === 'split' || notes.includes('[SPLIT:')) {
        const rawSplits = parsePaymentSplits(tx, { netQris: false })
        if (rawSplits.qris > 0) {
            // Hitung porsi MDR QRIS pada komponen QRIS
            const qrisMdr = Math.round(rawSplits.qris - (rawSplits.qris / 1.003))
            return Math.max(0, total - qrisMdr)
        }
    }

    return total
}

/**
 * Menghitung rincian pembayaran per metode.
 * Parameter netQris = true (default) otomatis mengeluarkan biaya MDR 0.3% dari nominal QRIS agar sesuai omset bersih.
 */
export function parsePaymentSplits(tx, { netQris = true } = {}) {
    const defaultBreakdown = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }
    if (!tx) return defaultBreakdown

    const total = Number(tx.total || 0)
    const notes = String(tx.notes || '')
    const method = String(tx.payment_method || '').toLowerCase()
    const subtotal = Number(tx.subtotal || 0)
    const discount = Number(tx.discount || 0)
    const netBase = Math.max(0, subtotal - discount)

    let result = { ...defaultBreakdown }

    // 1. Cek tag split terstruktur di notes: e.g. [SPLIT:cash=299000;transfer=599000]
    const splitMatch = notes.match(/\[SPLIT:([^\]]+)\]/i)
    if (splitMatch) {
        const pairs = splitMatch[1].split(';')
        let matchedTotal = 0
        pairs.forEach(pair => {
            const [m, amt] = pair.split('=')
            const cleanM = (m || '').trim().toLowerCase()
            const cleanAmt = Number(amt || 0)
            if (result[cleanM] !== undefined) {
                result[cleanM] += cleanAmt
            } else {
                result[cleanM] = cleanAmt
            }
            matchedTotal += cleanAmt
        })
        if (matchedTotal > 0) {
            if (netQris && result.qris > 0) {
                result.qris = Math.round(result.qris / 1.003)
            }
            return result
        }
    }

    // 2. Cek text split di notes: e.g. "Split: Cash Rp 300.000, Transfer Rp 598.000"
    if (notes.toLowerCase().includes('split:')) {
        const cashMatch = notes.match(/cash\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const transferMatch = notes.match(/transfer\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const qrisMatch = notes.match(/qris\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const debitMatch = notes.match(/debit\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        
        let found = false
        if (cashMatch) { result.cash = Number(cashMatch[1].replace(/\./g, '')); found = true; }
        if (transferMatch) { result.transfer = Number(transferMatch[1].replace(/\./g, '')); found = true; }
        if (qrisMatch) { 
            let qAmt = Number(qrisMatch[1].replace(/\./g, ''))
            if (netQris) qAmt = Math.round(qAmt / 1.003)
            result.qris = qAmt
            found = true 
        }
        if (debitMatch) { result.debit = Number(debitMatch[1].replace(/\./g, '')); found = true; }
        if (found) return result
    }

    // 3. Fallback: single payment method
    if (method === 'qris') {
        const qrisNet = (netBase > 0 && total >= netBase) ? netBase : Math.round(total / 1.003)
        result.qris = netQris ? qrisNet : total
    } else if (result[method] !== undefined) {
        result[method] = total
    } else {
        result.cash = total
    }

    return result
}

