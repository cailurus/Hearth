import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react'
import { Modal } from '../ui'
import { apiPost } from '../../api'
import type { WidgetKind, IconResolve } from '../../types'
import { Loader2 } from 'lucide-react'

interface AddItemDialogProps {
    open: boolean
    onClose: () => void
    groupId: string | null
    groupKind: 'system' | 'app'
    onSubmit: (data: AddItemData) => Promise<void>
    lang: 'zh' | 'en'
}

interface AddItemData {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

const WIDGET_TYPES: { kind: WidgetKind; labelZh: string; labelEn: string }[] = [
    { kind: 'weather', labelZh: '天气', labelEn: 'Weather' },
    { kind: 'timezones', labelZh: '世界时钟', labelEn: 'World Clock' },
    { kind: 'metrics', labelZh: '系统状态', labelEn: 'System Status' },
    { kind: 'markets', labelZh: '行情', labelEn: 'Markets' },
    { kind: 'holidays', labelZh: '未来假日', labelEn: 'Upcoming Holidays' },
]

const DEFAULT_WIDGET_CONFIG: Record<WidgetKind, object | null> = {
    weather: { city: 'Shanghai, Shanghai, China' },
    metrics: { showCpu: true, showMem: true, showDisk: true, showNet: true, refreshSec: 1 },
    markets: { symbols: ['BTC', 'ETH', 'AAPL', 'MSFT'] },
    holidays: { countries: ['CN', 'US'] },
    timezones: null,
}

// Simple URL validation
function isValidUrl(str: string): boolean {
    try {
        const url = new URL(str)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

export function AddItemDialog({
    open,
    onClose,
    groupId,
    groupKind,
    onSubmit,
    lang,
}: AddItemDialogProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const [name, setName] = useState('')
    const [desc, setDesc] = useState('')
    const [url, setUrl] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    // Auto-fetch state
    const [fetchingMeta, setFetchingMeta] = useState(false)
    const [previewIcon, setPreviewIcon] = useState<string | null>(null)
    const [resolvedIcon, setResolvedIcon] = useState<{ iconPath: string | null; iconSource: string | null }>({
        iconPath: null,
        iconSource: null,
    })

    // Track if user has manually edited the name
    const userEditedNameRef = useRef(false)
    const fetchSeqRef = useRef(0)

    // Reset state when dialog opens/closes
    useEffect(() => {
        if (open) {
            setName('')
            setDesc('')
            setUrl('')
            setError(null)
            setFetchingMeta(false)
            setPreviewIcon(null)
            setResolvedIcon({ iconPath: null, iconSource: null })
            userEditedNameRef.current = false
            fetchSeqRef.current = 0
        }
    }, [open])

    // Debounced auto-fetch favicon and title when URL changes
    useEffect(() => {
        if (!open || groupKind === 'system') return

        const trimmedUrl = url.trim()
        if (!trimmedUrl || !isValidUrl(trimmedUrl)) {
            setPreviewIcon(null)
            setResolvedIcon({ iconPath: null, iconSource: null })
            return
        }

        const seq = ++fetchSeqRef.current
        setFetchingMeta(true)

        const timer = window.setTimeout(async () => {
            try {
                const res = await apiPost<IconResolve>('/api/icon/resolve', { url: trimmedUrl })
                if (fetchSeqRef.current !== seq) return

                // Set preview icon
                if (res.iconPath) {
                    setPreviewIcon(`/api/icon/${res.iconPath}`)
                    setResolvedIcon({ iconPath: res.iconPath, iconSource: res.iconSource })
                } else {
                    setPreviewIcon(null)
                    setResolvedIcon({ iconPath: null, iconSource: null })
                }

                // Auto-fill name if user hasn't manually edited it
                if (res.title && !userEditedNameRef.current && !name.trim()) {
                    setName(res.title)
                }
            } catch {
                if (fetchSeqRef.current !== seq) return
                setPreviewIcon(null)
                setResolvedIcon({ iconPath: null, iconSource: null })
            } finally {
                if (fetchSeqRef.current === seq) {
                    setFetchingMeta(false)
                }
            }
        }, 500)

        return () => {
            window.clearTimeout(timer)
        }
    }, [open, groupKind, url, name])

    const handleNameChange = (value: string) => {
        setName(value)
        userEditedNameRef.current = true
    }

    const handleAddWidget = useCallback(
        async (kind: WidgetKind) => {
            setError(null)
            setLoading(true)
            try {
                const widgetName = WIDGET_TYPES.find((w) => w.kind === kind)?.[lang === 'en' ? 'labelEn' : 'labelZh'] || kind
                const config = DEFAULT_WIDGET_CONFIG[kind]
                await onSubmit({
                    groupId,
                    name: widgetName,
                    description: config ? JSON.stringify(config) : null,
                    url: `widget:${kind}`,
                    iconPath: null,
                    iconSource: null,
                })
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('添加失败', 'Failed to add'))
            } finally {
                setLoading(false)
            }
        },
        [groupId, onSubmit, onClose, lang, t]
    )

    const handleAddAppLink = useCallback(
        async (e: FormEvent) => {
            e.preventDefault()
            const trimmedName = name.trim()
            const trimmedUrl = url.trim()
            if (!trimmedName || !trimmedUrl) return

            setError(null)
            setLoading(true)
            try {
                // Use pre-resolved icon if available, otherwise fetch again
                let iconPath = resolvedIcon.iconPath
                let iconSource = resolvedIcon.iconSource

                if (!iconPath) {
                    try {
                        const res = await apiPost<IconResolve>('/api/icon/resolve', { url: trimmedUrl })
                        iconPath = res.iconPath || null
                        iconSource = res.iconSource || null
                    } catch {
                        // If icon resolution fails, still create the link
                    }
                }

                await onSubmit({
                    groupId,
                    name: trimmedName,
                    description: desc || null,  // Keep spaces if user wants blank display
                    url: trimmedUrl,
                    iconPath,
                    iconSource,
                })
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('添加失败', 'Failed to add'))
            } finally {
                setLoading(false)
            }
        },
        [name, desc, url, groupId, onSubmit, onClose, t, resolvedIcon]
    )

    const handleClose = useCallback(() => {
        setError(null)
        onClose()
    }, [onClose])

    return (
        <Modal open={open} title={t('添加组件', 'Add Item')} onClose={handleClose} closeText={t('关闭', 'Close')}>
            {error && (
                <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">
                    {error}
                </div>
            )}
            {groupKind === 'system' ? (
                <div className="grid grid-cols-3 gap-2">
                    {WIDGET_TYPES.map((widget) => (
                        <button
                            key={widget.kind}
                            onClick={() => handleAddWidget(widget.kind)}
                            disabled={loading}
                            className="h-10 rounded-lg border border-white/10 bg-black/40 px-2 text-xs hover:bg-black/30 disabled:opacity-50"
                        >
                            <div className="flex h-full w-full items-center justify-center text-center leading-tight">
                                {lang === 'en' ? widget.labelEn : widget.labelZh}
                            </div>
                        </button>
                    ))}
                </div>
            ) : (
                <form onSubmit={handleAddAppLink} className="space-y-3">
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">URL</div>
                        <div className="relative">
                            <input
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://example.com"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white outline-none placeholder:text-white/30"
                            />
                            {fetchingMeta && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                                </div>
                            )}
                        </div>
                    </label>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('名称', 'Name')}</div>
                        <div className="flex items-center gap-2">
                            {previewIcon && (
                                <img
                                    src={previewIcon}
                                    alt=""
                                    className="h-8 w-8 rounded object-contain"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none'
                                    }}
                                />
                            )}
                            <input
                                value={name}
                                onChange={(e) => handleNameChange(e.target.value)}
                                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            />
                        </div>
                    </label>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('描述', 'Description')}</div>
                        <input
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            placeholder={t('可选', 'Optional')}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={loading || !name.trim() || !url.trim()}
                        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                    >
                        {loading ? t('添加中...', 'Adding...') : t('添加', 'Add')}
                    </button>
                </form>
            )}
        </Modal>
    )
}

export default AddItemDialog
