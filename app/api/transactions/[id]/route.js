import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function DELETE(request, { params }) {
    try {
        const { id } = await params
        if (!id) {
            return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 })
        }

        const cookieStore = await cookies()
        const supabase = createServerClient(
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
                            // Ignored in API routes
                        }
                    },
                },
            }
        )

        // 1. Authenticate user
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Sesi tidak valid atau kedaluwarsa.' }, { status: 401 })
        }

        // 2. Verify Owner Role
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (userError || !userData || userData.role !== 'owner') {
            return NextResponse.json({ error: 'Forbidden: Hanya akun Owner yang berhak menghapus transaksi secara permanen.' }, { status: 403 })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json(
                { error: 'SUPABASE_SERVICE_ROLE_KEY tidak terkonfigurasi di server.' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            {
                auth: { autoRefreshToken: false, persistSession: false }
            }
        )

        // 3. Fetch Transaction and Items
        const { data: tx, error: txError } = await supabaseAdmin
            .from('transactions')
            .select('*, transaction_items(*)')
            .eq('id', id)
            .maybeSingle()

        if (txError || !tx) {
            return NextResponse.json({ error: 'Transaksi tidak ditemukan.' }, { status: 404 })
        }

        // 4. Restore Product Stock if transaction was NOT already voided
        if (tx.payment_status !== 'void' && tx.transaction_items && tx.transaction_items.length > 0) {
            for (const item of tx.transaction_items) {
                if (item.item_type === 'product' && item.product_id && item.quantity > 0) {
                    // Fetch existing stock
                    const { data: currentStock } = await supabaseAdmin
                        .from('product_stock')
                        .select('id, quantity')
                        .eq('product_id', item.product_id)
                        .eq('branch_id', tx.branch_id)
                        .maybeSingle()

                    if (currentStock) {
                        await supabaseAdmin
                            .from('product_stock')
                            .update({
                                quantity: Number(currentStock.quantity || 0) + Number(item.quantity),
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', currentStock.id)
                    }
                }
            }
        }

        // 5. Handle any coupon purchases from this transaction
        const { data: boughtCoupons } = await supabaseAdmin
            .from('patient_coupons')
            .select('id')
            .eq('transaction_id', id)

        if (boughtCoupons && boughtCoupons.length > 0) {
            const couponIds = boughtCoupons.map(c => c.id)
            await supabaseAdmin.from('patient_coupon_items').delete().in('patient_coupon_id', couponIds)
            await supabaseAdmin.from('patient_coupons').delete().eq('transaction_id', id)
        }

        // 6. Handle any coupon usage logs tied to this transaction
        const { data: usageLogs } = await supabaseAdmin
            .from('coupon_usage_logs')
            .select('id, patient_coupon_item_id, voided_at')
            .eq('transaction_id', id)

        if (usageLogs && usageLogs.length > 0) {
            for (const log of usageLogs) {
                if (!log.voided_at && log.patient_coupon_item_id) {
                    const { data: item } = await supabaseAdmin
                        .from('patient_coupon_items')
                        .select('used_sessions, remaining_sessions')
                        .eq('id', log.patient_coupon_item_id)
                        .maybeSingle()

                    if (item) {
                        await supabaseAdmin
                            .from('patient_coupon_items')
                            .update({
                                used_sessions: Math.max(0, (item.used_sessions || 0) - 1),
                                remaining_sessions: (item.remaining_sessions || 0) + 1,
                                status: 'active'
                            })
                            .eq('id', log.patient_coupon_item_id)
                    }
                }
            }
            await supabaseAdmin.from('coupon_usage_logs').delete().eq('transaction_id', id)
        }

        // 7. Delete transaction_items
        const { error: delItemsErr } = await supabaseAdmin
            .from('transaction_items')
            .delete()
            .eq('transaction_id', id)

        if (delItemsErr) throw delItemsErr

        // 8. Delete audit_logs linked to this transaction
        await supabaseAdmin
            .from('audit_logs')
            .delete()
            .eq('record_id', id)
            .catch(e => console.warn('Audit logs cleanup error:', e.message))

        // 9. Delete the transaction record
        const { error: delTxErr } = await supabaseAdmin
            .from('transactions')
            .delete()
            .eq('id', id)

        if (delTxErr) throw delTxErr

        return NextResponse.json({
            success: true,
            message: `Transaksi ${tx.transaction_number} berhasil dihapus permanen.`
        })

    } catch (error) {
        console.error('Error in DELETE /api/transactions/[id]:', error)
        return NextResponse.json({ error: error.message || 'Terjadi kesalahan saat menghapus transaksi.' }, { status: 500 })
    }
}

export async function PATCH(request, { params }) {
    try {
        const { id } = await params
        if (!id) {
            return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 })
        }

        const body = await request.json()
        const { backdateDate, backdateTime } = body
        if (!backdateDate) {
            return NextResponse.json({ error: 'backdateDate is required' }, { status: 400 })
        }

        const cookieStore = await cookies()
        const supabase = createServerClient(
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
                        } catch (error) {}
                    },
                },
            }
        )

        // 1. Authenticate user
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Sesi tidak valid.' }, { status: 401 })
        }

        // 2. Verify Role (Admin or Owner)
        const { data: userData } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (!userData || (userData.role !== 'owner' && userData.role !== 'admin')) {
            return NextResponse.json({ error: 'Forbidden: Hanya Admin dan Owner yang dapat mengatur tanggal transaksi.' }, { status: 403 })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // 3. Fetch Transaction
        const { data: tx, error: txErr } = await supabaseAdmin
            .from('transactions')
            .select('*, branches(name, id)')
            .eq('id', id)
            .maybeSingle()

        if (txErr || !tx) {
            return NextResponse.json({ error: 'Transaksi tidak ditemukan.' }, { status: 404 })
        }

        const customIso = new Date(`${backdateDate}T${backdateTime || '12:00'}:00+07:00`).toISOString()
        const targetDateCompact = backdateDate.replace(/-/g, '') // e.g. 20260902

        // Determine new transaction number
        let newTrxNumber = tx.transaction_number
        if (tx.transaction_number && tx.transaction_number.startsWith('TRX-')) {
            const parts = tx.transaction_number.split('-') // ['TRX', 'CMS', '20260903', '0002']
            if (parts.length >= 4) {
                const branchCode = parts[1]
                const prefix = `TRX-${branchCode}-${targetDateCompact}-`
                const { data: existingOnDate } = await supabaseAdmin
                    .from('transactions')
                    .select('transaction_number')
                    .ilike('transaction_number', `${prefix}%`)
                    .order('transaction_number', { ascending: false })
                    .limit(1)

                let nextSeq = 1
                if (existingOnDate && existingOnDate.length > 0 && existingOnDate[0].transaction_number) {
                    const lastNumStr = existingOnDate[0].transaction_number.split('-').pop()
                    const lastNum = parseInt(lastNumStr, 10)
                    if (!isNaN(lastNum)) {
                        nextSeq = lastNum + 1
                    }
                }
                newTrxNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`
            }
        }

        // 4. Update Transaction
        const { data: updatedTx, error: updateTxErr } = await supabaseAdmin
            .from('transactions')
            .update({
                created_at: customIso,
                transaction_number: newTrxNumber
            })
            .eq('id', id)
            .select()
            .single()

        if (updateTxErr) throw updateTxErr

        // 5. Update linked treatment records
        if (tx.treatment_record_id) {
            await supabaseAdmin
                .from('treatment_records')
                .update({
                    treatment_date: backdateDate,
                    treatment_time: backdateTime || '12:00',
                    created_at: customIso
                })
                .eq('id', tx.treatment_record_id)
        }

        // 6. Update linked patient coupons & coupon items
        const { data: linkedCoupons } = await supabaseAdmin
            .from('patient_coupons')
            .update({ created_at: customIso })
            .eq('transaction_id', id)
            .select('id')

        if (linkedCoupons && linkedCoupons.length > 0) {
            const couponIds = linkedCoupons.map(c => c.id)
            await supabaseAdmin
                .from('patient_coupon_items')
                .update({ created_at: customIso })
                .in('patient_coupon_id', couponIds)
        }

        // 7. Update coupon usage logs
        await supabaseAdmin
            .from('coupon_usage_logs')
            .update({ used_at: customIso })
            .eq('transaction_id', id)

        return NextResponse.json({
            success: true,
            transaction: updatedTx
        })

    } catch (error) {
        console.error('Error in PATCH /api/transactions/[id]:', error)
        return NextResponse.json({ error: error.message || 'Terjadi kesalahan saat update backdate transaksi.' }, { status: 500 })
    }
}
