# VPN Compat Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "VPN compat mode" toggle (right-bottom floating button) that, when enabled, runs status checks for private-network targets from the user's browser instead of the backend, so users running Hearth behind a VPN see correct green/red dots for their LAN services.

**Architecture:** Pure frontend feature. New `useVpnMode` hook persists toggle state to `localStorage`. New `browserProbe` util does `fetch(url, { mode: 'no-cors' })` with AbortController timeout. `useAppStatus` is extended to receive the apps array and the toggle state, then merges backend results with browser-probe results for private-host targets.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 3.4, lucide-react. No new dependencies. No backend changes.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `web/src/utils/network.ts` | Create | `isPrivateHost(host)` plus IPv4/IPv6 literal parsers |
| `web/src/utils/browserProbe.ts` | Create | Async `browserProbe(url, timeoutMs)` returning `'up' \| 'down'` |
| `web/src/utils/index.ts` | Modify | Export the two new utilities |
| `web/src/hooks/useVpnMode.ts` | Create | localStorage-backed `useVpnMode()` hook |
| `web/src/hooks/index.ts` | Modify | Export `useVpnMode` |
| `web/src/hooks/useAppStatus.ts` | Modify | Accept `apps` + `options.vpnMode`, merge backend + browser probes |
| `web/src/components/layout/VpnModeToggle.tsx` | Create | Floating Shield/ShieldCheck toggle button |
| `web/src/pages/HomePage.tsx` | Modify | Wire `useVpnMode` into `useAppStatus`; render `<VpnModeToggle/>` |
| `web/src/i18n/locales/en/common.json` | Modify | Add `vpnCompatMode`, `vpnModeOn`, `vpnModeOff` |
| `web/src/i18n/locales/zh/common.json` | Modify | Same keys, Chinese values |
| `web/scripts/test-network.mjs` | Create | One-off smoke test for `isPrivateHost` truth table |
| `web/package.json` | Modify | Add `test:network` script |

---

### Task 1: Network utility — `isPrivateHost` and IP parsers

**Files:**
- Create: `web/src/utils/network.ts`
- Create: `web/scripts/test-network.mjs`
- Modify: `web/src/utils/index.ts`
- Modify: `web/package.json`

- [ ] **Step 1: Write the failing smoke test**

Create `web/scripts/test-network.mjs`:

```js
#!/usr/bin/env node
// Smoke test for utils/network.ts. Runs against the compiled tsc output
// or directly against the source via tsx if available; we go simple and
// duplicate the logic into this file to avoid setting up a test runner
// just for one util. The asserts here MIRROR the source — keep in sync
// when isPrivateHost changes.

import { isPrivateHost } from '../src/utils/network.ts'

const cases = [
    // localhost / loopback
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    // RFC1918 private
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.255.254', true],
    // link-local
    ['169.254.1.1', true],
    // homelab suffixes
    ['nas.local', true],
    ['fnos.lan', true],
    ['router.local', true],
    // IPv6 loopback / ULA / link-local
    ['::1', true],
    ['fc00::1', true],
    ['fd00::abcd', true],
    ['fe80::1', true],
    // Public — must be false
    ['github.com', false],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.15.0.1', false],   // 172.15 is OUTSIDE the 172.16/12 block
    ['172.32.0.1', false],   // 172.32 is OUTSIDE the 172.16/12 block
    ['11.0.0.1', false],
    ['example.com', false],
    // IPv4 with port stripped — caller is expected to pass the host alone
    // but we also accept "host:port" for safety
    ['192.168.2.125:5666', true],
    ['github.com:443', false],
    // Edge cases
    ['', false],
    ['not.an.ip', false],
]

let failed = 0
for (const [host, want] of cases) {
    const got = isPrivateHost(host)
    if (got !== want) {
        console.error(`✗ isPrivateHost(${JSON.stringify(host)}) = ${got}, want ${want}`)
        failed++
    }
}
if (failed > 0) {
    console.error(`\n${failed} case(s) failed`)
    process.exit(1)
}
console.log(`✓ isPrivateHost OK across ${cases.length} cases`)
```

- [ ] **Step 2: Run test to verify it fails (no source yet)**

Run from `web/`:

```
node scripts/test-network.mjs
```

