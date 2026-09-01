/**
 * Utilitas Kalkulasi Komisi Terapis Ayumi Beauty House
 * Standarisasi perhitungan komisi untuk tindakan reguler, diskon, dan kupon/paket.
 */

/**
 * Mendapatkan basis harga tarif yang digunakan untuk persentase komisi
 * @param {Object} item - Item tindakan (treatment_record_item)
 * @param {number|null} proportionalCouponPrice - Harga riil per sesi kupon (setelah diskon paket)
 * @returns {number} Basis harga tarif
 */
export function getCommissionBasePrice(item, proportionalCouponPrice = null) {
    if (!item) return 0

    const priceAtTime = Number(item.price_at_time || 0)
    
    // 1. Jika tindakan berbayar langsung (reguler / dengan diskon khusus)
    if (priceAtTime > 0) {
        return priceAtTime
    }

    // 2. Jika menggunakan kupon (priceAtTime === 0):
    // Prioritaskan harga per sesi yang dihitung proporsional dari harga beli paket riil (setelah diskon kasir)
    const propPrice = proportionalCouponPrice !== null && proportionalCouponPrice !== undefined 
        ? Number(proportionalCouponPrice)
        : Number(item.proportional_coupon_price || 0)

    if (propPrice > 0) {
        return propPrice
    }

    // 3. Cek apakah ada catatan KUPON_BARU di notes: [KUPON_BARU:id:name:price]
    const rawNotes = item.notes || ''
    const matchNewPkg = rawNotes.match(/\[KUPON_BARU:([^:]+):([^:]+):([^\]]+)\]/)
    if (matchNewPkg) {
        const pkgPrice = Number(matchNewPkg[3]) || 0
        let totalSessions = 1
        const matchSessionsInNotes = rawNotes.match(/Sesi\s+\d+\/(\d+)/i)
        const matchSessionsInName = matchNewPkg[2].match(/(\d+)\s*x/i) || matchNewPkg[2].match(/x\s*(\d+)/i)
        
        if (matchSessionsInNotes) {
            totalSessions = Number(matchSessionsInNotes[1]) || 1
        } else if (matchSessionsInName) {
            totalSessions = Number(matchSessionsInName[1]) || 1
        }

        if (pkgPrice > 0 && totalSessions > 0) {
            return Math.round(pkgPrice / totalSessions)
        }
    }

    // 4. Fallback jika kupon tanpa data harga paket riil
    if (Number(item.original_price || 0) > 0) {
        return Number(item.original_price)
    }

    return 0
}

/**
 * Menghitung nominal komisi terapis
 * @param {Object} item - Item tindakan
 * @param {number|null} proportionalCouponPrice - Harga riil per sesi kupon
 * @returns {number} Nominal komisi dalam Rupiah
 */
export function calculateTherapistCommission(item, proportionalCouponPrice = null) {
    if (!item) return 0
    const commPercent = Number(item.commission_percent !== undefined && item.commission_percent !== null ? item.commission_percent : 0)
    if (commPercent <= 0) return 0

    const basePrice = getCommissionBasePrice(item, proportionalCouponPrice)
    return Math.round(basePrice * (commPercent / 100))
}

/**
 * Helper untuk membangun Map per-treatment_record_id ke harga proporsional sesi kupon
 * Memperhitungkan diskon pada level transaksi kasir maupun diskon item kupon.
 * @param {Array} couponUsageLogs - Data dari tabel coupon_usage_logs
 * @returns {Object} Map { [treatment_record_id]: pricePerSession }
 */
export function buildCouponPriceMap(couponUsageLogs) {
    const couponMap = {}
    if (!Array.isArray(couponUsageLogs)) return couponMap

    couponUsageLogs.forEach(cl => {
        if (cl.treatment_record_id && cl.patient_coupon_items) {
            const pCoupons = cl.patient_coupon_items.patient_coupons
            const tx = pCoupons?.transactions
            const couponTxItem = tx?.transaction_items?.find(ti => ti.item_type === 'coupon')
            
            let purchasePrice = 0

            if (tx) {
                const txTotal = Number(tx.total || 0)
                const txSubtotal = Number(tx.subtotal || 0)
                const txDiscount = Number(tx.discount || 0)
                const itemSubtotal = couponTxItem ? Number(couponTxItem.subtotal || couponTxItem.price || 0) : 0

                if (itemSubtotal > 0 && txSubtotal > 0 && txDiscount > 0) {
                    // Ada diskon transaksi di kasir: hitung proporsional harga riil bersih kupon
                    const discountRatio = (txSubtotal - txDiscount) / txSubtotal
                    purchasePrice = Math.round(itemSubtotal * discountRatio)
                } else if (txTotal > 0) {
                    if (itemSubtotal > 0 && txSubtotal > 0 && itemSubtotal === txSubtotal) {
                        purchasePrice = txTotal
                    } else if (itemSubtotal > 0) {
                        purchasePrice = itemSubtotal
                    } else {
                        purchasePrice = txTotal
                    }
                } else if (itemSubtotal > 0) {
                    purchasePrice = itemSubtotal
                }
            }

            // Fallback jika tidak ada data transaksi (cth: kupon paket manual / master package price)
            if (purchasePrice <= 0) {
                purchasePrice = Number(pCoupons?.coupon_packages?.price || 0)
            }

            const totalSessions = Number(cl.patient_coupon_items.total_sessions || 1)

            if (purchasePrice > 0 && totalSessions > 0) {
                couponMap[cl.treatment_record_id] = Math.round(purchasePrice / totalSessions)
            }
        }
    })

    return couponMap
}

