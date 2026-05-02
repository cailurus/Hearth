import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, apiPut, apiDelete } from '../../api'
import { Spinner } from '../ui/Spinner'
import { NotesModal } from './NotesModal'

interface Note {
    id: string
    title: string
    content: string
    sortOrder: number
    createdAt: number
    updatedAt: number
}

interface NotesWidgetProps {
    isAdmin: boolean
}

function timeAgo(ts: number, lang: string): string {
    if (!ts) return ''
    const now = Math.floor(Date.now() / 1000)
    const diff = now - ts
    if (diff < 60) return lang === 'en' ? 'just now' : '刚刚'
    if (diff < 3600) {
        const m = Math.floor(diff / 60)
        return lang === 'en' ? `${m}m ago` : `${m}分钟前`
    }
    if (diff < 86400) {
        const h = Math.floor(diff / 3600)
        return lang === 'en' ? `${h}h ago` : `${h}小时前`
    }
    const d = Math.floor(diff / 86400)
    return lang === 'en' ? `${d}d ago` : `${d}天前`
}

export function NotesWidget({ isAdmin }: NotesWidgetProps) {
    const { t, i18n } = useTranslation(['widgets', 'common'])
    const lang = i18n.language === 'en' ? 'en' : 'zh'
    const [notes, setNotes] = useState<Note[]>([])
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [selectedNote, setSelectedNote] = useState<Note | null>(null)

    const fetchNotes = useCallback(async () => {
        try {
            const data = await apiGet<Note[]>('/api/notes')
            setNotes(Array.isArray(data) ? data : [])
        } catch {
            setNotes([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchNotes() }, [fetchNotes])

    const handleSave = async (title: string, content: string) => {
        if (selectedNote) {
            await apiPut(`/api/notes/${selectedNote.id}`, { title, content })
        } else {
            await apiPost('/api/notes', { title, content })
        }
        await fetchNotes()
    }

    const handleDelete = async () => {
        if (!selectedNote) return
        await apiDelete(`/api/notes/${selectedNote.id}`)
        await fetchNotes()
    }

    if (loading) {
        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }

    return (
        <>
            <div className="flex h-full flex-col">
                {isAdmin ? (
                    <div className="flex items-center justify-end shrink-0 mb-1.5">
                        <button
                            onClick={() => { setSelectedNote(null); setModalOpen(true) }}
                            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/20"
                        >
                            +
                        </button>
                    </div>
                ) : null}

                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-0.5">
                    {notes.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-xs text-white/40">
                            {t('widgets:noItems')}
                        </div>
                    ) : (
                        notes.map((note) => (
                            <button
                                key={note.id}
                                onClick={() => { setSelectedNote(note); setModalOpen(true) }}
                                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/5 transition-colors"
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-white/30" />
                                    <span className="truncate">{note.title}</span>
                                </div>
                                <span className="shrink-0 text-[9px] text-white/30">{timeAgo(note.updatedAt, lang)}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            <NotesModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                note={selectedNote}
                onSave={handleSave}
                onDelete={selectedNote ? handleDelete : undefined}
            />
        </>
    )
}

// Registry export — no fetchData, NotesWidget manages its own state
import { defineWidget } from '../../widgets/types'

type NotesConfig = Record<string, never>

const NOTES_DEFAULT_CONFIG = {} as NotesConfig

function NotesView({ isAdmin }: {
    data: null
    error: string | null
    cfg: NotesConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <NotesWidget isAdmin={isAdmin} />
}

export const notesWidget = defineWidget<NotesConfig, null>({
    kind: 'notes',
    labelKey: 'widgets:notes',
    defaultConfig: NOTES_DEFAULT_CONFIG,
    // No fetchData — NotesWidget manages its own data.
    Component: NotesView,
})
