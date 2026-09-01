import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request) {
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

        const { searchParams } = new URL(request.url)
        const patientId = searchParams.get('patientId')

        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
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
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // 3. Clinical Authorization Check for Therapists
        if (caller.role === 'therapist') {
            // Check if therapist has an appointment or treatment record or patient is in same branch
            const { data: apts } = await supabaseAdmin
                .from('appointments')
                .select('id')
                .eq('patient_id', patientId)
                .or(`therapist_id.eq.${user.id},branch_id.eq.${caller.branch_id}`)
                .limit(1)

            const { data: trs } = await supabaseAdmin
                .from('treatment_records')
                .select('id')
                .eq('patient_id', patientId)
                .or(`performed_by.eq.${user.id},branch_id.eq.${caller.branch_id}`)
                .limit(1)

            const { data: pt } = await supabaseAdmin
                .from('patients')
                .select('id')
                .eq('id', patientId)
                .eq('branch_id', caller.branch_id)
                .limit(1)

            const isAuthorized = (apts && apts.length > 0) || (trs && trs.length > 0) || (pt && pt.length > 0)
            if (!isAuthorized) {
                return NextResponse.json(
                    { error: 'Akses Ditolak: Anda tidak memiliki wewenang atau penugasan atas pasien ini.' },
                    { status: 403 }
                )
            }
        }

        // 4. Fetch Patient Info (without whatsapp)
        const { data: patient, error: pErr } = await supabaseAdmin
            .from('patients')
            .select('id, full_name, gender, birth_date, allergies, medical_notes, notes')
            .eq('id', patientId)
            .single()

        if (pErr || !patient) {
            return NextResponse.json({ error: 'Pasien tidak ditemukan' }, { status: 404 })
        }

        // 2. Fetch Treatment Records (SOAP)
        const { data: records } = await supabaseAdmin
            .from('treatment_records')
            .select(`
                id,
                treatment_date,
                treatment_time,
                complaints,
                skin_condition,
                result_notes,
                recommendation,
                branches (name),
                performer:users!treatment_records_performed_by_fkey (full_name),
                treatment_record_items (
                    id,
                    treatments (name)
                )
            `)
            .eq('patient_id', patientId)
            .order('treatment_date', { ascending: false })
            .order('treatment_time', { ascending: false })

        // 3. Fetch Patient Photos
        const { data: rawPhotos } = await supabaseAdmin
            .from('patient_photos')
            .select(`
                id,
                storage_path,
                photo_type,
                caption,
                created_at,
                treatment_record_id,
                treatment_records (
                    treatment_date,
                    branches (name)
                )
            `)
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })

        // Generate signed URLs for photos
        const photos = await Promise.all((rawPhotos || []).map(async (p) => {
            let fullUrl = null
            if (p.storage_path) {
                try {
                    const { data: signedData } = await supabaseAdmin.storage
                        .from('patient-photos')
                        .createSignedUrl(p.storage_path, 60 * 60)
                    if (signedData?.signedUrl) fullUrl = signedData.signedUrl
                } catch (e) {}

                if (!fullUrl) {
                    try {
                        const { data: pubData } = supabaseAdmin.storage
                            .from('patient-photos')
                            .getPublicUrl(p.storage_path)
                        if (pubData?.publicUrl) fullUrl = pubData.publicUrl
                    } catch (e) {}
                }
            }
            return {
                ...p,
                fullUrl: fullUrl || p.storage_path
            }
        }))

        // Attach photos to corresponding treatment records
        const recordsWithPhotos = (records || []).map(rec => ({
            ...rec,
            photos: photos.filter(p => p.treatment_record_id === rec.id)
        }))

        // 4. Fetch Active Coupons
        const { data: coupons } = await supabaseAdmin
            .from('patient_coupons')
            .select(`
                id,
                status,
                start_date,
                expiry_date,
                coupon_packages (name),
                patient_coupon_items (
                    id,
                    total_sessions,
                    used_sessions,
                    remaining_sessions,
                    status,
                    treatments (name)
                )
            `)
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })

        return NextResponse.json({
            patient,
            records: recordsWithPhotos || [],
            photos: photos || [],
            coupons: coupons || []
        })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
