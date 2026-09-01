'use client'

import { useState, useEffect } from 'react'
import { getProductVariants, getItemCategory } from '@/lib/productVariants'

export default function ItemVariantModal({
    isOpen,
    item,
    itemType = 'product',
    onClose,
    onConfirm
}) {
    const [quantity, setQuantity] = useState(1)
    const [selectedVariant, setSelectedVariant] = useState(null)
    const [discountType, setDiscountType] = useState('percent') // 'percent' | 'nominal'
    const [discountValue, setDiscountValue] = useState(0)

    const variants = item && itemType === 'product' ? getProductVariants(item) : []
    const hasVariants = variants.length > 0

    useEffect(() => {
        if (isOpen && item) {
            setQuantity(1)
            if (hasVariants) {
                setSelectedVariant(variants[0])
            } else {
                setSelectedVariant(null)
            }
            setDiscountType('percent')
            setDiscountValue(item.discount_percent || 0)
        }
    }, [isOpen, item])

    if (!isOpen || !item) return null

    const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(item.price || 0)
    const qty = Math.max(1, parseInt(quantity, 10) || 1)

    // Calculate subtotal
    const rawDisc = Number(discountValue) || 0
    let discountAmount = 0
    if (rawDisc > 0) {
        if (discountType === 'percent') {
            discountAmount = Math.round(basePrice * qty * (Math.min(100, Math.max(0, rawDisc)) / 100))
        } else {
            discountAmount = Math.min(basePrice * qty, rawDisc)
        }
    }
    const totalPrice = Math.max(0, (basePrice * qty) - discountAmount)

    const handleQuantityChange = (delta) => {
        const newQty = Math.max(1, qty + delta)
        if (itemType === 'product' && item.quantity !== undefined && newQty > item.quantity) {
            return
        }
        setQuantity(newQty)
    }

    const handleConfirm = () => {
        if (hasVariants && !selectedVariant) {
            return
        }
        onConfirm({
            item,
            itemType,
            quantity: qty,
            selectedVariant,
            discountType,
            discountValue: rawDisc,
            basePrice,
            totalPrice
        })
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all border border-[#F2D8C3]">
                {/* Header */}
                <div className="p-4 sm:p-5 border-b border-[#F2D8C3] flex items-center justify-between bg-[#FAF6F0]">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#B5531B] bg-[#FAF1E8] px-2 py-0.5 rounded-md border border-[#F2D8C3]">
                            {getItemCategory(item, itemType)}
                        </span>
                        <h3 className="text-base sm:text-lg font-black text-[#4E2A12] mt-1 line-clamp-1">
                            {item.name}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-700 flex items-center justify-center transition-colors cursor-pointer border border-[#F2D8C3]"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 sm:p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Quantity Stepper */}
                    <div className="flex flex-col items-center justify-center py-2">
                        <label className="text-xs font-bold text-gray-500 mb-2">Jumlah Kuantitas</label>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => handleQuantityChange(-1)}
                                disabled={qty <= 1}
                                className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-40 text-gray-700 font-black text-lg flex items-center justify-center transition-colors shadow-2xs cursor-pointer select-none"
                            >
                                -
                            </button>
                            <input
                                type="number"
                                min="1"
                                value={quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="w-16 h-10 text-center font-black text-lg border border-[#F2D8C3] rounded-xl focus:border-[#D46221] focus:ring-2 focus:ring-[#F2D8C3] outline-none text-[#2C1E16]"
                            />
                            <button
                                type="button"
                                onClick={() => handleQuantityChange(1)}
                                disabled={itemType === 'product' && item.quantity !== undefined && qty >= item.quantity}
                                className="w-10 h-10 rounded-xl bg-[#D46221] hover:bg-[#B5531B] active:bg-[#914214] disabled:opacity-40 text-white font-black text-lg flex items-center justify-center transition-colors shadow-xs cursor-pointer select-none"
                            >
                                +
                            </button>
                        </div>
                        {itemType === 'product' && item.quantity !== undefined && (
                            <span className="text-[10px] font-bold text-gray-400 mt-1">
                                Stok tersedia: {item.quantity} unit
                            </span>
                        )}
                    </div>

                    {/* Variant Selection Section */}
                    {hasVariants && (
                        <div className="space-y-2 pt-3 border-t border-gray-100">
                            <label className="block text-xs font-black text-[#4E2A12] uppercase tracking-wider">
                                Pilih Varian Produk
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {variants.map((v, idx) => {
                                    const isSelected = selectedVariant?.name === v.name
                                    return (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => setSelectedVariant(v)}
                                            className={`p-3 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                                                isSelected
                                                    ? 'bg-[#D46221] text-white border-[#D46221] shadow-sm ring-2 ring-[#F2D8C3]'
                                                    : 'bg-white text-gray-800 border-[#F2D8C3] hover:border-[#D46221] hover:bg-[#FAF1E8]/50'
                                            }`}
                                        >
                                            <span className={`text-xs font-black ${isSelected ? 'text-white' : 'text-[#2C1E16]'}`}>
                                                {v.name}
                                            </span>
                                            <span className={`text-xs font-bold mt-1 ${isSelected ? 'text-orange-100' : 'text-[#B5531B]'}`}>
                                                IDR {v.price.toLocaleString('id-ID')}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Custom Discount Section */}
                    <div className="space-y-2 pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-black text-[#4E2A12] uppercase tracking-wider">
                                Custom Discount
                            </label>
                            <div className="flex bg-gray-100 p-0.5 rounded-lg text-xs font-bold">
                                <button
                                    type="button"
                                    onClick={() => setDiscountType('percent')}
                                    className={`px-2 py-0.5 rounded-md transition-colors ${
                                        discountType === 'percent' ? 'bg-white text-gray-900 shadow-2xs font-black' : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    %
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDiscountType('nominal')}
                                    className={`px-2 py-0.5 rounded-md transition-colors ${
                                        discountType === 'nominal' ? 'bg-white text-gray-900 shadow-2xs font-black' : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    Rp
                                </button>
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                type="number"
                                min="0"
                                value={discountValue || ''}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                placeholder={discountType === 'percent' ? 'Contoh: 10 (%)' : 'Contoh: 20000 (Rp)'}
                                className="input-ayumi bg-white text-xs font-bold py-2 w-full focus:ring-[#F2D8C3] focus:border-[#D46221]"
                            />
                            {discountType === 'percent' && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">%</span>
                            )}
                        </div>
                    </div>

                    {/* Total Summary */}
                    <div className="p-3.5 bg-[#FAF6F0] rounded-xl border border-[#F2D8C3] flex items-center justify-between">
                        <div>
                            <span className="text-[11px] text-gray-500 block">Harga Dasar ({qty}x)</span>
                            <span className="text-xs font-bold text-[#4E2A12]">Rp {(basePrice * qty).toLocaleString('id-ID')}</span>
                        </div>
                        {discountAmount > 0 && (
                            <div className="text-right">
                                <span className="text-[11px] text-rose-500 block">Diskon</span>
                                <span className="text-xs font-bold text-rose-600">-Rp {discountAmount.toLocaleString('id-ID')}</span>
                            </div>
                        )}
                        <div className="text-right pl-2 border-l border-[#F2D8C3]">
                            <span className="text-[11px] text-gray-500 block font-semibold">Total</span>
                            <span className="text-sm font-black text-[#D46221]">
                                Rp {totalPrice.toLocaleString('id-ID')}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[#F2D8C3] flex gap-2 justify-end bg-[#FAF6F0]/60">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2.5 text-xs font-bold text-gray-600 bg-white hover:bg-gray-100 rounded-xl transition-colors cursor-pointer border border-gray-200"
                    >
                        Batal
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="px-5 py-2.5 text-xs font-black text-white bg-[#D46221] hover:bg-[#B5531B] rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                        <span>Tambah ke Keranjang</span>
                    </button>
                </div>
            </div>
        </div>
    )
}
