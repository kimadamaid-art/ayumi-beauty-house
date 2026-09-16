import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Inisialisasi Supabase dengan Service Role Key untuk menjamin penulisan notifikasi
// dapat diterima oleh admin dan owner tanpa terhalang batasan RLS users table
function getAdminSupabase() {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { persistSession: false }
    })
}

export async function POST(request) {
    try {
        const body = await request.json()
        const supabase = getAdminSupabase()

        // 1. Ambil daftar cabang untuk lookup nama jika perlu
        const { data: branches } = await supabase
            .from('branches')
            .select('id, name')

        const branchMap = {}
        if (branches) {
            branches.forEach(b => { branchMap[b.id] = b.name })
        }

        // 2. Ambil seluruh pengguna berhak (role owner dan admin aktif)
        const { data: staffUsers, error: uErr } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .in('role', ['admin', 'owner'])
            .eq('is_active', true)

        if (uErr || !staffUsers || staffUsers.length === 0) {
            console.error('Error fetching admin/owner users for low stock:', uErr)
            return NextResponse.json({ error: 'Tidak ada admin/owner aktif ditemukan' }, { status: 400 })
        }

        let itemsToCheck = []

        // Opsi A: Scan seluruh produk di database jika diminta action 'scan_all'
        if (body.action === 'scan_all') {
            // Ambil semua produk dan stoknya
            const { data: allStock } = await supabase
                .from('product_stock')
                .select('product_id, branch_id, quantity, products(id, name, is_active)')
                .lte('quantity', 5)

            if (allStock) {
                allStock.forEach(s => {
                    if (s.products && s.products.is_active !== false) {
                        itemsToCheck.push({
                            productId: s.product_id,
                            productName: s.products.name,
                            remainingStock: s.quantity,
                            branchId: s.branch_id,
                            branchName: branchMap[s.branch_id] || 'Klinik'
                        })
                    }
                })
            }
        } 
        // Opsi B: Batch items
        else if (Array.isArray(body.items)) {
            itemsToCheck = body.items
        } 
        // Opsi C: Single item
        else if (body.productId && body.remainingStock !== undefined) {
            itemsToCheck = [{
                productId: body.productId,
                productName: body.productName || 'Produk',
                variantName: body.variantName || null,
                remainingStock: body.remainingStock,
                branchId: body.branchId,
                branchName: body.branchName || branchMap[body.branchId] || 'Klinik'
            }]
        }

        if (itemsToCheck.length === 0) {
            return NextResponse.json({ success: true, message: 'Tidak ada item yang perlu diperiksa', processed: 0 })
        }

        let totalNotificationsSent = 0
        const senderId = body.senderId || null

        for (const item of itemsToCheck) {
            const stockQty = Number(item.remainingStock)
            // Hanya proses jika stok <= 5
            if (isNaN(stockQty) || stockQty > 5) continue

            const branchId = item.branchId
            const branchName = item.branchName || branchMap[branchId] || 'Klinik'
            const itemLabel = item.variantName ? `${item.productName} (${item.variantName})` : item.productName

            // Filter recipients:
            // - Role 'owner' selalu dapat notifikasi untuk seluruh cabang
            // - Role 'admin' dapat jika branch_id cocok atau admin global (branch_id null)
            const recipients = staffUsers.filter(u => {
                if (u.role === 'owner') return true
                return !u.branch_id || u.branch_id === branchId
            })

            if (recipients.length === 0) continue

            const isOutOfStock = stockQty <= 0
            const notifTitle = isOutOfStock
                ? `🚨 Stok Habis: ${itemLabel}`
                : `⚠️ Stok Menipis (Sisa ${stockQty}): ${itemLabel}`

            const notifMessage = isOutOfStock
                ? `Stok produk "${itemLabel}" di cabang ${branchName} telah HABIS (0 unit). Segera lakukan restok.`
                : `Stok produk "${itemLabel}" di cabang ${branchName} tersisa ${stockQty} unit (≤ 5). Segera persiapkan restok sebelum kehabisan.`

            for (const recipient of recipients) {
                // Deduplikasi cerdas:
                // Cek apakah ada notifikasi low_stock yang belum dibaca untuk produk ini
                const { data: existingNotifs } = await supabase
                    .from('notifications')
                    .select('id')
                    .eq('recipient_id', recipient.id)
                    .eq('type', 'low_stock')
                    .eq('is_read', false)
                    .ilike('message', `%${itemLabel}%`)
                    .limit(1)

                if (existingNotifs && existingNotifs.length > 0) {
                    // Update pesan dan waktu notifikasi yang belum dibaca agar selalu akurat
                    await supabase
                        .from('notifications')
                        .update({
                            title: notifTitle,
                            message: notifMessage,
                            created_at: new Date().toISOString()
                        })
                        .eq('id', existingNotifs[0].id)
                } else {
                    // Buat notifikasi baru
                    await supabase
                        .from('notifications')
                        .insert([{
                            recipient_id: recipient.id,
                            sender_id: senderId,
                            type: 'low_stock',
                            title: notifTitle,
                            message: notifMessage,
                            is_read: false
                        }])
                    totalNotificationsSent++
                }
            }
        }

        return NextResponse.json({
            success: true,
            processed: itemsToCheck.length,
            notificationsCreated: totalNotificationsSent
        })
    } catch (err) {
        console.error('Error in /api/notifications/low-stock:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
