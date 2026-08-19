import { normalizeIndonesianPhone } from '../lib/phoneNormalization.js'

const testCases = [
    // Standard Indonesian numbers
    { input: '082216396386', expected: '6282216396386', desc: 'Local Indonesian 0822...' },
    { input: '085798835863', expected: '6285798835863', desc: 'Local Indonesian 0857...' },
    { input: '6285798835863', expected: '6285798835863', desc: 'Already normalized 62857...' },
    { input: '+62 857-9883-5863', expected: '6285798835863', desc: 'Formatted with +, spaces, and dashes' },
    { input: '85798835863', expected: '6285798835863', desc: 'Local without leading zero 857...' },
    { input: '(0812) 3456-7890', expected: '6281234567890', desc: 'Formatted with parentheses and dashes' },
    
    // Malformed / Invalid numbers (MUST RETURN NULL)
    { input: '086412662', expected: null, desc: 'Too short (9 digits 086412662)' },
    { input: '622216396386', expected: null, desc: 'Malformed conversion (6222... missing 8)' },
    { input: '628123456', expected: null, desc: 'Indonesian 9 digits total' },
    { input: '08123456789012345', expected: null, desc: 'Too long (> 15 digits)' },
    { input: '0211234567', expected: null, desc: 'Landline starting with 021' },
    { input: 'abcd', expected: null, desc: 'Non-numeric string' },
    { input: '', expected: null, desc: 'Empty string' },
    { input: null, expected: null, desc: 'null input' },
    { input: undefined, expected: null, desc: 'undefined input' },

    // International numbers (Option A: E.164 without +)
    { input: '+65 9123 4567', expected: '6591234567', desc: 'Singapore +65' },
    { input: '+60 12-345 6789', expected: '60123456789', desc: 'Malaysia +60' },
    { input: '+1 (415) 555-2671', expected: '14155552671', desc: 'US +1' },
    { input: '+81 90 1234 5678', expected: '819012345678', desc: 'Japan +81' },
    { input: '+61 412 345 678', expected: '61412345678', desc: 'Australia +61' }
]

console.log('=== RUNNING PHONE NORMALIZATION UNIT TESTS ===\n')

let passed = 0
let failed = 0

testCases.forEach((tc, idx) => {
    const result = normalizeIndonesianPhone(tc.input)
    const isOk = result === tc.expected
    if (isOk) {
        passed++
        console.log(`✓ [Test ${idx + 1}] ${tc.desc}: "${tc.input}" -> ${JSON.stringify(result)}`)
    } else {
        failed++
        console.error(`✗ [Test ${idx + 1} FAILED] ${tc.desc}: input "${tc.input}" -> got ${JSON.stringify(result)}, expected ${JSON.stringify(tc.expected)}`)
    }
})

console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`)

if (failed > 0) {
    process.exit(1)
}
