import { supabase } from '@/lib/supabaseClient'
export { getCachedUser, clearUserCache } from '@/lib/cachedUser'

let inMemoryBranches = null
let pendingBranchesPromise = null

export const sortBranchesWithPangandaranLast = (branchList) => {
    if (!branchList || !Array.isArray(branchList)) return []
    return [...branchList].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase()
        const nameB = (b.name || '').toLowerCase()
        if (nameA.includes('pangandaran') && !nameB.includes('pangandaran')) return 1
        if (!nameA.includes('pangandaran') && nameB.includes('pangandaran')) return -1
        return (a.name || '').localeCompare(b.name || '')
    })
}

/**
 * Mengambil daftar cabang dengan in-memory dan sessionStorage caching.
 * Mengurangi network roundtrip berulang pada setiap modul/halaman.
 */
export async function getCachedBranches(forceRefresh = false) {
    if (!forceRefresh && inMemoryBranches && inMemoryBranches.length > 0) {
        return inMemoryBranches
    }

    if (!forceRefresh && typeof window !== 'undefined') {
        try {
            const rawBranches = sessionStorage.getItem('ayumi_cached_branches')
            const cachedAt = sessionStorage.getItem('ayumi_cached_branches_at')
            const isExpired = !cachedAt || (Date.now() - Number(cachedAt)) > 300000 // 5 menit TTL

            if (!isExpired && rawBranches) {
                const parsed = JSON.parse(rawBranches)
                if (Array.isArray(parsed) && parsed.length > 0) {
                    inMemoryBranches = parsed
                    return inMemoryBranches
                }
            }
        } catch (e) {
            // Ignore parse error
        }
    }

    if (pendingBranchesPromise && !forceRefresh) {
        return pendingBranchesPromise
    }

    pendingBranchesPromise = (async () => {
        try {
            const { data, error } = await supabase
                .from('branches')
                .select('id, name, monthly_target, is_active')
                .order('name', { ascending: true })

            if (error || !data) {
                return inMemoryBranches || []
            }

            const sorted = sortBranchesWithPangandaranLast(data)
            inMemoryBranches = sorted

            if (typeof window !== 'undefined') {
                try {
                    sessionStorage.setItem('ayumi_cached_branches', JSON.stringify(sorted))
                    sessionStorage.setItem('ayumi_cached_branches_at', Date.now().toString())
                } catch (e) {
                    // Ignore storage quota error
                }
            }

            return sorted
        } catch (err) {
            console.error('Error fetching cached branches:', err)
            return inMemoryBranches || []
        } finally {
            pendingBranchesPromise = null
        }
    })()

    return pendingBranchesPromise
}
