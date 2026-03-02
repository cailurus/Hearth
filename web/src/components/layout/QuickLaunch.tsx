import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { AppItem } from '../../types'
import { AppIcon } from '../cards/AppIcon'

interface QuickLaunchProps {
    open: boolean
    query: string
    setQuery: (q: string) => void
    results: AppItem[]
    selectedIndex: number
    setSelectedIndex: (i: number) => void
    onClose: () => void
    onEscape: () => void
    onNavigateUp: () => void
    onNavigateDown: () => void
    onSelect: () => void
}

export function QuickLaunch({
    open,
    query,
    setQuery,
    results,
    selectedIndex,
    setSelectedIndex,
    onClose,
    onEscape,
    onNavigateUp,
    onNavigateDown,
    onSelect,
}: QuickLaunchProps) {
    const { t } = useTranslation('home')
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => inputRef.current?.focus())
        }
    }, [open])

    useEffect(() => {
        if (!listRef.current) return
        const el = listRef.current.children[selectedIndex] as HTMLElement
        el?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    if (!open) return null

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onEscape()
            return
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault()
            onNavigateUp()
            return
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            onNavigateDown()
            return
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            onSelect()
            return
        }
    }

    return (
        <div className="fixed inset-0 z-50" onClick={onClose}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <div
                className="relative mx-auto mt-[15vh] w-full max-w-xl px-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="overflow-hidden rounded-xl border border-white/15 bg-black/70 shadow-2xl backdrop-blur-xl">
                    {/* Search input */}
                    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                        <Search className="h-5 w-5 text-white/50" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('quickLaunchPlaceholder')}
                            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <kbd className="hidden sm:inline-block rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/40">
                            ESC
                        </kbd>
                    </div>

                    {/* Results list */}
                    <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
                        {results.length === 0 && query.trim() ? (
                            <div className="px-4 py-6 text-center text-sm text-white/50">
                                {t('quickLaunchNoResults')}
                                <div className="mt-1 text-xs text-white/30">
                                    {t('quickLaunchSearchWeb')}
                                </div>
                            </div>
                        ) : (
                            results.map((item, i) => (
                                <button
                                    key={item.id}
                                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                        i === selectedIndex
                                            ? 'bg-white/10'
                                            : 'hover:bg-white/5'
                                    }`}
                                    onClick={() => {
                                        window.open(item.url, '_blank')
                                        onClose()
                                    }}
                                    onMouseEnter={() => setSelectedIndex(i)}
                                >
                                    <AppIcon
                                        iconPath={item.iconPath}
                                        name={item.name}
                                        size="sm"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-white">
                                            {item.name}
                                        </div>
                                        <div className="truncate text-xs text-white/50">
                                            {item.description || item.url}
                                        </div>
                                    </div>
                                    {i === selectedIndex ? (
                                        <kbd className="hidden sm:inline-block rounded border border-white/20 px-1 py-0.5 text-[10px] text-white/40">
                                            ↵
                                        </kbd>
                                    ) : null}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Footer hint */}
                    <div className="border-t border-white/10 px-4 py-2 text-[11px] text-white/30">
                        ↑↓ {t('quickLaunchNavigate')} · ↵{' '}
                        {t('quickLaunchOpen')} · ESC{' '}
                        {t('quickLaunchClose')}
                    </div>
                </div>
            </div>
        </div>
    )
}
