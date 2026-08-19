/**
 * Normalizes Indonesian and international mobile phone numbers to clean E.164 format (without +).
 * 
 * Rules:
 * 1. Strips all spaces, dashes, dots, parentheses, and leading '+'.
 * 2. If phone contains any non-digit character, returns null.
 * 3. Indonesian numbers:
 *    - '08xxx' (10-13 digits locally) -> '628xxx' (11-14 digits E.164)
 *    - '8xxx' (shorthand) -> '628xxx'
 *    - '628xxx' -> '628xxx'
 *    - '086412662' (9 digits locally) -> null (too short, not a valid Indonesian mobile number)
 *    - '6222xxx' (malformed Indonesian number) -> null
 * 4. International numbers (Option A):
 *    - Valid country code (starts with 1-9, not 0), 10-15 digits
 *    - e.g. '+65 9123 4567' -> '6591234567', '+60 12-345 6789' -> '60123456789'
 * 5. Returns normalized string on success, or null on invalid/malformed number.
 * 
 * @param {string|number} input 
 * @returns {string|null}
 */
export function normalizeIndonesianPhone(input) {
    if (!input && input !== 0) return null
    let raw = String(input).trim()
    if (!raw) return null

    const hasPlus = raw.startsWith('+')
    // Remove all whitespace, dashes, dots, parentheses, and '+'
    let str = raw.replace(/[\s\-\.\(\)\+]/g, '')

    // Must contain only digits
    if (!/^\d+$/.test(str)) return null

    // 1. If had leading '+', it is explicitly international E.164 format:
    if (hasPlus) {
        if (str.startsWith('62')) {
            if (/^628[0-9]{8,11}$/.test(str)) return str
            return null // Malformed Indonesian with '+'
        }
        // Valid international E.164 (10 to 15 digits)
        if (/^[1-9][0-9]{9,14}$/.test(str)) {
            return str
        }
        return null
    }

    // 2. Local Indonesian '08xxx' (10-13 digits locally -> 11-14 digits E.164)
    if (str.startsWith('08')) {
        str = '62' + str.substring(1)
        if (/^628[0-9]{8,11}$/.test(str)) return str
        return null // Too short (e.g. 086412662 is only 9 digits locally) or too long
    }

    // 3. Shorthand Indonesian '8xxx' without 0 (e.g. 85798835863)
    if (str.startsWith('8') && str.length >= 9 && str.length <= 12) {
        const with62 = '62' + str
        if (/^628[0-9]{8,11}$/.test(with62)) return with62
    }

    // 4. Already starts with '62'
    if (str.startsWith('62')) {
        if (/^628[0-9]{8,11}$/.test(str)) return str
        return null // e.g. 622216396386 malformed
    }

    // 5. Plain International without '+' (e.g. 6591234567, 60123456789)
    if (/^[1-9][0-9]{9,14}$/.test(str)) {
        return str
    }

    return null
}
