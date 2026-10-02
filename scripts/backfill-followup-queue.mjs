// Isi ulang antrean follow-up CRM untuk rekam medis yang terlewat.
//
// Sejak generate massal 30 Sep 2026, rekam medis baru tidak mendapat antrean karena
// aplikasi memakai followup_type yang ditolak database (diperbaiki di lib/followupQueue.js).
// Skrip ini HANYA MENAMBAH baris followup_queue; tidak ada data lain yang diubah/dihapus.
//
// Kriteria rekam medis:
//   - treatment_date dalam 30 hari terakhir (WIB) dan belum punya antrean sama sekali
//   - punya pasien dan cabang
//   - bukan rekam dummy kasir/worker (result_notes "Tindakan Kasir Langsung"/"Kasir"/"Worker"):
//     rekam dummy dihapus oleh auto-heal & hapus transaksi tanpa membersihkan antreannya
//   - punya minimal satu item non-worker
//   - tidak semata-mata terkait transaksi yang di-void
// Baris yang dibuat: 'treatment_reminder' pada +14/+21/+30 hari, hanya yang jadwalnya
// belum lewat (>= hari ini WIB), supaya CRM tidak dibanjiri tugas kedaluwarsa.
//
// Pemakaian:
//   node scripts/backfill-followup-queue.mjs                 # dry-run (default), tidak menulis
//   node scripts/backfill-followup-queue.mjs --apply         # menulis, log ID ke backups/
//   node scripts/backfill-followup-queue.mjs --rollback <log.json>
//        # menghapus baris dari log tersebut yang masih 'pending' (yang sudah dikerjakan dibiarkan)

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
    fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const STEPS = [14, 21, 30]
const WINDOW_DAYS = 30
const DUMMY_RE = /Tindakan Kasir Langsung|Kasir|Worker/

const addDays = (dateStr, days) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

async function fetchAll(build) {
    const out = []
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999)
        if (error) throw error
        out.push(...data)
        if (data.length < 1000) break
    }
    return out
}
async function inChunks(ids, fn) {
    const out = []
    for (let i = 0; i < ids.length; i += 200) out.push(...await fn(ids.slice(i, i + 200)))
    return out
}

async function rollback(file) {
    const log = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ids = log.inserted.map(r => r.id)
    const rows = await inChunks(ids, async chunk => {
        const { data, error } = await sb.from('followup_queue').select('id, status').in('id', chunk)
        if (error) throw error
        return data
    })
    const pendingIds = rows.filter(r => r.status === 'pending').map(r => r.id)
    console.log(`Log berisi ${ids.length} baris; masih pending ${pendingIds.length}; sudah dikerjakan/hilang ${ids.length - pendingIds.length} (dibiarkan).`)
    for (let i = 0; i < pendingIds.length; i += 200) {
        const { error } = await sb.from('followup_queue').delete().in('id', pendingIds.slice(i, i + 200)).eq('status', 'pending')
        if (error) throw error
    }
    console.log(`Dihapus ${pendingIds.length} baris.`)
}

async function main() {
    const args = process.argv.slice(2)
    if (args[0] === '--rollback') return rollback(args[1])
    const apply = args.includes('--apply')

    const since = addDays(todayWib, -WINDOW_DAYS)
    console.log(`Mode: ${apply ? 'APPLY (menulis ke database)' : 'DRY-RUN (tidak menulis)'}`)
    console.log(`Hari ini (WIB): ${todayWib}; rekam medis dengan treatment_date ${since} s/d ${todayWib}`)

    const records = await fetchAll(() => sb.from('treatment_records')
        .select('id, patient_id, branch_id, performed_by, treatment_date, result_notes, appointment_id')
        .gte('treatment_date', since).lte('treatment_date', todayWib).order('treatment_date'))
    const ids = records.map(r => r.id)

    const queued = new Set((await inChunks(ids, async c => {
        const { data, error } = await sb.from('followup_queue').select('treatment_record_id').in('treatment_record_id', c)
        if (error) throw error
        return data
    })).map(r => r.treatment_record_id))

    const itemsByRec = {}
    ;(await inChunks(ids, async c => {
        const { data, error } = await sb.from('treatment_record_items').select('treatment_record_id, notes').in('treatment_record_id', c)
        if (error) throw error
        return data
    })).forEach(i => { (itemsByRec[i.treatment_record_id] ||= []).push(i) })

    const txByRec = {}
    ;(await inChunks(ids, async c => {
        const { data, error } = await sb.from('transactions').select('treatment_record_id, payment_status').in('treatment_record_id', c)
        if (error) throw error
        return data
    })).forEach(t => { (txByRec[t.treatment_record_id] ||= []).push(t.payment_status) })

    const skipped = {}
    const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1 }
    const rows = []
    const branchNames = Object.fromEntries(((await sb.from('branches').select('id, name')).data || []).map(b => [b.id, b.name]))
    const perBranch = {}

    for (const r of records) {
        if (queued.has(r.id)) { skip('sudah punya antrean'); continue }
        if (!r.patient_id || !r.branch_id) { skip('tanpa pasien/cabang'); continue }
        if (DUMMY_RE.test(r.result_notes || '')) { skip('rekam dummy kasir/worker'); continue }
        const items = itemsByRec[r.id] || []
        if (!items.some(i => !(i.notes || '').includes('[WORKER]'))) { skip('tanpa item terapis'); continue }
        const tx = txByRec[r.id] || []
        if (tx.length > 0 && tx.every(s => s === 'void')) { skip('transaksi di-void'); continue }

        const steps = STEPS.map(d => addDays(r.treatment_date, d)).filter(s => s >= todayWib)
        if (steps.length === 0) { skip('semua jadwal sudah lewat'); continue }
        for (const scheduled of steps) {
            rows.push({
                patient_id: r.patient_id,
                treatment_record_id: r.id,
                branch_id: r.branch_id,
                assigned_to: r.performed_by || null,
                followup_type: 'treatment_reminder',
                scheduled_date: scheduled,
                priority: 'normal',
                status: 'pending'
            })
        }
        const bn = branchNames[r.branch_id] || r.branch_id
        perBranch[bn] = perBranch[bn] || { rekam: 0, antrean: 0 }
        perBranch[bn].rekam++
        perBranch[bn].antrean += steps.length
    }

    console.log(`Rekam medis diperiksa: ${records.length}`)
    console.log('Dilewati:', skipped)
    console.log('Akan dibuat per cabang:', perBranch)
    console.log(`Total baris antrean: ${rows.length} untuk ${new Set(rows.map(r => r.treatment_record_id)).size} rekam medis`)
    console.log('Contoh:', rows.slice(0, 3))

    if (!apply) { console.log('\nDRY-RUN selesai. Tidak ada yang ditulis.'); return }

    const inserted = []
    for (let i = 0; i < rows.length; i += 100) {
        const { data, error } = await sb.from('followup_queue').insert(rows.slice(i, i + 100)).select('id, treatment_record_id, scheduled_date')
        if (error) {
            console.error('Gagal pada batch', i / 100, error)
            break
        }
        inserted.push(...data)
    }
    const logFile = path.join(root, 'backups', `followup_backfill_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(logFile, JSON.stringify({ ranAt: new Date().toISOString(), todayWib, inserted }, null, 2))
    console.log(`\nDitulis ${inserted.length} dari ${rows.length} baris. Log: ${path.relative(root, logFile)}`)
    console.log(`Batalkan dengan: node scripts/backfill-followup-queue.mjs --rollback ${path.relative(root, logFile)}`)
}

main().catch(err => { console.error(err); process.exit(1) })
