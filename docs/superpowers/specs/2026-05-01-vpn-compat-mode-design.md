# VPN 兼容模式 — 设计稿

**日期**: 2026-05-01
**作者**: Claude (with cailurus)
**关联 commit**: 上一轮 `627e65c` 后续

## 背景

后端 `/api/apps/status` 用 Go `net.Dial` 探测每个 app 的可达性。当 Hearth 跑在装了 VPN 的 macOS / Linux 上,VPN 客户端通常会把默认路由抢走、声明 `utun*` 为 primary interface,然后即使 LAN 子网有更具体的路由(`192.168.2.0/24` 走 en1),Go 的 socket 仍会报 `EHOSTUNREACH`。同一台机器的 curl 和浏览器照常连得上 LAN。

上一轮 commit `627e65c` 已经把 `EHOSTUNREACH` / `ENETUNREACH` / DNS 错误从"down"降级为"unknown"(灰点),不再误报红点。但灰点对用户来说仍然不是绿点 —— 用户的浏览器明明能直连,Hearth 却显示"未知"。

## 目标

提供"VPN 兼容模式"开关:用户开启后,**私网目标的探测交给浏览器执行**,公网仍走后端。让在 VPN 后部署 Hearth 的用户拿到正确的绿点。

## 不做(YAGNI)

- 不做 per-app 覆盖。全局开关足够覆盖 95% 场景
- 不做服务端 hint —— 后端不知道用户当前 VPN 状态,且能感知也没必要,前端能完全自决
- 不做 LAN 自动检测。隐式行为令人困惑,显式开关更清晰
- 不做"声明哪些是私网域名"的用户配置。私网识别只看字面 IP 与 `.local` / `.lan` 后缀;DNS 域名指向私网 IP 的边缘情况(例 `nas.example.com → 192.168.x.x`)用户用 IP 直访或保持 VPN 模式关闭

## 用户契约

- **入口**:dashboard 右下角浮动小图标按钮(`fixed bottom-4 right-4`)
- **状态**:开关二态,持久化 `localStorage.hearth_vpn_compat`(默认 `"0"` 关闭)
- **关闭态**:所有探测走后端(当前行为不变)
- **开启态**:对私网目标用浏览器 ping,公网仍后端
- **icon**:lucide `Shield` (off) / `ShieldCheck` (on),配合颜色变化暗示状态
- **i18n**:`vpnCompatMode` / tooltip 中英文都加

## 私网识别(前端)

浏览器不能做 DNS,所以只识别字面量。识别规则尽量与后端 `internal/icon/resolver.go` 的 `isPrivateHost` 一致:

```ts
function isPrivateHost(host: string): boolean {
    if (host === 'localhost') return true
    if (host.endsWith('.local') || host.endsWith('.lan')) return true
    // IPv4 字面量
    const v4 = parseIPv4(host)
    if (v4) {
        return inCIDR(v4, '10.0.0.0/8')
            || inCIDR(v4, '172.16.0.0/12')
            || inCIDR(v4, '192.168.0.0/16')
            || inCIDR(v4, '127.0.0.0/8')
            || inCIDR(v4, '169.254.0.0/16')
    }
    // IPv6 字面量(带方括号或不带)
    const v6 = parseIPv6(host)
    if (v6) {
        return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
    }
    return false
}
```

## 探测机制

- `fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ... })`
- `AbortController` + 5 秒超时
- **判定**:fetch 不抛错(任意 status,任意 CORS 失败被吞)→ `up`;超时 / `TypeError`(网络层断)→ `down`
- 没有 `slow` 细分(no-cors 看不到 latency 之外的细节,且这是用户接受的妥协)
- **频率**:与现有 `useAppStatus` 共用 60 秒 interval。开启 VPN 模式时,合并器在每个 tick 触发两路并发(后端 + 浏览器)
- **并发**:浏览器侧用 `Promise.all` 一并发,无信号量,因为浏览器自带 6 并发 / origin 限制

## 状态合并

`useAppStatus` 当前接口返回 `{ statusMap: Record<id, AppStatusItem> }`。新行为:

1. 取后端 `/api/apps/status` 结果(`backendMap`)
2. 若 VPN 模式关:`statusMap = backendMap`,完事
3. 若 VPN 模式开:
   - 对每个 app,若 URL 的 host 是私网(由 `isPrivateHost` 判断)→ 浏览器探测,结果覆盖
   - 否则用 `backendMap[id]`
4. 浏览器探测的失败模式(timeout / TypeError)→ status `down`;成功 → status `up`,statusCode 留 0,latencyMs 实测

## Hook 接口变化

`useAppStatus` 当前签名:

```ts
useAppStatus(enabled: boolean, intervalMs?: number): { statusMap }
```

新签名(为了拿到 url 做浏览器探测):

```ts
useAppStatus(apps: AppItem[], options?: {
    vpnMode?: boolean
    intervalMs?: number
    enabled?: boolean
}): { statusMap }
```

