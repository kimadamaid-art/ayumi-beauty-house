'use client'

import { useRef } from 'react'
import { getItemInitials, getProductVariants } from '@/lib/productVariants'

export default function HorizontalCategoryRow({
    categoryName,
    items = [],
    onItemClick,
    categoryTheme = 'sky'
}) {
    const scrollContainerRef = useRef(null)

    if (!items || items.length === 0) return null

    const handleScroll = (direction) => {
        if (scrollContainerRef.current) {
            const scrollAmount = direction === 'left' ? -280 : 280
            scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
        }
    }

    // Modern harmonious color palettes per category
    const themeStyles = {
        sky: {
            cardBg: 'bg-gradient-to-br from-sky-400 via-sky-500 to-blue-600',
            border: 'border-sky-200/60 group-hover:border-sky-400',
            badge: 'bg-sky-50 text-sky-700 border-sky-200',
            price: 'text-sky-700',
            glow: 'group-hover:shadow-sky-200/60'
        },
        teal: {
            cardBg: 'bg-gradient-to-br from-teal-400 via-emerald-500 to-cyan-600',
            border: 'border-teal-200/60 group-hover:border-teal-400',
            badge: 'bg-teal-50 text-teal-700 border-teal-200',
            price: 'text-teal-700',
            glow: 'group-hover:shadow-teal-200/60'
        },
        pink: {
            cardBg: 'bg-gradient-to-br from-pink-400 via-rose-500 to-red-500',
            border: 'border-pink-200/60 group-hover:border-pink-400',
            badge: 'bg-pink-50 text-pink-700 border-pink-200',
            price: 'text-rose-700',
            glow: 'group-hover:shadow-pink-200/60'
        },
        purple: {
            cardBg: 'bg-gradient-to-br from-purple-400 via-violet-500 to-indigo-600',
            border: 'border-purple-200/60 group-hover:border-purple-400',
            badge: 'bg-purple-50 text-purple-700 border-purple-200',
            price: 'text-purple-700',
            glow: 'group-hover:shadow-purple-200/60'
        }
    }

    const currentTheme = themeStyles[categoryTheme] || themeStyles.sky

    return (
        <div className="space-y-2 py-1">
            {/* Category Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-700"></span>
                    <h3 className="font-extrabold text-xs sm:text-sm text-gray-900 tracking-wider uppercase">
                        {categoryName}
                    </h3>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                        {items.length}
                    </span>
                </div>

                {/* Left / Right Arrow Buttons */}
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => handleScroll('left')}
                        className="w-6 h-6 rounded-full bg-white border border-gray-200 shadow-2xs hover:bg-gray-100 flex items-center justify-center text-gray-600 transition-colors cursor-pointer active:scale-95"
                        title="Geser ke kiri"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleScroll('right')}
                        className="w-6 h-6 rounded-full bg-white border border-gray-200 shadow-2xs hover:bg-gray-100 flex items-center justify-center text-gray-600 transition-colors cursor-pointer active:scale-95"
                        title="Geser ke kanan"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            {/* Horizontal Cards Container (No bulky scrollbar) */}
            <div
                ref={scrollContainerRef}
                className="flex items-start gap-2.5 sm:gap-3 overflow-x-auto pb-2 pt-1 px-1 scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {items.map((item) => {
                    const type = item.itemType || 'product'
                    const variants = getProductVariants(item)
                    const initials = getItemInitials(item.name)
                    const hasDiscount = item.discount_percent > 0
                    const effectivePrice = hasDiscount ? item.price * (1 - item.discount_percent / 100) : item.price

                    return (
                        <div
                            key={`${type}-${item.id}`}
                            onClick={() => onItemClick(item, type)}
                            className="w-24 sm:w-28 shrink-0 flex flex-col items-center cursor-pointer group select-none transition-all"
                        >
                            {/* Square Initial Card */}
                            <div className={`w-full aspect-square rounded-2xl ${currentTheme.cardBg} text-white shadow-sm group-hover:shadow-md ${currentTheme.glow} group-hover:-translate-y-1 transition-all duration-200 flex flex-col items-center justify-center relative p-2 border border-white/25`}>
                                {/* Initials */}
                                <span className="text-xl sm:text-2xl font-black tracking-wider drop-shadow-xs">
                                    {initials}
                                </span>

                                {/* Top Badges */}
                                {variants.length > 0 && (
                                    <span className="absolute top-1.5 right-1.5 text-[8px] font-black bg-white/95 text-slate-800 px-1.5 py-0.5 rounded-md shadow-2xs border border-white/80">
                                        {variants.length} Varian
                                    </span>
                                )}

                                {hasDiscount && (
                                    <span className="absolute top-1.5 left-1.5 text-[8px] font-black bg-rose-500 text-white px-1.5 py-0.5 rounded-md shadow-2xs">
                                        -{item.discount_percent}%
                                    </span>
                                )}

                                {item.quantity !== undefined && (
                                    <span className={`absolute bottom-1.5 right-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-md backdrop-blur-xs ${
                                        item.quantity > 5 ? 'bg-black/30 text-white' : 'bg-red-500 text-white animate-pulse'
                                    }`}>
                                        Stok {item.quantity}
                                    </span>
                                )}
                            </div>

                            {/* Item Name & Price below */}
                            <div className="w-full text-center mt-1.5 px-0.5">
                                <h4 className="text-[11px] font-bold text-gray-800 group-hover:text-sky-600 transition-colors line-clamp-2 leading-tight min-h-[26px] flex items-center justify-center">
                                    {item.name}
                                </h4>

                                {variants.length > 0 ? (
                                    <div className="text-[10px] font-extrabold text-sky-700 mt-0.5">
                                        Mulai Rp {Math.min(...variants.map(v => v.price)).toLocaleString('id-ID')}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-1 mt-0.5">
                                        {hasDiscount && (
                                            <span className="text-[9px] line-through text-gray-400 font-semibold">
                                                Rp {item.price?.toLocaleString('id-ID')}
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-extrabold ${currentTheme.price}`}>
                                            Rp {effectivePrice?.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
