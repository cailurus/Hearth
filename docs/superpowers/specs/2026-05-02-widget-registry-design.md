# Widget Registry — 设计稿

**日期**: 2026-05-02
**作者**: Claude (with cailurus)
**关联 Round 2 todo 项**: C2
**前置依赖**: 无(C1 已完成,WidgetDataContext 已建立)
**下游依赖**: F3(深度 widget 集成,Jellyfin/Plex/Sonarr 等),F4(第三方 widget 插件协议)

## 背景

Hearth 前端目前有 10 种 widget kind(weather / metrics / timezones / markets / holidays / docker / notes / rss / currency / deals)。其中 8 种走网络拉取(weather / markets / holidays / metrics / docker / currency / deals / rss),累积形成 8 段几乎一样的 fetch 模板;timezones / notes 是无 fetch 的本地展示。它们以"复制粘贴扩展"的方式累积起来:

- `web/src/utils/constants.ts`:`WIDGET_KINDS` 字面量 union + `WIDGET_LABEL_KEYS` 手抄 i18n key 映射
- `web/src/hooks/useWidgets.ts`:**8 段几乎一样的 fetch 模板**(filter→useState→useEffect→Promise.all→setState),共 ~536 行,绝大部分是结构性重复
- `web/src/contexts/WidgetDataContext.tsx`:暴露 21 个独立字段(weatherById / weatherErrById / marketsById / marketsErrById / ...),每加一个 widget 就多 2-4 个字段
- `web/src/components/layout/GroupBlock.tsx:328-395`:widget 渲染 if-else 长链,~70 行
- `web/src/hooks/useWidgetEditor.ts:19`:`WidgetKind` union 又重复一遍

加一个新 widget 需要在 **3-4 个文件、7 处地方**协同改动,且任何一处遗漏不会被 TypeScript 检出(因为这些位置之间没有类型关联)。这是 **F3(5-8 个深度 widget)做不动的根本原因**,也是 **F4(第三方 widget 插件协议)的前置依赖**。

C2 解决这两个问题:把 widget 抽象成一份注册声明,让"加 widget"压缩到"新建一个文件 + registry 加 1 行 import"。

## 目标

- **加 widget 的修改面**:从"3-4 个文件、7 处"压到"新建 1 个文件 + registry.ts 加 2 行(import + tuple entry)"
- **代码减重**:`useWidgets.ts` 536 → < 300 行,`GroupBlock.tsx` 531 → < 400 行,`WidgetDataContext` 21 字段 → 4 字段
- **零迁移**:现有用户的 `AppItem.description` JSON 配置完全兼容,后端不动
- **类型安全**:`defineWidget<TConfig, TData>` 泛型让每个 widget 的 cfg/data 类型精确,registry 内部 `unknown` 限于工厂函数一处 cast
- **F4 路径预留**:registry 形状为未来"运行期 `registerWidget()` 注入第三方 widget"留口

## 不做(YAGNI)

- **不动 EditDialog / useWidgetEditor**(~250 行 per-widget 配置编辑 state)— 是独立的 surface,跟 registry 抽象正交;捆在一起做 PR 太大,留作下一刀
- **不引入 zod / valibot 或任何 schema 库** — 配置 schema 用纯 TypeScript 类型,运行期校验靠 widget 内部 defensive coding(现状语义)
- **不动 `AppItem.description` JSON 序列化格式** — 配置健壮性是独立命题,与 C2 的扩展性目标正交
- **不动后端** — 纯前端重构,所有 `/api/widgets/*` 路由不变
- **不动 BookmarkGroup** — 经核实它不参与 widget dispatch
- **不引入测试框架(vitest / jest)** — 单引入成本远超 C2 收益;依赖 TypeScript + 一份手动 smoke 清单
- **不优化 byId Map 整体变化触发的 Context 重渲染** — 先按形状落地,实测有问题再用 use-context-selector 等手段
- **不把 metrics widget 抽组件 + 进 registry** — metrics 在 GroupBlock 是 inline JSX 且共享轮询语义特殊,留例外路径
- **不把 defaultWeather 进 registry** — 它是"无 widget 实例时也要拉的默认值",独立模式,留例外路径
- **不实现 F4 的 `registerWidget()` 运行期注入** — 仅在 spec 描述其形状,内置 widget 走 `as const` tuple 静态 import

