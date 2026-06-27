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
    const { count, error } = await supabase.from('treatment_records').select('*', { count: 'exact', head: true });
    console.log('Total records:', count);

    const { count: countTherapist, error: err1 } = await supabase.from('treatment_records').select('*', { count: 'exact', head: true }).not('therapist_id', 'is', null);
    console.log('Records with therapist_id:', countTherapist);

    const { count: countPerformed, error: err2 } = await supabase.from('treatment_records').select('*', { count: 'exact', head: true }).not('performed_by', 'is', null);
    console.log('Records with performed_by:', countPerformed);
}
check();
