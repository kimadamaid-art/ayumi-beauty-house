'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { escapePostgrestFilter } from '@/lib/searchSanitizer'
import { normalizeIndonesianPhone } from '@/lib/phoneNormalization'

/**
 * Custom hook for server-side patient search with debounce,
 * input escaping, request sequence tracking (race-condition safe),
 * multi-format phone normalization, and global multi-branch query capability.
 * 
 * @param {Object} options
 * @param {number} [options.debounceMs=350]
 * @param {number} [options.minChars=2]
 * @param {number} [options.limit=20]
 */
export function usePatientSearch({ debounceMs = 350, minChars = 2, limit = 20 } = {}) {
    const [searchQuery, setSearchQuery] = useState('')
    const [results, setResults] = useState([])
    const [isSearching, setIsSearching] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)
    
    // Request sequence tracking to prevent out-of-order async race conditions
    const latestRequestIdRef = useRef(0)

    useEffect(() => {
        const trimmed = searchQuery.trim()

        if (trimmed.length < minChars) {
            setResults([])
            setIsSearching(false)
            setHasSearched(false)
            return
        }

        setIsSearching(true)
        const requestId = ++latestRequestIdRef.current

        const timer = setTimeout(async () => {
            try {
                const escapedRaw = escapePostgrestFilter(trimmed)
                const normalizedPhone = normalizeIndonesianPhone(trimmed)

                const orClauses = [
                    `full_name.ilike.${escapedRaw}`,
                    `whatsapp.ilike.${escapedRaw}`
                ]

                if (normalizedPhone) {
                    const escapedNormalized = escapePostgrestFilter(normalizedPhone)
                    if (escapedNormalized !== escapedRaw) {
                        orClauses.push(`whatsapp.ilike.${escapedNormalized}`)
                    }
                }

                // Server-side query across all patients (no branch filtering)
                const { data, error } = await supabase
                    .from('patients')
                    .select('id, full_name, whatsapp, branch_id, branches(name)')
                    .or(orClauses.join(','))
                    .order('full_name', { ascending: true })
                    .limit(limit)

                // Only update state if this is still the latest active request
                if (requestId === latestRequestIdRef.current) {
                    if (error) {
                        console.error('Patient search error:', error)
                        setResults([])
                    } else {
                        setResults(data || [])
                    }
                    setIsSearching(false)
                    setHasSearched(true)
                }
            } catch (err) {
                if (requestId === latestRequestIdRef.current) {
                    console.error('Patient search exception:', err)
                    setResults([])
                    setIsSearching(false)
                    setHasSearched(true)
                }
            }
        }, debounceMs)

        return () => clearTimeout(timer)
    }, [searchQuery, debounceMs, minChars, limit])

    const resetSearch = useCallback(() => {
        setSearchQuery('')
        setResults([])
        setIsSearching(false)
        setHasSearched(false)
        latestRequestIdRef.current++
    }, [])

    return {
        searchQuery,
        setSearchQuery,
        results,
        setResults,
        isSearching,
        hasSearched,
        resetSearch
    }
}
