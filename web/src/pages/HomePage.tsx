import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../api'
import { Cog, Cpu, Download, HardDrive, MemoryStick, Trash2, Upload } from 'lucide-react'
import type { AppItem, BackgroundInfo, Group, HostMetrics, Settings, Weather } from '../types'

type Me = { admin: boolean }

type IconResolve = {
    title: string
    iconUrl: string
    iconPath: string
    iconSource: string
}

function useNow(tickMs: number) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), tickMs)
        return () => window.clearInterval(id)
    }, [tickMs])
    return now
}

function cityShort(label: string): string {
    const s = String(label ?? '').trim()
    if (!s) return ''
    const first = s.split(',')[0]?.split('，')[0]?.trim()
    return first || s
}

function ianaCityLabel(timezone: string): string {
    const tz = String(timezone || '').trim()
    if (!tz) return ''
    const last = tz.split('/').pop() || tz
    return last.replace(/_/g, ' ').trim()
}

function normalizeIanaTimeZone(tz: string, fallback: string): string {
    const candidate = String(tz || '').trim()
    if (!candidate) return fallback
    try {
        // Validate: Intl throws RangeError for invalid zones.
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0))
        return candidate
    } catch {
        return fallback
    }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    // Guard for older browsers where AbortController isn't available.
    if (typeof AbortController === 'undefined' || timeoutMs <= 0) {
        return await fetch(url, init)
    }
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } finally {
        window.clearTimeout(timeoutId)
    }
}

