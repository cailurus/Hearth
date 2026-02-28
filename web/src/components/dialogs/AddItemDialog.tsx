import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
}

interface AddItemData {
    groupId: string | null
    name: string
    description: string | null
    url: string
    iconPath: string | null
    iconSource: string | null
}

const WIDGET_TYPES: { kind: WidgetKind; labelKey: string }[] = [
    { kind: 'weather', labelKey: 'widgets:weather' },
    { kind: 'timezones', labelKey: 'widgets:worldClock' },
    { kind: 'metrics', labelKey: 'widgets:systemStatus' },
    { kind: 'markets', labelKey: 'widgets:markets' },
    { kind: 'holidays', labelKey: 'widgets:upcomingHolidays' },
]

const DEFAULT_WIDGET_CONFIG: Record<WidgetKind, object | null> = {
    weather: { city: 'Shanghai, Shanghai, China' },
    metrics: { showCpu: true, showMem: true, showDisk: true, showNet: true, refreshSec: 1 },
    markets: { symbols: ['BTC', 'ETH', 'AAPL', 'MSFT'] },
    holidays: { countries: ['CN', 'US'] },
    timezones: null,
}

function isValidUrl(str: string): boolean {
    try {
        const u = new URL(str)
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
        return false
    }
}

type IconMode = 'none' | 'url' | 'lucide'

