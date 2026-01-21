/**
 * 编辑组件/App 对话框
 */

import { type FormEvent, useState, useCallback } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { CityPicker } from '../pickers/CityPicker'
import { MarketSymbolPicker } from '../pickers/MarketSymbolPicker'
import { HolidayCountryTags } from '../pickers/HolidayCountryTags'
import { IconPicker, LucideIconDisplay } from '../ui/IconPicker'
import { Image as ImageIcon } from 'lucide-react'
import type { AppItem } from '../../types'

const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT']

interface EditItemDialogProps {
    open: boolean
    onClose: () => void
    lang: 'zh' | 'en'
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
    saveItem: (e: FormEvent) => void
    // Widget kind
    widgetKind: 'weather' | 'timezones' | 'metrics' | 'markets' | 'holidays' | null
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
    lang,
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
    saveItem,
    widgetKind,
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
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

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
            title={t('组件设置', 'Item Settings')}
            onClose={onClose}
            closeText={t('关闭', 'Close')}
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
                            <div className="mb-1 text-white/70">{t('标题', 'Title')}</div>
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
                                    <div className="mb-2 text-sm font-semibold text-white/80">{t('位置', 'Location')}</div>
                                    <div className="grid grid-cols-1 gap-3">
                                        <label className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('城市', 'City')}</div>
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
                                                placeholder={t('例如：北京 / Tokyo / Paris', 'e.g. Shanghai / Tokyo / Paris')}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        ) : widgetKind === 'metrics' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('系统状态', 'System Status')}</div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <label className="block text-sm">
                                        <div className="mb-1 text-white/70">{t('更新频率', 'Refresh interval')}</div>
                                        <select
                                            value={mRefreshSec}
                                            onChange={(e) => setMRefreshSec((Number(e.target.value) === 5 ? 5 : Number(e.target.value) === 10 ? 10 : 1) as 1 | 5 | 10)}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                        >
                                            <option value={1}>{t('1 秒', '1s')}</option>
                                            <option value={5}>{t('5 秒', '5s')}</option>
                                            <option value={10}>{t('10 秒', '10s')}</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={mShowCpu} onChange={(e) => setMShowCpu(e.target.checked)} />CPU</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={mShowMem} onChange={(e) => setMShowMem(e.target.checked)} />{t('内存', 'Memory')}</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={mShowDisk} onChange={(e) => setMShowDisk(e.target.checked)} />{t('磁盘', 'Disk')}</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={mShowNet} onChange={(e) => setMShowNet(e.target.checked)} />{t('网络', 'Network')}</label>
                                </div>
                            </div>
                        ) : widgetKind === 'markets' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('行情', 'Markets')}</div>
                                <div className="grid grid-cols-1 gap-3">
                                    {Array.from({ length: 4 }).map((_, idx) => (
                                        <label key={idx} className="block text-sm">
                                            <div className="mb-1 text-white/70">{t('搜索选择', 'Search & select')} {idx + 1}</div>
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
                                                lang={lang}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ) : widgetKind === 'holidays' ? (
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="mb-2 text-sm font-semibold text-white/80">{t('未来假日', 'Upcoming Holidays')}</div>
                                <HolidayCountryTags
                                    lang={lang}
                                    selected={hCountryCodes}
                                    query={hCountryQuery}
                                    onQueryChange={setHCountryQuery}
                                    onChange={setHCountryCodes}
                                />
                            </div>
                        ) : (
                            <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-3">
                                <div className="text-sm font-semibold text-white/80">{t('世界时钟', 'World Clock')}</div>
                                <div className="space-y-2">
                                    {tzClocks.slice(0, 4).map((c, idx) => (
                                        <div key={idx} className="grid grid-cols-1 gap-2">
                                            <label className="block text-sm">
                                                <div className="mb-1 text-white/70">{t('城市', 'City')} {idx + 1}</div>
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
                        )
                    ) : (
                        <>
                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('描述', 'Description')}</div>
                                <input
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <label className="block text-sm">
                                <div className="mb-1 text-white/70">{t('链接地址', 'URL')}</div>
                                <input
                                    value={editUrl}
                                    onChange={(e) => setEditUrl(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                                />
                            </label>

                            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                <div className="mb-3 text-sm font-semibold text-white/80">{t('图标', 'Icon')}</div>
                                
                                {/* Icon preview */}
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                                        {editIconMode === 'lucide' && editLucideIcon ? (
                                            <LucideIconDisplay name={editLucideIcon} className="h-7 w-7 text-white/80" />
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
                                            ? t('自定义图标 URL', 'Custom Icon URL')
                                            : t('从链接自动获取', 'Auto from URL')}
                                    </div>
                                </div>

                                {/* Three parallel mode buttons */}
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditIconMode('auto')
                                            setEditLucideIcon(null)
                                            setEditIconUrl('')
                                        }}
                                        className={
                                            editIconMode === 'auto'
                                                ? 'rounded-lg bg-white/20 px-3 py-2 text-sm'
                                                : 'rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20'
                                        }
                                    >
                                        {t('自动获取', 'Auto')}
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
                                        {t('图标直链', 'Icon URL')}
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
                                        {t('图标库', 'Icon Library')}
                                    </button>
                                </div>

                                {/* Mode-specific content */}
                                {editIconMode === 'auto' && (
                                    <div className="text-xs text-white/50">
                                        {t('保存时将自动从链接地址获取网站图标', 'Will auto-fetch favicon from URL on save')}
                                    </div>
                                )}

                                {editIconMode === 'url' && (
                                    <div>
                                        <div className="mb-1 text-xs text-white/70">{t('输入图标的网络地址（svg/png/ico 等）', 'Enter icon URL (svg/png/ico, etc.)')}</div>
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
                                        <span className="text-xs text-white/50">{t('已选择:', 'Selected:')} {editLucideIcon}</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowIconPicker(true)}
                                            className="text-xs text-white/70 hover:text-white underline"
                                        >
                                            {t('更换', 'Change')}
                                        </button>
                                    </div>
                                )}

                                {iconResolving && (
                                    <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                                        <Spinner />
                                        {t('正在获取图标…', 'Resolving icon…')}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {editItem.url.startsWith('widget:') ? null : (
                        <button type="submit" disabled={iconResolving} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-60">
                            {t('保存', 'Save')}
                        </button>
                    )}
                </form>
            ) : null}

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

export default EditItemDialog
