import type { QuoteResponse } from '../../types'
import { WidgetStatusFooter } from '../ui/WidgetStatusFooter'

interface GreetingProps {
    now: number
    username?: string
    lang: 'zh' | 'en'
    quote?: QuoteResponse | null
    quoteError?: string | null
    quoteRefreshing?: boolean
    refreshQuote?: () => void
}

export function Greeting({ now, username, lang, quote, quoteError, quoteRefreshing, refreshQuote }: GreetingProps) {
    const hour = new Date(now).getHours()

    let greeting: string
    if (lang === 'zh') {
        if (hour >= 5 && hour < 12) greeting = '早上好'
        else if (hour >= 12 && hour < 18) greeting = '下午好'
        else greeting = '晚上好'
    } else {
        if (hour >= 5 && hour < 12) greeting = 'Good morning'
        else if (hour >= 12 && hour < 18) greeting = 'Good afternoon'
        else greeting = 'Good evening'
    }

    const display = username ? `${greeting}, ${username}` : greeting

    return (
        <div className="mt-2">
            <p className="text-lg text-white/70 font-light">{display}</p>
            {quote?.text ? (
                <p className="mt-1.5 mx-auto max-w-4xl text-sm text-white/40 font-light italic leading-relaxed line-clamp-2">
                    &ldquo;{quote.text}&rdquo;{quote.author ? <> &mdash; {quote.author}</> : null}
                </p>
            ) : null}
            {quote || quoteError ? (
                <div className="mx-auto max-w-sm text-left">
                    <WidgetStatusFooter data={quote} error={quoteError} refreshing={quoteRefreshing} refresh={refreshQuote} />
                </div>
            ) : null}
        </div>
    )
}
