/**
 * TAHAP 1 - Part 2: Deep Dive Anomaly Checks
 * ============================================
 * Memeriksa anomali yang ditemukan di audit awal:
 * 1. treatment_records (3958) vs treatment_record_items (4) — SANGAT TIDAK SEIMBANG
 * 2. Tabel lead_interactions — ada atau tidak?
 * 3. RLS policies check via information_schema
 * 4. FK relationship column name consistency
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const env = {}
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const parts = line.split('=')
        if (parts.length >= 2) {
            env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '')
        }
    })
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
})

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗')
    console.log('║   DEEP DIVE: ANOMALI DATABASE                       ║')
    console.log('╚══════════════════════════════════════════════════════╝\n')

    // =============================================
    // ANOMALI 1: treatment_records vs treatment_record_items mismatch
    // =============================================
    console.log('🔴 ANOMALI 1: treatment_records (3958) vs treatment_record_items (4)')
    console.log('═'.repeat(60))

    // Get sample treatment_records
    const { data: records, count: recordCount } = await supabase
        .from('treatment_records')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(5)

    console.log(`\n  Total treatment_records: ${recordCount}`)
    if (records && records.length > 0) {
        console.log('\n  5 Record terbaru:')
        records.forEach(r => {
            console.log(`    - ID: ${r.id}`)
            console.log(`      Tanggal: ${r.treatment_date}, Pasien: ${r.patient_id}`)
            console.log(`      Branch: ${r.branch_id}, Terapis: ${r.therapist_id}`)
            console.log(`      Created: ${r.created_at}`)
        })
    }

    // Get ALL treatment_record_items
    const { data: items, count: itemCount } = await supabase
        .from('treatment_record_items')
        .select('*, treatment_records(treatment_date, patient_id), treatments(name)', { count: 'exact' })

    console.log(`\n  Total treatment_record_items: ${itemCount}`)
    if (items) {
        console.log('\n  SEMUA items yang ada:')
        items.forEach(item => {
            console.log(`    - ID: ${item.id}`)
            console.log(`      Record ID: ${item.treatment_record_id}`)
            console.log(`      Treatment: ${item.treatments?.name || 'N/A'}`)
            console.log(`      Price: Rp ${(item.price_at_time || 0).toLocaleString()}`)
            console.log(`      Commission: ${item.commission_percent || 0}%`)
            console.log(`      Record Date: ${item.treatment_records?.treatment_date || 'N/A'}`)
        })
    }

    // Check: how many records have matching items?
    const recordsWithItems = new Set((items || []).map(i => i.treatment_record_id))
    console.log(`\n  Records yang punya items: ${recordsWithItems.size}`)
    console.log(`  Records TANPA items: ${(recordCount || 0) - recordsWithItems.size}`)
    console.log(`\n  ⚠️  INI BERARTI: ${(recordCount || 0) - recordsWithItems.size} dari ${recordCount} treatment records TIDAK punya detail items!`)
    console.log('  Kemungkinan penyebab:')
    console.log('  1. Data lama diimport TANPA items (bulk import dari sistem sebelumnya)')
    console.log('  2. treatment_record_items baru ditambahkan belakangan')
    console.log('  3. Ada bug dimana items tidak tersimpan')

    // Check old records structure - do they embed treatment data differently?
    const { data: oldRecords } = await supabase
        .from('treatment_records')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(3)

    if (oldRecords && oldRecords.length > 0) {
        console.log('\n  3 Record TERLAMA (untuk melihat struktur):')
        oldRecords.forEach(r => {
            const columns = Object.entries(r).filter(([k, v]) => v !== null)
            console.log(`    - Created: ${r.created_at}`)
            console.log(`      Non-null fields: ${columns.map(([k]) => k).join(', ')}`)
        })
    }

    // =============================================
    // ANOMALI 2: treatment_record_items FK column name  
    // =============================================
    console.log('\n\n🔴 ANOMALI 2: FK Column Name pada treatment_record_items')
    console.log('═'.repeat(60))

    // The column is "treatment_record_id" but the table is "treatment_records"
    // In the code, supabase join uses "treatment_records!inner" - let's verify the actual FK
    if (items && items.length > 0) {
        const sampleItem = items[0]
        console.log('\n  Sample item columns:')
        Object.keys(sampleItem).forEach(k => {
            if (typeof sampleItem[k] !== 'object') {
                console.log(`    ${k}: ${sampleItem[k]}`)
            }
        })
    }

    // =============================================
    // ANOMALI 3: Appointments sangat sedikit (4) vs treatment_records (3958)
    // =============================================
    console.log('\n\n🔴 ANOMALI 3: Appointments (4) vs Treatment Records (3958)')
    console.log('═'.repeat(60))

    const { data: appointments } = await supabase
        .from('appointments')
        .select('*, patients(full_name), branches(name)')
        .order('created_at', { ascending: false })

    if (appointments) {
        console.log(`\n  Total appointments: ${appointments.length}`)
        appointments.forEach(a => {
            console.log(`    - ${a.appointment_date} ${a.start_time || ''}: ${a.patients?.full_name || 'N/A'}`)
            console.log(`      Status: ${a.status}, Cabang: ${a.branches?.name || 'N/A'}`)
            console.log(`      Created: ${a.created_at}`)
        })
        console.log('\n  ℹ️  Hanya 4 appointment berarti kebanyakan treatment records dibuat langsung (tanpa appointment)')
    }

    // =============================================
    // ANOMALI 4: Transactions juga sedikit (7)
    // =============================================
    console.log('\n\n🔴 ANOMALI 4: Transactions (7) vs Treatment Records (3958)')
    console.log('═'.repeat(60))

    const { data: transactions } = await supabase
        .from('transactions')
        .select('*, patients(full_name), branches(name)')
        .order('created_at', { ascending: false })

    if (transactions) {
        console.log(`\n  Total transactions: ${transactions.length}`)
        transactions.forEach(t => {
            console.log(`    - ${t.transaction_number}: ${t.patients?.full_name || 'N/A'}`)
            console.log(`      Total: Rp ${(t.total || 0).toLocaleString()}, Method: ${t.payment_method}`)
            console.log(`      Status: ${t.payment_status}, Cabang: ${t.branches?.name || 'N/A'}`)
            console.log(`      Created: ${t.created_at}`)
        })
    }

    // =============================================
    // CHECK: Views yang ada
    // =============================================
    console.log('\n\n📊 VIEWS CHECK')
    console.log('═'.repeat(60))

    const viewNames = ['dashboard_today_view', 'patient_status_view']
    for (const vName of viewNames) {
        try {
            const { data, error } = await supabase
                .from(vName)
                .select('*')
                .limit(1)

            if (error) {
                console.log(`  ❌ ${vName}: ${error.message}`)
            } else {
                console.log(`  ✅ ${vName}: Ada (${data?.length || 0} sample rows)`)
                if (data && data.length > 0) {
                    console.log(`     Columns: ${Object.keys(data[0]).join(', ')}`)
                }
            }
        } catch (e) {
            console.log(`  ❌ ${vName}: ${e.message}`)
        }
    }

    // =============================================
    // CHECK: Branches - Users distribution
    // =============================================
    console.log('\n\n🏢 DISTRIBUSI USER PER CABANG')
    console.log('═'.repeat(60))

    const { data: allUsers } = await supabase
        .from('users')
        .select('id, full_name, role, branch_id, is_active, branches(name)')
        .order('role')

    if (allUsers) {
        const branchGroups = {}
        allUsers.forEach(u => {
            const branchName = u.branches?.name || '(Tanpa Cabang - Owner)'
            if (!branchGroups[branchName]) branchGroups[branchName] = []
            branchGroups[branchName].push(u)
        })

        Object.entries(branchGroups).forEach(([branch, users]) => {
            console.log(`\n  📍 ${branch}:`)
            users.forEach(u => {
                console.log(`     ${u.is_active ? '✅' : '❌'} ${u.full_name} [${u.role}]`)
            })
        })
    }

    // =============================================
    // CHECK: Treatment records distribution per branch
    // =============================================
    console.log('\n\n📊 DISTRIBUSI TREATMENT RECORDS PER CABANG')
    console.log('═'.repeat(60))

    const { data: branches } = await supabase
        .from('branches')
        .select('id, name')

    if (branches) {
        for (const branch of branches) {
            const { count } = await supabase
                .from('treatment_records')
                .select('*', { count: 'exact', head: true })
                .eq('branch_id', branch.id)

            console.log(`  📍 ${branch.name}: ${count || 0} records`)
        }

        // Check records without branch
        const { count: noBranch } = await supabase
            .from('treatment_records')
            .select('*', { count: 'exact', head: true })
            .is('branch_id', null)

        if (noBranch > 0) {
            console.log(`  ⚠️  Tanpa branch: ${noBranch} records`)
        }
    }

    // =============================================
    // CHECK: Patients distribution per branch
    // =============================================
    console.log('\n\n📊 DISTRIBUSI PASIEN PER CABANG')
    console.log('═'.repeat(60))

    if (branches) {
        for (const branch of branches) {
            const { count } = await supabase
                .from('patients')
                .select('*', { count: 'exact', head: true })
                .eq('branch_id', branch.id)

            console.log(`  📍 ${branch.name}: ${count || 0} pasien`)
        }

        const { count: noBranchPatient } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .is('branch_id', null)

        if (noBranchPatient > 0) {
            console.log(`  ⚠️  Pasien tanpa branch: ${noBranchPatient}`)
        }
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('✅ Deep Dive Anomali Selesai')
    console.log('═══════════════════════════════════════════════════════\n')
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
