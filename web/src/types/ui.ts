/**
 * UI 相关类型定义
 */

/**
 * Widget 类型
 */
export type WidgetKind = 'weather' | 'metrics' | 'timezones' | 'markets' | 'holidays'

/**
 * 设置对话框标签页
 */
export type SettingsTab = 'general' | 'time' | 'background' | 'account'

/**
 * 图标模式
 */
export type IconMode = 'auto' | 'url'

/**
 * 时钟配置
 */
export interface ClockConfig {
    city: string
    timezone: string
}

/**
 * Metrics 配置
 */
export interface MetricsConfig {
    showCpu: boolean
    showMem: boolean
    showDisk: boolean
    showNet: boolean
    refreshSec: 1 | 5 | 10
}

/**
 * Weather 配置
 */
export interface WeatherConfig {
    city: string
}

/**
 * Markets 配置
 */
export interface MarketsConfig {
    symbols: string[]
}

/**
 * Holidays 配置
 */
export interface HolidaysConfig {
    countries: string[]
}

/**
 * Timezones 配置
 */
export interface TimezonesConfig {
    clocks: ClockConfig[]
}

/**
 * 拖拽状态
 */
export interface DragState {
    draggingId: string | null
    dropTargetId: string | null
}

/**
 * 网络速率
 */
export interface NetRate {
    upBps: number
    downBps: number
}

/**
 * 位置坐标
 */
export interface Position {
    x: number
    y: number
}
