const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

async function run() {
  const { data, error } = await supabase.from('patient_coupons').select('*').limit(1)
  console.log("Columns:", Object.keys(data[0] || {}))
  if (error) console.error(error)
}
run()
