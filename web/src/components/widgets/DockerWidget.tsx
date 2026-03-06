import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerContainer, DockerResponse } from '../../types/models'
import { formatGiB } from '../../utils'
import { Spinner } from '../ui/Spinner'
import { DockerDetailModal } from './DockerDetailModal'

interface DockerWidgetProps {
    data: DockerResponse | null
    error?: string | null
    isAdmin?: boolean
}

export function DockerWidget({ data, error, isAdmin }: DockerWidgetProps) {
    const { t } = useTranslation('widgets')
    const [detailOpen, setDetailOpen] = useState(false)

    if (!data) {
        const msg = String(error || '').trim()
        if (msg) return <div className="flex h-full items-center justify-center text-xs text-white/50">{msg}</div>
        return <div className="flex h-full items-center justify-center"><Spinner size="sm" className="border-white/40" /></div>
    }

    if (!data.available) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <div className="text-xs text-white/50">{t('dockerNotAvailable')}</div>
                <div className="text-[10px] text-white/30">{t('dockerMountHint')}</div>
            </div>
        )
    }

    const running = data.containers.filter((c: DockerContainer) => c.status === 'running').length
    const stopped = data.containers.filter((c: DockerContainer) => c.status !== 'running').length
    const sortedRunning = data.containers
        .filter((c: DockerContainer) => c.status === 'running')
        .sort((a: DockerContainer, b: DockerContainer) => b.cpuPercent - a.cpuPercent)

    return (
        <>
            <div
                className="flex h-full cursor-pointer flex-col"
                onClick={() => setDetailOpen(true)}
            >
                {/* Top: container counts */}
                <div className="flex items-center gap-3 text-[11px] sm:text-xs shrink-0">
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                        <span className="text-white/80">{running} {t('dockerRunning')}</span>
                    </span>
                    {stopped > 0 && (
                        <span className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                            <span className="text-white/80">{stopped} {t('dockerStopped')}</span>
                        </span>
                    )}
                </div>

                {/* Middle: container list (scrollable) */}
                <div className="flex-1 min-h-0 overflow-y-auto mt-2 mb-2 space-y-0.5 scrollbar-thin">
                    {sortedRunning.map((c: DockerContainer) => (
                        <div key={c.id} className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/70">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-400/70" />
                                <span className="truncate">{c.name}</span>
                            </div>
                            <span className="tabular-nums shrink-0 ml-2 text-white/50">{c.cpuPercent.toFixed(1)}%</span>
                        </div>
                    ))}
                    {data.containers
                        .filter((c: DockerContainer) => c.status !== 'running')
                        .map((c: DockerContainer) => (
                            <div key={c.id} className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/40">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500/50" />
                                    <span className="truncate">{c.name}</span>
                                </div>
                                <span className="tabular-nums shrink-0 ml-2">{t('dockerStopped')}</span>
                            </div>
                        ))}
                </div>

                {/* Bottom: resource summary */}
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/60 shrink-0 border-t border-white/5 pt-1.5">
                    <span>CPU <span className="tabular-nums text-white/80">{data.totalCpu.toFixed(1)}%</span></span>
                    <span>MEM <span className="tabular-nums text-white/80">{formatGiB(data.totalMemUsed)}</span></span>
                </div>
            </div>

            <DockerDetailModal
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                data={data}
                isAdmin={!!isAdmin}
            />
        </>
    )
}
