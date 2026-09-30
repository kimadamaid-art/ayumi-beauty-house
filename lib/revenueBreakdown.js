import { getNetTransactionRevenue } from './paymentUtils'
import { getCouponRedeemItemIds } from './couponRedeem'

/**
 * Rincian pendapatan satu nota per kategori: kotor, diskon, redeem kupon, dan bersih.
 *
 *   Kotor - Diskon - Redeem Kupon = Bersih
 *
 * - Kotor  = harga asli item (sebelum diskon) x jumlah, termasuk item yang dibayar dengan
 *            sesi kupon dan bonus gratis. Sama dengan "pendapatan kotor" di GD Cashier.
 * - Redeem = nilai sesi kupon yang dipakai di nota ini. Uangnya sudah diterima saat paket
 *            dijual, jadi bukan diskon dan bukan pendapatan baru.
 * - Bersih = bagian kategori dari pendapatan nota (total dikurangi biaya QRIS).
 *            Jumlah bersih semua kategori selalu sama dengan getNetTransactionRevenue,
 *            sehingga rincian ini cocok dengan total omzet di dashboard.
 * - Diskon = kotor - bersih - redeem, termasuk bonus gratis (item Rp 0 tanpa kupon).
 *
 * Diskon yang diberikan per nota dibagi ke tiap kategori sesuai porsi harganya.
 *
 * Sesi kupon di nota aplikasi dikenali lewat coupon_usage_logs (lihat lib/couponRedeem.js;
 * query nota perlu menyertakan COUPON_REDEEM_SELECT). Nota migrasi GD Cashier tidak punya
 * log itu, jadi nilainya diturunkan dari angka nota (lihat getGdCouponRedemptionValue).
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
        return { gross, net, discount: emptyBuckets(), redeem: emptyBuckets(), redeemTotal: 0, netTotal, couponRedeemedValue: 0, couponRedeemedSessions: 0, itemNets: [] }
    }

    const redeem = emptyBuckets()
    const redeemItemIds = getCouponRedeemItemIds(tx)

    // Per item: kategori, harga kotor, dan dasar pembagian pendapatan bersih.
    const perItem = items.map(item => {
        const subtotal = Number(item.subtotal || 0)
        const cat = categoryOf(item)
        // Item seharga 0: sesi kupon (redeem) atau bonus gratis (diskon). Keduanya masuk
        // kotor sebesar harga aslinya dan tidak mendapat bagian pendapatan bersih.
        if (Number(item.price || 0) === 0 && subtotal === 0) {
            const g = Number(item.original_price || 0) * Math.max(1, Number(item.quantity) || 1)
            return { cat, gross: g, base: 0, redeem: redeemItemIds.has(item.id) ? g : 0 }
        }
        const g = itemGross(item)
        // Bonus gratis (diskon 100%) masuk kotor dan diskon, tidak mendapat bagian bersih.
        const b = Number(item.discount_percent || 0) >= 100 ? 0 : subtotal
        return { cat, gross: g, base: b, redeem: 0 }
    })
    perItem.forEach(it => {
        gross[it.cat] += it.gross
        base[it.cat] += it.base
        redeem[it.cat] += it.redeem
    })

    const grossTotal = REVENUE_CATEGORIES.reduce((s, c) => s + gross[c], 0)
    let couponRedeemedValue = 0
    const redemption = getGdCouponRedemptionValue(tx, grossTotal, gross.treatment)
    if (redemption > 0) {
        couponRedeemedValue = Math.min(redemption, gross.treatment)
        // Nilai sesi kupon tetap di kotor (sama seperti GD), dicatat sebagai redeem, dan
        // tidak mendapat bagian pendapatan bersih: dasar pembagian treatment dikurangi
        // secara proporsional.
        const baseAfter = Math.max(0, base.treatment - couponRedeemedValue)
        const baseFactor = base.treatment > 0 ? baseAfter / base.treatment : 0
        perItem.forEach(it => {
            if (it.cat !== 'treatment') return
            it.base *= baseFactor
        })
        base.treatment = baseAfter
        redeem.treatment += couponRedeemedValue
    }

    const baseTotal = REVENUE_CATEGORIES.reduce((s, c) => s + base[c], 0)
    // Cadangan bila tidak ada dasar pembagian: porsi kotor di luar nilai redeem kupon.
    const payable = (c) => gross[c] - redeem[c]
    const grossAfter = REVENUE_CATEGORIES.reduce((s, c) => s + payable(c), 0)
    REVENUE_CATEGORIES.forEach(c => {
        if (baseTotal > 0) net[c] = netTotal * base[c] / baseTotal
        else if (grossAfter > 0) net[c] = netTotal * payable(c) / grossAfter
    })
    if (baseTotal === 0 && grossAfter === 0) net.other = netTotal

    // Pendapatan bersih per item, dengan aturan pembagian yang sama. Dipakai untuk
    // peringkat layanan/produk dan analisis kategori.
    const itemNets = perItem.map(it => {
        if (baseTotal > 0) return Math.round(netTotal * it.base / baseTotal)
        if (grossAfter > 0) return Math.round(netTotal * (it.gross - it.redeem) / grossAfter)
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
    REVENUE_CATEGORIES.forEach(c => { discount[c] = gross[c] - net[c] - redeem[c] })
    const redeemTotal = REVENUE_CATEGORIES.reduce((s, c) => s + redeem[c], 0)

    return {
        gross,
        net,
        discount,
        redeem,
        redeemTotal,
        netTotal,
        couponRedeemedValue,
        couponRedeemedSessions: couponRedeemedValue > 0 ? 1 : 0,
        itemNets
    }
}