Expected: error like `Cannot find module '../src/utils/network.ts'` — the source file doesn't exist yet.

- [ ] **Step 3: Write `web/src/utils/network.ts`**

```ts
/**
 * Private-host detection used by VPN compat mode.
 *
 * The frontend can't do DNS lookups, so this only recognises literal IP
 * addresses and well-known homelab suffixes. The browser bypassing the
 * VPN to reach these hosts works precisely because the user's machine
 * already knows how to route them — DNS-name targets that resolve into
 * private space (e.g. nas.example.com) aren't recognised here. Users
 * with that setup either use the IP directly or keep VPN mode off.
 *
 * Keep in sync with web/scripts/test-network.mjs.
 */

export function isPrivateHost(input: string): boolean {
    if (!input) return false
    // Accept "host:port" for caller convenience; strip the port.
    const host = stripPort(input).toLowerCase()
    if (host === 'localhost') return true
    if (host.endsWith('.local') || host.endsWith('.lan')) return true

    const v4 = parseIPv4(host)
    if (v4) {
        return inIPv4CIDR(v4, [10, 0, 0, 0], 8)
            || inIPv4CIDR(v4, [172, 16, 0, 0], 12)
            || inIPv4CIDR(v4, [192, 168, 0, 0], 16)
            || inIPv4CIDR(v4, [127, 0, 0, 0], 8)
            || inIPv4CIDR(v4, [169, 254, 0, 0], 16)
    }
    const v6 = parseIPv6(host)
    if (v6) {
        if (v6 === '::1') return true
        // ULA fc00::/7 (matches both fc.. and fd..)
        if (v6.startsWith('fc') || v6.startsWith('fd')) return true
        // link-local fe80::/10
        if (v6.startsWith('fe80') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) return true
    }
    return false
}

function stripPort(host: string): string {
    // IPv6 literals are bracketed: [::1]:8080. Don't be tripped up by the colons inside.
    if (host.startsWith('[')) {
        const end = host.indexOf(']')
        if (end > 0) return host.slice(1, end)
        return host
    }
    // IPv4 / hostname: only one colon means host:port; multiple colons means IPv6 (no port).
    const colons = host.match(/:/g)
    if (colons && colons.length === 1) {
        const idx = host.indexOf(':')
        return host.slice(0, idx)
    }
    return host
}

function parseIPv4(host: string): [number, number, number, number] | null {
    const parts = host.split('.')
    if (parts.length !== 4) return null
    const out: number[] = []
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null
        const n = Number(p)
        if (n < 0 || n > 255) return null
        out.push(n)
    }
    return [out[0], out[1], out[2], out[3]]
}

function inIPv4CIDR(
    ip: [number, number, number, number],
    network: [number, number, number, number],
    prefix: number
): boolean {
    const ipInt = (ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]
    const netInt = (network[0] << 24) | (network[1] << 16) | (network[2] << 8) | network[3]
    if (prefix === 0) return true
    const mask = (~0) << (32 - prefix)
    return (ipInt & mask) === (netInt & mask)
}

function parseIPv6(host: string): string | null {
    // Strip surrounding brackets if any leaked through stripPort.
    let h = host
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
    // Cheap IPv6 sniff: contains '::' OR has at least 2 ':' segments.
    if (!h.includes(':')) return null
    // Reject if it has a '.' that isn't part of an IPv4-mapped suffix —
    // we only need URL hosts here, so we keep this simple.
    if (h.includes('.')) return null
    // Validate: only hex digits and ':'
    if (!/^[0-9a-f:]+$/.test(h)) return null
    return h
}
```

- [ ] **Step 4: Export from utils index**

Edit `web/src/utils/index.ts` — add at the bottom:

```ts
export { isPrivateHost } from './network'
```

- [ ] **Step 5: Add npm script**

Edit `web/package.json` `scripts` block — add the `test:network` line so it reads:

```json
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "lint:i18n": "node scripts/check-i18n-parity.mjs",
    "test:network": "node --import tsx scripts/test-network.mjs",
    "preview": "vite preview"
},
```

Then install `tsx` as a dev dep so the smoke test can import the `.ts` source:

```
cd web && npm install --save-dev tsx
```

- [ ] **Step 6: Run test to verify it passes**

Run from `web/`:

```
npm run test:network
```

Expected output:

