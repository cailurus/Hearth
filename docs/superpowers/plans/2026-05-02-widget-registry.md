# Widget Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated per-widget fetch templates and if-else dispatch with a `WidgetSpec` registry, so adding a widget requires creating one new file plus a one-line entry in `registry.ts`.

**Architecture:** Pure-frontend refactor. New `widgets/types.ts` exports `defineWidget<TConfig, TData>(spec)` factory + `WidgetSpec` interface. New `widgets/registry.ts` is an `as const` tuple of all built-in widgets — both `WidgetKind` literal union and `getWidget(kind)` are derived from it. `useWidgets` collapses 8 duplicated `useEffect`s into one generic loop that reads from the registry; results land in a `Map<widgetId, WidgetSlice>` exposed via `WidgetDataContext`. Two carve-outs (`defaultWeather`, `metricsShared`) stay top-level. Migration is incremental: stage 1 lands the infra + first 2 widgets; stage 2 migrates the remaining 7 one-at-a-time; stage 3 deletes the LEGACY path.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7. No new dependencies. No backend changes.

**Spec:** `docs/superpowers/specs/2026-05-02-widget-registry-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `web/src/widgets/types.ts` | Create | `WidgetSpec<TConfig, TData>` interface + `defineWidget()` factory + `WidgetSlice` type |
| `web/src/widgets/registry.ts` | Create | `WIDGET_REGISTRY` tuple, `WidgetKind` derived type, `getWidget(kind)` lookup |
| `web/src/api/client.ts` | Modify | `apiGet` accepts `{ signal?: AbortSignal }` second arg, passes to fetch |
| `web/src/hooks/useWidgets.ts` | Modify (heavy) | Add generic registry loop; old per-widget effects gain registry skip-guard; eventually shrink to 1 generic loop + 2 carve-outs |
| `web/src/contexts/WidgetDataContext.tsx` | Modify | Add `byId: Map<string, WidgetSlice>` field + `useWidgetSlice(id)` hook |
| `web/src/utils/constants.ts` | Modify | `WIDGET_KINDS` and `WIDGET_LABEL_KEYS` derive from `WIDGET_REGISTRY` (with `LEGACY_*` merge during migration) |
| `web/src/components/layout/GroupBlock.tsx` | Modify (heavy) | Dispatch via `getWidget()` first; old if-else chain only handles registry-misses; eventually shrinks to metrics-inline + registry-dispatch only |
| `web/src/components/widgets/CurrencyWidget.tsx` | Modify | Collapse props to 5 standard (data/error/cfg/refresh/isAdmin); `export const currencyWidget = defineWidget(...)` |
| `web/src/components/widgets/DealsWidget.tsx` | Modify | Same pattern; `lang` via `useTranslation()` internally |
| `web/src/components/widgets/HolidaysWidget.tsx` | Modify | Same pattern |
| `web/src/components/widgets/MarketsWidget.tsx` | Modify | Same pattern; `symbols` via `cfg.symbols` |
| `web/src/components/widgets/DockerWidget.tsx` | Modify | Same pattern; `isAdmin` from standard props (already used) |
| `web/src/components/widgets/WeatherWidget.tsx` | Modify | Same pattern; `cityName` via `cfg.city`; `lang` via `useTranslation()` |
| `web/src/components/widgets/RSSWidget.tsx` | Modify | Same pattern; `lang` via `useTranslation()`; manual refresh via `slice.refresh` |
| `web/src/components/widgets/NotesWidget.tsx` | Modify | Same pattern; `isAdmin` from standard props |
| `web/src/components/widgets/TimezonesWidget.tsx` | Modify | Same pattern; `localTimezone` via `Intl.DateTimeFormat()...timeZone` internally; `clocks` via `cfg.clocks` |
| `web/scripts/check-widget-registry.mjs` | Create | Lint registry: kind uniqueness + labelKey i18n existence |
| `web/package.json` | Modify | Add `check:widgets` npm script |

**Files NOT touched:** `useWidgetEditor.ts`, `EditItemDialog.tsx`, `AddItemDialog.tsx`, `BookmarkGroup.tsx`, the entire backend.

---

## Stage 1: Infrastructure + first cut (currency + deals) — single commit

Tasks 1-10 collectively form one commit at the end of Task 10. Each task is a logical sub-step; do not commit between them.

### Task 1: Create `WidgetSpec` types and `defineWidget` factory

**Files:**
- Create: `web/src/widgets/types.ts`

- [ ] **Step 1: Write `web/src/widgets/types.ts`**

```ts
/**
 * Widget Registry types — shared across the registry, useWidgets generic
 * loop, and individual widget definitions.
 *
 * The two carve-outs (defaultWeather + metricsShared) deliberately do NOT
 * fit into this shape; they live as top-level fields on UseWidgetsResult.
 * See docs/superpowers/specs/2026-05-02-widget-registry-design.md.
 */

import type { ComponentType } from 'react'

export interface WidgetSpec<TConfig = unknown, TData = unknown> {
    /** Type literal matching the widget URL `widget:<kind>`. */
    readonly kind: string

    /** i18n key — replaces the WIDGET_LABEL_KEYS table. */
    readonly labelKey: string

    /** Default config; merged under any user cfg in safeParseJSON(a.description). */
    readonly defaultConfig: TConfig

    /**
     * Optional one-shot data fetch.
     *  - signal: AbortController signal — replaces the closure cancelled-boolean pattern
     *  - returns TData or throws (throw lands in slice.error)
     *  - undefined means the widget renders local data only (timezones / notes)
     */
    readonly fetchData?: (cfg: TConfig, signal: AbortSignal) => Promise<TData>

    /**
     * Polling interval (ms) for fetchData:
     *  - number: fixed
     *  - function: derived from cfg (docker uses cfg.refreshSec; markets fixed 5min)
     *  - undefined: fetch once on mount / cfg change, no polling
     *
     * Only meaningful when fetchData is set.
     */
    readonly pollIntervalMs?: number | ((cfg: TConfig) => number)

    /**
     * Renderer. The 5 standard props:
     *  - data / error / cfg: from the byId slice + parsed cfg
     *  - refresh: per-instance manual refresh (RSS etc)
     *  - isAdmin: ambient admin flag (Notes / Docker etc)
     *
     * Other ambient state (lang, localTimezone, ...) widgets read via hooks
     * (useTranslation) or browser APIs (Intl.DateTimeFormat) internally.
     */
    readonly Component: ComponentType<{
        data: TData | null
        error: string | null
        cfg: TConfig
        refresh: () => void
        isAdmin: boolean
    }>
}

/**
 * Slice shape stored in the byId Map.  Type-erased on purpose: the cast
 * happens once inside defineWidget() so consumers see precise types and
 * the generic useWidgets loop can iterate without knowing TConfig/TData.
 */
export interface WidgetSlice {
    kind: string
    data: unknown
    error: string | null
    refresh: () => void
}

/**
 * Factory — identity at runtime, used purely for type-inference closure.
 * Each widget file does:
 *   export const fooWidget = defineWidget<FooConfig, FooData>({...})
 * and the rest of the codebase consumes the type-erased WidgetSpec.
 */
