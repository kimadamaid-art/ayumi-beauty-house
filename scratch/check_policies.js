const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const env = {}
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const parts = line.split('=')
        if (parts.length >= 2) {
            env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/(^"|"$)/g, '').replace(/\r/g, '')
        }
    })
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, serviceRoleKey)

async function main() {
    const sql = `
        SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename IN ('users', 'patients', 'appointments', 'treatment_records', 'transactions', 'product_stock')
        ORDER BY tablename, policyname;
    `
    const { data, error } = await supabase.rpc('exec_sql', { sql })
    if (error) {
        console.error("RPC failed, try falling back to pg_policies view if exists", error)
        return
    }
    console.table(data)
}
main()
