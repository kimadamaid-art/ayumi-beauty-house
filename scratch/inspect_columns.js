const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
    const { data: logsData, error: logsError } = await supabase
        .from('coupon_usage_logs')
        .select('*')
        .limit(1);
    
    if (logsError) {
        console.error('Error fetching coupon_usage_logs:', logsError.message);
    } else {
        console.log('coupon_usage_logs row keys:', logsData.length > 0 ? Object.keys(logsData[0]) : 'No rows yet');
    }

    // Try a test insert with mock data to see if we get a schema error
    const testRow = {
        patient_coupon_item_id: null,
        patient_id: null,
        treatment_record_id: null,
        branch_id: null,
        notes: 'Test insert',
        patient_coupon_id: null
    };

    const { error: insertErr } = await supabase.from('coupon_usage_logs').insert([testRow]);
    console.log('Insert test with patient_coupon_id:', insertErr ? insertErr.message : 'SUCCESS');
}

inspect();