## 架构概览

```
                ┌─────────────────────────────┐
                │   widgets/registry.ts       │
                │                             │
                │   const WIDGET_REGISTRY = [ │
                │     weatherWidget,          │  ← as const tuple
                │     marketsWidget,          │     (类型推 'weather'|'markets'|...)
                │     ...                     │
                │   ] as const                │
                └────────────┬────────────────┘
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
   ┌────────────────────────┐   ┌──────────────────────┐
   │ useWidgets             │   │ GroupBlock           │
   │                        │   │                      │
   │ 通用 fetch 循环:       │   │ if widget==='metrics'│  ← 例外:inline 渲染
   │  for w of REGISTRY:    │   │   <inline metrics>   │
   │    fetch + 轮询 +      │   │ else                 │
   │    填 byId Map         │   │   <W.Component       │  ← 通用 dispatch
   │                        │   │     data error cfg/> │
   │ + 2 个例外:            │   └──────────────────────┘
   │  defaultWeather        │             ▲
   │  metricsShared         │             │
   └──────────┬─────────────┘   读 byId Map 的切片
              │                           │
              ▼                           │
   ┌──────────────────────────┐           │
   │ WidgetDataContext        │───────────┘
   │  byId: Map<id,           │
   │    {kind, data, error,   │
   │     refresh}>            │
   │  metrics, netRate        │
   │  defaultWeather          │
   └──────────────────────────┘
```

### 边界划分

**进 registry**:weather / markets / holidays / docker / currency / deals / rss / notes / timezones — 共 9 个

**不进 registry,留 `useWidgets` 顶层**:
- **defaultWeather**:用户没加 weather widget 但配了 `defaultCity` 时仍要拉的默认天气(现有行为保留)
- **metricsShared**:跨实例最小 interval 共享轮询 + cpu%/网络速率 derive 计算 — metrics widget 在 GroupBlock 也是 inline JSX,不是独立组件

**不进 C2 范围**:`useWidgetEditor` 配置编辑 state、`AppItem.description` 序列化、`AddItemDialog` 的 widget 选择列表(它继续从 `WIDGET_KINDS` 读)

## 文件改动清单

```
新增:
  web/src/widgets/registry.ts      # 唯一新增的"registry 层"文件
  web/src/widgets/types.ts         # WidgetSpec / defineWidget 类型与工厂

修改(每个文件加一行 export 该 widget 的 defineWidget 结果):
  web/src/components/widgets/WeatherWidget.tsx
  web/src/components/widgets/MarketsWidget.tsx
  web/src/components/widgets/HolidaysWidget.tsx
  web/src/components/widgets/DockerWidget.tsx
  web/src/components/widgets/CurrencyWidget.tsx
  web/src/components/widgets/DealsWidget.tsx
  web/src/components/widgets/RSSWidget.tsx
  web/src/components/widgets/NotesWidget.tsx
  web/src/components/widgets/TimezonesWidget.tsx

修改(核心改造):
  web/src/hooks/useWidgets.ts             # 8 段重复 fetch 模板 → 1 段通用循环 + 2 个例外
  web/src/contexts/WidgetDataContext.tsx  # 21 字段 → 4 字段(byId Map / defaultWeather / metrics / netRate)
  web/src/components/layout/GroupBlock.tsx # widget 渲染 if-else 链 → registry dispatch + metrics 特例
  web/src/utils/constants.ts              # WIDGET_KINDS / WIDGET_LABEL_KEYS 改为从 registry 推导

修改(基础设施小改):
  web/src/api/index.ts (或 fetch 调用入口)  # apiGet 加 { signal?: AbortSignal } 选项透传

不动:
  web/src/hooks/useWidgetEditor.ts
  web/src/components/dialogs/AddItemDialog.tsx, EditItemDialog.tsx
  web/src/components/layout/BookmarkGroup.tsx
  AppItem.description JSON 格式
  内部 widget 数据类型(Weather / MarketsResponse / ...)
  整个后端
```

