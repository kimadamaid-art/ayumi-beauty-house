import { supabase } from '@/lib/supabaseClient'

let inMemoryUser = null
let inMemoryDbUser = null
let pendingPromise = null

/**
 * Mendapatkan data pengguna auth dan profil database dengan caching cerdas.
 * Menghilangkan pemanggilan berulang ke auth server setiap kali berpindah halaman.
 */
export async function getCachedUser(forceRefresh = false) {
    if (!forceRefresh && inMemoryUser && inMemoryDbUser) {
        return { user: inMemoryUser, dbUser: inMemoryDbUser }
    }

    // Ambil dari sessionStorage jika ada untuk kecepatan instan (0 milidetik), dengan TTL 60 detik
    if (!forceRefresh && typeof window !== 'undefined') {
        try {
            const rawUser = sessionStorage.getItem('ayumi_cached_user')
            const rawDbUser = sessionStorage.getItem('ayumi_cached_db_user')
            const cachedAt = sessionStorage.getItem('ayumi_cached_at')
            const isExpired = !cachedAt || (Date.now() - Number(cachedAt)) > 60000 // 60 detik TTL

            if (!isExpired && rawUser && rawDbUser) {
                inMemoryUser = JSON.parse(rawUser)
                inMemoryDbUser = JSON.parse(rawDbUser)
                return { user: inMemoryUser, dbUser: inMemoryDbUser }
            }
        } catch (e) {
            // Ignore storage parse error
        }
    }

    // Gabungkan request serentak (deduplication) jika header, sidebar, dan halaman memanggil bersamaan
    if (pendingPromise && !forceRefresh) {
        return pendingPromise
    }

    pendingPromise = (async () => {
        try {
            const { data: { user }, error: authErr } = await supabase.auth.getUser()
            if (authErr || !user) {
                inMemoryUser = null
                inMemoryDbUser = null
                return { user: null, dbUser: null }
            }

            const { data: dbUser } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .maybeSingle()

            const resolvedDbUser = dbUser || { role: 'owner', id: user.id, full_name: user.email }
            inMemoryUser = user
            inMemoryDbUser = resolvedDbUser

            if (typeof window !== 'undefined') {
                try {
                    sessionStorage.setItem('ayumi_cached_user', JSON.stringify(user))
                    sessionStorage.setItem('ayumi_cached_db_user', JSON.stringify(resolvedDbUser))
                    sessionStorage.setItem('ayumi_cached_at', String(Date.now()))
                } catch (e) {
                    // Ignore storage quota error
                }
            }

            return { user, dbUser: resolvedDbUser }
        } catch (err) {
            console.error('Error in getCachedUser:', err)
            return { user: null, dbUser: null }
        } finally {
            pendingPromise = null
        }
    })()

    return pendingPromise
}

export function clearUserCache() {
    inMemoryUser = null
    inMemoryDbUser = null
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.removeItem('ayumi_cached_user')
            sessionStorage.removeItem('ayumi_cached_db_user')
            sessionStorage.removeItem('ayumi_cached_at')
        } catch (e) {}
    }
}