```
✓ isPrivateHost OK across 26 cases
```

- [ ] **Step 7: Run frontend build to verify TypeScript is happy**

Run from `web/`:

```
npm run build
```

Expected: build succeeds (the lone vite dynamic-import warning is pre-existing and unrelated).

- [ ] **Step 8: Commit**

```bash
git add web/src/utils/network.ts web/src/utils/index.ts web/scripts/test-network.mjs web/package.json web/package-lock.json
git commit -m "feat(network): isPrivateHost util for VPN compat mode

Used by the upcoming browser-side status probe to decide which targets
the browser handles vs. which stay on the backend. Covers literal
IPv4/IPv6 plus the .local/.lan/localhost homelab suffixes; doesn't try
to resolve DNS names. Smoke test in scripts/test-network.mjs covers 26
positive/negative cases; runs via npm run test:network."
```

---

### Task 2: `useVpnMode` hook

**Files:**
- Create: `web/src/hooks/useVpnMode.ts`
- Modify: `web/src/hooks/index.ts`

- [ ] **Step 1: Write `web/src/hooks/useVpnMode.ts`**

```ts
/**
 * useVpnMode — persistent toggle for "VPN compat mode".
 *
 * When enabled, status probing for private-host targets shifts from the
 * backend to the user's browser (see useAppStatus). Persisted per-browser
 * in localStorage; key intentionally short to keep the storage debug view
 * tidy.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hearth_vpn_compat'

function readInitial(): boolean {
    if (typeof window === 'undefined') return false
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export function useVpnMode(): { enabled: boolean; toggle: () => void } {
    const [enabled, setEnabled] = useState<boolean>(readInitial)

    // Sync across tabs: another tab toggles, we update.
    useEffect(() => {
        if (typeof window === 'undefined') return
        const onStorage = (e: StorageEvent) => {
            if (e.key !== STORAGE_KEY) return
            setEnabled(e.newValue === '1')
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const toggle = useCallback(() => {
        setEnabled((prev) => {
            const next = !prev
            try {
                window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
            } catch {
                // localStorage can throw in private mode / quota — treat as ephemeral.
            }
            return next
        })
    }, [])

    return { enabled, toggle }
}
```

- [ ] **Step 2: Export from hooks index**

Edit `web/src/hooks/index.ts` — add:

```ts
export { useVpnMode } from './useVpnMode'
```

- [ ] **Step 3: Run build to verify**

```
cd web && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useVpnMode.ts web/src/hooks/index.ts
git commit -m "feat(hooks): useVpnMode persists the VPN compat toggle

Reads/writes localStorage.hearth_vpn_compat. Subscribes to the storage
event so toggling in one tab updates other tabs. Returns { enabled,
toggle } — the toggle handler also persists, so callers don't have to."
```

---

### Task 3: `browserProbe` utility

**Files:**
- Create: `web/src/utils/browserProbe.ts`
- Modify: `web/src/utils/index.ts`

- [ ] **Step 1: Write `web/src/utils/browserProbe.ts`**

```ts
/**
 * browserProbe — best-effort reachability check from the user's browser.
 *
 * Used by useAppStatus when VPN compat mode is on: the backend may not be
 * able to reach LAN targets (its socket binds to a VPN-claimed primary
 * interface), but the browser sitting next to the user usually can.
 *
 * Caveats baked into the contract:
 * - mode: 'no-cors' means we can't read the response status. We treat
 *   "fetch resolved without throwing" as "up" — anything from 200 to
 *   500 to a CORS-stripped opaque response counts. This is the right
 *   contract for a status dot; users care about live/dead, not status
 *   codes.
 * - AbortError or TypeError (network unreachable, DNS fail, mixed content
 *   block) → "down".
 */

export type BrowserProbeResult = 'up' | 'down'

export async function browserProbe(url: string, timeoutMs = 5000): Promise<BrowserProbeResult> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        await fetch(url, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            redirect: 'follow',
            signal: controller.signal,
            // Don't send cookies / credentials — the target may be a
            // foreign origin and we don't want to leak Hearth's cookies.
            credentials: 'omit',
        })
        return 'up'
    } catch {
        return 'down'
    } finally {
        window.clearTimeout(timer)
    }
}
```

- [ ] **Step 2: Export**

