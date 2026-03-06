import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet } from '../../api/client'
import type { MetricsHistoryResponse } from '../../types'
import { MetricsChart } from './MetricsChart'
import { Spinner } from '../ui/Spinner'

type Period = '1h' | '6h' | '24h' | '7d'
type MetricTab = 'cpu' | 'mem' | 'disk' | 'net'

const PERIODS: { value: Period; zhLabel: string; enLabel: string }[] = [
    { value: '1h', zhLabel: '1小时', enLabel: '1h' },
    { value: '6h', zhLabel: '6小时', enLabel: '6h' },
    { value: '24h', zhLabel: '24小时', enLabel: '24h' },
    { value: '7d', zhLabel: '7天', enLabel: '7d' },
]

const TABS: { value: MetricTab; i18nKey: string }[] = [
    { value: 'cpu', i18nKey: 'widgets:metricsCpu' },
    { value: 'mem', i18nKey: 'widgets:metricsMem' },
    { value: 'disk', i18nKey: 'widgets:metricsDisk' },
    { value: 'net', i18nKey: 'widgets:metricsNet' },
]

export function MetricsHistoryPanel() {
    const { t, i18n } = useTranslation()
    const lang = (i18n.language?.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en'

    const [period, setPeriod] = useState<Period>('1h')
    const [metric, setMetric] = useState<MetricTab>('cpu')
    const [data, setData] = useState<MetricsHistoryResponse | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        apiGet<MetricsHistoryResponse>(`/api/metrics/history?period=${period}`)
            .then((res) => {
                if (!cancelled) setData(res)
            })
            .catch(() => {
                if (!cancelled) setData(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
    }, [period])

    return (
        <div className="rounded-xl border border-white/10 bg-black/40 p-3">
            <div className="mb-3 text-sm font-semibold text-white/80">{t('widgets:metricsHistory')}</div>

            {/* Period selector */}
            <div className="mb-3 flex gap-1.5">
                {PERIODS.map((p) => (
                    <button
                        key={p.value}
                        onClick={() => setPeriod(p.value)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                            period === p.value
                                ? 'bg-white/20 text-white'
                                : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                        }`}
                    >
                        {lang === 'zh' ? p.zhLabel : p.enLabel}
                    </button>
                ))}
            </div>

            {/* Metric tabs */}
            <div className="mb-3 flex gap-1.5">
                {TABS.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setMetric(tab.value)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                            metric === tab.value
                                ? 'bg-white/20 text-white'
                                : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                        }`}
                    >
                        {t(tab.i18nKey)}
                    </button>
                ))}
            </div>

            {/* Chart */}
            {loading ? (
                <div className="flex h-[160px] items-center justify-center">
                    <Spinner size="sm" className="border-white/40" />
                </div>
            ) : (
                <MetricsChart
                    points={data?.points ?? []}
                    metric={metric}
                    period={period}
                    lang={lang}
                />
            )}
        </div>
    )
}
