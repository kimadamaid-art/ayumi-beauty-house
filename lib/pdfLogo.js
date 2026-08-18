/**
 * Helper to fetch and convert /logo-ab.png to base64 Data URL for jsPDF integration
 */
let cachedLogoBase64 = null

export async function getLogoBase64() {
    if (cachedLogoBase64) return cachedLogoBase64

    if (typeof window === 'undefined') return null

    try {
        const response = await fetch('/logo-ab.png')
        if (!response.ok) return null
        const blob = await response.blob()
        
        return new Promise((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => {
                cachedLogoBase64 = reader.result
                resolve(reader.result)
            }
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(blob)
        })
    } catch (err) {
        console.error('Error loading logo for PDF export:', err)
        return null
    }
}
