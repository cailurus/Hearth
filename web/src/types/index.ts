/**
 * 类型定义统一导出
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
    Language,
    GroupKind,
    BackgroundProvider,
    MarketKind,
} from './models'

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
} from './api'

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
} from './ui'
