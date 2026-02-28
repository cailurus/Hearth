/**
 * 格式化函数
 */

/**
 * 格式化字节数
 */
export function formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, decimals = 1): string {
    return value.toFixed(decimals) + '%'
}

/**
 * 格式化时间
 */
export function formatTime(timestamp: number, timezone: string, showSeconds: boolean = false): string {
    try {
        const options: Intl.DateTimeFormatOptions = {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }
        if (showSeconds) {
            options.second = '2-digit'
        }
        return new Date(timestamp).toLocaleTimeString('en-US', options)
    } catch {
        return showSeconds ? '--:--:--' : '--:--'
    }
}

/**
 * 生成 YYYY-MM-DD 格式的日期字符串
 */
export function ymdKey(date: Date, timezone: string): string {
    try {
        return new Date(date).toLocaleDateString('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
    } catch {
        return ''
    }
}

/**
 * 格式化字节/秒速率
 */
export function formatBytesPerSec(bps: number): string {
    if (!Number.isFinite(bps) || bps < 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = bps
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2
    return `${v.toFixed(digits)} ${units[i]}/s`
}

/**
 * 格式化 GiB 字节数
 */
export function formatGiB(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    const gib = bytes / (1024 * 1024 * 1024)
    return `${Math.round(gib)}GiB`
}

/**
 * 获取星期几标签
 */
export function weekdayLabel(dateStr: string, lang: 'zh' | 'en'): string {
    const d = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short' }).format(d)
}

/**
 * 缩短 CPU 型号名称
 */
export function shortenCpuModelName(model: string): string {
    const original = (model ?? '').trim()
    if (!original) return original

    // Drop common suffixes like clocks/frequency.
    let s = original
        .replace(/^\s*\d+(?:st|nd|rd|th)\s+Gen\s+/i, '')
        .replace(/\s*@\s*[\d.]+\s*GHz\b.*$/i, '')
        .replace(/\b[\d.]+\s*GHz\b/gi, '')
        .replace(/\bCPU\b/gi, '')
        .replace(/\bProcessor\b/gi, '')
        .replace(/\bwith\s+Radeon\s+Graphics\b/gi, '')
        .replace(/\(R\)|\(TM\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim()

    const lower = s.toLowerCase()
    const isIntel = lower.includes('intel')
    const isAmd = lower.includes('amd')

    if (isIntel) {
        const ultra = s.match(/\bUltra\s+[3579]\s+\d{3,4}[A-Za-z]{0,3}\b/i)
        if (ultra) return `Intel ${ultra[0]}`

        const core = s.match(/\bi[3579]-[0-9]{3,5}[A-Za-z0-9]{0,3}\b/i)
        if (core) return `Intel ${core[0]}`

        const nSeries = s.match(/\bN\d{3,4}[A-Za-z0-9]{0,3}\b/i)
        if (nSeries) return `Intel ${nSeries[0].toUpperCase()}`

        const celeronPentiumAtom = s.match(/\b(Celeron|Pentium|Atom)\s+([A-Za-z]?[0-9]{3,5}[A-Za-z0-9]{0,3})\b/i)
        if (celeronPentiumAtom) return `Intel ${celeronPentiumAtom[1]} ${celeronPentiumAtom[2].toUpperCase()}`

        const xeonE = s.match(/\bXeon\s+([A-Za-z]\d-\d{4,5}[A-Za-z0-9]{0,2})\b/i)
        if (xeonE) return `Intel Xeon ${xeonE[1].toUpperCase()}`

        const xeonTier = s.match(/\bXeon\s+(Silver|Gold|Platinum|Bronze)\s+(\d{4,5}[A-Za-z0-9]{0,2})\b/i)
        if (xeonTier) return `Intel Xeon ${xeonTier[1]} ${xeonTier[2].toUpperCase()}`

        return 'Intel'
    }

    if (isAmd) {
        const ryzen = s.match(/\bRyzen(?:\s+Threadripper)?\s+\d\s+\d{3,4}[A-Za-z0-9]{0,3}\b/i)
        if (ryzen) return `AMD ${ryzen[0]}`

        const epyc = s.match(/\bEPYC\s+\d{4}[A-Za-z0-9]{0,3}\b/i)
        if (epyc) return `AMD ${epyc[0]}`

        const athlon = s.match(/\bAthlon\s+\w+(?:\s+\w+)?\b/i)
        if (athlon) return `AMD ${athlon[0]}`

        return 'AMD'
    }

    // Fallback: keep the first few tokens
    const tokens = s.split(' ').filter(Boolean)
    if (tokens.length <= 4) return s
    return tokens.slice(0, 4).join(' ')
}
