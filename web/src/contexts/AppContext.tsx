import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { AppItem, BackgroundInfo, Group, Settings } from '../types'
import { apiGet, apiPost, apiPut, apiDelete } from '../api'

type Me = { admin: boolean }

interface AppContextType {
    // State
    me: Me | null
    settings: Settings | null
    bg: BackgroundInfo | null
    groups: Group[]
    apps: AppItem[]
    loading: boolean
    error: string | null
    lang: 'zh' | 'en'

    // Computed
    isAdmin: boolean

    // Actions
    reload: () => Promise<void>
    login: (username: string, password: string) => Promise<void>
    logout: () => Promise<void>
    updateSettings: (settings: Settings) => Promise<void>
    createGroup: (name: string, kind: 'system' | 'app') => Promise<Group>
    updateGroup: (id: string, name: string) => Promise<void>
    deleteGroup: (id: string) => Promise<void>
    reorderGroups: (ids: string[]) => Promise<void>
    createApp: (data: CreateAppData) => Promise<AppItem>
    updateApp: (id: string, data: UpdateAppData) => Promise<void>
    deleteApp: (id: string) => Promise<void>
    reorderApps: (groupId: string | null, ids: string[]) => Promise<void>
    refreshBackground: (provider?: string) => Promise<void>
    setError: (error: string | null) => void

    // Translation helper
    t: (zh: string, en: string) => string
}

interface CreateAppData {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

interface UpdateAppData {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
    const [me, setMe] = useState<Me | null>(null)
    const [settings, setSettings] = useState<Settings | null>(null)
    const [bg, setBg] = useState<BackgroundInfo | null>(null)
    const [groups, setGroups] = useState<Group[]>([])
    const [apps, setApps] = useState<AppItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'
    const isAdmin = !!me?.admin

    const t = useCallback(
        (zh: string, en: string) => (lang === 'en' ? en : zh),
        [lang]
    )

    const reload = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const [meRes, settingsRes, bgRes, groupsRes, appsRes] = await Promise.all([
                apiGet<Me>('/api/auth/me'),
                apiGet<Settings>('/api/settings'),
                apiGet<BackgroundInfo>('/api/background'),
                apiGet<Group[]>('/api/groups'),
                apiGet<AppItem[]>('/api/apps'),
            ])

            setMe(meRes)
            setSettings(settingsRes)
            setBg(bgRes)
            setGroups(Array.isArray(groupsRes) ? groupsRes : [])
            setApps(Array.isArray(appsRes) ? appsRes : [])
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load dashboard')
        } finally {
            setLoading(false)
        }
    }, [])

    // 初始化加载
    useEffect(() => {
        reload()
    }, [reload])

    const login = useCallback(
        async (username: string, password: string) => {
            await apiPost('/api/auth/login', { username, password })
            await reload()
        },
        [reload]
    )

    const logout = useCallback(async () => {
        await apiPost('/api/auth/logout')
        setMe({ admin: false })
    }, [])

    const updateSettings = useCallback(async (newSettings: Settings) => {
        await apiPut('/api/settings', newSettings)
        setSettings(newSettings)
    }, [])

    const createGroup = useCallback(
        async (name: string, kind: 'system' | 'app') => {
            const group = await apiPost<Group>('/api/groups', { name, kind })
            await reload()
            return group
        },
        [reload]
    )

    const updateGroup = useCallback(
        async (id: string, name: string) => {
            await apiPut(`/api/groups/${id}`, { name })
            await reload()
        },
        [reload]
    )

    const deleteGroup = useCallback(
        async (id: string) => {
            await apiDelete(`/api/groups/${id}`)
            await reload()
        },
        [reload]
    )

    const reorderGroups = useCallback(
        async (ids: string[]) => {
            await apiPost('/api/groups/reorder', { ids })
            await reload()
        },
        [reload]
    )

    const createApp = useCallback(
        async (data: CreateAppData) => {
            const app = await apiPost<AppItem>('/api/apps', data)
            await reload()
            return app
        },
        [reload]
    )

    const updateApp = useCallback(
        async (id: string, data: UpdateAppData) => {
            await apiPut(`/api/apps/${id}`, data)
            await reload()
        },
        [reload]
    )

    const deleteApp = useCallback(
        async (id: string) => {
            await apiDelete(`/api/apps/${id}`)
            await reload()
        },
        [reload]
    )

    const reorderApps = useCallback(
        async (groupId: string | null, ids: string[]) => {
            await apiPost('/api/apps/reorder', { groupId, ids })
            await reload()
        },
        [reload]
    )

    const refreshBackground = useCallback(
        async (provider?: string) => {
            const params = provider ? `?provider=${encodeURIComponent(provider)}` : ''
            await apiPost(`/api/background/refresh${params}`)
            await reload()
        },
        [reload]
    )

    const value: AppContextType = {
        me,
        settings,
        bg,
        groups,
        apps,
        loading,
        error,
        lang,
        isAdmin,
        reload,
        login,
        logout,
        updateSettings,
        createGroup,
        updateGroup,
        deleteGroup,
        reorderGroups,
        createApp,
        updateApp,
        deleteApp,
        reorderApps,
        refreshBackground,
        setError,
        t,
    }

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextType {
    const context = useContext(AppContext)
    if (!context) {
        throw new Error('useApp must be used within an AppProvider')
    }
    return context
}

export default AppContext