## API 设计

### `WidgetSpec` 类型

```ts
// widgets/types.ts

export interface WidgetSpec<TConfig = unknown, TData = unknown> {
  /** 类型字面量,跟 widget URL `widget:<kind>` 对应 */
  readonly kind: string

  /** i18n 标签 key,替代现有 WIDGET_LABEL_KEYS 表 */
  readonly labelKey: string

  /** 默认配置 — 用户没存 cfg 或 cfg 缺字段时兜底 */
  readonly defaultConfig: TConfig

  /**
   * 一次性数据拉取。
   *  - signal: AbortController 取消信号(替代 closure cancelled boolean 模式)
   *  - 返回 TData 或 throw(throw 进 slice.error)
   *  - undefined 表示无 fetch 需求(timezones / notes 等)
   */
  readonly fetchData?: (cfg: TConfig, signal: AbortSignal) => Promise<TData>

  /**
   * 轮询间隔(ms):
   *  - 数字: 固定间隔
   *  - 函数: 从 cfg 读出来(docker 用 cfg.refreshSec, markets 固定 5min)
   *  - undefined: 一次性 fetch 不轮询
   *
   * 仅当 fetchData 存在时有意义。
   */
  readonly pollIntervalMs?: number | ((cfg: TConfig) => number)

  /**
   * 渲染组件。registry 内部 byId Map 存 `unknown`,但 defineWidget 泛型把
   * cast 推到注册声明处,Component 接收的 props 类型精确。
   *
   * 5 个标准 props:
   *  - data / error / cfg: 来自 byId slice + 配置
   *  - refresh: 该 widget 实例的手动刷新(RSS 等需要)
   *  - isAdmin: 当前用户是否管理员(Notes/Docker 等需要,用于显示编辑/操作按钮)
   *
   * 其他 ambient state(lang / localTimezone / 等)widget 内部用 hook 或
   * 浏览器 API 拿(useTranslation / Intl.DateTimeFormat),不进标准 props。
   */
  readonly Component: React.ComponentType<{
    data: TData | null
    error: string | null
    cfg: TConfig
    refresh: () => void
    isAdmin: boolean
  }>
}
```

### `defineWidget` 工厂

```ts
/**
 * 工厂函数 — 仅做类型推导收口。
 * 运行期等价于 identity,Vite tree-shaking 不会留无用代码。
 */
export function defineWidget<TConfig, TData>(spec: WidgetSpec<TConfig, TData>): WidgetSpec {
  // 收口处的唯一 cast:精确类型 → unknown 类型,供 registry 通用循环消费
  return spec as unknown as WidgetSpec
}
```

### 单个 widget 文件示例(weather)

```ts
// components/widgets/WeatherWidget.tsx

import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import type { Weather } from '../../types'

interface WeatherConfig { city: string }

function WeatherWidgetView({ data, error, cfg }: {
  data: Weather | null
  error: string | null
  cfg: WeatherConfig
  refresh: () => void
  isAdmin: boolean
}) {
  // 现有 WeatherWidget 实现,props 收敛到 5 个标准字段
  // (lang 通过 useTranslation 从内部读;cityName 改用 cfg.city)
}

export const weatherWidget = defineWidget<WeatherConfig, Weather>({
  kind: 'weather',
  labelKey: 'widgets:weather',
  defaultConfig: { city: '' },
  fetchData: async (cfg, signal) => {
    if (!cfg.city) throw new Error('city not configured')
    const qs = new URLSearchParams({ city: cfg.city })
    return apiGet<Weather>(`/api/widgets/weather?${qs.toString()}`, { signal })
  },
  // weather 不轮询,挂载/cfg 变化时拉一次
  Component: WeatherWidgetView,
})
```

