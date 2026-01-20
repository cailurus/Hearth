import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiPut, apiDelete } from '../api'
import type { AppItem, BackgroundInfo, Group, Settings } from '../types'

type Me = { admin: boolean }

interface DashboardState {
    me: Me | null
    settings: Settings | null
    bg: BackgroundInfo | null
    groups: Group[]
    apps: AppItem[]
    loading: boolean
    error: string | null
}

interface DashboardActions {
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
    refreshBackground: () => Promise<void>
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

export function useDashboard(): [DashboardState, DashboardActions] {
    const [state, setState] = useState<DashboardState>({
        me: null,
        settings: null,
        bg: null,
        groups: [],
        apps: [],
        loading: true,
        error: null,
    })

    const loadingRef = useRef(false)

    const reload = useCallback(async () => {
        if (loadingRef.current) return
        loadingRef.current = true
        setState((prev) => ({ ...prev, loading: true, error: null }))

        try {
            const [me, settings, bg, groups, apps] = await Promise.all([
                apiGet<Me>('/api/auth/me'),
                apiGet<Settings>('/api/settings'),
                apiGet<BackgroundInfo>('/api/background'),
                apiGet<Group[]>('/api/groups'),
                apiGet<AppItem[]>('/api/apps'),
            ])

            setState({
                me,
                settings,
                bg,
                groups: Array.isArray(groups) ? groups : [],
                apps: Array.isArray(apps) ? apps : [],
                loading: false,
                error: null,
            })
        } catch (e) {
            setState((prev) => ({
                ...prev,
                loading: false,
                error: e instanceof Error ? e.message : 'Failed to load dashboard',
            }))
        } finally {
            loadingRef.current = false
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
        setState((prev) => ({ ...prev, me: { admin: false } }))
    }, [])

    const updateSettings = useCallback(
        async (settings: Settings) => {
            await apiPut('/api/settings', settings)
            setState((prev) => ({ ...prev, settings }))
        },
        []
    )

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

    const refreshBackground = useCallback(async () => {
        await apiPost('/api/background/refresh')
        await reload()
    }, [reload])

    const actions: DashboardActions = {
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
    }

    return [state, actions]
}
