/**
 * 分组区块组件 - 显示应用和小组件的分组
 */

import { useState, useRef } from 'react'
import { Cog, Cpu, Download, HardDrive, MemoryStick, Trash2, Upload } from 'lucide-react'
import type { AppItem, HolidaysResponse, HostMetrics, MarketsResponse, Weather } from '../../types'
import { AppIcon } from '../cards/AppIcon'
import { WeatherWidget } from '../widgets/WeatherWidget'
import { MarketsWidget } from '../widgets/MarketsWidget'
import { HolidaysWidget } from '../widgets/HolidaysWidget'
import { TimezonesWidget } from '../widgets/TimezonesWidget'

import { safeParseJSON, formatBytesPerSec, formatGiB, shortenCpuModelName, clocksFromCfg } from '../../utils'

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
    onReorder: (groupId: string | null, ids: string[]) => Promise<void>
    weather: Weather | null
    weatherErr: string | null
    weatherById?: Record<string, Weather | null>
    weatherErrById?: Record<string, string | null>
    marketsById?: Record<string, MarketsResponse | null>
    marketsErrById?: Record<string, string | null>
    holidaysById?: Record<string, HolidaysResponse | null>
    holidaysErrById?: Record<string, string | null>
    metrics: HostMetrics | null
    netRate?: { upBps: number; downBps: number } | null
    localTimezone: string
    lang: 'zh' | 'en'
}

export function GroupBlock({
    groupId,
    name,
    groupKind,
    items,
    isAdmin,
    onAdd,
    onEdit,
    onDelete,
    onDeleteGroup,
    onReorder,
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
    localTimezone,
    lang,
}: GroupBlockProps) {
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const draggingIdRef = useRef<string | null>(null)

    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const isSystemGroup = groupKind === 'system' || name === '系统组件' || name === 'System Tools' || name === 'System Widgets'
    const isWidgetItem = (it: AppItem) => !!it.url?.startsWith('widget:')
    const isSystemWidgetsOnly = isSystemGroup && items.length > 0 && items.every(isWidgetItem)

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
                <h2 className="text-base font-semibold text-white/80">{name}</h2>
                {isAdmin ? (
                    <>
                        <button
                            onClick={() => onAdd(groupId)}
                            className="invisible rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 shadow-sm shadow-black/20 transition-colors transition-shadow hover:bg-white/20 hover:shadow-lg hover:shadow-black/30 group-hover:visible"
                            aria-label="add"
                            title={t('添加', 'Add')}
                        >
                            +
                        </button>
                        {groupId && onDeleteGroup ? (
                            <button
                                onClick={() => {
                                    if (window.confirm(t('确定要删除这个组及其所有内容吗？', 'Delete this group and all its contents?'))) {
                                        onDeleteGroup(groupId)
                                    }
                                }}
                                className="invisible rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 shadow-sm shadow-black/20 transition-colors transition-shadow hover:bg-red-500/50 hover:shadow-lg hover:shadow-black/30 group-hover:visible"
                                aria-label="delete group"
                                title={t('删除组', 'Delete Group')}
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
                    <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-white/60">{t('暂无内容', 'No items')}</div>
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
                                        : widget === 'metrics'
                                            ? 'col-span-2 sm:col-span-1'
                                            : ''

                            // Use auto height for all widgets - let content determine size
                            const widgetHeightClass = 'h-auto'

                            const widgetPadClass = 'p-4'

                            // When being dragged, show a ghost placeholder
                            const isDragging = draggingId === a.id
                            const isDropTarget = dropTargetId === a.id && draggingId && draggingId !== a.id

                            return (
                                <div
                                    key={a.id}
                                    className={`group/card relative flex flex-col rounded-2xl border bg-black/40 ${widgetPadClass} transition-all duration-200 ease-out ${widgetCardClass} ${widgetHeightClass} ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30 border-dashed border-white/30 bg-white/5' : isDropTarget ? 'border-white/50 ring-2 ring-white/30 scale-[1.02]' : 'hover:bg-black/30 hover:shadow-lg hover:shadow-black/20 border-white/10'}`}
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
                                                : widget === 'markets'
                                                    ? t('行情', 'Markets')
                                                    : widget === 'holidays'
                                                        ? t('未来假日', 'Upcoming Holidays')
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
                                                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0"><MemoryStick className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('内存', 'Mem')}</span>
                                                            <span className="tabular-nums text-right min-w-0 truncate">
                                                                {formatGiB(metrics.memUsed)}/{formatGiB(metrics.memTotal)} · {metrics.memPercent.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                    {cfg?.showDisk !== false ? (
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0"><HardDrive className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('磁盘', 'Disk')}</span>
                                                            <span className="tabular-nums text-right min-w-0 truncate">
                                                                {formatGiB(metrics.diskUsed)}/{formatGiB(metrics.diskTotal)} · {metrics.diskPercent.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    {cfg?.showNet !== false ? (
                                                        <>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1.5 sm:gap-2 text-white/85 shrink-0"><Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('上传', 'Up')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.upBps) : '—'}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1.5 sm:gap-2 text-white/85 shrink-0"><Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white/70" />{t('下载', 'Down')}</span>
                                                                <span className="tabular-nums">{netRate ? formatBytesPerSec(netRate.downBps) : '—'}</span>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-sm text-white/60">{t('暂不可用', 'Unavailable')}</div>
                                            )
                                        ) : widget === 'markets' ? (
                                            <MarketsWidget data={marketsById?.[a.id] || null} error={marketsErrById?.[a.id] || null} lang={lang} />
                                        ) : widget === 'holidays' ? (
                                            <HolidaysWidget data={holidaysById?.[a.id] || null} error={holidaysErrById?.[a.id] || null} lang={lang} />
                                        ) : (
                                            <TimezonesWidget localTimezone={localTimezone} clocks={clocksFromCfg(cfg)} />
                                        )}
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
                                    className={`group block rounded-2xl border bg-black/40 p-3 transition-all duration-200 ease-out hover:bg-black/30 hover:shadow-lg hover:shadow-black/20 ${isDropTarget ? 'border-white/50 ring-2 ring-white/30 scale-[1.02]' : 'border-white/10'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <AppIcon iconPath={a.iconPath} name={a.name} />
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
