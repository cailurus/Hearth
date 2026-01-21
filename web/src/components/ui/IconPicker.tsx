/**
 * Lucide 图标选择器组件
 * 使用在线搜索，不打包本地图标
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

// Lucide CDN URL for SVG icons
const LUCIDE_CDN_BASE = 'https://unpkg.com/lucide-static@latest/icons'

interface LucideIcon {
    name: string
    tags: string[]
}

interface IconPickerProps {
    open: boolean
    onClose: () => void
    onSelect: (iconName: string) => void
    lang: 'zh' | 'en'
}

export function IconPicker({ open, onClose, onSelect, lang }: IconPickerProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)
    
    const [search, setSearch] = useState('')
    const [icons, setIcons] = useState<LucideIcon[]>([])
    const [loading, setLoading] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Load popular icons when opened
    useEffect(() => {
        if (open) {
            setSearch('')
            setHasSearched(false)
            loadPopularIcons()
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [open])

    const loadPopularIcons = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/icons/lucide/search?limit=48')
            if (res.ok) {
                const data = await res.json()
                setIcons(data || [])
            }
        } catch (e) {
            console.error('Failed to load icons:', e)
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = async () => {
        const query = search.trim()
        setHasSearched(true)
        setLoading(true)
        
        try {
            const res = await fetch(`/api/icons/lucide/search?q=${encodeURIComponent(query)}&limit=100`)
            if (res.ok) {
                const data = await res.json()
                setIcons(data || [])
            }
        } catch (e) {
            console.error('Failed to search icons:', e)
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSearch()
        }
    }

    const handleSelect = useCallback((iconName: string) => {
        // Convert kebab-case to PascalCase for storage
        const pascalName = iconName
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('')
        onSelect(pascalName)
        onClose()
    }, [onSelect, onClose])

    // Close on escape
    useEffect(() => {
        if (!open) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, onClose])

    // Close on click outside
    useEffect(() => {
        if (!open) return
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        const timer = setTimeout(() => {
            window.addEventListener('click', handleClick)
        }, 100)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('click', handleClick)
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div 
                ref={containerRef}
                className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="text-base font-semibold text-white">
                        {t('选择图标', 'Choose Icon')}
                    </h3>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Search */}
                <div className="border-b border-white/10 px-4 py-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={t('输入关键词搜索...', 'Enter keywords to search...')}
                                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                            />
                        </div>
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-50"
                        >
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                t('搜索', 'Search')
                            )}
                        </button>
                    </div>
                    <div className="mt-2 text-xs text-white/40">
                        {hasSearched 
                            ? t(`找到 ${icons.length} 个图标`, `Found ${icons.length} icons`)
                            : t('热门图标', 'Popular icons')
                        }
                    </div>
                </div>

                {/* Icon Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading && icons.length === 0 ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
                        </div>
                    ) : icons.length > 0 ? (
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1">
                            {icons.map((icon) => (
                                <button
                                    key={icon.name}
                                    onClick={() => handleSelect(icon.name)}
                                    className="flex flex-col items-center justify-center rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                                    title={`${icon.name}${icon.tags?.length ? ` (${icon.tags.slice(0, 3).join(', ')})` : ''}`}
                                >
                                    <LucideIconPreview name={icon.name} className="h-6 w-6" />
                                </button>
                            ))}
                        </div>
                    ) : hasSearched ? (
                        <div className="py-8 text-center text-sm text-white/40">
                            {t('没有找到匹配的图标', 'No icons found')}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

/**
 * 从 CDN 加载 Lucide 图标 SVG
 */
interface LucideIconPreviewProps {
    name: string
    className?: string
}

// Cache for loaded SVGs
const svgCache = new Map<string, string>()

export function LucideIconPreview({ name, className = 'h-6 w-6' }: LucideIconPreviewProps) {
    const [svg, setSvg] = useState<string | null>(() => svgCache.get(name) || null)
    const [error, setError] = useState(false)

    useEffect(() => {
        if (svgCache.has(name)) {
            setSvg(svgCache.get(name)!)
            return
        }

        const loadSvg = async () => {
            try {
                const res = await fetch(`${LUCIDE_CDN_BASE}/${name}.svg`)
                if (res.ok) {
                    const text = await res.text()
                    svgCache.set(name, text)
                    setSvg(text)
                } else {
                    setError(true)
                }
            } catch {
                setError(true)
            }
        }
        loadSvg()
    }, [name])

    if (error || !svg) {
        return (
            <div className={`${className} flex items-center justify-center rounded bg-white/10`}>
                <span className="text-[8px] text-white/30">?</span>
            </div>
        )
    }

    // Parse dimensions from className
    const sizeMatch = className.match(/h-(\d+)/)
    const size = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 24

    return (
        <div
            className={className}
            style={{ width: size, height: size }}
            dangerouslySetInnerHTML={{
                __html: svg.replace(
                    '<svg',
                    `<svg width="${size}" height="${size}" class="text-current" style="color: currentColor"`
                ).replace(/stroke="[^"]*"/g, 'stroke="currentColor"')
            }}
        />
    )
}

/**
 * 渲染 Lucide 图标的辅助组件（用于 AppIcon）
 * 从 CDN 加载 SVG
 */
interface LucideIconDisplayProps {
    name: string
    className?: string
}

export function LucideIconDisplay({ name, className = 'h-6 w-6' }: LucideIconDisplayProps) {
    // Convert PascalCase to kebab-case for CDN URL
    const kebabName = name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .toLowerCase()

    return <LucideIconPreview name={kebabName} className={className} />
}

export default IconPicker