export function defineWidget<TConfig, TData>(
    spec: WidgetSpec<TConfig, TData>,
): WidgetSpec {
    return spec as unknown as WidgetSpec
}
```

- [ ] **Step 2: Verify the file compiles standalone**

Run from `web/`:

```
npx tsc --noEmit src/widgets/types.ts
```

Expected: no output (success). If you get "Cannot find module", that's fine — TypeScript may not resolve in isolation; the real check is the full build at the end of Stage 1.

---

### Task 2: Add `AbortSignal` support to `apiGet`

**Files:**
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: Update `apiGet` to accept an options arg**

Current shape (`web/src/api/client.ts:23-26`):

```ts
export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' })
    return parseJsonOrThrow<T>(res)
}
```

Replace with:

```ts
export async function apiGet<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
    const res = await fetch(path, {
        credentials: 'include',
        signal: opts?.signal,
    })
    return parseJsonOrThrow<T>(res)
}
```

- [ ] **Step 2: Confirm no callers break**

Run from `web/`:

```
npx tsc --noEmit
```

Expected: no errors. The new `opts` parameter is optional, so existing callers (none of which pass it yet) keep working.

---

### Task 3: Migrate `CurrencyWidget` to defineWidget shape

**Files:**
- Modify: `web/src/components/widgets/CurrencyWidget.tsx`

- [ ] **Step 1: Add registry export below the existing component**

Append to `web/src/components/widgets/CurrencyWidget.tsx` (after the existing `export function CurrencyWidget(...)`, do NOT delete the existing component yet — the LEGACY GroupBlock branch still references it):

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'

export interface CurrencyConfig {
    pairs: string[]
}

const CURRENCY_DEFAULT_CONFIG: CurrencyConfig = { pairs: [] }

function CurrencyView({ data, error, cfg }: {
    data: CurrencyResponse | null
    error: string | null
    cfg: CurrencyConfig
    refresh: () => void
    isAdmin: boolean
}) {
    // Reuse the existing CurrencyWidget body — it already takes data/error.
    // The cfg is read by useWidgets to compose the request, not by the view.
    return <CurrencyWidget data={data} error={error} />
}

export const currencyWidget = defineWidget<CurrencyConfig, CurrencyResponse>({
    kind: 'currency',
    labelKey: 'widgets:currency',
    defaultConfig: CURRENCY_DEFAULT_CONFIG,
    pollIntervalMs: 5 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const pairs = (Array.isArray(cfg.pairs) ? cfg.pairs : [])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
            .slice(0, 4)
        if (pairs.length === 0) {
            return { fetchedAt: 0, items: [] } as CurrencyResponse
        }
        const qs = new URLSearchParams({ pairs: pairs.join(',') })
        return apiGet<CurrencyResponse>(`/api/widgets/currency?${qs.toString()}`, { signal })
    },
    Component: CurrencyView,
})
```

- [ ] **Step 2: Add the `import` at the top of the file if not already present**

Make sure these imports exist near the top of `web/src/components/widgets/CurrencyWidget.tsx`:

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import type { CurrencyResponse, CurrencyPair } from '../../types'  // CurrencyResponse may already be imported
```

- [ ] **Step 3: Sanity check — typecheck only this file's exports**

```
npx tsc --noEmit
```

Expected: no errors. The new `currencyWidget` constant has full type inference from the generics.

---

### Task 4: Migrate `DealsWidget` to defineWidget shape

**Files:**
- Modify: `web/src/components/widgets/DealsWidget.tsx`

- [ ] **Step 1: Update `DealsWidget` to read `lang` internally**

Find the current signature in `web/src/components/widgets/DealsWidget.tsx`:

```ts
interface DealsWidgetProps {
    data: DealsResponse | null
    error?: string | null
    lang: 'zh' | 'en'
}

export function DealsWidget({ data, error, lang }: DealsWidgetProps) {
```

The existing component is still consumed by the LEGACY GroupBlock branch — leave it alone, but add a wrapper that pulls `lang` from `useTranslation`:

Append to the bottom of the file:

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { useTranslation } from 'react-i18next'

export interface DealsConfig {
    region: string
}

const DEALS_DEFAULT_CONFIG: DealsConfig = { region: 'us' }

function DealsView({ data, error }: {
    data: DealsResponse | null
    error: string | null
    cfg: DealsConfig
    refresh: () => void
    isAdmin: boolean
}) {
    const { i18n } = useTranslation()
    const lang: 'zh' | 'en' = i18n.language === 'en' ? 'en' : 'zh'
    return <DealsWidget data={data} error={error} lang={lang} />
}

export const dealsWidget = defineWidget<DealsConfig, DealsResponse>({
    kind: 'deals',
    labelKey: 'widgets:deals',
    defaultConfig: DEALS_DEFAULT_CONFIG,
    pollIntervalMs: 15 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const region = String(cfg.region ?? 'us').trim() || 'us'
        const qs = new URLSearchParams({ region })
        return apiGet<DealsResponse>(`/api/widgets/deals?${qs.toString()}`, { signal })
    },
    Component: DealsView,
})
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors.

---

### Task 5: Create `widgets/registry.ts` with currency + deals

**Files:**
- Create: `web/src/widgets/registry.ts`

- [ ] **Step 1: Write `web/src/widgets/registry.ts`**

```ts
/**
 * Widget Registry — single source of truth for built-in widgets.
 *
 * Each entry is a WidgetSpec produced by defineWidget(). The tuple is
 * `as const` so TypeScript can derive WidgetKind as a literal union from
 * its members. Add a new widget by:
 *   1. creating <Kind>Widget.tsx that exports `kindWidget = defineWidget(...)`
 *   2. adding the import and tuple entry below
 *
 * `metrics` is intentionally NOT in the registry — its inline rendering
 * + shared-interval polling lives directly in GroupBlock + useWidgets.
 *
 * During migration (stages 1-2) only widgets currently moved over appear
 * here; the LEGACY_KINDS in utils/constants.ts covers the rest.
 */

import type { WidgetSpec } from './types'
import { currencyWidget } from '../components/widgets/CurrencyWidget'
import { dealsWidget } from '../components/widgets/DealsWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
] as const

/** Literal union derived from the tuple — adding a widget extends this automatically. */
export type WidgetKind = (typeof WIDGET_REGISTRY)[number]['kind']

const REGISTRY_MAP = new Map<string, WidgetSpec>(
    WIDGET_REGISTRY.map((w) => [w.kind, w as WidgetSpec]),
)