调用方 HomePage 已经有 `apps`、`useVpnMode()` 的 `enabled`,把它们传进去即可。

`useVpnMode` 接口:

```ts
useVpnMode(): { enabled: boolean; toggle: () => void }
```

实现:`useState` 初值从 `localStorage.hearth_vpn_compat` 取;`toggle` 翻转并持久化。`useSyncExternalStore` 优先,但 `useState` 也可以。

`useBrowserProbe` 内部辅助,导出一个 async 函数:

```ts
async function browserProbe(url: string, timeoutMs: number): Promise<'up' | 'down'>
```

不是 hook,纯函数,被 `useAppStatus` 在 vpn 模式下调用。

## UI(右下角浮动按钮)

```tsx
<button
    onClick={toggle}
    className={`fixed bottom-4 right-4 z-30 rounded-full p-2 backdrop-blur transition-colors
        ${enabled
            ? 'border border-blue-400/60 bg-blue-400/10 text-blue-300'
            : 'border border-white/20 bg-black/40 text-white/40 hover:text-white/70'}`}
    title={t(enabled ? 'vpnModeOn' : 'vpnModeOff')}
    aria-label={t('vpnMode')}
    aria-pressed={enabled}
>
    {enabled ? <ShieldCheck className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
</button>
```

按钮位置故意低调,不抢主内容区。视觉态色变足够暗示开关状态。

## 失败降级

- 浏览器 `fetch` 抛 `TypeError` (DNS 失败 / 网络断 / mixed content) → `down`
- 浏览器 fetch 抛 `AbortError` (超时) → `down`
- 浏览器 fetch 不抛(包括返回 4xx/5xx) → `up`(因为我们看不到状态码,有响应即"活着")
- VPN 模式开但用户当前没在 VPN(忘了关) → 浏览器照样能 ping 私网 IP(因为用户本机就在 LAN),无害,显示正常
- 私网 IP 但浏览器也连不上(子网不同 / 服务真挂了) → 红点,正确

## 影响面 & 风险

- **零后端改动**,只改前端
- 浏览器控制台可能出 CORS 相关警告(no-cors 模式下偶尔会有 `net::ERR_*` 提示),无功能影响,但用户可能看到几条"红色"会担心。可选改进:在 fetch 调用处用 try/catch 静默,但 fetch 本身不会写 console error,浏览器底层的网络层警告无法抑制
- localStorage 用一个键(`hearth_vpn_compat`),5KB 配额绰绰有余
- 现有 `statusMap` shape 不变,GroupBlock / BookmarkGroup 不需改
- 若用户开了 VPN 模式但本机也访问不了 LAN(罕见,例如 VPN-only-default 模式),所有私网 app 都会变红 —— 用户能从 dashboard 上立刻发现 VPN 模式没帮上,可以关掉

## 文件改动

| 路径 | 类型 | 内容 |
|---|---|---|
| `web/src/hooks/useVpnMode.ts` | 新增 | localStorage 状态 hook,返回 `{ enabled, toggle }` |
| `web/src/hooks/useBrowserProbe.ts` | 新增 | 浏览器侧 fetch 探测器 + 私网识别 |
| `web/src/hooks/useAppStatus.ts` | 修改 | 接入 vpn mode + browserProbe,合并两路 statusMap |
| `web/src/components/layout/VpnModeToggle.tsx` | 新增 | 右下角浮动按钮组件 |
| `web/src/pages/HomePage.tsx` | 修改 | 渲染 `<VpnModeToggle />`,把 `useVpnMode()` 状态传给 `useAppStatus` |
| `web/src/i18n/locales/en/common.json` + zh | 修改 | `vpnCompatMode`、`vpnModeOn`、`vpnModeOff`、tooltip 等 |
| `web/src/utils/network.ts` | 新增 | `isPrivateHost` 辅助函数 + IPv4/IPv6 CIDR 检查 |

## 测试 / 验证

后端零改动,无新单测。前端目前没单测基础设施,验证靠手动:

1. 关闭 VPN 模式 → 状态行为与现状一致(后端"unknown"显灰、"down"显红、"up"显绿)
2. 开启 VPN 模式,在带 VPN 的 Mac 上访问:
   - fnOS `http://192.168.2.125:5666/` → **绿点**(从灰修成绿)
   - github.com 应用 → 后端探测,绿点
3. 关闭后再开启,刷新页面,持久化生效
4. iPhone 上(无 VPN)开启模式 → 私网 app 浏览器能 ping 通,正确显示绿点;关闭模式 → 后端探测,后端探不到时显灰

## 后续可能的扩展(不在本次范围)

- per-app 覆盖(右键 app 加"用浏览器 ping"开关)
- 自动检测(用户首次访问 dashboard 时检查是否 LAN 都返回 "unknown",弹一次"是否在 VPN 后?"提示)
- 浏览器探测取消并发(若 app 数量很多,分批探测避免 6 个 origin 排队)
