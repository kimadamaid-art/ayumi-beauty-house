/**
 * scripts/migrate-gd-cashier.mjs
 * 
 * Skrip migrasi sekali-jalan untuk memuat riwayat data GD Cashier ke Supabase.
 * Khusus cabang Ayumi Ciamis (branch_id: 6bc44a26-f7f3-4ea7-8902-a2c48e27b598).
 * 
 * Penggunaan:
 *   node scripts/migrate-gd-cashier.mjs [path_excel] [--dry-run] [--reset]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// Konstanta Cabang Ayumi Ciamis
const CIAMIS_BRANCH_ID = '6bc44a26-f7f3-4ea7-8902-a2c48e27b598';
const BATCH_SIZE = 500;

// 1. Membaca kredensial dari .env.local
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

// 2. Helper Normalisasi & Klasifikasi
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
    if (kat.includes('yufaderma') || kat.includes('produk') || kat.includes('dekoratif')) return true;
    if (name.includes('paket yufaderma') || name.includes('serum flek') || name.includes('tintera rosy') || name.includes('soothing care') || name.includes('night body lotion')) return true;
    return false;
}

// 3. Main Migration Routine
async function main() {
    console.log('===============================================================');
    console.log('🚀 MIGRASI DATA GD CASHIER -> SUPABASE (AYUMI CIAMIS)');
    console.log('===============================================================\n');

    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isReset = args.includes('--reset');

    // Cari path file Excel dari argumen atau default
    let excelPath = args.find(a => !a.startsWith('--'));
    if (!excelPath) {
        const candidates = [
            'Ayumi_Buniseuri_Migrasi_v2_2026-08-31.xlsx',
            './Ayumi_Buniseuri_Migrasi_v2_2026-08-31.xlsx',
            path.resolve(process.env.HOME || '', 'Downloads/Ayumi_Buniseuri_Migrasi_v2_2026-08-31.xlsx')
        ];
        excelPath = candidates.find(c => fs.existsSync(c));
    }

    if (!excelPath || !fs.existsSync(excelPath)) {
        console.error(`❌ File Excel tidak ditemukan: ${excelPath || '(argumen kosong)'}`);
        process.exit(1);
    }

    console.log(`📁 File Excel   : ${path.resolve(excelPath)}`);
    console.log(`🏢 Target Cabang : Ayumi Ciamis (${CIAMIS_BRANCH_ID})`);
    console.log(`⚙️  Mode         : ${isDryRun ? '🔍 DRY RUN (Simulasi Saja)' : isReset ? '🔄 RESET + MIGRASI' : '⚡ FULL MIGRATION'}\n`);

    // Inisialisasi Supabase
    const { supabaseUrl, serviceRoleKey } = loadEnv();
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    // 4. Reset & Cleanup Data Cabang Ciamis
    if (isReset || (!isDryRun && !isReset)) {
        console.log('🧹 [CLEANUP/RESET] Memastikan data riwayat cabang Ciamis bersih sebelum migrasi...');
        
        // 1. Putuskan relasi cyclic
        await supabase.from('transactions').update({ treatment_record_id: null }).eq('branch_id', CIAMIS_BRANCH_ID);

        // 2. Transaksi & Items (dengan paginasi lengkap)
        let allTrxIds = [];
        let from = 0;
        while (true) {
            const { data } = await supabase.from('transactions').select('id').eq('branch_id', CIAMIS_BRANCH_ID).range(from, from + 999);
            if (!data || data.length === 0) break;
            allTrxIds.push(...data.map(d => d.id));
            from += 1000;
        }
        for (let i = 0; i < allTrxIds.length; i += 500) {
            await supabase.from('transaction_items').delete().in('transaction_id', allTrxIds.slice(i, i + 500));
        }
        await supabase.from('transactions').delete().eq('branch_id', CIAMIS_BRANCH_ID);

        // 3. Treatment Records & Items (dengan paginasi lengkap)
        let allRecIds = [];
        from = 0;
        while (true) {
            const { data } = await supabase.from('treatment_records').select('id').eq('branch_id', CIAMIS_BRANCH_ID).range(from, from + 999);
            if (!data || data.length === 0) break;
            allRecIds.push(...data.map(d => d.id));
            from += 1000;
        }
        for (let i = 0; i < allRecIds.length; i += 500) {
            const chunk = allRecIds.slice(i, i + 500);
            await supabase.from('treatment_record_items').delete().in('treatment_record_id', chunk);
            await supabase.from('treatment_records').delete().in('id', chunk);
        }
        await supabase.from('treatment_records').delete().eq('branch_id', CIAMIS_BRANCH_ID);

        // 4. Kupon & Items (dengan paginasi lengkap)
        let allCouponIds = [];
        from = 0;
        while (true) {
            const { data } = await supabase.from('patient_coupons').select('id, patients!inner(branch_id)').eq('patients.branch_id', CIAMIS_BRANCH_ID).range(from, from + 999);
            if (!data || data.length === 0) break;
            allCouponIds.push(...data.map(d => d.id));
            from += 1000;
        }
        for (let i = 0; i < allCouponIds.length; i += 500) {
            const chunk = allCouponIds.slice(i, i + 500);
            await supabase.from('patient_coupon_items').delete().in('patient_coupon_id', chunk);
            await supabase.from('patient_coupons').delete().in('id', chunk);
        }

        // 5. Followup & Pasien
        await supabase.from('followup_logs').delete().eq('branch_id', CIAMIS_BRANCH_ID);
        await supabase.from('followup_queue').delete().eq('branch_id', CIAMIS_BRANCH_ID);
        await supabase.from('patients').delete().eq('branch_id', CIAMIS_BRANCH_ID);

        // 6. Bersihkan entri produk yang sebelumnya keliru masuk ke treatments
        const { data: legacyTrs } = await supabase.from('treatments').select('id, name');
        const wronglyInTreatments = (legacyTrs || []).filter(t => isProductItem({ nama: t.name, treatment: t.name }));
        if (wronglyInTreatments.length > 0) {
            const wrongIds = wronglyInTreatments.map(t => t.id);
            await supabase.from('treatments').delete().in('id', wrongIds);
        }

        console.log('✅ [CLEANUP/RESET] Database siap dan bersih untuk diisi ulang.\n');
    }

    // 5. Muat Cache Master Data dari Supabase
    console.log('📥 Memuat master data dari Supabase...');
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

    // Build Master Lookup Maps
    const userMap = new Map();
    (dbUsers || []).forEach(u => {
        const clean = u.full_name.toLowerCase().trim().replace(/\s+/g, ' ');
        userMap.set(clean, u);
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

    // Helper pencocokan terapis fleksibel
    function findTherapistUser(tName) {
        if (!tName) return null;
        const clean = tName.toLowerCase().trim().replace(/\s+/g, ' ');
        if (userMap.has(clean)) return userMap.get(clean);
        
        for (const u of dbUsers || []) {
            const uClean = u.full_name.toLowerCase().trim().replace(/\s+/g, ' ');
            if (uClean === clean || uClean.includes(clean) || clean.includes(uClean)) return u;
            if (clean.includes('asti') && uClean.includes('asti')) return u;
            if (clean.includes('raika') && uClean.includes('raika')) return u;
            if ((clean.includes('nisa') || clean.includes('anisa')) && uClean.includes('nisa')) return u;
            if (clean.includes('elsa') && uClean.includes('elsa')) return u;
            if ((clean.includes('pransiska') || clean.includes('fransiska')) && uClean.includes('fransiska')) return u;
            if ((clean.includes('indri') || clean.includes('indria')) && uClean.includes('indri')) return u;
            if (clean.includes('rana') && uClean.includes('rana')) return u;
            if (clean.includes('fani') && uClean.includes('fani')) return u;
            if (clean.includes('ayu') && uClean.includes('ayu')) return u;
            if (clean.includes('memey') && uClean.includes('memey')) return u;
            if (clean.includes('lilis') && uClean.includes('lilis')) return u;
            if (clean.includes('della') && uClean.includes('della')) return u;
        }
        return null;
    }

    console.log(`   - Master Users     : ${(dbUsers || []).length} akun`);
    console.log(`   - Master Kategori  : ${(dbCategories || []).length} kategori`);
    console.log(`   - Master Tindakan  : ${(dbTreatments || []).length} layanan`);
    console.log(`   - Master Produk    : ${(dbProducts || []).length} produk`);
    console.log(`   - Master Paket     : ${(dbPackages || []).length} paket kupon\n`);

    // 6. Membaca berkas Excel
    console.log('📖 Membaca berkas Excel...');
    const workbook = XLSX.readFile(excelPath);
    const rawPatients = XLSX.utils.sheet_to_json(workbook.Sheets['Pasien'] || {}, { defval: '' });
    const rawTransactions = XLSX.utils.sheet_to_json(workbook.Sheets['Transaksi'] || {}, { defval: '' });
    const rawTreatments = XLSX.utils.sheet_to_json(workbook.Sheets['Treatment'] || {}, { defval: '' });
    const rawCoupons = XLSX.utils.sheet_to_json(workbook.Sheets['Kupon'] || {}, { defval: '' });

    console.log(`   - Sheet Pasien    : ${rawPatients.length} baris`);
    console.log(`   - Sheet Transaksi : ${rawTransactions.length} baris`);
    console.log(`   - Sheet Treatment : ${rawTreatments.length} baris`);
    console.log(`   - Sheet Kupon     : ${rawCoupons.length} baris\n`);

    // 6b. Auto-sinkronisasi Produk & Tindakan Riwayat yang belum ada di Master
    console.log('🔎 Memeriksa katalog tindakan & produk riwayat dari sheet Treatment...');
    const missingTreatmentsToInsert = [];
    const missingProductsToInsert = [];

    rawTreatments.forEach(tr => {
        const rawName = String(tr.treatment || tr.nama || '').trim();
        if (!rawName) return;
        const cleanName = rawName.toLowerCase().replace(/\s+/g, ' ');
        const kat = String(tr.kategori || '').toLowerCase().trim();

        if (isProductItem(tr)) {
            // Item adalah PRODUK
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
            // Item adalah TINDAKAN MEDIS / LAYANAN
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

    if (missingTreatmentsToInsert.length > 0 || missingProductsToInsert.length > 0) {
        console.log(`   - Menemukan ${missingTreatmentsToInsert.length} tindakan baru dan ${missingProductsToInsert.length} produk baru.`);
        if (!isDryRun) {
            if (missingTreatmentsToInsert.length > 0) {
                const { error: tErr } = await supabase.from('treatments').insert(missingTreatmentsToInsert);
                if (tErr) console.warn('Warning inserting legacy treatments:', tErr.message);
                else console.log(`   ✅ Tersinkronisasi ${missingTreatmentsToInsert.length} tindakan riwayat ke tabel treatments.`);
            }
            if (missingProductsToInsert.length > 0) {
                const { error: pErr } = await supabase.from('products').insert(missingProductsToInsert);
                if (pErr) console.warn('Warning inserting legacy products:', pErr.message);
                else console.log(`   ✅ Tersinkronisasi ${missingProductsToInsert.length} produk riwayat ke tabel products.`);
            }
        }
    } else {
        console.log('   ✅ Semua tindakan & produk sudah terdaftar di master data.');
    }

    // 6c. Auto-sinkronisasi Master Paket Kupon
    console.log('🔎 Memeriksa master paket kupon dari sheet Kupon...');
    const missingPackagesToInsert = [];
    const uniqueCouponGroups = [...new Set(rawCoupons.map(k => String(k.grup_kupon || k.nama_kupon || '').trim()).filter(Boolean))];

    uniqueCouponGroups.forEach(gName => {
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

    if (missingPackagesToInsert.length > 0) {
        console.log(`   - Menemukan ${missingPackagesToInsert.length} variasi paket kupon riwayat.`);
        if (!isDryRun) {
            const { error: pkgErr } = await supabase.from('coupon_packages').insert(missingPackagesToInsert);
            if (pkgErr) console.warn('Warning inserting legacy packages:', pkgErr.message);
            else console.log(`   ✅ Tersinkronisasi ${missingPackagesToInsert.length} paket kupon riwayat ke coupon_packages.`);
        }
    } else {
        console.log('   ✅ Semua variasi paket kupon sudah terdaftar di master data.');
    }
    console.log('');

    // Validasi & Siapkan Peta Pasien (gd_user_code -> patient_id)
    const codeToPatientId = new Map();
    const waToPatientId = new Map();
    const patientPayloads = [];
    const validationErrors = [];

    rawPatients.forEach((row, idx) => {
        const rowNum = idx + 2;
        const code = String(row.gd_user_code || '').trim();
        const rawWa = String(row.whatsapp || '').trim();
        const wa = normalizePhone(rawWa);
        const name = String(row.full_name || '').trim() || 'Tanpa Nama';
        const birthDate = parseDateOrNull(row.birth_date);
        const gender = (String(row.gender || '').toLowerCase() === 'male') ? 'male' : 'female';
        
        if (!code) {
            validationErrors.push({ sheet: 'Pasien', row: rowNum, error: 'gd_user_code kosong' });
            return;
        }

        // Cek duplikasi nomor WhatsApp dalam file Pasien
        let patientId;
        if (wa && waToPatientId.has(wa)) {
            patientId = waToPatientId.get(wa);
            codeToPatientId.set(code, patientId);
        } else {
            patientId = crypto.randomUUID();
            codeToPatientId.set(code, patientId);
            if (wa) waToPatientId.set(wa, patientId);

            patientPayloads.push({
                id: patientId,
                branch_id: CIAMIS_BRANCH_ID,
                full_name: name,
                whatsapp: wa,
                birth_date: birthDate,
                gender: gender,
                address: String(row.address || '').trim() || null,
                instagram: String(row.instagram || '').trim() || null,
                skin_type: String(row.skin_type || '').trim() || null,
                skin_concerns: row.skin_concerns ? [String(row.skin_concerns).trim()] : null,
                allergies: String(row.allergies || '').trim() || null,
                medical_notes: String(row.medical_notes || '').trim() || null,
                notes: String(row.notes || '').trim() || null,
                is_active: true,
                created_at: new Date('2021-04-01T00:00:00+07:00').toISOString(),
                updated_at: new Date().toISOString()
            });
        }
    });

    // Handle missing patients in Kupon (e.g. UU6MYNN)
    rawCoupons.forEach(kp => {
        const userCode = String(kp.gd_user_code || '').trim();
        if (userCode && !codeToPatientId.has(userCode)) {
            const rawWa = String(kp.whatsapp || '').trim();
            const wa = normalizePhone(rawWa);
            const name = String(kp.nama || '').trim() || 'Pelanggan Kupon';

            let pId;
            if (wa && waToPatientId.has(wa)) {
                pId = waToPatientId.get(wa);
            } else {
                pId = crypto.randomUUID();
                if (wa) waToPatientId.set(wa, pId);
                patientPayloads.push({
                    id: pId,
                    branch_id: CIAMIS_BRANCH_ID,
                    full_name: name,
                    whatsapp: wa,
                    birth_date: null,
                    gender: 'female',
                    address: null,
                    instagram: null,
                    skin_type: null,
                    skin_concerns: null,
                    allergies: null,
                    medical_notes: null,
                    notes: `GD:${userCode} | Ditambahkan dari Kupon`,
                    is_active: true,
                    created_at: new Date('2021-04-01T00:00:00+07:00').toISOString(),
                    updated_at: new Date().toISOString()
                });
            }
            codeToPatientId.set(userCode, pId);
        }
    });

    // 7. Siapkan Data Transaksi & Treatment Records
    const trxRefToTrxId = new Map();
    const transactionPayloads = [];
    const treatmentRecordPayloads = [];
    const transactionItemPayloads = [];
    const treatmentRecordItemPayloads = [];

    // Grouping Treatments by trx_ref
    const treatmentsByTrxRef = new Map();
    rawTreatments.forEach((tr, idx) => {
        const ref = String(tr.trx_ref || '').trim();
        if (!ref) {
            validationErrors.push({ sheet: 'Treatment', row: idx + 2, error: 'trx_ref kosong' });
            return;
        }
        if (!treatmentsByTrxRef.has(ref)) {
            treatmentsByTrxRef.set(ref, []);
        }
        treatmentsByTrxRef.get(ref).push({ ...tr, _rowNum: idx + 2 });
    });

    // Default Kasir Ciamis
    const defaultCashier = dbUsers?.find(u => u.role === 'admin' && u.branch_id === CIAMIS_BRANCH_ID) || dbUsers?.[0];

    rawTransactions.forEach((tx, idx) => {
        const rowNum = idx + 2;
        const ref = String(tx.trx_ref || '').trim();
        const userCode = String(tx.gd_user_code || '').trim();
        const patientId = codeToPatientId.get(userCode) || null;

        if (!ref) {
            validationErrors.push({ sheet: 'Transaksi', row: rowNum, error: 'trx_ref kosong' });
            return;
        }

        const trxId = crypto.randomUUID();
        trxRefToTrxId.set(ref, trxId);

        const isoDate = parseIsoTimestamp(tx.tanggal);
        const subtotal = Number(tx.subtotal || 0);
        const discTrx = Number(tx.diskon_transaksi || 0);
        const discItem = Number(tx.diskon_item || 0);
        const discCoupon = Number(tx.diskon_kupon || 0);
        const totalDisc = discTrx + discItem + discCoupon;
        const grandTotal = Number(tx.grand_total || (subtotal - totalDisc));
        const paymentMethod = normalizePaymentMethod(tx.metode_bayar);

        // Deteksi Split Payment dari GD Cashier
        const rawMethod = String(tx.metode_bayar || '').trim();
        let splitTag = null;
        if (rawMethod.includes(',') || rawMethod.includes('+') || rawMethod.includes('/')) {
            const rawParts = rawMethod.split(/[,+/]/).map(p => normalizePaymentMethod(p.trim())).filter(Boolean);
            const uniqueParts = Array.from(new Set(rawParts));
            if (uniqueParts.length > 1) {
                // Khusus transaksi Verawati 31 Agustus 2026 (POTX2608319SY5BB)
                if (ref.includes('2608319SY5BB') || String(tx.no_struk || '').includes('d8b5a0')) {
                    splitTag = '[SPLIT:cash=299000;transfer=599000]';
                } else {
                    // Split terdistribusi proporsional untuk riwayat lainnya
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
        }

        const notesArr = [];
        if (splitTag) notesArr.push(splitTag);
        if (tx.tipe && tx.tipe !== 'NORMAL') notesArr.push(tx.tipe);
        if (tx.catatan) notesArr.push(tx.catatan);
        if (tx.no_struk) notesArr.push(`Struk: ${tx.no_struk}`);
        const notes = notesArr.join(' | ') || null;

        const items = treatmentsByTrxRef.get(ref) || [];
        const hasTreatmentItems = items.some(i => !isProductItem(i));
        const treatmentItems = items.filter(i => !isProductItem(i));
        const dateStr = String(tx.tanggal || '').split(' ')[0] || '2021-04-05';
        const timeStr = String(tx.tanggal || '').split(' ')[1] || '10:00:00';

        // Kelompokkan item tindakan medis berdasarkan terapis masing-masing
        const therapistGroups = new Map();
        treatmentItems.forEach(item => {
            const rawT = String(item.terapis || '').trim();
            const tLower = rawT.toLowerCase();
            const isUnassigned = tLower === '' || tLower === 'infus' || tLower === 'staf' || tLower === 'dokter' || tLower === 'perawat';
            const user = !isUnassigned ? findTherapistUser(rawT) : null;
            const key = user ? user.id : (isUnassigned ? 'UNASSIGNED' : rawT);

            if (!therapistGroups.has(key)) {
                therapistGroups.set(key, {
                    user: user,
                    label: rawT || (isUnassigned ? 'Infus / Medis' : 'Staf'),
                    recordId: null,
                    items: []
                });
            }
            therapistGroups.get(key).items.push(item);
        });

        // Buat rekam medis EMR per kelompok terapis (jika patient_id ADA dan ADA tindakan klinis)
        let primaryRecordId = null;
        if (patientId && hasTreatmentItems) {
            // Urutkan kelompok agar kelompok yang memiliki user terapis klinis menjadi primary
            const sortedGroups = Array.from(therapistGroups.values()).sort((a, b) => {
                if (a.user && !b.user) return -1;
                if (!a.user && b.user) return 1;
                return 0;
            });

            sortedGroups.forEach(group => {
                const recordId = crypto.randomUUID();
                group.recordId = recordId;
                if (!primaryRecordId) primaryRecordId = recordId;

                treatmentRecordPayloads.push({
                    id: recordId,
                    patient_id: patientId,
                    branch_id: CIAMIS_BRANCH_ID,
                    performed_by: group.user?.id || null,
                    treatment_date: dateStr,
                    treatment_time: timeStr,
                    skin_condition: '-',
                    complaints: '-',
                    result_notes: `Migrasi GD Cashier | No. Struk: ${tx.no_struk || '-'} | Terapis: ${group.label}`,
                    recommendation: '-',
                    created_at: isoDate,
                    updated_at: isoDate
                });
            });
        }

        // Transaction Header
        transactionPayloads.push({
            id: trxId,
            transaction_number: ref,
            patient_id: patientId,
            branch_id: CIAMIS_BRANCH_ID,
            treatment_record_id: primaryRecordId,
            cashier_id: defaultCashier?.id || null,
            subtotal: subtotal,
            discount: totalDisc,
            discount_type: 'nominal',
            total: grandTotal,
            payment_method: paymentMethod,
            payment_status: 'paid',
            notes: notes,
            created_at: isoDate,
            updated_at: isoDate
        });

        // Transaction Items & Treatment Record Items
        let treatmentSortOrder = 1;
        items.forEach((item) => {
            const rawItemName = String(item.treatment || item.nama || 'Item').trim();
            const cleanName = rawItemName.toLowerCase().replace(/\s+/g, ' ');
            const isProd = isProductItem(item);

            let itemType = 'treatment';
            let treatmentId = null;
            let productId = null;

            if (isProd) {
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
            const itemSubtotal = Number(item.subtotal || item.total || (price * qty));
            const bruto = Number(item.bruto || (price * qty));
            const discNominal = Number(item.diskon || 0);
            const discPercent = bruto > 0 ? Math.round((discNominal / bruto) * 100) : 0;
            const commPercent = itemType === 'treatment' ? (treatmentMap.get(cleanName)?.commission_percent || 5) : 0;
            const netDiscountedPrice = bruto > 0 && discNominal > 0 ? Math.round(itemSubtotal / qty) : price;

            // Transaction item
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
                original_price: bruto / qty || price,
                discount_percent: discPercent,
                commission_percent: commPercent,
                created_at: isoDate
            });

            // Treatment record item (hanya untuk tindakan medis klinis)
            if (!isProd && treatmentId) {
                // Temukan group recordId untuk item ini
                const rawT = String(item.terapis || '').trim();
                const tLower = rawT.toLowerCase();
                const isUnassigned = tLower === '' || tLower === 'infus' || tLower === 'staf' || tLower === 'dokter' || tLower === 'perawat';
                const user = !isUnassigned ? findTherapistUser(rawT) : null;
                const key = user ? user.id : (isUnassigned ? 'UNASSIGNED' : rawT);
                const assignedGroup = therapistGroups.get(key);
                const assignedRecordId = assignedGroup?.recordId || primaryRecordId;

                if (assignedRecordId) {
                    treatmentRecordItemPayloads.push({
                        id: crypto.randomUUID(),
                        treatment_record_id: assignedRecordId,
                        treatment_id: treatmentId,
                        price_at_time: netDiscountedPrice,
                        original_price: bruto / qty || price,
                        discount_percent: discPercent,
                        commission_percent: commPercent,
                        notes: `${rawItemName}${item.terapis ? ` (${item.terapis})` : ''}`,
                        sort_order: treatmentSortOrder++
                    });
                }
            }
        });
    });

    // 8. Siapkan Data Kupon
    const couponPayloads = [];
    const couponItemPayloads = [];
    let activeCouponsCount = 0;
    let totalSessionsCount = 0;
    let activeSessionsCount = 0;

    const couponGroups = new Map();
    rawCoupons.forEach((kp, idx) => {
        const userCode = String(kp.gd_user_code || '').trim();
        const patientId = codeToPatientId.get(userCode);
        if (!patientId) {
            validationErrors.push({ sheet: 'Kupon', row: idx + 2, error: `Pasien dengan gd_user_code '${userCode}' tidak ditemukan` });
            return;
        }

        const groupName = String(kp.grup_kupon || kp.nama_kupon || 'Paket Kupon').trim();
        const startDate = String(kp.mulai || '2021-04-10').trim();
        const endDate = String(kp.berakhir || kp.berakhir_asli || kp.mulai || '2022-04-10').trim();
        const key = [patientId, groupName, startDate, endDate].join('___');

        if (!couponGroups.has(key)) {
            couponGroups.set(key, {
                patientId,
                userCode,
                patientName: kp.nama,
                groupName,
                namaKupon: kp.nama_kupon,
                startDate,
                endDate,
                notes: kp.catatan,
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
            if (st === 'active') activeSessions++;
            else if (st === 'redeemed') usedSessions++;
        });

        if (activeSessions === 0 && usedSessions === 0) {
            usedSessions = totalSessions;
        }

        totalSessionsCount += totalSessions;
        activeSessionsCount += activeSessions;

        const startDateIso = parseIsoTimestamp(group.startDate);
        const endDateIso = parseIsoTimestamp(group.endDate);
        const isPastExpiry = new Date(endDateIso) < now;

        let couponStatus = 'expired';
        let itemStatus = 'fully_used';

        if (activeSessions > 0 && !isPastExpiry) {
            couponStatus = 'active';
            itemStatus = 'active';
            activeCouponsCount++;
        } else if (activeSessions > 0 && isPastExpiry) {
            couponStatus = 'expired';
            itemStatus = 'active';
        } else {
            couponStatus = 'fully_used';
            itemStatus = 'fully_used';
        }

        const notesArr = [group.groupName];
        if (group.notes) notesArr.push(group.notes);
        const notes = notesArr.filter(Boolean).join(' | ') || null;

        // 1. Header Paket Kupon Pasien
        couponPayloads.push({
            id: couponId,
            patient_id: group.patientId,
            package_id: matchedPkg?.id || null,
            transaction_id: null,
            purchased_at: startDateIso,
            expired_at: endDateIso,
            status: couponStatus,
            notes: notes,
            created_at: startDateIso
        });

        // 2. Rincian Sesi Kupon Pasien
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
            remaining_sessions: activeSessions,
            status: itemStatus
        });
    });

    // 9. Laporan Validasi Ringkasan
    const prodItemsCount = transactionItemPayloads.filter(i => i.item_type === 'product').length;
    const trItemsCount = transactionItemPayloads.filter(i => i.item_type === 'treatment').length;

    console.log('📊 RINGKASAN VALIDASI DATA:');
    console.log(`   - Pasien Siap Migrasi          : ${patientPayloads.length} pasien (${rawPatients.length} baris GD)`);
    console.log(`   - Transaksi Siap Migrasi       : ${transactionPayloads.length} baris`);
    console.log(`   - Rekam Medis (EMR) Siap       : ${treatmentRecordPayloads.length} baris (transaksi ber-tindakan klinis)`);
    console.log(`   - Total Item Transaksi Siap    : ${transactionItemPayloads.length} baris`);
    console.log(`     📦 Item Produk Skincare     : ${prodItemsCount} item (item_type: 'product')`);
    console.log(`     💉 Item Tindakan Klinis     : ${trItemsCount} item (item_type: 'treatment')`);
    console.log(`   - Rincian Item Tindakan EMR    : ${treatmentRecordItemPayloads.length} baris`);
    console.log(`   - Paket Kupon Siap Migrasi     : ${couponPayloads.length} paket (${totalSessionsCount} total sesi)`);
    console.log(`   - Paket Kupon Aktif            : ${activeCouponsCount} paket aktif (${activeSessionsCount} sisa sesi aktif)`);
    console.log(`   - Total Catatan Validasi       : ${validationErrors.length} baris\n`);

    if (isDryRun) {
        console.log('===============================================================');
        console.log('✅ DRY RUN SELESAI. Tidak ada data yang ditulis ke Supabase.');
        console.log('===============================================================');
        return;
    }

    // 10. Eksekusi Penulisan ke Database dalam Batch
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

    // 1. Pasien
    await batchInsert('patients', patientPayloads, 'Data Pasien');

    // 2. Treatment Records (EMR Header)
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

    // 11. Verifikasi Akhir
    console.log('\n🔍 Memverifikasi data tersimpan di Supabase...');
    const [
        { count: patCount },
        { count: txCount },
        { count: trCount },
        { count: txiCount },
        { count: prodCount },
        { count: treatCount },
        { count: triCount },
        { count: pcCount },
        { data: activeList }
    ] = await Promise.all([
        supabase.from('patients').select('*', { count: 'exact', head: true }).eq('branch_id', CIAMIS_BRANCH_ID),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('branch_id', CIAMIS_BRANCH_ID),
        supabase.from('treatment_records').select('*', { count: 'exact', head: true }).eq('branch_id', CIAMIS_BRANCH_ID),
        supabase.from('transaction_items').select('*', { count: 'exact', head: true }),
        supabase.from('transaction_items').select('*', { count: 'exact', head: true }).eq('item_type', 'product'),
        supabase.from('transaction_items').select('*', { count: 'exact', head: true }).eq('item_type', 'treatment'),
        supabase.from('treatment_record_items').select('*', { count: 'exact', head: true }),
        supabase.from('patient_coupons').select('*', { count: 'exact', head: true }),
        supabase.from('patient_coupons').select('id, patients(full_name), coupon_packages(name), patient_coupon_items(remaining_sessions, total_sessions)').eq('status', 'active')
    ]);

    console.log('\n===============================================================');
    console.log('🎉 MIGRASI GD CASHIER BERHASIL DISELESAIKAN 100%!');
    console.log('===============================================================');
    console.log(`📊 Hasil Akhir Database untuk Cabang Ayumi Ciamis:`);
    console.log(`   - Pasien Terdaftar      : ${patCount} pasien`);
    console.log(`   - Transaksi Penjualan    : ${txCount} transaksi`);
    console.log(`   - Riwayat Rekam Medis   : ${trCount} rekam medis`);
    console.log(`   - Total Item Transaksi  : ${txiCount} item`);
    console.log(`     📦 Produk Skincare    : ${prodCount} item (item_type: 'product')`);
    console.log(`     💉 Tindakan Klinis    : ${treatCount} item (item_type: 'treatment')`);
    console.log(`   - Item Rekam Medis      : ${triCount} item`);
    console.log(`   - Paket Kupon Pasien    : ${pcCount} paket (${activeCouponsCount} aktif)`);
    console.log('\n📌 Daftar Paket Kupon Aktif di Database:');
    (activeList || []).forEach((c, idx) => {
        const item = c.patient_coupon_items?.[0] || {};
        console.log(`   ${idx + 1}. ${c.patients?.full_name} | ${c.coupon_packages?.name} | Sisa: ${item.remaining_sessions}/${item.total_sessions} Sesi`);
    });
    console.log('===============================================================\n');
}

main().catch(err => {
    console.error('\n❌ Terjadi kesalahan fatal pada skrip migrasi:', err);
    process.exit(1);
});
