import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { apiPost, apiPut } from '../api'
import { Cog, Search } from 'lucide-react'
import type { Group, IconResolve } from '../types'
import { useNow, useWidgets, useVideoBackground, useDialogState, useBackgroundRefresh, useSettingsDraft, useDashboard } from '../hooks'
import { useWidgetEditor } from '../hooks/useWidgetEditor'
import { useGroupDragSort } from '../hooks/useGroupDragSort'
import { UserIcon } from '../components/ui/UserIcon'
import { TimeDisplay } from '../components/layout/TimeDisplay'
import { Greeting } from '../components/layout/Greeting'
import { GroupBlock } from '../components/layout/GroupBlock'
import { BookmarkGroup } from '../components/layout/BookmarkGroup'
import { QuickLaunch } from '../components/layout/QuickLaunch'
import { useQuickLaunch } from '../hooks/useQuickLaunch'
import { useAppStatus } from '../hooks/useAppStatus'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { SettingsDialog, LoginDialog, CreateGroupDialog, AddItemDialog } from '../components/dialogs'
import { EditItemDialog } from '../components/dialogs/EditItemDialog'
import { SnowEffect } from '../components/effects/SnowEffect'
import { normalizeIanaTimeZone, displayGroupName, isSystemGroup } from '../utils'

