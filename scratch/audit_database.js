/**
 * TAHAP 1: Audit Database & Integritas Data
 * ===========================================
 * Script untuk menginventarisasi semua tabel, foreign keys, constraints,
 * kolom types, dan mendeteksi orphan records.
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load env
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

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
})

async function runSQL(sql) {
    const { data, error } = await supabase.rpc('exec_sql', { sql })
    if (error) {
        // If exec_sql doesn't exist, try direct REST API
        console.error('exec_sql RPC failed:', error.message)
        return null
    }
    return data
}

// Fallback: query via REST if RPC not available
async function queryViaRest(tableName, selectCols = '*', filters = {}) {
    let query = supabase.from(tableName).select(selectCols)
    for (const [key, val] of Object.entries(filters)) {
        query = query.eq(key, val)
    }
    const { data, error } = await query
    if (error) {
        console.error(`Query ${tableName} failed:`, error.message)
        return null
    }
    return data
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗')
    console.log('║   TAHAP 1: AUDIT DATABASE & INTEGRITAS DATA        ║')
    console.log('║   Project: Ayumi Beauty House                       ║')
    console.log('╚══════════════════════════════════════════════════════╝')
    console.log('')

    const report = {
        tables: [],
        foreignKeys: [],
        constraints: [],
        rlsPolicies: [],
        orphanChecks: [],
        issues: []
    }

    // =============================================
    // 1. INVENTARIS TABEL
    // =============================================
    console.log('\n📋 1. INVENTARIS SEMUA TABEL PUBLIC')
    console.log('═'.repeat(50))

    // Use information_schema via Supabase REST - we'll query each known table
    const knownTables = [
        'users', 'branches', 'patients', 'treatments',
        'appointments', 'appointment_treatments',
        'treatment_records', 'treatment_record_items',
        'transactions', 'transaction_items',
        'products', 'product_stock',
        'coupon_packages', 'coupon_package_items',
        'patient_coupons', 'patient_coupon_items',
        'notifications',
        'leads', 'lead_interactions'
    ]

    console.log('\nMencoba mengakses tabel-tabel yang diketahui...')
    const existingTables = []
    const missingTables = []

    for (const tableName of knownTables) {
        try {
            const { data, error, count } = await supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })

            if (error) {
                if (error.message.includes('relation') && error.message.includes('does not exist')) {
                    missingTables.push(tableName)
                    console.log(`  ❌ ${tableName} — TIDAK ADA`)
                } else if (error.code === '42501') {
                    // RLS blocking - table exists but we can't access
                    existingTables.push({ name: tableName, count: '?? (RLS)', note: 'RLS blocking count' })
                    console.log(`  🔒 ${tableName} — Ada tapi terblokir RLS`)
                } else {
                    existingTables.push({ name: tableName, count: '??', note: error.message })
                    console.log(`  ⚠️  ${tableName} — Error: ${error.message}`)
                }
            } else {
                existingTables.push({ name: tableName, count: count ?? '?' })
                console.log(`  ✅ ${tableName} — ${count ?? '?'} records`)
            }
        } catch (e) {
            console.log(`  ❌ ${tableName} — Exception: ${e.message}`)
            missingTables.push(tableName)
        }
    }

    report.tables = existingTables

    if (missingTables.length > 0) {
        console.log(`\n  ⚠️  TABEL TIDAK DITEMUKAN (${missingTables.length}):`)
        missingTables.forEach(t => console.log(`     - ${t}`))
        report.issues.push({ type: 'MISSING_TABLE', tables: missingTables })
    }

    // =============================================
    // 2. SAMPLE DATA STRUCTURE (Check column structure per table)
    // =============================================
    console.log('\n\n📐 2. STRUKTUR KOLOM TABEL')
    console.log('═'.repeat(50))

    for (const table of existingTables) {
        try {
            const { data, error } = await supabase
                .from(table.name)
                .select('*')
                .limit(1)

            if (data && data.length > 0) {
                const columns = Object.keys(data[0])
                console.log(`\n  📄 ${table.name} (${columns.length} kolom):`)
                console.log(`     ${columns.join(', ')}`)
                table.columns = columns
            } else if (data && data.length === 0) {
                console.log(`\n  📄 ${table.name}: (KOSONG - tidak bisa inspeksi kolom dari data)`)
                table.columns = []
            } else {
                console.log(`\n  📄 ${table.name}: Error membaca data - ${error?.message || 'unknown'}`)
            }
        } catch (e) {
            console.log(`\n  📄 ${table.name}: Exception - ${e.message}`)
        }
    }

    // =============================================
    // 3. ORPHAN RECORDS CHECK
    // =============================================
    console.log('\n\n🔍 3. DETEKSI ORPHAN RECORDS')
    console.log('═'.repeat(50))

    const orphanChecks = [
        {
            desc: 'Users tanpa branch (non-owner)',
            check: async () => {
                const { data } = await supabase
                    .from('users')
                    .select('id, full_name, role, branch_id')
                    .is('branch_id', null)
                    .neq('role', 'owner')
                return data || []
            }
        },
        {
            desc: 'Treatment Records tanpa patient yang valid',
            check: async () => {
                const { data: records } = await supabase
                    .from('treatment_records')
                    .select('id, patient_id, patients(id)')
                    .limit(500)
                if (!records) return []
                return records.filter(r => !r.patients)
            }
        },
        {
            desc: 'Treatment Records tanpa therapist yang valid',
            check: async () => {
                const { data: records } = await supabase
                    .from('treatment_records')
                    .select('id, therapist_id')
                    .limit(500)
                if (!records) return []
                // Check which therapist_ids exist in users
                const therapistIds = [...new Set(records.map(r => r.therapist_id).filter(Boolean))]
                if (therapistIds.length === 0) return []
                const { data: users } = await supabase
                    .from('users')
                    .select('id')
                    .in('id', therapistIds)
                const validIds = new Set((users || []).map(u => u.id))
                return records.filter(r => r.therapist_id && !validIds.has(r.therapist_id))
            }
        },
        {
            desc: 'Treatment Record Items tanpa Treatment Record',
            check: async () => {
                const { data } = await supabase
                    .from('treatment_record_items')
                    .select('id, record_id, treatment_records(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.treatment_records)
            }
        },
        {
            desc: 'Treatment Record Items tanpa Treatment master',
            check: async () => {
                const { data } = await supabase
                    .from('treatment_record_items')
                    .select('id, treatment_id, treatments(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.treatments)
            }
        },
        {
            desc: 'Transaction Items tanpa Transaction',
            check: async () => {
                const { data } = await supabase
                    .from('transaction_items')
                    .select('id, transaction_id, transactions(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.transactions)
            }
        },
        {
            desc: 'Appointments tanpa Patient valid',
            check: async () => {
                const { data } = await supabase
                    .from('appointments')
                    .select('id, patient_id, patients(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.patients)
            }
        },
        {
            desc: 'Patient Coupons tanpa Patient valid',
            check: async () => {
                const { data } = await supabase
                    .from('patient_coupons')
                    .select('id, patient_id, patients(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.patients)
            }
        },
        {
            desc: 'Coupon Package Items tanpa Package valid',
            check: async () => {
                const { data } = await supabase
                    .from('coupon_package_items')
                    .select('id, package_id, coupon_packages(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.coupon_packages)
            }
        },
        {
            desc: 'Treatment Records tanpa Branch valid',
            check: async () => {
                const { data } = await supabase
                    .from('treatment_records')
                    .select('id, branch_id, branches(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => r.branch_id && !r.branches)
            }
        },
        {
            desc: 'Transactions tanpa Branch valid',
            check: async () => {
                const { data } = await supabase
                    .from('transactions')
                    .select('id, branch_id, branches(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => r.branch_id && !r.branches)
            }
        },
        {
            desc: 'Product Stock tanpa Product valid',
            check: async () => {
                const { data } = await supabase
                    .from('product_stock')
                    .select('id, product_id, products(id)')
                    .limit(500)
                if (!data) return []
                return data.filter(r => !r.products)
            }
        },
    ]

    for (const oc of orphanChecks) {
        try {
            const orphans = await oc.check()
            const count = orphans.length
            if (count > 0) {
                console.log(`  ⚠️  ${oc.desc}: ${count} record yatim piatu ditemukan!`)
                if (count <= 5) {
                    orphans.forEach(o => console.log(`     ID: ${o.id}`))
                }
                report.orphanChecks.push({ desc: oc.desc, count, sample: orphans.slice(0, 3) })
                report.issues.push({ type: 'ORPHAN_RECORD', desc: oc.desc, count })
            } else {
                console.log(`  ✅ ${oc.desc}: Bersih`)
                report.orphanChecks.push({ desc: oc.desc, count: 0 })
            }
        } catch (e) {
            console.log(`  ❓ ${oc.desc}: Tidak bisa diperiksa - ${e.message}`)
            report.orphanChecks.push({ desc: oc.desc, count: -1, error: e.message })
        }
    }

    // =============================================
    // 4. DATA CONSISTENCY CHECKS
    // =============================================
    console.log('\n\n🔄 4. KONSISTENSI DATA')
    console.log('═'.repeat(50))

    // Check: Users with role values
    try {
        const { data: users } = await supabase
            .from('users')
            .select('id, full_name, role, branch_id, is_active')

        if (users) {
            const roleCounts = {}
            users.forEach(u => {
                roleCounts[u.role] = (roleCounts[u.role] || 0) + 1
            })
            console.log('\n  👥 Distribusi Role User:')
            Object.entries(roleCounts).forEach(([role, count]) => {
                console.log(`     ${role}: ${count} user`)
            })

            // Check for invalid roles
            const validRoles = ['owner', 'admin', 'therapist']
            const invalidRoleUsers = users.filter(u => !validRoles.includes(u.role))
            if (invalidRoleUsers.length > 0) {
                console.log(`  ⚠️  User dengan role tidak valid: ${invalidRoleUsers.length}`)
                invalidRoleUsers.forEach(u => console.log(`     ${u.full_name}: "${u.role}"`))
                report.issues.push({ type: 'INVALID_ROLE', users: invalidRoleUsers })
            }

            // Check: Non-owner tanpa branch
            const noBranchUsers = users.filter(u => u.role !== 'owner' && !u.branch_id)
            if (noBranchUsers.length > 0) {
                console.log(`  ⚠️  Non-owner tanpa branch_id: ${noBranchUsers.length}`)
                noBranchUsers.forEach(u => console.log(`     ${u.full_name} (${u.role})`))
                report.issues.push({ type: 'NO_BRANCH', users: noBranchUsers })
            } else {
                console.log('  ✅ Semua non-owner user sudah punya branch_id')
            }
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa users: ${e.message}`)
    }

    // Check: Branches
    try {
        const { data: branches } = await supabase
            .from('branches')
            .select('*')
            .order('name')

        if (branches) {
            console.log(`\n  🏢 Daftar Cabang (${branches.length}):`)
            branches.forEach(b => {
                console.log(`     ${b.is_active ? '✅' : '❌'} ${b.name} (ID: ${b.id})`)
            })
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa branches: ${e.message}`)
    }

    // Check: Treatments with commission
    try {
        const { data: treatments } = await supabase
            .from('treatments')
            .select('id, name, price, discount_percent, commission_percent, is_active')
            .order('name')

        if (treatments) {
            const withCommission = treatments.filter(t => t.commission_percent > 0)
            const withDiscount = treatments.filter(t => t.discount_percent > 0)
            const inactive = treatments.filter(t => !t.is_active)

            console.log(`\n  💆 Treatment Master Data (${treatments.length} total):`)
            console.log(`     Aktif: ${treatments.length - inactive.length}, Nonaktif: ${inactive.length}`)
            console.log(`     Dengan komisi: ${withCommission.length}, Dengan diskon: ${withDiscount.length}`)

            if (withCommission.length > 0) {
                console.log(`     Treatment yang sudah diset komisi:`)
                withCommission.forEach(t => {
                    console.log(`       - ${t.name}: ${t.commission_percent}% (harga: Rp ${(t.price || 0).toLocaleString()})`)
                })
            }
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa treatments: ${e.message}`)
    }

    // Check: Commission data in treatment_record_items
    try {
        const { data: items, count } = await supabase
            .from('treatment_record_items')
            .select('id, commission_percent', { count: 'exact' })

        if (items) {
            const withCommission = items.filter(i => i.commission_percent > 0)
            const withoutCommission = items.filter(i => !i.commission_percent || i.commission_percent === 0)

            console.log(`\n  📊 Treatment Record Items - Status Komisi:`)
            console.log(`     Total items: ${count || items.length}`)
            console.log(`     Dengan komisi: ${withCommission.length}`)
            console.log(`     Tanpa komisi (0 atau null): ${withoutCommission.length}`)

            if (withoutCommission.length > 0 && withCommission.length > 0) {
                report.issues.push({
                    type: 'MISSING_COMMISSION_DATA',
                    desc: `${withoutCommission.length} treatment record items belum punya data komisi`,
                    count: withoutCommission.length
                })
            }
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa treatment_record_items: ${e.message}`)
    }

    // Check: Patients duplicate
    try {
        const { data: patients } = await supabase
            .from('patients')
            .select('id, full_name, whatsapp')
            .order('full_name')

        if (patients) {
            console.log(`\n  👤 Pasien (${patients.length} total):`)

            // Check duplicates by name
            const nameMap = {}
            patients.forEach(p => {
                const key = p.full_name?.toLowerCase()?.trim()
                if (key) {
                    if (!nameMap[key]) nameMap[key] = []
                    nameMap[key].push(p)
                }
            })

            const duplicateNames = Object.entries(nameMap).filter(([_, arr]) => arr.length > 1)
            if (duplicateNames.length > 0) {
                console.log(`  ⚠️  Pasien dengan nama sama (potensi duplikat): ${duplicateNames.length}`)
                duplicateNames.forEach(([name, arr]) => {
                    console.log(`     "${name}": ${arr.length}x (WA: ${arr.map(a => a.whatsapp || '-').join(', ')})`)
                })
                report.issues.push({ type: 'DUPLICATE_PATIENTS', count: duplicateNames.length, names: duplicateNames.map(([n]) => n) })
            } else {
                console.log('  ✅ Tidak ada duplikasi nama pasien')
            }

            // Check patients without WA
            const noWA = patients.filter(p => !p.whatsapp)
            if (noWA.length > 0) {
                console.log(`  ℹ️  Pasien tanpa WhatsApp: ${noWA.length}/${patients.length}`)
            }
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa patients: ${e.message}`)
    }

    // Check: Product stock vs branches
    try {
        const { data: productStock } = await supabase
            .from('product_stock')
            .select('id, product_id, branch_id, stock, products(name), branches(name)')
            .order('product_id')

        if (productStock) {
            console.log(`\n  📦 Product Stock (${productStock.length} records):`)

            // Check for negative stock
            const negativeStock = productStock.filter(ps => ps.stock < 0)
            if (negativeStock.length > 0) {
                console.log(`  ⚠️  Stok negatif ditemukan: ${negativeStock.length}`)
                negativeStock.forEach(ps => {
                    console.log(`     ${ps.products?.name || 'Unknown'} @ ${ps.branches?.name || 'Unknown'}: ${ps.stock}`)
                })
                report.issues.push({ type: 'NEGATIVE_STOCK', count: negativeStock.length })
            } else {
                console.log('  ✅ Tidak ada stok negatif')
            }
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa product_stock: ${e.message}`)
    }

    // Check: Coupon integrity
    try {
        const { data: patientCoupons } = await supabase
            .from('patient_coupons')
            .select(`
                id, patient_id, package_id, status, 
                patient_coupon_items(id, remaining_sessions, total_sessions)
            `)
            .limit(200)

        if (patientCoupons) {
            console.log(`\n  🎫 Patient Coupons (${patientCoupons.length}):`)

            // Check items with remaining > total
            let inconsistentItems = 0
            patientCoupons.forEach(pc => {
                (pc.patient_coupon_items || []).forEach(item => {
                    if (item.remaining_sessions > item.total_sessions) {
                        inconsistentItems++
                    }
                })
            })

            if (inconsistentItems > 0) {
                console.log(`  ⚠️  Coupon items dengan remaining > total: ${inconsistentItems}`)
                report.issues.push({ type: 'COUPON_INCONSISTENCY', count: inconsistentItems })
            } else {
                console.log('  ✅ Semua coupon items konsisten (remaining <= total)')
            }

            // Check fully_used status
            const fullyUsed = patientCoupons.filter(pc => pc.status === 'fully_used')
            const active = patientCoupons.filter(pc => pc.status === 'active')
            console.log(`     Active: ${active.length}, Fully Used: ${fullyUsed.length}`)
        }
    } catch (e) {
        console.log(`  ❓ Tidak bisa memeriksa patient_coupons: ${e.message}`)
    }

    // =============================================
    // 5. RINGKASAN MASALAH
    // =============================================
    console.log('\n\n══════════════════════════════════════════════════════')
    console.log('📊 RINGKASAN AUDIT TAHAP 1')
    console.log('══════════════════════════════════════════════════════')

    if (report.issues.length === 0) {
        console.log('\n  🎉 SEMUA BERSIH! Tidak ada masalah integritas data yang ditemukan.')
    } else {
        console.log(`\n  ⚠️  DITEMUKAN ${report.issues.length} MASALAH:`)
        report.issues.forEach((issue, idx) => {
            console.log(`\n  ${idx + 1}. [${issue.type}]`)
            if (issue.tables) console.log(`     Tabel hilang: ${issue.tables.join(', ')}`)
            if (issue.desc) console.log(`     ${issue.desc}`)
            if (issue.count) console.log(`     Jumlah: ${issue.count}`)
            if (issue.users) {
                issue.users.forEach(u => console.log(`     - ${u.full_name} (${u.role})`))
            }
            if (issue.names) {
                issue.names.slice(0, 5).forEach(n => console.log(`     - "${n}"`))
            }
        })
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('✅ Audit Tahap 1 Selesai')
    console.log('═══════════════════════════════════════════════════════\n')

    // Save report as JSON
    const reportPath = path.join(__dirname, 'audit_report_tahap1.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`📄 Report tersimpan di: ${reportPath}`)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