### `registry.ts` 形状

```ts
// widgets/registry.ts

import { weatherWidget } from '../components/widgets/WeatherWidget'
import { marketsWidget } from '../components/widgets/MarketsWidget'
import { holidaysWidget } from '../components/widgets/HolidaysWidget'
import { dockerWidget } from '../components/widgets/DockerWidget'
import { currencyWidget } from '../components/widgets/CurrencyWidget'
import { dealsWidget } from '../components/widgets/DealsWidget'
import { rssWidget } from '../components/widgets/RSSWidget'
import { notesWidget } from '../components/widgets/NotesWidget'
import { timezonesWidget } from '../components/widgets/TimezonesWidget'

export const WIDGET_REGISTRY = [
  weatherWidget,
  marketsWidget,
  holidaysWidget,
  dockerWidget,
  currencyWidget,
  dealsWidget,
  rssWidget,
  notesWidget,
  timezonesWidget,
] as const

// 类型从 tuple 推导(精确字面量 union)
export type WidgetKind = typeof WIDGET_REGISTRY[number]['kind']

const REGISTRY_MAP = new Map<string, WidgetSpec>(
  WIDGET_REGISTRY.map(w => [w.kind, w as WidgetSpec])
)

export function getWidget(kind: string): WidgetSpec | undefined {
  return REGISTRY_MAP.get(kind)
}
```

注:`metrics` 不在 `WIDGET_REGISTRY` 里,但 `WIDGET_KINDS` 字面量 union 里仍包含它(constants.ts 处理),GroupBlock 走例外分支。

## 数据流

### `useWidgets` 通用循环骨架

```ts
export function useWidgets({ apps, lang, defaultCity }: UseWidgetsOptions): UseWidgetsResult {
  const [byId, setById] = useState<Map<string, WidgetSlice>>(new Map())

  useEffect(() => {
    const controllers = new Map<string, AbortController>()
    const timers = new Map<string, number>()
    const refreshTriggers = new Map<string, () => void>()

    // 找到当前 apps 里所有 registry widget 实例
    const instances: Array<{ id: string; kind: string; spec: WidgetSpec; cfg: unknown }> = []
    for (const a of apps) {
      const kind = widgetKindFromUrl(a.url)
      if (!kind) continue
      const spec = getWidget(kind)
      if (!spec) continue   // metrics 等例外不在 registry,跳过
      const cfg = { ...spec.defaultConfig, ...(safeParseJSON(a.description) ?? {}) }
      instances.push({ id: a.id, kind, spec, cfg })
    }

    for (const inst of instances) {
      const fetchOnce = async () => {
        if (!inst.spec.fetchData) return  // timezones / notes 无 fetch
        controllers.get(inst.id)?.abort()
        const ctrl = new AbortController()
        controllers.set(inst.id, ctrl)
        try {
          const data = await inst.spec.fetchData(inst.cfg, ctrl.signal)
          setById(prev => new Map(prev).set(inst.id, {
            kind: inst.kind,
            data,
            error: null,
            refresh: refreshTriggers.get(inst.id)!,
          }))
        } catch (e) {
          if (ctrl.signal.aborted) return  // 主动取消不算错
          setById(prev => new Map(prev).set(inst.id, {
            kind: inst.kind,
            data: null,
            error: e instanceof Error ? e.message : 'failed',
            refresh: refreshTriggers.get(inst.id)!,
          }))
        }
      }
      refreshTriggers.set(inst.id, fetchOnce)

      // 占位 slice(无 fetchData 的 widget 也要在 byId 出现)
      setById(prev => new Map(prev).set(inst.id, {
        kind: inst.kind,
        data: null,
        error: null,
        refresh: fetchOnce,
      }))

      void fetchOnce()

      const intervalRaw = inst.spec.pollIntervalMs
      const intervalMs = typeof intervalRaw === 'function'
        ? intervalRaw(inst.cfg)
        : intervalRaw
      if (typeof intervalMs === 'number' && intervalMs > 0) {
        const t = window.setInterval(fetchOnce, intervalMs)
        timers.set(inst.id, t)
      }
    }

    return () => {
      controllers.forEach(c => c.abort())
      timers.forEach(t => window.clearInterval(t))
    }
  }, [apps])

  // 例外 1:defaultWeather (现有逻辑保留)
  // 例外 2:metricsShared (现有共享轮询保留)

  return { byId, defaultWeather, metrics, netRate }
}
```

