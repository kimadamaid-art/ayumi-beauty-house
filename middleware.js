import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

export async function middleware(request) {
    const isProd = process.env.NODE_ENV === 'production'

    // Robust & High-Compatibility CSP Header (Ensures Next.js static prerender & React hydration work flawlessly)
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      img-src 'self' data: blob: https://*.supabase.co;
      font-src 'self' https://fonts.gstatic.com;
      connect-src 'self' https://*.supabase.co wss://*.supabase.co;
      object-src 'none';
      base-uri 'self';
      frame-ancestors 'none';
    `.replace(/\s{2,}/g, ' ').trim()

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('Content-Security-Policy', cspHeader)

    let response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    })

    response.headers.set('Content-Security-Policy', cspHeader)

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
                        request: {
                            headers: requestHeaders,
                        },
                    })
                    response.headers.set('Content-Security-Policy', cspHeader)
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
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}