export function getWidget(kind: string): WidgetSpec | undefined {
    return REGISTRY_MAP.get(kind)
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors. The `as const` + indexed-access type produces the union `'currency' | 'deals'` for `WidgetKind`.

---

### Task 6: Add `byId` Map to `useWidgets`

**Files:**
- Modify: `web/src/hooks/useWidgets.ts`

This task adds the new generic loop **alongside** the existing 8 per-widget useEffects. The old effects gain a registry-skip guard so they don't fight with the new loop.

- [ ] **Step 1: Add new imports near the top**

In `web/src/hooks/useWidgets.ts`, near the existing imports, add:

```ts
import { WIDGET_REGISTRY, getWidget } from '../widgets/registry'
import type { WidgetSlice } from '../widgets/types'
```

- [ ] **Step 2: Add `byId` to `UseWidgetsResult`**

Find `export interface UseWidgetsResult { ... }` (around line 7) and add:

```ts
    /** Per-instance fetch state for widgets that have been migrated to the registry. */
    byId: Map<string, WidgetSlice>
```

(Keep all the existing 21 fields untouched — they're the LEGACY path.)

- [ ] **Step 3: Add the `byId` state**

After the existing useState declarations near the top of the `useWidgets` function body, add:

```ts
    const [byId, setById] = useState<Map<string, WidgetSlice>>(() => new Map())
```

- [ ] **Step 4: Add the generic registry loop useEffect**

Add a new `useEffect` block (place it before the existing `// Fetch default weather` effect):

```ts
    // Generic registry-driven fetch loop. Handles every widget that has been
    // migrated to defineWidget(). Old per-widget effects below skip kinds
    // already in the registry to avoid duplicate work.
    useEffect(() => {
        const controllers = new Map<string, AbortController>()
        const timers = new Map<string, number>()

        // Find apps whose kind is in the registry.
        type Inst = { id: string; kind: string; spec: ReturnType<typeof getWidget> & {}; cfg: unknown }
        const instances: Inst[] = []
        for (const a of apps) {
            const kind = widgetKindFromUrl(a.url)
            if (!kind) continue
            const spec = getWidget(kind)
            if (!spec) continue
            const cfg = { ...(spec.defaultConfig as object), ...((safeParseJSON(a.description) as object | null) ?? {}) }
            instances.push({ id: a.id, kind, spec, cfg })
        }

        // Drop any byId entries for apps that no longer exist.
        setById((prev) => {
            const liveIds = new Set(instances.map((i) => i.id))
            let dirty = false
            const next = new Map(prev)
            for (const id of prev.keys()) {
                if (!liveIds.has(id)) {
                    next.delete(id)
                    dirty = true
                }
            }
            return dirty ? next : prev
        })

        for (const inst of instances) {
            const fetchOnce = async () => {
                if (!inst.spec.fetchData) return
                controllers.get(inst.id)?.abort()
                const ctrl = new AbortController()
                controllers.set(inst.id, ctrl)
                try {
                    const data = await inst.spec.fetchData(inst.cfg, ctrl.signal)
                    setById((prev) => {
                        const next = new Map(prev)
                        next.set(inst.id, {
                            kind: inst.kind,
                            data,
                            error: null,
                            refresh: fetchOnce,
                        })
                        return next
                    })
                } catch (e) {
                    if (ctrl.signal.aborted) return
                    setById((prev) => {
                        const next = new Map(prev)
                        next.set(inst.id, {
                            kind: inst.kind,
                            data: null,
                            error: e instanceof Error ? e.message : 'failed',
                            refresh: fetchOnce,
                        })
                        return next
                    })
                }
            }

            // Seed a placeholder slice so consumers see refresh() immediately.
            setById((prev) => {
                if (prev.has(inst.id)) return prev
                const next = new Map(prev)
                next.set(inst.id, {
                    kind: inst.kind,
                    data: null,
                    error: null,
                    refresh: fetchOnce,
                })
                return next
            })

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
            controllers.forEach((c) => c.abort())
            timers.forEach((t) => window.clearInterval(t))
        }
    }, [apps])
```

- [ ] **Step 5: Add registry-skip guard to the LEGACY currency effect**

Find the existing `// Fetch currency data` effect (around line 364). Replace its top:

```ts
    // Fetch currency data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'currency')
```

with:

```ts
    // Fetch currency data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('currency')) {
            // Registry handles this kind; clear LEGACY state and bail.
            setCurrencyById({})
            setCurrencyErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'currency')
```

- [ ] **Step 6: Same skip guard for the LEGACY deals effect**

Find the `// Fetch deals data` effect (around line 411). Replace its top similarly:

```ts
    // Fetch deals data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('deals')) {
            setDealsById({})
            setDealsErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'deals')
```

- [ ] **Step 7: Add `byId` to the return value**

Find the `return { ... }` at the bottom of `useWidgets` (around line 512). Add `byId` as the first field:

```ts
    return {
        byId,
        weather,
        weatherErr,
        ...
        // (rest of existing fields unchanged)
    }
```

- [ ] **Step 8: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors.

---

### Task 7: Add `byId` to `WidgetDataContext` + `useWidgetSlice` hook

**Files:**
- Modify: `web/src/contexts/WidgetDataContext.tsx`

- [ ] **Step 1: Add `useWidgetSlice` hook**

Append to `web/src/contexts/WidgetDataContext.tsx` (after the existing `useWidgetData` hook):

```ts
import type { WidgetSlice } from '../widgets/types'

/**
 * useWidgetSlice — read this widget instance's fetch state from the registry.
 *
 * Returns undefined if the kind isn't in the registry (LEGACY path) or the
 * generic loop hasn't seeded a placeholder yet. Component code should treat
 * undefined the same as a slice with null data + null error.
 */
export function useWidgetSlice(widgetId: string): WidgetSlice | undefined {
    const { byId } = useWidgetData()
    return byId.get(widgetId)
}
```

- [ ] **Step 2: Typecheck**

The `byId` field is added to `UseWidgetsResult` in Task 6, so this should resolve. Run:

```
npx tsc --noEmit
```

Expected: no errors.

---

### Task 8: Update `constants.ts` to derive `WIDGET_KINDS` / `WIDGET_LABEL_KEYS` from registry + LEGACY

**Files:**
- Modify: `web/src/utils/constants.ts`

- [ ] **Step 1: Replace the body of constants.ts**

Current `web/src/utils/constants.ts`:

```ts
export const WIDGET_KINDS = ['weather', 'metrics', 'timezones', 'markets', 'holidays', 'docker', 'notes', 'rss', 'currency', 'deals'] as const

export const WIDGET_LABEL_KEYS: Record<string, string> = {
    weather: 'widgets:weather',
    metrics: 'widgets:systemStatus',
    timezones: 'widgets:worldClock',
    markets: 'widgets:markets',
    holidays: 'widgets:upcomingHolidays',
    docker: 'widgets:docker',
    notes: 'widgets:notes',
    rss: 'widgets:rss',
    currency: 'widgets:currency',
    deals: 'widgets:deals',
}
```

Replace with:

```ts
import { WIDGET_REGISTRY } from '../widgets/registry'

/**
 * 默认市场符号
 */
export const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'MSFT'] as const

/**
 * 默认时区
 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/**
 * Widget URL 前缀
 */
export const WIDGET_URL_PREFIX = 'widget:'

/**
 * Widget kinds NOT yet in the registry. Once stage 2 finishes migrating
 * each widget, remove its entry here. When this array is empty, also
 * delete it and the LEGACY label table below — at that point the
 * registry is the sole source of truth.
 *
 * `metrics` stays here permanently (carve-out: inline rendering +
 * shared-interval polling, doesn't fit the registry shape).
 */
const LEGACY_KINDS = [
    'weather',
    'metrics',
    'timezones',
    'markets',
    'holidays',
    'docker',
    'notes',
    'rss',
] as const

const LEGACY_LABEL_KEYS: Record<string, string> = {
    weather: 'widgets:weather',
    metrics: 'widgets:systemStatus',
    timezones: 'widgets:worldClock',
    markets: 'widgets:markets',
    holidays: 'widgets:upcomingHolidays',
    docker: 'widgets:docker',
    notes: 'widgets:notes',
    rss: 'widgets:rss',
}

/**
 * 支持的 Widget 类型 — registry 推导项与 LEGACY 项合并。
 */
export const WIDGET_KINDS = [
    ...WIDGET_REGISTRY.map((w) => w.kind),
    ...LEGACY_KINDS,
] as readonly string[]

/**
 * Widget i18n label keys — registry 推导项 + LEGACY 项合并。
 */
export const WIDGET_LABEL_KEYS: Record<string, string> = {
    ...Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.kind, w.labelKey])),
    ...LEGACY_LABEL_KEYS,
}
```

- [ ] **Step 2: Confirm `widgetKindFromUrl` still works**

`web/src/utils/helpers.ts:62-69` uses `WIDGET_KINDS.includes(kind)` to validate. With `WIDGET_KINDS` now `readonly string[]`, the call site might complain about `.includes()` signature. Check by running:

```
npx tsc --noEmit
```

If TypeScript complains about narrowing, change the line in `helpers.ts`:

```ts
    if (WIDGET_KINDS.includes(kind)) return kind
```

to (if needed):

```ts
    if ((WIDGET_KINDS as readonly string[]).includes(kind)) return kind as WidgetKind
```

(but most likely it Just Works.)

---

### Task 9: Update `GroupBlock` to prefer registry dispatch

**Files:**
- Modify: `web/src/components/layout/GroupBlock.tsx`

- [ ] **Step 1: Add registry import + helper**

Near the top of `web/src/components/layout/GroupBlock.tsx`, add:

```ts
import { getWidget } from '../../widgets/registry'
import { WidgetBoundary } from '../ui'  // (already imported, just confirm)

const noop = () => {}
```

- [ ] **Step 2: Replace the widget renderer if-else chain top**

Find the section starting around line 328:

```tsx
                                        {widget === 'weather' ? (
                                            <WeatherWidget ... />
                                        ) : widget === 'metrics' ? (
                                            ... inline metrics rendering ...
                                        ) : widget === 'markets' ? (
                                            <MarketsWidget ... />
                                        ) : ... etc
                                        ) : (
                                            <TimezonesWidget ... />
                                        )}
```

Wrap the existing chain so registry is checked first. Insert immediately before `{widget === 'weather' ? ... }`:

```tsx
                                        {(() => {
                                            // Registry path — preferred when this kind has migrated.
                                            const spec = getWidget(widget)
                                            if (spec) {
                                                const slice = byId.get(a.id)
                                                return (
                                                    <spec.Component
                                                        data={slice?.data ?? null}
                                                        error={slice?.error ?? null}
                                                        cfg={cfg}
                                                        refresh={slice?.refresh ?? noop}
                                                        isAdmin={isAdmin}
                                                    />
                                                )
                                            }
                                            // LEGACY path — fallthrough to existing if-else chain below.
                                            return null
                                        })() ||
                                        widget === 'weather' ? (
                                            <WeatherWidget ... />
                                        ) : ...
                                        }
```

(Keep the existing chain as the fallback. The new IIFE returns `null` only when the kind is NOT in the registry, in which case the `||` falls through to the LEGACY chain.)

**Note**: Pull `byId` out of the existing `useWidgetData()` destructure (at the top of `GroupBlockImpl`):

```ts
    const {
        weather,
        weatherErr,
        ...
        byId,    // ← add this
    } = useWidgetData()
```

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```

Expected: no errors.

---

### Task 10: Stage 1 verification + commit

- [ ] **Step 1: Full build**

From `web/`:

```
npm run build
```

Expected output ends with:

```
✓ built in <N>ms
```

Any TypeScript error here means a previous task left something inconsistent. Fix and retry before committing.

- [ ] **Step 2: Boot the app and smoke test**

From the project root, in two terminals:

```
go run ./cmd/hearth
```

```
cd web && npm run dev
```

Open the browser to the dev URL and verify:

- [ ] Currency widget renders normally (data displays for configured pairs)
- [ ] Deals widget renders normally
- [ ] Open browser DevTools console — no React warnings or unhandled exceptions
- [ ] Other widgets (weather/markets/holidays/metrics/docker/notes/rss/timezones) still render — they're on the LEGACY path
- [ ] Edit a currency widget config (change a pair), save, refresh page — new pair appears

If any of the above fails, **stop and diagnose before committing**. If all pass, continue.

- [ ] **Step 3: Diff size sanity check**

```
git diff --stat HEAD
```

Expected total: roughly +400 to +500 lines added, ~50-100 deleted.

If the diff is **> +700 added**, the design didn't converge as expected — pause, check the spec, possibly invoke brainstorming again. Otherwise continue.

- [ ] **Step 4: Commit Stage 1**

```
git add web/src/widgets/ web/src/api/client.ts web/src/hooks/useWidgets.ts web/src/contexts/WidgetDataContext.tsx web/src/utils/constants.ts web/src/components/widgets/CurrencyWidget.tsx web/src/components/widgets/DealsWidget.tsx web/src/components/layout/GroupBlock.tsx
git commit -m "$(cat <<'EOF'
refactor(widgets): introduce widget registry — stage 1 (currency + deals)

Build the registry infrastructure (defineWidget factory, WIDGET_REGISTRY
tuple, generic fetch loop, byId Map context) and migrate the two
simplest widgets as a sanity check. Existing 8 LEGACY useEffects in
useWidgets and the if-else chain in GroupBlock now fall through to the
registry path when a kind has been migrated, otherwise stay on the old
path. WIDGET_KINDS and WIDGET_LABEL_KEYS are now derived from the
registry plus a shrinking LEGACY_KINDS list.

Stage 2 will migrate the remaining 7 widgets one commit at a time.
Stage 3 will delete the LEGACY path.

Spec: docs/superpowers/specs/2026-05-02-widget-registry-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Stage 2: Migrate remaining 7 widgets — one commit each

Each task in this stage produces one commit. Stop and re-verify between tasks.

### Task 11: Migrate `HolidaysWidget`

**Files:**
- Modify: `web/src/components/widgets/HolidaysWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/hooks/useWidgets.ts`
- Modify: `web/src/contexts/WidgetDataContext.tsx`
- Modify: `web/src/components/layout/GroupBlock.tsx`

- [ ] **Step 1: Append `holidaysWidget` defineWidget export to HolidaysWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { normalizeCountryCodes } from '../../utils'

export interface HolidaysConfig {
    countries: string[]
}

const HOLIDAYS_DEFAULT_CONFIG: HolidaysConfig = { countries: [] }

function HolidaysView({ data, error }: {
    data: HolidaysResponse | null
    error: string | null
    cfg: HolidaysConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <HolidaysWidget data={data} error={error} />
}

export const holidaysWidget = defineWidget<HolidaysConfig, HolidaysResponse>({
    kind: 'holidays',
    labelKey: 'widgets:upcomingHolidays',
    defaultConfig: HOLIDAYS_DEFAULT_CONFIG,
    pollIntervalMs: 5 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const raw = Array.isArray(cfg.countries) ? cfg.countries : []
        const countries = normalizeCountryCodes(raw.map((x) => String(x ?? '')))
        if (countries.length === 0) {
            return null as unknown as HolidaysResponse  // empty config; UI shows skeleton
        }
        const qs = new URLSearchParams({ countries: countries.join(',') })
        return apiGet<HolidaysResponse>(`/api/widgets/holidays?${qs.toString()}`, { signal })
    },
    Component: HolidaysView,
})
```

- [ ] **Step 2: Add `holidaysWidget` to `widgets/registry.ts`**

Add the import and tuple entry:

```ts
import { holidaysWidget } from '../components/widgets/HolidaysWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
] as const
```

- [ ] **Step 3: Remove `'holidays'` from `LEGACY_KINDS` in `constants.ts`**

In the `LEGACY_KINDS` array, delete the `'holidays',` line. In `LEGACY_LABEL_KEYS`, delete the `holidays:` entry.

- [ ] **Step 4: Add registry-skip guard to LEGACY holidays effect in `useWidgets.ts`**

Find the `// Fetch holidays data` effect (around line 210). Replace its top:

```ts
    // Fetch holidays data
    useEffect(() => {
        let cancelled = false
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'holidays')
```

with:

```ts
    // Fetch holidays data — skipped during migration if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('holidays')) {
            setHolidaysById({})
            setHolidaysErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'holidays')
```

- [ ] **Step 5: Build + smoke test**

```
cd web && npm run build
```

Expected: clean build. Then run dev server and confirm holidays widget still renders normally.

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "$(cat <<'EOF'
refactor(widgets): migrate holidays to registry

LEGACY useEffect now skips when registry handles 'holidays'.
LEGACY_KINDS shrinks by one. Behaviour unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Migrate `MarketsWidget`

**Files:**
- Modify: `web/src/components/widgets/MarketsWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/hooks/useWidgets.ts`

- [ ] **Step 1: Append `marketsWidget` defineWidget export to MarketsWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'

export interface MarketsConfig {
    symbols: string[]
}

const MARKETS_DEFAULT_CONFIG: MarketsConfig = { symbols: [] }

function MarketsView({ data, error, cfg }: {
    data: MarketsResponse | null
    error: string | null
    cfg: MarketsConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <MarketsWidget data={data} error={error} symbols={cfg.symbols} />
}

export const marketsWidget = defineWidget<MarketsConfig, MarketsResponse>({
    kind: 'markets',
    labelKey: 'widgets:markets',
    defaultConfig: MARKETS_DEFAULT_CONFIG,
    pollIntervalMs: 5 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const raw = Array.isArray(cfg.symbols) ? cfg.symbols : []
        const symbols = raw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
        if (symbols.length === 0) {
            return null as unknown as MarketsResponse
        }
        const qs = new URLSearchParams({ symbols: symbols.join(',') })
        return apiGet<MarketsResponse>(`/api/widgets/markets?${qs.toString()}`, { signal })
    },
    Component: MarketsView,
})
```

(Note: `MarketsWidget`'s existing component takes `symbols?: string[]` — `MarketsView` passes it through from cfg.)

- [ ] **Step 2: Register markets**

In `widgets/registry.ts`:

```ts
import { marketsWidget } from '../components/widgets/MarketsWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
] as const
```

- [ ] **Step 3: Remove `'markets'` from LEGACY_KINDS / LABEL_KEYS in `constants.ts`**

- [ ] **Step 4: Add registry-skip guard to LEGACY markets effect in `useWidgets.ts`**

Find `// Fetch markets data` (around line 160). Replace its top:

