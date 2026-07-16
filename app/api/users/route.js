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

        // 1. Ambil user terautentikasi
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Sesi tidak ditemukan atau kedaluwarsa.' }, { status: 401 })
        }

        // 2. Ambil role user dari tabel users
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (userError || !userData || userData.role !== 'owner') {
            return NextResponse.json({ error: 'Forbidden: Hanya Owner yang diizinkan melakukan tindakan ini.' }, { status: 403 })
        }

        const body = await request.json()
        const { email, password, full_name, phone, role, branch_id } = body

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        
        if (!serviceRoleKey) {
            return NextResponse.json(
                { error: 'SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local. Fitur pembuatan user diblokir sementara.' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        // 1. Create user in auth.users
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name
            }
        })

        if (authError) {
            return NextResponse.json({ error: authError.message }, { status: 400 })
        }

        // 2. Insert into public.users
        // Note: We might have a trigger that already creates the user in public.users (handle_new_user)
        // If we do, we should UPDATE the row instead of INSERT to avoid duplicate key errors.
        
        const { error: dbError } = await supabaseAdmin
            .from('users')
            .upsert({
                id: authData.user.id,
                auth_id: authData.user.id,
                email: email,
                full_name: full_name,
                phone: phone || null,
                role: role,
                branch_id: branch_id || null,
                is_active: true
            }, { onConflict: 'id' })

        if (dbError) {
            // Rollback auth user if public user fails
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
            return NextResponse.json({ error: dbError.message }, { status: 400 })
        }

        return NextResponse.json({ success: true, user: authData.user })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function DELETE(request) {
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

        // 1. Ambil user terautentikasi
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Sesi tidak ditemukan atau kedaluwarsa.' }, { status: 401 })
        }

        // 2. Ambil role user dari tabel users
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (userError || !userData || userData.role !== 'owner') {
            return NextResponse.json({ error: 'Forbidden: Hanya Owner yang diizinkan melakukan tindakan ini.' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json(
                { error: 'SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local.' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            {
                auth: { autoRefreshToken: false, persistSession: false }
            }
        )

        // Delete from auth.users (this will cascade to public.users if fk constraints are set up that way,
        // but let's delete from public.users explicitly just in case)
        
        const { error: dbError } = await supabaseAdmin.from('users').delete().eq('id', id)
        if (dbError) throw dbError

        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id)
        if (authError) throw authError

        return NextResponse.json({ success: true })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function PUT(request) {
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

        // 1. Ambil user terautentikasi
        const { data: { user }, error: userAuthError } = await supabase.auth.getUser()
        if (userAuthError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Sesi tidak ditemukan atau kedaluwarsa.' }, { status: 401 })
        }

        // 2. Ambil role user dari tabel users
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (userError || !userData || userData.role !== 'owner') {
            return NextResponse.json({ error: 'Forbidden: Hanya Owner yang diizinkan melakukan tindakan ini.' }, { status: 403 })
        }

        const body = await request.json()
        const { id, email, password, full_name, phone, role, branch_id, is_active } = body

        if (!id) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
        }

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!serviceRoleKey) {
            return NextResponse.json(
                { error: 'SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local.' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            serviceRoleKey,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // 1. Update auth.users if password, email, or full_name provided
        const authUpdates = {}
        if (password) authUpdates.password = password
        if (full_name) authUpdates.user_metadata = { full_name }
        if (email) {
            authUpdates.email = email
            authUpdates.email_confirm = true
        }

        if (Object.keys(authUpdates).length > 0) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates)
            if (authError) throw authError
        }

        // 2. Update public.users
        const { error: dbError } = await supabaseAdmin
            .from('users')
            .update({
                email: email || null,
                full_name,
                phone: phone || null,
                role,
                branch_id: role === 'owner' ? null : (branch_id || null),
                is_active,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)

        if (dbError) throw dbError

        return NextResponse.json({ success: true })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
