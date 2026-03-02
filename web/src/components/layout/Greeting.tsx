interface GreetingProps {
    now: number
    username?: string
    lang: 'zh' | 'en'
}

export function Greeting({ now, username, lang }: GreetingProps) {
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
        <p className="mt-2 text-lg text-white/70 font-light">{display}</p>
    )
}
