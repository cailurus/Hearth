import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost, apiPut } from '../api'
import { Cog } from 'lucide-react'
import type { AppItem, Group, IconResolve } from '../types'
import { useNow, useWidgets, useVideoBackground, useDialogState, useBackgroundRefresh, useCitySearch, useSettingsDraft, useDashboard } from '../hooks'
import { UserIcon } from '../components/ui/UserIcon'
import { TimeDisplay } from '../components/layout/TimeDisplay'
import { GroupBlock } from '../components/layout/GroupBlock'
import { SettingsDialog, LoginDialog, CreateGroupDialog, AddItemDialog } from '../components/dialogs'
import { EditItemDialog } from '../components/dialogs/EditItemDialog'
import { SnowEffect } from '../components/effects/SnowEffect'
import {
    normalizeIanaTimeZone,
    normalizeCountryCodes,
    widgetKindFromUrl,
    widgetQueryFromUrl,
    safeParseJSON,
    DEFAULT_CLOCKS,
} from '../utils'

const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT']

export default function HomePage({ initialDialog }: { initialDialog?: 'login' } = {}) {
    const [dashboard, actions] = useDashboard()
    const { me, settings, bg, groups, apps, error } = dashboard

    const [cityQuery, setCityQuery] = useState('')

    const { dialogs, openDialog, closeDialog, openContextMenu, contextMenuPos, openAddItem, addItemGroupId, addItemGroupKind } = useDialogState(initialDialog === 'login')

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

    const [widgetKind, setWidgetKind] = useState<'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | null>(null)
    const [wCity, setWCity] = useState('')

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
        [],
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

    const systemTimezone = useMemo(() => {
        try {
            const tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim()
            return normalizeIanaTimeZone(tz, 'Asia/Shanghai')
        } catch {
            return 'Asia/Shanghai'
        }
    }, [])

    const settingsDraft = useSettingsDraft({
        settings,
        isAdmin: !!me?.admin,
        systemTimezone,
        onSave: async (s) => { await apiPut('/api/settings', s) },
    })
    const { draft: siteDraft, setDraft: setSiteDraft, saveError: siteSaveErr, saveDraft: schedulePersistSiteDraft } = settingsDraft

    const bgRefresh = useBackgroundRefresh({
        isAdmin: !!me?.admin,
        currentProvider: settings?.background?.provider || 'default',
        draftProvider: siteDraft?.background?.provider,
    })

    // Group drag-and-drop states
    const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)
    const draggingGroupIdRef = useRef<string | null>(null)


    const now = useNow(1000)
    // Timezone is now auto-detected from the user's system.

    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const citySearchLang = widgetKind === 'timezones' ? 'en' as const : lang
    const citySearch = useCitySearch({
        enabled: dialogs.edit && (widgetKind === 'weather' || widgetKind === 'timezones'),
        query: cityQuery,
        lang: citySearchLang,
    })

    // Video background
    const isVideoBackground = settings?.background?.provider === 'default_video'
    const { videoUrl, isDownloading, downloadProgress, isReady: videoReady } = useVideoBackground(isVideoBackground)

    // Background blur (video default: 0, image default: 3)
    const bgBlur = settings?.background?.blur ?? (isVideoBackground ? 0 : 3)

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
        let anyChanged = false
        const refreshIcons = async () => {
            for (const app of customApps) {
                if (cancelled) break
                try {
                    const res = await apiPost<IconResolve>('/api/icon/resolve', {
                        url: app.url,
                        refresh: true,
                    })
                    if (cancelled) break
                    if (res.iconPath && res.iconPath !== app.iconPath) {
                        anyChanged = true
                    }
                } catch {
                    // Silently ignore errors - this is background refresh
                }
            }
            if (!cancelled && anyChanged) {
                await actions.reload()
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
        const g = groupId ? groups.find((x) => x.id === groupId) : null
        const kind = g && (g.kind === 'system' || g.name === '系统组件' || g.name === 'System Tools' || g.name === 'System Widgets') ? 'system' : 'app'
        openAddItem(groupId, kind)
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
        openDialog('edit')
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
        if (!dialogs.edit || !editItemUrl || !editItemUrl.startsWith('widget:')) return
        // Read the current description from editItem at the time this effect runs
        const desc = editItem?.description
        widgetLastSavedDescRef.current = String(desc ?? '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dialogs.edit, editItemId])

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

    // Manual save handler for weather, timezones, and markets widgets.
    // Close dialog immediately; persist in background.
    const handleSaveWidget = useCallback(async () => {
        if (!editItem || !widgetKind) return
        if (widgetKind !== 'weather' && widgetKind !== 'timezones' && widgetKind !== 'markets') return

        // Capture values before closing, then close the dialog instantly.
        const snapshot = { ...editItem }
        const kind = widgetKind
        const citySnapshot = wCity
        const symbolsSnapshot = [...mkSymbols]
        const clocksSnapshot = tzClocks.map((c) => ({ ...c }))
        closeDialog('edit')

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
            await actions.reload()
        } catch {
            // Save failed silently; the dialog is already closed.
            // The old data remains visible so the user can retry by reopening settings.
        }
    }, [editItem, widgetKind, wCity, mkSymbols, tzClocks, ensureFourMarketSymbols, actions])

    // When opening Weather settings, normalize existing city to full display name
    // without fighting user edits while typing.
    useEffect(() => {
        if (!me?.admin) return
        if (!dialogs.edit || widgetKind !== 'weather') return

        const snapshot = String(wCity || '').trim()
        if (!snapshot) return

        const seq = ++wNormalizeSeqRef.current

        const run = async () => {
            try {
                const r = await resolveCityToTimezone(snapshot)
                if (wNormalizeSeqRef.current !== seq) return
                if (!dialogs.edit || widgetKind !== 'weather') return
                if (String(wCity || '').trim() !== snapshot) return
                if (r.city && r.city !== snapshot) setWCity(r.city)
            } catch {
                // ignore
            }
        }

        void run()
        // Only run when modal opens or the item changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me?.admin, dialogs.edit, editItem?.id, widgetKind])

    // When opening World Clock settings, normalize existing cities to full display names
    // (e.g., "Tokyo, Tokyo, Japan") without fighting user edits while typing.
    useEffect(() => {
        if (!me?.admin) return
        if (!dialogs.edit || widgetKind !== 'timezones') return

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
            if (!dialogs.edit || widgetKind !== 'timezones') return
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
    }, [me?.admin, dialogs.edit, editItem?.id, widgetKind])

    useEffect(() => {
        if (!me?.admin) return
        if (!dialogs.edit || !editItem || !editItem.url.startsWith('widget:') || !widgetKind) return

        // Skip auto-save for weather, timezones, and markets - they use manual save button
        if (widgetKind === 'weather' || widgetKind === 'timezones' || widgetKind === 'markets') return

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
                        await actions.reload()
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
        dialogs.edit,
        editItem,
        widgetKind,
        mShowCpu,
        mShowMem,
        mShowDisk,
        mShowNet,
        mRefreshSec,
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
            await actions.updateApp(editItem.id, {
                groupId: editItem.groupId,
                name,
                description,
                url,
                iconPath,
                iconSource,
            })
            closeDialog('edit')
            setEditItem(null)
        } catch (e2) {
            setEditErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const deleteItem = async (id: string) => {
        if (!isAdmin) return
        try {
            await actions.deleteApp(id)
        } catch {
            // ignore
        }
    }

    const deleteGroup = async (groupId: string) => {
        if (!isAdmin) return
        try {
            await actions.deleteGroup(groupId)
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

            await actions.reload()
        } catch {
            // Reorder error silently ignored; reload will restore correct state
        }
    }

    const reorderItems = async (groupId: string | null, ids: string[]) => {
        if (!isAdmin) return
        if (!Array.isArray(ids) || ids.length === 0) return
        try {
            await apiPost('/api/apps/reorder', { groupId, ids })
            await actions.reload()
        } catch {
            // Reorder error silently ignored; reload will restore correct state
        }
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
    const bgUrl = baseBgUrl + (baseBgUrl.includes('?') ? '&' : '?') + `v=${bgRefresh.bgNonce}`
    const isAdmin = !!me?.admin

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


    const onLogout = async () => {
        try {
            await actions.logout()
        } finally {
            closeDialog('settings')
            await actions.reload()
        }
    }

    const hasUngrouped = (appsByGroup.get(null) ?? []).length > 0
    const groupItems = (groupId: string | null) => appsByGroup.get(groupId) ?? []

    return (
        <div
            className="relative min-h-screen"
            onContextMenu={(e) => {
                if (!isAdmin) return
                // Don't open the context menu when a modal is open.
                if (dialogs.login || dialogs.settings || dialogs.createGroup || dialogs.addItem) return
                e.preventDefault()
                openContextMenu(e.clientX, e.clientY)
            }}
        >
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                {isVideoBackground ? (
                    <>
                        {videoReady && videoUrl ? (
                            <video
                                src={videoUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="h-full w-full scale-105 object-cover"
                                style={{ filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined }}
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-black">
                                {isDownloading ? (
                                    <div className="text-center text-white/70">
                                        <div className="mb-2 h-8 w-8 mx-auto animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                                        <div className="text-sm">{t('下载背景视频中...', 'Downloading video...')}</div>
                                        <div className="text-xs text-white/50">{downloadProgress}%</div>
                                    </div>
                                ) : (
                                    <div className="text-white/50 text-sm">{t('准备中...', 'Loading...')}</div>
                                )}
                            </div>
                        )}
                    </>
                ) : (
                    <img
                        src={bgUrl}
                        alt="background"
                        className="h-full w-full scale-105 object-cover"
                        style={{ filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined }}
                    />
                )}
                <div className="absolute inset-0 bg-black/30" />
            </div>

            <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
                {isAdmin ? (
                    <button
                        onClick={() => {
                            openDialog('settings')
                        }}
                        className="p-1.5 text-white/90 transition-colors hover:text-white"
                        aria-label="settings"
                        title={t('设置', 'Settings')}
                    >
                        <Cog className="h-5 w-5" />
                    </button>
                ) : (
                    <button
                        onClick={() => openDialog('login')}
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

            {dialogs.contextMenu ? (
                <div className="fixed inset-0 z-30" onClick={() => closeDialog('contextMenu')}>
                    <div
                        className="fixed w-40 overflow-hidden rounded-lg border border-white/10 bg-black/70 text-white backdrop-blur"
                        style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
                            onClick={() => {
                                closeDialog('contextMenu')
                                openDialog('createGroup')
                            }}
                        >
                            {t('新建分组', 'New Group')}
                        </button>
                    </div>
                </div>
            ) : null}

            <LoginDialog
                open={dialogs.login}
                onClose={() => closeDialog('login')}
                onLogin={async (u, p) => {
                    await actions.login(u, p)
                }}
            />

            <SettingsDialog
                open={dialogs.settings}
                onClose={() => closeDialog('settings')}
                siteDraft={siteDraft}
                setSiteDraft={setSiteDraft}
                schedulePersistSiteDraft={schedulePersistSiteDraft}
                siteSaveErr={siteSaveErr}
                systemTimezone={systemTimezone}
                bgRefreshing={bgRefresh.refreshing}
                bgRefreshErr={bgRefresh.error}
                refreshBackground={bgRefresh.refresh}
                onLogout={onLogout}
            />

            <CreateGroupDialog
                open={dialogs.createGroup}
                onClose={() => closeDialog('createGroup')}
                onSubmit={async (name, kind) => {
                    await actions.createGroup(name, kind)
                }}
                hasSystemGroup={hasSystemGroup}
            />

            <AddItemDialog
                open={dialogs.addItem}
                onClose={() => closeDialog('addItem')}
                groupId={addItemGroupId}
                groupKind={addItemGroupKind}
                onSubmit={async (data) => {
                    await actions.createApp(data)
                }}
            />

            <EditItemDialog
                open={dialogs.edit}
                onClose={() => closeDialog('edit')}
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
                onSaveWidget={handleSaveWidget}
                widgetSaving={widgetSaving}
                wCity={wCity}
                setWCity={setWCity}
                setCityQuery={setCityQuery}
                cityOptions={citySearch.options}
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
