import type { HolidaysResponse, HolidayItem } from '../../types'

interface HolidaysWidgetProps {
    data: HolidaysResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

/**
 * 假日组件
 */
export function HolidaysWidget({ data, error, lang }: HolidaysWidgetProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
                {error}
            </div>
        )
    }

    if (!data || !data.items || data.items.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {t('暂无假日数据', 'No holidays found')}
            </div>
        )
    }

    // 按日期分组并只显示前几个
    const displayItems = data.items.slice(0, 6)

    return (
        <div className="flex flex-col gap-2 p-4 h-full overflow-hidden">
            <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('即将到来的假日', 'Upcoming Holidays')}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {displayItems.map((item, i) => (
                    <HolidayCard key={i} item={item} lang={lang} />
                ))}
            </div>
        </div>
    )
}

function HolidayCard({ item, lang }: { item: HolidayItem; lang: 'zh' | 'en' }) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)
    const displayName = lang === 'en' ? item.name : (item.localName || item.name)

    const daysText =
        item.daysUntil === 0
            ? t('今天', 'Today')
            : item.daysUntil === 1
                ? t('明天', 'Tomorrow')
                : t(`${item.daysUntil} 天后`, `in ${item.daysUntil} days`)

    return (
        <div className="flex items-center gap-2 bg-white/50 dark:bg-gray-800/50 rounded-lg px-2 py-1.5">
            <span className="text-lg">{getCountryFlag(item.country)}</span>
            <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                    {displayName}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    {formatDate(item.date, lang)} · {daysText}
                </div>
            </div>
        </div>
    )
}

function getCountryFlag(countryCode: string): string {
    // 使用 Unicode regional indicator symbols 转换国家代码为国旗 emoji
    const code = countryCode.toUpperCase()
    if (code.length !== 2) return '🏳️'

    const base = 0x1f1e6 - 65 // A
    const first = code.charCodeAt(0)
    const second = code.charCodeAt(1)

    return String.fromCodePoint(base + first) + String.fromCodePoint(base + second)
}

function formatDate(dateStr: string, lang: 'zh' | 'en'): string {
    try {
        const date = new Date(dateStr)
        return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', {
            month: 'short',
            day: 'numeric',
        })
    } catch {
        return dateStr
    }
}

export default HolidaysWidget
