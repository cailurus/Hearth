import type { ReactNode } from 'react'
import { Cog, Trash2 } from 'lucide-react'

export interface WidgetCardProps {
    title: string
    children: ReactNode
    isAdmin?: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    lang?: 'zh' | 'en'
    className?: string
    heightClass?: string
    paddingClass?: string
    onEdit?: () => void
    onDelete?: () => void
    // Drag handlers
    onDragStart?: (e: React.DragEvent) => void
    onDragEnd?: () => void
    onDragEnter?: (e: React.DragEvent) => void
    onDragOver?: (e: React.DragEvent) => void
    onDrop?: (e: React.DragEvent) => void
}

/**
 * Widget card container component
 */
export function WidgetCard({
    title,
    children,
    isAdmin = false,
    isDragging = false,
    isDropTarget = false,
    lang = 'zh',
    className = '',
    heightClass = 'h-[174px] sm:h-[194px]',
    paddingClass = 'p-4',
    onEdit,
    onDelete,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragOver,
    onDrop,
}: WidgetCardProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    return (
        <div
            className={`group/card relative flex flex-col rounded-2xl border bg-black/40 ${paddingClass} transition-all duration-200 ease-out ${className} ${heightClass} ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30 border-dashed border-white/30 bg-white/5' : isDropTarget ? 'border-white/50 ring-2 ring-white/30 scale-[1.02]' : 'hover:bg-black/30 hover:shadow-lg hover:shadow-black/20 border-white/10'}`}
            draggable={isAdmin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            {isAdmin ? (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                    <button
                        className="rounded-lg bg-black/40 p-1 text-white/90 shadow-sm shadow-black/30 hover:bg-black/60"
                        aria-label="edit"
                        title={t('设置', 'Edit')}
                        onClick={(e) => {
                            e.stopPropagation()
                            onEdit?.()
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
                            onDelete?.()
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            ) : null}
            <div className="mb-3 truncate whitespace-nowrap text-sm font-semibold leading-tight text-white/90">
                {title}
            </div>
            <div className="min-h-0 flex-1">{children}</div>
        </div>
    )
}

export default WidgetCard
