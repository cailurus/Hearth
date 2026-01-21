import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../api'
import { Cog } from 'lucide-react'
import type { AppItem, BackgroundInfo, Group, Settings, Me, IconResolve } from '../types'
import { useNow, useWidgets } from '../hooks'
import { UserIcon } from '../components/ui/UserIcon'
import { TimeDisplay } from '../components/layout/TimeDisplay'
import { GroupBlock } from '../components/layout/GroupBlock'
import { SettingsDialog, LoginDialog, CreateGroupDialog, AddItemDialog } from '../components/dialogs'
import { EditItemDialog } from '../components/dialogs/EditItemDialog'
import { SnowEffect } from '../components/effects/SnowEffect'
import {
    normalizeIanaTimeZone,
    fetchWithTimeout,
    normalizeCountryCodes,
    widgetKindFromUrl,
    widgetQueryFromUrl,
    safeParseJSON,
    DEFAULT_CLOCKS,
} from '../utils'

export default function HomePage({ initialDialog }: { initialDialog?: 'login' } = {}) {
    const [me, setMe] = useState<Me | null>(null)
    const [settings, setSettings] = useState<Settings | null>(null)
    const [bg, setBg] = useState<BackgroundInfo | null>(null)
    const [groups, setGroups] = useState<Group[]>([])
    const [apps, setApps] = useState<AppItem[]>([])
    const [error, setError] = useState<string | null>(null)

    const [bgNonce, setBgNonce] = useState(0)
    const [bgRefreshing, setBgRefreshing] = useState(false)
    const [bgRefreshErr, setBgRefreshErr] = useState<string | null>(null)

    const [cityOptions, setCityOptions] = useState<string[]>([])
    const [cityQuery, setCityQuery] = useState('')

    const [loginOpen, setLoginOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)

    const [ctxOpen, setCtxOpen] = useState(false)
    const [ctxPos, setCtxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [createGroupOpen, setCreateGroupOpen] = useState(false)

    const [addItemOpen, setAddItemOpen] = useState(false)
    const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null)
    const [addItemGroupKind, setAddItemGroupKind] = useState<'system' | 'app'>('app')

    const [editOpen, setEditOpen] = useState(false)
    const [editErr, setEditErr] = useState<string | null>(null)
    const [editItem, setEditItem] = useState<AppItem | null>(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editUrl, setEditUrl] = useState('')
    const [editIconMode, setEditIconMode] = useState<'auto' | 'url' | 'lucide'>('auto')
    const [editIconUrl, setEditIconUrl] = useState('')
    const [editLucideIcon, setEditLucideIcon] = useState<string | null>(null)
    const [iconResolving, setIconResolving] = useState(false)

    const [widgetKind, setWidgetKind] = useState<'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | null>(null)
    const [wCity, setWCity] = useState('')

    const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT']

    const ensureFourMarketSymbols = useCallback(
        (raw: unknown): string[] => {
            const cleaned = (Array.isArray(raw) ? raw : [])
                .map((s) => String(s ?? '').trim().toUpperCase())
                .filter(Boolean)
            const unique: string[] = []
            for (const s of cleaned) {
                if (unique.length >= 4) break
                if (!unique.includes(s)) unique.push(s)
            }
            while (unique.length < 4) unique.push(DEFAULT_MARKET_SYMBOLS[unique.length] || 'BTC')
            return unique.slice(0, 4)
        },
        [DEFAULT_MARKET_SYMBOLS],
    )

    const [mkSymbols, setMkSymbols] = useState<string[]>(DEFAULT_MARKET_SYMBOLS)
    const [mkQueries, setMkQueries] = useState<string[]>(DEFAULT_MARKET_SYMBOLS)
    const [hCountryCodes, setHCountryCodes] = useState<string[]>(['CN', 'US'])
    const [hCountryQuery, setHCountryQuery] = useState('')

    const [tzClocks, setTzClocks] = useState<Array<{ city: string; timezone: string }>>([
        { city: 'Tokyo, Tokyo, Japan', timezone: 'Asia/Tokyo' },
        { city: 'Paris, Île-de-France, France', timezone: 'Europe/Paris' },
        { city: 'New York, NY, United States', timezone: 'America/New_York' },
        { city: 'London, England, United Kingdom', timezone: 'Europe/London' },
    ])

    const [showSnowEffect, setShowSnowEffect] = useState(false)

    const [mShowCpu, setMShowCpu] = useState(true)
    const [mShowMem, setMShowMem] = useState(true)
    const [mShowDisk, setMShowDisk] = useState(true)
    const [mShowNet, setMShowNet] = useState(true)
    const [mRefreshSec, setMRefreshSec] = useState<1 | 5 | 10>(1)

    const [siteDraft, setSiteDraft] = useState<Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'> | null>(null)
    const [siteSaveErr, setSiteSaveErr] = useState<string | null>(null)

    // Group drag-and-drop states
    const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)
    const draggingGroupIdRef = useRef<string | null>(null)

    const siteSaveSeqRef = useRef(0)
    const siteSaveTimerRef = useRef<number | null>(null)
    const citySearchSeqRef = useRef(0)

    const now = useNow(1000)
    // Timezone is now auto-detected from the user's system.

    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    // Use the useWidgets hook for widget data fetching
    const {
        weather,
        weatherErr,
        weatherById,
        weatherErrById,
        marketsById,
        marketsErrById,
        holidaysById,
        holidaysErrById,
        metrics,
        netRate,
    } = useWidgets({
        apps,
        lang,
        defaultCity: settings?.weather?.city,
    })

    const reloadDashboard = async () => {
        const [m, st, bgInfo, gs, as] = await Promise.all([
            apiGet<Me>('/api/auth/me'),
            apiGet<Settings>('/api/settings'),
            apiGet<BackgroundInfo>('/api/background'),
            apiGet<Group[]>('/api/groups'),
            apiGet<AppItem[]>('/api/apps'),
        ])
        setMe(m)
        setSettings(st)
        setBg(bgInfo)
        setGroups(Array.isArray(gs) ? gs : [])
        setApps(Array.isArray(as) ? as : [])
    }

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    await reloadDashboard()
                    if (cancelled) return
                    setError(null)
                } catch (e) {
                    if (cancelled) return
                    setError(e instanceof Error ? e.message : 'failed')
                }
            })()
        return () => {
            cancelled = true
        }
    }, [])

    // If opened via /admin, show login dialog.
    useEffect(() => {
        if (initialDialog === 'login') setLoginOpen(true)
    }, [initialDialog])

    // Background refresh favicons for custom apps in auto mode on page load
    useEffect(() => {
        if (apps.length === 0) return

        const autoIconSources = new Set(['site', 'fallback', 'google', 'auto'])

        // Only refresh non-widget apps that have URLs and auto icon sources
        const customApps = apps.filter((a) => {
            if (a.url.startsWith('widget:') || !a.url.trim()) return false
            if (a.iconPath?.startsWith('lucide:')) return false
            if (!a.iconSource) return true
            return autoIconSources.has(a.iconSource)
        })
        if (customApps.length === 0) return

        let cancelled = false

        // Refresh icons in the background (don't block UI)
        const refreshIcons = async () => {
            for (const app of customApps) {
                if (cancelled) break
                try {
                    const res = await apiPost<IconResolve>('/api/icon/resolve', {
                        url: app.url,
                        refresh: true,
                    })
                    if (cancelled) break
                    // Update app icon if changed
                    if (res.iconPath && res.iconPath !== app.iconPath) {
                        setApps((prev) =>
                            prev.map((a) =>
                                a.id === app.id
                                    ? { ...a, iconPath: res.iconPath, iconSource: res.iconSource }
                                    : a
                            )
                        )
                    }
                } catch {
                    // Silently ignore errors - this is background refresh
                }
            }
        }

        // Delay slightly to not block initial render
        const timer = window.setTimeout(() => {
            void refreshIcons()
        }, 1000)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
        // Only run once when apps first load (apps.length changes from 0 to N)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apps.length > 0])

    const openAddForGroup = (groupId: string | null) => {
        if (!isAdmin) return
        setAddItemGroupId(groupId)
        const g = groupId ? groups.find((x) => x.id === groupId) : null
        const kind = g && (g.kind === 'system' || g.name === '系统组件' || g.name === 'System Tools' || g.name === 'System Widgets') ? 'system' : 'app'
        setAddItemGroupKind(kind)
        setAddItemOpen(true)
    }

    const openEditItem = (item: AppItem) => {
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
                    setTzClocks([
                        { city: 'Tokyo, Tokyo, Japan', timezone: 'Asia/Tokyo' },
                        { city: 'Paris, Île-de-France, France', timezone: 'Europe/Paris' },
                        { city: 'New York, NY, United States', timezone: 'America/New_York' },
                        { city: 'London, England, United Kingdom', timezone: 'Europe/London' },
                    ])
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
        } else {
            setWidgetKind(null)
        }
        setEditOpen(true)
    }

    const widgetLastSavedDescRef = useRef<string>('')
    const widgetAutoSaveTimerRef = useRef<number | null>(null)
    const widgetSaveSeqRef = useRef(0)
    const tzNormalizeSeqRef = useRef(0)
    const wNormalizeSeqRef = useRef(0)

    const editItemUrl = editItem?.url
    const editItemId = editItem?.id
    // editItemDesc is accessed via editItem?.description when needed

    // Initialize widgetLastSavedDescRef only when the modal opens or when switching to a different item.
    // Do NOT re-run when editItemDesc changes (that would reset the ref after each save).
    useEffect(() => {
        if (!editOpen || !editItemUrl || !editItemUrl.startsWith('widget:')) return
        // Read the current description from editItem at the time this effect runs
        const desc = editItem?.description
        widgetLastSavedDescRef.current = String(desc ?? '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editOpen, editItemId])

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

    // When opening Weather settings, normalize existing city to full display name
    // without fighting user edits while typing.
    useEffect(() => {
        if (!me?.admin) return
        if (!editOpen || widgetKind !== 'weather') return

        const snapshot = String(wCity || '').trim()
        if (!snapshot) return

        const seq = ++wNormalizeSeqRef.current

        const run = async () => {
            try {
                const r = await resolveCityToTimezone(snapshot)
                if (wNormalizeSeqRef.current !== seq) return
                if (!editOpen || widgetKind !== 'weather') return
                if (String(wCity || '').trim() !== snapshot) return
                if (r.city && r.city !== snapshot) setWCity(r.city)
            } catch {
                // ignore
            }
        }

        void run()
        // Only run when modal opens or the item changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me?.admin, editOpen, editItem?.id, widgetKind])

    // When opening World Clock settings, normalize existing cities to full display names
    // (e.g., "Tokyo, Tokyo, Japan") without fighting user edits while typing.
    useEffect(() => {
        if (!me?.admin) return
        if (!editOpen || widgetKind !== 'timezones') return

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

            // Only apply if still same session AND user hasn't edited the cities since snapshot.
            if (tzNormalizeSeqRef.current !== seq) return
            if (!editOpen || widgetKind !== 'timezones') return
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
    }, [me?.admin, editOpen, editItem?.id, widgetKind])

    useEffect(() => {
        if (!me?.admin) return
        if (!editOpen || !editItem || !editItem.url.startsWith('widget:') || !widgetKind) return

        if (widgetAutoSaveTimerRef.current) window.clearTimeout(widgetAutoSaveTimerRef.current)

        widgetAutoSaveTimerRef.current = window.setTimeout(() => {
            const seq = ++widgetSaveSeqRef.current
            const itemId = editItem.id

            const run = async () => {
                let description: string | null = null
                try {
                    if (widgetKind === 'weather') {
                        description = JSON.stringify({ city: wCity.trim() })
                    } else if (widgetKind === 'metrics') {
                        description = JSON.stringify({
                            showCpu: !!mShowCpu,
                            showMem: !!mShowMem,
                            showDisk: !!mShowDisk,
                            showNet: !!mShowNet,
                            refreshSec: mRefreshSec,
                        })
                    } else if (widgetKind === 'markets') {
                        const symbols = ensureFourMarketSymbols(mkSymbols)
                        description = JSON.stringify({ symbols })
                    } else if (widgetKind === 'holidays') {
                        const countries = normalizeCountryCodes(hCountryCodes)
                        description = JSON.stringify({ countries })
                    } else if (widgetKind === 'timezones') {
                        // IMPORTANT: do NOT auto-resolve/overwrite city strings while typing.
                        // We only resolve (city->timezone & full city label) when the user picks a suggestion.
                        const next = (Array.isArray(tzClocks) ? tzClocks : []).slice(0, 4)
                        while (next.length < 4) next.push({ city: DEFAULT_CLOCKS[next.length]?.city || `City ${next.length + 1}`, timezone: '' })
                        const clocks = next.map((c, idx) => {
                            const fallbackCity = DEFAULT_CLOCKS[idx]?.city || `City ${idx + 1}`
                            const fallbackTz = DEFAULT_CLOCKS[idx]?.timezone || 'UTC'
                            return {
                                city: String(c.city ?? '').trim() || fallbackCity,
                                timezone: String(c.timezone ?? '').trim() || fallbackTz,
                            }
                        })
                        description = JSON.stringify({ clocks })
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
                        setApps((prev) => prev.map((a) => (a.id === itemId ? { ...a, description } : a)))
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
        me?.admin,
        editOpen,
        editItem,
        widgetKind,
        wCity,
        tzClocks,
        mShowCpu,
        mShowMem,
        mShowDisk,
        mShowNet,
        mRefreshSec,
        mkSymbols,
        ensureFourMarketSymbols,
        hCountryCodes,
        hCountryQuery,
    ])

    const saveItem = async (e: FormEvent) => {
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
            description = editDesc || null  // Keep spaces if user wants blank display
        }

        let iconPath: string | null = editItem.iconPath
        let iconSource: string | null = editItem.iconSource

        if (!isWidget) {
            // Handle Lucide icon selection
                if (editIconMode === 'lucide' && editLucideIcon) {
                    iconPath = `lucide:${editLucideIcon}`
                    iconSource = 'lucide'
                } else {
                    setIconResolving(true)
                    try {
                        if (editIconMode === 'auto') {
                            const res = await apiPost<IconResolve>('/api/icon/resolve', { url })
                            iconPath = res.iconPath || null
                            iconSource = res.iconSource || null
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
            await apiPut(`/api/apps/${editItem.id}`, {
                groupId: editItem.groupId,
                name,
                description,
                url,
                iconPath,
                iconSource,
            })
            setEditOpen(false)
            setEditItem(null)
            await reloadDashboard()
        } catch (e2) {
            setEditErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const deleteItem = async (id: string) => {
        if (!isAdmin) return
        try {
            await apiDelete(`/api/apps/${id}`)
            await reloadDashboard()
        } catch {
            // ignore
        }
    }

    const deleteGroup = async (groupId: string) => {
        if (!isAdmin) return
        try {
            await apiDelete(`/api/groups/${groupId}`)
            await reloadDashboard()
        } catch {
            // ignore
        }
    }

    // Reorder groups, including title bar position
    const reorderGroupsWithTitle = async (result: { groupIds: string[]; titlePosition: number }) => {
        if (!isAdmin) return

        const { groupIds, titlePosition } = result

        try {
            // First, reorder groups
            if (groupIds.length > 0) {
                await apiPost('/api/groups/reorder', { ids: groupIds })
            }

            // Then, update title sort order if it changed
            if (settings && titlePosition !== (settings.titleSortOrder ?? 0)) {
                const newSettings = { ...settings, titleSortOrder: titlePosition }
                await apiPut('/api/settings', newSettings)
            }

            await reloadDashboard()
        } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const reorderItems = async (groupId: string | null, ids: string[]) => {
        if (!isAdmin) return
        if (!Array.isArray(ids) || ids.length === 0) return
        try {
            await apiPost('/api/apps/reorder', { groupId, ids })
            await reloadDashboard()
        } catch (e2) {
            setError(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const persistSiteDraft = async (draft: Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'>) => {
        if (!isAdmin || !settings) return
        const token = ++siteSaveSeqRef.current
        setSiteSaveErr(null)
        try {
            const normalizedTime = draft.time
                ? {
                    ...draft.time,
                    mode: 'digital',
                    timezone: systemTimezone,
                }
                : draft.time
            const next: Settings = {
                ...settings,
                siteTitle: draft.siteTitle,
                language: draft.language,
                background: draft.background,
                time: normalizedTime,
            }
            await apiPut('/api/settings', next)
            if (token !== siteSaveSeqRef.current) return
            setSettings(next)
        } catch (e2) {
            if (token !== siteSaveSeqRef.current) return
            setSiteSaveErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const schedulePersistSiteDraft = (draft: Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'>, mode: 'now' | 'debounce') => {
        if (siteSaveTimerRef.current) {
            window.clearTimeout(siteSaveTimerRef.current)
            siteSaveTimerRef.current = null
        }
        if (mode === 'now') {
            void persistSiteDraft(draft)
            return
        }
        siteSaveTimerRef.current = window.setTimeout(() => {
            siteSaveTimerRef.current = null
            void persistSiteDraft(draft)
        }, 300)
    }

    const sortedGroups = useMemo(() => {
        return [...groups].sort((a, b) => {
            const d1 = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            if (d1 !== 0) return d1
            const d2 = (a.createdAt ?? 0) - (b.createdAt ?? 0)
            if (d2 !== 0) return d2
            return String(a.id).localeCompare(String(b.id))
        })
    }, [groups])

    // Helper function to compute new group order after drag (including title)
    // Returns: { groupIds: string[], titlePosition: number }
    const getNextGroupOrder = (fromId: string, toId: string): { groupIds: string[]; titlePosition: number } | null => {
        // Build current order: title inserted among groups based on titlePosition
        const titlePosition = settings?.titleSortOrder ?? 0
        const groupIds = sortedGroups.map((g) => g.id)

        // Build current visual order (same as render logic)
        const currentOrder: string[] = []
        let titleInserted = false
        for (let i = 0; i < groupIds.length; i++) {
            if (!titleInserted && i >= titlePosition) {
                currentOrder.push('__title__')
                titleInserted = true
            }
            currentOrder.push(groupIds[i])
        }
        if (!titleInserted) {
            currentOrder.push('__title__')
        }

        const fromIndex = currentOrder.indexOf(fromId)
        const toIndex = currentOrder.indexOf(toId)
        if (fromIndex < 0 || toIndex < 0) return null
        if (fromIndex === toIndex) return null

        // Perform the move
        const next = [...currentOrder]
        next.splice(fromIndex, 1)
        next.splice(toIndex, 0, fromId)

        // Extract new titlePosition and groupIds
        const newTitlePosition = next.indexOf('__title__')
        const newGroupIds = next.filter((id) => id !== '__title__')

        return { groupIds: newGroupIds, titlePosition: newTitlePosition }
    }

    const hasSystemGroup = useMemo(() => {
        return groups.some((g) => g.kind === 'system' || g.name === '系统组件' || g.name === 'System Tools' || g.name === 'System Widgets')
    }, [groups])

    const appsByGroup = useMemo(() => {
        const m = new Map<string | null, AppItem[]>()
        for (const a of apps) {
            const key = a.groupId ?? null
            const list = m.get(key) ?? []
            list.push(a)
            m.set(key, list)
        }
        for (const [, list] of m) {
            list.sort((x, y) => {
                const d1 = (x.sortOrder ?? 0) - (y.sortOrder ?? 0)
                if (d1 !== 0) return d1
                const d2 = (x.createdAt ?? 0) - (y.createdAt ?? 0)
                if (d2 !== 0) return d2
                return String(x.id).localeCompare(String(y.id))
            })
        }
        return m
    }, [apps])

    const title = settings?.siteTitle || 'Hearth'
    const baseBgUrl = bg?.imageUrl || '/api/background/image'
    const bgUrl = baseBgUrl + (baseBgUrl.includes('?') ? '&' : '?') + `v=${bgNonce}`
    const isAdmin = !!me?.admin

    const systemTimezone = useMemo(() => {
        try {
            const tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim()
            return normalizeIanaTimeZone(tz, 'Asia/Shanghai')
        } catch {
            return 'Asia/Shanghai'
        }
    }, [])

    const displayGroupName = (raw: string): string => {
        const s = String(raw ?? '').trim()
        if (!s) return ''
        // Special-case the default system group to be bilingual without storing a slash-form name.
        if (s === '系统组件') return lang === 'en' ? 'System Widgets' : '系统组件'
        if (s === 'System Widgets') return lang === 'en' ? 'System Widgets' : '系统组件'
        if (s === 'System Tools') return lang === 'en' ? 'System Widgets' : '系统组件'
        if (s.toLowerCase().includes('system tools') && s.includes('系统组件')) return lang === 'en' ? 'System Widgets' : '系统组件'
        if (s.toLowerCase().includes('system widgets') && s.includes('系统组件')) return lang === 'en' ? 'System Widgets' : '系统组件'
        return s
    }

    useEffect(() => {
        const siteTitle = String(settings?.siteTitle ?? '').trim()
        if (!siteTitle || siteTitle === 'Hearth') {
            document.title = 'Hearth'
            return
        }
        document.title = lang === 'en' ? `Hearth: ${siteTitle}` : `Hearth：${siteTitle}`
    }, [lang, settings?.siteTitle])

    useEffect(() => {
        if (!editOpen) {
            // Reset when dialog closes
            setCityOptions([])
            citySearchSeqRef.current = 0
            return
        }
        if (widgetKind !== 'weather' && widgetKind !== 'timezones') return
        const q = (cityQuery || '').trim()
        if (!q) {
            setCityOptions([])
            return
        }
        
        const seq = ++citySearchSeqRef.current
        
        const id = window.setTimeout(async () => {
            try {
                const reqLang = widgetKind === 'timezones' ? 'en' : lang
                const res = await apiGet<{ results: Array<{ displayName: string }> }>(
                    `/api/widgets/geocode?${new URLSearchParams({ query: q, lang: reqLang }).toString()}`,
                )
                // Only update if this is still the latest search
                if (seq !== citySearchSeqRef.current) return
                const next = (res?.results || []).map((x) => x.displayName).filter(Boolean)
                setCityOptions(Array.from(new Set(next)).slice(0, 12))
            } catch {
                if (seq !== citySearchSeqRef.current) return
                setCityOptions([])
            }
        }, 250)
        return () => window.clearTimeout(id)
    }, [editOpen, widgetKind, cityQuery, lang])

    const refreshBackground = async () => {
        if (!isAdmin) return
        if (bgRefreshing) return
        setBgRefreshing(true)
        setBgRefreshErr(null)
        try {
            // Refresh should reflect the currently selected provider in the settings UI,
            // even if the user hasn't clicked Save yet.
            const draftProvider = String(siteDraft?.background?.provider ?? '').trim()
            const savedProvider = String(settings?.background?.provider ?? '').trim()
            const provider = (draftProvider || savedProvider || 'default').trim()

            // Avoid spinning forever if the network/proxy hangs.
            const refreshRes = await fetchWithTimeout(
                `/api/background/refresh?${new URLSearchParams({ provider }).toString()}`,
                { method: 'POST', credentials: 'include' },
                15000,
            )
            if (!refreshRes.ok) {
                const text = await refreshRes.text().catch(() => '')
                const msg = (() => {
                    try {
                        const data = text ? (JSON.parse(text) as unknown) : null
                        if (data && typeof data === 'object' && 'error' in data) {
                            const e = (data as { error?: unknown }).error
                            if (typeof e === 'string' && e.trim()) return e.trim()
                        }
                    } catch {
                        // ignore
                    }
                    return text?.trim() || refreshRes.statusText || 'failed'
                })()
                throw new Error(msg)
            }

            // Preload the next background first, then swap.
            const nextNonce = Date.now()
            const base = bg?.imageUrl || '/api/background/image'
            const nextUrl = base + (base.includes('?') ? '&' : '?') + `v=${nextNonce}`

            // Use fetch once to capture error text (Image.onerror is opaque).
            const res = await fetchWithTimeout(nextUrl, { credentials: 'include' }, 20000)
            if (!res.ok) {
                const text = await res.text().catch(() => '')
                const msg = (() => {
                    try {
                        const data = text ? (JSON.parse(text) as unknown) : null
                        if (data && typeof data === 'object' && 'error' in data) {
                            const e = (data as { error?: unknown }).error
                            if (typeof e === 'string' && e.trim()) return e.trim()
                        }
                    } catch {
                        // ignore
                    }
                    return text?.trim() || res.statusText || 'failed'
                })()
                throw new Error(msg)
            }
            // Fully consume response so the browser can cache it.
            await res.blob()

            await Promise.race([
                new Promise<void>((resolve, reject) => {
                    const img = new Image()
                    img.onload = () => resolve()
                    img.onerror = () => reject(new Error('failed'))
                    img.src = nextUrl
                }),
                new Promise<void>((_, reject) => {
                    window.setTimeout(() => reject(new Error('timeout')), 12000)
                }),
            ])

            setBgNonce(nextNonce)
        } catch (e2) {
            setBgRefreshErr(e2 instanceof Error ? e2.message : 'failed')
        } finally {
            setBgRefreshing(false)
        }
    }
    const onLogout = async () => {
        try {
            await apiPost('/api/auth/logout')
        } finally {
            setSettingsOpen(false)
            await reloadDashboard()
        }
    }

    useEffect(() => {
        if (!settings || siteDraft) return
        const allowedIntervals = new Set(['0', '1h', '3h', '6h', '12h', '24h'])
        const providerRaw = String(settings.background?.provider ?? '').trim() || 'default'
        const provider = providerRaw === 'bing' ? 'bing_daily' : providerRaw
        const intervalRaw = String(settings.background?.interval ?? '').trim()
        const interval = provider === 'bing_daily' ? '24h' : provider === 'default' ? '0' : allowedIntervals.has(intervalRaw) ? intervalRaw : '0'
        setSiteDraft({
            siteTitle: settings.siteTitle,
            language: settings.language || 'zh',
            background: { ...settings.background, provider, interval },
            time: settings.time ? { ...settings.time, timezone: systemTimezone } : settings.time,
        })
    }, [settings, siteDraft])

    const hasUngrouped = (appsByGroup.get(null) ?? []).length > 0
    const groupItems = (groupId: string | null) => appsByGroup.get(groupId) ?? []

    return (
        <div
            className="relative min-h-screen"
            onContextMenu={(e) => {
                if (!isAdmin) return
                // Don't open the context menu when a modal is open.
                if (loginOpen || settingsOpen || createGroupOpen || addItemOpen) return
                e.preventDefault()
                setCtxPos({ x: e.clientX, y: e.clientY })
                setCtxOpen(true)
            }}
        >
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <img src={bgUrl} alt="background" className="h-full w-full scale-105 object-cover blur-sm" />
                <div className="absolute inset-0 bg-black/60" />
            </div>

            <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
                {isAdmin ? (
                    <button
                        onClick={() => {
                            setSiteSaveErr(null)
                            setSettingsOpen(true)
                        }}
                        className="p-1.5 text-white/90 transition-colors hover:text-white"
                        aria-label="settings"
                        title={t('设置', 'Settings')}
                    >
                        <Cog className="h-5 w-5" />
                    </button>
                ) : (
                    <button
                        onClick={() => setLoginOpen(true)}
                        className="p-1.5 text-white/90 transition-colors hover:text-white"
                        aria-label="user"
                        title={t('登录', 'Login')}
                    >
                        <UserIcon />
                    </button>
                )}
            </div>

            <main className="mx-auto max-w-6xl px-4 pb-10 pt-[20vh] text-white">
                {error ? (
                    <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/80">
                        {error}
                    </div>
                ) : null}

                <div className="space-y-6">
                    {/* Title block - draggable among groups */}
                    {(() => {
                        // titleSortOrder represents the index position of title among groups
                        // 0 = before all groups, 1 = after first group, etc.
                        const titlePosition = settings?.titleSortOrder ?? 0

                        // Build ordered list: groups first, then insert title at the right position
                        const groupBlocks: { type: 'group'; id: string; group: Group }[] = sortedGroups.map((g) => ({
                            type: 'group',
                            id: g.id,
                            group: g,
                        }))

                        // Build final render order
                        const allBlocks: { type: 'title' | 'ungrouped' | 'group'; id: string; group?: Group }[] = []

                        // Add ungrouped at the very beginning (always)
                        if (hasUngrouped) {
                            allBlocks.push({ type: 'ungrouped', id: '__ungrouped__' })
                        }

                        // Insert title at the right position among groups
                        let titleInserted = false
                        for (let i = 0; i < groupBlocks.length; i++) {
                            if (!titleInserted && i >= titlePosition) {
                                allBlocks.push({ type: 'title', id: '__title__' })
                                titleInserted = true
                            }
                            allBlocks.push(groupBlocks[i])
                        }
                        // If title should be at the end
                        if (!titleInserted) {
                            allBlocks.push({ type: 'title', id: '__title__' })
                        }

                        // Render each block
                        return allBlocks.map((block) => {
                            if (block.type === 'title') {
                                return (
                                    <div
                                        key="__title__"
                                        draggable={isAdmin}
                                        onDragStart={(e) => {
                                            draggingGroupIdRef.current = '__title__'
                                            e.dataTransfer.setData('text/plain', '__title__')
                                            setTimeout(() => setDraggingGroupId('__title__'), 0)
                                        }}
                                        onDragEnd={() => {
                                            draggingGroupIdRef.current = null
                                            setDraggingGroupId(null)
                                            setDropTargetGroupId(null)
                                        }}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDragEnter={(e) => {
                                            e.preventDefault()
                                            if (dropTargetGroupId !== '__title__') {
                                                setDropTargetGroupId('__title__')
                                            }
                                        }}
                                        onDrop={async (e) => {
                                            e.preventDefault()
                                            const fromId = draggingGroupIdRef.current || e.dataTransfer.getData('text/plain')
                                            draggingGroupIdRef.current = null
                                            setDraggingGroupId(null)
                                            setDropTargetGroupId(null)
                                            if (!fromId || fromId === '__title__') return
                                            // Compute new order: move dragged group to title's position
                                            const next = getNextGroupOrder(fromId, '__title__')
                                            if (next) await reorderGroupsWithTitle(next)
                                        }}
                                        className={`mb-8 text-center transition-all ${isAdmin ? 'cursor-grab' : ''} ${draggingGroupId === '__title__' ? 'opacity-30' : ''
                                            } ${dropTargetGroupId === '__title__' && draggingGroupId !== '__title__'
                                                ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-transparent scale-[1.01]'
                                                : ''
                                            }`}
                                    >
                                        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
                                        {settings?.time?.enabled ? (
                                            <div className="mt-3 flex items-center justify-center">
                                                <TimeDisplay
                                                    now={now}
                                                    timezone={systemTimezone}
                                                    showSeconds={!!settings.time?.showSeconds}
                                                    mode={settings.time?.mode || 'digital'}
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                )
                            }

                            if (block.type === 'ungrouped') {
                                return (
                                    <GroupBlock
                                        key="__ungrouped__"
                                        groupId={null}
                                        name={t('未分组', 'Ungrouped')}
                                        groupKind={'app'}
                                        items={groupItems(null)}
                                        isAdmin={isAdmin}
                                        onAdd={openAddForGroup}
                                        onEdit={openEditItem}
                                        onDelete={deleteItem}
                                        onReorder={reorderItems}
                                        weather={weather}
                                        weatherErr={weatherErr}
                                        weatherById={weatherById}
                                        weatherErrById={weatherErrById}
                                        marketsById={marketsById}
                                        marketsErrById={marketsErrById}
                                        holidaysById={holidaysById}
                                        holidaysErrById={holidaysErrById}
                                        metrics={metrics}
                                        netRate={netRate}
                                        localTimezone={systemTimezone}
                                        lang={lang}
                                    />
                                )
                            }

                            // block.type === 'group'
                            const g = block.group!
                            return (
                                <div
                                    key={g.id}
                                    draggable={isAdmin}
                                    onDragStart={(e) => {
                                        draggingGroupIdRef.current = g.id
                                        e.dataTransfer.setData('text/plain', g.id)
                                        setTimeout(() => setDraggingGroupId(g.id), 0)
                                    }}
                                    onDragEnd={() => {
                                        draggingGroupIdRef.current = null
                                        setDraggingGroupId(null)
                                        setDropTargetGroupId(null)
                                    }}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDragEnter={(e) => {
                                        e.preventDefault()
                                        if (dropTargetGroupId !== g.id) {
                                            setDropTargetGroupId(g.id)
                                        }
                                    }}
                                    onDrop={async (e) => {
                                        e.preventDefault()
                                        const fromId = draggingGroupIdRef.current || e.dataTransfer.getData('text/plain')
                                        draggingGroupIdRef.current = null
                                        setDraggingGroupId(null)
                                        setDropTargetGroupId(null)
                                        if (!fromId || fromId === g.id) return
                                        const next = getNextGroupOrder(fromId, g.id)
                                        if (next) await reorderGroupsWithTitle(next)
                                    }}
                                    className={`transition-all ${isAdmin ? 'cursor-grab' : ''} ${draggingGroupId === g.id ? 'opacity-30' : ''
                                        } ${dropTargetGroupId === g.id && draggingGroupId !== g.id
                                            ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-transparent scale-[1.01]'
                                            : ''
                                        }`}
                                >
                                    <GroupBlock
                                        groupId={g.id}
                                        name={displayGroupName(g.name)}
                                        groupKind={g.kind || 'app'}
                                        items={groupItems(g.id)}
                                        isAdmin={isAdmin}
                                        onAdd={openAddForGroup}
                                        onEdit={openEditItem}
                                        onDelete={deleteItem}
                                        onDeleteGroup={deleteGroup}
                                        onReorder={reorderItems}
                                        weather={weather}
                                        weatherErr={weatherErr}
                                        weatherById={weatherById}
                                        weatherErrById={weatherErrById}
                                        marketsById={marketsById}
                                        marketsErrById={marketsErrById}
                                        holidaysById={holidaysById}
                                        holidaysErrById={holidaysErrById}
                                        metrics={metrics}
                                        netRate={netRate}
                                        localTimezone={systemTimezone}
                                        lang={lang}
                                    />
                                </div>
                            )
                        })
                    })()}
                </div>
            </main>

            {/* Footer */}
            <footer className="py-6 text-center text-xs text-white/40">
                <span>
                    <button
                        onClick={() => setShowSnowEffect((prev) => !prev)}
                        className="cursor-pointer transition-colors hover:text-white/60"
                        title="❄️"
                    >
                        &copy;
                    </button>
                    {' '}{new Date().getFullYear()} Hearth
                </span>
            </footer>

            {showSnowEffect ? <SnowEffect /> : null}

            {ctxOpen ? (
                <div className="fixed inset-0 z-30" onClick={() => setCtxOpen(false)}>
                    <div
                        className="fixed w-40 overflow-hidden rounded-lg border border-white/10 bg-black/70 text-white backdrop-blur"
                        style={{ left: ctxPos.x, top: ctxPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
                            onClick={() => {
                                setCtxOpen(false)
                                setCreateGroupOpen(true)
                            }}
                        >
                            {t('新建分组', 'New Group')}
                        </button>
                    </div>
                </div>
            ) : null}

            <LoginDialog
                open={loginOpen}
                onClose={() => setLoginOpen(false)}
                onLogin={async (u, p) => {
                    await apiPost('/api/auth/login', { username: u, password: p })
                    const m = await apiGet<Me>('/api/auth/me')
                    setMe(m)
                    await reloadDashboard()
                }}
                lang={lang}
            />

            <SettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                lang={lang}
                siteDraft={siteDraft}
                setSiteDraft={setSiteDraft}
                schedulePersistSiteDraft={schedulePersistSiteDraft}
                siteSaveErr={siteSaveErr}
                systemTimezone={systemTimezone}
                bgRefreshing={bgRefreshing}
                bgRefreshErr={bgRefreshErr}
                refreshBackground={refreshBackground}
                onLogout={onLogout}
            />

            <CreateGroupDialog
                open={createGroupOpen}
                onClose={() => setCreateGroupOpen(false)}
                onSubmit={async (name, kind) => {
                    await apiPost('/api/groups', { name, kind })
                    await reloadDashboard()
                }}
                hasSystemGroup={hasSystemGroup}
                lang={lang}
            />

            <AddItemDialog
                open={addItemOpen}
                onClose={() => setAddItemOpen(false)}
                groupId={addItemGroupId}
                groupKind={addItemGroupKind}
                onSubmit={async (data) => {
                    await apiPost('/api/apps', data)
                    await reloadDashboard()
                }}
                lang={lang}
            />

            <EditItemDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                lang={lang}
                editErr={editErr}
                editItem={editItem}
                editName={editName}
                setEditName={setEditName}
                editDesc={editDesc}
                setEditDesc={setEditDesc}
                editUrl={editUrl}
                setEditUrl={setEditUrl}
                editIconMode={editIconMode}
                setEditIconMode={setEditIconMode}
                editIconUrl={editIconUrl}
                setEditIconUrl={setEditIconUrl}
                editLucideIcon={editLucideIcon}
                setEditLucideIcon={setEditLucideIcon}
                iconResolving={iconResolving}
                saveItem={saveItem}
                widgetKind={widgetKind}
                wCity={wCity}
                setWCity={setWCity}
                setCityQuery={setCityQuery}
                cityOptions={cityOptions}
                mRefreshSec={mRefreshSec}
                setMRefreshSec={setMRefreshSec}
                mShowCpu={mShowCpu}
                setMShowCpu={setMShowCpu}
                mShowMem={mShowMem}
                setMShowMem={setMShowMem}
                mShowDisk={mShowDisk}
                setMShowDisk={setMShowDisk}
                mShowNet={mShowNet}
                setMShowNet={setMShowNet}
                mkSymbols={mkSymbols}
                setMkSymbols={setMkSymbols}
                mkQueries={mkQueries}
                setMkQueries={setMkQueries}
                ensureFourMarketSymbols={ensureFourMarketSymbols}
                hCountryCodes={hCountryCodes}
                setHCountryCodes={setHCountryCodes}
                hCountryQuery={hCountryQuery}
                setHCountryQuery={setHCountryQuery}
                tzClocks={tzClocks}
                setTzClocks={setTzClocks}
                resolveCityToTimezoneEn={resolveCityToTimezoneEn}
            />
        </div>
    )
}
