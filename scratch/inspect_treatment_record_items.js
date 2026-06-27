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

async function check() {
    const { data: recordsData, error: recordsError } = await supabase.from('treatment_records').select('*').limit(1);
    console.log('treatment_records row keys:', recordsData && recordsData.length > 0 ? Object.keys(recordsData[0]) : 'No rows yet', recordsError);
    if (recordsData && recordsData.length > 0) {
        console.log('treatment_records sample:', recordsData[0]);
    }

    const { data: itemsData, error: itemsError } = await supabase.from('treatment_record_items').select('*').limit(1);
    console.log('treatment_record_items row keys:', itemsData && itemsData.length > 0 ? Object.keys(itemsData[0]) : 'No rows yet', itemsError);
    if (itemsData && itemsData.length > 0) {
        console.log('treatment_record_items sample:', itemsData[0]);
    }
}
check();
