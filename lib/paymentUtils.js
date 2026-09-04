/**
 * Payment Utilities for Ayumi Beauty House
 * Menangani parsing dan kalkulasi nominal per metode pembayaran (termasuk Split Payment & Pengurangan Biaya QRIS 0.3%).
 */

/**
 * Menghitung biaya layanan QRIS (0.3% MDR) dari transaksi.
 * Berlaku untuk transaksi tunggal QRIS maupun Split Payment yang mengandung pembayaran QRIS.
 * Memastikan biaya MDR tidak tertukar dengan diskon voucher (maksimum wajar 0.3% dari nominal QRIS).
 */
export function getQrisFee(tx) {
    if (!tx) return 0
    if (tx.payment_status === 'void') return 0

    const total = Number(tx.total || 0)
    const subtotal = Number(tx.subtotal || 0)
    const discount = Number(tx.discount || 0)
    const netBase = Math.max(0, subtotal - discount)
    const method = String(tx.payment_method || '').toLowerCase()
    const notes = String(tx.notes || '')

    // 1. Pembayaran Split yang memiliki komponen QRIS
    if (method === 'split' || notes.toLowerCase().includes('[split:') || notes.toLowerCase().includes('split:')) {
        const rawSplits = parsePaymentSplits(tx, { netQris: false })
        const qrisRaw = Number(rawSplits.qris || 0)
        if (qrisRaw > 0) {
            const diff = total - netBase
            const expectedFeeFromRaw = Math.round(qrisRaw - (qrisRaw / 1.003))
            const expectedFeeFromBase = Math.round(qrisRaw * 0.003)
            const maxAllowedFee = Math.max(expectedFeeFromRaw, expectedFeeFromBase)

            // Cek apakah selisih total - netBase cocok dengan 0.3% QRIS (toleransi rounding 3 rupiah)
            if (diff > 0 && (Math.abs(diff - expectedFeeFromRaw) <= 3 || Math.abs(diff - expectedFeeFromBase) <= 3)) {
                return diff
            }
            // Jika selisih positif dan tidak melebihi 0.3% wajar (menghindari diskon voucher disalahartikan sebagai fee)
            if (diff > 0 && diff <= maxAllowedFee + 2) {
                return diff
            }
            // Jika tidak ada surcharge yang ditambahkan ke total transaksi, fee adalah 0
            return 0
        }
        return 0
    }

    // 2. Pembayaran tunggal QRIS
    if (method === 'qris') {
        const diff = total - netBase
        const expectedFee = Math.round(netBase * 0.003)

        // Cek apakah selisih total - netBase cocok dengan penambahan 0.3% (toleransi rounding 3 rupiah)
        if (diff > 0 && Math.abs(diff - expectedFee) <= 3) {
            return diff
        }
        // Jika netBase terdefinisi dan selisih positif masih dalam rentang 0.3% wajar (+ 5 rupiah)
        if (total > 0 && diff > 0 && diff <= expectedFee + 5) {
            return diff
        }
        // Jika total sama dengan netBase (atau selisih besar karena diskon voucher lama), berarti tidak ada penambahan surcharge pada transaksi ini
        return 0
    }

    return 0
}

/**
 * Menghitung pendapatan bersih klinik dari suatu transaksi.
 * Biaya layanan QRIS (0.3% MDR) tidak dimasukkan ke dalam pendapatan klinik.
 */
export function getNetTransactionRevenue(tx) {
    if (!tx) return 0
    if (tx.payment_status === 'void') return 0

    const total = Number(tx.total || 0)
    const fee = getQrisFee(tx)

    // Jika transaksi memiliki biaya tambahan QRIS, kurangkan fee dari total agar menjadi omset murni
    if (fee > 0) {
        return Math.max(0, total - fee)
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
                const fee = getQrisFee(tx)
                result.qris = Math.max(0, result.qris - fee)
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
            if (netQris) {
                const fee = getQrisFee(tx)
                qAmt = Math.max(0, qAmt - fee)
            }
            result.qris = qAmt
            found = true 
        }
        if (debitMatch) { result.debit = Number(debitMatch[1].replace(/\./g, '')); found = true; }
        if (found) return result
    }

    // 3. Fallback: single payment method
    if (method === 'qris') {
        result.qris = netQris ? getNetTransactionRevenue(tx) : total
    } else if (result[method] !== undefined) {
        result[method] = total
    } else {
        result.cash = total
    }

    return result
}
