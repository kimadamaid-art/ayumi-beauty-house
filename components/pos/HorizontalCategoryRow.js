'use client'

import { useRef } from 'react'
import { getItemInitials, getProductVariants } from '@/lib/productVariants'

export default function HorizontalCategoryRow({
    categoryName,
    items = [],
    onItemClick,
    categoryTheme = 'sky' // 'sky' | 'pink' | 'purple' | 'teal'
}) {
    const scrollContainerRef = useRef(null)

    if (!items || items.length === 0) return null

    const handleScroll = (direction) => {
        if (scrollContainerRef.current) {
            const scrollAmount = direction === 'left' ? -320 : 320
            scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
        }
    }

    // Theme color palettes
    const themeStyles = {
        sky: {
            cardBg: 'bg-gradient-to-br from-sky-400 to-sky-600',
            border: 'border-sky-200 hover:border-sky-400',
            pill: 'bg-sky-50 text-sky-700 border-sky-200',
            price: 'text-sky-950',
            btnHover: 'hover:bg-sky-50 text-sky-700'
        },
        pink: {
            cardBg: 'bg-gradient-to-br from-pink-500 to-rose-500',
            border: 'border-pink-200 hover:border-pink-400',
            pill: 'bg-pink-50 text-pink-700 border-pink-200',
            price: 'text-rose-950',
            btnHover: 'hover:bg-pink-50 text-pink-700'
        },
        purple: {
            cardBg: 'bg-gradient-to-br from-purple-500 to-indigo-600',
            border: 'border-purple-200 hover:border-purple-400',
            pill: 'bg-purple-50 text-purple-700 border-purple-200',
            price: 'text-purple-950',
            btnHover: 'hover:bg-purple-50 text-purple-700'
        },
        teal: {
            cardBg: 'bg-gradient-to-br from-teal-500 to-emerald-600',
            border: 'border-teal-200 hover:border-teal-400',
            pill: 'bg-teal-50 text-teal-700 border-teal-200',
            price: 'text-teal-950',
            btnHover: 'hover:bg-teal-50 text-teal-700'
        }
    }

    const currentTheme = themeStyles[categoryTheme] || themeStyles.sky

    return (
        <div className="space-y-2 py-1">
            {/* Category Header with Scroll Arrows */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-xs sm:text-sm text-gray-900 tracking-wider uppercase">
                        {categoryName}
                    </h3>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gray-200/80 text-gray-700">
                        {items.length}
                    </span>
                </div>

                {/* Left / Right Arrow Buttons */}
                <div className="flex items-center gap-1">
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

            {/* Horizontal Scrollable Cards Container */}
            <div
                ref={scrollContainerRef}
                className="flex items-start gap-2.5 sm:gap-3 overflow-x-auto custom-scrollbar pb-2.5 pt-1 px-1 scroll-smooth"
            >
                {items.map((item) => {
                    const type = item.itemType || (item.category_id !== undefined ? 'treatment' : item.total_sessions ? 'coupon' : 'product')
                    const variants = type === 'product' ? getProductVariants(item) : []
                    const initials = getItemInitials(item.name)
                    const hasDiscount = item.discount_percent > 0
                    const effectivePrice = hasDiscount ? item.price * (1 - item.discount_percent / 100) : item.price

                    return (
                        <div
                            key={`${type}-${item.id}`}
                            onClick={() => onItemClick(item, type)}
                            className={`w-28 sm:w-32 shrink-0 flex flex-col items-center cursor-pointer group select-none transition-all`}
                        >
                            {/* Square Initial Card (GD Cashier Style) */}
                            <div className={`w-full aspect-square rounded-2xl ${currentTheme.cardBg} text-white shadow-xs group-hover:shadow-md group-hover:scale-105 transition-all duration-200 flex flex-col items-center justify-center relative p-2 border border-white/20`}>
                                {/* Initials */}
                                <span className="text-2xl sm:text-3xl font-black tracking-wider drop-shadow-xs">
                                    {initials}
                                </span>

                                {/* Top Pill Badges */}
                                {variants.length > 0 && (
                                    <span className="absolute top-1.5 right-1.5 text-[8px] sm:text-[9px] font-black bg-white text-sky-900 px-1.5 py-0.5 rounded-md shadow-2xs">
                                        {variants.length} Varian
                                    </span>
                                )}

                                {hasDiscount && (
                                    <span className="absolute top-1.5 left-1.5 text-[8px] sm:text-[9px] font-black bg-rose-500 text-white px-1.5 py-0.5 rounded-md shadow-2xs">
                                        -{item.discount_percent}%
                                    </span>
                                )}

                                {type === 'product' && item.quantity !== undefined && (
                                    <span className={`absolute bottom-1.5 right-1.5 text-[8px] font-extrabold px-1 py-0.2 rounded ${
                                        item.quantity > 5 ? 'bg-black/25 text-white' : 'bg-red-500 text-white animate-pulse'
                                    }`}>
                                        Stok {item.quantity}
                                    </span>
                                )}
                            </div>

                            {/* Item Name & Price below */}
                            <div className="w-full text-center mt-1.5 px-0.5">
                                <h4 className="text-[11px] sm:text-xs font-bold text-gray-900 group-hover:text-sky-600 transition-colors line-clamp-2 leading-snug h-7 flex items-center justify-center">
                                    {item.name}
                                </h4>

                                {variants.length > 0 ? (
                                    <div className="text-[10px] sm:text-[11px] font-extrabold text-sky-700 mt-0.5">
                                        Mulai Rp {Math.min(...variants.map(v => v.price)).toLocaleString('id-ID')}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-1 mt-0.5">
                                        {hasDiscount && (
                                            <span className="text-[9px] line-through text-gray-400 font-semibold">
                                                Rp {item.price?.toLocaleString('id-ID')}
                                            </span>
                                        )}
                                        <span className={`text-[11px] font-black ${currentTheme.price}`}>
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
