'use client'

import { useRef } from 'react'
import { getItemInitials, getProductVariants } from '@/lib/productVariants'

export default function HorizontalCategoryRow({
    categoryName,
    items = [],
    onItemClick
}) {
    const scrollContainerRef = useRef(null)

    if (!items || items.length === 0) return null

    const handleScroll = (direction) => {
        if (scrollContainerRef.current) {
            const scrollAmount = direction === 'left' ? -280 : 280
            scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
        }
    }

    // Curated harmonious Ayumi warm aesthetic palettes
    const getCategoryStyles = (catName) => {
        const name = (catName || '').toUpperCase()
        if (name.includes('BRIGHT')) {
            return {
                cardBg: 'bg-gradient-to-br from-[#E89360] via-[#D46221] to-[#914214]',
                border: 'border-[#F2D8C3] group-hover:border-[#D46221]',
                price: 'text-[#D46221]',
                glow: 'group-hover:shadow-[#D46221]/20'
            }
        }
        if (name.includes('ACNE')) {
            return {
                cardBg: 'bg-gradient-to-br from-[#2D6A4F] via-[#40916C] to-[#1B4332]',
                border: 'border-emerald-200 group-hover:border-emerald-500',
                price: 'text-[#2D6A4F]',
                glow: 'group-hover:shadow-emerald-900/20'
            }
        }
        if (name.includes('DEKORATIF')) {
            return {
                cardBg: 'bg-gradient-to-br from-[#8C3A5A] via-[#A84B6F] to-[#4E2A12]',
                border: 'border-rose-200 group-hover:border-rose-400',
                price: 'text-[#8C3A5A]',
                glow: 'group-hover:shadow-rose-900/20'
            }
        }
        // Default Ayumi Signature Terracotta
        return {
            cardBg: 'bg-gradient-to-br from-[#D46221] via-[#B5531B] to-[#4E2A12]',
            border: 'border-[#F2D8C3] group-hover:border-[#D46221]',
            price: 'text-[#D46221]',
            glow: 'group-hover:shadow-[#D46221]/20'
        }
    }

    const currentTheme = getCategoryStyles(categoryName)

    return (
        <div className="space-y-2 py-1">
            {/* Category Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#D46221]"></span>
                    <h3 className="font-black text-xs sm:text-sm text-[#4E2A12] tracking-wider uppercase">
                        {categoryName}
                    </h3>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FAF1E8] text-[#B5531B] border border-[#F2D8C3]">
                        {items.length}
                    </span>
                </div>

                {/* Left / Right Arrow Buttons */}
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => handleScroll('left')}
                        className="w-6 h-6 rounded-full bg-white border border-[#F2D8C3] shadow-2xs hover:bg-[#FAF1E8] flex items-center justify-center text-[#4E2A12] transition-colors cursor-pointer active:scale-95"
                        title="Geser ke kiri"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleScroll('right')}
                        className="w-6 h-6 rounded-full bg-white border border-[#F2D8C3] shadow-2xs hover:bg-[#FAF1E8] flex items-center justify-center text-[#4E2A12] transition-colors cursor-pointer active:scale-95"
                        title="Geser ke kanan"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            {/* Horizontal Cards Container */}
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
                            <div className={`w-full aspect-square rounded-2xl ${currentTheme.cardBg} text-white shadow-xs group-hover:shadow-md ${currentTheme.glow} group-hover:-translate-y-1 transition-all duration-200 flex flex-col items-center justify-center relative p-2 border border-white/20`}>
                                {/* Initials */}
                                <span className="text-xl sm:text-2xl font-black tracking-wider drop-shadow-xs">
                                    {initials}
                                </span>

                                {/* Top Badges */}
                                {variants.length > 0 && (
                                    <span className="absolute top-1.5 right-1.5 text-[8px] font-black bg-white/95 text-[#4E2A12] px-1.5 py-0.5 rounded-md shadow-2xs border border-white/80">
                                        {variants.length} Varian
                                    </span>
                                )}

                                {hasDiscount && (
                                    <span className="absolute top-1.5 left-1.5 text-[8px] font-black bg-[#D46221] text-white px-1.5 py-0.5 rounded-md shadow-2xs">
                                        -{item.discount_percent}%
                                    </span>
                                )}

                                {item.quantity !== undefined && (
                                    <span className={`absolute bottom-1.5 right-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-md backdrop-blur-xs ${
                                        item.quantity > 5 ? 'bg-black/35 text-white' : 'bg-red-500 text-white animate-pulse'
                                    }`}>
                                        Stok {item.quantity}
                                    </span>
                                )}
                            </div>

                            {/* Item Name & Price below */}
                            <div className="w-full text-center mt-1.5 px-0.5">
                                <h4 className="text-[11px] font-bold text-[#2C1E16] group-hover:text-[#D46221] transition-colors line-clamp-2 leading-tight min-h-[26px] flex items-center justify-center">
                                    {item.name}
                                </h4>

                                {variants.length > 0 ? (
                                    <div className="text-[10px] font-extrabold text-[#D46221] mt-0.5">
                                        Mulai Rp {Math.min(...variants.map(v => v.price)).toLocaleString('id-ID')}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-1 mt-0.5">
                                        {hasDiscount && (
                                            <span className="text-[9px] line-through text-gray-400 font-semibold">
                                                Rp {item.price?.toLocaleString('id-ID')}
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-black ${currentTheme.price}`}>
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