```ts
    useEffect(() => {
        let cancelled = false
        if (getWidget('markets')) {
            setMarketsById({})
            setMarketsErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'markets')
```

- [ ] **Step 5: Build + smoke test**

```
cd web && npm run build
```

Run dev server, confirm markets widget renders + auto-refreshes every 5 min (or manually wait/check network tab).

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "refactor(widgets): migrate markets to registry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Migrate `DockerWidget`

**Files:**
- Modify: `web/src/components/widgets/DockerWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/hooks/useWidgets.ts`

- [ ] **Step 1: Append `dockerWidget` defineWidget export to DockerWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'

export interface DockerConfig {
    refreshSec: 5 | 10 | 30
}

const DOCKER_DEFAULT_CONFIG: DockerConfig = { refreshSec: 10 }

function DockerView({ data, error, isAdmin }: {
    data: DockerResponse | null
    error: string | null
    cfg: DockerConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <DockerWidget data={data} error={error} isAdmin={isAdmin} />
}

export const dockerWidget = defineWidget<DockerConfig, DockerResponse>({
    kind: 'docker',
    labelKey: 'widgets:docker',
    defaultConfig: DOCKER_DEFAULT_CONFIG,
    pollIntervalMs: (cfg) => {
        const sec = cfg.refreshSec
        return (sec === 5 || sec === 10 || sec === 30 ? sec : 10) * 1000
    },
    fetchData: async (_cfg, signal) => {
        return apiGet<DockerResponse>('/api/widgets/docker', { signal })
    },
    Component: DockerView,
})
```

- [ ] **Step 2: Register docker**

```ts
import { dockerWidget } from '../components/widgets/DockerWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
] as const
```

- [ ] **Step 3: Remove `'docker'` from LEGACY in `constants.ts`**

- [ ] **Step 4: Add registry-skip guard to LEGACY docker effect (around line 313)**

```ts
    useEffect(() => {
        let cancelled = false
        if (getWidget('docker')) {
            setDockerById({})
            setDockerErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'docker')
```

- [ ] **Step 5: Build + smoke test (verify docker widget polls at configured interval)**

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "refactor(widgets): migrate docker to registry — polling interval via cfg.refreshSec

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Migrate `WeatherWidget` (per-instance only — defaultWeather stays carve-out)

**Files:**
- Modify: `web/src/components/widgets/WeatherWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/hooks/useWidgets.ts`

- [ ] **Step 1: Append `weatherWidget` defineWidget export to WeatherWidget.tsx**

The existing `WeatherWidget` component takes `cityName` for the loading skeleton. `WeatherView` passes `cfg.city`:

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { useTranslation } from 'react-i18next'

export interface WeatherConfig {
    city: string
}

const WEATHER_DEFAULT_CONFIG: WeatherConfig = { city: '' }

function WeatherView({ data, error, cfg }: {
    data: Weather | null
    error: string | null
    cfg: WeatherConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <WeatherWidget data={data} error={error} cityName={cfg.city || undefined} />
}

export const weatherWidget = defineWidget<WeatherConfig, Weather>({
    kind: 'weather',
    labelKey: 'widgets:weather',
    defaultConfig: WEATHER_DEFAULT_CONFIG,
    fetchData: async (cfg, signal) => {
        const city = String(cfg.city ?? '').trim()
        if (!city) throw new Error('city not configured')
        // Read lang from i18n at call time. Since fetchData runs outside
        // a React render, we read it from i18next directly.
        const { default: i18n } = await import('../../i18n')
        const lang = i18n.language === 'en' ? 'en' : 'zh'
        const qs = new URLSearchParams({ city, lang })
        return apiGet<Weather>(`/api/widgets/weather?${qs.toString()}`, { signal })
    },
    // Weather doesn't auto-poll; refresh is on-demand only.
    Component: WeatherView,
})
```

(Note: the `defaultWeather` carve-out in useWidgets — for users who configured a `defaultCity` but have no weather widget — keeps using the old per-effect path. Don't touch it.)

- [ ] **Step 2: Register weather**

```ts
import { weatherWidget } from '../components/widgets/WeatherWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
    weatherWidget,
] as const
```

- [ ] **Step 3: Remove `'weather'` from LEGACY in `constants.ts`**

- [ ] **Step 4: Add registry-skip guard to LEGACY per-instance weather effect (around line 108)**

The per-instance weather effect is **separate** from the defaultWeather effect. The first effect (line 82-105) handles `defaultCity` — leave it alone. The second effect (line 108-157) handles per-widget instances — guard that one:

```ts
    // Fetch weather for each weather widget — skipped if registry handles it.
    useEffect(() => {
        let cancelled = false
        if (getWidget('weather')) {
            setWeatherById({})
            setWeatherErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'weather')
```

- [ ] **Step 5: Build + smoke test**

Verify both:
- A configured weather widget shows current city's weather
- The "default city" weather (if user set defaultCity but added no widget) still works — should be visible somewhere in the UI like a fallback hero card

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "refactor(widgets): migrate weather (per-instance) to registry — defaultWeather stays carve-out

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Migrate `RSSWidget` (refresh via slice.refresh)

**Files:**
- Modify: `web/src/components/widgets/RSSWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/hooks/useWidgets.ts`
- Modify: `web/src/components/layout/GroupBlock.tsx`

- [ ] **Step 1: Append `rssWidget` defineWidget export to RSSWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'
import { apiGet } from '../../api'
import { useTranslation } from 'react-i18next'

export interface RSSConfig {
    feeds: string[]
}

const RSS_DEFAULT_CONFIG: RSSConfig = { feeds: [] }

function RSSView({ data, error }: {
    data: RSSResponse | null
    error: string | null
    cfg: RSSConfig
    refresh: () => void
    isAdmin: boolean
}) {
    const { i18n } = useTranslation()
    const lang: 'zh' | 'en' = i18n.language === 'en' ? 'en' : 'zh'
    return <RSSWidget data={data} error={error} lang={lang} />
}

export const rssWidget = defineWidget<RSSConfig, RSSResponse>({
    kind: 'rss',
    labelKey: 'widgets:rss',
    defaultConfig: RSS_DEFAULT_CONFIG,
    pollIntervalMs: 15 * 60 * 1000,
    fetchData: async (cfg, signal) => {
        const raw = Array.isArray(cfg.feeds) ? cfg.feeds : []
        const feeds = raw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 10)
        if (feeds.length === 0) {
            return { fetchedAt: 0, items: [] } as RSSResponse
        }
        const qs = new URLSearchParams()
        for (const f of feeds) qs.append('feed', f)
        return apiGet<RSSResponse>(`/api/widgets/rss?${qs.toString()}`, { signal })
    },
    Component: RSSView,
})
```

- [ ] **Step 2: Register RSS**

```ts
import { rssWidget } from '../components/widgets/RSSWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
    weatherWidget,
    rssWidget,
] as const
```

- [ ] **Step 3: Remove `'rss'` from LEGACY in `constants.ts`**

- [ ] **Step 4: Add registry-skip guard to LEGACY rss effect (around line 456)**

```ts
    useEffect(() => {
        let cancelled = false
        if (getWidget('rss')) {
            setRssById({})
            setRssErrById({})
            return
        }
        const ws = apps.filter((a) => widgetKindFromUrl(a.url) === 'rss')
```

- [ ] **Step 5: Update GroupBlock RSS refresh button to use slice.refresh**

Find the section in `GroupBlock.tsx` around line 282 that renders the RSS refresh button:

```tsx
                                            {widget === 'rss' && refreshRss ? (
                                                <button
                                                    onClick={refreshRss}
                                                    title={lang === 'zh' ? '刷新' : 'Refresh'}
                                                    ...
```

Change to read from `slice.refresh` (only if `refresh` is provided — if registry hasn't fired yet, fall back to old `refreshRss`):

```tsx
                                            {widget === 'rss' ? (() => {
                                                const slice = byId.get(a.id)
                                                const onRefresh = slice?.refresh ?? refreshRss
                                                return onRefresh ? (
                                                    <button
                                                        onClick={onRefresh}
                                                        title={lang === 'zh' ? '刷新' : 'Refresh'}
                                                        ...
                                                    >
                                                        ...
                                                    </button>
                                                ) : null
                                            })() : null}
```

(The exact JSX of the button itself doesn't change; only its `onClick` handler source.)

- [ ] **Step 6: Build + smoke test**

Verify:
- RSS widget displays feed items
- RSS refresh button still works (manually click — items should re-fetch with `?nocache=1` semantics; though strictly the registry path won't pass nocache. If users rely on the old "manual refresh = bypass cache" behavior, note this minor regression in the commit message.)

**KNOWN MINOR REGRESSION**: the LEGACY `refreshRss` path sent `?nocache=1` on manual refresh. The registry's generic `refresh()` does not. RSS data is still re-fetched, just without the cache-bypass header. If this matters in production, follow up by adding a `manualBypassCache` option to fetchData later. Note this in the commit message.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "$(cat <<'EOF'
refactor(widgets): migrate rss to registry — manual refresh via slice.refresh

Minor known regression: the registry's generic refresh() does not pass
?nocache=1 on manual refresh — backend cache may be served once after
the click. Follow up to add per-widget manual-refresh-bypass-cache
option if this matters in production.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Migrate `NotesWidget`

**Files:**
- Modify: `web/src/components/widgets/NotesWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`

NotesWidget has no fetchData (it manages its own state internally via apiGet calls in lifecycle hooks). The registry just dispatches it.

- [ ] **Step 1: Append `notesWidget` defineWidget export to NotesWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'

interface NotesConfig {} // notes has no config

const NOTES_DEFAULT_CONFIG: NotesConfig = {}

function NotesView({ isAdmin }: {
    data: null
    error: null
    cfg: NotesConfig
    refresh: () => void
    isAdmin: boolean
}) {
    return <NotesWidget isAdmin={isAdmin} />
}

export const notesWidget = defineWidget<NotesConfig, null>({
    kind: 'notes',
    labelKey: 'widgets:notes',
    defaultConfig: NOTES_DEFAULT_CONFIG,
    // No fetchData — NotesWidget manages its own data.
    Component: NotesView,
})
```

- [ ] **Step 2: Register notes**

```ts
import { notesWidget } from '../components/widgets/NotesWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
    weatherWidget,
    rssWidget,
    notesWidget,
] as const
```

- [ ] **Step 3: Remove `'notes'` from LEGACY in `constants.ts`**

- [ ] **Step 4: Build + smoke test (verify notes still renders with edit/add buttons when admin)**

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "refactor(widgets): migrate notes to registry — no fetchData (manages its own state)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Migrate `TimezonesWidget`

**Files:**
- Modify: `web/src/components/widgets/TimezonesWidget.tsx`
- Modify: `web/src/widgets/registry.ts`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/components/layout/GroupBlock.tsx`

TimezonesWidget needs `localTimezone` (browser local TZ string) and `clocks` (configured cities). `localTimezone` can be computed inside; `clocks` comes from `cfg.clocks`.

- [ ] **Step 1: Append `timezonesWidget` defineWidget export to TimezonesWidget.tsx**

```ts
import { defineWidget } from '../../widgets/types'

export interface TimezonesConfig {
    clocks: WorldClockCity[]
}

const TIMEZONES_DEFAULT_CONFIG: TimezonesConfig = { clocks: [] }

function TimezonesView({ cfg }: {
    data: null
    error: null
    cfg: TimezonesConfig
    refresh: () => void
    isAdmin: boolean
}) {
    const localTimezone = (() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        } catch {
            return 'UTC'
        }
    })()
    return <TimezonesWidget localTimezone={localTimezone} clocks={cfg.clocks} />
}

export const timezonesWidget = defineWidget<TimezonesConfig, null>({
    kind: 'timezones',
    labelKey: 'widgets:worldClock',
    defaultConfig: TIMEZONES_DEFAULT_CONFIG,
    Component: TimezonesView,
})
```

- [ ] **Step 2: Register timezones**

```ts
import { timezonesWidget } from '../components/widgets/TimezonesWidget'

export const WIDGET_REGISTRY = [
    currencyWidget,
    dealsWidget,
    holidaysWidget,
    marketsWidget,
    dockerWidget,
    weatherWidget,
    rssWidget,
    notesWidget,
    timezonesWidget,
] as const
```

- [ ] **Step 3: Remove `'timezones'` from LEGACY in `constants.ts`**

- [ ] **Step 4: GroupBlock no longer needs to pass localTimezone for the registry branch**

The registry dispatch passes only the 5 standard props — `localTimezone` is computed inside `TimezonesView`. The LEGACY fallback (which is now dead since timezones is in the registry) still references `localTimezone` from props; the IIFE returns the registry component first, so the LEGACY branch never executes for timezones. No edit needed beyond confirming it still typechecks.

- [ ] **Step 5: Build + smoke test (verify timezones widget renders, ticks every second)**

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "refactor(widgets): migrate timezones to registry — localTimezone computed internally via Intl

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Stage 3: Drop LEGACY paths — single commit

### Task 18: Delete LEGACY useState, fetch effects, Context fields, GroupBlock branches

**Files:**
- Modify: `web/src/hooks/useWidgets.ts`
- Modify: `web/src/contexts/WidgetDataContext.tsx`
- Modify: `web/src/utils/constants.ts`
- Modify: `web/src/components/layout/GroupBlock.tsx`

After Stage 2, `LEGACY_KINDS` should contain only `['metrics']`. The remaining LEGACY useEffects are no-ops (they all hit the `if (getWidget(...)) return` early bail). Time to delete them.

- [ ] **Step 1: Delete LEGACY useState declarations in `useWidgets.ts`**

Remove these 16 useState calls (around lines 54-75):

```
weatherById, weatherErrById,
marketsById, marketsErrById,
holidaysById, holidaysErrById,
dockerById, dockerErrById,
currencyById, currencyErrById,
dealsById, dealsErrById,
rssById, rssErrById, rssRefreshSeq, rssRefreshing,
```

**KEEP** these (carve-outs — do NOT delete):

```
weather, weatherErr     ← defaultWeather state (no-widget-but-defaultCity case)
metrics, netRate         ← metrics carve-out (shared-interval inline rendering)
lastMetricsRef           ← metrics derive support (cpu%/network rate calc)
```

- [ ] **Step 2: Delete LEGACY useEffect blocks**

Delete all per-widget LEGACY useEffects in `useWidgets.ts`: weather (per-instance), markets, holidays, docker, currency, deals, rss. KEEP: defaultWeather (the "no widget but defaultCity set" effect, ~lines 82-105) and metrics (lines ~260-310).

- [ ] **Step 3: Update `UseWidgetsResult` interface**

Replace:

```ts
export interface UseWidgetsResult {
    weather: Weather | null
    weatherErr: string | null
    weatherById: Record<string, Weather | null>
    weatherErrById: Record<string, string | null>
    marketsById: Record<string, MarketsResponse | null>
    marketsErrById: Record<string, string | null>
    holidaysById: Record<string, HolidaysResponse | null>
    holidaysErrById: Record<string, string | null>
    metrics: HostMetrics | null
    netRate: { upBps: number; downBps: number } | null
    dockerById: Record<string, DockerResponse | null>
    dockerErrById: Record<string, string | null>
    rssById: Record<string, RSSResponse | null>
    rssErrById: Record<string, string | null>
    refreshRss: () => void
    rssRefreshing: boolean
    currencyById: Record<string, CurrencyResponse | null>
    currencyErrById: Record<string, string | null>
    dealsById: Record<string, DealsResponse | null>
    dealsErrById: Record<string, string | null>
    byId: Map<string, WidgetSlice>
}
```

with:

```ts
export interface UseWidgetsResult {
    /** Per-instance fetch state for all registry widgets. */
    byId: Map<string, WidgetSlice>
    /** Default-city weather (when user configured defaultCity but added no weather widget). */
    weather: Weather | null
    weatherErr: string | null
    /** Host metrics — shared across all metrics widget instances. */
    metrics: HostMetrics | null
    netRate: { upBps: number; downBps: number } | null
}
```

- [ ] **Step 4: Update the `return { ... }` at the bottom of useWidgets**

Should now be:

```ts
    return {
        byId,
        weather,
        weatherErr,
        metrics,
        netRate,
    }
```

- [ ] **Step 5: Update `WidgetDataContext.tsx`**

The Context already exposes whatever `UseWidgetsResult` has. With the interface trimmed, Context consumers automatically see only `byId / weather / weatherErr / metrics / netRate`. No code change needed in Context itself, but verify no consumer references a deleted field.

- [ ] **Step 6: Update GroupBlock to remove dead LEGACY branches**

In `GroupBlock.tsx`:
- Remove the destructuring of deleted fields from `useWidgetData()` (keep only `byId / weather / weatherErr / metrics / netRate / refreshRss`... wait, refreshRss is gone too)
- Remove the IIFE wrapper (since registry path is now the only path for non-metrics)
- The dispatch becomes:

```tsx
                                        {widget === 'metrics' ? (
                                            // Inline metrics rendering — preserved as carve-out.
                                            metrics ? (
                                                <div className="space-y-2 sm:space-y-3 ...">
                                                    {/* existing inline cpu/mem/disk/net JSX */}
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center"><Spinner ... /></div>
                                            )
                                        ) : (() => {
                                            const spec = getWidget(widget)
                                            if (!spec) return null
                                            const slice = byId.get(a.id)
                                            return (
                                                <spec.Component
                                                    data={slice?.data ?? null}
                                                    error={slice?.error ?? null}
                                                    cfg={cfg}
                                                    refresh={slice?.refresh ?? noop}
                                                    isAdmin={isAdmin}
                                                />
                                            )
                                        })()}
```

- Update the RSS refresh button (Task 15 left a hybrid path — clean it up):

```tsx
                                            {widget === 'rss' ? (() => {
                                                const slice = byId.get(a.id)
                                                return slice?.refresh ? (
                                                    <button onClick={slice.refresh} ...>...</button>
                                                ) : null
                                            })() : null}
```

- [ ] **Step 7: Update `constants.ts`**

LEGACY_KINDS / LEGACY_LABEL_KEYS now contain only `metrics`. Inline that:

```ts
import { WIDGET_REGISTRY } from '../widgets/registry'

// ... DEFAULT_MARKET_SYMBOLS, DEFAULT_TIMEZONE, WIDGET_URL_PREFIX (unchanged)

/**
 * Supported widget kinds — registry + metrics carve-out.
 * `metrics` stays out of the registry: inline rendering + shared-interval
 * polling don't fit the registry shape (see spec § 边界划分).
 */
export const WIDGET_KINDS = [
    ...WIDGET_REGISTRY.map((w) => w.kind),
    'metrics',
] as readonly string[]

export const WIDGET_LABEL_KEYS: Record<string, string> = {
    ...Object.fromEntries(WIDGET_REGISTRY.map((w) => [w.kind, w.labelKey])),
    metrics: 'widgets:systemStatus',
}
```

- [ ] **Step 8: Build + smoke test the FULL widget set**

```
cd web && npm run build
```

Expected: clean build. Expected line counts:

```
wc -l src/hooks/useWidgets.ts src/components/layout/GroupBlock.tsx src/contexts/WidgetDataContext.tsx
```

Expected output (within ±15%):

```
~250  src/hooks/useWidgets.ts        # was 536
~360  src/components/layout/GroupBlock.tsx  # was 531
~50   src/contexts/WidgetDataContext.tsx
```

Run dev server. Manually verify EVERY widget kind:

- [ ] weather (configured city + defaultWeather fallback if applicable)
- [ ] markets
- [ ] holidays
- [ ] metrics (special — should still work, with all show-CPU/show-Mem/etc toggles respected)
- [ ] docker
- [ ] notes (admin and non-admin views)
- [ ] rss (refresh button works)
- [ ] currency
- [ ] deals
- [ ] timezones (multiple cities tick correctly)

Browser DevTools console must be free of unhandled errors and React warnings.

- [ ] **Step 9: Commit**

```
git add -A
git commit -m "$(cat <<'EOF'
refactor(widgets): drop LEGACY paths — registry is the sole source

stage 3 finalises the C2 refactor:
- useWidgets.ts: 536 → ~250 lines (drop 8 duplicated effects + 18 useState)
- GroupBlock.tsx: 531 → ~360 lines (drop the if-else chain)
- WidgetDataContext: 21 fields → 4 (byId Map + 2 carve-out fields each
  for defaultWeather and metrics)
- constants.ts: WIDGET_KINDS / LABEL_KEYS now derive from registry +
  inline metrics carve-out

Adding a new widget is now: create one file with defineWidget(...)
and add 1 import + 1 tuple entry in widgets/registry.ts.

Spec: docs/superpowers/specs/2026-05-02-widget-registry-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Add registry consistency check script

**Files:**
- Create: `web/scripts/check-widget-registry.mjs`
- Modify: `web/package.json`

- [ ] **Step 1: Write `web/scripts/check-widget-registry.mjs`**

```js
#!/usr/bin/env node
/**
 * Lints the widget registry. Catches:
 *  - Duplicate `kind` values
 *  - Missing labelKey i18n entries (referenced labelKey not defined in en/zh JSON)
 *  - fetchData / pollIntervalMs type mismatches
 *
 * Run via:
 *   node --import tsx scripts/check-widget-registry.mjs
 */

import { WIDGET_REGISTRY } from '../src/widgets/registry.ts'
import enWidgets from '../src/i18n/locales/en/widgets.json' assert { type: 'json' }
import zhWidgets from '../src/i18n/locales/zh/widgets.json' assert { type: 'json' }

let failed = 0

// 1. Duplicate kind detection
const seen = new Map()
for (const w of WIDGET_REGISTRY) {
    if (seen.has(w.kind)) {
        console.error(`✗ duplicate kind '${w.kind}'`)
        failed++
    }
    seen.set(w.kind, w)
}

// 2. labelKey resolution. labelKey is `widgets:<key>`, look up <key> in
// both en/widgets.json and zh/widgets.json.
function lookupKey(json, dottedKey) {
    return dottedKey.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), json)
}

for (const w of WIDGET_REGISTRY) {
    if (!w.labelKey.startsWith('widgets:')) {
        console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' must start with 'widgets:'`)
        failed++
        continue
    }
    const innerKey = w.labelKey.slice('widgets:'.length)
    if (!lookupKey(enWidgets, innerKey)) {
        console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' missing from en/widgets.json`)
        failed++
    }
    if (!lookupKey(zhWidgets, innerKey)) {
        console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' missing from zh/widgets.json`)
        failed++
    }
}

