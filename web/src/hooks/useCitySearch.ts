/**
 * useCitySearch - 城市搜索防抖
 */

import { useState, useEffect, useRef } from 'react'
import { apiGet } from '../api'

interface UseCitySearchOptions {
    enabled: boolean
    query: string
    lang: 'zh' | 'en'
    debounceMs?: number
}

interface UseCitySearchResult {
    options: string[]
    loading: boolean
    clear: () => void
}

export function useCitySearch({
    enabled,
    query,
    lang,
    debounceMs = 250,
}: UseCitySearchOptions): UseCitySearchResult {
    const [options, setOptions] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const seqRef = useRef(0)

    useEffect(() => {
        if (!enabled) {
            setOptions([])
            seqRef.current = 0
            return
        }

        const trimmed = (query || '').trim()
        if (!trimmed) {
            setOptions([])
            return
        }

        const seq = ++seqRef.current
        setLoading(true)

        const timer = window.setTimeout(async () => {
            try {
                const res = await apiGet<{ results: Array<{ displayName: string }> }>(
                    `/api/widgets/geocode?${new URLSearchParams({ query: trimmed, lang }).toString()}`
                )

                if (seq !== seqRef.current) return

                const next = (res?.results || []).map((x) => x.displayName).filter(Boolean)
                setOptions(Array.from(new Set(next)).slice(0, 12))
            } catch {
                if (seq !== seqRef.current) return
                setOptions([])
            } finally {
                if (seq === seqRef.current) {
                    setLoading(false)
                }
            }
        }, debounceMs)

        return () => window.clearTimeout(timer)
    }, [enabled, query, lang, debounceMs])

    const clear = () => {
        setOptions([])
        seqRef.current = 0
    }

    return { options, loading, clear }
}
