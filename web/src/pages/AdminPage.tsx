import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useState } from 'react'
import { apiDelete, apiDownload, apiGet, apiPost, apiPut } from '../api'
import type { AppItem, Group, Settings } from '../types'

type Me = { admin: boolean }

type IconResolve = {
    title: string
    iconUrl: string
    iconPath: string
    iconSource: string
}

type DragAttrs = {
    attributes: Record<string, unknown>
    listeners: Record<string, (event: unknown) => void>
}

type SensorsType = ReturnType<typeof useSensors>

function clsx(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(' ')
}

function normalizeTimezones(input: string): string[] {
    return input
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
}

export default function AdminPage() {
    const [me, setMe] = useState<Me | null>(null)
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState<string | null>(null)

    const [username, setUsername] = useState('admin')
    const [password, setPassword] = useState('')

    const [settings, setSettings] = useState<Settings | null>(null)
    const [timezonesText, setTimezonesText] = useState('')

    const [groups, setGroups] = useState<Group[]>([])
    const [apps, setApps] = useState<AppItem[]>([])

    const [newGroupName, setNewGroupName] = useState('')

    const [appForm, setAppForm] = useState({
        id: '' as string,
        mode: 'create' as 'create' | 'edit',
        groupId: '' as string, // '' means ungrouped
        name: '' as string,
        url: '' as string,
        iconPath: '' as string,
        iconSource: '' as string,
    })

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const displayGroupName = (raw: string): string => {
        const s = String(raw ?? '').trim()
        if (!s) return ''
        if (s === '系统组件') return t('系统组件', 'System Widgets')
        if (s === 'System Widgets') return t('系统组件', 'System Widgets')
        if (s === 'System Tools') return t('系统组件', 'System Widgets')
        return s
    }

    const reloadAll = async () => {
        const [st, gs, as] = await Promise.all([
            apiGet<Settings>('/api/settings'),
            apiGet<Group[]>('/api/groups'),
            apiGet<AppItem[]>('/api/apps'),
        ])
        setSettings(st)
        setTimezonesText((st.timezones ?? []).join('\n'))
        setGroups(gs)
        setApps(as)
    }

    const loadMe = async () => {
        const m = await apiGet<Me>('/api/auth/me')
        setMe(m)
        return m
    }

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    // Load language even before admin login, so the login page copy matches the site.
                    try {
                        const st = await apiGet<Settings>('/api/settings')
                        if (!cancelled) setSettings(st)
                    } catch {
                        // ignore
                    }

                    const m = await loadMe()
                    if (cancelled) return
                    if (m.admin) {
                        await reloadAll()
                    }
                    setErr(null)
                } catch (e) {
                    if (cancelled) return
                    setErr(e instanceof Error ? e.message : 'failed')
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => {
            cancelled = true
        }
    }, [])

    const groupsSorted = useMemo(() => {
        return [...groups].sort((a, b) => {
            const d1 = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            if (d1 !== 0) return d1
            const d2 = (a.createdAt ?? 0) - (b.createdAt ?? 0)
            if (d2 !== 0) return d2
            return String(a.id).localeCompare(String(b.id))
        })
    }, [groups])

    const appsByGroup = useMemo(() => {
        const m = new Map<string, AppItem[]>()
        for (const a of apps) {
            const key = a.groupId ?? ''
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

    const onLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setErr(null)
        try {
            await apiPost('/api/auth/login', { username, password })
            const m = await loadMe()
            if (m.admin) {
                await reloadAll()
            }
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : 'failed')
        }
    }

    const onLogout = async () => {
        setErr(null)
        try {
            await apiPost('/api/auth/logout')
            setMe({ admin: false })
            setSettings(null)
            setGroups([])
            setApps([])
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const saveSettings = async () => {
        if (!settings) return
        setErr(null)
        try {
            const payload: Settings = {
                ...settings,
                timezones: normalizeTimezones(timezonesText),
            }
            await apiPut('/api/settings', payload)
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const createGroup = async () => {
        const name = newGroupName.trim()
        if (!name) return
        setErr(null)
        try {
            await apiPost('/api/groups', { name, kind: 'app' })
            setNewGroupName('')
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const updateGroup = async (id: string, name: string) => {
        const n = name.trim()
        if (!n) return
        setErr(null)
        try {
            await apiPut(`/api/groups/${id}`, { name: n })
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const deleteGroup = async (id: string) => {
        setErr(null)
        try {
            await apiDelete(`/api/groups/${id}`)
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const onGroupDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const oldIndex = groupsSorted.findIndex((g) => g.id === active.id)
        const newIndex = groupsSorted.findIndex((g) => g.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return

        const next = arrayMove(groupsSorted, oldIndex, newIndex)
        setGroups(next)
        try {
            await apiPost('/api/groups/reorder', { ids: next.map((g) => g.id) })
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const resolveIcon = async (url: string) => {
        const u = url.trim()
        if (!u) return
        setErr(null)
        try {
            const res = await apiPost<IconResolve>('/api/icon/resolve', { url: u })
            setAppForm((prev) => ({
                ...prev,
                iconPath: res.iconPath || '',
                iconSource: res.iconSource || '',
                name: prev.name || res.title || prev.name,
            }))
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const submitApp = async () => {
        const name = appForm.name.trim()
        const url = appForm.url.trim()
        if (!name || !url) return

        const groupId = appForm.groupId ? appForm.groupId : null
        const iconPath = appForm.iconPath ? appForm.iconPath : null
        const iconSource = appForm.iconSource ? appForm.iconSource : null

        setErr(null)
        try {
            if (appForm.mode === 'create') {
                await apiPost('/api/apps', { groupId, name, url, iconPath, iconSource })
            } else {
                await apiPut(`/api/apps/${appForm.id}`, { groupId, name, url, iconPath, iconSource })
            }
            setAppForm({ id: '', mode: 'create', groupId: '', name: '', url: '', iconPath: '', iconSource: '' })
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const editApp = (a: AppItem) => {
        setAppForm({
            id: a.id,
            mode: 'edit',
            groupId: a.groupId ?? '',
            name: a.name,
            url: a.url,
            iconPath: a.iconPath ?? '',
            iconSource: a.iconSource ?? '',
        })
    }

    const deleteApp = async (id: string) => {
        setErr(null)
        try {
            await apiDelete(`/api/apps/${id}`)
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const onAppsDragEnd = async (groupKey: string, event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const list = appsByGroup.get(groupKey) ?? []
        const oldIndex = list.findIndex((a) => a.id === active.id)
        const newIndex = list.findIndex((a) => a.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return

        const next = arrayMove(list, oldIndex, newIndex)
        setApps((prev) => {
            const rest = prev.filter((a) => (a.groupId ?? '') !== groupKey)
            return [...rest, ...next]
        })

        try {
            await apiPost('/api/apps/reorder', {
                groupId: groupKey ? groupKey : null,
                ids: next.map((a) => a.id),
            })
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const doExport = async () => {
        setErr(null)
        try {
            const blob = await apiDownload('/api/export')
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `hearth-export-${new Date().toISOString().slice(0, 10)}.json`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    const doImport = async (file: File) => {
        setErr(null)
        try {
            const text = await file.text()
            const payload = JSON.parse(text) as unknown
            await apiPost('/api/import', payload)
            await reloadAll()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'failed')
        }
    }

    if (loading) {
        return (
            <main className="mx-auto max-w-6xl px-4 py-6 text-white">
                <div className="text-sm text-white/70">{t('加载中…', 'Loading…')}</div>
            </main>
        )
    }

    if (!me?.admin) {
        return (
            <main className="mx-auto max-w-6xl px-4 py-6 text-white">
                <div className="mb-4 text-lg font-semibold">{t('管理员登录', 'Admin Login')}</div>
                {err ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{err}</div> : null}
                <form onSubmit={onLogin} className="max-w-sm space-y-3">
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
            </main>
        )
    }

    return (
        <main className="mx-auto max-w-6xl px-4 py-6 text-white">
            <div className="mb-4 flex items-center justify-between">
                <div className="text-lg font-semibold">{t('管理后台 / 设置', 'Admin / Settings')}</div>
                <button onClick={onLogout} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
                    {t('登出', 'Logout')}
                </button>
            </div>

            {err ? <div className="mb-4 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{err}</div> : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <h2 className="mb-3 text-sm font-semibold">{t('站点设置', 'Site Settings')}</h2>
                    {settings ? (
                        <div className="space-y-3">
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('标题', 'Title')}</div>
                                <input
                                    value={settings.siteTitle}
                                    onChange={(e) => setSettings({ ...settings, siteTitle: e.target.value })}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('语言', 'Language')}</div>
                                <select
                                    value={settings.language || 'zh'}
                                    onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                >
                                    <option value="zh">{t('中文', 'Chinese')}</option>
                                    <option value="en">{t('英文', 'English')}</option>
                                </select>
                            </label>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('背景来源', 'Background provider')}</div>
                                    <select
                                        value={settings.background.provider}
                                        onChange={(e) =>
                                            setSettings({
                                                ...settings,
                                                background: { ...settings.background, provider: e.target.value },
                                            })
                                        }
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    >
                                        <option value="bing">Bing</option>
                                        <option value="unsplash">Unsplash</option>
                                    </select>
                                </label>

                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('更新间隔（如 1h/24h/0）', 'Refresh interval (e.g. 1h/24h/0)')}</div>
                                    <input
                                        value={settings.background.interval}
                                        onChange={(e) =>
                                            setSettings({
                                                ...settings,
                                                background: { ...settings.background, interval: e.target.value },
                                            })
                                        }
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    />
                                </label>
                            </div>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('Unsplash 搜索词', 'Unsplash query')}</div>
                                <input
                                    value={settings.background.unsplashQuery}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            background: { ...settings.background, unsplashQuery: e.target.value },
                                        })
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('天气城市（支持全球输入）', 'Weather city (global)')}</div>
                                <input
                                    value={settings.weather.city}
                                    onChange={(e) => setSettings({ ...settings, weather: { ...settings.weather, city: e.target.value } })}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('时区列表（每行一个）', 'Timezone list (one per line)')}</div>
                                <textarea
                                    value={timezonesText}
                                    onChange={(e) => setTimezonesText(e.target.value)}
                                    rows={4}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <button onClick={saveSettings} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
                                {t('保存设置', 'Save settings')}
                            </button>
                        </div>
                    ) : (
                        <div className="text-sm text-white/60">Loading…</div>
                    )}
                </section>

                <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <h2 className="mb-3 text-sm font-semibold">{t('导入 / 导出', 'Import / Export')}</h2>
                    <div className="flex flex-wrap items-center gap-3">
                        <button onClick={doExport} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
                            {t('导出 JSON', 'Export JSON')}
                        </button>
                        <label className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
                            <input
                                type="file"
                                accept="application/json"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) void doImport(f)
                                    e.currentTarget.value = ''
                                }}
                            />
                            {t('导入 JSON', 'Import JSON')}
                        </label>
                    </div>
                    <p className="mt-2 text-xs text-white/60">{t('导入会覆盖/更新 settings、groups、apps（按 id upsert）。', 'Import overwrites/updates settings, groups, apps (upsert by id).')}</p>
                </section>

                <section className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <h2 className="mb-3 text-sm font-semibold">{t('分组管理（可拖拽排序）', 'Groups (drag to reorder)')}</h2>
                    <div className="mb-3 flex gap-2">
                        <input
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder={t('新分组名称', 'New group name')}
                            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                        <button onClick={createGroup} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
                            {t('新建', 'Create')}
                        </button>
                    </div>

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGroupDragEnd}>
                        <SortableContext items={groupsSorted.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2">
                                {groupsSorted.map((g) => (
                                    <SortableRow
                                        key={`${g.id}:${g.name}`}
                                        id={g.id}
                                        render={(attrs) => (
                                            <GroupRow
                                                group={g}
                                                dragAttrs={attrs}
                                                lang={lang}
                                                onSave={updateGroup}
                                                onDelete={deleteGroup}
                                            />
                                        )}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                </section>

                <section className="rounded-xl border border-white/10 bg-black/40 p-4 lg:col-span-2">
                    <h2 className="mb-3 text-sm font-semibold">{t('项目管理（可拖拽排序）', 'Apps (drag to reorder)')}</h2>

                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                        <select
                            value={appForm.groupId}
                            onChange={(e) => setAppForm((p) => ({ ...p, groupId: e.target.value }))}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none lg:col-span-2"
                        >
                            <option value="">{t('未分组', 'Ungrouped')}</option>
                            {groupsSorted.map((g) => (
                                <option key={g.id} value={g.id}>
                                    {displayGroupName(g.name)}
                                </option>
                            ))}
                        </select>
                        <input
                            value={appForm.name}
                            onChange={(e) => setAppForm((p) => ({ ...p, name: e.target.value }))}
                            placeholder={t('名称', 'Name')}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none lg:col-span-2"
                        />
                        <input
                            value={appForm.url}
                            onChange={(e) => setAppForm((p) => ({ ...p, url: e.target.value }))}
                            placeholder="URL"
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none lg:col-span-2"
                        />

                        <div className="flex flex-wrap gap-2 lg:col-span-6">
                            <button
                                onClick={() => void resolveIcon(appForm.url)}
                                className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                            >
                                {t('解析图标', 'Resolve icon')}
                            </button>
                            <button onClick={() => void submitApp()} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
                                {appForm.mode === 'create' ? t('添加项目', 'Add app') : t('保存修改', 'Save changes')}
                            </button>
                            {appForm.mode === 'edit' ? (
                                <button
                                    onClick={() =>
                                        setAppForm({ id: '', mode: 'create', groupId: '', name: '', url: '', iconPath: '', iconSource: '' })
                                    }
                                    className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                                >
                                    {t('取消编辑', 'Cancel edit')}
                                </button>
                            ) : null}
                            {appForm.iconPath ? (
                                <div className="flex items-center gap-2 text-xs text-white/70">
                                    <img src={`/assets/icons/${appForm.iconPath}`} className="h-6 w-6 rounded-lg bg-white/10 object-contain" alt="" />
                                    <span className="truncate">{appForm.iconSource}</span>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="space-y-5">
                        <AppsSortableBlock
                            title={t('未分组', 'Ungrouped')}
                            groupKey=""
                            apps={appsByGroup.get('') ?? []}
                            sensors={sensors}
                            onDragEnd={onAppsDragEnd}
                            onEdit={editApp}
                            onDelete={deleteApp}
                            lang={lang}
                        />

                        {groupsSorted.map((g) => (
                            <AppsSortableBlock
                                key={g.id}
                                title={displayGroupName(g.name)}
                                groupKey={g.id}
                                apps={appsByGroup.get(g.id) ?? []}
                                sensors={sensors}
                                onDragEnd={onAppsDragEnd}
                                onEdit={editApp}
                                onDelete={deleteApp}
                                lang={lang}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </main>
    )
}

function SortableRow({
    id,
    render,
}: {
    id: string
    render: (attrs: DragAttrs) => React.ReactNode
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
    }
    const dragAttrs: DragAttrs = {
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: (listeners ?? ({} as unknown)) as unknown as Record<string, (event: unknown) => void>,
    }
    return (
        <div ref={setNodeRef} style={style}>
            {render(dragAttrs)}
        </div>
    )
}

function GroupRow({
    group,
    dragAttrs,
    lang,
    onSave,
    onDelete,
}: {
    group: Group
    dragAttrs: DragAttrs
    lang: 'zh' | 'en'
    onSave: (id: string, name: string) => void
    onDelete: (id: string) => void
}) {
    const [name, setName] = useState(() => group.name)

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    return (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
            <button
                {...dragAttrs.attributes}
                {...dragAttrs.listeners}
                className="cursor-grab rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80"
                aria-label="drag"
            >
                ::
            </button>
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none"
            />
            <button onClick={() => onSave(group.id, name)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">
                {t('保存', 'Save')}
            </button>
            <button onClick={() => onDelete(group.id)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">
                {t('删除', 'Delete')}
            </button>
        </div>
    )
}

function AppsSortableBlock({
    title,
    groupKey,
    apps,
    sensors,
    onDragEnd,
    onEdit,
    onDelete,
    lang,
}: {
    title: string
    groupKey: string
    apps: AppItem[]
    sensors: SensorsType
    onDragEnd: (groupKey: string, e: DragEndEvent) => void
    onEdit: (a: AppItem) => void
    onDelete: (id: string) => void
    lang: 'zh' | 'en'
}) {
    const ids = apps.map((a) => a.id)

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    return (
        <div>
            <div className="mb-2 text-sm font-semibold text-white/80">{title}</div>
            {apps.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-white/60">{t('暂无项目', 'No apps')}</div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => onDragEnd(groupKey, e)}
                >
                    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                            {apps.map((a) => (
                                <SortableAppRow key={a.id} app={a} onEdit={onEdit} onDelete={onDelete} lang={lang} />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </div>
    )
}

function SortableAppRow({
    app,
    onEdit,
    onDelete,
    lang,
}: {
    app: AppItem
    onEdit: (a: AppItem) => void
    onDelete: (id: string) => void
    lang: 'zh' | 'en'
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: app.id })
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
            <button
                {...attributes}
                {...listeners}
                className="cursor-grab rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80"
                aria-label="drag"
            >
                ::
            </button>

            {app.iconPath ? (
                <img src={`/assets/icons/${app.iconPath}`} className="h-7 w-7 rounded-lg bg-white/10 object-contain" alt="" />
            ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold">
                    {app.name.slice(0, 1).toUpperCase()}
                </div>
            )}

            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{app.name}</div>
                <div className="truncate text-xs text-white/60">{app.url}</div>
            </div>

            <button onClick={() => onEdit(app)} className={clsx('rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20')}>
                {t('编辑', 'Edit')}
            </button>
            <button onClick={() => onDelete(app.id)} className={clsx('rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20')}>
                {t('删除', 'Delete')}
            </button>
        </div>
    )
}
