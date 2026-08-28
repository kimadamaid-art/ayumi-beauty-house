import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

export async function proxy(request) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const isProd = process.env.NODE_ENV === 'production'

    // Clean up legacy Supabase project cookies if present
    if (request.cookies.has('sb-hrtgqpvfbksnycmtwijp-auth-token')) {
        response.cookies.delete('sb-hrtgqpvfbksnycmtwijp-auth-token')
    }

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    response = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, {
                            ...options,
                            sameSite: 'lax',
                            secure: isProd,
                            path: '/',
                        })
                    )
                },
            },
        }
    )

    const { data: { session } } = await supabase.auth.getSession()

    const url = request.nextUrl.clone()

    // Jika belum login, dan mencoba mengakses halaman selain login
    if (!session && url.pathname !== '/login') {
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Jika sudah login, dan mencoba mengakses halaman login
    if (session && url.pathname === '/login') {
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    return response
}

export const config = {
    matcher: [
        /*
         * Cocokkan semua request path kecuali untuk:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - static assets (.svg, .png, .jpg, .jpeg, .gif, .webp, .ico)
         */
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
