/**
 * Helper utilitas untuk Varian Produk & Kategori POS
 * Ayumi Beauty House
 */

export const DEFAULT_CATEGORY_ORDER = [
    'FACE TREATMENT',
    'BODY TREATMENT',
    'TREATMENT BASIC',
    'IPL ( Intense Pulsed Light )',
    'IPL & HAIR REMOVAL',
    'WAXING',
    'Ayumi Produk',
    'VIP',
    'VIP TREATMENT',
    'YUFADERMA ACNE',
    'YUFADERMA BRIGHT',
    'Dekoratif',
    'SKIN BOOSTER',
    'GENERAL / LAINNYA'
]

/**
 * Ekstraksi inisial nama item untuk kartu persegi POS (GD Cashier style)
 * Contoh: "Paket Yufaderma Acne Non Serum" -> "PS"
 *         "Overnight Pimple Care Cream" -> "OC"
 *         "Pimple Balancing Face Toner" -> "PT"
 *         "Refreshing Face Cleanser" -> "RC"
 *         "Mid-Night Brightening Cream" -> "MC"
 */
export function getItemInitials(name) {
    if (!name) return 'IT'
    const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim()
    const words = clean.split(/\s+/).filter(Boolean)

    if (words.length === 1) {
        return words[0].substring(0, 2).toUpperCase()
    }
    
    // Khusus nama yang diawali Paket... ambil inisial kata ke-1 & kata terakhir/kunci
    if (words[0].toLowerCase() === 'paket' && words.length > 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    }

    return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Ekstraksi kategori dari data produk / treatment
 */
export function getItemCategory(item, itemType = 'product') {
    if (!item) return 'GENERAL / LAINNYA'

    if (itemType === 'treatment') {
        return item.treatment_categories?.name || item.category_name || 'FACE TREATMENT'
    }

    if (itemType === 'coupon') {
        return item.category || 'PAKET KUPON'
    }

    // Product Category extraction
    const desc = item.description || ''
    const matchCat = desc.match(/Kategori:\s*([^|\[\]]+)/i)
    if (matchCat) {
        return matchCat[1].trim()
    }

    if (desc.includes('YUFADERMA ACNE')) return 'YUFADERMA ACNE'
    if (desc.includes('YUFADERMA BRIGHT')) return 'YUFADERMA BRIGHT'
    if (desc.includes('Ayumi Produk')) return 'Ayumi Produk'
    if (desc.includes('Dekoratif')) return 'Dekoratif'

    // Name-based inference for Yufaderma
    const nameLower = (item.name || '').toLowerCase()
    if (nameLower.includes('acne') || nameLower.includes('pimple')) return 'YUFADERMA ACNE'
    if (nameLower.includes('bright') || nameLower.includes('night') || nameLower.includes('toner') || nameLower.includes('cleanser')) return 'YUFADERMA BRIGHT'
    if (nameLower.includes('ayumi') || nameLower.includes('lotion')) return 'Ayumi Produk'
    if (nameLower.includes('cushion') || nameLower.includes('silky') || nameLower.includes('sunboom') || nameLower.includes('dekoratif')) return 'Dekoratif'

    return 'Ayumi Produk'
}

/**
 * Parse varian dari data produk
 * Format yang didukung:
 * 1. product.variants (jika sudah ada kolom array/json)
 * 2. product.description berisi tag [VARIANTS:[{"name":"...","price":123},...]]
 */
export function getProductVariants(product) {
    if (!product) return []

    // 1. Check direct variants array/json
    if (Array.isArray(product.variants) && product.variants.length > 0) {
        return product.variants.filter(v => v && v.name && v.price !== undefined)
    }

    // 2. Parse from description tag
    const desc = product.description || ''
    const match = desc.match(/\[VARIANTS:(\[.*?\])\]/)
    if (match) {
        try {
            const parsed = JSON.parse(match[1])
            if (Array.isArray(parsed)) {
                return parsed.map(v => ({
                    name: String(v.name || '').trim(),
                    price: Number(v.price || 0)
                })).filter(v => v.name && v.price >= 0)
            }
        } catch (e) {
            console.error('Error parsing product variants JSON:', e)
        }
    }

    return []
}

/**
 * Serialize varian dan kategori ke format description yang bersih
 */
export function formatProductDescription(category, plainDesc, variants = []) {
    let parts = []
    
    if (category) {
        parts.push(`Kategori: ${category.trim()}`)
    }
    
    if (plainDesc && plainDesc.trim()) {
        const cleaned = plainDesc.replace(/\[VARIANTS:\[.*?\]\]/g, '').replace(/Kategori:\s*[^|\[\]]+/gi, '').trim()
        if (cleaned) parts.push(cleaned)
    }

    if (Array.isArray(variants) && variants.length > 0) {
        const validVariants = variants
            .filter(v => v && v.name && v.name.trim())
            .map(v => ({ name: v.name.trim(), price: Number(v.price || 0) }))
        
        if (validVariants.length > 0) {
            parts.push(`[VARIANTS:${JSON.stringify(validVariants)}]`)
        }
    }

    return parts.join(' | ')
}
