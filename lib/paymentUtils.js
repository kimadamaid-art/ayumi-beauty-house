/**
 * Payment Utilities for Ayumi Beauty House
 * Menangani parsing dan kalkulasi nominal per metode pembayaran (termasuk Split Payment).
 */

export function parsePaymentSplits(tx) {
    const defaultBreakdown = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }
    if (!tx) return defaultBreakdown

    const total = Number(tx.total || 0)
    const notes = String(tx.notes || '')
    const method = String(tx.payment_method || '').toLowerCase()

    // 1. Cek tag split terstruktur di notes: e.g. [SPLIT:cash=299000;transfer=599000]
    const splitMatch = notes.match(/\[SPLIT:([^\]]+)\]/i)
    if (splitMatch) {
        const result = { ...defaultBreakdown }
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
        if (matchedTotal > 0) return result
    }

    // 2. Cek text split di notes: e.g. "Split: Cash Rp 300.000, Transfer Rp 598.000"
    if (notes.toLowerCase().includes('split:')) {
        const result = { ...defaultBreakdown }
        const cashMatch = notes.match(/cash\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const transferMatch = notes.match(/transfer\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const qrisMatch = notes.match(/qris\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        const debitMatch = notes.match(/debit\s*(?:rp\.?|:)?\s*([0-9.]+)/i)
        
        let found = false
        if (cashMatch) { result.cash = Number(cashMatch[1].replace(/\./g, '')); found = true; }
        if (transferMatch) { result.transfer = Number(transferMatch[1].replace(/\./g, '')); found = true; }
        if (qrisMatch) { result.qris = Number(qrisMatch[1].replace(/\./g, '')); found = true; }
        if (debitMatch) { result.debit = Number(debitMatch[1].replace(/\./g, '')); found = true; }
        if (found) return result
    }

    // 3. Fallback: single payment method
    const result = { ...defaultBreakdown }
    if (result[method] !== undefined) {
        result[method] = total
    } else {
        result.cash = total
    }
    return result
}
