import { supabase } from '@/lib/supabaseClient'

let inMemoryUser = null
let inMemoryDbUser = null
let inMemoryAt = 0
let pendingPromise = null

// Profil disimpan paling lama 60 detik, baik di memori maupun sessionStorage. Dulu salinan
// di memori tidak pernah kedaluwarsa, sehingga user yang dipindah cabang/role oleh owner
// tetap memakai cabang lama sampai halaman dimuat ulang penuh.
const CACHE_TTL_MS = 60000

/**
 * Mendapatkan data pengguna auth dan profil database dengan caching cerdas.
 * Menghilangkan pemanggilan berulang ke auth server setiap kali berpindah halaman.
 */
export async function getCachedUser(forceRefresh = false) {
    if (!forceRefresh && inMemoryUser && inMemoryDbUser && (Date.now() - inMemoryAt) <= CACHE_TTL_MS) {
        return { user: inMemoryUser, dbUser: inMemoryDbUser }
    }

    // Ambil dari sessionStorage jika ada untuk kecepatan instan (0 milidetik), dengan TTL 60 detik
    if (!forceRefresh && typeof window !== 'undefined') {
        try {
            const rawUser = sessionStorage.getItem('ayumi_cached_user')
            const rawDbUser = sessionStorage.getItem('ayumi_cached_db_user')
            const cachedAt = sessionStorage.getItem('ayumi_cached_at')
            const isExpired = !cachedAt || (Date.now() - Number(cachedAt)) > CACHE_TTL_MS

            if (!isExpired && rawUser && rawDbUser) {
                inMemoryUser = JSON.parse(rawUser)
                inMemoryDbUser = JSON.parse(rawDbUser)
                inMemoryAt = Number(cachedAt)
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

            const fetchProfile = () => supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .maybeSingle()

            let { data: dbUser, error: profileErr } = await fetchProfile()
            if (!dbUser) {
                // Coba sekali lagi: gangguan koneksi sesaat tidak boleh langsung mengeluarkan user.
                await new Promise(resolve => setTimeout(resolve, 800))
                ;({ data: dbUser, error: profileErr } = await fetchProfile())
            }

            if (dbUser && dbUser.is_active === false) {
                // Akun dinonaktifkan owner saat user masih login: sesi diakhiri.
                clearUserCache()
                try {
                    await supabase.auth.signOut()
                } catch (e) {
                    // Tetap diarahkan ke login walau signOut gagal
                }
                if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                    window.location.replace('/login?reason=inactive')
                }
                return { user: null, dbUser: null }
            }

            if (!dbUser) {
                // Profil tidak terbaca: JANGAN dianggap owner (dulu fallback ke role 'owner', sehingga
                // tampilan owner bisa muncul di akun admin/terapis). Sesi diakhiri lalu diarahkan ke
                // login; sesi harus diakhiri lebih dulu karena proxy memantulkan sesi aktif dari
                // /login kembali ke /dashboard.
                console.error('Profil pengguna tidak terbaca:', profileErr?.message || 'data user tidak ditemukan')
                clearUserCache()
                try {
                    await supabase.auth.signOut()
                } catch (e) {
                    // Tetap diarahkan ke login walau signOut gagal
                }
                if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                    window.location.replace('/login?reason=profile')
                }
                return { user: null, dbUser: null }
            }

            const resolvedDbUser = dbUser
            inMemoryUser = user
            inMemoryDbUser = resolvedDbUser
            inMemoryAt = Date.now()

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
    inMemoryAt = 0
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.removeItem('ayumi_cached_user')
            sessionStorage.removeItem('ayumi_cached_db_user')
            sessionStorage.removeItem('ayumi_cached_at')
        } catch (e) {}
    }
}
