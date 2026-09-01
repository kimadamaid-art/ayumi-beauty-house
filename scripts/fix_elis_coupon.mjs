import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim()
const serviceKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim() || env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim()
const sb = createClient(url, serviceKey)

async function main() {
    const couponItemId = '64e2b0b5-42fc-4c5a-b947-1ffdb02c7520'
    const patientId = '1207a50c-cc9a-452c-961f-b80763247b13'
    const trxId = '85cf95ab-41be-47a8-b684-5f79d61aca01'
    const recordId = '297685e7-3574-4e34-9730-f087ca53fd0a'
    const branchId = '6bc44a26-f7f3-4ea7-8902-a2c48e27b598'
    const userId = 'e8bb0ec9-4da5-4b4b-a7fd-e65021c12216'

    // 1. Update patient_coupon_items to used_sessions = 1, remaining_sessions = 2
    const { data: uItem, error: eItem } = await sb
        .from('patient_coupon_items')
        .update({ used_sessions: 1, remaining_sessions: 2 })
        .eq('id', couponItemId)
        .select()
    console.log('1. UPDATE ITEM RESULT:', uItem, 'ERROR:', eItem)

    // 2. Insert coupon_usage_logs
    const { data: uLog, error: eLog } = await sb
        .from('coupon_usage_logs')
        .insert([{
            patient_coupon_item_id: couponItemId,
            patient_id: patientId,
            transaction_id: trxId,
            treatment_record_id: recordId,
            branch_id: branchId,
            used_by: userId,
            notes: 'Sesi 1 digunakan langsung saat pembelian paket di kasir (TRX-CMS-20260901-0004)'
        }])
        .select()
    console.log('2. INSERT LOG RESULT:', uLog, 'ERROR:', eLog)

    // 3. Update treatment_records linking
    const { data: rec } = await sb.from('treatment_records').select('result_notes').eq('id', recordId).single()
    const currentNotes = rec?.result_notes || ''
    const updatedNotes = currentNotes.includes('TRX-CMS-20260901-0004')
        ? currentNotes
        : `${currentNotes}\nNo. Struk: TRX-CMS-20260901-0004`

    const { data: uRec, error: eRec } = await sb
        .from('treatment_records')
        .update({ result_notes: updatedNotes })
        .eq('id', recordId)
        .select()
    console.log('3. UPDATE RECORD RESULT:', uRec, 'ERROR:', eRec)

    // 4. Update transactions.treatment_record_id
    const { data: uTrx, error: eTrx } = await sb
        .from('transactions')
        .update({ treatment_record_id: recordId })
        .eq('id', trxId)
        .select()
    console.log('4. UPDATE TRX RESULT:', uTrx, 'ERROR:', eTrx)
}

main()
