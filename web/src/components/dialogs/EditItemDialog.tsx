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
    widgetKind: 'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | null
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
}: EditItemDialogProps) {
    const { t } = useTranslation(['home', 'common', 'widgets'])

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