// 3. pollIntervalMs type sanity
for (const w of WIDGET_REGISTRY) {
    if (w.pollIntervalMs == null) continue
    if (!w.fetchData) {
        console.error(`✗ ${w.kind}: pollIntervalMs set but no fetchData — invalid combination`)
        failed++
        continue
    }
    if (typeof w.pollIntervalMs !== 'number' && typeof w.pollIntervalMs !== 'function') {
        console.error(`✗ ${w.kind}: pollIntervalMs must be number | function | undefined`)
        failed++
    }
}

if (failed > 0) {
    console.error(`\n${failed} registry issue(s) found`)
    process.exit(1)
}
console.log(`✓ widget registry OK (${WIDGET_REGISTRY.length} widgets)`)
```

- [ ] **Step 2: Add `check:widgets` script to `web/package.json`**

In `web/package.json` `scripts` block, add (after `lint:i18n`):

```json
        "check:widgets": "node --import tsx scripts/check-widget-registry.mjs",
```

- [ ] **Step 3: Run the script**

```
cd web && npm run check:widgets
```

Expected output:

```
✓ widget registry OK (9 widgets)
```

If the script fails (e.g., `tsx` can't import `.ts` from a `.mjs`, or `assert { type: 'json' }` syntax issue on the Node version), simplify the script to read the JSON files via `fs.readFileSync` + `JSON.parse` instead of import assertions. The intent is a smoke check, not a polished tool — keep it minimal.

- [ ] **Step 4: Commit**

```
git add web/scripts/check-widget-registry.mjs web/package.json
git commit -m "$(cat <<'EOF'
chore(widgets): add check-widget-registry consistency lint

