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

        // 2. Fetch caller role & branch_id
        const { data: caller, error: callerError } = await supabase
            .from('users')
            .select('id, role, branch_id')
            .eq('id', user.id)
            .maybeSingle()

        if (callerError || !caller) {
            return NextResponse.json({ error: 'User profil tidak ditemukan' }, { status: 403 })
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

        // 3. Role-based authorization filter
        let authorizedIds = ids
        if (caller.role === 'therapist') {
            // For therapists: verify that requested patient IDs are either assigned to this therapist or belong to therapist's branch
            const { data: validApts } = await supabaseAdmin
                .from('appointments')
                .select('patient_id')
                .in('patient_id', ids)
                .or(`therapist_id.eq.${user.id},branch_id.eq.${caller.branch_id}`)

            const { data: branchPatients } = await supabaseAdmin
                .from('patients')
                .select('id')
                .in('id', ids)
                .eq('branch_id', caller.branch_id)

            const validSet = new Set([
                ...(validApts?.map(a => a.patient_id) || []),
                ...(branchPatients?.map(p => p.id) || [])
            ])

            authorizedIds = ids.filter(id => validSet.has(id))
        }

        if (authorizedIds.length === 0) {
            return NextResponse.json({ patientsMap: {} })
        }

        // Query patients by authorized IDs (strictly excluding whatsapp for therapist privacy)
        const { data: patients, error: ptError } = await supabaseAdmin
            .from('patients')
            .select('id, full_name, gender, birth_date, allergies, medical_notes, notes')
            .in('id', authorizedIds)

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
