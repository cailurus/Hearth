import { useRef, useState, useCallback } from 'react'

export interface UseDragSortResult<T> {
    /** Currently dragging item ID */
    draggingId: string | null
    /** Current drop target ID */
    dropTargetId: string | null
    /** Create drag handlers for an item */
    getDragHandlers: (item: T) => DragHandlers
    /** Check if item is being dragged */
    isDragging: (id: string) => boolean
    /** Check if item is drop target */
    isDropTarget: (id: string) => boolean
}

export interface DragHandlers {
    draggable: boolean
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
}

export interface UseDragSortOptions<T> {
    /** Get item ID */
    getId: (item: T) => string
    /** Called when item is dropped */
    onReorder: (fromId: string, toId: string) => void | Promise<void>
    /** Whether drag is enabled */
    enabled?: boolean
}

/**
 * Hook for managing drag-and-drop sorting
 */
export function useDragSort<T>({
    getId,
    onReorder,
    enabled = true,
}: UseDragSortOptions<T>): UseDragSortResult<T> {
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const draggingIdRef = useRef<string | null>(null)

    const getDragHandlers = useCallback(
        (item: T): DragHandlers => {
            const id = getId(item)
            return {
                draggable: enabled,
                onDragStart: (e: React.DragEvent) => {
                    if (!enabled) return
                    draggingIdRef.current = id
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', id)
                    // Delay state update so browser can capture drag image first
                    setTimeout(() => {
                        setDraggingId(id)
                    }, 0)
                },
                onDragEnd: () => {
                    draggingIdRef.current = null
                    setDraggingId(null)
                    setDropTargetId(null)
                },
                onDragEnter: (e: React.DragEvent) => {
                    if (!enabled) return
                    const fromId = draggingIdRef.current
                    if (!fromId || fromId === id) return
                    e.preventDefault()
                    setDropTargetId(id)
                },
                onDragOver: (e: React.DragEvent) => {
                    if (!enabled) return
                    const fromId = draggingIdRef.current
                    if (!fromId || fromId === id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dropTargetId !== id) {
                        setDropTargetId(id)
                    }
                },
                onDrop: async (e: React.DragEvent) => {
                    if (!enabled) return
                    e.preventDefault()
                    const fromId = draggingIdRef.current || e.dataTransfer.getData('text/plain')
                    draggingIdRef.current = null
                    setDraggingId(null)
                    setDropTargetId(null)
                    if (!fromId || fromId === id) return
                    await onReorder(fromId, id)
                },
            }
        },
        [enabled, getId, onReorder, dropTargetId]
    )

    const isDragging = useCallback((id: string) => draggingId === id, [draggingId])

    const isDropTarget = useCallback(
        (id: string) => dropTargetId === id && draggingId !== null && draggingId !== id,
        [dropTargetId, draggingId]
    )

    return {
        draggingId,
        dropTargetId,
        getDragHandlers,
        isDragging,
        isDropTarget,
    }
}

export default useDragSort
