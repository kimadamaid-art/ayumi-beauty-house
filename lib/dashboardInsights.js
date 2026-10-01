import { getTransactionRevenueBreakdown } from './revenueBreakdown'

/**
 * Analisis dashboard owner: peringkat layanan/produk, pola waktu, kategori,
 * demografi, dan retensi pasien.
 *
 * Semua nominal memakai pendapatan bersih (setelah diskon dan biaya QRIS), sama dengan
 * total omzet di kartu cabang. Sebelumnya bagian ini mencampur harga sebelum diskon
 * (nota aplikasi) dan sesudah diskon item (nota GD), dan sesi kupon ikut dihitung
 * sebagai pendapatan treatment walau uangnya sudah masuk saat paket dijual.
 *
 * Jumlah (terjual / sesi) tetap menghitung sesi kupon, karena layanannya memang dikerjakan.
 *
 * branchId kosong berarti semua cabang. priorPatientIds berisi pasien yang sudah pernah
 * bertransaksi sebelum periode ini, di cabang mana pun.
 */

const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

export function computeDashboardInsights(transactions, context = {}, branchId = '') {
    const {
        treatmentCatMap = {},
        productCatMap = {},
        allActiveTreatments = [],
        priorPatientIds = new Set()
    } = context

    const dayOfWeekStats = DAY_NAMES.map(name => ({ day: name, sales: 0, count: 0 }))
    const hourlyStats = Array.from({ length: 14 }, (_, i) => ({
        hour: `${String(i + 8).padStart(2, '0')}:00`,
        label: `${String(i + 8).padStart(2, '0')}:00`,
        sales: 0,
        count: 0
    }))
    const categoryMap = {}
    const treatmentMap = {}
    const productMap = {}
    const patientsMap = new Map()
    const retention = {
        treatment: { newIds: new Set(), oldIds: new Set(), newRevenue: 0, oldRevenue: 0 },
        product: { newIds: new Set(), oldIds: new Set(), newRevenue: 0, oldRevenue: 0 }
    }

    ;(transactions || []).forEach(tx => {
        // Hanya nota lunas, sama dengan ringkasan omzet dashboard & Riwayat Transaksi.
        if (!tx || tx.payment_status !== 'paid') return
        if (branchId && tx.branch_id !== branchId) return

        const breakdown = getTransactionRevenueBreakdown(tx)
        const txNet = breakdown.netTotal

        const txDate = new Date(tx.created_at)
        const dayIdx = txDate.getDay()
        const dayOrder = dayIdx === 0 ? 6 : dayIdx - 1
        if (dayOfWeekStats[dayOrder]) {
            dayOfWeekStats[dayOrder].sales += txNet
            dayOfWeekStats[dayOrder].count += 1
        }
        const txHr = txDate.getHours()
        if (txHr >= 8 && txHr <= 21 && hourlyStats[txHr - 8]) {
            hourlyStats[txHr - 8].sales += txNet
            hourlyStats[txHr - 8].count += 1
        }

        if (tx.patients && tx.patients.id) {
            patientsMap.set(tx.patients.id, tx.patients)
        }
        const isReturning = tx.patient_id ? priorPatientIds.has(tx.patient_id) : false

        ;(tx.transaction_items || []).forEach((item, idx) => {
            const itemNet = breakdown.itemNets[idx] || 0
            const itemQty = Number(item.quantity || 1)
            const itemName = item.name || 'Item Perawatan/Produk'

            let itemCat = 'LAINNYA'
            if (item.item_type === 'treatment') {
                itemCat = treatmentCatMap[item.treatment_id] || treatmentCatMap[itemName] || 'FACE TREATMENT'
            } else if (item.item_type === 'product') {
                itemCat = productCatMap[item.product_id] || productCatMap[itemName] || 'Ayumi Produk'
            } else if (item.item_type === 'coupon') {
                itemCat = 'PAKET KUPON'
            }
            itemCat = itemCat.trim()
            if (!categoryMap[itemCat]) {
                categoryMap[itemCat] = { category: itemCat, volume: 0, sales: 0, items: {} }
            }
            categoryMap[itemCat].volume += itemQty
            categoryMap[itemCat].sales += itemNet
            if (!categoryMap[itemCat].items[itemName]) {
                categoryMap[itemCat].items[itemName] = { name: itemName, count: 0, revenue: 0 }
            }
            categoryMap[itemCat].items[itemName].count += itemQty
            categoryMap[itemCat].items[itemName].revenue += itemNet

            const listMap = item.item_type === 'treatment' ? treatmentMap
                : item.item_type === 'product' ? productMap
                    : null
            if (listMap) {
                if (!listMap[itemName]) listMap[itemName] = { name: itemName, count: 0, revenue: 0 }
                listMap[itemName].count += itemQty
                listMap[itemName].revenue += itemNet
            }

            if (tx.patient_id && (item.item_type === 'treatment' || item.item_type === 'product')) {
                const r = retention[item.item_type]
                if (isReturning) {
                    r.oldIds.add(tx.patient_id)
                    r.oldRevenue += itemNet
                } else {
                    r.newIds.add(tx.patient_id)
                    r.newRevenue += itemNet
                }
            }
        })
    })

    const byRevenueThenCount = (a, b) => (b.revenue !== a.revenue ? b.revenue - a.revenue : b.count - a.count)

    const topTreatments = Object.values(treatmentMap).sort(byRevenueThenCount).slice(0, 5)
    const topProducts = Object.values(productMap).sort(byRevenueThenCount).slice(0, 5)

    const categoryList = Object.values(categoryMap).map(cat => ({
        ...cat,
        topItems: Object.values(cat.items || {}).sort(byRevenueThenCount)
    }))
    const categoryVolumeStats = [...categoryList].sort((a, b) => b.volume - a.volume)
    const categorySalesStats = [...categoryList].sort((a, b) => b.sales - a.sales)

    // Treatment terendah: semua treatment aktif, termasuk yang belum terjual sama sekali.
    const completeTreatmentList = allActiveTreatments.map(t => treatmentMap[t.name] || { name: t.name, count: 0, revenue: 0 })
    const listToSort = completeTreatmentList.length > 0 ? completeTreatmentList : Object.values(treatmentMap)
    const bottomTreatments = [...listToSort]
        .sort((a, b) => (a.count !== b.count ? a.count - b.count : a.revenue - b.revenue))
        .slice(0, 5)

    let femaleCount = 0
    let maleCount = 0
    const ageGroupMap = { '6-12': 0, '13-18': 0, '19-24': 0, '25-34': 0, '35-44': 0, '45+': 0, 'Lainnya': 0 }
    const now = new Date()
    patientsMap.forEach(p => {
        const g = (p.gender || '').toLowerCase()
        if (g === 'male' || g === 'pria' || g === 'laki-laki') maleCount++
        else femaleCount++

        if (p.birth_date) {
            const age = Math.floor((now - new Date(p.birth_date)) / (365.25 * 24 * 60 * 60 * 1000))
            if (age >= 6 && age <= 12) ageGroupMap['6-12']++
            else if (age >= 13 && age <= 18) ageGroupMap['13-18']++
            else if (age >= 19 && age <= 24) ageGroupMap['19-24']++
            else if (age >= 25 && age <= 34) ageGroupMap['25-34']++
            else if (age >= 35 && age <= 44) ageGroupMap['35-44']++
            else if (age >= 45) ageGroupMap['45+']++
            else ageGroupMap['Lainnya']++
        } else {
            ageGroupMap['Lainnya']++
        }
    })
    const totalPatients = femaleCount + maleCount
    const knownAgeTotal = totalPatients - ageGroupMap['Lainnya']
    const pct = (n, total) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0')

    const demographicGender = [
        { name: 'Wanita', value: femaleCount, percent: pct(femaleCount, totalPatients) },
        { name: 'Pria', value: maleCount, percent: pct(maleCount, totalPatients) }
    ]
    const demographicAge = [
        { group: '19-24 Thn', count: ageGroupMap['19-24'], percent: pct(ageGroupMap['19-24'], knownAgeTotal) },
        { group: '25-34 Thn', count: ageGroupMap['25-34'], percent: pct(ageGroupMap['25-34'], knownAgeTotal) },
        { group: '35-44 Thn', count: ageGroupMap['35-44'], percent: pct(ageGroupMap['35-44'], knownAgeTotal) },
        { group: '45+ Thn', count: ageGroupMap['45+'], percent: pct(ageGroupMap['45+'], knownAgeTotal) },
        { group: '13-18 Thn', count: ageGroupMap['13-18'], percent: pct(ageGroupMap['13-18'], knownAgeTotal) },
        { group: '6-12 Thn', count: ageGroupMap['6-12'], percent: pct(ageGroupMap['6-12'], knownAgeTotal) },
        { group: 'Lainnya', count: ageGroupMap['Lainnya'], percent: pct(ageGroupMap['Lainnya'], totalPatients) }
    ]

    const retentionOf = (r) => ({
        newCount: r.newIds.size,
        oldCount: r.oldIds.size,
        newRevenue: r.newRevenue,
        oldRevenue: r.oldRevenue,
        totalRevenue: r.newRevenue + r.oldRevenue
    })

    return {
        dayOfWeekStats,
        hourlyStats,
        categorySalesStats,
        categoryVolumeStats,
        topTreatments,
        topProducts,
        bottomTreatments,
        demographicGender,
        demographicAge,
        retentionStats: {
            treatment: retentionOf(retention.treatment),
            product: retentionOf(retention.product)
        },
        patientIds: Array.from(patientsMap.keys())
    }
}
