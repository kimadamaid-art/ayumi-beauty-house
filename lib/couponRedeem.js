/**
 * Item nota yang merupakan pemakaian (redeem) sesi kupon.
 *
 * Di kasir, sesi kupon masuk nota sebagai item treatment seharga Rp 0 dengan diskon 100%,
 * sama persis dengan bonus gratis. Bedanya: sesi kupon sudah dibayar saat paket dijual,
 * jadi di laporan dan struk dicatat sebagai "Redeem Kupon", bukan diskon.
 *
 * Penanda yang dipakai: log pemakaian kupon (coupon_usage_logs) yang terhubung ke nota lewat
 * transaction_id (klaim di kasir) atau lewat rekam treatment nota (klaim di sisi terapis).
 * Log dipasangkan dulu ke item dengan treatment yang sama; sisa log dipasangkan ke item Rp 0
 * lain di nota yang sama (kupon yang dipakai untuk varian treatment). Tanpa log, nama item
 * "... Sesi N dari Paket ..." juga dianggap redeem. Item Rp 0 lainnya = bonus gratis (diskon).
 *
 * Supaya penanda ini tersedia, query nota perlu menyertakan COUPON_REDEEM_SELECT.
 */

// Potongan select Supabase untuk nota (tabel transactions).
export const COUPON_REDEEM_SELECT = `
    coupon_usage_logs (id, voided_at, patient_coupon_items (treatment_id)),
    redeem_record:treatment_records (coupon_usage_logs (id, voided_at, patient_coupon_items (treatment_id)))
`

const SESSION_NAME_RE = /sesi\s*\d+\s*dari\s*paket/i

/** Set berisi id item nota yang merupakan redeem sesi kupon. */
export function getCouponRedeemItemIds(tx) {
    const ids = new Set()
    const items = tx?.transaction_items || []
    if (items.length === 0) return ids

    const record = tx.redeem_record || tx.treatment_records
    const logs = [...(tx.coupon_usage_logs || []), ...(record?.coupon_usage_logs || [])]
    const seen = new Set()
    const sessionsLeft = new Map()
    logs.forEach(log => {
        if (!log || log.voided_at) return
        if (log.id) {
            if (seen.has(log.id)) return
            seen.add(log.id)
        }
        const treatmentId = log.patient_coupon_items?.treatment_id
        if (treatmentId) sessionsLeft.set(treatmentId, (sessionsLeft.get(treatmentId) || 0) + 1)
    })

    const zeroItems = items.filter(item =>
        item.item_type === 'treatment' && Number(item.price || 0) === 0 && Number(item.subtotal || 0) === 0)
    const qtyOf = (item) => Math.max(1, Number(item.quantity) || 1)

    // 1. Pasangkan sesi kupon dengan item untuk treatment yang sama persis.
    const unmatched = []
    zeroItems.forEach(item => {
        const left = sessionsLeft.get(item.treatment_id) || 0
        if (left > 0) {
            ids.add(item.id)
            sessionsLeft.set(item.treatment_id, Math.max(0, left - qtyOf(item)))
        } else if (SESSION_NAME_RE.test(item.name || '')) {
            ids.add(item.id)
        } else {
            unmatched.push(item)
        }
    })

    // 2. Kupon boleh dipakai untuk varian treatment lain (mis. kupon "Bright Booster" untuk
    //    "Bright Booster 12/Pin Nano"; lihat isCouponEligibleForTreatment di kasir). Log
    //    kuponnya mencatat treatment asli, jadi ID-nya berbeda dari item nota. Sesi kupon
    //    yang tersisa di nota ini dipasangkan ke item Rp 0 yang belum terpasang.
    let leftover = [...sessionsLeft.values()].reduce((sum, n) => sum + n, 0)
    unmatched.forEach(item => {
        if (leftover <= 0) return
        ids.add(item.id)
        leftover -= qtyOf(item)
    })
    return ids
}