### Context 与 Slice

```ts
interface WidgetSlice {
  kind: string
  data: unknown
  error: string | null
  refresh: () => void
}

interface WidgetDataValue {
  byId: Map<string, WidgetSlice>
  defaultWeather: { data: Weather | null; error: string | null }
  metrics: HostMetrics | null
  netRate: { upBps: number; downBps: number } | null
}

// 辅助 hook(给 widget Component 用)
export function useWidgetSlice(widgetId: string): WidgetSlice | undefined {
  const { byId } = useWidgetData()
  return byId.get(widgetId)
}
```

### `GroupBlock` dispatch

```tsx
// 旧 if-else 链(70 行)→ 新 dispatch(~25 行)

if (widget === 'metrics') {
  // 例外:inline 渲染保留(cfg.showCpu/showMem/showDisk/showNet 等控制)
  return <MetricsInline cfg={cfg} metrics={metrics} netRate={netRate} t={t} />
}

const spec = getWidget(widget)
if (!spec) return null

const slice = byId.get(a.id)
return (
  <WidgetBoundary fallbackLabel={t('common:widgetError')} retryLabel={t('common:retry')}>
    <spec.Component
      data={slice?.data ?? null}
      error={slice?.error ?? null}
      cfg={cfg}
      refresh={slice?.refresh ?? noop}
      isAdmin={isAdmin}
    />
  </WidgetBoundary>
)
```

## 错误处理 / 边界情况

### WidgetBoundary 位置不变
- `fetchData` 网络/HTTP 错误 → `slice.error`,Component 自渲染错误态,**不触发 boundary**
- Component 渲染时抛 React 错误(组件内部 bug)→ 触发 WidgetBoundary,显示 fallback + retry
- Boundary 不感知 registry,沿用现有 per-widget 隔离语义

### 配置兜底
```ts
const cfg = { ...spec.defaultConfig, ...(safeParseJSON(a.description) ?? {}) }
```
- JSON 损坏 → fallback 全部 defaultConfig
- 旧版本配置缺新字段 → defaultConfig 字段填进来
- 旧版本配置有冗余字段 → 透传给 fetchData,fetchData 自己忽略

### AbortError 静默
```ts
catch (e) {
  if (ctrl.signal.aborted) return  // 不写 slice.error
  setSlice(id, { ..., error: e instanceof Error ? e.message : 'failed' })
}
```
- apps 变化或卸载触发 abort 是预期行为
- 真错误(网络挂、HTTP 4xx/5xx、cfg 校验失败)写进 `slice.error`

### 向后兼容(零迁移硬约束)

| 项 | 旧 | 新 | 兼容 |
|---|---|---|---|
| `AppItem.description` JSON | `{"city":"Shanghai"}` 等 | 不变 | ✅ |
| `widget://kind` URL | `widget:weather?city=...` | 不变 | ✅ |
| `widgetKindFromUrl` | 返回字面量 union 或 null | 行为不变,内部用 registry 推导的 `WIDGET_KINDS` | ✅ |
| `WIDGET_KINDS` / `WIDGET_LABEL_KEYS` | constants.ts 手抄 | 从 registry 推导,named export 不变 | ✅ |
| 后端 `/api/widgets/*` | 不变 | 不变 | ✅ |