export default function HomePage({ initialDialog }: { initialDialog?: 'login' } = {}) {
    const [me, setMe] = useState<Me | null>(null)
    const [settings, setSettings] = useState<Settings | null>(null)
    const [bg, setBg] = useState<BackgroundInfo | null>(null)
    const [groups, setGroups] = useState<Group[]>([])
    const [apps, setApps] = useState<AppItem[]>([])
    const [weather, setWeather] = useState<Weather | null>(null)
    const [weatherErr, setWeatherErr] = useState<string | null>(null)
    const [weatherById, setWeatherById] = useState<Record<string, Weather | null>>({})
    const [weatherErrById, setWeatherErrById] = useState<Record<string, string | null>>({})
    const [metrics, setMetrics] = useState<HostMetrics | null>(null)
    const [netRate, setNetRate] = useState<{ upBps: number; downBps: number } | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [bgNonce, setBgNonce] = useState(0)
    const [bgRefreshing, setBgRefreshing] = useState(false)
    const [bgRefreshErr, setBgRefreshErr] = useState<string | null>(null)

    const [cityOptions, setCityOptions] = useState<string[]>([])
    const [cityQuery, setCityQuery] = useState('')

    const lastMetricsRef = useRef<HostMetrics | null>(null)

    const [loginOpen, setLoginOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [loginErr, setLoginErr] = useState<string | null>(null)
    const [username, setUsername] = useState('admin')
    const [password, setPassword] = useState('')

    const [ctxOpen, setCtxOpen] = useState(false)
    const [ctxPos, setCtxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [createGroupOpen, setCreateGroupOpen] = useState(false)
    const [newGroupName, setNewGroupName] = useState('')
    const [newGroupKind, setNewGroupKind] = useState<'system' | 'app'>('app')

    const [addItemOpen, setAddItemOpen] = useState(false)
    const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null)
    const [addItemGroupKind, setAddItemGroupKind] = useState<'system' | 'app'>('app')
    const [newAppName, setNewAppName] = useState('')
    const [newAppUrl, setNewAppUrl] = useState('')
    const [addErr, setAddErr] = useState<string | null>(null)

    const [editOpen, setEditOpen] = useState(false)
    const [editErr, setEditErr] = useState<string | null>(null)
    const [editItem, setEditItem] = useState<AppItem | null>(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editUrl, setEditUrl] = useState('')
    const [editIconMode, setEditIconMode] = useState<'auto' | 'url'>('auto')
    const [editIconUrl, setEditIconUrl] = useState('')
    const [iconResolving, setIconResolving] = useState(false)

    const [widgetKind, setWidgetKind] = useState<'weather' | 'timezones' | 'metrics' | null>(null)
    const [wCity, setWCity] = useState('')

    const [tzClocks, setTzClocks] = useState<Array<{ city: string; timezone: string }>>([
        { city: 'Tokyo, Tokyo, Japan', timezone: 'Asia/Tokyo' },
        { city: 'Paris, Île-de-France, France', timezone: 'Europe/Paris' },
        { city: 'New York, NY, United States', timezone: 'America/New_York' },
        { city: 'London, England, United Kingdom', timezone: 'Europe/London' },
    ])

    const [mShowCpu, setMShowCpu] = useState(true)
    const [mShowMem, setMShowMem] = useState(true)
    const [mShowDisk, setMShowDisk] = useState(true)
    const [mShowNet, setMShowNet] = useState(true)
    const [mRefreshSec, setMRefreshSec] = useState<1 | 5 | 10>(1)

    const [siteDraft, setSiteDraft] = useState<Pick<Settings, 'siteTitle' | 'background' | 'time' | 'language'> | null>(null)
    const [siteSaveErr, setSiteSaveErr] = useState<string | null>(null)

    const now = useNow(1000)
    // Timezone is now auto-detected from the user's system.

    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

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

    const onLogin = async (e: FormEvent) => {
        e.preventDefault()
        setLoginErr(null)
        try {
            await apiPost('/api/auth/login', { username, password })
            const m = await apiGet<Me>('/api/auth/me')
            setMe(m)
            setLoginOpen(false)
            await reloadDashboard()
        } catch (e2) {
            setLoginErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const openAddForGroup = (groupId: string | null) => {
        if (!isAdmin) return
        setAddErr(null)
        setAddItemGroupId(groupId)
        const g = groupId ? groups.find((x) => x.id === groupId) : null
        const kind = g && (g.kind === 'system' || g.name === '系统组件' || g.name === 'System Tools' || g.name === 'System Widgets') ? 'system' : 'app'
        setAddItemGroupKind(kind)
        setNewAppName('')
        setNewAppUrl('')
        setAddItemOpen(true)
    }

    const openEditItem = (item: AppItem) => {
        if (!isAdmin) return
        setEditErr(null)
        setEditItem(item)
        setEditName(item.name)
        setEditDesc(item.description ?? '')
        setEditUrl(item.url)
        setEditIconMode('auto')
        setEditIconUrl('')
        setIconResolving(false)

        const widgetType = item.url.startsWith('widget:') ? item.url.slice('widget:'.length) : null
        if (widgetType === 'weather' || widgetType === 'timezones' || widgetType === 'metrics') {
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
    const editItemDesc = editItem?.description

    useEffect(() => {
        if (!editOpen || !editItemUrl || !editItemUrl.startsWith('widget:')) return
        widgetLastSavedDescRef.current = String(editItemDesc ?? '')
    }, [editOpen, editItemUrl, editItemDesc])

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
            description = editDesc.trim() ? editDesc.trim() : null
        }

        let iconPath: string | null = editItem.iconPath
        let iconSource: string | null = editItem.iconSource

        if (!isWidget) {
            setIconResolving(true)
            try {
                if (editIconMode === 'auto') {
                    const res = await apiPost<IconResolve>('/api/icon/resolve', { url })
                    iconPath = res.iconPath || null
                    iconSource = res.iconSource || null
                } else if (editIconMode === 'url' && editIconUrl.trim()) {
                    const res = await apiPost<IconResolve>('/api/icon/resolve', { url: editIconUrl.trim() })
                    iconPath = res.iconPath || null
                    iconSource = res.iconSource || null
                }
            } catch {
                // keep existing icon if resolve fails
            } finally {
                setIconResolving(false)
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

    const createGroup = async (e: FormEvent) => {
        e.preventDefault()
        if (!isAdmin) return
        const name = newGroupName.trim()
        if (!name) return
        setAddErr(null)
        try {
            await apiPost('/api/groups', { name, kind: newGroupKind })
            setNewGroupName('')
            setCreateGroupOpen(false)
            await reloadDashboard()
        } catch (e2) {
            setAddErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const addWidget = async (kind: 'weather' | 'metrics' | 'timezones') => {
        if (!isAdmin) return
        setAddErr(null)
        const groupId = addItemGroupId
        const name =
            kind === 'weather'
                ? t('天气', 'Weather')
                : kind === 'metrics'
                    ? t('系统状态', 'System Status')
                    : t('世界时钟', 'World Clock')
        try {
            await apiPost('/api/apps', {
                groupId,
                name,
                url: `widget:${kind}`,
                iconPath: null,
                iconSource: null,
                description:
                    kind === 'weather'
                        ? JSON.stringify({ city: 'Shanghai, Shanghai, China' })
                        : kind === 'metrics'
                            ? JSON.stringify({ showCpu: true, showMem: true, showDisk: true, showNet: true, refreshSec: 1 })
                            : null,
            })
            setAddItemOpen(false)
            await reloadDashboard()
        } catch (e2) {
            setAddErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const addAppLink = async (e: FormEvent) => {
        e.preventDefault()
        if (!isAdmin) return
        setAddErr(null)
        const name = newAppName.trim()
        const url = newAppUrl.trim()
        if (!name || !url) return
        try {
            let iconPath: string | null = null
            let iconSource: string | null = null
            try {
                const res = await apiPost<IconResolve>('/api/icon/resolve', { url })
                iconPath = res.iconPath || null
                iconSource = res.iconSource || null
            } catch {
                // If icon resolution fails, still create the link.
            }
            await apiPost('/api/apps', {
                groupId: addItemGroupId,
                name,
                description: null,
                url,
                iconPath,
                iconSource,
            })
            setAddItemOpen(false)
            await reloadDashboard()
        } catch (e2) {
            setAddErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const saveSiteSettings = async (e: FormEvent) => {
        e.preventDefault()
        if (!isAdmin || !settings || !siteDraft) return
        setSiteSaveErr(null)
        try {
            const normalizedTime = siteDraft.time
                ? {
                    ...siteDraft.time,
                    mode: 'digital',
                    timezone: systemTimezone,
                }
                : siteDraft.time
            const next: Settings = {
                ...settings,
                siteTitle: siteDraft.siteTitle,
                language: siteDraft.language,
                background: siteDraft.background,
                time: normalizedTime,
            }
            await apiPut('/api/settings', next)
            setSettingsOpen(false)
            await reloadDashboard()
        } catch (e2) {
            setSiteSaveErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    // Avoid noisy 400s when not configured.
                    if (!settings?.weather?.city) {
                        if (!cancelled) setWeather(null)
                        if (!cancelled) setWeatherErr(null)
                        return
                    }
                    if (!cancelled) setWeatherErr(null)
                    const wx = await apiGet<Weather>(
                        `/api/widgets/weather?${new URLSearchParams({ city: settings.weather.city, lang }).toString()}`,
                    )
                    if (!cancelled) {
                        setWeather(wx)
                        setWeatherErr(null)
                    }
                } catch (e2) {
                    if (!cancelled) {
                        setWeather(null)
                        setWeatherErr(e2 instanceof Error ? e2.message : 'failed')
                    }
                }
            })()
        return () => {
            cancelled = true
        }
    }, [lang, settings?.weather.city])

    // Per-weather-widget fetch (supports multiple locations via query params).
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => a.url === 'widget:weather')
        if (ws.length === 0) {
            setWeatherById({})
            setWeatherErrById({})
            return
        }
        ; (async () => {
            const next: Record<string, Weather | null> = {}
            const nextErr: Record<string, string | null> = {}
            await Promise.all(
                ws.map(async (a) => {
                    const cfg = safeParseJSON(a.description)
                    const city = String(cfg?.city ?? '').trim()
                    if (!city) {
                        next[a.id] = null
                        nextErr[a.id] = null
                        return
                    }

                    // De-duplicate: system/default weather widget often matches the global setting.
                    // If so, let the widget fall back to `weather` state instead of refetching.
                    if (city === String(settings?.weather?.city ?? '').trim()) {
                        return
                    }
                    try {
                        const qs = new URLSearchParams({ city, lang })
                        const wx = await apiGet<Weather>(`/api/widgets/weather?${qs.toString()}`)
                        next[a.id] = wx
                        nextErr[a.id] = null
                    } catch (e2) {
                        next[a.id] = null
                        nextErr[a.id] = e2 instanceof Error ? e2.message : 'failed'
                    }
                }),
            )
            if (!cancelled) {
                setWeatherById(next)
                setWeatherErrById(nextErr)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [apps, lang])

    useEffect(() => {
        let cancelled = false

        const metricsWidgets = apps.filter((a) => a.url === 'widget:metrics')
        const intervalMs = (() => {
            if (metricsWidgets.length === 0) return 5000
            let best = 1000
            for (const a of metricsWidgets) {
                const cfg = safeParseJSON(a.description)
                const rs = Number(cfg?.refreshSec)
                const ms = (rs === 5 || rs === 10 ? rs : 1) * 1000
                best = Math.min(best, ms)
            }
            return best
        })()

        const run = async () => {
            try {
                const m = await apiGet<HostMetrics>('/api/metrics/host')
                if (cancelled) return
                const prev = lastMetricsRef.current
                if (
                    prev &&
                    typeof prev.collectedAt === 'number' &&
                    typeof m.collectedAt === 'number' &&
                    m.collectedAt > prev.collectedAt
                ) {
                    const dt = (m.collectedAt - prev.collectedAt) / 1000
                    if (dt > 0) {
                        const sentDiff = Math.max(0, m.netBytesSent - prev.netBytesSent)
                        const recvDiff = Math.max(0, m.netBytesRecv - prev.netBytesRecv)
                        setNetRate({ upBps: sentDiff / dt, downBps: recvDiff / dt })
                    }
                }
                lastMetricsRef.current = m
                setMetrics(m)
            } catch {
                if (!cancelled) {
                    setMetrics(null)
                    setNetRate(null)
                }
            }
        }
        run()
        const id = window.setInterval(run, intervalMs)
        return () => {
            cancelled = true
            window.clearInterval(id)
        }
    }, [apps])

    const sortedGroups = useMemo(() => {
        return [...groups].sort((a, b) => {
            const d1 = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            if (d1 !== 0) return d1
            const d2 = (a.createdAt ?? 0) - (b.createdAt ?? 0)
            if (d2 !== 0) return d2
            return String(a.id).localeCompare(String(b.id))
        })
    }, [groups])

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
        if (!editOpen) return
        if (widgetKind !== 'weather' && widgetKind !== 'timezones') return
        const q = (cityQuery || '').trim()
        if (!q) {
            setCityOptions([])
            return
        }
        const id = window.setTimeout(async () => {
            try {
                const reqLang = widgetKind === 'timezones' ? 'en' : lang
                const res = await apiGet<{ results: Array<{ displayName: string }> }>(
                    `/api/widgets/geocode?${new URLSearchParams({ query: q, lang: reqLang }).toString()}`,
                )
                const next = (res?.results || []).map((x) => x.displayName).filter(Boolean)
                setCityOptions(Array.from(new Set(next)).slice(0, 12))
            } catch {
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
            // Avoid spinning forever if the network/proxy hangs.
            const refreshRes = await fetchWithTimeout(
                '/api/background/refresh',
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

    // Force a reload when background provider changes; the image URL path stays the same.
    useEffect(() => {
        if (!settings?.background?.provider) return
        setBgNonce(Date.now())
    }, [settings?.background?.provider])

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
                <div className="mb-8 text-center">
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

                {error ? (
                    <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/80">
                        {error}
                    </div>
                ) : null}

                <div className="space-y-6">
                    {hasUngrouped ? (
                        <GroupBlock
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
                            metrics={metrics}
                            netRate={netRate}
                            localTimezone={systemTimezone}
                            lang={lang}
                        />
                    ) : null}

                    {sortedGroups.map((g) => (
                        <GroupBlock
                            key={g.id}
                            groupId={g.id}
                            name={displayGroupName(g.name)}
                            groupKind={g.kind || 'app'}
                            items={groupItems(g.id)}
                            isAdmin={isAdmin}
                            onAdd={openAddForGroup}
                            onEdit={openEditItem}
                            onDelete={deleteItem}
                            onReorder={reorderItems}
                            weather={weather}
                            weatherErr={weatherErr}
                            weatherById={weatherById}
                            weatherErrById={weatherErrById}
                            metrics={metrics}
                            netRate={netRate}
                            localTimezone={systemTimezone}
                            lang={lang}
                        />
                    ))}
                </div>
            </main>

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
                                setAddErr(null)
                                setNewGroupKind('app')
                                setCreateGroupOpen(true)
                            }}
                        >
                            {t('新建分组', 'New Group')}
                        </button>
                    </div>
                </div>
            ) : null}

            <Modal
                open={loginOpen}
                title={t('管理员登录', 'Admin Login')}
                onClose={() => setLoginOpen(false)}
                closeText={t('关闭', 'Close')}
                maxWidthClass="max-w-lg"
                containerClassName="items-start pt-[18vh] sm:pt-[22vh]"
            >
                {loginErr ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{loginErr}</div> : null}
                <form onSubmit={onLogin} className="space-y-3">
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('用户名', 'Username')}</div>
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                    </label>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('密码', 'Password')}</div>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                    </label>
                    <button type="submit" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20">
                        {t('登录', 'Login')}
                    </button>
                </form>
            </Modal>

            <Modal
                open={settingsOpen}
                title={t('系统设置', 'Settings')}
                onClose={() => setSettingsOpen(false)}
                closeText={t('关闭', 'Close')}
                maxWidthClass="max-w-lg"
                containerClassName="items-start pt-[18vh] sm:pt-[22vh]"
            >
                <div className="space-y-6">
                    <div className="mb-4 flex items-center justify-between">
                        <div className="text-sm text-white/70">{t('管理员', 'Admin')}</div>
                        <button
                            onClick={onLogout}
                            className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                        >
                            {t('登出', 'Logout')}
                        </button>
                    </div>
                    {siteSaveErr ? <div className="rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{siteSaveErr}</div> : null}
                    <form onSubmit={saveSiteSettings} className="space-y-6">
                        <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                            <div className="mb-3 text-sm font-semibold text-white/80">{t('通用', 'General')}</div>
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('标题', 'Title')}</div>
                                <input
                                    value={siteDraft?.siteTitle ?? ''}
                                    onChange={(e) => setSiteDraft((prev) => (prev ? { ...prev, siteTitle: e.target.value } : prev))}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="mt-3 block text-sm">
                                <div className="mb-1 text-white/70">{t('语言', 'Language')}</div>
                                <select
                                    value={siteDraft?.language || 'zh'}
                                    onChange={(e) => setSiteDraft((prev) => (prev ? { ...prev, language: e.target.value } : prev))}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                >
                                    <option value="zh">{t('中文', 'Chinese')}</option>
                                    <option value="en">{t('英文', 'English')}</option>
                                </select>
                            </label>
                        </section>

                        <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                            <div className="mb-3 text-sm font-semibold text-white/80">{t('时间', 'Time')}</div>
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-4">
                                    <label className="flex items-center gap-2 text-sm text-white/80">
                                        <input
                                            type="checkbox"
                                            checked={!!siteDraft?.time?.enabled}
                                            onChange={(e) =>
                                                setSiteDraft((prev) =>
                                                    prev
                                                        ? {
                                                            ...prev,
                                                            time: {
                                                                enabled: e.target.checked,
                                                                timezone: systemTimezone,
                                                                showSeconds: prev.time?.showSeconds ?? true,
                                                                mode: 'digital',
                                                            },
                                                        }
                                                        : prev,
                                                )
                                            }
                                        />
                                        {t('显示日期与时间', 'Show date & time')}
                                    </label>

                                    <label className={`flex items-center gap-2 text-sm ${siteDraft?.time?.enabled ? 'text-white/80' : 'text-white/40'}`}>
                                        <input
                                            type="checkbox"
                                            disabled={!siteDraft?.time?.enabled}
                                            checked={siteDraft?.time?.showSeconds ?? true}
                                            onChange={(e) =>
                                                setSiteDraft((prev) =>
                                                    prev
                                                        ? {
                                                            ...prev,
                                                            time: {
                                                                enabled: prev.time?.enabled ?? false,
                                                                timezone: systemTimezone,
                                                                showSeconds: e.target.checked,
                                                                mode: 'digital',
                                                            },
                                                        }
                                                        : prev,
                                                )
                                            }
                                        />
                                        {t('显示秒', 'Show seconds')}
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('当前时区', 'Current timezone')}</div>
                                        <TimezonePicker
                                            value={systemTimezone}
                                            onChange={() => {
                                                // Read-only: timezone is taken from the user's system/browser.
                                            }}
                                            options={[systemTimezone]}
                                            placeholder={systemTimezone}
                                        />
                                        <div className="mt-1 text-xs text-white/50">{t('自动从系统读取', 'Auto from system')}</div>
                                    </label>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                            <div className="mb-3 text-sm font-semibold text-white/80">{t('背景', 'Background')}</div>
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('背景来源', 'Provider')}</div>
                                        <select
                                            value={siteDraft?.background.provider ?? 'default'}
                                            onChange={(e) =>
                                                setSiteDraft((prev) =>
                                                    prev
                                                        ? {
                                                            ...prev,
                                                            background: {
                                                                ...prev.background,
                                                                provider: e.target.value,
                                                                interval:
                                                                    e.target.value === 'bing_daily'
                                                                        ? '24h'
                                                                        : e.target.value === 'default'
                                                                            ? '0'
                                                                            : prev.background.interval,
                                                            },
                                                        }
                                                        : prev,
                                                )
                                            }
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        >
                                            <option value="default">{t('系统默认', 'Default')}</option>
                                            <option value="bing_random">Bing Random</option>
                                            <option value="bing_daily">Bing Daily</option>
                                            <option value="picsum">Picsum</option>
                                        </select>
                                    </label>

                                    {siteDraft?.background.provider === 'bing_daily' || siteDraft?.background.provider === 'default' ? null : (
                                        <label className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('更新间隔', 'Refresh interval')}</div>
                                            <select
                                                value={siteDraft?.background.interval ?? '0'}
                                                onChange={(e) =>
                                                    setSiteDraft((prev) =>
                                                        prev ? { ...prev, background: { ...prev.background, interval: e.target.value } } : prev,
                                                    )
                                                }
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                            >
                                                <option value="0">{t('手动', 'Manual')}</option>
                                                <option value="1h">{t('1小时', '1 hour')}</option>
                                                <option value="3h">{t('3小时', '3 hours')}</option>
                                                <option value="6h">{t('6小时', '6 hours')}</option>
                                                <option value="12h">{t('12小时', '12 hours')}</option>
                                                <option value="24h">{t('每日', 'Daily')}</option>
                                            </select>
                                        </label>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={refreshBackground}
                                        disabled={bgRefreshing}
                                        className="inline-flex items-center rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-60"
                                    >
                                        {t('更新', 'Refresh')}
                                    </button>
                                    {bgRefreshing ? <Spinner /> : null}
                                    {bgRefreshErr ? (
                                        <span
                                            title={bgRefreshErr}
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/60 text-[12px] font-semibold leading-none text-red-400"
                                        >
                                            i
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </section>

                        <div className="flex flex-wrap gap-3">
                            <button type="submit" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20">
                                {t('保存', 'Save')}
                            </button>
                        </div>
                    </form>
                </div>
            </Modal>

            <Modal open={createGroupOpen} title={t('新建分组', 'New Group')} onClose={() => setCreateGroupOpen(false)} closeText={t('关闭', 'Close')}>
                {addErr ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{addErr}</div> : null}
                <form onSubmit={createGroup} className="space-y-3">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-2 text-sm font-semibold text-white/80">{t('分组类型', 'Group type')}</div>
                        <div className="flex flex-wrap gap-4 text-sm text-white/80">
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="group-kind"
                                    value="app"
                                    checked={newGroupKind === 'app'}
                                    onChange={() => setNewGroupKind('app')}
                                />
                                {t('App 组件', 'App group')}
                            </label>
                            <label className={`flex items-center gap-2 ${hasSystemGroup ? 'text-white/40' : ''}`}>
                                <input
                                    type="radio"
                                    name="group-kind"
                                    value="system"
                                    disabled={hasSystemGroup}
                                    checked={newGroupKind === 'system'}
                                    onChange={() => setNewGroupKind('system')}
                                />
                                {t('系统组件', 'System group')}
                            </label>
                        </div>
                        <div className="mt-2 text-xs text-white/50">
                            {t('系统组件只能有一个；系统组只能添加内置组件，App 组只能添加 App 链接。', 'Only one system group; system groups only allow widgets, app groups only allow app links.')}
                        </div>
                    </div>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('分组名称', 'Group name')}</div>
                        <input
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                    </label>
                    <button type="submit" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20">
                        {t('创建', 'Create')}
                    </button>
                </form>
            </Modal>

            <Modal open={addItemOpen} title={t('添加组件', 'Add Item')} onClose={() => setAddItemOpen(false)} closeText={t('关闭', 'Close')}>
                {addErr ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{addErr}</div> : null}
                {addItemGroupKind === 'system' ? (
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => addWidget('weather')}
                            className="h-10 rounded-lg border border-white/10 bg-black/40 px-2 text-xs hover:bg-black/30"
                        >
                            <div className="flex h-full w-full items-center justify-center text-center leading-tight">{t('天气', 'Weather')}</div>
                        </button>
                        <button
                            onClick={() => addWidget('timezones')}
                            className="h-10 rounded-lg border border-white/10 bg-black/40 px-2 text-xs hover:bg-black/30"
                        >
                            <div className="flex h-full w-full items-center justify-center text-center leading-tight">{t('世界时钟', 'World Clock')}</div>
                        </button>
                        <button
                            onClick={() => addWidget('metrics')}
                            className="h-10 rounded-lg border border-white/10 bg-black/40 px-2 text-xs hover:bg-black/30"
                        >
                            <div className="flex h-full w-full items-center justify-center text-center leading-tight">{t('系统状态', 'System Status')}</div>
                        </button>
                    </div>
                ) : (
                    <form onSubmit={addAppLink} className="space-y-3">
                        <label className="block text-sm">
                            <div className="mb-1 text-white/70">{t('名称', 'Name')}</div>
                            <input
                                value={newAppName}
                                onChange={(e) => setNewAppName(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>
                        <label className="block text-sm">
                            <div className="mb-1 text-white/70">URL</div>
                            <input
                                value={newAppUrl}
                                onChange={(e) => setNewAppUrl(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>
                        <button type="submit" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20">
                            {t('添加', 'Add')}
                        </button>
                    </form>
                )}
            </Modal>

            <Modal
                open={editOpen}
                title={t('组件设置', 'Item Settings')}
                onClose={() => setEditOpen(false)}
                closeText={t('关闭', 'Close')}
                maxWidthClass="max-w-lg"
                containerClassName="items-start pt-[18vh] sm:pt-[22vh]"
            >
                {editErr ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{editErr}</div> : null}
                {editItem ? (
                    <form
                        onSubmit={(e) => {
                            if (editItem.url.startsWith('widget:')) {
                                e.preventDefault()
                                return
                            }
                            saveItem(e)
                        }}
                        className="space-y-4"
                    >
                        {editItem.url.startsWith('widget:') ? null : (
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('标题', 'Title')}</div>
                                <input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>
                        )}

                        {editItem.url.startsWith('widget:') ? (
                            widgetKind === 'weather' ? (
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                        <div className="mb-2 text-sm font-semibold text-white/80">{t('位置', 'Location')}</div>
                                        <div className="grid grid-cols-1 gap-3">
                                            <label className="block text-sm">
                                                <div className="mb-1 text-white/70">{t('城市', 'City')}</div>
                                                <CityPicker
                                                    value={wCity}
                                                    onChange={(v) => {
                                                        setCityQuery(v)
                                                        setWCity(v)
                                                    }}
                                                    onPick={(picked) => {
                                                        // Keep the picked (usually full) label.
                                                        setCityQuery(picked)
                                                        setWCity(picked)
                                                    }}
                                                    options={cityOptions}
                                                    placeholder={t('例如：北京 / Tokyo / Paris', 'e.g. Shanghai / Tokyo / Paris')}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            ) : widgetKind === 'metrics' ? (
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('系统状态', 'System Status')}</div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <label className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('更新频率', 'Refresh interval')}</div>
                                            <select
                                                value={mRefreshSec}
                                                onChange={(e) => setMRefreshSec((Number(e.target.value) === 5 ? 5 : Number(e.target.value) === 10 ? 10 : 1) as 1 | 5 | 10)}
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                            >
                                                <option value={1}>{t('1 秒', '1s')}</option>
                                                <option value={5}>{t('5 秒', '5s')}</option>
                                                <option value={10}>{t('10 秒', '10s')}</option>
                                            </select>
                                        </label>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-3 text-sm">
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowCpu} onChange={(e) => setMShowCpu(e.target.checked)} />CPU</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowMem} onChange={(e) => setMShowMem(e.target.checked)} />{t('内存', 'Memory')}</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowDisk} onChange={(e) => setMShowDisk(e.target.checked)} />{t('磁盘', 'Disk')}</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowNet} onChange={(e) => setMShowNet(e.target.checked)} />{t('网络', 'Network')}</label>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="text-sm font-semibold text-white/80">{t('世界时钟', 'World Clock')}</div>
                                    <div className="space-y-2">
                                        {tzClocks.slice(0, 4).map((c, idx) => (
                                            <div key={idx} className="grid grid-cols-1 gap-2">
                                                <label className="block text-sm">
                                                    <div className="mb-1 text-white/70">{t('城市', 'City')} {idx + 1}</div>
                                                    <CityPicker
                                                        value={c.city}
                                                        onChange={(v) => {
                                                            setCityQuery(v)
                                                            setTzClocks((prev) => prev.map((x, i) => (i === idx ? { ...x, city: v } : x)))
                                                        }}
                                                        onPick={(picked) => {
                                                            // Resolve full display name + timezone only when user selects.
                                                            void (async () => {
                                                                try {
                                                                    const r = await resolveCityToTimezoneEn(picked)
                                                                    setTzClocks((prev) =>
                                                                        prev.map((x, i) =>
                                                                            i === idx
                                                                                ? {
                                                                                    ...x,
                                                                                    city: r.city,
                                                                                    timezone: r.timezone || x.timezone,
                                                                                }
                                                                                : x,
                                                                        ),
                                                                    )
                                                                } catch {
                                                                    // keep user input
                                                                }
                                                            })()
                                                        }}
                                                        options={cityOptions}
                                                    />
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        ) : (
                            <>
                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('描述', 'Description')}</div>
                                    <input
                                        value={editDesc}
                                        onChange={(e) => setEditDesc(e.target.value)}
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    />
                                </label>

                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('链接地址', 'URL')}</div>
                                    <input
                                        value={editUrl}
                                        onChange={(e) => setEditUrl(e.target.value)}
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    />
                                </label>

                                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('图标', 'Icon')}</div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setEditIconMode('auto')}
                                            className={
                                                editIconMode === 'auto'
                                                    ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                                    : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                            }
                                        >
                                            {t('从 URL 自动获取', 'Auto from URL')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setEditIconMode('url')}
                                            className={
                                                editIconMode === 'url'
                                                    ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                                    : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                            }
                                        >
                                            {t('使用图标 URL', 'Use Icon URL')}
                                        </button>
                                    </div>
                                    {editIconMode === 'url' ? (
                                        <div className="mt-3">
                                            <div className="mb-1 text-sm text-white/70">{t('图标 URL（可粘贴网络 svg/png 等）', 'Icon URL (svg/png, etc.)')}</div>
                                            <input
                                                value={editIconUrl}
                                                onChange={(e) => setEditIconUrl(e.target.value)}
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                            />
                                        </div>
                                    ) : null}

                                    {iconResolving ? (
                                        <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                                            <Spinner />
                                            {t('正在获取图标…', 'Resolving icon…')}
                                        </div>
                                    ) : null}
                                </div>
                            </>
                        )}

                        {editItem.url.startsWith('widget:') ? null : (
                            <button type="submit" disabled={iconResolving} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60">
                                {t('保存', 'Save')}
                            </button>
                        )}
                    </form>
                ) : null}
            </Modal>
        </div>
    )
}

function Modal({
    open,
    title,
    onClose,
    closeText,
    children,
    maxWidthClass,
    containerClassName,
}: {
    open: boolean
    title: string
    onClose: () => void
    closeText?: string
    children: ReactNode
    maxWidthClass?: string
    containerClassName?: string
}) {
    const [mounted, setMounted] = useState(open)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (open) {
            setMounted(true)
            // Next frame so transitions apply.
            const id = window.requestAnimationFrame(() => setVisible(true))
            return () => window.cancelAnimationFrame(id)
        }
        setVisible(false)
        const id = window.setTimeout(() => setMounted(false), 150)
        return () => window.clearTimeout(id)
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, onClose])

    if (!mounted) return null
    return (
        <div className="fixed inset-0 z-50">
            <div
                className={`absolute inset-0 bg-black/70 transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />
            <div className={`absolute inset-0 flex justify-center p-4 sm:p-6 ${containerClassName ?? 'items-start'}`}>
                <div
                    className={`w-full ${maxWidthClass ?? 'max-w-4xl'} overflow-hidden rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur transition-all duration-150 ${visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-[0.99] opacity-0'
                        }`}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="text-sm font-semibold">{title}</div>
                        <button
                            onClick={onClose}
                            className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 hover:bg-white/20"
                            aria-label="close"
                        >
                            {closeText ?? '关闭'}
                        </button>
                    </div>
                    <div className="max-h-[85vh] overflow-auto px-4 py-4">{children}</div>
                </div>
            </div>
        </div>
    )
}

function UserIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.418 0-8 2.015-8 4.5V20h16v-1.5C20 16.015 16.418 14 12 14Z"
                fill="currentColor"
                opacity="0.9"
            />
        </svg>
    )
}

function GroupBlock({
    groupId,
    name,
    groupKind,
    items,
    isAdmin,
    onAdd,
    onEdit,
    onDelete,
    onReorder,
    weather,
    weatherErr,
    weatherById,
    weatherErrById,
    metrics,
    netRate,
    localTimezone,
    lang,
}: {
    groupId: string | null
    name: string
    groupKind: 'system' | 'app' | string
    items: AppItem[]
    isAdmin: boolean
    onAdd: (groupId: string | null) => void
    onEdit: (item: AppItem) => void
    onDelete: (id: string) => void
    onReorder: (groupId: string | null, ids: string[]) => Promise<void>
    weather: Weather | null
    weatherErr: string | null
    weatherById?: Record<string, Weather | null>
    weatherErrById?: Record<string, string | null>
    metrics: HostMetrics | null
    netRate?: { upBps: number; downBps: number } | null
    localTimezone: string
    lang: 'zh' | 'en'
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null)

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const isSystemGroup = groupKind === 'system' || name === '系统组件' || name === 'System Tools' || name === 'System Widgets'
    const isWidgetItem = (it: AppItem) => !!it.url?.startsWith('widget:')
    const isSystemWidgetsOnly = isSystemGroup && items.length > 0 && items.every(isWidgetItem)

    const renderItems = useMemo(() => {
        if (!isSystemWidgetsOnly) return items
        const byWidget = new Map<string, AppItem>()
        for (const it of items) {
            const widget = it.url?.startsWith('widget:') ? it.url.slice('widget:'.length) : null
            if (!widget) continue
            if (!byWidget.has(widget)) byWidget.set(widget, it)
        }
        const ordered: AppItem[] = []
        for (const k of ['weather', 'timezones', 'metrics']) {
            const it = byWidget.get(k)
            if (it) ordered.push(it)
        }
        // Append any unexpected widgets to keep behavior safe.
        for (const it of items) {
            if (!ordered.includes(it)) ordered.push(it)
        }
        return ordered
    }, [isSystemWidgetsOnly, items])

    const dragItems = isSystemWidgetsOnly ? renderItems : items

    const getNextOrder = (fromId: string, toId: string) => {
        const ids = dragItems.map((it) => it.id)
        const fromIndex = ids.indexOf(fromId)
        const toIndex = ids.indexOf(toId)
        if (fromIndex < 0 || toIndex < 0) return null
        if (fromIndex === toIndex) return null

        const next = [...ids]
        next.splice(fromIndex, 1)
        const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
        next.splice(insertAt, 0, fromId)
        return next
    }

    return (
        <div className="group">
            <div className="mb-3 flex items-center gap-2">
                <h2 className="text-base font-semibold text-white/80">{name}</h2>
                {isAdmin ? (
                    <button
                        onClick={() => onAdd(groupId)}
                        className="invisible rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 shadow-sm shadow-black/20 transition-colors transition-shadow hover:bg-white/20 hover:shadow-lg hover:shadow-black/30 group-hover:visible"
                        aria-label="add"
                        title={t('添加', 'Add')}
                    >
                        +
                    </button>
                ) : null}
            </div>
            <div
                className={
                    isSystemWidgetsOnly
                        ? 'grid grid-cols-2 gap-3 sm:grid-cols-3'
                        : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
                }
            >
                {items.length === 0 ? (
                    <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-white/60">{t('暂无内容', 'No items')}</div>
                ) : (
                    renderItems.map((a) => {
                        const widget = a.url?.startsWith('widget:') ? a.url.slice('widget:'.length) : null
                        if (widget) {
                            const cfg = safeParseJSON(a.description)
                            const widgetCardClass =
                                isSystemWidgetsOnly
                                    ? widget === 'timezones'
                                        ? 'col-span-2 sm:col-span-1'
                                        : widget === 'weather'
                                            ? 'col-span-2 sm:col-span-1'
                                            : widget === 'metrics'
                                                ? 'col-span-2 sm:col-span-1'
                                                : 'col-span-2'
                                    : widget === 'timezones'
                                        ? 'col-span-2 sm:col-span-3 lg:col-span-2'
                                        : widget === 'metrics'
                                            ? 'col-span-2 sm:col-span-1'
                                            : ''

                            const widgetFixedHeightClass = isSystemWidgetsOnly ? 'h-[174px] sm:h-[194px]' : ''

                            const widgetPadClass =
                                widget === 'timezones' ? 'p-4' : widget === 'weather' ? 'p-4' : 'p-4'

                            return (
                                <div
                                    key={a.id}
                                    className={`group/card relative flex flex-col rounded-2xl border border-white/10 bg-black/40 ${widgetPadClass} transition-colors transition-shadow hover:bg-black/30 hover:shadow-lg hover:shadow-black/20 ${widgetCardClass} ${widgetFixedHeightClass} ${isAdmin && !isSystemWidgetsOnly ? 'cursor-move' : ''} ${draggingId === a.id ? 'opacity-80' : ''}`}
                                    draggable={isAdmin && !isSystemWidgetsOnly}
                                    onDragStart={(e) => {
                                        if (isSystemWidgetsOnly) return
                                        if (!isAdmin) return
                                        setDraggingId(a.id)
                                        e.dataTransfer.effectAllowed = 'move'
                                        e.dataTransfer.setData('text/plain', a.id)
                                    }}
                                    onDragEnd={() => setDraggingId(null)}
                                    onDragOver={(e) => {
                                        if (isSystemWidgetsOnly) return
                                        if (!isAdmin) return
                                        const fromId = draggingId || e.dataTransfer.getData('text/plain')
                                        if (!fromId || fromId === a.id) return
                                        if (dragItems.findIndex((it) => it.id === fromId) < 0) return
                                        e.preventDefault()
                                        e.dataTransfer.dropEffect = 'move'
                                    }}
                                    onDrop={async (e) => {
                                        if (isSystemWidgetsOnly) return
                                        if (!isAdmin) return
                                        e.preventDefault()
                                        const fromId = draggingId || e.dataTransfer.getData('text/plain')
                                        setDraggingId(null)
                                        if (!fromId || fromId === a.id) return
                                        const next = getNextOrder(fromId, a.id)
                                        if (!next) return
                                        await onReorder(groupId, next)
                                    }}
                                >
                                    {isAdmin ? (
                                        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                            <button
                                                className="rounded-lg bg-black/40 p-1 text-white/90 shadow-sm shadow-black/30 hover:bg-black/60"
                                                aria-label="edit"
                                                title={t('设置', 'Edit')}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onEdit(a)
                                                }}
                                            >
                                                <Cog className="h-4 w-4" />
                                            </button>
                                            <button
                                                className="rounded-lg bg-black/40 p-1 text-white/90 shadow-sm shadow-black/30 hover:bg-black/60"
                                                aria-label="delete"
                                                title={t('删除', 'Delete')}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onDelete(a.id)
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : null}
                                    <div className="mb-3 truncate whitespace-nowrap text-sm font-semibold leading-tight text-white/90">
                                        {widget === 'weather'
                                            ? t('天气', 'Weather')
                                            : widget === 'metrics'
                                                ? t('系统状态', 'System Status')
                                                : t('世界时钟', 'World Clock')}
                                    </div>
                                    <div className="min-h-0 flex-1">
                                        {widget === 'weather' ? (
                                            <WeatherWidget
                                                data={(weatherById?.[a.id] ?? weather) || null}
                                                error={(weatherErrById?.[a.id] ?? weatherErr) || null}
                                                lang={lang}
                                            />
                                        ) : widget === 'metrics' ? (
                                            metrics ? (
                                                <div className="space-y-3 text-xs text-white/85">
                                                    {cfg?.showCpu !== false ? (
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2"><Cpu className="h-4 w-4 text-white/70" />CPU</span>
                                                            <span className="text-right">
                                                                {metrics.cpuModel ? <span className="mr-1">{metrics.cpuModel} ·</span> : null}
                                                                <span className="tabular-nums">{metrics.cpuPercent.toFixed(1)}%</span>
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                    {cfg?.showMem !== false ? (
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2"><MemoryStick className="h-4 w-4 text-white/70" />{t('内存', 'Memory')}</span>
                                                            <span className="tabular-nums">
                                                                {formatGiB(metrics.memUsed)}/{formatGiB(metrics.memTotal)} · {metrics.memPercent.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                    {cfg?.showDisk !== false ? (
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-white/70" />{t('磁盘', 'Disk')}</span>
                                                            <span className="tabular-nums">
                                                                {formatGiB(metrics.diskUsed)}/{formatGiB(metrics.diskTotal)} · {metrics.diskPercent.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    {cfg?.showNet !== false ? (
                                                        <>
                                                            <div className="flex items-center justify-between">
                                                                <span className="flex items-center gap-2 text-white/85"><Upload className="h-4 w-4 text-white/70" />{t('上传', 'Upload')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.upBps) : '—'}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span className="flex items-center gap-2 text-white/85"><Download className="h-4 w-4 text-white/70" />{t('下载', 'Download')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.downBps) : '—'}</span>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-sm text-white/60">{t('暂不可用', 'Unavailable')}</div>
                                            )
                                        ) : (
                                            <TimezonesWidget localTimezone={localTimezone} clocks={clocksFromCfg(cfg)} />
                                        )}
                                    </div>
                                </div>
                            )
                        }

                        return (
                            <div
                                key={a.id}
                                className={`group/card relative ${isAdmin ? 'cursor-move' : ''} ${draggingId === a.id ? 'opacity-80' : ''}`}
                                draggable={isAdmin}
                                onDragStart={(e) => {
                                    if (!isAdmin) return
                                    setDraggingId(a.id)
                                    e.dataTransfer.effectAllowed = 'move'
                                    e.dataTransfer.setData('text/plain', a.id)
                                }}
                                onDragEnd={() => setDraggingId(null)}
                                onDragOver={(e) => {
                                    if (!isAdmin) return
                                    const fromId = draggingId || e.dataTransfer.getData('text/plain')
                                    if (!fromId || fromId === a.id) return
                                    if (dragItems.findIndex((it) => it.id === fromId) < 0) return
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                }}
                                onDrop={async (e) => {
                                    if (!isAdmin) return
                                    e.preventDefault()
                                    const fromId = draggingId || e.dataTransfer.getData('text/plain')
                                    setDraggingId(null)
                                    if (!fromId || fromId === a.id) return
                                    const next = getNextOrder(fromId, a.id)
                                    if (!next) return
                                    await onReorder(groupId, next)
                                }}
                            >
                                {isAdmin ? (
                                    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                        <button
                                            className="rounded-lg bg-black/40 p-1 text-white/90 shadow-sm shadow-black/30 hover:bg-black/60"
                                            aria-label="edit"
                                            title={t('设置', 'Edit')}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                onEdit(a)
                                            }}
                                        >
                                            <Cog className="h-4 w-4" />
                                        </button>
                                        <button
                                            className="rounded-lg bg-black/40 p-1 text-white/90 shadow-sm shadow-black/30 hover:bg-black/60"
                                            aria-label="delete"
                                            title={t('删除', 'Delete')}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                onDelete(a.id)
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ) : null}

                                <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    draggable={false}
                                    className="group block rounded-2xl border border-white/10 bg-black/40 p-3 transition-colors transition-shadow hover:bg-black/30 hover:shadow-lg hover:shadow-black/20"
                                >
                                    <div className="flex items-center gap-3">
                                        {a.iconPath ? (
                                            <img
                                                src={`/assets/icons/${a.iconPath}`}
                                                alt=""
                                                className="h-9 w-9 rounded-lg bg-white/10 object-contain"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-semibold">
                                                {a.name.slice(0, 1).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-white">{a.name}</div>
                                            {a.description ? (
                                                <div className="mt-1 line-clamp-2 text-xs text-white/70">{a.description}</div>
                                            ) : (
                                                <div className="truncate text-xs text-white/60">{a.url}</div>
                                            )}
                                        </div>
                                    </div>
                                </a>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function TimezonePicker({
    value,
    onChange,
    options,
    placeholder,
}: {
    value: string
    onChange: (v: string) => void
    options: string[]
    placeholder?: string
}) {
    return (
        <ComboBox<string>
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            getOptionLabel={(s) => s}
            onPick={(s) => onChange(s)}
        />
    )
}

function ComboBox<T>({
    value,
    onChange,
    options,
    placeholder,
    getOptionLabel,
    onPick,
}: {
    value: string
    onChange: (v: string) => void
    options: T[]
    placeholder?: string
    getOptionLabel: (opt: T) => string
    onPick: (opt: T) => void
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const inputId = useId()

    useEffect(() => {
        setQuery(value)
    }, [value])

    const filtered = useMemo(() => {
        const q = (query || '').trim().toLowerCase()
        const list = q
            ? options
                .map((o) => ({ o, label: getOptionLabel(o) }))
                .filter(({ label }) => label.toLowerCase().includes(q))
                .slice(0, 20)
            : options.map((o) => ({ o, label: getOptionLabel(o) })).slice(0, 12)
        return list
    }, [query, options, getOptionLabel])

    return (
        <div className="relative">
            <input
                id={inputId}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false)
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                autoComplete="off"
            />
            {open && filtered.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-white/10 bg-black/80 text-white shadow-lg shadow-black/40 backdrop-blur">
                    <div className="max-h-56 overflow-auto py-1">
                        {filtered.map(({ o, label }) => (
                            <button
                                key={label}
                                type="button"
                                className="flex w-full items-center px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                                onMouseDown={(e) => {
                                    // prevent blur before click
                                    e.preventDefault()
                                    onPick(o)
                                    setOpen(false)
                                }}
                            >
                                {highlightMatch(label, query)}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
            {open ? (
                <div
                    className="fixed inset-0 z-40"
                    onMouseDown={() => setOpen(false)}
                    aria-hidden="true"
                />
            ) : null}
        </div>
    )
}

function highlightMatch(text: string, query: string): ReactNode {
    const q = (query || '').trim()
    if (!q) return text
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i < 0) return text
    const pre = text.slice(0, i)
    const mid = text.slice(i, i + q.length)
    const post = text.slice(i + q.length)
    return (
        <>
            <span className="text-white/80">{pre}</span>
            <span className="font-semibold text-white">{mid}</span>
            <span className="text-white/80">{post}</span>
        </>
    )
}

function Spinner() {
    return (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

function safeParseJSON(input: string | null): Record<string, unknown> | null {
    if (!input) return null
    try {
        const v: unknown = JSON.parse(input)
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
        return null
    }
}

function TimeDisplay({
    now,
    timezone,
    showSeconds,
    mode,
}: {
    now: number
    timezone: string
    showSeconds: boolean
    mode: string
}) {
    const d = new Date(now)
    const dateStr = ymdKey(d, timezone)

    if (mode === 'clock') {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(d)
        const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
        const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
        const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')

        const hourAngle = ((hh % 12) + mm / 60) * 30
        const minuteAngle = (mm + ss / 60) * 6
        const secondAngle = ss * 6

        return (
            <div className="flex items-center gap-3 rounded-full bg-white/5 px-3 py-1.5 text-white/85 shadow-sm shadow-black/20">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.9" />
                    <g transform={`rotate(${hourAngle} 12 12)`}>
                        <path d="M12 12V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </g>
                    <g transform={`rotate(${minuteAngle} 12 12)`}>
                        <path d="M12 12V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
                    </g>
                    {showSeconds ? (
                        <g transform={`rotate(${secondAngle} 12 12)`}>
                            <path d="M12 12V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
                        </g>
                    ) : null}
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                </svg>
                <div className="text-base font-medium tabular-nums">
                    <span className="inline-block w-[10ch]">{dateStr}</span>
                    <span className={`ml-1.5 inline-block ${showSeconds ? 'w-[8ch]' : 'w-[5ch]'}`}>{formatTime(now, timezone, showSeconds)}</span>
                </div>
                <div className="hidden text-sm text-white/60 sm:block">{timezone}</div>
            </div>
        )
    }

    return (
        <div className="rounded-full bg-white/5 px-3 py-1.5 text-base font-medium text-white/85 shadow-sm shadow-black/20 tabular-nums">
            <span className="inline-block w-[10ch]">{dateStr}</span>
            <span className={`ml-1.5 inline-block ${showSeconds ? 'w-[8ch]' : 'w-[5ch]'}`}>{formatTime(now, timezone, showSeconds)}</span>
            <span className="ml-2 hidden text-sm font-normal text-white/60 sm:inline">{timezone}</span>
        </div>
    )
}

function WeatherWidget({ data, error, lang }: { data: Weather | null; error?: string | null; lang: 'zh' | 'en' }) {
    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-sm text-white/60">{msg}</div>
        // Keep the card height stable and avoid looking like the frame "grows" when data arrives.
        return <div className="flex h-full items-center justify-center text-sm text-white/60">{lang === 'en' ? 'Loading…' : '加载中…'}</div>
    }
    const cond = weatherCodeLabel(data.weatherCode, lang)

    const daily = (Array.isArray(data.daily) ? data.daily : []).slice(0, 5)

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-3">
                <WeatherGlyph code={data.weatherCode} windKph={data.windSpeedKph} size={42} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{cityShort(data.city) || (lang === 'en' ? 'Configured location' : '已配置位置')}</div>
                    <div className="mt-1 flex items-baseline gap-3 overflow-hidden text-white/80">
                        <span className="text-xl font-semibold text-white">{data.temperatureC.toFixed(1)}°C</span>
                        <span className="min-w-0 truncate text-sm text-white/70">{cond}</span>
                        <span className="shrink-0 whitespace-nowrap text-sm text-white/70">{lang === 'en' ? 'Wind' : '风'} {data.windSpeedKph.toFixed(1)} km/h</span>
                    </div>
                </div>
            </div>

            {daily.length ? (
                <div className="-mt-1 grid grid-cols-5 gap-2">
                    {daily.map((d) => (
                        <div key={d.date} className="flex flex-col items-center gap-1 px-1.5 py-1 text-center">
                            <div className="text-[12px] leading-tight text-white/65">{weekdayLabel(d.date, lang)}</div>
                            <WeatherGlyph code={d.weatherCode ?? 0} windKph={0} size={30} />
                            <div className="tabular-nums text-[12px] leading-tight text-white/80">
                                <span className="text-white/90">{Math.round(d.tempMaxC)}°</span>
                                <span className="text-white/50">/{Math.round(d.tempMinC)}°</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function WeatherGlyph({ code, windKph, size = 40 }: { code: number; windKph: number; size?: number }) {
    const kind = weatherKind(code)
    if (kind === 'sun') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="animate-pulse text-white/90">
                    <path d="M12 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M12 19v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M2 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M4.2 4.2l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M17.7 17.7l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M19.8 4.2l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M6.3 17.7l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </g>
            </svg>
        )
    }
    if (kind === 'rain') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90">
                    <path d="M9 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" />
                    <path d="M13 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '120ms' }} />
                    <path d="M17 18l-1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-bounce" style={{ animationDelay: '240ms' }} />
                </g>
            </svg>
        )
    }
    if (kind === 'snow') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <g className="text-white/90 animate-pulse">
                    <circle cx="9" cy="19" r="1" fill="currentColor" />
                    <circle cx="13" cy="19" r="1" fill="currentColor" />
                    <circle cx="17" cy="19" r="1" fill="currentColor" />
                </g>
            </svg>
        )
    }
    if (kind === 'storm') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
                <path d="M13 16l-2 4h2l-1 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white animate-pulse" />
            </svg>
        )
    }
    if (kind === 'fog') {
        return (
            <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/90" />
                <path d="M6 16h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/70" />
                <path d="M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/60" />
            </svg>
        )
    }
    // clouds / default
    return (
        <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.8 1.3A3.5 3.5 0 0 1 17.5 16H7Z" stroke="currentColor" strokeWidth="2" className="text-white" />
            {windKph >= 18 ? (
                <path d="M5 19h9c2 0 2-2 0-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/80 animate-pulse" />
            ) : null}
        </svg>
    )
}

function weatherKind(code: number): 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' {
    if (code === 0) return 'sun'
    if (code === 1 || code === 2 || code === 3) return 'cloud'
    if (code === 45 || code === 48) return 'fog'
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
    if (code >= 95) return 'storm'
    return 'cloud'
}

type WorldClockCity = { city: string; timezone: string }

const DEFAULT_CLOCKS: WorldClockCity[] = [
    { city: 'Tokyo, Tokyo, Japan', timezone: 'Asia/Tokyo' },
    { city: 'Paris, Île-de-France, France', timezone: 'Europe/Paris' },
    { city: 'New York, NY, United States', timezone: 'America/New_York' },
    { city: 'London, England, United Kingdom', timezone: 'Europe/London' },
]

function TimezonesWidget({ localTimezone, clocks }: { localTimezone: string; clocks: WorldClockCity[] }) {
    const smoothNow = useNow(200)

    // English-only: do not translate or localize labels; keep it deterministic.
    const labels = useMemo(() => {
        return clocks.map((c) => {
            const tzLabel = ianaCityLabel(String(c.timezone ?? '').trim())
            if (tzLabel) return tzLabel
            const raw = String(c.city ?? '').trim()
            return cityShort(raw) || raw
        })
    }, [clocks])

    return (
        <div className="flex h-full w-full flex-col justify-start pt-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3">
                {clocks.map((c, idx) => {
                    const meta = tzDeltaMeta(smoothNow, localTimezone, c.timezone)
                    return (
                        <div key={`${c.timezone}-${idx}`} className="flex w-full flex-col items-center text-center">
                            <AppleClock now={smoothNow} timezone={c.timezone} day={meta.isDay} />
                            <div className="mt-1 text-[12px] font-semibold leading-tight text-white/90">{labels[idx] || cityShort(c.city) || c.city}</div>
                            <div className="text-[11px] leading-tight text-white/60">{meta.dayLabel}</div>
                            <div className="text-[11px] leading-tight text-white/60">{meta.offsetLabel}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function clocksFromCfg(cfg: unknown): WorldClockCity[] {
    const cfgObj = typeof cfg === 'object' && cfg !== null ? (cfg as Record<string, unknown>) : null
    const clocks = cfgObj && Array.isArray(cfgObj.clocks) ? (cfgObj.clocks as unknown[]) : null
    if (!clocks) return DEFAULT_CLOCKS
    const normalized = clocks
        .slice(0, 4)
        .map((c, i) => {
            const obj = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : null
            return {
                city: String(obj?.city ?? '').trim() || DEFAULT_CLOCKS[i]?.city || `City ${i + 1}`,
                timezone: String(obj?.timezone ?? '').trim() || DEFAULT_CLOCKS[i]?.timezone || 'UTC',
            }
        })
    while (normalized.length < 4) normalized.push(DEFAULT_CLOCKS[normalized.length] || { city: `City ${normalized.length + 1}`, timezone: 'UTC' })
    return normalized
}

function AppleClock({ now, timezone, day }: { now: number; timezone: string; day: boolean }) {
    const d = new Date(now)
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d)
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
    const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')

    const msFrac = d.getMilliseconds() / 1000

    const hourAngle = ((hh % 12) + mm / 60) * 30
    const minuteAngle = (mm + ss / 60) * 6
    const secondAngle = (ss + msFrac) * 6

    // Keep it consistent with the overall dark UI: day is just slightly brighter.
    const bg = day ? 'bg-white/10' : 'bg-black/70'
    const fg = 'text-white'
    const stroke = day ? 'text-white/90' : 'text-white/70'

    const numbers: Array<{ n: number; x: number; y: number; big?: boolean }> = [
        { n: 12, x: 50, y: 13, big: true },
        { n: 1, x: 65, y: 17 },
        { n: 2, x: 76, y: 28 },
        { n: 3, x: 80, y: 50, big: true },
        { n: 4, x: 76, y: 72 },
        { n: 5, x: 65, y: 83 },
        { n: 6, x: 50, y: 87, big: true },
        { n: 7, x: 35, y: 83 },
        { n: 8, x: 24, y: 72 },
        { n: 9, x: 20, y: 50, big: true },
        { n: 10, x: 24, y: 28 },
        { n: 11, x: 35, y: 17 },
    ]

    return (
        <div className={`h-[72px] w-[72px] rounded-full ${bg} ${fg} shadow-sm shadow-black/30 ring-1 ${day ? 'ring-white/10' : 'ring-white/5'}`}>
            <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
                {numbers.map(({ n, x, y, big }) => (
                    <text
                        key={n}
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={big ? 11 : 8}
                        fontFamily="ui-sans-serif, system-ui"
                        fill="currentColor"
                        opacity={day ? 0.9 : 0.65}
                    >
                        {n}
                    </text>
                ))}

                <g transform={`rotate(${hourAngle} 50 50)`}>
                    <line x1="50" y1="52" x2="50" y2="29" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={stroke} />
                </g>
                <g transform={`rotate(${minuteAngle} 50 50)`}>
                    <line x1="50" y1="54" x2="50" y2="18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={stroke} />
                </g>
                <g transform={`rotate(${secondAngle} 50 50)`}>
                    <line x1="50" y1="58" x2="50" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={stroke} opacity={day ? 0.7 : 0.55} />
                </g>
                <circle cx="50" cy="50" r="3" fill="currentColor" className={stroke} />
            </svg>
        </div>
    )
}

function CityPicker({
    value,
    onChange,
    onPick,
    options,
    placeholder,
}: {
    value: string
    onChange: (v: string) => void
    onPick?: (v: string) => void
    options: string[]
    placeholder?: string
}) {
    return (
        <ComboBox<string>
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            getOptionLabel={(s) => s}
            onPick={(s) => {
                onChange(s)
                onPick?.(s)
            }}
        />
    )
}

function tzDeltaMeta(
    now: number,
    localTz: string,
    otherTz: string,
): { dayLabel: string; offsetLabel: string; isDay: boolean } {
    const d = new Date(now)
    const safeLocal = normalizeIanaTimeZone(localTz, 'Asia/Shanghai')
    const safeOther = normalizeIanaTimeZone(otherTz, 'UTC')
    const localKey = ymdKey(d, safeLocal)
    const otherKey = ymdKey(d, safeOther)

    const dayLabel = otherKey > localKey ? 'Tomorrow' : otherKey < localKey ? 'Yesterday' : 'Today'

    const diffMin = timeZoneOffsetMinutes(safeOther, d) - timeZoneOffsetMinutes(safeLocal, d)
    const diffHours = Math.round(diffMin / 60)
    const abs = Math.abs(diffHours)
    const suffix = abs === 1 ? 'HR' : 'HRS'
    const offsetLabel = diffHours === 0 ? '0HRS' : `${diffHours > 0 ? '+' : '-'}${abs}${suffix}`

    const otherHour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: safeOther, hour: '2-digit', hourCycle: 'h23' })
            .formatToParts(d)
            .find((p) => p.type === 'hour')?.value || '0',
    )
    const isDay = otherHour >= 7 && otherHour <= 18

    return { dayLabel, offsetLabel, isDay }
}

function ymdKey(d: Date, tz: string): string {
    const safeTz = normalizeIanaTimeZone(tz, 'Asia/Shanghai')
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value || '0000'
    const m = parts.find((p) => p.type === 'month')?.value || '00'
    const da = parts.find((p) => p.type === 'day')?.value || '00'
    return `${y}-${m}-${da}`
}

function timeZoneOffsetMinutes(tz: string, d: Date): number {
    const safeTz = normalizeIanaTimeZone(tz, 'UTC')
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: safeTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d)
    const y = Number(parts.find((p) => p.type === 'year')?.value || '0')
    const m = Number(parts.find((p) => p.type === 'month')?.value || '1')
    const da = Number(parts.find((p) => p.type === 'day')?.value || '1')
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
    const ss = Number(parts.find((p) => p.type === 'second')?.value || '0')
    const asUTC = Date.UTC(y, m - 1, da, hh, mm, ss)
    return Math.round((asUTC - d.getTime()) / 60000)
}

function formatTime(now: number, timezone: string, showSeconds: boolean): string {
    const safeTz = normalizeIanaTimeZone(timezone, 'Asia/Shanghai')
    const opt: Intl.DateTimeFormatOptions = {
        timeZone: safeTz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }
    if (showSeconds) opt.second = '2-digit'
    return new Intl.DateTimeFormat(undefined, opt).format(new Date(now))
}

function weatherCodeLabel(code: number, lang: 'zh' | 'en'): string {
    // Minimal Open-Meteo WMO mapping.
    const zh = {
        clear: '晴',
        partly: '多云',
        overcast: '阴',
        fog: '雾',
        rain: '雨',
        snow: '雪',
        storm: '雷暴',
        code: (c: number) => `天气码 ${c}`,
    }
    const en = {
        clear: 'Clear',
        partly: 'Partly cloudy',
        overcast: 'Overcast',
        fog: 'Fog',
        rain: 'Rain',
        snow: 'Snow',
        storm: 'Thunderstorm',
        code: (c: number) => `Code ${c}`,
    }
    const dict = lang === 'en' ? en : zh
    if (code === 0) return dict.clear
    if (code === 1 || code === 2) return dict.partly
    if (code === 3) return dict.overcast
    if (code === 45 || code === 48) return dict.fog
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return dict.rain
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return dict.snow
    if (code >= 95) return dict.storm
    return dict.code(code)
}

function weekdayLabel(dateStr: string, lang: 'zh' | 'en'): string {
    // Open-Meteo daily time is usually YYYY-MM-DD.
    const d = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' }).format(d)
}

function formatBytesPerSec(bps: number): string {
    if (!Number.isFinite(bps) || bps < 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = bps
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2
    return `${v.toFixed(digits)} ${units[i]}/s`
}

function formatGiB(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    const gib = bytes / (1024 * 1024 * 1024)
    return `${Math.round(gib)}GiB`
}
