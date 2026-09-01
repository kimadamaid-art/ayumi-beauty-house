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

        // 1. Authenticate caller
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Sesi anda telah berakhir. Silakan login kembali.' }, { status: 401 })
        }

        // 2. Read Multipart FormData
        const formData = await request.formData()
        const file = formData.get('file')
        const patientId = formData.get('patientId')
        const recordId = formData.get('recordId')
        const slotKey = formData.get('slotKey') || 'foto_depan'
        const photoType = formData.get('photoType') || 'before'

        if (!file || !patientId || !recordId) {
            return NextResponse.json({ error: 'File, patientId, dan recordId wajib diisi' }, { status: 400 })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json({ error: 'Server configuration error (Service Role Key missing)' }, { status: 500 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // 3. Prepare File Buffer & Path
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        const ext = file.name?.split('.').pop() || 'webp'
        const filePath = `${patientId}/${recordId}/${slotKey}.${ext}`
        const mimeType = file.type || 'image/webp'

        // 4. Ensure bucket exists and is public
        const { error: uploadError } = await supabaseAdmin.storage
            .from('patient-photos')
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true
            })

        if (uploadError) {
            console.error('Storage admin upload error:', uploadError)
            return NextResponse.json({ error: `Gagal upload ke storage: ${uploadError.message}` }, { status: 500 })
        }

        // 5. Delete old metadata for this slot if exists
        await supabaseAdmin
            .from('patient_photos')
            .delete()
            .eq('treatment_record_id', recordId)
            .eq('caption', slotKey)

        // 6. Insert new photo metadata
        const photoMeta = {
            patient_id: patientId,
            treatment_record_id: recordId,
            photo_type: photoType,
            storage_path: filePath,
            caption: slotKey,
            uploaded_by: user.id
        }

        const { data: insertedPhoto, error: insertError } = await supabaseAdmin
            .from('patient_photos')
            .insert(photoMeta)
            .select()
            .single()

        if (insertError) {
            console.error('Insert patient_photos metadata error:', insertError)
            return NextResponse.json({ error: `Gagal simpan metadata foto: ${insertError.message}` }, { status: 500 })
        }

        // 7. Get Public URL
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('patient-photos')
            .getPublicUrl(filePath)

        return NextResponse.json({
            success: true,
            photo: insertedPhoto,
            publicUrl: publicUrlData?.publicUrl || null
        })

    } catch (error) {
        console.error('Exception in patient photo upload route:', error)
        return NextResponse.json({ error: error.message || 'Terjadi kesalahan saat mengunggah foto' }, { status: 500 })
    }
}
