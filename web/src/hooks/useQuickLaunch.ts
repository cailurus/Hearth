import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { pinyin } from 'pinyin-pro'
import type { AppItem } from '../types'

// Cache pinyin conversions to avoid repeated computation
const pinyinCache = new Map<string, string>()

function toPinyin(text: string): string {
    const cached = pinyinCache.get(text)
    if (cached !== undefined) return cached
    // Full pinyin (no spaces, no tones) e.g. "百度" → "baidu"
    const full = pinyin(text, { toneType: 'none', type: 'array' }).join('')
    pinyinCache.set(text, full)
    return full
}

function toInitials(text: string): string {
    const key = `_init_${text}`
    const cached = pinyinCache.get(key)
    if (cached !== undefined) return cached
    // First letter of each character e.g. "百度" → "bd"
    const initials = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
    pinyinCache.set(key, initials)
    return initials
}

function fuzzyMatch(text: string, query: string): boolean {
    const q = query.toLowerCase()
    const lower = text.toLowerCase()
    // Direct substring match
    if (lower.includes(q)) return true
    // Pinyin full match: "baidu" matches "百度"
    if (toPinyin(text).includes(q)) return true
    // Pinyin initials match: "bd" matches "百度"
    if (toInitials(text).includes(q)) return true
    return false
}

function scoreMatch(item: AppItem, query: string): number {
    const q = query.toLowerCase()
    let score = 0
    const nameLower = item.name.toLowerCase()
    // Direct name match (highest priority)
    if (nameLower.startsWith(q)) score += 100
    else if (nameLower.includes(q)) score += 50
    // Pinyin match
    else if (toPinyin(item.name).startsWith(q)) score += 90
    else if (toPinyin(item.name).includes(q)) score += 40
    // Initials match
    else if (toInitials(item.name).startsWith(q)) score += 80
    else if (toInitials(item.name).includes(q)) score += 30
    if (item.description?.toLowerCase().includes(q)) score += 20
    if (item.url.toLowerCase().includes(q)) score += 10
    return score
}

export function useQuickLaunch(apps: AppItem[]) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const openRef = useRef(open)
    openRef.current = open
    const queryRef = useRef(query)
    queryRef.current = query

    const searchableApps = useMemo(
        () => apps.filter((a) => !a.url.startsWith('widget:')),
        [apps],
    )

    const results = useMemo(() => {
        if (!query.trim()) return searchableApps.slice(0, 8)
        return searchableApps
            .filter(
                (a) =>
                    fuzzyMatch(a.name, query) ||
                    fuzzyMatch(a.description || '', query) ||
                    fuzzyMatch(a.url, query),
            )
            .sort((a, b) => scoreMatch(b, query) - scoreMatch(a, query))
            .slice(0, 8)
    }, [searchableApps, query])

    useEffect(() => {
        setSelectedIndex(0)
    }, [results.length, query])

    // ESC logic: has content → clear input; empty → close overlay
    const handleEscape = useCallback(() => {
        if (queryRef.current.trim()) {
            setQuery('')
        } else {
            setOpen(false)
            setQuery('')
        }
    }, [])

    // Global: Cmd/Ctrl+K only. ESC is handled by the component's onKeyDown.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault()
                setOpen((prev) => !prev)
                setQuery('')
                setSelectedIndex(0)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [])

    const openOverlay = useCallback(() => {
        setOpen(true)
        setQuery('')
        setSelectedIndex(0)
    }, [])

    const closeOverlay = useCallback(() => {
        setOpen(false)
        setQuery('')
    }, [])

    const navigateUp = useCallback(() => {
        setSelectedIndex((prev) => Math.max(0, prev - 1))
    }, [])

    const navigateDown = useCallback(() => {
        setSelectedIndex((prev) => Math.min(results.length - 1, prev + 1))
    }, [results.length])

    const selectCurrent = useCallback(() => {
        if (results.length > 0 && selectedIndex < results.length) {
            window.open(results[selectedIndex].url, '_blank')
            setOpen(false)
            setQuery('')
        } else if (query.trim()) {
            window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank')
            setOpen(false)
            setQuery('')
        }
    }, [results, selectedIndex, query])

    return {
        open,
        query,
        setQuery,
        results,
        selectedIndex,
        setSelectedIndex,
        openOverlay,
        closeOverlay,
        handleEscape,
        navigateUp,
        navigateDown,
        selectCurrent,
    }
}
