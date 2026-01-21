import { useMemo } from 'react'
import { Cpu, HardDrive, MemoryStick, Upload, Download } from 'lucide-react'
import type { HostMetrics } from '../../types'
import { formatBytes, formatPercent } from '../../utils'

/**
 * 智能缩减 CPU 型号名称
 * 方案1: 精简版 - 保留核心信息 (Intel Core i7-12700K 或 AMD Ryzen 9 5950X)
 * 方案2: 超短版 - 仅显示关键型号 (i7-12700K 或 R9 5950X)
 */
function formatCpuModel(model: string | undefined, compact: boolean = false): string {
    if (!model) return ''
    const raw = model.trim()
    if (!raw) return ''

    // 移除常见的无用后缀
    let cleaned = raw
        .replace(/\s+/g, ' ')
        .replace(/\(TM\)/gi, '')
        .replace(/\(R\)/gi, '')
        .replace(/@\s*[\d.]+\s*GHz/gi, '')
        .replace(/CPU/gi, '')
        .replace(/Processor/gi, '')
        .replace(/with.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()

    // 检测 Intel 处理器
    const intelMatch = cleaned.match(/Intel\s*(Core)?\s*(i[3579]|Xeon|Celeron|Pentium)[^\s]*\s*([\w-]+)?/i)
    if (intelMatch) {
        const series = intelMatch[2] || ''
        const modelNum = intelMatch[3] || ''
        if (compact) {
            // 超短版: i7-12700K
            return `${series}${modelNum ? '-' + modelNum : ''}`.replace(/^-/, '')
        }
        // 精简版: Intel Core i7-12700K
        return `Intel${intelMatch[1] ? ' Core' : ''} ${series}${modelNum ? '-' + modelNum : ''}`.replace(/-$/, '').trim()
    }

    // 检测 AMD 处理器
    const amdMatch = cleaned.match(/AMD\s*(Ryzen)?\s*([3579])?\s*(\d{4}[A-Z]?[^\s]*)?/i)
    if (amdMatch) {
        const isRyzen = !!amdMatch[1]
        const tier = amdMatch[2] || ''
        const modelNum = amdMatch[3] || ''
        if (compact) {
            // 超短版: R9 5950X
            return isRyzen ? `R${tier} ${modelNum}`.trim() : `AMD ${modelNum}`.trim()
        }
        // 精简版: AMD Ryzen 9 5950X
        return isRyzen
            ? `AMD Ryzen ${tier} ${modelNum}`.replace(/\s+/g, ' ').trim()
            : `AMD ${modelNum}`.trim()
    }

    // Apple Silicon
    const appleMatch = cleaned.match(/(Apple\s*)?(M[1234])(\s*(Pro|Max|Ultra))?/i)
    if (appleMatch) {
        const chip = appleMatch[2]
        const variant = appleMatch[4] || ''
        if (compact) {
            return `${chip}${variant ? ' ' + variant : ''}`
        }
        return `Apple ${chip}${variant ? ' ' + variant : ''}`
    }

    // 无法识别的型号，返回截断版本
    if (cleaned.length > 30) {
        return cleaned.slice(0, 27) + '...'
    }
    return cleaned || raw.slice(0, 30)
}

interface MetricsConfig {
    showCpu: boolean
    showMem: boolean
    showDisk: boolean
    showNet: boolean
}

interface MetricsWidgetProps {
    data: HostMetrics | null
    netRate: { upBps: number; downBps: number } | null
    config: MetricsConfig
    lang: 'zh' | 'en'
}

/**
 * 系统状态组件
 */
export function MetricsWidget({ data, netRate, config, lang }: MetricsWidgetProps) {
    const t = (zh: string, en: string) => (lang === 'en' ? en : zh)

    const items = useMemo(() => {
        if (!data) return []

        const result: Array<{
            key: string
            icon: React.ReactNode
            label: string
            value: string
            percent?: number
        }> = []

        if (config.showCpu) {
            result.push({
                key: 'cpu',
                icon: <Cpu className="w-4 h-4" />,
                label: 'CPU',
                value: formatPercent(data.cpuPercent),
                percent: data.cpuPercent,
            })
        }

        if (config.showMem) {
            result.push({
                key: 'mem',
                icon: <MemoryStick className="w-4 h-4" />,
                label: t('内存', 'Memory'),
                value: `${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`,
                percent: data.memPercent,
            })
        }

        if (config.showDisk) {
            result.push({
                key: 'disk',
                icon: <HardDrive className="w-4 h-4" />,
                label: t('磁盘', 'Disk'),
                value: `${formatBytes(data.diskUsed)} / ${formatBytes(data.diskTotal)}`,
                percent: data.diskPercent,
            })
        }

        if (config.showNet && netRate) {
            result.push({
                key: 'net-up',
                icon: <Upload className="w-4 h-4" />,
                label: t('上传', 'Upload'),
                value: `${formatBytes(netRate.upBps)}/s`,
            })
            result.push({
                key: 'net-down',
                icon: <Download className="w-4 h-4" />,
                label: t('下载', 'Download'),
                value: `${formatBytes(netRate.downBps)}/s`,
            })
        }

        return result
    }, [data, netRate, config, t])

    if (!data) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {t('加载中...', 'Loading...')}
            </div>
        )
    }

    // 根据容器宽度决定使用精简版还是超短版
    const cpuModelDisplay = useMemo(() => {
        if (!data?.cpuModel) return null
        return {
            full: formatCpuModel(data.cpuModel, false),
            compact: formatCpuModel(data.cpuModel, true),
        }
    }, [data?.cpuModel])

    return (
        <div className="flex flex-col gap-3 p-4 h-full">
            <div
                className="text-xs text-gray-500 dark:text-gray-400 truncate"
                title={data.cpuModel || ''}
            >
                {cpuModelDisplay ? (
                    <>
                        <span className="hidden sm:inline">{cpuModelDisplay.full}</span>
                        <span className="inline sm:hidden">{cpuModelDisplay.compact}</span>
                    </>
                ) : (
                    t('系统状态', 'System Status')
                )}
            </div>

            <div className="flex-1 flex flex-col justify-center gap-2">
                {items.map((item) => (
                    <div key={item.key} className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">{item.icon}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-12 shrink-0">
                            {item.label}
                        </span>
                        {item.percent !== undefined ? (
                            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${getPercentColor(item.percent)}`}
                                    style={{ width: `${Math.min(100, item.percent)}%` }}
                                />
                            </div>
                        ) : null}
                        <span className="text-xs text-gray-700 dark:text-gray-300 min-w-[80px] text-right">
                            {item.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function getPercentColor(percent: number): string {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 70) return 'bg-yellow-500'
    return 'bg-green-500'
}

export default MetricsWidget
