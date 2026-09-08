import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Penukaran sesi kupon.
//
// Endpoint ini memakai service role, sehingga menembus RLS. Karena itu ia HARUS
// memeriksa sendiri siapa pemanggilnya -- tanpa itu siapa pun di internet bisa
// menguras sesi kupon pelanggan. Proxy juga tidak menjaga /api/*, jadi tidak ada
// lapisan lain di depannya.
//
// Kupon hanya boleh ditukarkan admin dan owner. Terapis mencatat tindakan saja;
// penukaran kupon dilakukan admin di kasir.
const PERAN_BOLEH_MENUKAR = ['admin', 'owner']

export async function POST(request) {
    try {
        // 1. Pastikan pemanggil benar-benar sudah masuk.
        const cookieStore = await cookies()
        const supabaseAuth = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            )
                        } catch (error) {
                            // Diabaikan di API route
                        }
                    },
                },
            }
        )

        const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json(
                { error: 'Unauthorized: Sesi tidak ditemukan atau kedaluwarsa.' },
                { status: 401 }
            )
        }

        // 2. Pastikan perannya berhak menukarkan kupon.
        const { data: caller, error: callerErr } = await supabaseAuth
            .from('users')
            .select('id, role')
            .eq('id', user.id)
            .maybeSingle()

        if (callerErr || !caller) {
            return NextResponse.json(
                { error: 'Forbidden: Profil pengguna tidak ditemukan.' },
                { status: 403 }
            )
        }

        if (!PERAN_BOLEH_MENUKAR.includes(caller.role)) {
            return NextResponse.json(
                { error: 'Forbidden: Hanya admin atau owner yang dapat menukarkan kupon.' },
                { status: 403 }
            )
        }

        const body = await request.json()
        const {
            coupon_item_id,
            patient_id,
            quantity = 1,
            transaction_id,
            treatment_record_id,
            branch_id,
            notes
        } = body

        if (!coupon_item_id || !patient_id) {
            return NextResponse.json(
                { error: 'Data kupon tidak lengkap (coupon_item_id & patient_id wajib).' },
                { status: 400 }
            )
        }

        const qty = Number(quantity)
        if (!Number.isFinite(qty) || qty < 1) {
            return NextResponse.json(
                { error: 'Jumlah sesi yang ditukarkan minimal 1.' },
                { status: 400 }
            )
        }

        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceKey) {
            // Sebelumnya nilai ini jatuh ke kunci anon, yang lalu ditolak RLS dengan
            // pesan yang membingungkan. Lebih baik gagal terang-terangan di sini.
            return NextResponse.json(
                { error: 'SUPABASE_SERVICE_ROLE_KEY tidak terkonfigurasi di server.' },
                { status: 500 }
            )
        }

        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
            auth: { persistSession: false }
        })

        // 3. Ambil sesi kupon beserta kupon induknya.
        const { data: item, error: itemErr } = await supabase
            .from('patient_coupon_items')
            .select('*, patient_coupons(*)')
            .eq('id', coupon_item_id)
            .single()

        if (itemErr || !item) {
            return NextResponse.json(
                { error: 'Kupon tidak ditemukan: ' + (itemErr?.message || 'Item ID salah') },
                { status: 404 }
            )
        }

        const induk = item.patient_coupons

        // 4. Kupon harus milik pelanggan yang sedang dilayani.
        if (!induk || induk.patient_id !== patient_id) {
            return NextResponse.json(
                { error: 'Kupon ini bukan milik pelanggan yang dipilih.' },
                { status: 403 }
            )
        }

        if (induk.status !== 'active') {
            return NextResponse.json(
                { error: `Kupon sudah tidak aktif (status: ${induk.status}).` },
                { status: 400 }
            )
        }

        // 5. Status 'active' tidak pernah berubah sendiri saat masa berlaku habis,
        //    jadi tanggalnya wajib diperiksa terpisah.
        if (induk.expired_at && new Date(induk.expired_at) <= new Date()) {
            return NextResponse.json(
                {
                    error: 'Kupon sudah kedaluwarsa pada ' +
                        new Date(induk.expired_at).toLocaleDateString('id-ID') + '.'
                },
                { status: 400 }
            )
        }

        const currentRemaining = Number(item.remaining_sessions ?? item.total_sessions)
        const currentUsed = Number(item.used_sessions || 0)

        if (currentRemaining < qty) {
            return NextResponse.json(
                { error: `Sisa sesi tidak mencukupi. Tersedia: ${currentRemaining}, diminta: ${qty}.` },
                { status: 400 }
            )
        }

        const newUsed = currentUsed + qty
        const newRemaining = currentRemaining - qty
        const newStatus = newRemaining <= 0 ? 'fully_used' : 'active'

        // 6. Potong sesi. Syarat remaining_sessions tetap disertakan agar permintaan
        //    kedua yang membaca angka lama tidak ikut memotong: barisnya sudah berubah,
        //    sehingga update tidak mengenai apa pun dan kegagalannya terdeteksi.
        const { data: updatedItem, error: uErr } = await supabase
            .from('patient_coupon_items')
            .update({
                used_sessions: newUsed,
                remaining_sessions: newRemaining,
                status: newStatus
            })
            .eq('id', coupon_item_id)
            .eq('remaining_sessions', currentRemaining)
            .select()
            .maybeSingle()

        if (uErr) throw uErr

        if (!updatedItem) {
            return NextResponse.json(
                { error: 'Sisa sesi kupon baru saja berubah. Muat ulang halaman lalu ulangi.' },
                { status: 409 }
            )
        }

        // 7. Tandai kupon induk bila seluruh sesinya sudah habis.
        const { data: allItems } = await supabase
            .from('patient_coupon_items')
            .select('remaining_sessions, status')
            .eq('patient_coupon_id', item.patient_coupon_id)

        const allFinished = allItems?.every(
            it => Number(it.remaining_sessions) <= 0 || it.status === 'fully_used'
        )
        if (allFinished) {
            await supabase
                .from('patient_coupons')
                .update({ status: 'fully_used' })
                .eq('id', item.patient_coupon_id)
        }

        // 8. Catat pemakaian. used_by diambil dari sesi login, bukan dari body
        //    permintaan, supaya jejak audit tidak bisa dipalsukan pemanggil.
        const { data: logData, error: logErr } = await supabase
            .from('coupon_usage_logs')
            .insert([{
                patient_coupon_item_id: coupon_item_id,
                patient_id: patient_id,
                transaction_id: transaction_id || null,
                treatment_record_id: treatment_record_id || null,
                branch_id: branch_id || null,
                used_by: caller.id,
                notes: notes || 'Penukaran sesi kupon'
            }])
            .select()
            .single()

        if (logErr) {
            console.warn('Warning inserting coupon_usage_logs:', logErr)
        }

        // 9. Kaitkan transaksi dengan rekam medis. Transaksi wajib benar-benar milik
        //    pasien yang sama -- sebelumnya id transaksi dari pemanggil dipakai apa
        //    adanya, sehingga transaksi mana pun bisa dikait-kaitkan.
        if (treatment_record_id && transaction_id) {
            await supabase
                .from('transactions')
                .update({ treatment_record_id: treatment_record_id })
                .eq('id', transaction_id)
                .eq('patient_id', patient_id)
        }

        return NextResponse.json({
            success: true,
            used_sessions: newUsed,
            remaining_sessions: newRemaining,
            status: newStatus,
            item: updatedItem,
            log: logData
        })
    } catch (err) {
        console.error('Error in /api/coupons/redeem:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
