const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env variables
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
    const tables = ['coupon_packages', 'coupon_package_items', 'patient_coupons', 'patient_coupon_items', 'coupon_usage_logs'];
    for (const t of tables) {
        const { data, error } = await supabase.from(t).select('*').limit(1);
        if (error) {
            console.log(`Table ${t} does NOT exist or error:`, error.message);
        } else {
            console.log(`Table ${t} exists! Data:`, data);
        }
    }
}

check();
