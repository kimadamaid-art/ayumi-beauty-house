import { supabase } from '@/lib/supabaseClient'

// Katalog POS (tindakan, paket kupon, kategori, daftar terapis, dan daftar produk dasar)
// disimpan di memori selama TTL ini, supaya kasir yang berpindah ke halaman lain lalu
// kembali tidak menunggu lima query yang sama.
//
// TTL sengaja dibuat pendek: harga tindakan dan paket kupon ikut tersimpan di sini, dan
// harga di keranjang diambil dari data ini. Perubahan harga oleh owner baru terlihat di
// kasir paling lambat setelah TTL habis, atau seketika setelah halaman di-reload.
// Stok dan harga produk tidak bergantung pada cache ini -- keduanya tetap diambil
// langsung oleh fetchProducts() di halaman kasir.
const TTL_MS = 3 * 60 * 1000

let cached = null
let pending = null

export async function getCachedPosCatalog(forceRefresh = false) {
    if (!forceRefresh && cached && (Date.now() - cached.at) < TTL_MS) {
        return cached.data
    }

    if (pending && !forceRefresh) {
        return pending
    }

    pending = (async () => {
        try {
            // Query ini sama persis dengan yang sebelumnya dijalankan fetchInitialData
            // di app/kasir/page.js, agar isi dan urutan data tidak berubah.
            const [trRes, prodRes, cpRes, thRes, catRes] = await Promise.all([
                supabase.from('treatments').select('*, treatment_categories(id, name, sort_order)').eq('is_active', true).order('name', { ascending: true }),
                supabase.from('products').select('id, name, description, price, is_active').eq('is_active', true).order('name', { ascending: true }),
                supabase.from('coupon_packages').select('*').eq('is_active', true).order('name', { ascending: true }),
                supabase.from('users').select('id, full_name').eq('role', 'therapist').eq('is_active', true).order('full_name'),
                supabase.from('treatment_categories').select('*').eq('is_active', true).order('sort_order', { ascending: true })
            ])

            const data = {
                treatments: trRes.data || null,
                products: prodRes.data || null,
                couponPackages: cpRes.data || null,
                therapists: thRes.data || null,
                categories: catRes.data || null
            }

            // Hasil yang sebagian gagal tetap dikembalikan (halaman memakai yang berhasil,
            // seperti sebelumnya), tetapi tidak disimpan -- supaya kunjungan berikutnya
            // mencoba lagi alih-alih mewarisi katalog yang bolong.
            const allOk = !trRes.error && !prodRes.error && !cpRes.error && !thRes.error && !catRes.error
            if (allOk) {
                cached = { data, at: Date.now() }
            }

            return data
        } finally {
            pending = null
        }
    })()

    return pending
}

// Dipakai bila data katalog diketahui baru berubah di sesi yang sama.
export function invalidatePosCatalog() {
    cached = null
}
