import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parsePaymentSplits } from '../lib/paymentUtils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function loadEnv() {
    const envPath = path.join(__dirname, '../.env.local')
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n')
        lines.forEach(line => {
            const trimmed = line.trim()
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...rest] = trimmed.split('=')
                const val = rest.join('=').replace(/(^["']|["']$)/g, '')
                process.env[key.trim()] = val.trim()
            }
        })
    }
}
loadEnv()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const CIAMIS_BRANCH_ID = '6bc44a26-f7f3-4ea7-8902-a2c48e27b598'
const TARGET_DATE = '2026-08-31'

async function verify() {
    console.log('====================================================')
    console.log('🧪 VERIFIKASI REKONSILIASI LENGKAP 31 AGUSTUS 2026')
    console.log('====================================================')

    // 1. Ambil transaksi tanggal 31 Agustus 2026
    const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select(`
            id, transaction_number, total, subtotal, discount, payment_method, notes,
            patient_id, created_at,
            patients ( full_name ),
            transaction_items (
                id, item_type, name, price, quantity, original_price, discount_percent, commission_percent, subtotal
            )
        `)
        .eq('branch_id', CIAMIS_BRANCH_ID)
        .gte('created_at', `${TARGET_DATE}T00:00:00`)
        .lte('created_at', `${TARGET_DATE}T23:59:59.999`)
        .order('created_at', { ascending: true })

    if (txErr) throw txErr

    console.log(`\n📦 1. VERIFIKASI SISI PENJUALAN:`)
    console.log(`   - Jumlah Transaksi : ${txs.length} (Target: 12) -> ${txs.length === 12 ? '✅ PAS' : '❌ SALAH'}`)
    
    let totalSales = 0
    let treatmentRevenue = 0
    let productRevenue = 0
    let totalItems = 0
    let treatmentItemsCount = 0
    let productItemsCount = 0

    txs.forEach(t => {
        totalSales += Number(t.total || 0)
        t.transaction_items.forEach(item => {
            totalItems++
            if (item.item_type === 'treatment') {
                treatmentRevenue += Number(item.subtotal || (item.price * item.quantity))
                treatmentItemsCount += item.quantity
            } else if (item.item_type === 'product') {
                productRevenue += Number(item.subtotal || (item.price * item.quantity))
                productItemsCount += item.quantity
            }
        })
    })

    console.log(`   - Total Omset      : Rp ${totalSales.toLocaleString('id-ID')} (Target: Rp 2.995.000) -> ${totalSales === 2995000 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Omset Treatment  : Rp ${treatmentRevenue.toLocaleString('id-ID')} (Target: Rp 1.969.000) -> ${treatmentRevenue === 1969000 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Omset Produk     : Rp ${productRevenue.toLocaleString('id-ID')} (Target: Rp 1.026.000) -> ${productRevenue === 1026000 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Total Baris Item : ${totalItems} (Target: 21) -> ${totalItems === 21 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Sesi Treatment   : ${treatmentItemsCount} (Target: 9) -> ${treatmentItemsCount === 9 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Item Produk Skincare: ${productItemsCount} (Target: 12) -> ${productItemsCount === 12 ? '✅ PAS' : '❌ SALAH'}`)

    // 2. Verifikasi Rekap Metode Pembayaran (Split Payment)
    console.log(`\n💳 2. VERIFIKASI METODE PEMBAYARAN & SPLIT:`)
    const payBreakdown = { cash: 0, transfer: 0, qris: 0, debit: 0, credit: 0 }
    txs.forEach(t => {
        const splits = parsePaymentSplits(t)
        Object.entries(splits).forEach(([m, amt]) => {
            if (payBreakdown[m] !== undefined) payBreakdown[m] += amt
        })
    })

    console.log(`   - Total Tunai (Cash)     : Rp ${payBreakdown.cash.toLocaleString('id-ID')} (Target: Rp 2.264.000) -> ${payBreakdown.cash === 2264000 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Total Transfer Bank    : Rp ${payBreakdown.transfer.toLocaleString('id-ID')} (Target: Rp 731.000) -> ${payBreakdown.transfer === 731000 ? '✅ PAS' : '❌ SALAH'}`)
    console.log(`   - Total Keseluruhan      : Rp ${(payBreakdown.cash + payBreakdown.transfer).toLocaleString('id-ID')} (Target: Rp 2.995.000) -> ${payBreakdown.cash + payBreakdown.transfer === 2995000 ? '✅ PAS' : '❌ SALAH'}`)

    const veraTx = txs.find(t => t.transaction_number === 'POTX2608319SY5BB' || (t.notes && t.notes.includes('d8b5a0')))
    if (veraTx) {
        const veraSplits = parsePaymentSplits(veraTx)
        console.log(`   - Transaksi Verawati (${veraTx.transaction_number}):`)
        console.log(`     * Notes : "${veraTx.notes}"`)
        console.log(`     * Cash  : Rp ${veraSplits.cash.toLocaleString('id-ID')} (Target: Rp 299.000) -> ${veraSplits.cash === 299000 ? '✅ PAS' : '❌ SALAH'}`)
        console.log(`     * Trsf  : Rp ${veraSplits.transfer.toLocaleString('id-ID')} (Target: Rp 599.000) -> ${veraSplits.transfer === 599000 ? '✅ PAS' : '❌ SALAH'}`)
    }

    // 3. Verifikasi Tindakan EMR & Komisi Terapis
    console.log(`\n👩‍⚕️ 3. VERIFIKASI LAPORAN TERAPIS (/reports/therapists):`)
    const { data: therapists } = await supabase.from('users').select('id, full_name, role')
    const therapistMap = new Map((therapists || []).map(t => [t.id, t.full_name]))

    const { data: treatmentItems, error: trErr } = await supabase
        .from('treatment_record_items')
        .select(`
            id, price_at_time, original_price, discount_percent, commission_percent, notes,
            treatments ( id, name, price ),
            treatment_records!inner (
                id, treatment_date, patient_id, branch_id, performed_by,
                patients ( id, full_name )
            )
        `)
        .eq('treatment_records.branch_id', CIAMIS_BRANCH_ID)
        .gte('treatment_records.treatment_date', TARGET_DATE)
        .lte('treatment_records.treatment_date', TARGET_DATE)

    if (trErr) throw trErr

    const therapistStats = {}
    const unassignedItems = []

    treatmentItems.forEach(item => {
        const performedBy = item.treatment_records?.performed_by
        const therapistName = performedBy ? (therapistMap.get(performedBy) || performedBy) : 'Tanpa Terapis (Worker)'
        const patientName = item.treatment_records?.patients?.full_name || 'Pasien'
        const patientId = item.treatment_records?.patient_id
        const price = Number(item.price_at_time || 0)
        const commPct = Number(item.commission_percent !== null && item.commission_percent !== undefined ? item.commission_percent : 5)
        const commAmt = Math.round(price * (commPct / 100))

        if (!performedBy || commPct === 0) {
            unassignedItems.push({
                item: item.notes || item.treatments?.name,
                patient: patientName,
                price
            })
            return
        }

        if (!therapistStats[therapistName]) {
            therapistStats[therapistName] = {
                sessions: 0,
                patients: new Set(),
                revenue: 0,
                commission: 0,
                items: []
            }
        }

        therapistStats[therapistName].sessions++
        therapistStats[therapistName].patients.add(patientId)
        therapistStats[therapistName].revenue += price
        therapistStats[therapistName].commission += commAmt
        therapistStats[therapistName].items.push({
            name: item.notes || item.treatments?.name,
            patient: patientName,
            price,
            commAmt
        })
    })

    console.log(`   Ditemukan ${Object.keys(therapistStats).length} terapis aktif dan ${unassignedItems.length} tindakan tanpa komisi terapis:`)
    let totalCommissionAll = 0

    for (const [name, stats] of Object.entries(therapistStats)) {
        totalCommissionAll += stats.commission
        console.log(`\n   👤 Terapis: ${name}`)
        console.log(`      - Jumlah Sesi   : ${stats.sessions} Sesi`)
        console.log(`      - Pasien Unik   : ${stats.patients.size} Pasien`)
        console.log(`      - Pendapatan    : Rp ${stats.revenue.toLocaleString('id-ID')}`)
        console.log(`      - Total Komisi  : Rp ${stats.commission.toLocaleString('id-ID')}`)
        console.log(`      - Rincian Sesi:`)
        stats.items.forEach((it, idx) => {
            console.log(`        ${idx + 1}. ${it.name} (${it.patient}) - Rp ${it.price.toLocaleString('id-ID')} | Komisi: Rp ${it.commAmt.toLocaleString('id-ID')}`)
        })
    }

    if (unassignedItems.length > 0) {
        console.log(`\n   💉 Tindakan Tanpa Komisi Terapis (Worker / Infus):`)
        unassignedItems.forEach((it, idx) => {
            console.log(`      ${idx + 1}. ${it.item} (${it.patient}) - Rp ${it.price.toLocaleString('id-ID')}`)
        })
    }

    console.log(`\n   💰 TOTAL KOMISI KESELURUHAN: Rp ${totalCommissionAll.toLocaleString('id-ID')} (Target: Rp 86.000) -> ${totalCommissionAll === 86000 ? '✅ PAS' : '❌ SALAH'}`)

    // 4. Periksa Kriteria Akhir
    const raika = therapistStats['Raika']
    const asti = therapistStats['Asti']

    const raikaOk = raika && raika.sessions === 5 && raika.patients.size === 3 && raika.revenue === 822000 && raika.commission === 41100
    const astiOk = asti && asti.sessions === 3 && asti.patients.size === 2 && asti.revenue === 898000 && asti.commission === 44900
    const totalCommOk = totalCommissionAll === 86000
    const salesOk = totalSales === 2995000 && treatmentRevenue === 1969000 && productRevenue === 1026000 && txs.length === 12
    const splitOk = payBreakdown.cash === 2264000 && payBreakdown.transfer === 731000

    console.log('\n====================================================')
    if (raikaOk && astiOk && totalCommOk && salesOk && splitOk) {
        console.log('🏆 SEMUA KRITERIA SELESAI 100% SUKSES DAN SEMPURNA!')
    } else {
        console.error('❌ ADA KRITERIA YANG BELUM TEPAT!')
    }
    console.log('====================================================')
}

verify().catch(console.error)