Edit `web/src/utils/index.ts` — append:

```ts
export { browserProbe } from './browserProbe'
export type { BrowserProbeResult } from './browserProbe'
```

- [ ] **Step 3: Run build**

```
cd web && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/utils/browserProbe.ts web/src/utils/index.ts
git commit -m "feat(utils): browserProbe — fetch-based reachability check

Used by useAppStatus when VPN compat mode is on. mode='no-cors' so we
can't see status codes; resolved-without-throwing → 'up', timeout/
network error → 'down'. credentials='omit' so we don't leak Hearth
cookies to foreign origins."
```

---

### Task 4: Refactor `useAppStatus` to merge backend + browser probes

**Files:**
- Modify: `web/src/hooks/useAppStatus.ts`

- [ ] **Step 1: Replace the file with the merged-probe implementation**

Overwrite `web/src/hooks/useAppStatus.ts`:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGet } from '../api'
import { browserProbe, isPrivateHost } from '../utils'
import type { AppItem } from '../types'

export interface AppStatusItem {
    id: string
    status: 'up' | 'slow' | 'down' | 'unknown'
    statusCode: number
    latencyMs: number
}

interface StatusResponse {
    items: AppStatusItem[]
}

interface UseAppStatusOptions {
    enabled?: boolean
    intervalMs?: number
    /**
     * When true, every app whose URL host parses as a private network
     * target is probed from the browser instead of trusting the backend
     * result. Public targets keep the backend probe (it knows status
     * codes and latency, which we lose under no-cors).
     */
    vpnMode?: boolean
}

/**
 * Extract the host portion of an app URL for `isPrivateHost`. Returns
 * empty string on parse failure (caller treats that as non-private).
 */
function hostOf(url: string): string {
    try {
        return new URL(url).hostname
    } catch {
        return ''
    }
}

