/**
 * Item nota yang merupakan pemakaian (redeem) sesi kupon.
 *
 * Di kasir, sesi kupon masuk nota sebagai item treatment seharga Rp 0 dengan diskon 100%,
 * sama persis dengan bonus gratis. Bedanya: sesi kupon sudah dibayar saat paket dijual,
 * jadi di laporan dan struk dicatat sebagai "Redeem Kupon", bukan diskon.
 *
 * Penanda yang dipakai: log pemakaian kupon (coupon_usage_logs) untuk treatment itu, yang
 * terhubung ke nota lewat transaction_id (klaim di kasir) atau lewat rekam treatment nota
 * (klaim di sisi terapis). Tanpa log, nama item "... Sesi N dari Paket ..." juga dianggap
 * redeem. Item Rp 0 lainnya dianggap bonus gratis (diskon).
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

    items.forEach(item => {
        if (item.item_type !== 'treatment') return
        if (Number(item.price || 0) !== 0 || Number(item.subtotal || 0) !== 0) return
        const left = sessionsLeft.get(item.treatment_id) || 0
        if (left > 0) {
            ids.add(item.id)
            sessionsLeft.set(item.treatment_id, Math.max(0, left - Math.max(1, Number(item.quantity) || 1)))
            return
        }
        if (SESSION_NAME_RE.test(item.name || '')) ids.add(item.id)
    })
    return ids
}
