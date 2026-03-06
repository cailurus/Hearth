import type { RSSResponse } from '../../types'
import { Spinner } from '../ui/Spinner'

interface RSSWidgetProps {
    data: RSSResponse | null
    error: string | null
    lang: 'zh' | 'en'
}

function timeAgo(ts: number, lang: 'zh' | 'en'): string {
    if (ts <= 0) return ''
    const now = Date.now() / 1000
    const diff = Math.max(0, now - ts)

    if (diff < 60) return lang === 'zh' ? '刚刚' : 'just now'
    if (diff < 3600) {
        const m = Math.floor(diff / 60)
        return lang === 'zh' ? `${m}分钟前` : `${m}m ago`
    }
    if (diff < 86400) {
        const h = Math.floor(diff / 3600)
        return lang === 'zh' ? `${h}小时前` : `${h}h ago`
    }
    const d = Math.floor(diff / 86400)
    return lang === 'zh' ? `${d}天前` : `${d}d ago`
}

export function RSSWidget({ data, error, lang }: RSSWidgetProps) {
    if (!data && !error) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner size="sm" className="border-white/40" />
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-white/40">
                {error}
            </div>
        )
    }

    const items = data?.items ?? []

    if (items.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-white/40">
                {lang === 'zh' ? '暂无文章' : 'No articles yet'}
            </div>
        )
    }

    return (
        <div className="scrollbar-thin -mr-1 flex h-full flex-col gap-2.5 overflow-y-auto pr-1">
            {items.map((item, i) => (
                <div key={`${item.link}-${i}`} className="min-w-0">
                    <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[12px] leading-snug text-white/85 hover:text-white sm:text-[13px]"
                        title={item.title}
                    >
                        {item.title}
                    </a>
                    <div className="mt-0.5 truncate text-[10px] text-white/40 sm:text-[11px]">
                        {item.source}
                        {item.publishedAt > 0 ? ` · ${timeAgo(item.publishedAt, lang)}` : ''}
                    </div>
                </div>
            ))}
        </div>
    )
}
