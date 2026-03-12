/**
 * 编辑组件/App 对话框
 */

import { type FormEvent, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { CityPicker } from '../pickers/CityPicker'
import { MarketSymbolPicker } from '../pickers/MarketSymbolPicker'
import { HolidayCountryTags } from '../pickers/HolidayCountryTags'
import { MetricsHistoryPanel } from '../widgets/MetricsHistoryPanel'
import { IconPicker, LucideIconDisplay } from '../ui/IconPicker'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import type { AppItem } from '../../types'
import { DEFAULT_MARKET_SYMBOLS } from '../../utils'

interface EditItemDialogProps {
    open: boolean
    onClose: () => void
    editErr: string | null
    editItem: AppItem | null
    // App edit fields
    editName: string
    setEditName: (v: string) => void
    editDesc: string
    setEditDesc: (v: string) => void
    editUrl: string
    setEditUrl: (v: string) => void
    editIconMode: 'auto' | 'url' | 'lucide'
    setEditIconMode: (v: 'auto' | 'url' | 'lucide') => void
    editIconUrl: string
    setEditIconUrl: (v: string) => void
    editLucideIcon: string | null
    setEditLucideIcon: (v: string | null) => void
    iconResolving: boolean
    fetchingIcon: boolean
    fetchedIconPreview: string | null
    onFetchIcon: () => void
    saveItem: (e: FormEvent) => void
    // Widget kind
    widgetKind: 'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | 'docker' | 'notes' | 'rss' | 'currency' | 'deals' | null
    // Widget save callback (for weather, timezones, markets)
    onSaveWidget?: () => Promise<void>
    widgetSaving?: boolean
    // Weather
    wCity: string
    setWCity: (v: string) => void
    setCityQuery: (v: string) => void
    cityOptions: string[]
    // Metrics
    mRefreshSec: 1 | 5 | 10
    setMRefreshSec: (v: 1 | 5 | 10) => void
    mShowCpu: boolean
    setMShowCpu: (v: boolean) => void
    mShowMem: boolean
    setMShowMem: (v: boolean) => void
    mShowDisk: boolean
    setMShowDisk: (v: boolean) => void
    mShowNet: boolean
    setMShowNet: (v: boolean) => void
    // Markets
    mkSymbols: string[]
    setMkSymbols: React.Dispatch<React.SetStateAction<string[]>>
    mkQueries: string[]
    setMkQueries: React.Dispatch<React.SetStateAction<string[]>>
    ensureFourMarketSymbols: (raw: string[]) => string[]
    // Holidays
    hCountryCodes: string[]
    setHCountryCodes: (v: string[]) => void
    hCountryQuery: string
    setHCountryQuery: (v: string) => void
    // Timezones
    tzClocks: Array<{ city: string; timezone: string }>
    setTzClocks: React.Dispatch<React.SetStateAction<Array<{ city: string; timezone: string }>>>
    resolveCityToTimezoneEn: (city: string) => Promise<{ city: string; timezone: string }>
    // Docker
    dRefreshSec: 5 | 10 | 30
    setDRefreshSec: (v: 5 | 10 | 30) => void
    // RSS
    rssFeeds: string[]
    setRssFeeds: React.Dispatch<React.SetStateAction<string[]>>
    rssSize: 'normal' | 'tall'
    setRssSize: (v: 'normal' | 'tall') => void
    // Currency
    cPairs: string[]
    setCPairs: React.Dispatch<React.SetStateAction<string[]>>
    // Deals
    dlRegion: string
    setDlRegion: (v: string) => void
}

export function EditItemDialog({
    open,
    onClose,
    editErr,
    editItem,
    editName,
    setEditName,
    editDesc,
    setEditDesc,
    editUrl,
    setEditUrl,
    editIconMode,
    setEditIconMode,
    editIconUrl,
    setEditIconUrl,
    editLucideIcon,
    setEditLucideIcon,
    iconResolving,
    fetchingIcon,
    fetchedIconPreview,
    onFetchIcon,
    saveItem,
    widgetKind,
    onSaveWidget,
    widgetSaving,
    wCity,
    setWCity,
    setCityQuery,
    cityOptions,
    mRefreshSec,
    setMRefreshSec,
    mShowCpu,
    setMShowCpu,
    mShowMem,
    setMShowMem,
    mShowDisk,
    setMShowDisk,
    mShowNet,
    setMShowNet,
    mkSymbols,
    setMkSymbols,
    mkQueries,
    setMkQueries,
    ensureFourMarketSymbols,
    hCountryCodes,
    setHCountryCodes,
    hCountryQuery,
    setHCountryQuery,
    tzClocks,
    setTzClocks,
    resolveCityToTimezoneEn,
    dRefreshSec,
    setDRefreshSec,
    rssFeeds,
    setRssFeeds,
    rssSize,
    setRssSize,
    cPairs,
    setCPairs,
    dlRegion,
    setDlRegion,
}: EditItemDialogProps) {
    const { t } = useTranslation(['home', 'common', 'widgets', 'settings'])

    // Lucide icon picker state
    const [showIconPicker, setShowIconPicker] = useState(false)

    const handleSelectLucideIcon = useCallback((iconName: string) => {
        setEditLucideIcon(iconName)
        setEditIconMode('lucide')
        setEditIconUrl('')
    }, [setEditLucideIcon, setEditIconMode, setEditIconUrl])

    // Get current icon for preview
    const currentIconPath = editIconMode === 'lucide' && editLucideIcon
        ? `lucide:${editLucideIcon}`
        : editIconMode === 'url'
            ? editIconUrl
            : editItem?.iconPath

    return (
        <Modal
            open={open}
            title={t('home:itemSettings')}
            onClose={onClose}
            closeText={t('common:close')}
            maxWidthClass="max-w-lg"
            containerClassName="items-start pt-[18vh] sm:pt-[22vh]"
        >
            {editErr ? <div className="mb-3 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">{editErr}</div> : null}
            {editItem ? (
                <form
                    onSubmit={(e) => {
                        if (editItem.url.startsWith('widget:')) {
                            e.preventDefault()
                            return
                        }
                        saveItem(e)
                    }}
                    className="space-y-4"
                >
                    {editItem.url.startsWith('widget:') ? null : (
                        <label className="block text-sm">
                            <div className="mb-1 text-white/70">{t('common:title')}</div>
                            <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>
                    )}

                    {editItem.url.startsWith('widget:') ? (
                        widgetKind === 'weather' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:weatherLocation')}</div>
                                    <div className="grid grid-cols-1 gap-3">
                                        <label className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('widgets:weatherCity')}</div>
                                            <CityPicker
                                                value={wCity}
                                                onChange={(v) => {
                                                    setCityQuery(v)
                                                    setWCity(v)
                                                }}
                                                onPick={(picked) => {
                                                    setCityQuery(picked)
                                                    setWCity(picked)
                                                }}
                                                options={cityOptions}
                                                placeholder={t('widgets:weatherCityPlaceholder')}
                                            />
                                        </label>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={widgetSaving}
                                    onClick={() => onSaveWidget?.()}
                                    className="flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60 min-w-[64px]"
                                >
                                    {widgetSaving ? <Spinner size="sm" /> : t('common:save')}
                                </button>
                            </div>
                        ) : widgetKind === 'metrics' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:systemStatus')}</div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <label className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('widgets:refreshInterval')}</div>
                                            <select
                                                value={mRefreshSec}
                                                onChange={(e) => setMRefreshSec((Number(e.target.value) === 5 ? 5 : Number(e.target.value) === 10 ? 10 : 1) as 1 | 5 | 10)}
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                            >
                                                <option value={1}>{t('widgets:refreshSec1')}</option>
                                                <option value={5}>{t('widgets:refreshSec5')}</option>
                                                <option value={10}>{t('widgets:refreshSec10')}</option>
                                            </select>
                                        </label>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-3 text-sm">
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowCpu} onChange={(e) => setMShowCpu(e.target.checked)} />{t('widgets:cpu')}</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowMem} onChange={(e) => setMShowMem(e.target.checked)} />{t('widgets:memory')}</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowDisk} onChange={(e) => setMShowDisk(e.target.checked)} />{t('widgets:disk')}</label>
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={mShowNet} onChange={(e) => setMShowNet(e.target.checked)} />{t('widgets:network')}</label>
                                    </div>
                                </div>
                                <MetricsHistoryPanel />
                            </div>
                        ) : widgetKind === 'markets' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:markets')}</div>
                                    <div className="grid grid-cols-1 gap-3">
                                        {Array.from({ length: 4 }).map((_, idx) => (
                                            <label key={idx} className="block text-sm">
                                                <div className="mb-1 text-white/70">{t('widgets:marketsSearchSelect')} {idx + 1}</div>
                                                <MarketSymbolPicker
                                                    value={String(mkSymbols[idx] ?? '')}
                                                    query={String(mkQueries[idx] ?? '')}
                                                    onQueryChange={(q) =>
                                                        setMkQueries((prev) => {
                                                            const next = Array.isArray(prev) ? prev.slice() : []
                                                            while (next.length < 4) next.push('')
                                                            next[idx] = q
                                                            return next
                                                        })
                                                    }
                                                    onSelect={(picked) => {
                                                        setMkSymbols((prev) => {
                                                            const next = Array.isArray(prev) ? prev.slice() : []
                                                            while (next.length < 4) next.push(DEFAULT_MARKET_SYMBOLS[next.length] || 'BTC')
                                                            next[idx] = picked
                                                            return ensureFourMarketSymbols(next)
                                                        })
                                                        setMkQueries((prev) => {
                                                            const next = Array.isArray(prev) ? prev.slice() : []
                                                            while (next.length < 4) next.push(DEFAULT_MARKET_SYMBOLS[next.length] || 'BTC')
                                                            next[idx] = picked
                                                            return next.slice(0, 4)
                                                        })
                                                    }}
                                                    placeholder={DEFAULT_MARKET_SYMBOLS[idx] || ''}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={widgetSaving}
                                    onClick={() => onSaveWidget?.()}
                                    className="flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60 min-w-[64px]"
                                >
                                    {widgetSaving ? <Spinner size="sm" /> : t('common:save')}
                                </button>
                            </div>
                        ) : widgetKind === 'holidays' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:upcomingHolidays')}</div>
                                <HolidayCountryTags
                                    selected={hCountryCodes}
                                    query={hCountryQuery}
                                    onQueryChange={setHCountryQuery}
                                    onChange={setHCountryCodes}
                                />
                            </div>
                        ) : widgetKind === 'docker' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:docker')}</div>
                                <div className="grid grid-cols-1 gap-3">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('widgets:refreshInterval')}</div>
                                        <select
                                            value={dRefreshSec}
                                            onChange={(e) => setDRefreshSec((Number(e.target.value) === 10 ? 10 : Number(e.target.value) === 30 ? 30 : 5) as 5 | 10 | 30)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        >
                                            <option value={5}>{t('widgets:refreshSec5')}</option>
                                            <option value={10}>{t('widgets:refreshSec10')}</option>
                                            <option value={30}>{t('widgets:refreshSec30')}</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                        ) : widgetKind === 'rss' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:rss')}</div>
                                    <div className="mb-3">
                                        <div className="mb-1 text-sm text-white/70">{t('widgets:rssSize')}</div>
                                        <div className="flex gap-1.5">
                                            <button type="button" onClick={() => setRssSize('normal')}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${rssSize === 'normal' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>
                                                {t('widgets:rssSizeNormal')}
                                            </button>
                                            <button type="button" onClick={() => setRssSize('tall')}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${rssSize === 'tall' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>
                                                {t('widgets:rssSizeTall')}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        {rssFeeds.map((feed, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                <input
                                                    value={feed}
                                                    onChange={(e) => {
                                                        const next = [...rssFeeds]
                                                        next[idx] = e.target.value
                                                        setRssFeeds(next)
                                                    }}
                                                    placeholder={t('widgets:rssFeedUrl')}
                                                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setRssFeeds(rssFeeds.filter((_, i) => i !== idx))}
                                                    className="shrink-0 rounded-lg bg-white/10 px-2 py-2 text-xs text-white/70 hover:bg-red-500/30 hover:text-white"
                                                >
                                                    {t('widgets:rssRemoveFeed')}
                                                </button>
                                            </div>
                                        ))}
                                        {rssFeeds.length < 10 && (
                                            <button
                                                type="button"
                                                onClick={() => setRssFeeds([...rssFeeds, ''])}
                                                className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/20 hover:text-white"
                                            >
                                                {t('widgets:rssAddFeed')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={widgetSaving}
                                    onClick={() => onSaveWidget?.()}
                                    className="flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60 min-w-[64px]"
                                >
                                    {widgetSaving ? <Spinner size="sm" /> : t('common:save')}
                                </button>
                            </div>
                        ) : widgetKind === 'currency' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:currency')}</div>
                                    <div className="space-y-2">
                                        {cPairs.map((pair, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                <input
                                                    value={pair}
                                                    onChange={(e) => {
                                                        const next = [...cPairs]
                                                        next[idx] = e.target.value.toUpperCase()
                                                        setCPairs(next)
                                                    }}
                                                    placeholder="USD-CNY"
                                                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setCPairs(cPairs.filter((_, i) => i !== idx))}
                                                    className="shrink-0 rounded-lg bg-white/10 px-2 py-2 text-xs text-white/70 hover:bg-red-500/30 hover:text-white"
                                                >
                                                    {t('widgets:currencyRemovePair')}
                                                </button>
                                            </div>
                                        ))}
                                        {cPairs.length < 4 && (
                                            <button
                                                type="button"
                                                onClick={() => setCPairs([...cPairs, ''])}
                                                className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/20 hover:text-white"
                                            >
                                                {t('widgets:currencyAddPair')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={widgetSaving}
                                    onClick={() => onSaveWidget?.()}
                                    className="flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60 min-w-[64px]"
                                >
                                    {widgetSaving ? <Spinner size="sm" /> : t('common:save')}
                                </button>
                            </div>
                        ) : widgetKind === 'deals' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:deals')}</div>
                                <label className="block text-sm">
                                    <div className="mb-1 text-white/70">{t('widgets:dealsRegion')}</div>
                                    <select
                                        value={dlRegion}
                                        onChange={(e) => setDlRegion(e.target.value)}
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                    >
                                        <option value="us">{t('widgets:dealsRegionUS')}</option>
                                        <option value="cn">{t('widgets:dealsRegionCN')}</option>
                                        <option value="hk">{t('widgets:dealsRegionHK')}</option>
                                        <option value="tw">{t('widgets:dealsRegionTW')}</option>
                                        <option value="jp">{t('widgets:dealsRegionJP')}</option>
                                        <option value="gb">{t('widgets:dealsRegionGB')}</option>
                                    </select>
                                </label>
                            </div>
                        ) : widgetKind === 'notes' ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('widgets:notes')}</div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const { apiGet } = await import('../../api')
                                                    const notes = await apiGet<Array<{ title: string; content: string }>>('/api/notes')
                                                    if (!Array.isArray(notes) || notes.length === 0) return
                                                    const md = notes.map((n) => `# ${n.title}\n\n${n.content}`).join('\n\n---\n\n')
                                                    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
                                                    const url = URL.createObjectURL(blob)
                                                    const a = document.createElement('a')
                                                    a.href = url
                                                    a.download = `hearth-notes-${new Date().toISOString().slice(0, 10)}.md`
                                                    a.click()
                                                    URL.revokeObjectURL(url)
                                                } catch { /* ignore */ }
                                            }}
                                            className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                                        >
                                            {t('settings:export')}
                                        </button>
                                        <label className="inline-flex cursor-pointer items-center rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
                                            {t('settings:import')}
                                            <input
                                                type="file"
                                                accept=".md,.markdown,.txt"
                                                multiple
                                                className="hidden"
                                                onChange={async (e) => {
                                                    const files = e.target.files
                                                    if (!files || files.length === 0) return
                                                    e.target.value = ''
                                                    const { apiPost } = await import('../../api')
                                                    for (const file of Array.from(files)) {
                                                        try {
                                                            const text = await file.text()
                                                            const title = file.name.replace(/\.(md|markdown|txt)$/i, '')
                                                            await apiPost('/api/notes', { title, content: text })
                                                        } catch { /* skip */ }
                                                    }
                                                    window.location.reload()
                                                }}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-3">
                                    <div className="text-sm font-semibold text-white/80">{t('widgets:worldClock')}</div>
                                    <div className="space-y-2">
                                        {tzClocks.slice(0, 4).map((c, idx) => (
                                            <div key={idx} className="grid grid-cols-1 gap-2">
                                                <label className="block text-sm">
                                                    <div className="mb-1 text-white/70">{t('widgets:weatherCity')} {idx + 1}</div>
                                                    <CityPicker
                                                        value={c.city}
                                                        onChange={(v) => {
                                                            setCityQuery(v)
                                                            setTzClocks((prev) => prev.map((x, i) => (i === idx ? { ...x, city: v } : x)))
                                                        }}
                                                        onPick={(picked) => {
                                                            void (async () => {
                                                                try {
                                                                    const r = await resolveCityToTimezoneEn(picked)
                                                                    setTzClocks((prev) =>
                                                                        prev.map((x, i) =>
                                                                            i === idx
                                                                                ? {
                                                                                    ...x,
                                                                                    city: r.city,
                                                                                    timezone: r.timezone || x.timezone,
                                                                                }
                                                                                : x,
                                                                        ),
                                                                    )
                                                                } catch {
                                                                    // keep user input
                                                                }
                                                            })()
                                                        }}
                                                        options={cityOptions}
                                                    />
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={widgetSaving}
                                    onClick={() => onSaveWidget?.()}
                                    className="flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60 min-w-[64px]"
                                >
                                    {widgetSaving ? <Spinner size="sm" /> : t('common:save')}
                                </button>
                            </div>
                        )
                    ) : (
                        <>
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('common:description')}</div>
                                <input
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('common:url')}</div>
                                <input
                                    value={editUrl}
                                    onChange={(e) => setEditUrl(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                <div className="mb-3 text-sm font-semibold text-white/80">{t('common:icon')}</div>

                                {/* Icon preview */}
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                                        {editIconMode === 'lucide' && editLucideIcon ? (
                                            <LucideIconDisplay name={editLucideIcon} className="h-7 w-7 text-white/80" />
                                        ) : editIconMode === 'auto' && fetchedIconPreview ? (
                                            <img
                                                src={fetchedIconPreview}
                                                alt=""
                                                className="h-7 w-7 object-contain"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none'
                                                }}
                                            />
                                        ) : currentIconPath && !currentIconPath.startsWith('lucide:') ? (
                                            <img
                                                src={`/assets/icons/${currentIconPath}`}
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
                                        {editIconMode === 'lucide' && editLucideIcon
                                            ? `Lucide: ${editLucideIcon}`
                                            : editIconMode === 'url' && editIconUrl.trim()
                                                ? t('common:iconCustomUrl')
                                                : t('common:iconAutoFromUrl')}
                                    </div>
                                </div>

                                {/* Three parallel mode buttons */}
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <button
                                        type="button"
                                        disabled={editIconMode === 'auto' && (fetchingIcon || !editUrl.trim())}
                                        onClick={() => {
                                            if (editIconMode === 'auto') {
                                                onFetchIcon()
                                            } else {
                                                setEditIconMode('auto')
                                                setEditLucideIcon(null)
                                                setEditIconUrl('')
                                            }
                                        }}
                                        className={`flex items-center gap-1.5 ${
                                            editIconMode === 'auto'
                                                ? 'rounded-lg bg-white/20 px-3 py-2 text-sm disabled:opacity-40'
                                                : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                        }`}
                                    >
                                        {editIconMode === 'auto' && fetchingIcon ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : null}
                                        {t('common:iconAuto')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditIconMode('url')
                                            setEditLucideIcon(null)
                                        }}
                                        className={
                                            editIconMode === 'url'
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
                                            editIconMode === 'lucide'
                                                ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                                : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                        }
                                    >
                                        {t('common:iconLibrary')}
                                    </button>
                                </div>

                                {/* Mode-specific content */}
                                {editIconMode === 'url' && (
                                    <div>
                                        <div className="mb-1 text-xs text-white/70">{t('common:iconUrlHint')}</div>
                                        <input
                                            value={editIconUrl}
                                            onChange={(e) => setEditIconUrl(e.target.value)}
                                            placeholder="https://example.com/icon.png"
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        />
                                    </div>
                                )}

                                {editIconMode === 'lucide' && editLucideIcon && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-white/50">{t('common:iconSelected')} {editLucideIcon}</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowIconPicker(true)}
                                            className="text-xs text-white/70 hover:text-white underline"
                                        >
                                            {t('common:iconChange')}
                                        </button>
                                    </div>
                                )}

                                {iconResolving && (
                                    <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                                        <Spinner />
                                        {t('common:iconResolving')}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {editItem.url.startsWith('widget:') ? null : (
                        <button type="submit" disabled={iconResolving} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60">
                            {t('common:save')}
                        </button>
                    )}
                </form>
            ) : null}

            {/* Icon Picker Modal */}
            <IconPicker
                open={showIconPicker}
                onClose={() => setShowIconPicker(false)}
                onSelect={handleSelectLucideIcon}
            />
        </Modal>
    )
}

export default EditItemDialog