Verifies kind uniqueness, labelKey i18n parity (both en/zh), and
fetchData/pollIntervalMs type sanity. Mirrors the existing
check-i18n-parity.mjs pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

After Task 19, the registry refactor is done. Confirm overall state:

- [ ] **Line count check**

```
cd web && wc -l src/hooks/useWidgets.ts src/components/layout/GroupBlock.tsx src/contexts/WidgetDataContext.tsx
```

Expected (each within ±15%):
- `useWidgets.ts`: ≈ 250 (was 536)
- `GroupBlock.tsx`: ≈ 360 (was 531)
- `WidgetDataContext.tsx`: ≈ 50 (was 44)

- [ ] **Field count check**

```
grep -E "(Record|Map)<string" src/contexts/WidgetDataContext.tsx
```

Should reveal exactly **1 Map** in the Context value (`byId`), no Records.

- [ ] **Full build clean**

```
npm run build && npm run check:widgets && npm run lint && npm run lint:i18n
```

All four should exit 0.

- [ ] **Manual smoke (full widget grid)**

Boot frontend + backend; in the dashboard, confirm every widget renders normally and that:
- Adding a new widget via the UI works
- Editing a widget's config saves correctly
- Removing a widget cleans up properly
- Browser console shows no errors after 5 minutes of idle (verifies polling works)

If everything passes, the C2 refactor is complete. Update `tasks/todo.md` to mark C2 done, and update `tasks/lessons.md` if any non-obvious gotchas were captured during the migration.
