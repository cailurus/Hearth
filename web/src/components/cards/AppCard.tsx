import { Cog, Trash2 } from 'lucide-react'
import { AppIcon } from './AppIcon'
import type { AppItem } from '../../types'

export interface AppCardProps {
    app: AppItem
    isAdmin: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    lang?: 'zh' | 'en'
    onEdit?: (app: AppItem) => void
    onDelete?: (id: string) => void
    // Drag handlers
    onDragStart?: (e: React.DragEvent) => void
    onDragEnd?: () => void
    onDragEnter?: (e: React.DragEvent) => void
    onDragOver?: (e: React.DragEvent) => void
    onDrop?: (e: React.DragEvent) => void
}

/**
 * App link card component with edit/delete controls
 */
export function AppCard({
    app,
    isAdmin,
    isDragging = false,
    isDropTarget = false,
    lang = 'zh',
    onEdit,
    onDelete,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragOver,
    onDrop,
}: AppCardProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    return (
        <div
            className={`group/card relative transition-all duration-200 ease-out ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''}`}
            draggable={isAdmin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDrop={onDrop}
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
                            onEdit?.(app)
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
                            onDelete?.(app.id)
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            ) : null}

            <a
                href={app.url}
                target="_blank"
                rel="noreferrer"
                draggable={false}
                className={`group block rounded-2xl border bg-black/40 p-3 transition-all duration-200 ease-out hover:bg-black/30 hover:shadow-lg hover:shadow-black/20 ${isDropTarget ? 'border-white/50 ring-2 ring-white/30 scale-[1.02]' : 'border-white/10'}`}
            >
                <div className="flex items-center gap-3">
                    <AppIcon iconPath={app.iconPath} name={app.name} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{app.name}</div>
                        {app.description ? (
                            <div className="mt-1 line-clamp-2 text-xs text-white/70">{app.description}</div>
                        ) : (
                            <div className="truncate text-xs text-white/60">{app.url}</div>
                        )}
                    </div>
                </div>
            </a>
        </div>
    )
}

export default AppCard
