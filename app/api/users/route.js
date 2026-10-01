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

        if (!email || !password || !full_name) {
            return NextResponse.json({ error: 'Nama lengkap, email, dan password wajib diisi.' }, { status: 400 })
        }

        const normalizedEmail = email.trim().toLowerCase()

        if (password.length < 8) {
            return NextResponse.json({ error: 'Password minimal harus 8 karakter.' }, { status: 400 })
        }

        const ALLOWED_ROLES = ['owner', 'admin', 'therapist']
        if (!role || !ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Validation Error: Role tidak valid. Pilihan yang diizinkan: owner, admin, therapist.' }, { status: 400 })
        }

        // Admin & terapis wajib punya cabang; tanpa cabang mereka tidak melihat data apa pun.
        if (role !== 'owner' && !branch_id) {
            return NextResponse.json({ error: 'Penempatan cabang wajib diisi untuk Admin dan Terapis.' }, { status: 400 })
        }

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
            email: normalizedEmail,
            password,
            email_confirm: true,
            user_metadata: {
                full_name
            }
        })

        if (authError) {
            const isDuplicate = authError.message?.toLowerCase().includes('already been registered') ||
                                authError.message?.toLowerCase().includes('already registered') ||
                                authError.message?.toLowerCase().includes('email address has already been registered')
            if (isDuplicate) {
                return NextResponse.json({ error: 'Email ini sudah terdaftar di sistem. Silakan gunakan email lain atau edit user yang bersangkutan.' }, { status: 400 })
            }
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
                email: normalizedEmail,
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

        // Record audit log to user_branch_assignments if assigned to a branch
        // Query Supabase tidak punya .catch(); hasilnya dicek lewat { error }. Catatan riwayat
        // ini pelengkap, jadi kegagalannya hanya dicatat dan tidak membatalkan penyimpanan user.
        if (branch_id && role !== 'owner') {
            const { error: assignErr } = await supabaseAdmin.from('user_branch_assignments').insert([{
                user_id: authData.user.id,
                branch_id: branch_id,
                assigned_at: new Date().toISOString(),
                assigned_by: user.id
            }])
            if (assignErr) console.warn('Audit assignment log error:', assignErr.message)
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
        
        if (id === user.id) {
            return NextResponse.json({ error: 'Anda tidak bisa menghapus akun Anda sendiri.' }, { status: 400 })
        }

        const { error: dbError } = await supabaseAdmin.from('users').delete().eq('id', id)
        if (dbError) {
            // Staf yang sudah tercatat di transaksi, rekam medis, atau log tidak bisa dihapus
            // tanpa merusak riwayat; arahkan owner untuk menonaktifkannya.
            if (dbError.code === '23503') {
                return NextResponse.json({ error: 'User ini sudah punya riwayat (transaksi, rekam medis, atau log), jadi tidak bisa dihapus. Nonaktifkan saja akunnya agar tidak bisa login.' }, { status: 409 })
            }
            throw dbError
        }

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

        const ALLOWED_ROLES = ['owner', 'admin', 'therapist']
        if (role && !ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Validation Error: Role tidak valid. Pilihan yang diizinkan: owner, admin, therapist.' }, { status: 400 })
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

        // Data lama dibaca dulu: semua validasi dilakukan sebelum ada yang diubah, agar
        // permintaan yang ditolak tidak sempat mengganti password atau email.
        const { data: existingUser, error: existingErr } = await supabaseAdmin
            .from('users').select('branch_id, role, is_active').eq('id', id).maybeSingle()
        if (existingErr) throw existingErr
        if (!existingUser) {
            return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 })
        }

        const currentRole = role !== undefined ? role : existingUser.role
        const targetBranchId = currentRole === 'owner' ? null : (branch_id !== undefined ? (branch_id || null) : existingUser.branch_id)

        // Owner tidak boleh mengunci dirinya sendiri dari sistem.
        if (id === user.id) {
            if (currentRole !== 'owner') {
                return NextResponse.json({ error: 'Anda tidak bisa mengubah role akun Anda sendiri. Minta owner lain untuk melakukannya.' }, { status: 400 })
            }
            if (is_active === false) {
                return NextResponse.json({ error: 'Anda tidak bisa menonaktifkan akun Anda sendiri.' }, { status: 400 })
            }
        }

        // Admin & terapis wajib punya cabang; tanpa cabang mereka tidak melihat data apa pun.
        // Hanya dicek bila role/cabang ikut diubah, agar user lama tanpa cabang tetap bisa
        // dinonaktifkan lewat tombol aktif/nonaktif.
        if ((role !== undefined || branch_id !== undefined) && currentRole !== 'owner' && !targetBranchId) {
            return NextResponse.json({ error: 'Penempatan cabang wajib diisi untuk Admin dan Terapis.' }, { status: 400 })
        }

        if (password && password.length < 8) {
            return NextResponse.json({ error: 'Password baru minimal harus 8 karakter.' }, { status: 400 })
        }

        // 1. Update auth.users if password, email, or full_name provided
        const authUpdates = {}
        if (password) authUpdates.password = password
        if (full_name !== undefined) authUpdates.user_metadata = { full_name }
        if (email !== undefined && email) {
            authUpdates.email = email.trim().toLowerCase()
            authUpdates.email_confirm = true
        }
        // Akun nonaktif diblokir di sistem login (ban), sehingga sesi yang sedang berjalan
        // tidak bisa diperpanjang. Dulu status nonaktif hanya dicek saat login.
        if (is_active === false) authUpdates.ban_duration = '876000h'
        if (is_active === true) authUpdates.ban_duration = 'none'

        if (Object.keys(authUpdates).length > 0) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates)
            if (authError) {
                const isDuplicate = authError.message?.toLowerCase().includes('already been registered') ||
                                    authError.message?.toLowerCase().includes('already registered')
                if (isDuplicate) {
                    return NextResponse.json({ error: 'Email ini sudah digunakan oleh akun lain.' }, { status: 400 })
                }
                throw authError
            }
        }

        // 2. Update public.users (dynamic fields to support partial updates)
        const dbUpdates = {
            updated_at: new Date().toISOString()
        }
        if (email !== undefined && email) dbUpdates.email = email.trim().toLowerCase()
        if (full_name !== undefined) dbUpdates.full_name = full_name
        if (phone !== undefined) dbUpdates.phone = phone || null
        if (role !== undefined) dbUpdates.role = role
        if (branch_id !== undefined || currentRole === 'owner') dbUpdates.branch_id = targetBranchId
        if (is_active !== undefined) dbUpdates.is_active = is_active

        const { error: dbError } = await supabaseAdmin
            .from('users')
            .update(dbUpdates)
            .eq('id', id)

        if (dbError) throw dbError

        // 3. Record audit log if branch assignment changed
        if (existingUser.branch_id !== targetBranchId && targetBranchId) {
            // Query Supabase tidak punya .catch() -- dulu memicu error "catch is not a function"
            // setelah data user sudah tersimpan. Riwayat penempatan ini pelengkap, jadi
            // kegagalannya hanya dicatat dan tidak menggagalkan perubahan cabang.
            // End previous assignment log if any
            const { error: endErr } = await supabaseAdmin
                .from('user_branch_assignments')
                .update({ ended_at: new Date().toISOString() })
                .eq('user_id', id)
                .is('ended_at', null)
            if (endErr) console.warn('Audit update error:', endErr.message)

            // Insert new assignment log
            const { error: insErr } = await supabaseAdmin.from('user_branch_assignments').insert([{
                user_id: id,
                branch_id: targetBranchId,
                assigned_at: new Date().toISOString(),
                assigned_by: user.id
            }])
            if (insErr) console.warn('Audit insert error:', insErr.message)
        }

        return NextResponse.json({ success: true })

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
