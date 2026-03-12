/**
 * useWidgetEditor — 管理 EditItemDialog 所有状态与逻辑
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiPut } from '../api'
import type { AppItem, IconResolve } from '../types'
import {
    normalizeCountryCodes,
    widgetKindFromUrl,
    widgetQueryFromUrl,
    safeParseJSON,
    ensureFourMarketSymbols,
    DEFAULT_CLOCKS,
    DEFAULT_MARKET_SYMBOLS,
} from '../utils'
import { useCitySearch } from './useCitySearch'

type WidgetKind = 'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | 'docker' | 'notes' | 'rss' | 'currency' | 'deals' | null

interface UseWidgetEditorOptions {
    isAdmin: boolean
    lang: 'zh' | 'en'
    updateApp: (id: string, data: {
        groupId: string | null
        name: string
        description: string | null
        url: string
        iconPath: string | null
        iconSource: string | null
    }) => Promise<void>
    reload: () => Promise<void>
    openEditDialog: () => void
    closeEditDialog: () => void
    editDialogOpen: boolean
}

/**
 * Everything the EditItemDialog needs, plus `openEditItem` for callers.
 */
export interface WidgetEditorResult {
    // Dialog-level
    editErr: string | null
    editItem: AppItem | null
    // Core fields
    editName: string
    setEditName: (v: string) => void
    editDesc: string
    setEditDesc: (v: string) => void
    editUrl: string
    setEditUrl: (v: string) => void
    editIconMode: 'auto' | 'url' | 'lucide'
    setEditIconMode: (v: 'auto' | 'url' | 'lucide') => void
    editIconUrl: string
    setEditIconUrl: (v: string) => void
    editLucideIcon: string | null
    setEditLucideIcon: (v: string | null) => void
    iconResolving: boolean
    fetchingIcon: boolean
    fetchedIconPreview: string | null
    onFetchIcon: () => void
    saveItem: (e: FormEvent) => void
    // Widget kind
    widgetKind: WidgetKind
    onSaveWidget: () => Promise<void>
    widgetSaving: boolean
    // Weather
    wCity: string
    setWCity: (v: string) => void
    setCityQuery: (v: string) => void
    cityOptions: string[]
    // Metrics
    mRefreshSec: 1 | 5 | 10
    setMRefreshSec: (v: 1 | 5 | 10) => void
    mShowCpu: boolean
    setMShowCpu: (v: boolean) => void
    mShowMem: boolean
    setMShowMem: (v: boolean) => void
    mShowDisk: boolean
    setMShowDisk: (v: boolean) => void
    mShowNet: boolean
    setMShowNet: (v: boolean) => void
    // Markets
    mkSymbols: string[]
    setMkSymbols: React.Dispatch<React.SetStateAction<string[]>>
    mkQueries: string[]
    setMkQueries: React.Dispatch<React.SetStateAction<string[]>>
    ensureFourMarketSymbols: (raw: string[]) => string[]
    // Holidays
    hCountryCodes: string[]
    setHCountryCodes: (v: string[]) => void
    hCountryQuery: string
    setHCountryQuery: (v: string) => void
    // Timezones
    tzClocks: Array<{ city: string; timezone: string }>
    setTzClocks: React.Dispatch<React.SetStateAction<Array<{ city: string; timezone: string }>>>
    resolveCityToTimezoneEn: (city: string) => Promise<{ city: string; timezone: string }>
    // Docker
    dRefreshSec: 5 | 10 | 30
    setDRefreshSec: (v: 5 | 10 | 30) => void
    // RSS
    rssFeeds: string[]
    setRssFeeds: React.Dispatch<React.SetStateAction<string[]>>
    rssSize: 'normal' | 'tall'
    setRssSize: (v: 'normal' | 'tall') => void
    // Currency
    cPairs: string[]
    setCPairs: React.Dispatch<React.SetStateAction<string[]>>
    // Deals
    dlRegion: string
    setDlRegion: (v: string) => void
    // Opener
    openEditItem: (item: AppItem) => void
}

