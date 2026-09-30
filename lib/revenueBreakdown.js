import { getNetTransactionRevenue } from './paymentUtils'

/**
 * Rincian pendapatan satu nota per kategori: kotor, diskon, dan bersih.
 *
 * - Kotor  = harga normal item x jumlah.
 * - Bersih = bagian kategori dari pendapatan nota (total dikurangi biaya QRIS).
 *            Jumlah bersih semua kategori selalu sama dengan getNetTransactionRevenue,
 *            sehingga rincian ini cocok dengan total omzet di dashboard.
 * - Diskon = kotor - bersih, termasuk bonus gratis (item diskon 100%).
 *
 * Diskon yang diberikan per nota dibagi ke tiap kategori sesuai porsi harganya.
 *
 * Pemakaian sesi kupon tidak dihitung sebagai pendapatan treatment, karena uangnya
 * sudah tercatat saat paket kupon dijual. Untuk nota aplikasi, sesi kupon tercatat
 * sebagai item seharga 0 dan dihitung dari coupon_usage_logs. Nota migrasi GD Cashier
 * tidak punya log itu, jadi nilainya diturunkan dari angka nota (lihat
 * getGdCouponRedemptionValue).
 */

export const REVENUE_CATEGORIES = ['treatment', 'product', 'coupon', 'other']

const emptyBuckets = () => ({ treatment: 0, product: 0, coupon: 0, other: 0 })

const categoryOf = (item) =>
    item.item_type === 'treatment' || item.item_type === 'product' || item.item_type === 'coupon'
        ? item.item_type
        : 'other'

// Nomor nota GD Cashier berawalan POTX; nota aplikasi berawalan TRX-.
export function isGdCashierTransaction(tx) {
    return String(tx?.transaction_number || '').startsWith('POTX')
}

const itemGross = (item) => {
    const qty = Number(item.quantity || 1)
    const unit = Math.max(Number(item.original_price || 0), Number(item.price || 0))
    return Math.max(unit * qty, Number(item.subtotal || 0))
}

/**
 * Nilai sesi kupon yang dipakai pada nota migrasi GD Cashier.
 *
 * Script migrasi menyimpan diskon nota sebagai diskon item + diskon kupon, padahal di
 * GD diskon kupon sudah termasuk dalam diskon item. Selisih itulah nilai kuponnya:
 * diskon nota - (harga normal item - total). Nota yang seluruhnya dibayar kupon
 * (total 0) sudah dinormalkan lewat 20260930_fix_gd_coupon_negative_totals.sql,
 * sehingga nilai kuponnya adalah seluruh harga treatment di nota itu.
 *
 * Dicocokkan dengan kolom diskon_kupon di file Excel GD: 30.155 nota dengan total di
 * atas 0 cocok semua. Dari nota bertotal 0, 25 nota lama (2023-2025) sebenarnya treatment
 * gratis tanpa kupon; keduanya bernilai bersih 0, jadi omzet tidak terpengaruh.
 */
export function getGdCouponRedemptionValue(tx, grossTotal, treatmentGross) {
    if (!isGdCashierTransaction(tx) || tx.payment_status === 'void') return 0
    const total = Number(tx.total || 0)
    if (total === 0 && grossTotal > 0) return treatmentGross
    return Math.max(0, Number(tx.discount || 0) - (grossTotal - total))
}

export function getTransactionRevenueBreakdown(tx) {
    const netTotal = getNetTransactionRevenue(tx)
    const gross = emptyBuckets()
    const net = emptyBuckets()
    const base = emptyBuckets()
    const items = tx?.transaction_items || []

    // Nota tanpa rincian item dihitung sebagai treatment, sama seperti sebelumnya.
    if (items.length === 0) {
        gross.treatment = netTotal
        net.treatment = netTotal
        return { gross, net, discount: emptyBuckets(), netTotal, couponRedeemedValue: 0, couponRedeemedSessions: 0, itemNets: [] }
    }

    // Per item: kategori, harga kotor, dan dasar pembagian pendapatan bersih.
    const perItem = items.map(item => {
        const subtotal = Number(item.subtotal || 0)
        const cat = categoryOf(item)
        // Item seharga 0 (sesi kupon atau bonus di kasir aplikasi) tidak menambah kotor.
        if (Number(item.price || 0) === 0 && subtotal === 0) return { cat, gross: 0, base: 0 }
        const g = itemGross(item)
        // Bonus gratis (diskon 100%) masuk kotor dan diskon, tidak mendapat bagian bersih.
        const b = Number(item.discount_percent || 0) >= 100 ? 0 : subtotal
        return { cat, gross: g, base: b }
    })
    perItem.forEach(it => {
        gross[it.cat] += it.gross
        base[it.cat] += it.base
    })

    const grossTotal = REVENUE_CATEGORIES.reduce((s, c) => s + gross[c], 0)
    let couponRedeemedValue = 0
    const redemption = getGdCouponRedemptionValue(tx, grossTotal, gross.treatment)
    if (redemption > 0) {
        couponRedeemedValue = Math.min(redemption, gross.treatment)
        // Nilai sesi kupon dikurangkan dari item treatment secara proporsional.
        const grossFactor = gross.treatment > 0 ? (gross.treatment - couponRedeemedValue) / gross.treatment : 0
        const baseAfter = Math.max(0, base.treatment - couponRedeemedValue)
        const baseFactor = base.treatment > 0 ? baseAfter / base.treatment : 0
        perItem.forEach(it => {
            if (it.cat !== 'treatment') return
            it.gross *= grossFactor
            it.base *= baseFactor
        })
        gross.treatment -= couponRedeemedValue
        base.treatment = baseAfter
    }

    const baseTotal = REVENUE_CATEGORIES.reduce((s, c) => s + base[c], 0)
    const grossAfter = REVENUE_CATEGORIES.reduce((s, c) => s + gross[c], 0)
    REVENUE_CATEGORIES.forEach(c => {
        if (baseTotal > 0) net[c] = netTotal * base[c] / baseTotal
        else if (grossAfter > 0) net[c] = netTotal * gross[c] / grossAfter
    })
    if (baseTotal === 0 && grossAfter === 0) net.other = netTotal

    // Pendapatan bersih per item, dengan aturan pembagian yang sama. Dipakai untuk
    // peringkat layanan/produk dan analisis kategori.
    const itemNets = perItem.map(it => {
        if (baseTotal > 0) return Math.round(netTotal * it.base / baseTotal)
        if (grossAfter > 0) return Math.round(netTotal * it.gross / grossAfter)
        return 0
    })

    // Dibulatkan ke rupiah; sisa pembulatan diberikan ke kategori terbesar agar
    // jumlahnya tetap sama persis dengan netTotal.
    let largest = 'treatment'
    REVENUE_CATEGORIES.forEach(c => {
        net[c] = Math.round(net[c])
        if (Math.abs(net[c]) > Math.abs(net[largest])) largest = c
    })
    net[largest] += Math.round(netTotal) - REVENUE_CATEGORIES.reduce((s, c) => s + net[c], 0)

    const discount = emptyBuckets()
    REVENUE_CATEGORIES.forEach(c => { discount[c] = gross[c] - net[c] })

    return {
        gross,
        net,
        discount,
        netTotal,
        couponRedeemedValue,
        couponRedeemedSessions: couponRedeemedValue > 0 ? 1 : 0,
        itemNets
    }
}
