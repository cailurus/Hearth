/**
 * 书签组组件 - 以紧凑 pill 形式显示链接
 */

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Cog, Trash2 } from 'lucide-react'
import type { AppItem } from '../../types'
import { AppIcon } from '../cards/AppIcon'
import { StatusDot } from '../ui/StatusDot'

interface BookmarkGroupProps {
    groupId: string
    name: string
    items: AppItem[]
    isAdmin: boolean
    onAdd: (groupId: string | null) => void
    onEdit: (item: AppItem) => void
    onDelete: (id: string) => void
    onDeleteGroup: (groupId: string) => void
    onRenameGroup?: (groupId: string, name: string) => void
    onReorder: (groupId: string | null, ids: string[]) => Promise<void>
    statusMap?: Record<string, { status: 'up' | 'slow' | 'down' | 'unknown' }>
}

export function BookmarkGroup({
    groupId,
    name,
    items,
    isAdmin,
    onAdd,
    onEdit,
    onDelete,
    onDeleteGroup,
    onRenameGroup,
    onReorder,
    statusMap,
}: BookmarkGroupProps) {
    const { t } = useTranslation(['widgets', 'common'])
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const draggingIdRef = useRef<string | null>(null)

    // Inline rename
    const [renaming, setRenaming] = useState(false)
    const [renameValue, setRenameValue] = useState('')
    const renameInputRef = useRef<HTMLInputElement>(null)

    const startRename = useCallback(() => {
        if (!isAdmin || !onRenameGroup) return
        setRenameValue(name)
        setRenaming(true)
        requestAnimationFrame(() => renameInputRef.current?.select())
    }, [isAdmin, onRenameGroup, name])

    const commitRename = useCallback(() => {
        const trimmed = renameValue.trim()
        if (trimmed && trimmed !== name && onRenameGroup) {
            onRenameGroup(groupId, trimmed)
        }
        setRenaming(false)
    }, [renameValue, name, groupId, onRenameGroup])

    const getNextOrder = (fromId: string, toId: string) => {
        const ids = items.map((it) => it.id)
        const fromIndex = ids.indexOf(fromId)
        const toIndex = ids.indexOf(toId)
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
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
                        className={`text-base font-semibold text-white/80 ${isAdmin ? 'cursor-pointer hover:text-white/90' : ''}`}
                        onDoubleClick={startRename}
                    >
                        {name}
                    </h2>
                )}
                {isAdmin ? (
                    <>
                        <button
                            onClick={() => onAdd(groupId)}
                            className="invisible rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 shadow-sm shadow-black/20 transition-colors transition-shadow hover:bg-white/20 hover:shadow-lg hover:shadow-black/30 group-hover:visible"
                            aria-label="add"
                        >
                            +
                        </button>
                        <button
                            onClick={() => {
                                if (window.confirm(t('widgets:deleteGroupConfirm'))) {
                                    onDeleteGroup(groupId)
                                }
                            }}
                            className="invisible rounded-lg bg-white/10 px-2 py-1 text-xs text-white/90 shadow-sm shadow-black/20 transition-colors transition-shadow hover:bg-red-500/50 hover:shadow-lg hover:shadow-black/30 group-hover:visible"
                            aria-label="delete group"
                        >
                            −
                        </button>
                    </>
                ) : null}
            </div>

            {items.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-white/60">{t('widgets:noItems')}</div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {items.map((a) => {
                        const isDragging = draggingId === a.id
                        const isDropTarget = dropTargetId === a.id && draggingId && draggingId !== a.id
                        const st = statusMap?.[a.id]

                        return (
                            <div
                                key={a.id}
                                className={`group/pill relative transition-all duration-200 ease-out ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''}`}
                                draggable={isAdmin}
                                onDragStart={(e) => {
                                    if (!isAdmin) return
                                    draggingIdRef.current = a.id
                                    e.dataTransfer.effectAllowed = 'move'
                                    e.dataTransfer.setData('text/plain', a.id)
                                    setTimeout(() => setDraggingId(a.id), 0)
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
                                    if (dropTargetId !== a.id) setDropTargetId(a.id)
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
                                    <div className="absolute -right-1 -top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/pill:opacity-100">
                                        <button
                                            className="rounded-full bg-black/60 p-0.5 text-white/90 hover:bg-black/80"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(a) }}
                                        >
                                            <Cog className="h-3 w-3" />
                                        </button>
                                        <button
                                            className="rounded-full bg-black/60 p-0.5 text-white/90 hover:bg-black/80"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(a.id) }}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>
                                ) : null}

                                <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    draggable={false}
                                    className={`flex items-center gap-2 rounded-full border bg-black/40 px-3 py-1.5 text-sm text-white/90 transition-all hover:bg-black/30 hover:shadow-md ${
                                        isDropTarget ? 'border-white/50 ring-2 ring-white/30 scale-[1.03]' : 'border-white/10'
                                    }`}
                                >
                                    <div className="relative">
                                        <AppIcon iconPath={a.iconPath} name={a.name} size="sm" />
                                        {st ? (
                                            <StatusDot status={st.status} className="absolute -bottom-0.5 -right-0.5 ring-1 ring-black/40" />
                                        ) : null}
                                    </div>
                                    <span className="truncate max-w-[120px]">{a.name}</span>
                                </a>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
