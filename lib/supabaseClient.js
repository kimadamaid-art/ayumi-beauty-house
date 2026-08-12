import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

let browserClientInstance = null

/**
 * Returns a singleton instance of the Supabase browser client.
 * Mencegah pembuat instance Supabase client berulang kali pada setiap render React.
 */
export function getSupabaseBrowserClient() {
    if (typeof window === 'undefined') {
        return createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
    }

    if (!browserClientInstance) {
        browserClientInstance = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
    }

    return browserClientInstance
}

export const supabase = getSupabaseBrowserClient()
