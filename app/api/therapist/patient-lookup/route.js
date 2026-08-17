import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(request) {
    try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            )
                        } catch (error) {
                            // Ignored in API routes
                        }
                    },
                },
            }
        )

        // 1. Authenticate user
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { ids } = body

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ patientsMap: {} })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            {
                auth: { autoRefreshToken: false, persistSession: false }
            }
        )

        // Query patients by IDs (strictly excluding whatsapp for therapist privacy)
        const { data: patients, error: ptError } = await supabaseAdmin
            .from('patients')
            .select('id, full_name, gender, birth_date, allergies, medical_notes, notes')
            .in('id', ids)

        if (ptError) {
            return NextResponse.json({ error: ptError.message }, { status: 400 })
        }

        const patientsMap = {}
        if (patients) {
            patients.forEach(p => {
                patientsMap[p.id] = p
            })
        }

        return NextResponse.json({ patientsMap })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
