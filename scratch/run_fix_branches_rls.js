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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const sqlPath = path.join(__dirname, 'fix_branches_rls.sql')
const sqlContent = fs.readFileSync(sqlPath, 'utf8')

async function main() {
    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent })
    if (error) {
        console.error("Error executing SQL:", error)
        return
    }
    console.log("RLS policy applied successfully!")
}
main()
