'use client'

import { usePathname } from 'next/navigation'
import GlobalSidebar from '@/components/GlobalSidebar'
import GlobalHeader from '@/components/GlobalHeader'

export default function ClientLayout({ children }) {
    const pathname = usePathname()
    const isLogin = pathname === '/login' || pathname === '/' // Assuming / redirects to login or is public

    if (isLogin) {
        return <>{children}</>
    }

    return (
        <div className="flex min-h-screen bg-ayumi-bg">
            <GlobalSidebar />
            <div className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
                <GlobalHeader />
                <main className="flex-1 overflow-y-auto relative">
                    {children}
                </main>
            </div>
        </div>
    )
}
