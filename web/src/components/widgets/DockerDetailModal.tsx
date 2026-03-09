import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import type { DockerResponse } from '../../types/models'
import { formatGiB } from '../../utils'
import { apiPost } from '../../api'

interface DockerDetailModalProps {
    open: boolean
    onClose: () => void
    data: DockerResponse
    isAdmin: boolean
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function DockerDetailModal({ open, onClose, data, isAdmin }: DockerDetailModalProps) {
    const { t } = useTranslation(['widgets', 'common'])
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

    const doAction = async (containerId: string, action: string) => {
        setActionLoading((prev) => ({ ...prev, [`${containerId}-${action}`]: true }))
        try {
            await apiPost(`/api/widgets/docker/${containerId}/${action}`)
        } catch {
            // ignore — next poll will show the result
        } finally {
            setActionLoading((prev) => ({ ...prev, [`${containerId}-${action}`]: false }))
        }
    }

    const statusDotColor = (status: string) => {
        switch (status) {
            case 'running': return 'bg-green-400'
            case 'paused': return 'bg-yellow-400'
            default: return 'bg-gray-400'
        }
    }

    const statusLabel = (status: string) => {
        switch (status) {
            case 'running': return t('widgets:dockerRunning')
            case 'paused': return t('widgets:dockerPaused')
            default: return t('widgets:dockerStopped')
        }
    }

    const sorted = [...data.containers].sort((a, b) => {
        const order: Record<string, number> = { running: 0, paused: 1, exited: 2 }
        return (order[a.status] ?? 3) - (order[b.status] ?? 3)
    })

    const ActionBtn = ({ cid, action, label }: { cid: string; action: string; label: string }) => {
        const loading = actionLoading[`${cid}-${action}`]
        return (
            <button
                onClick={(e) => { e.stopPropagation(); doAction(cid, action) }}
                disabled={loading}
                className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/20 disabled:opacity-40"
            >
                {loading ? <Spinner size="sm" className="h-3 w-3" /> : label}
            </button>
        )
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('widgets:dockerDetails')}
            closeText={t('common:close')}
            maxWidthClass="max-w-2xl"
            containerClassName="items-start pt-[10vh] sm:pt-[14vh]"
        >
            <div className="scrollbar-thin max-h-[50vh] space-y-2 overflow-y-auto">
                {sorted.map((c) => (
                    <div key={c.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotColor(c.status)}`} />
                            <span className="font-medium text-sm text-white/90 truncate flex-1">{c.name}</span>
                            <span className="text-[11px] text-white/40 shrink-0">{statusLabel(c.status)}</span>
                            {isAdmin ? (
                                <div className="flex gap-1 shrink-0">
                                    {c.status === 'running' ? (
                                        <>
                                            <ActionBtn cid={c.id} action="stop" label={t('widgets:dockerStop')} />
                                            <ActionBtn cid={c.id} action="restart" label={t('widgets:dockerRestart')} />
                                        </>
                                    ) : (
                                        <ActionBtn cid={c.id} action="start" label={t('widgets:dockerStart')} />
                                    )}
                                </div>
                            ) : null}
                        </div>
                        <div className="text-[11px] text-white/40 mb-2 truncate">{c.image}</div>
                        {c.status === 'running' ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-white/70">
                                <div>
                                    <div className="text-white/40">CPU</div>
                                    <div className="tabular-nums">{c.cpuPercent.toFixed(1)}%</div>
                                </div>
                                <div>
                                    <div className="text-white/40">{t('widgets:dockerMemUsage')}</div>
                                    <div className="tabular-nums">{formatGiB(c.memUsed)} / {formatGiB(c.memLimit)}</div>
                                </div>
                                <div>
                                    <div className="text-white/40">Net Rx</div>
                                    <div className="tabular-nums">{formatBytes(c.netRx)}</div>
                                </div>
                                <div>
                                    <div className="text-white/40">Net Tx</div>
                                    <div className="tabular-nums">{formatBytes(c.netTx)}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-white/40">{c.state}</div>
                        )}
                    </div>
                ))}
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="grid grid-cols-3 gap-4 text-xs text-white/70">
                    <div>
                        <div className="text-white/40">{t('widgets:dockerContainers')}</div>
                        <div className="tabular-nums">{data.containers.length}</div>
                    </div>
                    <div>
                        <div className="text-white/40">CPU</div>
                        <div className="tabular-nums">{data.totalCpu.toFixed(1)}%</div>
                    </div>
                    <div>
                        <div className="text-white/40">{t('widgets:dockerMemUsage')}</div>
                        <div className="tabular-nums">{formatGiB(data.totalMemUsed)} / {formatGiB(data.totalMemLimit)}</div>
                    </div>
                </div>
            </div>
        </Modal>
    )
}