export default function HomePage({ initialDialog }: { initialDialog?: 'login' } = {}) {
    const [dashboard, actions] = useDashboard()
    const { me, settings, bg, groups, apps, error } = dashboard

    const { dialogs, openDialog, closeDialog, openContextMenu, contextMenuPos, openAddItem, addItemGroupId, addItemGroupKind } = useDialogState(initialDialog === 'login')

    const { t: tr } = useTranslation(['home', 'common'])
    const isAdmin = !!me?.admin
    const lang: 'zh' | 'en' = settings?.language === 'en' ? 'en' : 'zh'

    // Sync i18next language with settings
    useEffect(() => {
        if (lang !== i18n.language) {
            i18n.changeLanguage(lang)
        }
    }, [lang])

    // ── Widget editor (EditItemDialog state + logic) ──────────────
    const editor = useWidgetEditor({
        isAdmin,
        lang,
        updateApp: actions.updateApp,
        reload: actions.reload,
        openEditDialog: () => openDialog('edit'),
        closeEditDialog: () => closeDialog('edit'),
        editDialogOpen: dialogs.edit,
    })

    // ── Group drag-and-drop + sorting ──────────────────────────────
    const { sortedGroups, hasSystemGroup, hasUngrouped, groupItems, draggingGroupId, dropTargetGroupId, getDragHandlers, reorderItems } = useGroupDragSort({
        isAdmin,
        groups,
        apps,
        settings,
        reload: actions.reload,
    })

    // ── Quick Launch (Cmd/Ctrl+K) ──────────────────────────────────
    const quickLaunch = useQuickLaunch(apps)

    // ── App status indicators ────────────────────────────────────
    const { statusMap } = useAppStatus(true)

    // ── Version check ────────────────────────────────────────────
    const versionCheck = useVersionCheck()

    const [showSnowEffect, setShowSnowEffect] = useState(false)

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
        isAdmin,
        systemTimezone,
        onSave: async (s) => { await apiPut('/api/settings', s) },
    })
    const { draft: siteDraft, setDraft: setSiteDraft, saveError: siteSaveErr, saveDraft: schedulePersistSiteDraft } = settingsDraft

    const bgRefresh = useBackgroundRefresh({
        isAdmin,
        currentProvider: settings?.background?.provider || 'default',
        draftProvider: siteDraft?.background?.provider,
    })

    const now = useNow(1000)

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
        dockerById,
        dockerErrById,
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
        const kind = g && isSystemGroup(g.kind, g.name) ? 'system' : (g?.kind === 'bookmark' ? 'bookmark' : 'app')
        openAddItem(groupId, kind)
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

    const title = settings?.siteTitle || 'Hearth'
    const baseBgUrl = bg?.imageUrl || '/api/background/image'
    const bgUrl = baseBgUrl + (baseBgUrl.includes('?') ? '&' : '?') + `v=${bgRefresh.bgNonce}`

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
                                        <div className="text-sm">{tr('bgDownloading')}</div>
                                        <div className="text-xs text-white/50">{downloadProgress}%</div>
                                    </div>
                                ) : (
                                    <div className="text-white/50 text-sm">{tr('bgPreparing')}</div>
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
                        title={tr('common:settings')}
                    >
                        <Cog className="h-5 w-5" />
                    </button>
                ) : (
                    <button
                        onClick={() => openDialog('login')}
                        className="p-1.5 text-white/90 transition-colors hover:text-white"
                        aria-label="user"
                        title={tr('common:login')}
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
                        const titlePosition = settings?.titleSortOrder ?? 0

                        const groupBlocks: { type: 'group'; id: string; group: Group }[] = sortedGroups.map((g) => ({
                            type: 'group',
                            id: g.id,
                            group: g,
                        }))

                        const allBlocks: { type: 'title' | 'ungrouped' | 'group'; id: string; group?: Group }[] = []

                        if (hasUngrouped) {
                            allBlocks.push({ type: 'ungrouped', id: '__ungrouped__' })
                        }

                        let titleInserted = false
                        for (let i = 0; i < groupBlocks.length; i++) {
                            if (!titleInserted && i >= titlePosition) {
                                allBlocks.push({ type: 'title', id: '__title__' })
                                titleInserted = true
                            }
                            allBlocks.push(groupBlocks[i])
                        }
                        if (!titleInserted) {
                            allBlocks.push({ type: 'title', id: '__title__' })
                        }

                        return allBlocks.map((block) => {
                            if (block.type === 'title') {
                                return (
                                    <div
                                        key="__title__"
                                        draggable={isAdmin}
                                        {...getDragHandlers('__title__')}
                                        className={`mb-8 text-center transition-all ${isAdmin ? 'cursor-grab' : ''} ${draggingGroupId === '__title__' ? 'opacity-30' : ''
                                            } ${dropTargetGroupId === '__title__' && draggingGroupId !== '__title__'
                                                ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-transparent scale-[1.01]'
                                                : ''
                                            }`}
                                    >
                                        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
                                        {settings?.greeting?.enabled !== false ? (
                                            <Greeting now={now} username={me?.username} lang={lang} />
                                        ) : null}
                                        {settings?.time?.enabled ? (
                                            <div className="mt-3 flex items-center justify-center gap-3">
                                                <TimeDisplay
                                                    now={now}
                                                    timezone={systemTimezone}
                                                    showSeconds={!!settings.time?.showSeconds}
                                                    mode={settings.time?.mode || 'digital'}
                                                />
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); quickLaunch.openOverlay() }}
                                                    className="p-1 text-white/40 transition-colors hover:text-white/70"
                                                    title={tr('quickLaunchPlaceholder')}
                                                >
                                                    <Search className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="mt-3 flex items-center justify-center">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); quickLaunch.openOverlay() }}
                                                    className="p-1 text-white/40 transition-colors hover:text-white/70"
                                                    title={tr('quickLaunchPlaceholder')}
                                                >
                                                    <Search className="h-4 w-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            }

                            if (block.type === 'ungrouped') {
                                return (
                                    <GroupBlock
                                        key="__ungrouped__"
                                        groupId={null}
                                        name={tr('common:ungrouped')}
                                        groupKind={'app'}
                                        items={groupItems(null)}
                                        isAdmin={isAdmin}
                                        onAdd={openAddForGroup}
                                        onEdit={editor.openEditItem}
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
                                        statusMap={statusMap}
                                        dockerById={dockerById}
                                        dockerErrById={dockerErrById}
                                    />
                                )
                            }

                            // block.type === 'group'
                            const g = block.group!
                            const dragWrapClass = `transition-all ${isAdmin ? 'cursor-grab' : ''} ${draggingGroupId === g.id ? 'opacity-30' : ''
                                } ${dropTargetGroupId === g.id && draggingGroupId !== g.id
                                    ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-transparent scale-[1.01]'
                                    : ''
                                }`

                            if (g.kind === 'bookmark') {
                                return (
                                    <div key={g.id} draggable={isAdmin} {...getDragHandlers(g.id)} className={dragWrapClass}>
                                        <BookmarkGroup
                                            groupId={g.id}
                                            name={displayGroupName(g.name, lang)}
                                            items={groupItems(g.id)}
                                            isAdmin={isAdmin}
                                            onAdd={openAddForGroup}
                                            onEdit={editor.openEditItem}
                                            onDelete={deleteItem}
                                            onDeleteGroup={deleteGroup}
                                            onReorder={reorderItems}
                                            statusMap={statusMap}
                                        />
                                    </div>
                                )
                            }

                            return (
                                <div key={g.id} draggable={isAdmin} {...getDragHandlers(g.id)} className={dragWrapClass}>
                                    <GroupBlock
                                        groupId={g.id}
                                        name={displayGroupName(g.name, lang)}
                                        groupKind={g.kind || 'app'}
                                        items={groupItems(g.id)}
                                        isAdmin={isAdmin}
                                        onAdd={openAddForGroup}
                                        onEdit={editor.openEditItem}
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
                                        statusMap={statusMap}
                                        dockerById={dockerById}
                                        dockerErrById={dockerErrById}
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
                            {tr('common:newGroup')}
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
                currentVersion={versionCheck.currentVersion}
                latestVersion={versionCheck.latestVersion}
                hasUpdate={versionCheck.hasUpdate}
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
                {...editor}
            />

            <QuickLaunch
                open={quickLaunch.open}
                query={quickLaunch.query}
                setQuery={quickLaunch.setQuery}
                results={quickLaunch.results}
                selectedIndex={quickLaunch.selectedIndex}
                setSelectedIndex={quickLaunch.setSelectedIndex}
                onClose={quickLaunch.closeOverlay}
                onEscape={quickLaunch.handleEscape}
                onNavigateUp={quickLaunch.navigateUp}
                onNavigateDown={quickLaunch.navigateDown}
                onSelect={quickLaunch.selectCurrent}
            />
        </div>
    )
}
