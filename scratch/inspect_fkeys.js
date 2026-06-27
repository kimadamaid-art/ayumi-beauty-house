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
    // Let's try to query database structure if possible, or just see how both columns look in users.
    const { data: record, error } = await supabase.from('treatment_records').select(`
        id,
        performed_by,
        therapist_id,
        users!treatment_records_performed_by_fkey(id, full_name),
        therapist:users!treatment_records_therapist_id_fkey(id, full_name)
    `).limit(5);
    console.log('Fkeys structure check:', record, error);
}
check();