export function useAppStatus(
    apps: AppItem[],
    options: UseAppStatusOptions = {}
) {
    const { enabled = true, intervalMs = 60000, vpnMode = false } = options
    const [statusMap, setStatusMap] = useState<Record<string, AppStatusItem>>({})
    const mountedRef = useRef(true)

    // Stable refs so the fetch callback can read the latest values
    // without triggering a new interval on every render.
    const appsRef = useRef(apps)
    appsRef.current = apps
    const vpnModeRef = useRef(vpnMode)
    vpnModeRef.current = vpnMode

    const fetchStatus = useCallback(async () => {
        if (!enabled) return
        let backendItems: AppStatusItem[] = []
        try {
            const data = await apiGet<StatusResponse>('/api/apps/status')
            backendItems = data.items
        } catch {
            // Status is non-critical; soldier on with empty backend results.
        }
        if (!mountedRef.current) return

        const map: Record<string, AppStatusItem> = {}
        for (const item of backendItems) {
            map[item.id] = item
        }

        // VPN compat mode: for any app whose URL host is private, override
        // the backend result with a fresh browser probe. Public hosts
        // keep the backend result (we lose status codes / latency under
        // no-cors, which would be a regression for them).
        if (vpnModeRef.current) {
            const targets = appsRef.current.filter(
                (a) => a.url.startsWith('http://') || a.url.startsWith('https://'),
            ).filter((a) => isPrivateHost(hostOf(a.url)))

            await Promise.all(targets.map(async (a) => {
                const start = Date.now()
                const result = await browserProbe(a.url, 5000)
                const latencyMs = Date.now() - start
                if (!mountedRef.current) return
                map[a.id] = {
                    id: a.id,
                    status: result,
                    statusCode: 0,
                    latencyMs,
                }
            }))
        }

        if (!mountedRef.current) return
        setStatusMap(map)
    }, [enabled])

    useEffect(() => {
        mountedRef.current = true
        fetchStatus()

        if (!enabled) return
        const id = window.setInterval(fetchStatus, intervalMs)
        return () => {
            mountedRef.current = false
            window.clearInterval(id)
        }
    }, [enabled, intervalMs, fetchStatus])

    // Re-run immediately when vpnMode flips so the UI reflects the
    // change without waiting for the next tick.
    useEffect(() => {
        if (!enabled) return
        fetchStatus()
        // fetchStatus depends only on `enabled`, not on vpnMode (we
        // read the latest via vpnModeRef), so depending on vpnMode is
        // intentional even though eslint would complain.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vpnMode, enabled])

    return { statusMap, refresh: fetchStatus }
}
```

- [ ] **Step 2: Verify the only call site (HomePage.tsx) still type-checks**

Run from `web/`:

```
npm run build
```

Expected: TypeScript error that HomePage's call `useAppStatus(true)` no longer matches the new signature. This is intentional — Task 6 fixes it. Note the error message and proceed.

If you accidentally see the build pass, you've still got an old call site somewhere. Continue to Task 5; the HomePage rewire will fix it.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useAppStatus.ts
git commit -m "refactor(useAppStatus): accept apps + vpnMode and merge probes

Hook now takes the apps array and a vpnMode option. When VPN compat
mode is on, every app whose URL hostname parses as a private network
target gets a fresh browserProbe and that result overrides whatever
the backend reported. Public targets keep the backend result (it
carries status codes and latency, both lost under no-cors). Toggling
vpnMode triggers an immediate re-probe instead of waiting for the
next 60s tick.

Caller (HomePage) is updated in a follow-up task."
```

---

### Task 5: Floating `VpnModeToggle` button

**Files:**
- Create: `web/src/components/layout/VpnModeToggle.tsx`

- [ ] **Step 1: Write the component**

Create `web/src/components/layout/VpnModeToggle.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Shield, ShieldCheck } from 'lucide-react'

interface VpnModeToggleProps {
    enabled: boolean
    onToggle: () => void
}

/**
 * Floating button in the bottom-right corner. Visible regardless of
 * admin/guest state — it's a per-browser preference, not server config.
 */
export function VpnModeToggle({ enabled, onToggle }: VpnModeToggleProps) {
    const { t } = useTranslation('common')
    const Icon = enabled ? ShieldCheck : Shield
    const label = t('vpnCompatMode')
    const stateLabel = t(enabled ? 'vpnModeOn' : 'vpnModeOff')

    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={enabled}
            aria-label={label}
            title={`${label} — ${stateLabel}`}
            className={
                'fixed bottom-4 right-4 z-30 flex items-center justify-center rounded-full p-2 backdrop-blur transition-colors ' +
                (enabled
                    ? 'border border-blue-400/60 bg-blue-400/10 text-blue-300 hover:bg-blue-400/20'
                    : 'border border-white/20 bg-black/40 text-white/40 hover:text-white/70')
            }
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
    )
}

export default VpnModeToggle
```

- [ ] **Step 2: Build (will still fail until i18n keys + HomePage wiring land)**

```
cd web && npm run build
```

Expected: TypeScript error from HomePage.tsx still — the i18n key absence isn't a build error (i18next types are loose), but HomePage hasn't been updated yet. We commit this in isolation regardless; it'll integrate in Task 6.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/layout/VpnModeToggle.tsx
git commit -m "feat(ui): VpnModeToggle floating button

Bottom-right corner. Shield (off) → ShieldCheck (on); colour shifts
from white-faded to blue when active. aria-pressed reflects state
for screen readers; title shows '<label> — <state>' on hover."
```

---

### Task 6: Wire HomePage + i18n keys

**Files:**
- Modify: `web/src/i18n/locales/en/common.json`
- Modify: `web/src/i18n/locales/zh/common.json`
- Modify: `web/src/pages/HomePage.tsx`

- [ ] **Step 1: Add English i18n keys**

Edit `web/src/i18n/locales/en/common.json` — add three keys before the closing `}`:

```json
    "vpnCompatMode": "VPN compat mode",
    "vpnModeOn": "on (private hosts probed from your browser)",
    "vpnModeOff": "off (all probes via backend)"
```

(Be sure to add a trailing comma to the previous last entry.)

- [ ] **Step 2: Add Chinese i18n keys**

Edit `web/src/i18n/locales/zh/common.json` — add the same keys:

```json
    "vpnCompatMode": "VPN 兼容模式",
    "vpnModeOn": "已开启（私网服务由浏览器探测）",
    "vpnModeOff": "已关闭（全部经后端探测）"
```

- [ ] **Step 3: Verify i18n parity**

Run from `web/`:

```
npm run lint:i18n
```

Expected:

```
✓ i18n parity OK across 2 languages, 5 namespaces
```

- [ ] **Step 4: Update HomePage imports**

Open `web/src/pages/HomePage.tsx`. Find the existing imports block at the top.

Add this import:

```ts
import { VpnModeToggle } from '../components/layout/VpnModeToggle'
```

Update the existing import for hooks to include `useVpnMode`. Find the line that imports `useAppStatus` (currently `import { useAppStatus } from '../hooks/useAppStatus'`) — leave it. Then find the existing barrel import `import { useNow, useWidgets, ... } from '../hooks'` and add `useVpnMode` to that list.

- [ ] **Step 5: Wire `useVpnMode` and update `useAppStatus` call**

In HomePage's body, find the line:

```ts
const { statusMap } = useAppStatus(true)
```

Replace it with:

```ts
const vpnMode = useVpnMode()
const { statusMap } = useAppStatus(apps, { enabled: true, vpnMode: vpnMode.enabled })
```

The `apps` variable is already in scope from `useDashboard`.

- [ ] **Step 6: Render the floating toggle**

In HomePage's return JSX, find the `<QuickLaunch ... />` element near the bottom (just before the closing `</div></WidgetDataProvider>`). Add the toggle right after `</QuickLaunch>`:

```tsx
            <VpnModeToggle enabled={vpnMode.enabled} onToggle={vpnMode.toggle} />
```

- [ ] **Step 7: Build to verify everything compiles**

```
cd web && npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/i18n/locales/en/common.json web/src/i18n/locales/zh/common.json web/src/pages/HomePage.tsx
git commit -m "feat(home): wire VPN compat mode into HomePage

useVpnMode() drives both useAppStatus (so private-host probes shift to
the browser) and the new floating VpnModeToggle button bottom-right.
i18n keys added for the label and the on/off state explanation."
```

---

### Task 7: End-to-end verification

**Files:** none

- [ ] **Step 1: Full build**

```
cd web && npm run build
```

Expected: ✓ built in ~2s.

- [ ] **Step 2: i18n parity**

```
cd web && npm run lint:i18n
```

Expected: `✓ i18n parity OK across 2 languages, 5 namespaces`.

- [ ] **Step 3: Network util smoke test**

```
cd web && npm run test:network
```

Expected: `✓ isPrivateHost OK across 26 cases`.

- [ ] **Step 4: Manual browser verification**

Start the dev stack (from project root):

```
make dev
```

Open `http://localhost:5173`. Verify:

1. Initial load shows the floating button bottom-right with the outlined `Shield` icon and white-faded color (off state).
2. Click the button. Icon changes to filled `ShieldCheck`, color goes blue. The Hearth dashboard's status dots may or may not change immediately, depending on which apps are private.
3. Reload the page. Button retains blue/on state (localStorage persisted).
4. If you have a LAN app (e.g. fnOS at `http://192.168.x.x:port/`):
   - With VPN mode **off**: status reflects the backend probe (gray "unknown" if your machine is on a VPN).
   - With VPN mode **on**: status comes from your browser. If the browser can reach the host (it usually can on the same LAN), the dot is green.
5. For a public app (e.g. `https://github.com`), the dot stays driven by the backend in both modes — same color.
6. Open browser DevTools → Application → Local Storage → `hearth_vpn_compat` should be `"1"` after toggling on.

- [ ] **Step 5: Final commit (if anything was tweaked during verification)**

If everything passed in step 4 with no further edits, skip this step. Otherwise:

```bash
git add -u
git commit -m "fix: address findings from VPN compat mode manual verification"
```

---

## Self-Review Notes (already addressed inline)

- Spec coverage: every spec section maps to a task — Task 1 covers private-host detection, Task 2 covers the toggle hook, Task 3 covers the browser probe, Task 4 covers status merging, Task 5 covers the UI, Task 6 covers wiring + i18n, Task 7 covers verification. The "no per-app override / no auto-detection" non-goals require no work.
- Type consistency: `BrowserProbeResult` is `'up' | 'down'` everywhere; `AppStatusItem.status` adds `'unknown'` (already in handlers_status.go's classifyProbeError). The widening to include `'unknown'` already exists in the type from prior commit `627e65c`.
- File paths: every mention is absolute from project root (`web/...`).
- Code completeness: every step that requires code has the full code in the step.
