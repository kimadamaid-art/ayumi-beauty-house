'use client'

/**
 * Reusable StatCard component for displaying key performance indicators (KPIs)
 * across Dashboard, Laporan, and Kasir modules.
 */
export default function StatCard({
    title,
    value,
    subtitle,
    icon,
    trend,
    trendType = 'up',
    badge,
    variant = 'primary',
    loading = false,
    className = ''
}) {
    const variantStyles = {
        primary: {
            bg: 'bg-white',
            border: 'border-pink-100/70',
            text: 'text-gray-900',
            titleText: 'text-gray-500',
            iconBg: 'bg-pink-100/70 text-ayumi-primary',
            badgeBg: 'bg-pink-50 text-ayumi-primary border-pink-100'
        },
        emerald: {
            bg: 'bg-white',
            border: 'border-emerald-100',
            text: 'text-emerald-700',
            titleText: 'text-emerald-600/80',
            iconBg: 'bg-emerald-100 text-emerald-600',
            badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200'
        },
        sky: {
            bg: 'bg-white',
            border: 'border-sky-100',
            text: 'text-sky-700',
            titleText: 'text-sky-600/80',
            iconBg: 'bg-sky-100 text-sky-600',
            badgeBg: 'bg-sky-50 text-sky-700 border-sky-200'
        },
        amber: {
            bg: 'bg-white',
            border: 'border-amber-100',
            text: 'text-amber-700',
            titleText: 'text-amber-600/80',
            iconBg: 'bg-amber-100 text-amber-600',
            badgeBg: 'bg-amber-50 text-amber-700 border-amber-200'
        },
        glass: {
            bg: 'bg-white/10 backdrop-blur-md',
            border: 'border-white/15',
            text: 'text-white',
            titleText: 'text-pink-100/80',
            iconBg: 'bg-white/20 text-white',
            badgeBg: 'bg-white/15 text-white border-white/20'
        }
    }

    const currentVariant = variantStyles[variant] || variantStyles.primary

    if (loading) {
        return (
            <div className={`p-5 rounded-2xl border ${currentVariant.bg} ${currentVariant.border} shadow-sm animate-pulse space-y-3 ${className}`}>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/3"></div>
            </div>
        )
    }

    return (
        <div className={`p-5 rounded-2xl border ${currentVariant.bg} ${currentVariant.border} shadow-sm hover:shadow-md transition-all space-y-2 relative overflow-hidden ${className}`}>
            <div className="flex items-center justify-between">
                <span className={`text-[10px] font-extrabold uppercase tracking-widest ${currentVariant.titleText}`}>
                    {title}
                </span>
                {icon && (
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${currentVariant.iconBg}`}>
                        {icon}
                    </div>
                )}
            </div>

            <div className="flex items-baseline justify-between gap-2">
                <h3 className={`text-xl sm:text-2xl font-extrabold tracking-tight ${currentVariant.text}`}>
                    {value}
                </h3>
                {trend && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 ${
                        trendType === 'up' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                        trendType === 'down' ? 'bg-red-50 text-red-600 border border-red-100' :
                        'bg-gray-50 text-gray-600 border border-gray-100'
                    }`}>
                        {trendType === 'up' && '↑'}
                        {trendType === 'down' && '↓'}
                        {trend}
                    </span>
                )}
            </div>

            {subtitle && (
                <p className={`text-[11px] font-medium ${variant === 'glass' ? 'text-pink-100/70' : 'text-gray-500'}`}>
                    {subtitle}
                </p>
            )}

            {badge && (
                <div className="pt-1">
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${currentVariant.badgeBg}`}>
                        {badge}
                    </span>
                </div>
            )}
        </div>
    )
}
