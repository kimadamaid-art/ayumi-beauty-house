import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
    try {
        const body = await request.json()
        const {
            coupon_item_id,
            patient_id,
            quantity = 1,
            transaction_id,
            treatment_record_id,
            branch_id,
            used_by,
            notes
        } = body

        if (!coupon_item_id || !patient_id) {
            return NextResponse.json({ error: 'Data kupon tidak lengkap (coupon_item_id & patient_id wajib).' }, { status: 400 })
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false }
        })

        // 1. Fetch current coupon item
        const { data: item, error: itemErr } = await supabase
            .from('patient_coupon_items')
            .select('*, patient_coupons(*)')
            .eq('id', coupon_item_id)
            .single()

        if (itemErr || !item) {
            return NextResponse.json({ error: 'Kupon tidak ditemukan: ' + (itemErr?.message || 'Item ID salah') }, { status: 404 })
        }

        const currentRemaining = Number(item.remaining_sessions ?? item.total_sessions)
        const currentUsed = Number(item.used_sessions || 0)
        const newUsed = currentUsed + Number(quantity)
        const newRemaining = Math.max(0, currentRemaining - Number(quantity))
        const newStatus = newRemaining <= 0 ? 'fully_used' : 'active'

        // 2. Update patient_coupon_items
        const { data: updatedItem, error: uErr } = await supabase
            .from('patient_coupon_items')
            .update({
                used_sessions: newUsed,
                remaining_sessions: newRemaining,
                status: newStatus
            })
            .eq('id', coupon_item_id)
            .select()
            .single()

        if (uErr) throw uErr

        // 3. Check if all items in parent coupon are fully used
        const { data: allItems } = await supabase
            .from('patient_coupon_items')
            .select('remaining_sessions, status')
            .eq('patient_coupon_id', item.patient_coupon_id)

        const allFinished = allItems?.every(it => (Number(it.remaining_sessions) <= 0) || it.status === 'fully_used')
        if (allFinished) {
            await supabase
                .from('patient_coupons')
                .update({ status: 'fully_used' })
                .eq('id', item.patient_coupon_id)
        }

        // 4. Insert usage log
        const { data: logData, error: logErr } = await supabase
            .from('coupon_usage_logs')
            .insert([{
                patient_coupon_item_id: coupon_item_id,
                patient_id: patient_id,
                transaction_id: transaction_id || null,
                treatment_record_id: treatment_record_id || null,
                branch_id: branch_id || null,
                used_by: used_by || null,
                notes: notes || 'Penukaran sesi kupon'
            }])
            .select()
            .single()

        if (logErr) {
            console.warn('Warning inserting coupon_usage_logs:', logErr)
        }

        // 5. If treatment_record_id is provided, link transaction_id
        if (treatment_record_id && transaction_id) {
            await supabase
                .from('transactions')
                .update({ treatment_record_id: treatment_record_id })
                .eq('id', transaction_id)
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
