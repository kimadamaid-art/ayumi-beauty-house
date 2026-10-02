// Tandai antrean follow-up lama sebagai 'skipped' supaya CRM tidak menumpuk.
//
// CRM mulai dipakai tim pada Oktober 2026. Antrean 'pending' yang jadwalnya sebelum
// tanggal batas berasal dari data riwayat (generate massal 30 Sep) dan tidak pernah akan
// dikerjakan. Skrip ini HANYA mengubah status antrean tersebut menjadi 'skipped' beserta
// alasannya; antrean tidak dihapus, dan tabel lain tidak disentuh. Semua halaman aplikasi
// hanya menampilkan antrean 'pending'/'rescheduled', jadi antrean ini hilang dari tampilan.
//
// Pemakaian:
//   node scripts/skip-stale-followups.mjs                    # dry-run (default), tidak menulis
//   node scripts/skip-stale-followups.mjs --apply            # menulis, log ID ke backups/
//   node scripts/skip-stale-followups.mjs --rollback <log>   # kembalikan ke 'pending'
//   --before YYYY-MM-DD  tanggal batas (default 2026-10-01, eksklusif)

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

const SKIP_REASON = 'Antrean lama sebelum CRM mulai dipakai (Okt 2026)'

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

async function rollback(file) {
    const log = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ids = log.skipped.map(r => r.id)
    let restored = 0
    for (let i = 0; i < ids.length; i += 200) {
        // Hanya baris yang masih berstatus skipped dengan alasan dari skrip ini.
        const { data, error } = await sb.from('followup_queue')
            .update({ status: 'pending', skip_reason: null })
            .in('id', ids.slice(i, i + 200))
            .eq('status', 'skipped')
            .eq('skip_reason', SKIP_REASON)
            .select('id')
        if (error) throw error
        restored += data.length
    }
    console.log(`Dikembalikan ke pending: ${restored} dari ${ids.length} baris di log.`)
}

async function main() {
    const args = process.argv.slice(2)
    if (args[0] === '--rollback') return rollback(args[1])
    const apply = args.includes('--apply')
    const bi = args.indexOf('--before')
    const before = bi >= 0 ? args[bi + 1] : '2026-10-01'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('Format --before harus YYYY-MM-DD')

    console.log(`Mode: ${apply ? 'APPLY (menulis ke database)' : 'DRY-RUN (tidak menulis)'}`)
    console.log(`Kriteria: status = 'pending' dan scheduled_date < ${before}`)

    const rows = await fetchAll(() => sb.from('followup_queue')
        .select('id, scheduled_date, branch_id, followup_type')
        .eq('status', 'pending')
        .lt('scheduled_date', before)
        .order('id'))

    const branchNames = Object.fromEntries(((await sb.from('branches').select('id, name')).data || []).map(b => [b.id, b.name]))
    const g = fn => rows.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m }, {})
    console.log(`Baris yang akan ditandai skipped: ${rows.length}`)
    console.log('Per cabang:', g(r => branchNames[r.branch_id] || r.branch_id))
    console.log('Per bulan jadwal:', g(r => r.scheduled_date.slice(0, 7)))
    console.log('Per tipe:', g(r => r.followup_type))

    if (!apply) { console.log('\nDRY-RUN selesai. Tidak ada yang ditulis.'); return }

    const skipped = []
    const ids = rows.map(r => r.id)
    for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await sb.from('followup_queue')
            .update({ status: 'skipped', skip_reason: SKIP_REASON })
            .in('id', ids.slice(i, i + 200))
            .eq('status', 'pending')
            .select('id, scheduled_date')
        if (error) { console.error('Gagal pada batch', i / 200, error); break }
        skipped.push(...data)
    }
    const logFile = path.join(root, 'backups', `followup_skip_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(logFile, JSON.stringify({ ranAt: new Date().toISOString(), before, reason: SKIP_REASON, skipped }, null, 2))
    console.log(`\nDitandai skipped: ${skipped.length} dari ${rows.length}. Log: ${path.relative(root, logFile)}`)
    console.log(`Batalkan dengan: node scripts/skip-stale-followups.mjs --rollback ${path.relative(root, logFile)}`)
}

main().catch(err => { console.error(err); process.exit(1) })
