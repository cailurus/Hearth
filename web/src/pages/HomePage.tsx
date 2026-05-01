import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { apiPost, apiPut } from '../api'
import { Cog, Search } from 'lucide-react'
import type { Group, IconResolve, QuoteResponse } from '../types'
import { apiGet } from '../api'
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
import { SettingsDialog, LoginDialog, CreateGroupDialog, AddItemDialog, ChangePasswordDialog, OnboardingWizard } from '../components/dialogs'
import { WidgetDataProvider } from '../contexts/WidgetDataContext'
import { EditItemDialog } from '../components/dialogs/EditItemDialog'

const ONBOARDED_KEY = 'hearth_onboarded_v1'
import { SnowEffect } from '../components/effects/SnowEffect'
import { RainEffect } from '../components/effects/RainEffect'
import { SakuraEffect } from '../components/effects/SakuraEffect'
import { FireflyEffect } from '../components/effects/FireflyEffect'
import { StarEffect } from '../components/effects/StarEffect'

const EFFECTS = ['snow', 'rain', 'sakura', 'firefly', 'star'] as const
type EffectType = typeof EFFECTS[number]

// seasonalEffect returns the atmosphere effect that matches the current
// (Northern Hemisphere) season. Used as the deterministic first pick when
// the user toggles the footer Easter egg, so a December visit always sees
// snow rather than a random firefly. Months are 1-indexed.
function seasonalEffect(): EffectType {
    const m = new Date().getMonth() + 1
    if (m >= 3 && m <= 5) return 'sakura'  // 春
    if (m >= 6 && m <= 8) return 'firefly' // 夏
    if (m >= 9 && m <= 11) return 'star'   // 秋
    return 'snow'                           // 冬
}
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

    const [activeEffect, setActiveEffect] = useState<EffectType | null>(null)

    // ── First-run onboarding wizard ───────────────────────────────
    // Shown once per browser after the forced password change clears (or
    // immediately on first login if HEARTH_INITIAL_PASSWORD was provided).
    // 4 skippable steps: language → background → first app → weather city.
    // Closing or completing any step ends the wizard for good (localStorage).
    const [onboardingOpen, setOnboardingOpen] = useState(false)
    useEffect(() => {
        if (!me) return
        if (me.mustChangePassword) return
        if (!me.admin) return
        try {
            if (window.localStorage.getItem(ONBOARDED_KEY)) return
        } catch {
            return
        }
        setOnboardingOpen(true)
    }, [me])
    const dismissOnboarding = () => {
        setOnboardingOpen(false)
        try { window.localStorage.setItem(ONBOARDED_KEY, '1') } catch {}
    }

    // ── Daily quote ────────────────────────────────────────────
    const [quote, setQuote] = useState<QuoteResponse | null>(null)
    useEffect(() => {
        let cancelled = false
        apiGet<QuoteResponse>('/api/widgets/quote')
            .then((q) => { if (!cancelled) setQuote(q) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

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

    // Background blur: prefer draft (live slider value) over saved settings
    const bgBlur = siteDraft?.background?.blur ?? settings?.background?.blur ?? (isVideoBackground ? 0 : 3)

    // Widget fetch state. The whole result is funneled through
    // <WidgetDataProvider> below; consumers (GroupBlock, widget components)
    // read whichever slice they need via useWidgetData() rather than having
    // every field drilled down as props.
    const widgetData = useWidgets({
        apps,
        lang,
        defaultCity: settings?.weather?.city,
    })

    // Background refresh favicons for custom apps in auto mode.
    // Triggers on first load AND whenever a new app is added — previously the
    // dep was `[apps.length > 0]`, a boolean that stayed `true` forever after
    // the first non-empty render and silently skipped the refresh for any
    // subsequently-added app, which is exactly what users hit when they
    // created an app without clicking the "auto-fetch" button in the dialog.
    //
    // We dedupe by app id via a ref so re-runs (caused by the apps array
    // reference changing on every reload) only fetch icons we haven't tried
    // yet in this session.
    const refreshedIconAppIdsRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        if (apps.length === 0) return

        const autoIconSources = new Set(['site', 'fallback', 'google', 'auto'])
        const seen = refreshedIconAppIdsRef.current

        const customApps = apps.filter((a) => {
            if (seen.has(a.id)) return false
            if (a.url.startsWith('widget:') || !a.url.trim()) return false
            if (a.iconPath?.startsWith('lucide:')) return false
            if (!a.iconSource) return true
            return autoIconSources.has(a.iconSource)
        })
        if (customApps.length === 0) return

        let cancelled = false

        let anyChanged = false
        const refreshIcons = async () => {
            for (const app of customApps) {
                if (cancelled) break
                // Mark before the fetch so a fast subsequent reload doesn't
                // re-enqueue this app while it's already in flight.
                seen.add(app.id)
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
                    // Silently ignore — this is background refresh.
                }
            }
            if (!cancelled && anyChanged) {
                await actions.reload()
            }
        }

        // Slight delay so we don't block initial paint.
        const timer = window.setTimeout(() => {
            void refreshIcons()
        }, 1000)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
        // actions is recreated each render in useDashboard; we intentionally
        // don't include it to avoid scheduling a new 1s timer on every paint.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apps])

    // useDashboard recreates its `actions` object every render. Bouncing
    // through this ref lets the wrapped callbacks below stay referentially
    // stable (they don't depend on `actions` directly), which in turn lets
    // React.memo'd children skip re-renders driven by HomePage churn.
    const actionsRef = useRef(actions)
    actionsRef.current = actions

    const openAddForGroup = useCallback(
        (groupId: string | null) => {
            if (!isAdmin) return
            const g = groupId ? groups.find((x) => x.id === groupId) : null
            const kind = g && isSystemGroup(g.kind, g.name) ? 'system' : (g?.kind === 'bookmark' ? 'bookmark' : 'app')
            openAddItem(groupId, kind)
        },
        [isAdmin, groups, openAddItem]
    )

    const deleteItem = useCallback(
        async (id: string) => {
            if (!isAdmin) return
            try {
                await actionsRef.current.deleteApp(id)
            } catch {
                // ignore
            }
        },
        [isAdmin]
    )

    const deleteGroup = useCallback(
        async (groupId: string) => {
            if (!isAdmin) return
            try {
                await actionsRef.current.deleteGroup(groupId)
            } catch {
                // ignore
            }
        },
        [isAdmin]
    )

    const renameGroup = useCallback(
        async (groupId: string, newName: string) => {
            if (!isAdmin) return
            try {
                await actionsRef.current.updateGroup(groupId, newName)
            } catch {
                // ignore
            }
        },
        [isAdmin]
    )

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
        <WidgetDataProvider value={widgetData}>
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
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
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
                {/* Readability overlay: stronger at the top where the title /
                    greeting sit (no glass backdrop) and softer in the middle
                    where cards already provide their own contrast. */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/30" />
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

            <main className="mx-auto max-w-6xl px-4 pb-10 pt-[8vh] text-white">
                {error ? (
                    <div className="rounded-lg bg-black/30 backdrop-blur-md p-4 text-sm text-white/80">
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
                                            <Greeting now={now} username={me?.username} lang={lang} quote={quote} />
                                        ) : null}
                                        {settings?.time?.enabled ? (
                                            <div className="mt-3 flex items-center justify-center gap-3">
                                                <TimeDisplay
                                                    now={now}
                                                    timezone={systemTimezone}
                                                    showSeconds={!!settings.time?.showSeconds}
                                                    mode={settings.time?.mode || 'digital'}
                                                    lang={lang}
                                                    showSolarTerm={!!settings.time?.showSolarTerm}
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
                                        localTimezone={systemTimezone}
                                        statusMap={statusMap}
                                        lang={lang}
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
                                            onRenameGroup={renameGroup}
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
                                        onRenameGroup={renameGroup}
                                        onReorder={reorderItems}
                                        localTimezone={systemTimezone}
                                        statusMap={statusMap}
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
                        onClick={() =>
                            setActiveEffect((prev) => {
                                if (prev) return null
                                return seasonalEffect()
                            })
                        }
                        className="cursor-pointer transition-colors hover:text-white/60"
                        title={tr('common:atmosphereHint')}
                        aria-label={tr('common:atmosphereHint')}
                    >
                        &copy;
                    </button>
                    {' '}{new Date().getFullYear()} Hearth
                </span>
            </footer>

            {activeEffect === 'snow' ? <SnowEffect /> :
             activeEffect === 'rain' ? <RainEffect /> :
             activeEffect === 'sakura' ? <SakuraEffect /> :
             activeEffect === 'firefly' ? <FireflyEffect /> :
             activeEffect === 'star' ? <StarEffect /> : null}

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
                onReload={actions.reload}
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

            {/* Forced first-run password change. Cannot be dismissed; backend
                rejects every other admin endpoint until the password is set. */}
            <ChangePasswordDialog
                open={!!me?.mustChangePassword}
                forced
                onSuccess={async () => { await actions.reload() }}
            />

            <OnboardingWizard
                open={onboardingOpen}
                settings={settings}
                onSaveSettings={actions.updateSettings}
                onCreateApp={async (data) => { await actions.createApp(data) }}
                onClose={dismissOnboarding}
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
        </WidgetDataProvider>
    )
}