### 性能影响

| 维度 | 旧 | 新 | 评估 |
|---|---|---|---|
| useEffect 数量 | 8 个独立 | 1 通用 + 2 例外 | 更少 |
| Map 写操作 | 每 widget setObj({...}) | `new Map(prev).set(...)` | 8-15 实例量级 O(n) clone < 1ms,可忽略 |
| Context value 引用稳定性 | 21 字段独立 useState,变化只波及 4 个 | byId Map 任一 slice 变化触发 Context 全消费方重渲染 | **退化点**(下文处理) |
| GroupBlock 重渲染 | 21 props 任一变化触发 | byId Map 变化触发(配 React.memo + memo() 子组件减小波及面) | 持平或略好 |

**Context 重渲染退化点的处理**:
- `useWidgetSlice(widgetId)` 内部 `useContext` 拿 byId,返回 `byId.get(widgetId)`
- React Context 消费方在 value 变化时全部重渲染(无论 selector),因此 `useWidgetSlice` 不能完全避免
- GroupBlock 已是 `memo()`,WidgetBoundary 子树也 `memo()` 可止血
- **实测有问题再优化**(use-context-selector 或拆 Context),不在 C2 范围内

### 类型边界

`spec.Component` 在 registry 内部存为 `React.ComponentType<{ data: unknown; ... }>`,但 `defineWidget<TConfig, TData>` 接收的是精确类型版本,**唯一的危险 cast 集中在 defineWidget 工厂一处**:

```ts
return spec as unknown as WidgetSpec
```

使用方(每个 widget 文件、Component 内部、useWidgets 通用循环)完全类型安全。

## 迁移计划

**总策略**:渐进迁移(LEGACY 路径与 registry 路径并存,逐个 widget 切过去,最后一笔删 LEGACY)

### 阶段 1:基础设施 + 首刀(currency + deals)

**单次 commit / 单个 PR**:
1. 新建 `web/src/widgets/types.ts`(WidgetSpec + defineWidget 工厂)
2. 新建 `web/src/widgets/registry.ts`(初始 tuple 含 currency + deals)+ `getWidget()` + `WIDGET_KINDS` 类型推导
3. 改 `web/src/api/index.ts`:`apiGet` 加 `{ signal?: AbortSignal }` 选项透传给 fetch(~10 行)
4. 改 `useWidgets.ts`:加新的通用 useEffect(只处理 registry 命中的实例),旧的 currency/deals useEffect 加 early return(`if getWidget(kind) skip`),`UseWidgetsResult` 加 `byId` 字段(向上加,不删旧字段)
5. 改 `WidgetDataContext.tsx`:value 加 `byId` 字段,加 `useWidgetSlice(widgetId)` 辅助 hook
6. 改 `CurrencyWidget.tsx` / `DealsWidget.tsx`:props 收敛到 4 个标准字段 + export `currencyWidget` / `dealsWidget` 的 `defineWidget` 结果
7. 改 `GroupBlock.tsx`:加 `if (getWidget(widget)) return <spec.Component .../>` 优先于 if-else 链
8. 改 `constants.ts`:`WIDGET_KINDS` / `WIDGET_LABEL_KEYS` 改为 `[...REGISTRY 推导, ...LEGACY_KINDS]` 合并形态

**评估检查点**:
- 实际 diff 大小:预期 ~+450 / -100,**> +700 时回 brainstorming 调整**
- 真跑前端验证 currency / deals widget 仍正常显示
- 编辑现有 currency / deals widget 配置后仍能保存(EditDialog 走旧路径,`description` JSON 应能被新 fetchData 读)
- 浏览器 console 无未捕获错误

### 阶段 2:剩余 7 个 widget 逐个迁移

