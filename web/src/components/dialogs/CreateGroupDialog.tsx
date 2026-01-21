import { useState, useCallback, type FormEvent } from 'react'
import { Modal } from '../ui'

interface CreateGroupDialogProps {
    open: boolean
    onClose: () => void
    onSubmit: (name: string, kind: 'system' | 'app') => Promise<void>
    hasSystemGroup: boolean
    lang: 'zh' | 'en'
}

export function CreateGroupDialog({
    open,
    onClose,
    onSubmit,
    hasSystemGroup,
    lang,
}: CreateGroupDialogProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const [name, setName] = useState('')
    const [kind, setKind] = useState<'system' | 'app'>('app')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault()
            const trimmedName = name.trim()
            if (!trimmedName) return

            setError(null)
            setLoading(true)
            try {
                await onSubmit(trimmedName, kind)
                setName('')
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('创建失败', 'Failed to create'))
            } finally {
                setLoading(false)
            }
        },
        [name, kind, onSubmit, onClose, t]
    )

    const handleClose = useCallback(() => {
        setError(null)
        setName('')
        onClose()
    }, [onClose])

    return (
        <Modal open={open} title={t('新建分组', 'New Group')} onClose={handleClose} closeText={t('关闭', 'Close')}>
            {error && (
                <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 text-sm font-semibold text-white/80">
                        {t('分组类型', 'Group type')}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-white/80">
                        <label className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="group-kind"
                                value="app"
                                checked={kind === 'app'}
                                onChange={() => setKind('app')}
                            />
                            {t('App 组件', 'App group')}
                        </label>
                        <label className={`flex items-center gap-2 ${hasSystemGroup ? 'text-white/40' : ''}`}>
                            <input
                                type="radio"
                                name="group-kind"
                                value="system"
                                disabled={hasSystemGroup}
                                checked={kind === 'system'}
                                onChange={() => setKind('system')}
                            />
                            {t('系统组件', 'System group')}
                        </label>
                    </div>
                    <div className="mt-2 text-xs text-white/50">
                        {t(
                            '系统组件只能有一个；系统组只能添加内置组件，App 组只能添加 App 链接。',
                            'Only one system group; system groups only allow widgets, app groups only allow app links.'
                        )}
                    </div>
                </div>
                <label className="block text-sm">
                    <div className="mb-1 text-white/70">{t('分组名称', 'Group name')}</div>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading || !name.trim()}
                    className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                >
                    {loading ? t('创建中...', 'Creating...') : t('创建', 'Create')}
                </button>
            </form>
        </Modal>
    )
}

export default CreateGroupDialog
