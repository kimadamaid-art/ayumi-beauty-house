const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env variables
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
envText.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('--- Checking notifications Table ---');
    const { data: notifData, error: notifErr } = await supabase.from('notifications').select('*').limit(1);
    if (notifErr) {
        console.error('notifications Table error:', notifErr.message);
    } else {
        console.log('notifications Table exists! Sample data:', notifData);
    }

    console.log('--- Checking appointments Columns ---');
    const { data: aptData, error: aptErr } = await supabase.from('appointments').select('id, arrival_status, arrived_at, therapist_ready_at').limit(1);
    if (aptErr) {
        console.error('appointments columns error:', aptErr.message);
    } else {
        console.log('appointments new columns exist! Sample data:', aptData);
    }
}

check();
