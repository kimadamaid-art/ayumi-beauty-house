/**
 * Helper to escape and quote search terms for PostgREST .or() filters.
 * Prevents syntax injection caused by commas, parentheses, double quotes, and backslashes,
 * while preserving literal search for names with parentheses, titles, or commas.
 * Strips % and * wildcards so users cannot arbitrarily expand query scope.
 * 
 * @param {string} term 
 * @returns {string} Escaped and quoted string, e.g. `"%escaped_value%"`
 */
export function escapePostgrestFilter(term) {
    if (!term || typeof term !== 'string') return '""'
    // 1. Strip wildcard characters (% and *)
    const clean = term.replace(/[%*]/g, '')
    // 2. Escape backslashes (\ -> \\) and double quotes (" -> \")
    const escaped = clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    // 3. Wrap in double quotes with wildcards for ILIKE
    return `"%${escaped}%"`
}