export function AddItemDialog({
    open,
    onClose,
    groupId,
    groupKind,
    onSubmit,
}: AddItemDialogProps) {
    const { t } = useTranslation(['home', 'common', 'widgets'])

    const [name, setName] = useState('')
    const [desc, setDesc] = useState('')
    const [url, setUrl] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    // Icon mode: 'none' = default (use fetched icon or nothing), 'url' = custom URL, 'lucide' = icon library
    const [iconMode, setIconMode] = useState<IconMode>('none')
    const [iconUrl, setIconUrl] = useState('')

    // Fetch state
    const [fetchingMeta, setFetchingMeta] = useState(false)
    const [previewIcon, setPreviewIcon] = useState<string | null>(null)
    const [resolvedIcon, setResolvedIcon] = useState<{ iconPath: string | null; iconSource: string | null }>({
        iconPath: null,
        iconSource: null,
    })

    // Lucide icon picker state
    const [showIconPicker, setShowIconPicker] = useState(false)
    const [selectedLucideIcon, setSelectedLucideIcon] = useState<string | null>(null)

    const userEditedNameRef = useRef(false)
    const fetchSeqRef = useRef(0)

    // Reset state when dialog opens
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
            setIconMode('none')
            setIconUrl('')
            userEditedNameRef.current = false
            fetchSeqRef.current = 0
        }
    }, [open])

    // Manual icon fetch
    const handleFetchIcon = useCallback(async () => {
        const trimmedUrl = url.trim()
        if (!trimmedUrl || !isValidUrl(trimmedUrl)) return

        // Switch back to default mode (show fetched result)
        setIconMode('none')
        setSelectedLucideIcon(null)
        setIconUrl('')

        const seq = ++fetchSeqRef.current
        setFetchingMeta(true)
        setPreviewIcon(null)
        setResolvedIcon({ iconPath: null, iconSource: null })

        try {
            const res = await apiPost<IconResolve>('/api/icon/resolve', { url: trimmedUrl, refresh: true })
            if (fetchSeqRef.current !== seq) return

            if (res.iconPath) {
                setPreviewIcon(`/assets/icons/${res.iconPath}`)
                setResolvedIcon({ iconPath: res.iconPath, iconSource: res.iconSource })
            }

            // Auto-fill name if user hasn't manually edited it
            if (res.title && !userEditedNameRef.current && !name.trim()) {
                setName(res.title)
            }
        } catch {
            if (fetchSeqRef.current !== seq) return
        } finally {
            if (fetchSeqRef.current === seq) {
                setFetchingMeta(false)
            }
        }
    }, [url, name])

    const handleNameChange = (value: string) => {
        setName(value)
        userEditedNameRef.current = true
    }

    const handleAddWidget = useCallback(
        async (kind: WidgetKind) => {
            setError(null)
            setLoading(true)
            try {
                const widgetName =
                    kind === 'weather' ? t('widgets:weather')
                        : kind === 'timezones' ? t('widgets:worldClock')
                            : kind === 'metrics' ? t('widgets:systemStatus')
                                : kind === 'markets' ? t('widgets:markets')
                                    : kind === 'holidays' ? t('widgets:upcomingHolidays')
                                        : kind
                const config = DEFAULT_WIDGET_CONFIG[kind]
                await onSubmit({
                    groupId,
                    name: String(widgetName),
                    description: config ? JSON.stringify(config) : null,
                    url: `widget:${kind}`,
                    iconPath: null,
                    iconSource: null,
                })
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('home:addFailed'))
            } finally {
                setLoading(false)
            }
        },
        [groupId, onSubmit, onClose, t]
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

                // Default: use fetched icon if available
                await onSubmit({
                    groupId,
                    name: trimmedName,
                    description: desc || null,
                    url: trimmedUrl,
                    iconPath: resolvedIcon.iconPath,
                    iconSource: resolvedIcon.iconSource,
                })
                onClose()
            } catch (err) {
                setError(err instanceof Error ? err.message : t('home:addFailed'))
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
        setPreviewIcon(null)
        setResolvedIcon({ iconPath: null, iconSource: null })
    }, [])

    const handleClose = useCallback(() => {
        setError(null)
        onClose()
    }, [onClose])

    // Current preview icon based on state
    const currentPreview = (() => {
        if (iconMode === 'lucide' && selectedLucideIcon) {
            return { type: 'lucide' as const, name: selectedLucideIcon }
        }
        if (iconMode === 'url' && iconUrl.trim()) {
            return { type: 'url' as const, src: iconUrl.trim() }
        }
        if (previewIcon) {
            return { type: 'url' as const, src: previewIcon }
        }
        return null
    })()

    const canFetch = !fetchingMeta && !!url.trim() && isValidUrl(url.trim())

    return (
        <Modal open={open} title={t('home:addItem')} onClose={handleClose} closeText={t('common:close')}>
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
                                {widget.kind === 'weather' ? t('widgets:weather')
                                    : widget.kind === 'timezones' ? t('widgets:worldClock')
                                        : widget.kind === 'metrics' ? t('widgets:systemStatus')
                                            : widget.kind === 'markets' ? t('widgets:markets')
                                                : widget.kind === 'holidays' ? t('widgets:upcomingHolidays')
                                                    : widget.kind}
                            </div>
                        </button>
                    ))}
                </div>
            ) : (
                <form onSubmit={handleAddAppLink} className="space-y-3">
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">URL</div>
                        <input
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value)
                                // Clear stale fetched icon when URL changes
                                setPreviewIcon(null)
                                setResolvedIcon({ iconPath: null, iconSource: null })
                            }}
                            placeholder="https://example.com"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                        />
                    </label>
                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('common:name')}</div>
                        <input
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                    </label>

                    {/* Icon selection */}
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-3 text-sm font-semibold text-white/80">{t('common:icon')}</div>

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
                                        ? t('common:iconCustomUrl')
                                        : resolvedIcon.iconPath
                                            ? t('common:iconAutoFromUrl')
                                            : t('common:iconAutoHint')}
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button
                                type="button"
                                disabled={!canFetch}
                                onClick={handleFetchIcon}
                                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-40"
                            >
                                {fetchingMeta ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                {t('common:iconAuto')}
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
                                {t('common:iconUrl')}
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
                                {t('common:iconLibrary')}
                            </button>
                        </div>

                        {/* Mode-specific content */}
                        {iconMode === 'url' && (
                            <div>
                                <div className="mb-1 text-xs text-white/70">{t('common:iconUrlHint')}</div>
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
                                <span className="text-xs text-white/50">{t('common:iconSelected')} {selectedLucideIcon}</span>
                                <button
                                    type="button"
                                    onClick={() => setShowIconPicker(true)}
                                    className="text-xs text-white/70 hover:text-white underline"
                                >
                                    {t('common:iconChange')}
                                </button>
                            </div>
                        )}
                    </div>

                    <label className="block text-sm">
                        <div className="mb-1 text-white/70">{t('common:description')}</div>
                        <input
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            placeholder={t('common:optional')}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={loading || !name.trim() || !url.trim()}
                        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
                    >
                        {loading ? t('common:adding') : t('common:add')}
                    </button>
                </form>
            )}

            <IconPicker
                open={showIconPicker}
                onClose={() => setShowIconPicker(false)}
                onSelect={handleSelectLucideIcon}
            />
        </Modal>
    )
}

export default AddItemDialog
