/**
 * 类型定义统一导出
 * 
 * 为保持向后兼容，此文件重新导出 types/ 目录中的所有类型
 */

// 业务模型
export type {
    Settings,
    BackgroundSettings,
    TimeSettings,
    WeatherSettings,
    Group,
    AppItem,
    BackgroundInfo,
    Weather,
    WeatherDaily,
    HostMetrics,
    MarketQuote,
    MarketsResponse,
    HolidayItem,
    HolidaysResponse,
    HolidayCountry,
    DockerContainer,
    DockerResponse,
    MetricsHistoryPoint,
    MetricsHistoryResponse,
    Language,
    GroupKind,
    BackgroundProvider,
    MarketKind,
} from './types/models'

// API 类型
export type {
    Me,
    ApiError,
    IconResolve,
    GeocodeResult,
    GeocodeResponse,
    TimezoneResolve,
    MarketSymbolResult,
    MarketSymbolSearchResponse,
    LoginRequest,
    ChangePasswordRequest,
    CreateGroupRequest,
    UpdateGroupRequest,
    ReorderRequest,
    ReorderAppsRequest,
    CreateAppRequest,
    UpdateAppRequest,
    IconResolveRequest,
} from './types/api'

// UI 类型
export type {
    WidgetKind,
    SettingsTab,
    IconMode,
    ClockConfig,
    MetricsConfig,
    WeatherConfig,
    MarketsConfig,
    HolidaysConfig,
    TimezonesConfig,
    DragState,
    NetRate,
    Position,
} from './types/ui'
