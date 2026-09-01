/**
 * Utility functions for WhatsApp integration in Ayumi Beauty House
 */

export function formatWhatsAppNumber(phone) {
    if (!phone) return ''
    let cleaned = phone.toString().replace(/\D/g, '')
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1)
    } else if (cleaned.startsWith('8')) {
        cleaned = '62' + cleaned
    }
    return cleaned
}

export function getWhatsAppUrl(phone, text = '') {
    const cleanPhone = formatWhatsAppNumber(phone)
    if (!cleanPhone) return ''

    // If text contains %0A or URI encoding already, or is plain string
    let encodedText = ''
    if (text) {
        // If it's already encoded with %0A or contains encoded components, decode first to avoid double encoding
        try {
            const decoded = decodeURIComponent(text)
            encodedText = encodeURIComponent(decoded)
        } catch {
            encodedText = encodeURIComponent(text)
        }
    }

    // Detect if client-side and running on mobile device (Android, iOS, iPad, etc.)
    const isMobile = typeof window !== 'undefined' && typeof navigator !== 'undefined' && 
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    if (isMobile) {
        // On mobile, api.whatsapp.com opens the native WhatsApp app directly
        return `https://api.whatsapp.com/send?phone=${cleanPhone}${encodedText ? `&text=${encodedText}` : ''}`
    } else {
        // On desktop browser, web.whatsapp.com connects directly to the active WhatsApp Web session
        // without showing the wa.me "Continue to chat" intermediary page
        return `https://web.whatsapp.com/send?phone=${cleanPhone}${encodedText ? `&text=${encodedText}` : ''}`
    }
}

export function openWhatsApp(phone, text = '') {
    const url = getWhatsAppUrl(phone, text)
    if (!url) return false
    if (typeof window !== 'undefined') {
        // Gunakan target jendela bernama 'ayumi_whatsapp' agar tab WA yang sudah terbuka di browser
        // dapat digunakan kembali dan tidak membuka tab kosong baru terus-menerus
        const waWindow = window.open(url, 'ayumi_whatsapp')
        if (waWindow && typeof waWindow.focus === 'function') {
            try {
                waWindow.focus()
            } catch {
                // ignore cross-origin focus restriction
            }
        }
        return true
    }
    return false
}