**7 个独立 commit**(每 commit 一个 widget):

| 顺序 | widget | 难度 | 备注 |
|---|---|---|---|
| 1 | holidays | 简单 | 形状跟 currency/deals 一致 |
| 2 | markets | 中 | 5 分钟轮询 + symbols 参数组装 |
| 3 | docker | 中 | `pollIntervalMs: cfg => cfg.refreshSec * 1000` |
| 4 | weather | 中 | per-instance fetch 走 registry,defaultWeather 留顶层 |
| 5 | rss | 中 | 现有 `refreshRss + rssRefreshSeq` 改用通用 `slice.refresh()` |
| 6 | notes | 简单 | 无 fetchData |
| 7 | timezones | 简单 | 无 fetchData,`cfg.clocks` 直接渲染 |

每个 commit 工作量:
- 改对应 widget 文件(props 收敛 + 加 defineWidget export)
- 改 `useWidgets.ts` 删对应旧 useEffect
- 改 `WidgetDataContext` 删对应字段
- 改 `constants.ts` 从 LEGACY 列表删该项
- 改 `GroupBlock.tsx` 从 if-else 链删该分支

预计每 commit ~+50 / -100 净减少。

**执行方式**:阶段 1 评估稳定后,阶段 2 倾向手动一个一个做(保形状一致性),subagent 备选(独立任务可并行)。具体方式阶段 1 完后再定。

### 阶段 3:删 LEGACY 路径

**独立 commit,git revert 单点可逆**:
- `useWidgets.ts` 删 21 个 useState + 旧 fetch 模板,只保留 byId / defaultWeather / metrics / netRate
- `WidgetDataContext` 字段塌缩到 4 个
- `constants.ts` 删 LEGACY_KINDS / LEGACY_LABEL_KEYS,完全从 registry 推导
- `GroupBlock.tsx` 删 if-else 链,只剩 metrics inline + registry dispatch
- 所有 widget 文件最终形态稳定

预计净减:`useWidgets.ts` 536 → ~250 行,`GroupBlock.tsx` 531 → ~360 行,Context 字段 21 → 4。

## 测试策略

### TypeScript 是主要安全网
- `tsc -b` 在 `npm run build` 链路,任何 widget 的 cfg/data 类型不一致编译失败
- `defineWidget<TConfig, TData>` 泛型让每个 widget 类型自洽

### registry 一致性脚本(类比现有 `check-i18n-parity.mjs`)

```
新文件:
  web/scripts/check-widget-registry.mjs

作用:
  - tsx 模式 import WIDGET_REGISTRY
  - 校验每个 spec:kind 唯一、labelKey 在 i18n JSON 里能解出来、
    fetchData 存在时 pollIntervalMs 类型合法
  - 失败时退出码 1,可挂 npm script
```

`package.json` 加 `"check:widgets": "node --import tsx scripts/check-widget-registry.mjs"`。

### 手动 smoke 清单(每阶段验证)

写到 `tasks/c2-smoke-checklist.md`(临时,不进 git):

```
[ ] 每个迁移过的 widget 显示数据
[ ] 编辑配置 + 保存 + 刷新 → 配置生效
[ ] 故意写错 cfg(如 weather city 改成无效值)→ 显示错误,WidgetBoundary 不该被触发
[ ] 浏览器 console 无未捕获错误
[ ] 切换语言后 widget 重新渲染(weather/holidays 等依赖 lang)
[ ] metrics 仍正常(走例外路径)
[ ] defaultWeather 仍在没加 weather widget 时显示
```

每阶段过完跑一遍。这是"我确实跑过了"的自证清单,不是回归测试。

### 不做
- 不引入 vitest / jest
- 不写 mock fetch 测试
- 不做 visual regression

## 成功标准

