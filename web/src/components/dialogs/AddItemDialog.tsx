import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react'
import { Modal } from '../ui'
import { apiPost } from '../../api'
import type { WidgetKind, IconResolve } from '../../types'
import { Loader2, Image as ImageIcon } from 'lucide-react'
import { IconPicker, LucideIconDisplay } from '../ui/IconPicker'

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

type IconMode = 'auto' | 'url' | 'lucide'

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

    // Icon mode state
    const [iconMode, setIconMode] = useState<IconMode>('auto')
    const [iconUrl, setIconUrl] = useState('')

    // Auto-fetch state
    const [fetchingMeta, setFetchingMeta] = useState(false)
    const [previewIcon, setPreviewIcon] = useState<string | null>(null)
    const [resolvedIcon, setResolvedIcon] = useState<{ iconPath: string | null; iconSource: string | null }>({
        iconPath: null,
        iconSource: null,
    })

    // Lucide icon picker state
    const [showIconPicker, setShowIconPicker] = useState(false)
    const [selectedLucideIcon, setSelectedLucideIcon] = useState<string | null>(null)

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
            setSelectedLucideIcon(null)
            setIconMode('auto')
            setIconUrl('')
            userEditedNameRef.current = false
            fetchSeqRef.current = 0
        }
    }, [open])

    // Debounced auto-fetch favicon and title when URL changes (only in auto mode)
    useEffect(() => {
        if (!open || groupKind === 'system' || iconMode !== 'auto') return

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
    }, [open, groupKind, url, name, iconMode])

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
                // If user selected a Lucide icon, use that
                if (iconMode === 'lucide' && selectedLucideIcon) {
                    await onSubmit({
                        groupId,
                        name: trimmedName,
                        description: desc || null,
                        url: trimmedUrl,
                        iconPath: `lucide:${selectedLucideIcon}`,
                        iconSource: 'lucide',
                    })
                    onClose()
                    return
                }

                // If using custom icon URL
                if (iconMode === 'url' && iconUrl.trim()) {
                    await onSubmit({
                        groupId,
                        name: trimmedName,
                        description: desc || null,
                        url: trimmedUrl,
                        iconPath: iconUrl.trim(),
                        iconSource: 'url',
                    })
                    onClose()
                    return
                }

                // Auto mode: Use pre-resolved icon if available, otherwise fetch again
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
                    description: desc || null,
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
        [name, desc, url, groupId, onSubmit, onClose, t, resolvedIcon, selectedLucideIcon, iconMode, iconUrl]
    )

    const handleSelectLucideIcon = useCallback((iconName: string) => {
        setSelectedLucideIcon(iconName)
        setIconMode('lucide')
        setIconUrl('')
    }, [])

    const handleClose = useCallback(() => {
        setError(null)
        onClose()
    }, [onClose])

    // Get current preview icon based on mode
    const getCurrentPreviewIcon = () => {
        if (iconMode === 'lucide' && selectedLucideIcon) {
            return { type: 'lucide' as const, name: selectedLucideIcon }
        }
        if (iconMode === 'url' && iconUrl.trim()) {
            return { type: 'url' as const, src: iconUrl.trim() }
        }
        if (iconMode === 'auto' && previewIcon) {
            return { type: 'url' as const, src: previewIcon }
        }
        return null
    }

    const currentPreview = getCurrentPreviewIcon()

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
                        <input
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                    </label>
                    
                    {/* Icon selection - Three parallel modes */}
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-3 text-sm font-semibold text-white/80">{t('图标', 'Icon')}</div>
                        
                        {/* Icon preview */}
                        <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                                {currentPreview?.type === 'lucide' ? (
                                    <LucideIconDisplay name={currentPreview.name} className="h-7 w-7 text-white/80" />
                                ) : currentPreview?.type === 'url' ? (
                                    <img
                                        src={currentPreview.src}
                                        alt=""
                                        className="h-7 w-7 object-contain"
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none'
                                        }}
                                    />
                                ) : (
                                    <ImageIcon className="h-6 w-6 text-white/30" />
                                )}
                            </div>
                            <div className="text-xs text-white/50">
                                {iconMode === 'lucide' && selectedLucideIcon 
                                    ? `Lucide: ${selectedLucideIcon}`
                                    : iconMode === 'url'
                                    ? t('自定义图标 URL', 'Custom Icon URL')
                                    : t('从链接自动获取', 'Auto from URL')}
                            </div>
                        </div>

                        {/* Three parallel mode buttons */}
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setIconMode('auto')
                                    setSelectedLucideIcon(null)
                                    setIconUrl('')
                                }}
                                className={
                                    iconMode === 'auto'
                                        ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                        : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                }
                            >
                                {t('自动获取', 'Auto')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIconMode('url')
                                    setSelectedLucideIcon(null)
                                }}
                                className={
                                    iconMode === 'url'
                                        ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                        : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                }
                            >
                                {t('图标直链', 'Icon URL')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowIconPicker(true)}
                                className={
                                    iconMode === 'lucide'
                                        ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                        : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                }
                            >
                                {t('图标库', 'Icon Library')}
                            </button>
                        </div>

                        {/* Mode-specific content */}
                        {iconMode === 'auto' && (
                            <div className="text-xs text-white/50">
                                {t('保存时将自动从链接地址获取网站图标', 'Will auto-fetch favicon from URL on save')}
                            </div>
                        )}

                        {iconMode === 'url' && (
                            <div>
                                <div className="mb-1 text-xs text-white/70">{t('输入图标的网络地址（svg/png/ico 等）', 'Enter icon URL (svg/png/ico, etc.)')}</div>
                                <input
                                    value={iconUrl}
                                    onChange={(e) => setIconUrl(e.target.value)}
                                    placeholder="https://example.com/icon.png"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </div>
                        )}

                        {iconMode === 'lucide' && selectedLucideIcon && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-white/50">{t('已选择:', 'Selected:')} {selectedLucideIcon}</span>
                                <button
                                    type="button"
                                    onClick={() => setShowIconPicker(true)}
                                    className="text-xs text-white/70 hover:text-white underline"
                                >
                                    {t('更换', 'Change')}
                                </button>
                            </div>
                        )}
                    </div>

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

            {/* Icon Picker Modal */}
            <IconPicker
                open={showIconPicker}
                onClose={() => setShowIconPicker(false)}
                onSelect={handleSelectLucideIcon}
                lang={lang}
            />
        </Modal>
    )
}

export default AddItemDialog
