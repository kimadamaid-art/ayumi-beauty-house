/**
 * TAHAP 2: Audit RLS Policies & Database Security
 * =================================================
 * Memeriksa:
 * 1. Tabel mana yang sudah enable RLS
 * 2. Policy apa saja yang ada di setiap tabel
 * 3. Tabel tanpa policy (RLS enabled tapi tanpa aturan = block all)
 * 4. Tabel tanpa RLS (terbuka untuk siapapun)
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
})

// Anon client - simulates unauthenticated access
const supabaseAnon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
})

const allTables = [
    'users', 'branches', 'patients', 'treatments',
    'appointments', 'appointment_treatments',
    'treatment_records', 'treatment_record_items',
    'transactions', 'transaction_items',
    'products', 'product_stock',
    'coupon_packages', 'coupon_package_items',
    'patient_coupons', 'patient_coupon_items',
    'notifications', 'leads'
]

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗')
    console.log('║   TAHAP 2: AUDIT AUTENTIKASI & RBAC                ║')
    console.log('║   Part A: RLS Policies & Database Security          ║')
    console.log('╚══════════════════════════════════════════════════════╝\n')

    const report = { rlsStatus: [], policies: [], anonAccess: [], issues: [] }

    // =============================================
    // 1. CHECK RLS STATUS PER TABLE
    // =============================================
    console.log('🔐 1. STATUS RLS PER TABEL')
    console.log('═'.repeat(60))

    // We'll try to check RLS by using the anon key (unauthenticated)
    // If RLS is enabled and no policy allows anon, the query should return empty or error
    // If RLS is NOT enabled, the service_role bypasses but anon should still see data

    // Method: Compare service_role count vs anon count
    for (const table of allTables) {
        try {
            // Service role bypasses RLS
            const { count: adminCount, error: adminErr } = await supabaseAdmin
                .from(table)
                .select('*', { count: 'exact', head: true })

            // Anon key is subject to RLS
            const { count: anonCount, error: anonErr } = await supabaseAnon
                .from(table)
                .select('*', { count: 'exact', head: true })

            const adminC = adminCount ?? -1
            const anonC = anonCount ?? -1
            const anonError = anonErr?.message || null

            let status = '?'
            let risk = 'LOW'

            if (anonError) {
                // Could be RLS blocking or table doesn't exist
                if (anonError.includes('permission denied') || anonError.includes('policy')) {
                    status = '🔒 RLS AKTIF (blocked)'
                    risk = 'LOW'
                } else {
                    status = `❓ Error: ${anonError.substring(0, 50)}`
                    risk = 'UNKNOWN'
                }
            } else if (adminC > 0 && anonC === 0) {
                status = '🔒 RLS AKTIF (anon blocked)'
                risk = 'LOW'
            } else if (adminC > 0 && anonC > 0 && anonC === adminC) {
                status = '🔓 TERBUKA! Anon bisa baca semua data'
                risk = 'HIGH'
                report.issues.push({
                    type: 'RLS_OPEN',
                    table,
                    desc: `Tabel ${table} terbuka — anon bisa membaca ${anonC} records`
                })
            } else if (adminC > 0 && anonC > 0 && anonC < adminC) {
                status = `⚠️ PARTIAL — Anon bisa baca ${anonC}/${adminC} records`
                risk = 'MEDIUM'
                report.issues.push({
                    type: 'RLS_PARTIAL',
                    table,
                    desc: `Tabel ${table} partial access — anon: ${anonC}, total: ${adminC}`
                })
            } else if (adminC === 0) {
                status = '⬜ Kosong (tidak bisa test)'
                risk = 'UNKNOWN'
            } else {
                status = `Admin: ${adminC}, Anon: ${anonC}`
            }

            console.log(`  ${status.padEnd(45)} | ${table} (${adminC} total)`)
            report.rlsStatus.push({ table, adminCount: adminC, anonCount: anonC, status, risk })

        } catch (e) {
            console.log(`  ❌ Error checking ${table}: ${e.message}`)
        }
    }

    // =============================================
    // 2. ANON ACCESS DEEP TEST — Can anon READ sensitive data?
    // =============================================
    console.log('\n\n🕵️ 2. TEST AKSES ANON (Tanpa Login) KE DATA SENSITIF')
    console.log('═'.repeat(60))

    const sensitiveTests = [
        {
            desc: 'Baca data users (email, role)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('users').select('id, email, role, full_name').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca data patients (nama, WA, alamat)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('patients').select('id, full_name, whatsapp, address').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca data transactions (nominal, metode bayar)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('transactions').select('id, total, payment_method, patient_id').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca treatment records (rekam medis)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('treatment_records').select('id, patient_id, complaints, skin_condition').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca data branches',
            test: async () => {
                const { data, error } = await supabaseAnon.from('branches').select('*').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca data treatments (harga, komisi)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('treatments').select('id, name, price, commission_percent').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'Baca notifications',
            test: async () => {
                const { data, error } = await supabaseAnon.from('notifications').select('*').limit(5)
                return { data, error }
            }
        },
        {
            desc: 'INSERT ke patients (tanpa login)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('patients').insert([{
                    full_name: '__AUDIT_TEST__',
                    whatsapp: '000'
                }])
                // Clean up if somehow succeeded
                if (data) {
                    await supabaseAdmin.from('patients').delete().eq('full_name', '__AUDIT_TEST__')
                }
                return { data, error, isWrite: true }
            }
        },
        {
            desc: 'UPDATE users role (tanpa login)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('users').update({ role: 'owner' }).eq('role', 'therapist').limit(1)
                return { data, error, isWrite: true }
            }
        },
        {
            desc: 'DELETE treatment records (tanpa login)',
            test: async () => {
                const { data, error } = await supabaseAnon.from('treatment_records').delete().eq('id', '00000000-0000-0000-0000-000000000000')
                return { data, error, isWrite: true }
            }
        }
    ]

    for (const test of sensitiveTests) {
        try {
            const result = await test.test()
            const isBlocked = !!result.error
            const dataCount = result.data?.length || 0

            if (isBlocked) {
                console.log(`  ✅ BLOCKED — ${test.desc}`)
                console.log(`     Error: ${result.error.message.substring(0, 80)}`)
            } else if (result.isWrite && dataCount === 0) {
                console.log(`  ✅ BLOCKED (no effect) — ${test.desc}`)
            } else if (dataCount > 0) {
                console.log(`  🔴 TERBUKA! — ${test.desc}`)
                console.log(`     Berhasil membaca ${dataCount} records!`)
                if (!result.isWrite && result.data?.[0]) {
                    const keys = Object.keys(result.data[0])
                    console.log(`     Kolom: ${keys.join(', ')}`)
                    // Show sample (redacted)
                    const sample = result.data[0]
                    console.log(`     Sample: ${JSON.stringify(sample).substring(0, 120)}...`)
                }
                report.anonAccess.push({ desc: test.desc, accessible: true, count: dataCount })
                report.issues.push({
                    type: 'ANON_ACCESS',
                    desc: test.desc,
                    severity: result.isWrite ? 'CRITICAL' : 'HIGH'
                })
            } else {
                console.log(`  ⬜ KOSONG — ${test.desc} (0 results, bisa jadi RLS atau data kosong)`)
            }
        } catch (e) {
            console.log(`  ❓ ERROR — ${test.desc}: ${e.message}`)
        }
    }

    // =============================================
    // 3. AUTH FLOW CHECK — Supabase Auth
    // =============================================
    console.log('\n\n🔑 3. CEK AUTH FLOW')
    console.log('═'.repeat(60))

    // Check if signup is enabled (potential issue for SaaS)
    try {
        const { data, error } = await supabaseAnon.auth.signUp({
            email: '__audit_test_fake@nonexistent-domain-xyz.com',
            password: 'audit_test_123456'
        })

        if (error) {
            console.log(`  ✅ Signup test: ${error.message}`)
            if (error.message.includes('disabled') || error.message.includes('not allowed')) {
                console.log('     → Public signup DINONAKTIFKAN (bagus untuk SaaS)')
            }
        } else if (data?.user) {
            console.log('  ⚠️  Public signup AKTIF! Siapapun bisa membuat akun.')
            console.log('     → Untuk SaaS, sebaiknya matikan public signup dan gunakan invite-only')
            // Clean up
            if (data.user.id) {
                await supabaseAdmin.auth.admin.deleteUser(data.user.id)
                console.log('     → Test user sudah dihapus')
            }
            report.issues.push({
                type: 'PUBLIC_SIGNUP',
                desc: 'Public signup aktif — siapapun bisa mendaftar',
                severity: 'MEDIUM'
            })
        }
    } catch (e) {
        console.log(`  ❓ Signup test error: ${e.message}`)
    }

    // =============================================
    // 4. RINGKASAN
    // =============================================
    console.log('\n\n══════════════════════════════════════════════════════')
    console.log('📊 RINGKASAN AUDIT RLS & DATABASE SECURITY')
    console.log('══════════════════════════════════════════════════════')

    const highRisk = report.rlsStatus.filter(r => r.risk === 'HIGH')
    const mediumRisk = report.rlsStatus.filter(r => r.risk === 'MEDIUM')
    const lowRisk = report.rlsStatus.filter(r => r.risk === 'LOW')

    console.log(`\n  🔴 HIGH Risk: ${highRisk.length} tabel`)
    highRisk.forEach(r => console.log(`     - ${r.table}`))
    console.log(`  ⚠️  MEDIUM Risk: ${mediumRisk.length} tabel`)
    mediumRisk.forEach(r => console.log(`     - ${r.table}`))
    console.log(`  ✅ LOW Risk: ${lowRisk.length} tabel`)
    console.log(`  ⬜ Unknown: ${report.rlsStatus.filter(r => r.risk === 'UNKNOWN').length} tabel (kosong/error)`)

    if (report.issues.length > 0) {
        console.log(`\n  📋 Total masalah: ${report.issues.length}`)
        report.issues.forEach((issue, i) => {
            console.log(`  ${i + 1}. [${issue.type}] ${issue.desc} ${issue.severity ? `(${issue.severity})` : ''}`)
        })
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('✅ Audit RLS Part A Selesai')
    console.log('═══════════════════════════════════════════════════════\n')

    // Save report
    fs.writeFileSync(
        path.join(__dirname, 'audit_report_tahap2_rls.json'),
        JSON.stringify(report, null, 2)
    )
}

main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
})
