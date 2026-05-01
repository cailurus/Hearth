/**
 * 分组区块组件 - 显示应用和小组件的分组
 */

import { memo, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Cog, Cpu, Download, HardDrive, MemoryStick, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { AppItem } from '../../types'
import { AppIcon } from '../cards/AppIcon'
import { StatusDot } from '../ui/StatusDot'
import { WeatherWidget } from '../widgets/WeatherWidget'
import { MarketsWidget } from '../widgets/MarketsWidget'
import { HolidaysWidget } from '../widgets/HolidaysWidget'
import { TimezonesWidget } from '../widgets/TimezonesWidget'
import { DockerWidget } from '../widgets/DockerWidget'
import { NotesWidget } from '../widgets/NotesWidget'
import { RSSWidget } from '../widgets/RSSWidget'
import { CurrencyWidget } from '../widgets/CurrencyWidget'
import { DealsWidget } from '../widgets/DealsWidget'
import { Spinner } from '../ui/Spinner'
import { WidgetBoundary } from '../ui'
import { useWidgetData } from '../../contexts/WidgetDataContext'
import { WIDGET_LABEL_KEYS } from '../../utils/constants'

import { safeParseJSON, formatBytesPerSec, formatGiB, shortenCpuModelName, clocksFromCfg, isSystemGroup, isWidgetItem } from '../../utils'

interface GroupBlockProps {
    groupId: string | null
    name: string
    groupKind: 'system' | 'app' | string
    items: AppItem[]
    isAdmin: boolean
    onAdd: (groupId: string | null) => void
    onEdit: (item: AppItem) => void
    onDelete: (id: string) => void
    onDeleteGroup?: (groupId: string) => void
    onRenameGroup?: (groupId: string, name: string) => void
    onReorder: (groupId: string | null, ids: string[]) => Promise<void>
    localTimezone: string
    statusMap?: Record<string, { status: string }>
    lang?: 'zh' | 'en'
}

function GroupBlockImpl({
    groupId,
    name,
    groupKind,
    items,
    isAdmin,
    onAdd,
    onEdit,
    onDelete,
    onDeleteGroup,
    onRenameGroup,
    onReorder,
    localTimezone,
    statusMap,
    lang = 'en',
}: GroupBlockProps) {
    // Widget fetch state used to be 21 props drilled from HomePage. They're
    // now read from context so HomePage state changes only invalidate this
    // component when the relevant slice of widget data actually changes.
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
        rssById,
        rssErrById,
        refreshRss,
        rssRefreshing,
        currencyById,
        currencyErrById,
        dealsById,
        dealsErrById,
    } = useWidgetData()
    const { t } = useTranslation(['widgets', 'common'])
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const draggingIdRef = useRef<string | null>(null)

    // Inline rename state
    const [renaming, setRenaming] = useState(false)
    const [renameValue, setRenameValue] = useState('')
    const renameInputRef = useRef<HTMLInputElement>(null)

    const startRename = useCallback(() => {
        if (!isAdmin || !groupId || !onRenameGroup) return
        setRenameValue(name)
        setRenaming(true)
        requestAnimationFrame(() => renameInputRef.current?.select())
    }, [isAdmin, groupId, onRenameGroup, name])

    const commitRename = useCallback(() => {
        const trimmed = renameValue.trim()
        if (trimmed && trimmed !== name && groupId && onRenameGroup) {
            onRenameGroup(groupId, trimmed)
        }
        setRenaming(false)
    }, [renameValue, name, groupId, onRenameGroup])

    const isSysGroup = isSystemGroup(groupKind, name)
    const isSystemWidgetsOnly = isSysGroup && items.length > 0 && items.every((it) => isWidgetItem(it.url))

    const dragItems = items

    const getNextOrder = (fromId: string, toId: string) => {
        const ids = dragItems.map((it) => it.id)
        const fromIndex = ids.indexOf(fromId)
        const toIndex = ids.indexOf(toId)
        if (fromIndex < 0 || toIndex < 0) return null
        if (fromIndex === toIndex) return null

        const next = [...ids]
        next.splice(fromIndex, 1)
        next.splice(toIndex, 0, fromId)
        return next
    }

    return (
        <div className="group">
            <div className="mb-3 flex items-center gap-2">
                {renaming ? (
                    <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setRenaming(false)
                        }}
                        className="rounded bg-white/10 px-2 py-0.5 text-base font-semibold text-white/80 outline-none focus:ring-1 focus:ring-white/30"
                        autoFocus
                    />
                ) : (
                    <h2
                        className={`text-base font-semibold text-white/80 ${isAdmin && groupId ? 'cursor-pointer hover:text-white/90' : ''}`}
                        onDoubleClick={startRename}
                    >
                        {name}
                    </h2>
                )}
                {isAdmin ? (
                    <>
                        <button
                            onClick={() => onAdd(groupId)}
                            className="invisible rounded-lg bg-white/[0.08] px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.15] hover:text-white group-hover:visible"
                            aria-label="add"
                            title={t('widgets:add')}
                        >
                            +
                        </button>
                        {groupId && onDeleteGroup ? (
                            <button
                                onClick={() => {
                                    if (window.confirm(t('widgets:deleteGroupConfirm'))) {
                                        onDeleteGroup(groupId)
                                    }
                                }}
                                className="invisible rounded-lg bg-white/[0.08] px-2 py-1 text-xs text-white/70 transition-colors hover:bg-red-500/40 hover:text-white group-hover:visible"
                                aria-label="delete group"
                                title={t('widgets:deleteGroup')}
                            >
                                −
                            </button>
                        ) : null}
                    </>
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
                    <div className="col-span-full rounded-2xl bg-black/25 p-3 text-sm text-white/50">{t('widgets:noItems')}</div>
                ) : (
                    items.map((a) => {
                        const widget = a.url?.startsWith('widget:') ? a.url.slice('widget:'.length) : null
                        if (widget) {
                            const cfg = safeParseJSON(a.description)
                            // Widget card spans - responsive grid layout
                            const widgetCardClass =
                                isSystemWidgetsOnly
                                    ? 'col-span-2 sm:col-span-1'  // All widgets: full width on mobile, 1 col on tablet+
                                    : widget === 'timezones'
                                        ? 'col-span-2 sm:col-span-3 lg:col-span-2'
                                        : widget === 'metrics' || widget === 'docker'
                                            ? 'col-span-2 sm:col-span-1'
                                            : ''

                            // Fixed height for all widgets to prevent layout shift during loading
                            const isRssTall = widget === 'rss' && cfg?.size === 'tall'
                            const widgetHeightClass = isRssTall
                                ? 'h-[392px] sm:h-[432px] row-span-2'
                                : 'h-[190px] sm:h-[210px]'

                            const widgetPadClass = 'p-4'

                            // When being dragged, show a ghost placeholder
                            const isDragging = draggingId === a.id
                            const isDropTarget = dropTargetId === a.id && draggingId && draggingId !== a.id

                            return (
                                <div
                                    key={a.id}
                                    className={`group/card relative flex flex-col overflow-hidden rounded-2xl bg-black/30 backdrop-blur-md ${widgetPadClass} transition-all duration-200 ease-out ${widgetCardClass} ${widgetHeightClass} ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30 border-2 border-dashed border-white/20 bg-black/20' : isDropTarget ? 'ring-2 ring-white/30 scale-[1.02]' : 'hover:bg-black/35 hover:shadow-lg hover:shadow-black/10'}`}
                                    draggable={isAdmin}
                                    onDragStart={(e) => {
                                        if (!isAdmin) return
                                        draggingIdRef.current = a.id
                                        e.dataTransfer.effectAllowed = 'move'
                                        e.dataTransfer.setData('text/plain', a.id)
                                        // Create a clipped drag ghost to avoid showing full scrollable content
                                        const el = e.currentTarget
                                        const ghost = el.cloneNode(true) as HTMLElement
                                        ghost.style.width = `${el.offsetWidth}px`
                                        ghost.style.height = `${el.offsetHeight}px`
                                        ghost.style.overflow = 'hidden'
                                        ghost.style.position = 'absolute'
                                        ghost.style.top = '-9999px'
                                        ghost.style.left = '-9999px'
                                        document.body.appendChild(ghost)
                                        e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX, e.nativeEvent.offsetY)
                                        setTimeout(() => document.body.removeChild(ghost), 0)
                                        // Delay state update so browser can capture drag image first
                                        setTimeout(() => {
                                            setDraggingId(a.id)
                                        }, 0)
                                    }}
                                    onDragEnd={() => {
                                        draggingIdRef.current = null
                                        setDraggingId(null)
                                        setDropTargetId(null)
                                    }}
                                    onDragEnter={(e) => {
                                        if (!isAdmin) return
                                        const fromId = draggingIdRef.current
                                        if (!fromId || fromId === a.id) return
                                        e.preventDefault()
                                        setDropTargetId(a.id)
                                    }}
                                    onDragOver={(e) => {
                                        if (!isAdmin) return
                                        const fromId = draggingIdRef.current
                                        if (!fromId || fromId === a.id) return
                                        e.preventDefault()
                                        e.dataTransfer.dropEffect = 'move'
                                        if (dropTargetId !== a.id) {
                                            setDropTargetId(a.id)
                                        }
                                    }}
                                    onDrop={async (e) => {
                                        if (!isAdmin) return
                                        e.preventDefault()
                                        const fromId = draggingIdRef.current || e.dataTransfer.getData('text/plain')
                                        draggingIdRef.current = null
                                        setDraggingId(null)
                                        setDropTargetId(null)
                                        if (!fromId || fromId === a.id) return
                                        const next = getNextOrder(fromId, a.id)
                                        if (!next) return
                                        await onReorder(groupId, next)
                                    }}
                                >
                                    {isAdmin ? (
                                        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                            {widget === 'rss' && refreshRss ? (
                                                <button
                                                    className="rounded-lg bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white disabled:opacity-50"
                                                    aria-label="refresh"
                                                    title={lang === 'zh' ? '刷新' : 'Refresh'}
                                                    disabled={rssRefreshing}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        refreshRss()
                                                    }}
                                                >
                                                    <RefreshCw className={`h-4 w-4 ${rssRefreshing ? 'animate-spin' : ''}`} />
                                                </button>
                                            ) : null}
                                            <button
                                                className="rounded-lg bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white"
                                                aria-label="edit"
                                                title={t('widgets:edit')}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onEdit(a)
                                                }}
                                            >
                                                <Cog className="h-4 w-4" />
                                            </button>
                                            <button
                                                className="rounded-lg bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white"
                                                aria-label="delete"
                                                title={t('common:delete')}
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
                                        {WIDGET_LABEL_KEYS[widget] ? t(WIDGET_LABEL_KEYS[widget] as never) : widget}
                                    </div>
                                    <div className="min-h-0 flex-1">
                                        <WidgetBoundary
                                            fallbackLabel={t('common:widgetError')}
                                            retryLabel={t('common:retry')}
                                        >
                                        {widget === 'weather' ? (
                                            <WeatherWidget
                                                data={(weatherById && a.id in weatherById) ? (weatherById[a.id] ?? weather) : null}
                                                error={(weatherErrById && a.id in weatherErrById) ? (weatherErrById[a.id] ?? weatherErr) : null}
                                                cityName={cfg?.city as string | undefined}
                                            />
                                        ) : widget === 'metrics' ? (
                                            metrics ? (
                                                <div className="space-y-2 sm:space-y-3 text-[11px] sm:text-xs text-white/85 overflow-hidden">
                                                    {cfg?.showCpu !== false ? (
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0"><Cpu className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />CPU</span>
                                                            <span className="text-right min-w-0 truncate">
                                                                {metrics.cpuModel ? <span className="mr-1">{shortenCpuModelName(metrics.cpuModel)} ·</span> : null}
                                                                <span className="tabular-nums">{metrics.cpuPercent.toFixed(1)}%</span>
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                    {cfg?.showMem !== false ? (
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0"><MemoryStick className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('widgets:memory')}</span>
                                                            <span className="tabular-nums text-right min-w-0 truncate">
                                                                {formatGiB(metrics.memUsed)}/{formatGiB(metrics.memTotal)} · {metrics.memPercent.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                    {cfg?.showDisk !== false ? (
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0"><HardDrive className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('widgets:disk')}</span>
                                                            <span className="tabular-nums text-right min-w-0 truncate">
                                                                {formatGiB(metrics.diskUsed)}/{formatGiB(metrics.diskTotal)} · {metrics.diskPercent.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    {cfg?.showNet !== false ? (
                                                        <>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1.5 sm:gap-2 text-white/85 shrink-0"><Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('widgets:upload')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.upBps) : '—'}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1.5 sm:gap-2 text-white/85 shrink-0"><Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('widgets:download')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.downBps) : '—'}</span>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
                                            )
                                        ) : widget === 'markets' ? (
                                            <MarketsWidget data={marketsById?.[a.id] || null} error={marketsErrById?.[a.id] || null} symbols={cfg?.symbols as string[] | undefined} />
                                        ) : widget === 'holidays' ? (
                                            <HolidaysWidget data={holidaysById?.[a.id] || null} error={holidaysErrById?.[a.id] || null} />
                                        ) : widget === 'docker' ? (
                                            <DockerWidget data={dockerById?.[a.id] || null} error={dockerErrById?.[a.id] || null} isAdmin={isAdmin} />
                                        ) : widget === 'notes' ? (
                                            <NotesWidget isAdmin={isAdmin} />
                                        ) : widget === 'rss' ? (
                                            <RSSWidget data={rssById?.[a.id] || null} error={rssErrById?.[a.id] || null} lang={lang} />
                                        ) : widget === 'currency' ? (
                                            <CurrencyWidget data={currencyById?.[a.id] || null} error={currencyErrById?.[a.id] || null} />
                                        ) : widget === 'deals' ? (
                                            <DealsWidget data={dealsById?.[a.id] || null} error={dealsErrById?.[a.id] || null} lang={lang} />
                                        ) : (
                                            <TimezonesWidget localTimezone={localTimezone} clocks={clocksFromCfg(cfg)} />
                                        )}
                                        </WidgetBoundary>
                                    </div>
                                </div>
                            )
                        }

                        // When being dragged, show a ghost placeholder
                        const isDragging = draggingId === a.id
                        const isDropTarget = dropTargetId === a.id && draggingId && draggingId !== a.id

                        return (
                            <div
                                key={a.id}
                                className={`group/card relative transition-all duration-200 ease-out ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''}`}
                                draggable={isAdmin}
                                onDragStart={(e) => {
                                    if (!isAdmin) return
                                    draggingIdRef.current = a.id
                                    e.dataTransfer.effectAllowed = 'move'
                                    e.dataTransfer.setData('text/plain', a.id)
                                    // Delay state update so browser can capture drag image first
                                    setTimeout(() => {
                                        setDraggingId(a.id)
                                    }, 0)
                                }}
                                onDragEnd={() => {
                                    draggingIdRef.current = null
                                    setDraggingId(null)
                                    setDropTargetId(null)
                                }}
                                onDragEnter={(e) => {
                                    if (!isAdmin) return
                                    const fromId = draggingIdRef.current
                                    if (!fromId || fromId === a.id) return
                                    e.preventDefault()
                                    setDropTargetId(a.id)
                                }}
                                onDragOver={(e) => {
                                    if (!isAdmin) return
                                    const fromId = draggingIdRef.current
                                    if (!fromId || fromId === a.id) return
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                    if (dropTargetId !== a.id) {
                                        setDropTargetId(a.id)
                                    }
                                }}
                                onDrop={async (e) => {
                                    if (!isAdmin) return
                                    e.preventDefault()
                                    const fromId = draggingIdRef.current || e.dataTransfer.getData('text/plain')
                                    draggingIdRef.current = null
                                    setDraggingId(null)
                                    setDropTargetId(null)
                                    if (!fromId || fromId === a.id) return
                                    const next = getNextOrder(fromId, a.id)
                                    if (!next) return
                                    await onReorder(groupId, next)
                                }}
                            >
                                {isAdmin ? (
                                    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                        <button
                                            className="rounded-lg bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white"
                                            aria-label="edit"
                                            title={t('widgets:edit')}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                onEdit(a)
                                            }}
                                        >
                                            <Cog className="h-4 w-4" />
                                        </button>
                                        <button
                                            className="rounded-lg bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white"
                                            aria-label="delete"
                                            title={t('common:delete')}
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
                                    className={`group block rounded-2xl bg-black/30 backdrop-blur-md p-3 transition-all duration-200 ease-out hover:bg-black/35 hover:shadow-lg hover:shadow-black/10 ${isDropTarget ? 'ring-2 ring-white/30 scale-[1.02]' : ''}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <AppIcon iconPath={a.iconPath} name={a.name} appUrl={a.url} />
                                            {statusMap?.[a.id] ? (
                                                <StatusDot
                                                    status={statusMap[a.id].status}
                                                    className="absolute -bottom-0.5 -right-0.5 ring-1 ring-black/40"
                                                />
                                            ) : null}
                                        </div>
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

/**
 * GroupBlock is wrapped in React.memo so HomePage state churn (clock tick,
 * dialog state, drag hover) doesn't force every group on the page to
 * re-render. Widget data flows through WidgetDataContext and is therefore
 * not part of the prop comparison.
 */
export const GroupBlock = memo(GroupBlockImpl)
GroupBlock.displayName = 'GroupBlock'