export function useWidgetEditor({
    isAdmin,
    lang,
    updateApp,
    reload,
    openEditDialog,
    closeEditDialog,
    editDialogOpen,
}: UseWidgetEditorOptions): WidgetEditorResult {
    // ── state ──────────────────────────────────────────────────────
    const [editErr, setEditErr] = useState<string | null>(null)
    const [editItem, setEditItem] = useState<AppItem | null>(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editUrl, setEditUrl] = useState('')
    const [editIconMode, setEditIconMode] = useState<'auto' | 'url' | 'lucide'>('auto')
    const [editIconUrl, setEditIconUrl] = useState('')
    const [editLucideIcon, setEditLucideIcon] = useState<string | null>(null)
    const [iconResolving, setIconResolving] = useState(false)
    const [widgetSaving] = useState(false)

    // Fetch-icon state (for "auto" mode manual refresh)
    const [fetchingIcon, setFetchingIcon] = useState(false)
    const [fetchedIconPreview, setFetchedIconPreview] = useState<string | null>(null)
    const [fetchedIconResult, setFetchedIconResult] = useState<{ iconPath: string | null; iconSource: string | null } | null>(null)
    const fetchIconSeqRef = useRef(0)

    const [widgetKind, setWidgetKind] = useState<WidgetKind>(null)
    const [wCity, setWCity] = useState('')
    const [cityQuery, setCityQuery] = useState('')

    const [mkSymbols, setMkSymbols] = useState<string[]>([...DEFAULT_MARKET_SYMBOLS])
    const [mkQueries, setMkQueries] = useState<string[]>([...DEFAULT_MARKET_SYMBOLS])
    const [hCountryCodes, setHCountryCodes] = useState<string[]>(['CN', 'US'])
    const [hCountryQuery, setHCountryQuery] = useState('')

    const [tzClocks, setTzClocks] = useState<Array<{ city: string; timezone: string }>>([...DEFAULT_CLOCKS])

    const [mShowCpu, setMShowCpu] = useState(true)
    const [mShowMem, setMShowMem] = useState(true)
    const [mShowDisk, setMShowDisk] = useState(true)
    const [mShowNet, setMShowNet] = useState(true)
    const [mRefreshSec, setMRefreshSec] = useState<1 | 5 | 10>(1)

    // Docker
    const [dRefreshSec, setDRefreshSec] = useState<5 | 10 | 30>(5)

    // RSS
    const [rssFeeds, setRssFeeds] = useState<string[]>([])
    const [rssSize, setRssSize] = useState<'normal' | 'tall'>('normal')

    // Currency
    const [cPairs, setCPairs] = useState<string[]>(['USD-CNY', 'EUR-JPY', 'GBP-USD', 'EUR-USD'])

    // Deals
    const [dlRegion, setDlRegion] = useState('us')

    // ── refs ───────────────────────────────────────────────────────
    const widgetLastSavedDescRef = useRef<string>('')
    const widgetAutoSaveTimerRef = useRef<number | null>(null)
    const widgetSaveSeqRef = useRef(0)
    const tzNormalizeSeqRef = useRef(0)
    const wNormalizeSeqRef = useRef(0)

    // ── city search ───────────────────────────────────────────────
    const citySearchLang = widgetKind === 'timezones' ? 'en' as const : lang
    const citySearch = useCitySearch({
        enabled: editDialogOpen && (widgetKind === 'weather' || widgetKind === 'timezones'),
        query: cityQuery,
        lang: citySearchLang,
    })

    // ── helpers ───────────────────────────────────────────────────
    const resolveCityToTimezone = useCallback(async (city: string) => {
        const res = await apiGet<{ timezone: string; city?: string }>(
            `/api/widgets/timezone?${new URLSearchParams({ city, lang }).toString()}`,
        )
        return {
            city: String(res.city || city).trim() || city,
            timezone: String(res.timezone || '').trim(),
        }
    }, [lang])

    const resolveCityToTimezoneEn = useCallback(async (city: string) => {
        const res = await apiGet<{ timezone: string; city?: string }>(
            `/api/widgets/timezone?${new URLSearchParams({ city, lang: 'en' }).toString()}`,
        )
        return {
            city: String(res.city || city).trim() || city,
            timezone: String(res.timezone || '').trim(),
        }
    }, [])

    // ── handleFetchIcon (manual icon refresh in auto mode) ────────
    const handleFetchIcon = useCallback(async () => {
        const trimmedUrl = editUrl.trim()
        if (!trimmedUrl) return

        const seq = ++fetchIconSeqRef.current
        setFetchingIcon(true)
        setFetchedIconPreview(null)
        setFetchedIconResult(null)

        try {
            const res = await apiPost<IconResolve>('/api/icon/resolve', { url: trimmedUrl, refresh: true })
            if (fetchIconSeqRef.current !== seq) return
            if (res.iconPath) {
                setFetchedIconPreview(`/assets/icons/${res.iconPath}`)
                setFetchedIconResult({ iconPath: res.iconPath, iconSource: res.iconSource })
            }
        } catch {
            // keep existing icon if resolve fails
        } finally {
            if (fetchIconSeqRef.current === seq) {
                setFetchingIcon(false)
            }
        }
    }, [editUrl])

    // ── openEditItem ──────────────────────────────────────────────
    const openEditItem = useCallback((item: AppItem) => {
        if (!isAdmin) return
        setEditErr(null)
        setEditItem(item)
        setEditName(item.name)
        setEditDesc(item.description ?? '')
        setEditUrl(item.url)

        // Initialize icon mode based on existing icon
        if (item.iconPath?.startsWith('lucide:')) {
            setEditLucideIcon(item.iconPath.slice('lucide:'.length))
            setEditIconMode('lucide')
            setEditIconUrl('')
        } else if (item.iconSource === 'url') {
            setEditLucideIcon(null)
            setEditIconMode('url')
            setEditIconUrl(item.iconPath ?? '')
        } else {
            setEditLucideIcon(null)
            setEditIconMode('auto')
            setEditIconUrl('')
        }
        setIconResolving(false)
        setFetchingIcon(false)
        setFetchedIconPreview(null)
        setFetchedIconResult(null)
        fetchIconSeqRef.current++

        const widgetType = widgetKindFromUrl(item.url)
        if (widgetType) {
            setWidgetKind(widgetType)
            const cfg = safeParseJSON(item.description)
            if (widgetType === 'weather') {
                const city = String(cfg?.city ?? '').trim()
                setWCity(city || 'Shanghai, Shanghai, China')
                setCityQuery(city || '')
            }
            if (widgetType === 'timezones') {
                const clocks = Array.isArray(cfg?.clocks) ? (cfg.clocks as unknown[]) : null
                if (clocks && clocks.length === 4) {
                    setTzClocks(
                        clocks.map((c, i) => ({
                            city:
                                String(
                                    (typeof c === 'object' && c !== null
                                        ? (c as Record<string, unknown>).city
                                        : undefined) ??
                                    '',
                                ).trim() || `City ${i + 1}`,
                            timezone:
                                String(
                                    (typeof c === 'object' && c !== null
                                        ? (c as Record<string, unknown>).timezone
                                        : undefined) ??
                                    '',
                                ).trim() || 'UTC',
                        })),
                    )
                } else {
                    setTzClocks([...DEFAULT_CLOCKS])
                }
                setCityQuery('')
            }
            if (widgetType === 'metrics') {
                setMShowCpu(cfg?.showCpu !== false)
                setMShowMem(cfg?.showMem !== false)
                setMShowDisk(cfg?.showDisk !== false)
                setMShowNet(cfg?.showNet !== false)
                const rs = Number(cfg?.refreshSec)
                setMRefreshSec(rs === 5 || rs === 10 ? rs : 1)
            }
            if (widgetType === 'markets') {
                const symbols = Array.isArray(cfg?.symbols) ? (cfg?.symbols as unknown[]) : null
                const next = ensureFourMarketSymbols(symbols || [])
                setMkSymbols(next)
                setMkQueries(next)
                setCityQuery('')
            }
            if (widgetType === 'holidays') {
                const countries = Array.isArray(cfg?.countries) ? (cfg?.countries as unknown[]) : null
                let norm = normalizeCountryCodes(countries ? countries.map((x) => String(x ?? '')) : [])
                if (norm.length === 0) {
                    const qp = widgetQueryFromUrl(item.url)
                    const raw = String(qp.get('countries') || qp.get('c') || '').trim()
                    if (raw) norm = normalizeCountryCodes(raw.split(/[,;\s]+/g).filter(Boolean))
                }
                setHCountryCodes(norm.length ? norm : ['CN', 'US'])
                setHCountryQuery('')
                setCityQuery('')
            }
            if (widgetType === 'docker') {
                const rs = Number(cfg?.refreshSec)
                setDRefreshSec(rs === 10 || rs === 30 ? rs as 10 | 30 : 5)
            }
            if (widgetType === 'currency') {
                const pairs = Array.isArray(cfg?.pairs) ? (cfg?.pairs as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : ['USD-CNY', 'EUR-CNY']
                setCPairs(pairs)
            }
            if (widgetType === 'deals') {
                setDlRegion(String(cfg?.region ?? 'us').trim())
            }
            if (widgetType === 'rss') {
                const feeds = Array.isArray(cfg?.feeds) ? (cfg?.feeds as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : []
                setRssFeeds(feeds)
                setRssSize(cfg?.size === 'tall' ? 'tall' : 'normal')
            }
        } else {
            setWidgetKind(null)
        }
        openEditDialog()
    }, [isAdmin, openEditDialog])

    // ── effects ───────────────────────────────────────────────────

    // Initialize widgetLastSavedDescRef when modal opens or item changes
    const editItemUrl = editItem?.url
    const editItemId = editItem?.id
    useEffect(() => {
        if (!editDialogOpen || !editItemUrl || !editItemUrl.startsWith('widget:')) return
        const desc = editItem?.description
        widgetLastSavedDescRef.current = String(desc ?? '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editDialogOpen, editItemId])

    // Weather city normalization on modal open
    useEffect(() => {
        if (!isAdmin) return
        if (!editDialogOpen || widgetKind !== 'weather') return

        const snapshot = String(wCity || '').trim()
        if (!snapshot) return

        const seq = ++wNormalizeSeqRef.current

        const run = async () => {
            try {
                const r = await resolveCityToTimezone(snapshot)
                if (wNormalizeSeqRef.current !== seq) return
                if (!editDialogOpen || widgetKind !== 'weather') return
                if (String(wCity || '').trim() !== snapshot) return
                if (r.city && r.city !== snapshot) setWCity(r.city)
            } catch {
                // ignore
            }
        }

        void run()
        // Only run when modal opens or the item changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, editDialogOpen, editItemId, widgetKind])

    // Timezone city normalization on modal open
    useEffect(() => {
        if (!isAdmin) return
        if (!editDialogOpen || widgetKind !== 'timezones') return

        const seq = ++tzNormalizeSeqRef.current
        const snapshot = tzClocks.slice(0, 4).map((c) => String(c.city || '').trim())

        const run = async () => {
            const resolved = await Promise.all(
                tzClocks.slice(0, 4).map(async (c, idx) => {
                    const fallbackCity = DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`
                    const fallbackTz = DEFAULT_CLOCKS[idx]?.timezone || 'UTC'
                    const tz = String(c.timezone ?? '').trim() || fallbackTz
                    const city = String(c.city ?? '').trim() || fallbackCity
                    try {
                        const r = await resolveCityToTimezoneEn(city)
                        return {
                            city: r.city,
                            timezone: r.timezone || tz,
                        }
                    } catch {
                        return {
                            city,
                            timezone: tz,
                        }
                    }
                }),
            )

            if (tzNormalizeSeqRef.current !== seq) return
            if (!editDialogOpen || widgetKind !== 'timezones') return
            const stillSame = tzClocks.slice(0, 4).every((c, i) => String(c.city || '').trim() === snapshot[i])
            if (!stillSame) return

            setTzClocks((prev) => {
                const next = prev.slice()
                for (let i = 0; i < 4 && i < resolved.length; i++) {
                    next[i] = { ...next[i], city: resolved[i].city, timezone: resolved[i].timezone }
                }
                return next
            })
        }

        void run()
        // Only run when modal opens or the item changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, editDialogOpen, editItemId, widgetKind])

    // Auto-save for metrics/holidays widgets
    useEffect(() => {
        if (!isAdmin) return
        if (!editDialogOpen || !editItem || !editItem.url.startsWith('widget:') || !widgetKind) return

        // Skip auto-save for weather, timezones, markets, and rss - they use manual save button
        if (widgetKind === 'weather' || widgetKind === 'timezones' || widgetKind === 'markets' || widgetKind === 'rss' || widgetKind === 'currency') return

        if (widgetAutoSaveTimerRef.current) window.clearTimeout(widgetAutoSaveTimerRef.current)

        widgetAutoSaveTimerRef.current = window.setTimeout(() => {
            const seq = ++widgetSaveSeqRef.current
            const itemId = editItem.id

            const run = async () => {
                let description: string | null = null
                try {
                    if (widgetKind === 'metrics') {
                        description = JSON.stringify({
                            showCpu: !!mShowCpu,
                            showMem: !!mShowMem,
                            showDisk: !!mShowDisk,
                            showNet: !!mShowNet,
                            refreshSec: mRefreshSec,
                        })
                    } else if (widgetKind === 'holidays') {
                        const countries = normalizeCountryCodes(hCountryCodes)
                        description = JSON.stringify({ countries })
                    } else if (widgetKind === 'docker') {
                        description = JSON.stringify({ refreshSec: dRefreshSec })
                    } else if (widgetKind === 'deals') {
                        description = JSON.stringify({ region: dlRegion })
                    }

                    if (description == null) return
                    if (description === widgetLastSavedDescRef.current) return

                    widgetLastSavedDescRef.current = description
                    await apiPut(`/api/apps/${itemId}`, {
                        groupId: editItem.groupId,
                        name: editItem.name,
                        description,
                        url: editItem.url,
                        iconPath: editItem.iconPath,
                        iconSource: editItem.iconSource,
                    })

                    if (widgetSaveSeqRef.current === seq) {
                        await reload()
                        setEditItem((prev) => (prev && prev.id === itemId ? { ...prev, description } : prev))
                    }
                } catch (e2) {
                    if (widgetSaveSeqRef.current === seq) {
                        setEditErr(e2 instanceof Error ? e2.message : 'failed')
                    }
                }
            }

            void run()
        }, 450)

        return () => {
            if (widgetAutoSaveTimerRef.current) window.clearTimeout(widgetAutoSaveTimerRef.current)
        }
    }, [
        isAdmin,
        editDialogOpen,
        editItem,
        widgetKind,
        mShowCpu,
        mShowMem,
        mShowDisk,
        mShowNet,
        mRefreshSec,
        hCountryCodes,
        dRefreshSec,
        dlRegion,
        reload,
    ])

    // ── handleSaveWidget (weather / timezones / markets) ──────────
    const handleSaveWidget = useCallback(async () => {
        if (!editItem || !widgetKind) return
        if (widgetKind !== 'weather' && widgetKind !== 'timezones' && widgetKind !== 'markets' && widgetKind !== 'rss' && widgetKind !== 'currency') return

        const snapshot = { ...editItem }
        const kind = widgetKind
        const citySnapshot = wCity
        const symbolsSnapshot = [...mkSymbols]
        const clocksSnapshot = tzClocks.map((c) => ({ ...c }))
        const cPairsSnapshot = [...cPairs]
        const rssFeedsSnapshot = [...rssFeeds]
        const rssSizeSnapshot = rssSize
        closeEditDialog()

        const itemId = snapshot.id

        try {
            let description: string | null = null

            if (kind === 'weather') {
                description = JSON.stringify({ city: citySnapshot.trim() })
            } else if (kind === 'markets') {
                const symbols = ensureFourMarketSymbols(symbolsSnapshot)
                description = JSON.stringify({ symbols })
            } else if (kind === 'timezones') {
                const next = clocksSnapshot.slice(0, 4)
                while (next.length < 4) next.push({ city: DEFAULT_CLOCKS[next.length]?.city || `City ${next.length + 1}`, timezone: '' })

                const resolved = await Promise.all(
                    next.map(async (c, idx) => {
                        const fallbackCity = DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`
                        const fallbackTz = DEFAULT_CLOCKS[idx]?.timezone || 'UTC'
                        const city = String(c.city ?? '').trim() || fallbackCity
                        try {
                            const res = await apiGet<{ timezone: string; city?: string }>(
                                `/api/widgets/timezone?${new URLSearchParams({ city, lang: 'en' }).toString()}`,
                            )
                            return {
                                city: String(res.city || city).trim() || city,
                                timezone: String(res.timezone || '').trim() || fallbackTz,
                            }
                        } catch {
                            return {
                                city,
                                timezone: String(c.timezone ?? '').trim() || fallbackTz,
                            }
                        }
                    }),
                )

                description = JSON.stringify({ clocks: resolved })
            } else if (kind === 'currency') {
                const pairs = cPairsSnapshot.map((p) => p.trim().toUpperCase()).filter(Boolean)
                description = JSON.stringify({ pairs })
            } else if (kind === 'rss') {
                const feeds = rssFeedsSnapshot.map((f) => f.trim()).filter(Boolean)
                description = JSON.stringify({ feeds, size: rssSizeSnapshot })
            }

            if (description == null) return

            await apiPut(`/api/apps/${itemId}`, {
                groupId: snapshot.groupId,
                name: snapshot.name,
                description,
                url: snapshot.url,
                iconPath: snapshot.iconPath,
                iconSource: snapshot.iconSource,
            })

            widgetLastSavedDescRef.current = description
            await reload()
        } catch {
            // Save failed silently; the dialog is already closed.
        }
    }, [editItem, widgetKind, wCity, mkSymbols, tzClocks, closeEditDialog, reload])

    // ── saveItem (form submit for non-widget or widget form) ──────
    const saveItem = useCallback(async (e: FormEvent) => {
        e.preventDefault()
        if (!isAdmin || !editItem) return
        setEditErr(null)

        const isWidget = editItem.url.startsWith('widget:')
        const name = isWidget ? editItem.name : editName.trim()
        if (!name) return

        const url = isWidget ? editItem.url : editUrl.trim()
        if (!url) return

        let description: string | null = null
        if (isWidget && widgetKind) {
            if (widgetKind === 'weather') {
                description = JSON.stringify({
                    city: wCity.trim(),
                })
            } else if (widgetKind === 'timezones') {
                const next = (Array.isArray(tzClocks) ? tzClocks : []).slice(0, 4)
                while (next.length < 4) next.push({ city: DEFAULT_CLOCKS[next.length]?.city || `City ${next.length + 1}`, timezone: '' })

                const resolved = await Promise.all(
                    next.map(async (c, idx) => {
                        const fallbackCity = DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`
                        const fallbackTz = DEFAULT_CLOCKS[idx]?.timezone || 'UTC'
                        const city = String(c.city ?? '').trim() || fallbackCity
                        try {
                            const res = await apiGet<{ timezone: string; city?: string }>(
                                `/api/widgets/timezone?${new URLSearchParams({ city, lang: 'en' }).toString()}`,
                            )
                            return {
                                city: String(res.city || city).trim() || city,
                                timezone: String(res.timezone || '').trim() || fallbackTz,
                            }
                        } catch {
                            return {
                                city,
                                timezone: String(c.timezone ?? '').trim() || fallbackTz,
                            }
                        }
                    }),
                )

                description = JSON.stringify({
                    clocks: resolved.map((c) => ({ city: c.city, timezone: c.timezone })),
                })
            } else if (widgetKind === 'metrics') {
                description = JSON.stringify({ showCpu: !!mShowCpu, showMem: !!mShowMem, showDisk: !!mShowDisk, showNet: !!mShowNet, refreshSec: mRefreshSec })
            }
        } else if (!isWidget) {
            description = editDesc || null
        }

        let iconPath: string | null = editItem.iconPath
        let iconSource: string | null = editItem.iconSource

        if (!isWidget) {
            if (editIconMode === 'lucide' && editLucideIcon) {
                iconPath = `lucide:${editLucideIcon}`
                iconSource = 'lucide'
            } else {
                setIconResolving(true)
                try {
                    if (editIconMode === 'auto') {
                        if (fetchedIconResult) {
                            iconPath = fetchedIconResult.iconPath
                            iconSource = fetchedIconResult.iconSource
                        } else {
                            const res = await apiPost<IconResolve>('/api/icon/resolve', { url, refresh: true })
                            iconPath = res.iconPath || null
                            iconSource = res.iconSource || null
                        }
                    } else if (editIconMode === 'url' && editIconUrl.trim()) {
                        iconPath = editIconUrl.trim()
                        iconSource = 'url'
                    }
                } catch {
                    // keep existing icon if resolve fails
                } finally {
                    setIconResolving(false)
                }
            }
        }

        try {
            await updateApp(editItem.id, {
                groupId: editItem.groupId,
                name,
                description,
                url,
                iconPath,
                iconSource,
            })
            closeEditDialog()
            setEditItem(null)
        } catch (e2) {
            setEditErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }, [isAdmin, editItem, editName, editDesc, editUrl, editIconMode, editIconUrl, editLucideIcon, fetchedIconResult, widgetKind, wCity, tzClocks, mShowCpu, mShowMem, mShowDisk, mShowNet, mRefreshSec, updateApp, closeEditDialog])

    // ── return ────────────────────────────────────────────────────
    return {
        editErr,
        editItem,
        editName,
        setEditName,
        editDesc,
        setEditDesc,
        editUrl,
        setEditUrl,
        editIconMode,
        setEditIconMode,
        editIconUrl,
        setEditIconUrl,
        editLucideIcon,
        setEditLucideIcon,
        iconResolving,
        fetchingIcon,
        fetchedIconPreview,
        onFetchIcon: handleFetchIcon,
        saveItem,
        widgetKind,
        onSaveWidget: handleSaveWidget,
        widgetSaving,
        wCity,
        setWCity,
        setCityQuery,
        cityOptions: citySearch.options,
        mRefreshSec,
        setMRefreshSec,
        mShowCpu,
        setMShowCpu,
        mShowMem,
        setMShowMem,
        mShowDisk,
        setMShowDisk,
        mShowNet,
        setMShowNet,
        mkSymbols,
        setMkSymbols,
        mkQueries,
        setMkQueries,
        ensureFourMarketSymbols,
        hCountryCodes,
        setHCountryCodes,
        hCountryQuery,
        setHCountryQuery,
        tzClocks,
        setTzClocks,
        resolveCityToTimezoneEn,
        dRefreshSec,
        setDRefreshSec,
        rssFeeds,
        setRssFeeds,
        rssSize,
        setRssSize,
        cPairs,
        setCPairs,
        dlRegion,
        setDlRegion,
        openEditItem,
    }
}
