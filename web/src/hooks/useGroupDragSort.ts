/**
 * useGroupDragSort — 分组拖拽排序逻辑
 */

import { type DragEvent, useCallback, useMemo, useRef, useState } from 'react'
import { apiPost, apiPut } from '../api'
import type { AppItem, Group, Settings } from '../types'
import { isSystemGroup } from '../utils'

interface UseGroupDragSortOptions {
    isAdmin: boolean
    groups: Group[]
    apps: AppItem[]
    settings: Settings | null
    reload: () => Promise<void>
}

interface DragHandlers {
    onDragStart: (e: DragEvent) => void
    onDragEnd: () => void
    onDragOver: (e: DragEvent) => void
    onDragEnter: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
}

export interface UseGroupDragSortResult {
    sortedGroups: Group[]
    appsByGroup: Map<string | null, AppItem[]>
    hasSystemGroup: boolean
    hasUngrouped: boolean
    groupItems: (groupId: string | null) => AppItem[]
    draggingGroupId: string | null
    dropTargetGroupId: string | null
    getDragHandlers: (id: string) => DragHandlers
    reorderItems: (groupId: string | null, ids: string[]) => Promise<void>
}

export function useGroupDragSort({
    isAdmin,
    groups,
    apps,
    settings,
    reload,
}: UseGroupDragSortOptions): UseGroupDragSortResult {
    const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)
    const draggingGroupIdRef = useRef<string | null>(null)

    const sortedGroups = useMemo(() => {
        return [...groups].sort((a, b) => {
            const d1 = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            if (d1 !== 0) return d1
            const d2 = (a.createdAt ?? 0) - (b.createdAt ?? 0)
            if (d2 !== 0) return d2
            return String(a.id).localeCompare(String(b.id))
        })
    }, [groups])

    const hasSystemGroup = useMemo(() => {
        return groups.some((g) => isSystemGroup(g.kind, g.name))
    }, [groups])

    const appsByGroup = useMemo(() => {
        const m = new Map<string | null, AppItem[]>()
        for (const a of apps) {
            const key = a.groupId ?? null
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

    const hasUngrouped = (appsByGroup.get(null) ?? []).length > 0
    const groupItems = useCallback((groupId: string | null) => appsByGroup.get(groupId) ?? [], [appsByGroup])

    // Compute new group order after drag (including title)
    const getNextGroupOrder = useCallback((fromId: string, toId: string): { groupIds: string[]; titlePosition: number } | null => {
        const titlePosition = settings?.titleSortOrder ?? 0
        const groupIds = sortedGroups.map((g) => g.id)

        const currentOrder: string[] = []
        let titleInserted = false
        for (let i = 0; i < groupIds.length; i++) {
            if (!titleInserted && i >= titlePosition) {
                currentOrder.push('__title__')
                titleInserted = true
            }
            currentOrder.push(groupIds[i])
        }
        if (!titleInserted) {
            currentOrder.push('__title__')
        }

        const fromIndex = currentOrder.indexOf(fromId)
        const toIndex = currentOrder.indexOf(toId)
        if (fromIndex < 0 || toIndex < 0) return null
        if (fromIndex === toIndex) return null

        const next = [...currentOrder]
        next.splice(fromIndex, 1)
        next.splice(toIndex, 0, fromId)

        const newTitlePosition = next.indexOf('__title__')
        const newGroupIds = next.filter((id) => id !== '__title__')

        return { groupIds: newGroupIds, titlePosition: newTitlePosition }
    }, [settings?.titleSortOrder, sortedGroups])

    // Reorder groups, including title bar position
    const reorderGroupsWithTitle = useCallback(async (result: { groupIds: string[]; titlePosition: number }) => {
        if (!isAdmin) return

        const { groupIds, titlePosition } = result

        try {
            if (groupIds.length > 0) {
                await apiPost('/api/groups/reorder', { ids: groupIds })
            }

            if (settings && titlePosition !== (settings.titleSortOrder ?? 0)) {
                const newSettings = { ...settings, titleSortOrder: titlePosition }
                await apiPut('/api/settings', newSettings)
            }

            await reload()
        } catch {
            // Reorder error silently ignored; reload will restore correct state
        }
    }, [isAdmin, settings, reload])

    const reorderItems = useCallback(async (groupId: string | null, ids: string[]) => {
        if (!isAdmin) return
        if (!Array.isArray(ids) || ids.length === 0) return
        try {
            await apiPost('/api/apps/reorder', { groupId, ids })
            await reload()
        } catch {
            // Reorder error silently ignored; reload will restore correct state
        }
    }, [isAdmin, reload])

    const getDragHandlers = useCallback((id: string): DragHandlers => ({
        onDragStart: (e: DragEvent) => {
            draggingGroupIdRef.current = id
            e.dataTransfer.setData('text/plain', id)
            setTimeout(() => setDraggingGroupId(id), 0)
        },
        onDragEnd: () => {
            draggingGroupIdRef.current = null
            setDraggingGroupId(null)
            setDropTargetGroupId(null)
        },
        onDragOver: (e: DragEvent) => e.preventDefault(),
        onDragEnter: (e: DragEvent) => {
            e.preventDefault()
            setDropTargetGroupId((prev) => prev !== id ? id : prev)
        },
        onDrop: async (e: DragEvent) => {
            e.preventDefault()
            const fromId = draggingGroupIdRef.current || e.dataTransfer.getData('text/plain')
            draggingGroupIdRef.current = null
            setDraggingGroupId(null)
            setDropTargetGroupId(null)
            if (!fromId || fromId === id) return
            const next = getNextGroupOrder(fromId, id)
            if (next) await reorderGroupsWithTitle(next)
        },
    }), [getNextGroupOrder, reorderGroupsWithTitle])

    return {
        sortedGroups,
        appsByGroup,
        hasSystemGroup,
        hasUngrouped,
        groupItems,
        draggingGroupId,
        dropTargetGroupId,
        getDragHandlers,
        reorderItems,
    }
}