| 指标 | 目标 | 测量 |
|---|---|---|
| 加新 widget 修改面 | 1 个新文件 + registry.ts 加 2 行 | spec 末尾"加 Sonarr widget"对比示例 |
| `useWidgets.ts` 行数 | < 300(从 536) | `wc -l` |
| `GroupBlock.tsx` 行数 | < 400(从 531) | `wc -l` |
| `WidgetDataContext` 字段数 | 4 | 看类型定义 |
| 现有用户配置 | 0 迁移,所有 widget 沿用旧 cfg | 真实数据验证 |
| TypeScript 类型安全 | `defineWidget<C, D>` 泛型让每 widget 类型精确 | `tsc` 通过 |
| F4 路径预留 | spec 描述 `registerWidget()` 形状,即使不实现 | 本文档 |

## "加 Sonarr widget"对比示例

**改造前(C2 之前)**:

```diff
# 改 7 处:
+ web/src/utils/constants.ts:23     WIDGET_KINDS 加 'sonarr'
+ web/src/utils/constants.ts:28     WIDGET_LABEL_KEYS 加 sonarr key
+ web/src/types/                    新增 SonarrResponse 类型
+ web/src/hooks/useWidgets.ts       复制粘贴 ~50 行 fetch 模板
+ web/src/contexts/WidgetDataContext.tsx  21 字段 → 25 字段
+ web/src/components/layout/GroupBlock.tsx  if-else 链加分支
+ web/src/components/widgets/SonarrWidget.tsx  新建组件
+ web/src/hooks/useWidgetEditor.ts  配置编辑分支(本次 C2 不解决)
```

**改造后(C2 之后)**:

```diff
# 核心改动从 7 处 → 2 处:
+ web/src/components/widgets/SonarrWidget.tsx  新建文件:
                                                interface SonarrConfig {...}
                                                function SonarrView({data, error, cfg}) {...}
                                                export const sonarrWidget = defineWidget<SonarrConfig, SonarrResponse>({
                                                  kind: 'sonarr',
                                                  labelKey: 'widgets:sonarr',
                                                  defaultConfig: {url: '', apiKey: ''},
                                                  fetchData: (cfg, signal) => apiGet(...),
                                                  pollIntervalMs: 30 * 1000,
                                                  Component: SonarrView,
                                                })
+ web/src/widgets/registry.ts       import sonarrWidget + tuple 加 1 行

# 跟 C2 无关、本来就需要的工作(改造前后都要做,不计入压缩):
. i18n locales en/zh 加 widgets.sonarr key  (任何 widget 加翻译都要做)
. web/src/hooks/useWidgetEditor.ts  配置编辑分支  (本次 C2 不解决,留待 C2.5 / F3)
```

**核心修改面**:从原来需要改 4 个 hook/context/dispatch 协同文件(useWidgets / WidgetDataContext / GroupBlock / constants),压缩为 **0 处协同改动** — 只新建 widget 文件 + registry 注册一行。i18n 和配置编辑器的改动跟"加 widget"这件事正交,改造前后都需要,不是 C2 的压缩收益,但也是 C2 不能消除的固有成本。

## F4 第三方插件路径预留

C2 不实现 F4,但形状预留:

```ts
// 未来 F4 落地形态:
import { registerWidget } from '@hearth/widget-sdk'
import { defineWidget } from '@hearth/widget-sdk'

const myWidget = defineWidget({...})
registerWidget(myWidget)  // 运行期注入到 REGISTRY_MAP

// 内置 widget 仍走 as const tuple 静态 import,保持类型推导;
// 第三方 widget 走运行期 Map.set(),WidgetKind 类型退化为 string —
// 第三方插件本来就不需要静态类型推导
```

## 非目标 / 未决

- **`useWidgetEditor` 重构** — 留 C2.5 / F3 阶段做。届时积累更多 widget 配置形态,`configSchema` 选型决策更稳
- **是否引入测试框架** — F3 阶段如有需要再决定
- **byId Map 重渲染优化** — 实测后再定方案
