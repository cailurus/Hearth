/**
 * useDialogState - 统一管理对话框状态
 */

import { useState, useCallback } from 'react'

export interface DialogStates {
    login: boolean
    settings: boolean
    createGroup: boolean
    addItem: boolean
    edit: boolean
    contextMenu: boolean
}

export interface UseDialogStateResult {
    dialogs: DialogStates
    openDialog: (name: keyof DialogStates) => void
    closeDialog: (name: keyof DialogStates) => void
    closeAll: () => void

    // Context menu specific
    contextMenuPos: { x: number; y: number }
    openContextMenu: (x: number, y: number) => void

    // Add item specific
    addItemGroupId: string | null
    addItemGroupKind: 'system' | 'app' | 'bookmark'
    openAddItem: (groupId: string | null, kind: 'system' | 'app' | 'bookmark') => void
}

const initialDialogs: DialogStates = {
    login: false,
    settings: false,
    createGroup: false,
    addItem: false,
    edit: false,
    contextMenu: false,
}

export function useDialogState(initialLogin?: boolean): UseDialogStateResult {
    const [dialogs, setDialogs] = useState<DialogStates>({
        ...initialDialogs,
        login: !!initialLogin,
    })

    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
    const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null)
    const [addItemGroupKind, setAddItemGroupKind] = useState<'system' | 'app' | 'bookmark'>('app')

    const openDialog = useCallback((name: keyof DialogStates) => {
        setDialogs((prev) => ({ ...prev, [name]: true }))
    }, [])

    const closeDialog = useCallback((name: keyof DialogStates) => {
        setDialogs((prev) => ({ ...prev, [name]: false }))
    }, [])

    const closeAll = useCallback(() => {
        setDialogs(initialDialogs)
    }, [])

    const openContextMenu = useCallback((x: number, y: number) => {
        setContextMenuPos({ x, y })
        setDialogs((prev) => ({ ...prev, contextMenu: true }))
    }, [])

    const openAddItem = useCallback((groupId: string | null, kind: 'system' | 'app' | 'bookmark') => {
        setAddItemGroupId(groupId)
        setAddItemGroupKind(kind)
        setDialogs((prev) => ({ ...prev, addItem: true }))
    }, [])

    return {
        dialogs,
        openDialog,
        closeDialog,
        closeAll,
        contextMenuPos,
        openContextMenu,
        addItemGroupId,
        addItemGroupKind,
        openAddItem,
    }
}
