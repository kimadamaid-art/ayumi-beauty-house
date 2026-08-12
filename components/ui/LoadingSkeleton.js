'use client'

/**
 * Reusable LoadingSkeleton component for smooth loading UX across modules.
 * Supports 'spinner', 'table', 'cards', and 'dashboard' layout types.
 */
export default function LoadingSkeleton({ type = 'spinner', rows = 5, cards = 4, className = '' }) {
    if (type === 'spinner') {
        return (
            <div className={`min-h-[200px] flex items-center justify-center ${className}`}>
                <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-ayumi-primary"></div>
            </div>
        )
    }

    if (type === 'cards') {
        return (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse ${className}`}>
                {Array.from({ length: cards }).map((_, i) => (
                    <div key={i} className="p-5 bg-white border border-gray-100 rounded-2xl space-y-3 shadow-sm">
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        <div className="h-7 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                    </div>
                ))}
            </div>
        )
    }

    if (type === 'table') {
        return (
            <div className={`bg-white border border-gray-100 rounded-2xl p-4 shadow-sm animate-pulse space-y-3 ${className}`}>
                <div className="h-8 bg-gray-100 rounded-xl w-full"></div>
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 py-2 border-b border-gray-50">
                        <div className="h-5 bg-gray-200 rounded w-12 shrink-0"></div>
                        <div className="h-5 bg-gray-200 rounded flex-1"></div>
                        <div className="h-5 bg-gray-200 rounded w-24 shrink-0"></div>
                        <div className="h-5 bg-gray-200 rounded w-20 shrink-0"></div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className={`space-y-6 animate-pulse ${className}`}>
            <div className="h-28 bg-gray-200 rounded-3xl w-full"></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="h-32 bg-gray-200 rounded-2xl"></div>
                <div className="h-32 bg-gray-200 rounded-2xl"></div>
                <div className="h-32 bg-gray-200 rounded-2xl"></div>
            </div>
        </div>
    )
}
