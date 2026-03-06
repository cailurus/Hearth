import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Modal } from '../ui/Modal'

interface Note {
    id: string
    title: string
    content: string
    updatedAt?: number
}

interface NotesModalProps {
    open: boolean
    onClose: () => void
    note: Note | null
    onSave: (title: string, content: string) => Promise<void>
    onDelete?: () => Promise<void>
}

function formatTime(ts: number): string {
    if (!ts) return ''
    return new Date(ts * 1000).toLocaleString()
}

export function NotesModal({ open, onClose, note, onSave, onDelete }: NotesModalProps) {
    const { t } = useTranslation(['common'])
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (open) {
            setTitle(note?.title ?? '')
            setContent(note?.content ?? '')
            setError(null)
        }
    }, [open, note])

    const handleSave = async () => {
        if (!title.trim()) return
        setSaving(true)
        setError(null)
        try {
            await onSave(title.trim(), content)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!onDelete) return
        if (!window.confirm(t('common:deleteGroupConfirm'))) return
        await onDelete()
        onClose()
    }

    const handleExportMarkdown = () => {
        if (!note) return
        const md = `# ${note.title}\n\n${note.content}`
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 30)}.md`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={note ? note.title : t('common:create')}
            closeText={t('common:close')}
            maxWidthClass="max-w-lg"
        >
            <div className="space-y-3">
                {error ? <div className="rounded-lg border border-red-400/30 bg-red-900/20 p-2 text-sm text-red-300">{error}</div> : null}
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('common:title')}</div>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        autoFocus
                    />
                </label>
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('common:description')}</div>
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={8}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none resize-y scrollbar-thin"
                    />
                </label>
                {note?.updatedAt ? (
                    <div className="text-[10px] text-white/30">{formatTime(note.updatedAt)}</div>
                ) : null}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSave}
                            disabled={saving || !title.trim()}
                            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                        >
                            {saving ? t('common:saving') : t('common:save')}
                        </button>
                        {note ? (
                            <button
                                onClick={handleExportMarkdown}
                                className="rounded-lg bg-white/10 p-2 text-white/50 hover:bg-white/20 hover:text-white/70"
                                title="Export .md"
                            >
                                <Download className="h-3.5 w-3.5" />
                            </button>
                        ) : null}
                    </div>
                    {note && onDelete ? (
                        <button
                            onClick={handleDelete}
                            className="rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/30"
                        >
                            {t('common:delete')}
                        </button>
                    ) : null}
                </div>
            </div>
        </Modal>
    )
}
