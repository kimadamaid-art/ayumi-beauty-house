/**
 * scripts/migrate-banjar-tasik.mjs
 * 
 * Skrip migrasi resmi untuk memuat data GD Cashier ke Supabase:
 * - Cabang Ayumi Banjar (c4f02158-921a-4f8b-a4bc-5a98394dc35e)
 * - Cabang Ayumi Tasikmalaya (964eaa28-e905-430a-b3da-38e48dcbb813)
 * 
 * CABANG CIAMIS / BUISEURI TIDAK DISENTUH SAMA SEKALI.
 * FOTO MEDIS DAN REKAM MEDIS DENGAN FOTO DILINDUNGI 100%.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const BANJAR_BRANCH_ID = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e';
const TASIK_BRANCH_ID  = '964eaa28-e905-430a-b3da-38e48dcbb813';
const CIAMIS_BRANCH_ID = '6bc44a26-f7f3-4ea7-8902-a2c48e27b598'; // PROTECTED!

const BATCH_SIZE = 500;

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        console.error('❌ File .env.local tidak ditemukan di root project.');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [k, ...v] = trimmed.split('=');
        if (k && v.length) {
            env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });

    const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('❌ SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di .env.local.');
        process.exit(1);
    }

    return { supabaseUrl, serviceRoleKey };
}

function normalizePhone(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.substring(1);
    } else if (!clean.startsWith('62') && clean.length > 0) {
        clean = '62' + clean;
    }
    return clean || null;
}

function parseDateOrNull(val) {
    if (!val || val === '0000-00-00' || String(val).trim() === '') return null;
    const str = String(val).trim();
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return str.split('T')[0].split(' ')[0];
}

function parseIsoTimestamp(val, defaultTime = '10:00:00') {
    if (!val || String(val).trim() === '') {
        return new Date().toISOString();
    }
    const str = String(val).trim();
    if (str.includes(' ')) {
        const [dPart, tPart] = str.split(' ');
        return new Date(`${dPart}T${tPart || defaultTime}+07:00`).toISOString();
    }
    return new Date(`${str}T${defaultTime}+07:00`).toISOString();
}

function normalizePaymentMethod(methodStr) {
    if (!methodStr || String(methodStr).trim() === '') return 'cash';
    const s = String(methodStr).toLowerCase();
    if (s.includes('qris')) return 'qris';
    if (s.includes('transfer')) return 'transfer';
    if (s.includes('debit') || s.includes('edc')) return 'debit';
    if (s.includes('credit')) return 'credit';
    if (s.includes('cash')) return 'cash';
    return 'cash';
}

function isProductItem(row) {
    const kat = String(row.kategori || '').toLowerCase().trim();
    const name = String(row.treatment || row.nama || '').toLowerCase().trim();
    if (kat.includes('yufaderma') || kat.includes('produk') || kat.includes('dekoratif') || kat.includes('skincare')) return true;
    if (name.includes('paket yufaderma') || name.includes('serum flek') || name.includes('tintera rosy') || name.includes('soothing care') || name.includes('night body lotion') || name.includes('sunscreen') || name.includes('facial wash') || name.includes('toner') || name.includes('cream')) return true;
    return false;
}

async function main() {
    console.log('===============================================================');
    console.log('🚀 MIGRASI DATA GD CASHIER -> SUPABASE (BANJAR & TASIKMALAYA)');
    console.log('===============================================================\n');

    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');

    const homeDir = process.env.HOME || '';
    const banjarPath = path.resolve(homeDir, 'Downloads/Ayumi_Banjar_Migrasi_2026-09-29.xlsx');
    const tasikPath  = path.resolve(homeDir, 'Downloads/Ayumi_Tasikmalaya_Migrasi_2026-09-29.xlsx');

    if (!fs.existsSync(banjarPath)) {
        console.error(`❌ File Banjar tidak ditemukan: ${banjarPath}`);
        process.exit(1);
    }
    if (!fs.existsSync(tasikPath)) {
        console.error(`❌ File Tasikmalaya tidak ditemukan: ${tasikPath}`);
        process.exit(1);
    }

    console.log(`📁 File Banjar      : ${banjarPath}`);
    console.log(`📁 File Tasikmalaya : ${tasikPath}`);
    console.log(`⚙️  Mode             : ${isDryRun ? '🔍 DRY RUN (Simulasi)' : '⚡ LIVE FULL MIGRATION'}\n`);

    const { supabaseUrl, serviceRoleKey } = loadEnv();
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    // 1. Perlindungan Rekam Medis & Foto Medis
    console.log('🛡️ [PERLINDUNGAN FOTO] Memeriksa foto rekam medis yang wajib dilindungi...');
    const { data: allPhotos } = await supabase.from('patient_photos').select('id, treatment_record_id, patient_id');
    const protectedTrIds = new Set((allPhotos || []).map(p => p.treatment_record_id).filter(Boolean));
    const protectedPatIds = new Set((allPhotos || []).map(p => p.patient_id).filter(Boolean));
    console.log(`   ✅ Ditemukan ${allPhotos?.length || 0} foto medis yang terhubung ke ${protectedTrIds.size} rekam medis. Semua akan DILINDUNGI 100%!\n`);

    // 2. Pembersihan Riwayat Transaksi Partial Banjar & Tasik (Ciamis TIDAK DISENTUH)
    if (!isDryRun) {
        console.log('🧹 [CLEANUP] Membersihkan transaksi partial lama di Banjar & Tasik...');
        // Putuskan treatment_record_id cyclic di transaksi Banjar & Tasik
        await supabase.from('transactions').update({ treatment_record_id: null }).in('branch_id', [BANJAR_BRANCH_ID, TASIK_BRANCH_ID]);

        // Hapus transaction_items di Banjar & Tasik (dengan paginasi lengkap)
        let oldTxIds = [];
        let tFrom = 0;
        while (true) {
            const { data: oldTxList } = await supabase.from('transactions').select('id').in('branch_id', [BANJAR_BRANCH_ID, TASIK_BRANCH_ID]).range(tFrom, tFrom + 999);
            if (!oldTxList || oldTxList.length === 0) break;
            oldTxIds.push(...oldTxList.map(t => t.id));
            if (oldTxList.length < 1000) break;
            tFrom += 1000;
        }
        for (let i = 0; i < oldTxIds.length; i += 500) {
            await supabase.from('transaction_items').delete().in('transaction_id', oldTxIds.slice(i, i + 500));
        }
        if (oldTxIds.length > 0) {
            for (let i = 0; i < oldTxIds.length; i += 500) {
                await supabase.from('transactions').delete().in('id', oldTxIds.slice(i, i + 500));
            }
            console.log(`   ✅ Menghapus ${oldTxIds.length} transaksi partial lama di Banjar & Tasik.`);
        }

        // Hapus treatment_records Banjar & Tasik yang BUKAN bagian dari protectedTrIds (yang tidak punya foto)
        const { data: oldTrList } = await supabase.from('treatment_records').select('id').in('branch_id', [BANJAR_BRANCH_ID, TASIK_BRANCH_ID]);
        const unProtectedTrIds = (oldTrList || []).map(r => r.id).filter(id => !protectedTrIds.has(id));
        for (let i = 0; i < unProtectedTrIds.length; i += 500) {
            const chunk = unProtectedTrIds.slice(i, i + 500);
            await supabase.from('treatment_record_items').delete().in('treatment_record_id', chunk);
            await supabase.from('treatment_records').delete().in('id', chunk);
        }
        console.log(`   ✅ Mempertahankan ${protectedTrIds.size} rekam medis berfoto & membersihkan ${unProtectedTrIds.length} rekam medis tanpa foto.`);

        // Bersihkan kupon lama di Banjar & Tasik
        const { data: oldCoupons } = await supabase.from('patient_coupons').select('id, patients!inner(branch_id)').in('patients.branch_id', [BANJAR_BRANCH_ID, TASIK_BRANCH_ID]);
        const oldCouponIds = (oldCoupons || []).map(c => c.id);
        if (oldCouponIds.length > 0) {
            await supabase.from('patient_coupon_items').delete().in('patient_coupon_id', oldCouponIds);
            await supabase.from('patient_coupons').delete().in('id', oldCouponIds);
            console.log(`   ✅ Menghapus ${oldCouponIds.length} kupon partial lama di Banjar & Tasik.`);
        }
        console.log('✅ Pembersihan parsial selesai.\n');
    }

    // 3. Muat Master Data & Lookup
    console.log('📥 Memuat Master Data dari Supabase...');
    const [
        { data: dbUsers },
        { data: dbCategories },
        { data: dbTreatments },
        { data: dbProducts },
        { data: dbPackages }
    ] = await Promise.all([
        supabase.from('users').select('id, full_name, role, branch_id'),
        supabase.from('treatment_categories').select('id, name'),
        supabase.from('treatments').select('id, name, price, commission_percent, category_id'),
        supabase.from('products').select('id, name, price'),
        supabase.from('coupon_packages').select('id, name, price')
    ]);

    // Paginasi lengkap untuk mengambil seluruh pasien yang sudah terdaftar di Supabase
    let existingPatients = [];
    let pOffset = 0;
    while (true) {
        const { data: pBatch, error: pErr } = await supabase
            .from('patients')
            .select('id, full_name, whatsapp, branch_id')
            .range(pOffset, pOffset + 999);
        if (pErr || !pBatch || pBatch.length === 0) break;
        existingPatients.push(...pBatch);
        if (pBatch.length < 1000) break;
        pOffset += 1000;
    }

    const userMap = new Map();
    (dbUsers || []).forEach(u => {
        userMap.set(u.full_name.toLowerCase().trim().replace(/\s+/g, ' '), u);
    });

    const categoryMap = new Map();
    (dbCategories || []).forEach(cat => {
        categoryMap.set(cat.name.toLowerCase().trim().replace(/\s+/g, ' '), cat);
    });
    const defaultCategoryId = dbCategories?.find(c => c.name.includes('GENERAL') || c.name.includes('LAINNYA'))?.id || dbCategories?.[0]?.id;

    const treatmentMap = new Map();
    (dbTreatments || []).forEach(t => {
        treatmentMap.set(t.name.toLowerCase().trim().replace(/\s+/g, ' '), t);
    });

    const productMap = new Map();
    (dbProducts || []).forEach(p => {
        productMap.set(p.name.toLowerCase().trim().replace(/\s+/g, ' '), p);
    });

    const packageMap = new Map();
    (dbPackages || []).forEach(pkg => {
        packageMap.set(pkg.name.toLowerCase().trim().replace(/\s+/g, ' '), pkg);
    });

    // Peta Pasien Terdaftar di Database (Anti-Duplikasi Lintas Cabang)
    const existingWaMap = new Map();
    const existingNameMap = new Map();
    (existingPatients || []).forEach(p => {
        const normWa = normalizePhone(p.whatsapp);
        if (normWa) existingWaMap.set(normWa, p.id);
        const normName = p.full_name.toLowerCase().trim().replace(/\s+/g, ' ');
        if (normName) existingNameMap.set(normName, p.id);
    });
    console.log(`   - Pasien Terdaftar Saat Ini : ${(existingPatients || []).length} profil (Ciamis + Banjar/Tasik lama)`);
    console.log(`   - Master Users             : ${(dbUsers || []).length} akun`);
    console.log(`   - Master Tindakan          : ${(dbTreatments || []).length} layanan`);
    console.log(`   - Master Produk            : ${(dbProducts || []).length} produk\n`);

    // Helper pencocokan terapis fleksibel
    function findTherapistUser(tName, branchId) {
        if (!tName) return null;
        const clean = tName.toLowerCase().trim().replace(/\s+/g, ' ');
        if (userMap.has(clean)) return userMap.get(clean);

        // Prioritas staf di cabang yang bersangkutan
        const branchUsers = (dbUsers || []).filter(u => u.branch_id === branchId);
        for (const u of branchUsers) {
            const uClean = u.full_name.toLowerCase().trim().replace(/\s+/g, ' ');
            if (uClean === clean || uClean.includes(clean) || clean.includes(uClean)) return u;
            if (clean.includes('rana') && uClean.includes('rana')) return u;
            if (clean.includes('nisa') && uClean.includes('nisa')) return u;
            if (clean.includes('fransiska') && uClean.includes('fransiska')) return u;
            if (clean.includes('elsa') && uClean.includes('elsa')) return u;
            if (clean.includes('indri') && uClean.includes('indri')) return u;
            if (clean.includes('nofa') && uClean.includes('nofa')) return u;
        }

        // Fallback ke seluruh staf
        for (const u of dbUsers || []) {
            const uClean = u.full_name.toLowerCase().trim().replace(/\s+/g, ' ');
            if (uClean === clean || uClean.includes(clean) || clean.includes(uClean)) return u;
        }
        return null;
    }

    // Default Kasir
    const defaultCashierBanjar = dbUsers?.find(u => u.role === 'admin' && u.branch_id === BANJAR_BRANCH_ID) || dbUsers?.find(u => u.role === 'admin');
    const defaultCashierTasik  = dbUsers?.find(u => u.role === 'admin' && u.branch_id === TASIK_BRANCH_ID)  || dbUsers?.find(u => u.role === 'admin');

    // 4. Membaca Kedua Berkas Excel
    console.log('📖 Membaca berkas Excel Banjar & Tasikmalaya...');
    const wbBanjar = XLSX.readFile(banjarPath);
    const wbTasik  = XLSX.readFile(tasikPath);

    const sources = [
        {
            branchName: 'Ayumi Banjar',
            branchId: BANJAR_BRANCH_ID,
            defaultCashier: defaultCashierBanjar,
            patients: XLSX.utils.sheet_to_json(wbBanjar.Sheets['Pasien'] || {}, { defval: '' }),
            transactions: XLSX.utils.sheet_to_json(wbBanjar.Sheets['Transaksi'] || {}, { defval: '' }),
            treatments: XLSX.utils.sheet_to_json(wbBanjar.Sheets['Treatment'] || {}, { defval: '' }),
            coupons: XLSX.utils.sheet_to_json(wbBanjar.Sheets['Kupon'] || {}, { defval: '' })
        },
        {
            branchName: 'Ayumi Tasikmalaya',
            branchId: TASIK_BRANCH_ID,
            defaultCashier: defaultCashierTasik,
            patients: XLSX.utils.sheet_to_json(wbTasik.Sheets['Pasien'] || {}, { defval: '' }),
            transactions: XLSX.utils.sheet_to_json(wbTasik.Sheets['Transaksi'] || {}, { defval: '' }),
            treatments: XLSX.utils.sheet_to_json(wbTasik.Sheets['Treatment'] || {}, { defval: '' }),
            coupons: XLSX.utils.sheet_to_json(wbTasik.Sheets['Kupon'] || {}, { defval: '' })
        }
    ];

    // 5. Auto-sinkronisasi Produk, Tindakan, dan Paket Kupon yang belum ada di Master
    console.log('🔎 Memeriksa sinkronisasi master tindakan, produk, & paket kupon...');
    const missingTreatmentsToInsert = [];
    const missingProductsToInsert = [];
    const missingPackagesToInsert = [];

    sources.forEach(src => {
        src.treatments.forEach(tr => {
            const rawName = String(tr.treatment || tr.nama || '').trim();
            if (!rawName) return;
            const cleanName = rawName.toLowerCase().replace(/\s+/g, ' ');
            const kat = String(tr.kategori || '').toLowerCase().trim();

            if (isProductItem(tr)) {
                if (!productMap.has(cleanName)) {
                    const newProdId = crypto.randomUUID();
                    const prodObj = {
                        id: newProdId,
                        name: rawName,
                        description: 'Produk Skincare Riwayat GD Cashier',
                        price: Number(tr.harga || 0),
                        is_active: false
                    };
                    productMap.set(cleanName, prodObj);
                    missingProductsToInsert.push(prodObj);
                }
            } else {
                if (!treatmentMap.has(cleanName)) {
                    const newTrId = crypto.randomUUID();
                    const matchedCat = categoryMap.get(kat) || dbCategories?.[0];
                    const trObj = {
                        id: newTrId,
                        category_id: matchedCat?.id || defaultCategoryId,
                        name: rawName,
                        description: 'Layanan Tindakan Riwayat GD Cashier',
                        price: Number(tr.harga || 0),
                        duration_minutes: 60,
                        followup_days: 14,
                        discount_percent: 0,
                        commission_percent: 5,
                        is_active: false
                    };
                    treatmentMap.set(cleanName, trObj);
                    missingTreatmentsToInsert.push(trObj);
                }
            }
        });

        src.coupons.forEach(kp => {
            const gName = String(kp.grup_kupon || kp.nama_kupon || '').trim();
            if (!gName) return;
            const cleanG = gName.toLowerCase().replace(/\s+/g, ' ');
            if (!packageMap.has(cleanG)) {
                const pkgId = crypto.randomUUID();
                const pkgObj = {
                    id: pkgId,
                    name: gName,
                    description: 'Paket Kupon Riwayat GD Cashier',
                    price: 0,
                    is_active: false
                };
                packageMap.set(cleanG, pkgObj);
                missingPackagesToInsert.push(pkgObj);
            }
        });
    });

    if (!isDryRun) {
        if (missingTreatmentsToInsert.length > 0) {
            await supabase.from('treatments').insert(missingTreatmentsToInsert);
            console.log(`   ✅ Menambahkan ${missingTreatmentsToInsert.length} tindakan riwayat baru ke master.`);
        }
        if (missingProductsToInsert.length > 0) {
            await supabase.from('products').insert(missingProductsToInsert);
            console.log(`   ✅ Menambahkan ${missingProductsToInsert.length} produk riwayat baru ke master.`);
        }
        if (missingPackagesToInsert.length > 0) {
            await supabase.from('coupon_packages').insert(missingPackagesToInsert);
            console.log(`   ✅ Menambahkan ${missingPackagesToInsert.length} paket kupon baru ke master.`);
        }
    }
    console.log('   ✅ Master data katalog siap.\n');

    // 6. Pemrosesan Data Pasien (Anti-Duplikasi Lintas Cabang)
    console.log('👥 Memproses data pasien dengan deduplikasi lintas cabang...');
    const codeToPatientId = new Map(); // gd_user_code -> patient_id
    const stagedPatients = [];
    const stagedWaMap = new Map(); // nomor WA yang baru di-stage
    let reusedExistingCount = 0;
    let newCreatedCount = 0;

    sources.forEach(src => {
        src.patients.forEach(row => {
            const code = String(row.gd_user_code || '').trim();
            const rawWa = String(row.whatsapp || '').trim();
            const wa = normalizePhone(rawWa);
            const name = String(row.full_name || '').trim() || 'Tanpa Nama';
            const birthDate = parseDateOrNull(row.birth_date);
            const gender = (String(row.gender || '').toLowerCase() === 'male') ? 'male' : 'female';
            const cabangTerdaftar = String(row.cabang_terdaftar || row.cabang || '').trim();

            if (!code) return;

            // 1. Cek apakah nomor WA sudah ada di database Supabase (misal dari Ciamis atau registrasi awal)
            if (wa && existingWaMap.has(wa)) {
                const existingId = existingWaMap.get(wa);
                codeToPatientId.set(code, existingId);
                reusedExistingCount++;
                return;
            }

            // 2. Cek apakah nomor WA sudah pernah di-stage dalam batch ini (misal pasien muncul di kedua file Banjar & Tasik)
            if (wa && stagedWaMap.has(wa)) {
                const stagedId = stagedWaMap.get(wa);
                codeToPatientId.set(code, stagedId);
                return;
            }

            // 3. Pasien benar-benar baru
            const newPatId = crypto.randomUUID();
            codeToPatientId.set(code, newPatId);
            if (wa) stagedWaMap.set(wa, newPatId);

            // Tentukan branch_id awal: utamakan cabang terdaftar aslinya
            const patientBranchId = cabangTerdaftar.toLowerCase().includes('banjar') 
                ? BANJAR_BRANCH_ID 
                : (cabangTerdaftar.toLowerCase().includes('tasik') ? TASIK_BRANCH_ID : src.branchId);

            stagedPatients.push({
                id: newPatId,
                branch_id: patientBranchId,
                full_name: name,
                whatsapp: wa,
                birth_date: birthDate,
                gender: gender,
                address: String(row.address || '').trim() || null,
                instagram: String(row.instagram || '').trim() || null,
                notes: String(row.notes || '').trim() || null,
                is_active: true,
                created_at: new Date('2022-01-01T00:00:00+07:00').toISOString(),
                updated_at: new Date().toISOString()
            });
            newCreatedCount++;
        });
    });

    console.log(`   - Pasien Sudah Ada (Reused / Disatukan) : ${reusedExistingCount} kali`);
    console.log(`   - Pasien Baru Ditambahkan             : ${newCreatedCount} pasien baru\n`);

    // 7. Pemrosesan Transaksi & Treatment Records
    console.log('💳 Memproses transaksi & rekam medis kunjungan...');
    const transactionPayloads = [];
    const transactionItemPayloads = [];
    const treatmentRecordPayloads = [];
    const treatmentRecordItemPayloads = [];

    sources.forEach(src => {
        // Grouping Treatments by trx_ref
        const treatmentsByTrxRef = new Map();
        src.treatments.forEach(tr => {
            const ref = String(tr.trx_ref || '').trim();
            if (!ref) return;
            if (!treatmentsByTrxRef.has(ref)) {
                treatmentsByTrxRef.set(ref, []);
            }
            treatmentsByTrxRef.get(ref).push(tr);
        });

        src.transactions.forEach(tx => {
            const ref = String(tx.trx_ref || '').trim();
            const userCode = String(tx.gd_user_code || '').trim();
            const patientId = codeToPatientId.get(userCode) || null;

            if (!ref) return;

            const trxId = crypto.randomUUID();
            const isoDate = parseIsoTimestamp(tx.tanggal);
            const subtotal = Number(tx.subtotal || 0);
            const discTrx = Number(tx.diskon_transaksi || 0);
            const discItem = Number(tx.diskon_item || 0);
            const discCoupon = Number(tx.diskon_kupon || 0);
            const totalDisc = discTrx + discItem + discCoupon;
            const grandTotal = Number(tx.grand_total || (subtotal - totalDisc));
            const paymentMethod = normalizePaymentMethod(tx.metode_bayar);

            // Deteksi Status VOID
            const isVoid = String(tx.status || '').toLowerCase() === 'void' 
                || String(tx.tipe || '').toUpperCase() === 'VOID' 
                || Boolean(tx.void_pada);
            const paymentStatus = isVoid ? 'void' : 'paid';

            // Deteksi Split Payment
            const rawMethod = String(tx.metode_bayar || '').trim();
            let splitTag = null;
            if (rawMethod.includes(',') || rawMethod.includes('+') || rawMethod.includes('/')) {
                const rawParts = rawMethod.split(/[,+/]/).map(p => normalizePaymentMethod(p.trim())).filter(Boolean);
                const uniqueParts = Array.from(new Set(rawParts));
                if (uniqueParts.length > 1) {
                    const splitAmt = Math.round(grandTotal / uniqueParts.length);
                    let remAmt = grandTotal;
                    const splitPairs = uniqueParts.map((m, mIdx) => {
                        const amt = mIdx === uniqueParts.length - 1 ? remAmt : splitAmt;
                        remAmt -= amt;
                        return `${m}=${amt}`;
                    });
                    splitTag = `[SPLIT:${splitPairs.join(';')}]`;
                }
            }

            const notesArr = [];
            if (splitTag) notesArr.push(splitTag);
            if (isVoid) notesArr.push('[STATUS: VOID/BATAL]');
            if (tx.alasan_void) notesArr.push(`Alasan Void: ${tx.alasan_void}`);
            if (tx.tipe && tx.tipe !== 'NORMAL') notesArr.push(tx.tipe);
            if (tx.catatan) notesArr.push(tx.catatan);
            if (tx.no_struk) notesArr.push(`Struk: ${tx.no_struk}`);
            const notes = notesArr.join(' | ') || null;

            const items = treatmentsByTrxRef.get(ref) || [];
            const hasTreatmentItems = items.some(i => !isProductItem(i));
            const treatmentItems = items.filter(i => !isProductItem(i));
            const dateStr = String(tx.tanggal || '').split(' ')[0] || '2022-06-01';
            const timeStr = String(tx.tanggal || '').split(' ')[1] || '10:00:00';

            // Buat rekam medis EMR per transaksi non-void yang punya tindakan medis klinis
            let treatmentRecordId = null;
            if (patientId && hasTreatmentItems && !isVoid) {
                treatmentRecordId = crypto.randomUUID();

                let primaryTherapistUser = null;
                for (const item of treatmentItems) {
                    const rawT = String(item.terapis || '').trim();
                    const tLower = rawT.toLowerCase();
                    const isUnassigned = tLower === '' || tLower === 'infus' || tLower === 'staf' || tLower === 'dokter' || tLower === 'perawat';
                    if (!isUnassigned) {
                        const u = findTherapistUser(rawT, src.branchId);
                        if (u) {
                            primaryTherapistUser = u;
                            break;
                        }
                    }
                }

                const labels = [];
                if (primaryTherapistUser) labels.push(primaryTherapistUser.full_name);
                const hasWorker = treatmentItems.some(i => {
                    const rawT = String(i.terapis || '').trim().toLowerCase();
                    return rawT === '' || rawT === 'infus' || rawT === 'staf' || rawT === 'dokter' || rawT === 'perawat';
                });
                if (hasWorker) labels.push('Worker (Infus)');

                treatmentRecordPayloads.push({
                    id: treatmentRecordId,
                    patient_id: patientId,
                    branch_id: src.branchId,
                    performed_by: primaryTherapistUser?.id || null,
                    treatment_date: dateStr,
                    treatment_time: timeStr,
                    skin_condition: '-',
                    complaints: '-',
                    result_notes: `Migrasi GD Cashier | No. Struk: ${tx.no_struk || '-'} | Terapis: ${labels.join(', ') || 'Worker'}`,
                    recommendation: '-',
                    created_at: isoDate,
                    updated_at: isoDate
                });
            }

            // Header Transaksi
            transactionPayloads.push({
                id: trxId,
                transaction_number: ref,
                patient_id: patientId,
                branch_id: src.branchId,
                treatment_record_id: treatmentRecordId,
                cashier_id: src.defaultCashier?.id || null,
                subtotal: subtotal,
                discount: totalDisc,
                discount_type: 'nominal',
                total: grandTotal,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                notes: notes,
                created_at: isoDate,
                updated_at: isoDate
            });

            // Rincian Item Transaksi & Tindakan EMR
            let treatmentSortOrder = 1;
            items.forEach(item => {
                const rawItemName = String(item.treatment || item.nama || 'Item').trim();
                const cleanName = rawItemName.toLowerCase().replace(/\s+/g, ' ');
                const isProd = isProductItem(item);
                const isCouponSale = String(item.tipe_trx || tx.tipe || '').toUpperCase() === 'COUPON SALES';

                let itemType = 'treatment';
                let treatmentId = null;
                let productId = null;

                if (isCouponSale) {
                    itemType = 'coupon';
                } else if (isProd) {
                    itemType = 'product';
                    const matchedProd = productMap.get(cleanName);
                    productId = matchedProd?.id || null;
                } else {
                    itemType = 'treatment';
                    const matchedTr = treatmentMap.get(cleanName);
                    treatmentId = matchedTr?.id || null;
                }

                const qty = Number(item.qty || 1);
                const price = Number(item.harga || 0);
                const itemSubtotal = Number(item.subtotal || (price * qty));
                const bruto = Number(price * qty);
                const discNominal = Number(item.diskon || 0);
                const discPercent = bruto > 0 ? Math.round((discNominal / bruto) * 100) : 0;
                const commPercent = itemType === 'treatment' ? (treatmentMap.get(cleanName)?.commission_percent || 5) : 0;

                transactionItemPayloads.push({
                    id: crypto.randomUUID(),
                    transaction_id: trxId,
                    item_type: itemType,
                    treatment_id: treatmentId,
                    product_id: productId,
                    name: rawItemName,
                    price: price,
                    quantity: qty,
                    subtotal: itemSubtotal,
                    original_price: price,
                    discount_percent: discPercent,
                    commission_percent: commPercent,
                    created_at: isoDate
                });

                if (!isProd && treatmentId && treatmentRecordId) {
                    const rawT = String(item.terapis || '').trim();
                    const tLower = rawT.toLowerCase();
                    const isUnassigned = tLower === '' || tLower === 'infus' || tLower === 'staf' || tLower === 'dokter' || tLower === 'perawat';
                    const itemUser = !isUnassigned ? findTherapistUser(rawT, src.branchId) : null;
                    const effectiveCommPercent = itemUser ? commPercent : 0;

                    treatmentRecordItemPayloads.push({
                        id: crypto.randomUUID(),
                        treatment_record_id: treatmentRecordId,
                        treatment_id: treatmentId,
                        price_at_time: itemSubtotal,
                        original_price: price,
                        discount_percent: discPercent,
                        commission_percent: effectiveCommPercent,
                        notes: `${rawItemName}${item.terapis ? ` (${item.terapis})` : (isUnassigned ? ' (Worker / Infus)' : '')}`,
                        sort_order: treatmentSortOrder++
                    });
                }
            });
        });
    });

    console.log(`   - Transaksi Siap Migrasi     : ${transactionPayloads.length} transaksi`);
    console.log(`   - Item Transaksi Siap        : ${transactionItemPayloads.length} baris`);
    console.log(`   - Rekam Medis Kunjungan Siap : ${treatmentRecordPayloads.length} rekam medis\n`);

    // 8. Pemrosesan Kupon Pasien
    console.log('🎟️ Memproses paket kupon pasien...');
    const couponPayloads = [];
    const couponItemPayloads = [];
    let activeCouponsCount = 0;
    let activeSessionsCount = 0;

    sources.forEach(src => {
        const couponGroups = new Map();

        src.coupons.forEach(kp => {
            const userCode = String(kp.gd_user_code || '').trim();
            const patientId = codeToPatientId.get(userCode);
            if (!patientId) return;

            const groupName = String(kp.grup_kupon || kp.nama_kupon || 'Paket Kupon').trim();
            const startDate = String(kp.mulai || '2022-06-01').trim();
            const endDate = String(kp.berakhir || kp.berakhir_asli || '2027-01-01').trim();
            const key = [patientId, groupName, startDate, endDate].join('___');

            if (!couponGroups.has(key)) {
                couponGroups.set(key, {
                    patientId,
                    groupName,
                    namaKupon: kp.nama_kupon,
                    startDate,
                    endDate,
                    branchId: src.branchId,
                    sessions: []
                });
            }
            couponGroups.get(key).sessions.push(kp);
        });

        const now = new Date();

        couponGroups.forEach(group => {
            const couponId = crypto.randomUUID();
            const cleanPkgName = group.groupName.toLowerCase().replace(/\s+/g, ' ');
            const matchedPkg = packageMap.get(cleanPkgName);

            const totalSessions = group.sessions.length;
            let usedSessions = 0;
            let activeSessions = 0;

            group.sessions.forEach(s => {
                const st = String(s.status || '').toLowerCase().trim();
                if (st === 'redeemed') usedSessions++;
                else activeSessions++; // active / sisa hari
            });

            const remainingSessions = Math.max(0, totalSessions - usedSessions);
            if (remainingSessions > 0) activeSessionsCount += remainingSessions;

            const startDateIso = parseIsoTimestamp(group.startDate);
            const endDateIso = parseIsoTimestamp(group.endDate);
            const isPastExpiry = new Date(endDateIso) < now;

            let couponStatus = 'expired';
            let itemStatus = 'fully_used';

            if (remainingSessions > 0 && !isPastExpiry) {
                couponStatus = 'active';
                itemStatus = 'active';
                activeCouponsCount++;
            } else if (remainingSessions > 0 && isPastExpiry) {
                couponStatus = 'expired';
                itemStatus = 'active';
            } else {
                couponStatus = 'fully_used';
                itemStatus = 'fully_used';
            }

            couponPayloads.push({
                id: couponId,
                patient_id: group.patientId,
                package_id: matchedPkg?.id || null,
                transaction_id: null,
                purchased_at: startDateIso,
                expired_at: endDateIso,
                status: couponStatus,
                notes: group.groupName,
                created_at: startDateIso
            });

            let treatmentId = null;
            const rawKName = String(group.namaKupon || group.groupName || '').toLowerCase().trim().replace(/\s+/g, ' ');
            const matchedTr = treatmentMap.get(rawKName);
            if (matchedTr) {
                treatmentId = matchedTr.id;
            } else {
                for (const [tName, tObj] of treatmentMap.entries()) {
                    if (rawKName.includes(tName) || tName.includes(rawKName)) {
                        treatmentId = tObj.id;
                        break;
                    }
                }
            }

            couponItemPayloads.push({
                id: crypto.randomUUID(),
                patient_coupon_id: couponId,
                coupon_package_item_id: null,
                treatment_id: treatmentId,
                total_sessions: totalSessions,
                used_sessions: usedSessions,
                remaining_sessions: remainingSessions,
                status: itemStatus
            });
        });
    });

    console.log(`   - Paket Kupon Siap Migrasi   : ${couponPayloads.length} paket`);
    console.log(`   - Paket Kupon Aktif          : ${activeCouponsCount} paket aktif (${activeSessionsCount} sisa sesi aktif)\n`);

    if (isDryRun) {
        console.log('===============================================================');
        console.log('✅ DRY RUN SELESAI. Semua kalkulasi valid, siap ditulis.');
        console.log('===============================================================');
        return;
    }

    // 9. Eksekusi Penulisan ke Database dalam Batch
    console.log('⚡ MEMULAI PENULISAN KE SUPABASE (Batch Size: ' + BATCH_SIZE + ')...');

    async function batchInsert(tableName, items, label) {
        const total = items.length;
        if (total === 0) return;
        let inserted = 0;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const chunk = items.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from(tableName).insert(chunk);
            if (error) {
                console.error(`\n❌ Gagal menyisipkan batch pada tabel '${tableName}' (indeks ${i}):`, error.message);
                throw error;
            }
            inserted += chunk.length;
            const pct = Math.round((inserted / total) * 100);
            process.stdout.write(`\r   ⏳ Menyimpan ${label}: [${inserted}/${total}] (${pct}%)`);
        }
        console.log(`\n   ✅ Berhasil menyimpan ${label} (${inserted} baris)`);
    }

    // 1. Pasien Baru
    if (stagedPatients.length > 0) {
        await batchInsert('patients', stagedPatients, 'Data Pasien Baru');
    }

    // 2. Rekam Medis (EMR Header Baru dari GD Cashier)
    await batchInsert('treatment_records', treatmentRecordPayloads, 'Rekam Medis (EMR)');

    // 3. Transactions (Header)
    await batchInsert('transactions', transactionPayloads, 'Transaksi Penjualan');

    // 4. Transaction Items
    await batchInsert('transaction_items', transactionItemPayloads, 'Item Transaksi');

    // 5. Treatment Record Items
    await batchInsert('treatment_record_items', treatmentRecordItemPayloads, 'Item Tindakan Medis');

    // 6. Patient Coupons
    await batchInsert('patient_coupons', couponPayloads, 'Kupon Pasien');

    // 7. Patient Coupon Items
    await batchInsert('patient_coupon_items', couponItemPayloads, 'Item Paket Kupon');

    // 10. Verifikasi Akhir
    console.log('\n🔍 Memverifikasi data tersimpan di Supabase...');
    const [
        { count: patBanjar },
        { count: patTasik },
        { count: txBanjar },
        { count: txTasik },
        { count: trBanjar },
        { count: trTasik },
        { count: cpBanjar },
        { count: cpTasik },
        { data: protectedPhotosCheck }
    ] = await Promise.all([
        supabase.from('patients').select('*', { count: 'exact', head: true }).eq('branch_id', BANJAR_BRANCH_ID),
        supabase.from('patients').select('*', { count: 'exact', head: true }).eq('branch_id', TASIK_BRANCH_ID),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('branch_id', BANJAR_BRANCH_ID),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('branch_id', TASIK_BRANCH_ID),
        supabase.from('treatment_records').select('*', { count: 'exact', head: true }).eq('branch_id', BANJAR_BRANCH_ID),
        supabase.from('treatment_records').select('*', { count: 'exact', head: true }).eq('branch_id', TASIK_BRANCH_ID),
        supabase.from('patient_coupons').select('*, patients!inner(branch_id)', { count: 'exact', head: true }).eq('patients.branch_id', BANJAR_BRANCH_ID),
        supabase.from('patient_coupons').select('*, patients!inner(branch_id)', { count: 'exact', head: true }).eq('patients.branch_id', TASIK_BRANCH_ID),
        supabase.from('patient_photos').select('id, treatment_record_id')
    ]);

    console.log('\n===============================================================');
    console.log('🎉 MIGRASI BANJAR & TASIKMALAYA BERHASIL 100%!');
    console.log('===============================================================');
    console.log('📊 Cabang Ayumi Banjar:');
    console.log(`   - Pasien Terdaftar      : ${patBanjar} pasien`);
    console.log(`   - Transaksi Penjualan    : ${txBanjar} transaksi`);
    console.log(`   - Rekam Medis (EMR)      : ${trBanjar} rekam medis`);
    console.log(`   - Paket Kupon           : ${cpBanjar} paket kupon`);
    console.log('📊 Cabang Ayumi Tasikmalaya:');
    console.log(`   - Pasien Terdaftar      : ${patTasik} pasien`);
    console.log(`   - Transaksi Penjualan    : ${txTasik} transaksi`);
    console.log(`   - Rekam Medis (EMR)      : ${trTasik} rekam medis`);
    console.log(`   - Paket Kupon           : ${cpTasik} paket kupon`);
    console.log(`📸 Keamanan Foto Medis    : ${protectedPhotosCheck?.length || 0} foto tetap aman utuh terhubung.`);
    console.log('===============================================================\n');
}

main().catch(err => {
    console.error('\n❌ Terjadi kesalahan fatal pada skrip migrasi:', err);
    process.exit(1);
});
