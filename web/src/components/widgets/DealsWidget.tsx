import { Monitor, Apple } from 'lucide-react'
import type { DealsResponse } from '../../types'
import { Spinner } from '../ui/Spinner'

interface DealsWidgetProps {
    data: DealsResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

export function DealsWidget({ data, error, lang }: DealsWidgetProps) {
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
                {lang === 'zh' ? '暂无优惠' : 'No deals found'}
            </div>
        )
    }

    return (
        <div className="scrollbar-thin -mr-1 flex h-full flex-col gap-2 overflow-y-auto pr-1">
            {items.map((deal, i) => (
                <a
                    key={`${deal.platform}-${deal.title}-${i}`}
                    href={deal.storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-white/[0.06]"
                >
                    {/* Thumbnail */}
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded">
                        {deal.thumbnail ? (
                            <img
                                src={deal.thumbnail}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-white/10 text-white/30">
                                {deal.platform === 'ios' ? <Apple className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                            </div>
                        )}
                    </div>

                    {/* Title + Store */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] leading-tight text-white/85 sm:text-[12px]">
                            {deal.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                            {deal.platform === 'ios' ? (
                                <Apple className="h-2.5 w-2.5" />
                            ) : (
                                <Monitor className="h-2.5 w-2.5" />
                            )}
                            <span>{deal.storeName}</span>
                            {deal.rating > 0 && (
                                <span className="text-yellow-400/70">
                                    {'★'} {(deal.rating / 20).toFixed(1)}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Price + Discount */}
                    <div className="shrink-0 text-right">
                        <div className="text-[11px] sm:text-[12px]">
                            {deal.salePrice === '$0.00' || deal.salePrice === '$0' ? (
                                <span className="font-medium text-green-400">FREE</span>
                            ) : (
                                <span className="text-white/85">{deal.salePrice}</span>
                            )}
                        </div>
                        {deal.discountPct > 0 && (
                            <div className="flex items-center justify-end gap-1">
                                <span className="text-[9px] text-white/30 line-through">{deal.normalPrice}</span>
                                <span className="rounded bg-green-500/20 px-1 py-px text-[9px] font-medium text-green-400">
                                    -{deal.discountPct}%
                                </span>
                            </div>
                        )}
                    </div>
                </a>
            ))}
        </div>
    )
}
