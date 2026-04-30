# Hearth Code Fix - Progress Tracker

## Phase 1: Backend Security Baseline
- [x] 1.1 CORS configuration fix (server.go) - env var HEARTH_CORS_ORIGINS
- [x] 1.2 SSRF protection - Icon Resolver (resolver.go) - proper CIDR checks + URL validation
- [x] 1.3 Remove TLS auto-downgrade (resolver.go) - HEARTH_ICON_INSECURE_TLS env var
- [x] 1.4 Session Cookie Secure flag (handlers_auth.go) - HEARTH_COOKIE_SECURE env var
- [x] 1.5 Cookie expiry align with session TTL (handlers_auth.go) - uses auth.SessionTTL()
- [x] 1.6 Admin reset confirmation (handlers_admin.go) - requires {"confirm": true}

## Phase 2: Backend Resource Management
- [x] 2.1 SQLite connection pool fix (server.go) - MaxOpenConns(1) + busy_timeout
- [x] 2.2 Settings save error handling (handlers_settings.go) - collects errors
- [x] 2.3 Request body size limits (multiple handlers) - MaxBytesReader 1MB
- [x] 2.4 Database close handling (main.go + server.go) - srv.Close() on shutdown
- [x] 2.5 Expired session cleanup (auth.go) - hourly background goroutine
- [x] 2.7 Weather cache data race fix (weather_openmeteo.go) - copy before unlock

## Phase 3: Backend Low/Medium Priority
- [x] 3.1 Background error message sanitization (handlers_background.go)
- [x] 3.2 Lucide handler fixes (handlers_lucide.go) - strconv.Atoi, proper error, LimitReader
- [x] 3.5 Export rows.Err() check + dead code cleanup (backup.go)
- [x] 3.6 Dead code cleanup (server.go) - removed `var _ = strings.Builder{}`
- [x] 3.7 loginAttemps typo fix (auth.go) - renamed to loginAttempts

## Phase 4: Frontend Security
- [x] 4.1 SVG injection prevention (AppIcon.tsx, IconPicker.tsx) - sanitizeSvg + CDN version pinned
- [x] 4.2 IconPicker LucideIconPreview mounted flag (IconPicker.tsx)

## Phase 5: Frontend Error Boundary
- [x] 5.1 ErrorBoundary component (App.tsx)

## Phase 6: Frontend Resource Leaks
- [x] 6.1 useVideoBackground Object URL leak fix
- [x] 6.2 useDragSort dropTargetId dependency fix
- [x] 6.3 DEFAULT_MARKET_SYMBOLS moved to module level (HomePage.tsx)
- [x] 6.4 SVG cache size limit (AppIcon.tsx, IconPicker.tsx) - max 200 entries

## Phase 7: Frontend Code Cleanup
- [x] 7.3 normalizeCountryCodes dedup (useWidgets.ts, HolidayCountryTags.tsx → helpers.ts)
- [x] 7.3 WeatherGlyph/weatherKind/weatherCodeLabel dedup (WeatherWidget.tsx → standalone)
- [x] 7.3 MarketLogo/MiniSparkline/prettifyCompanyName dedup (MarketsWidget.tsx → standalone)
- [x] 7.4 Type dedup (widgetConfig.ts → imports from types/ui.ts)

## Phase 8: Frontend Medium/Low Priority
- [x] 8.2 MetricsWidget t function stability (lang in deps instead of t)
- [x] 8.3 useBackgroundRefresh timeout cleanup
- [x] 8.4 ComboBox scroll/resize repositioning

## Verification
- [x] `go build ./...` — backend compiles
- [x] `go test ./...` — backend tests pass
- [x] `cd web && npm run build` — frontend builds successfully

---

# Round 2 评审 — 待选清单 (2026-05-01)

> 复审已包含 Phase 1–8 的修复成果，本清单只列**新发现**或**修复未到位**的项。
> 操作方式：把要做的项 `[ ]` 改成 `[x]`，然后告诉我「做 A1、A4、F2」之类，我即按勾选项实施。
>
> **Severity**:🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ⚪ Nit
> **Effort**: `XS` <1h · `S` <4h · `M` 0.5–2d · `L` 3–7d · `XL` >1w
> **ROI**(仅 F 段):🔥 强烈推荐 · 🟠 高 · 🟡 中

---

## A. 立即修复 (安全/正确性 — 优先级最高)

- [x] **A1** 🔴 Critical · `S` · 后端
  - 位置:`internal/auth/auth.go:127,134,136`
  - 问题:首次启动硬编码生成 `admin/admin` 用户,并 `slog.Info("created default admin user", "username", "admin")` 把"默认账号可用"写进日志;首次登录无强制改密。
  - 建议:启动时若 `HEARTH_INITIAL_PASSWORD` 未设,则生成 16 字符随机密码写到 `data/initial-admin.txt` (mode 0600) 并打印路径;在 `users` 表加 `must_change_password` 字段,首次登录强制走改密流程。
  - 影响:决定该项目能否在公网/家庭网关后安心运行。

- [x] **A2** 🔴 Critical · `XS` · 后端
  - 位置:`internal/server/server.go:138-141`
  - 问题:`HEARTH_CORS_ORIGINS` 未设时默认 `AllowedOrigins = ["*"]`,配合 `AllowCredentials=true` (`server.go:129`) — 浏览器规范虽会忽略 `*+credentials` 组合,但仍属危险姿势,且任何反代/中间件改写都可能让 Origin 反射进来。
  - 建议:默认改成空切片(同源)或仅 `http://localhost:5173,http://127.0.0.1:5173` (dev 用);生产强制要求显式配置。
  - 影响:防止跨站偷 cookie。

- [x] **A3** 🟠 High · `S` · 后端
  - 位置:`internal/icon/resolver.go:47-52, 335-336, 568-569`
  - 问题:Phase 1.3 改成"TLS 失败时自动降级到 InsecureClient",虽然比无条件 insecure 好,但仍意味着任何 MITM 都能用"故意触发 TLS 错误"诱导降级,然后投毒 icon (icon 会落盘到 `/data/icons/*` 给前端加载)。
  - 建议:把"自动降级"改成"显式白名单":仅当目标 IP 是私有网段 (10/8、172.16/12、192.168/16、127/8) 时允许 InsecureClient 重试,其他一律失败。
  - 影响:堵住经由 icon 缓存的 XSS/钓鱼向量。

- [x] **A4** 🟠 High · `S` · 后端
  - 位置:`internal/server/handlers_docker.go:14-31`、`internal/server/server.go:221`
  - 问题:`requireAdmin` 已在路由层挂上(✅),但 `start/stop/restart` 没有审计日志,且无容器白名单 — admin token 被偷或反向代理鉴权失误时,任意容器都会被操作。
  - 建议:(a) 落审计表 `audit_log(time, user, action, container_id, container_name, ip)`;(b) 加可选环境变量 `HEARTH_DOCKER_ALLOW_PATTERNS=^app-.*$` 限制可操作的容器名正则。
  - 影响:故障/被入侵时能溯源、降低爆炸半径。

- [x] **A5** 🟠 High · `M` · 后端
  - 位置:`internal/auth/auth.go:140-145` 附近
  - 问题:登录限流仅 in-memory map,容器重启即失效 — 攻击者用 `docker restart hearth` 之类即可绕过(虽然他得有权限,但 K8s 自动重启场景下是真问题)。
  - 建议:落 SQLite,字段 `(ip, username, attempt_at)`,启动时 GC 旧记录;同时建议把限流维度从"IP"扩展到"username + IP"。
  - 影响:防爆破真正生效。

- [x] **A6** 🟠 High · `M` · 后端
  - 位置:`internal/background/service.go:50,62-101`
  - 问题:Bing/Unsplash/Picsum 抓取失败时直接抛错给前端,无"上次成功结果"兜底 — 外网抖动 = 用户屏幕变白,体验不可接受。
  - 建议:落一份"最后一次成功"的图源元数据 + 文件,失败时返回过期版本并触发后台静默重试;UA 改成完整 Chrome UA(部分 CDN 拒绝 `Hearth/0.1`)。
  - 影响:24/7 仪表盘的核心可用性。

- [x] **A7** 🟡 Medium · `S` · 后端
  - 位置:`internal/server/handlers_*.go` 多处 `log.Printf` 与 `auth.go` 的 `slog` 混用
  - 问题:生产无法按级别过滤、无法接 Loki/ELK,登录成功/失败、Docker action、外部 API 错误的日志格式各异。
  - 建议:全局只用 `slog`;login/logout/Docker action 必带 `remote_addr` 字段;`handlers_background.go` 的 debug 信息改 `slog.Debug` 而非默认 INFO。
  - 影响:可观测性。

---

## B. 后端非紧急

- [x] **B1** 🟡 · `XS` · `internal/server/server.go:124`
  - 全局 `Timeout(30s)` 对图源抓取太短、对普通 API 又太长。改为按路由组分级:外网代理 20s、其他 5s。

- [x] **B2** 🟡 · `S` · `internal/store/store.go:102-114`
  - schema evolve 用 `strings.Contains(err.Error(), "duplicate")` 判断列存在,不同 SQLite 版本错误文本可能漂移。改 `PRAGMA table_info(...)` 显式查列。

- [x] **B3** 🟡 · `S` · `internal/server/handlers_weather.go:23-26` 等
  - 转发外部 API 时 `lang`/`country` 等参数直接拼接,未白名单。加 `^[a-z]{2}(-[A-Z]{2})?$` 之类正则校验。

- [x] **B4** ⚪ · `XS` · `internal/store/store.go:67`
  - `MaxOpenConns(1)` 是 SQLite WAL 必须,但无注释。一行注释 + 链接 SQLite 文档,防止三个月后被 PR 改坏。

---

## C. 前端架构 (重构,不紧急但越拖越贵)

- [x] **C1** 🟠 · `L` · `web/src/pages/HomePage.tsx`(~640 行)、`web/src/hooks/useWidgets.ts`
  - HomePage 充当"全局数据总线",把 weather/markets/docker/rss/currency/deals 等 ~20 个数据对象 props 钻透到 `GroupBlock`(props 接口约 59 个字段)。任何 widget 数据变化都会重渲染整棵树。
  - 拆出 `WidgetDataContext`(或 Zustand 单 store),按 widget id 切片;`GroupBlock` 用 `React.memo`。

- [x] **C2** 🟠 · `L` · `web/src/components/layout/GroupBlock.tsx:203-520`
  - widget 渲染是 if-else 长链 + 配置散在 `JSON.parse(a.description)`;新增 widget 要改 HomePage / GroupBlock / 类型定义三处。
  - 引入 `WidgetRegistry: Map<WidgetType, { Component, defaultConfig, gridSize, fetchData, configSchema }>`,HomePage 只迭代 widget id。
  - **这是 F4 (第三方插件协议) 的前置依赖**。

- [x] **C3** 🟡 · `M` · `web/src/hooks/useDashboard.ts:160-209`
  - 任何修改后 `reload()` 全量刷 5 个并行请求;操作密集时浪费严重。
  - 改乐观更新(本地先动 state,失败 rollback)。

- [x] **C4** 🟡 · `M` · 全前端
  - 缺 `React.memo` / `useMemo` 稳定引用,`useGroupDragSort` 返回的 callback 每次重建。配合 C1 一起做。

---

## D. 前端依赖与产物

- [x] **D1** 🟢 · `XS` · `web/src/utils/markets.ts:5-6`
  - 用了 `react-icons` 4 个图标(FaApple/FaMicrosoft/FaBitcoin/FaEthereum),与 `lucide-react` 共存浪费 bundle。换成 lucide 对应或本地 SVG,然后从 `package.json` 删 `react-icons`。

- [x] **D2** 🟡 · `S` · `web/vite.config.ts` + 全前端 lucide 引用
  - lucide-react 当前是命名导入,但仍可能拉全;验证 tree-shake 是否生效,必要时改 `lucide-react/icons/cog` 子路径。

- [x] **D3** 🟡 · `M` · `pinyin-pro` (~3MB)
  - 仅用于 Quick Launch 中文匹配。换 `tiny-pinyin` 或 `pinyin-pro/data` 子路径(只载常用字),首字母搜索 + 全拼搜索两套即可,体积可压到 <200KB。

- [x] **D4** 🟢 · `S` · 全 Modal/卡片
  - `backdrop-blur-md/xl` 在低端 Android 5–7 卡顿。加 `@supports (backdrop-filter: blur(1px))` 包裹,fallback 用纯色半透明。

---

## E. UX / 可访问性 / 设计

- [x] **E1** 🟡 · `S` · `web/src/components/layout/QuickLaunch.tsx`
  - 搜索框无 `role="combobox"` / `aria-expanded` / `aria-activedescendant`;Cmd+K 之外无视觉入口(读屏用户/桌面新手发现不了)。补 ARIA;title 栏放一个 `⌘K` 提示按钮。

- [x] **E2** 🟡 · `S` · `web/src/components/ui/Modal.tsx`
  - 弹窗无 focus trap,Esc 关闭后焦点不恢复。手动管理或用 `focus-trap-react`。

- [x] **E3** 🟢 · `XS` · 粒子彩蛋 + 玻璃态背景模糊
  - 未检测 `prefers-reduced-motion`。一个 hook + 在 `SnowEffect/RainEffect/...` 顶部短路。

- [x] **E4** 🟡 · `M` · 各 widget
  - widget API 失败时被全局 error 文本盖住,无局部重试。每个 widget 包独立 ErrorBoundary + "重试"按钮。

- [x] **E5** 🟡 · `M` · `web/tailwind.config.js` + 全样式
  - README 列了"深浅主题"但代码看上去只有深色,配色硬编码在 className 里。启用 `darkMode: 'class'`,核心色板移到 CSS 变量 — 现在做最便宜。

- [x] **E6** 🟢 · `XS` · `web/src/i18n/`
  - 中英 key 数量虽一致但无 CI 校验。加 `i18next-parser` 或简单 diff 脚本进 lint。

- [x] **E7** 🟢 · `S` · `web/index.html`、`HomePage.tsx`、`QuickLaunch.tsx`
  - 缺 iOS Safari 安全区(`env(safe-area-inset-*)`);Quick Launch `mt-[15vh]` 会被软键盘遮挡。安全区一行 CSS,Quick Launch 改居中。

- [x] **E8** 🟢 · `S` · 动态背景 + 卡片
  - Bing/视频背景下文字对比度不稳。加自适应 `bg-black/30` 或基于背景平均亮度切换文字色,确保 WCAG AA。

---

## F. 新功能 (按 ROI 排序,做之前先看 A 段是否清完)

- [x] **F1** 🔥 · `M` · 首次启动引导
  - 5 步:改密码 → 选语言 → 选背景源 → 加第一个 app → 启用一个 widget。
  - **ROI 论证**:这是"留存第一道墙"。当前 admin/admin 登录 → 空 dashboard → 用户流失。比所有功能都更影响 GitHub stars 转化。
  - 配合 A1 一起做最自然。

- [x] **F2** 🔥 · `M-L` · Docker labels 服务发现
  - 解析容器 label `hearth.group/name/icon/href/description`,自动注册为 app(可选刷新策略:启动时一次 + 每 5 分钟轮询)。
  - **ROI 论证**:这是 selfhost 圈"够不够格"的隐形门槛。homepage/flame/homarr 都有,Hearth 没就被默认归为"个人玩具"。复用现有 docker client,工作量集中在 label schema + UI 标记"自动发现"。
  - 抄 homepage 的 schema(`homepage.group/name/...`),允许同时识别两种 label,迁移成本 = 0。

- [x] **F3** 🔥 · `L` · 5-8 个深度 widget
  - 候选(优先级):Jellyfin → Plex → Sonarr → Radarr → qBittorrent → AdGuard Home → Pi-hole → Proxmox。
  - **ROI 论证**:不是堆功能,是堆"关键词"。selfhost 用户搜 "Jellyfin dashboard" 时 Hearth 必须出现。每个 widget = 一组长尾流量。
  - 依赖 C2 widget registry(否则会让 GroupBlock 更难维护)。

- [x] **F4** 🟠 · `XL` · 第三方 widget 协议 + community-widgets 仓库
  - 定义 `WidgetManifest` JSON(类型、配置 schema、数据源 URL、UI 模板或 iframe),开 `hearth-community-widgets` 仓库收 PR。
  - **ROI 论证**:glance 用 community-widgets 把维护负担转给社区,Hearth 长期想活下去必须走这条路。但这是 **C2 的衍生品**,先做 C2。

- [x] **F5** 🟡 · `M` · OIDC / Forward-Auth 头部认证
  - 不做完整多用户(让 homarr 占),只做"信任反代头":`X-Remote-User` 或 OIDC ID token。
  - **ROI 论证**:重度 homelab 用户已有 Authelia/Authentik,他们厌恶"再登一次"。这是覆盖团队场景的最低成本路径。

- [x] **F6** 🟢 · `S` · 季节自动主题 + 彩蛋发现性
  - 根据日期/节气自动切换玻璃态色调;在设置页加"彩蛋"开关或 `?fun=1` URL 参数。
  - **ROI 论证**:是 Hearth 区别于 glance/homepage 的"温度"差异化点,但不发现的功能 = 不存在的功能。低成本、高情绪价值。

- [x] **F7** 🟢 · `M` · K8s ingress 注解发现
  - 同 F2 的姐妹篇,但优先级低 — Hearth 受众主要是 NAS/单机,不是 K8s 用户。F2 完成后再考虑。

---

## G. 项目运营 (非代码,但 ROI 极高)

- [ ] **G1** 🔥 · 首发 Reddit /r/selfhosted (做完 A 段 + F1/F2 之后)
  - 标题方向:"Hearth — a self-hosted dashboard with first-class Chinese pinyin search and NAS support"。截图必须有玻璃态 UI + Cmd+K 演示动图。

- [ ] **G2** 🔥 · B 站 NAS 区视频 (飞牛 OS / 群晖 / 极空间分别 1 个)
  - 中文 NAS 用户对英文 dashboard 接受度低,这块是 Hearth 真正的蓝海。

- [ ] **G3** 🟡 · 群晖中文社区 / 飞牛社区帖子
  - 配合 G2 的 SEO 长尾。

- [x] **G4** 🟡 · README 加 "Comparison" 表格
  - 对比 homepage/glance/homarr 的差异化点(不要写"Hearth is better",写"Hearth is for X")。

---

## 决策建议(我的优先级)

如果时间有限,顺序如下:

1. **本周必做**:A1 + A2 + F1 (默认密码 + CORS + onboarding)— 决定项目能否公开推广。
2. **2-4 周**:A3-A7 + F2 (剩余安全 + Docker 服务发现)— 进入 selfhost 主流梯队。
3. **1-2 个月**:C1+C2 → F3 (前端架构重构 + 深度 widget)— 长期增长地基。
4. **2-3 个月**:F4 + G1/G2 (插件协议 + 首发推广)— 引爆社区。

**不建议碰**:F7 (K8s 偏离定位)、完整多用户系统 (homarr 已占)、再加纯监控仪表盘 (grafana 已占)。

---

## 实施日志

### Batch 1 — 2026-05-01

完成项:**A1 · A2 · F1 · G4**。`go build ./...` / `go test ./...` / `cd web && npm run build` 全部通过。

- **A1** 首启凭证安全:env 优先 + 随机生成 + 强制改密
  - `internal/auth/auth.go`:`Config` 增 `InitialPassword` / `InitialPasswordFile`;`ensureDefaultAdmin` 重写;新增 `MustChangePassword(userID)`;`generateRandomPassword` 用排除易混字符的字母表(去掉 0/O/1/l/I)。
  - `internal/store/store.go`:`users` 表 best-effort 加 `must_change_password INTEGER NOT NULL DEFAULT 0` 列。
  - `internal/server/middleware.go`:`requireAdmin` 在 must=1 时拒绝除 `/api/auth/password` 外所有路径(403 + `must_change_password`)。
  - `internal/server/handlers_auth.go`:`/api/auth/me` 返回 `mustChangePassword`(显式字段,非 omitempty)。
  - `internal/server/server_test.go`:新增 `TestMustChangePassword`,验证生成密码 → 登录 → 设置写入受阻 → 改密 → 解锁全流程。
  - `internal/server/config.go` + `server.go`:接 `HEARTH_INITIAL_PASSWORD`,`InitialPasswordFile = <DataDir>/initial-admin.txt`。

- **A2** CORS 默认收紧
  - `internal/server/server.go`:未设 `HEARTH_CORS_ORIGINS` 时,默认仅放行 `http://localhost:5173,http://127.0.0.1:5173`(代替之前的 `*`)。
  - 同源生产部署默认即安全;dev 模式开箱即用;非同源生产强制显式配置。

- **F1** Onboarding(分级实施)
  - **F1a 强制改密对话框**(完整完成):`web/src/components/dialogs/ChangePasswordDialog.tsx` — Modal 不可关闭(`onClose` no-op + 隐藏 X),Esc / 背景点击均失效,8 字符最低长度 + 防同密码,成功后 `reload()` 自动关闭。
  - **F1b 欢迎卡片**(精简版):`web/src/components/dialogs/WelcomeDialog.tsx` — 单页,localStorage `hearth_onboarded_v1` 标记一次性,提供「打开设置」「试用 Cmd+K」两个 CTA。
  - **F1c 多步向导**(选语言 → 选背景 → 加 app → 加 widget):**未实现**。原因:这 4 步全部是对现有 SettingsDialog / AddItemDialog 的复述,工程价值低于产品价值。建议作为独立小项重做或干脆并入 SettingsDialog 的「初次提示」气泡。
  - 类型与连线:`useDashboard.ts` / `types/api.ts` 的 `Me` 加 `mustChangePassword?`;`HomePage.tsx` 顶部加 import + welcome state + effect + 渲染。
  - i18n:en/zh `common.json` 各加 11 个键(`firstRunTitle/Hint`、`passwordTooShortStrict/SameAsOld`、`welcome*`)。

- **G4** README 同类对比表
  - `README.md` / `README_CN.md`:在 Configuration 与 Development 之间插入「🔍 Comparison / 同类对比」段;表格对比 Hearth / homepage / glance / homarr;最后一段「怎么选」用「If you ... pick X」语气而非自夸。
  - 顺便同步 A1/A2 的文档:Security 段落改写默认凭证说明,Configuration 表加 `HEARTH_INITIAL_PASSWORD` 与 `HEARTH_CORS_ORIGINS` 行。

### 已知偏离/待跟进
- 前端 build 仍报 `web/src/api/index.ts` 动静混合 import 的 vite 警告 — 这是 Phase 7 重构遗留,非本批引入,可在 D 段处理时一并清理。

### 修订 — 2026-05-01 第二轮
基于用户实测反馈做了两处修订:

1. **A1 改 stdout(不再写文件)**
   - 删除 `<DataDir>/initial-admin.txt` 落盘逻辑
   - `auth.Config` 用 `PasswordOutput io.Writer` 取代 `InitialPasswordFile string`
   - 默认输出到 `os.Stdout`(NAS 用户 `docker logs hearth` 即可看到醒目横幅)
   - `printGeneratedPassword` 用全宽分隔符画横幅,自带"不会再次打印,不会落盘"自我说明
   - 测试 `TestMustChangePassword` 改成 `bytes.Buffer` 捕获 + `extractGeneratedPassword` 正则提取,而非读文件
   - README 同步:`docker logs hearth | head -20` 取代 `docker exec ... cat`
   - 教训写进 `tasks/lessons.md`(NAS / Docker 自托管首启凭证应直接打 stdout,选项也要把"不落盘"摆出来)

2. **F1c 多步向导(完整实现)**
   - 新增 `web/src/components/dialogs/OnboardingWizard.tsx` — 4 步,每步可"跳过"或"保存并继续"
     - Step 1 选语言(zh/en)
     - Step 2 选壁纸来源(default / bing / picsum / default_video)
     - Step 3 添加第一个应用(URL + 名称,后端会自动 resolve icon)
     - Step 4 设置默认天气城市
   - 顶部 1.5rem 渐变进度点显示 1/4 ~ 4/4
   - 关闭(X)、跳过、完成中任一动作均落 `localStorage.hearth_onboarded_v1`,不再弹出
   - 替换原临时的 `WelcomeDialog`(已删除文件 + 移除导出 + 同步 i18n key 替换 `welcome*` → `onboarding*`)

新加入的稳定机制:
- 后端 `auth.Config.PasswordOutput` / `server.Config.PasswordOutput` 提供干净的依赖注入,production 默认 stdout、测试注入 buffer。

### Batch 2a — 2026-05-01

完成项:**A3 · A4 · A5**。`go build ./...` / `go test ./...` 全部通过(含新增 `TestRateLimitPersistence`)。

- **A3** TLS InsecureClient 仅私网降级
  - `internal/icon/resolver.go` 新增 `allowInsecureRetry(rawURL)`,只对 `isPrivateHost`(私网 IP / `localhost` / `.local` / `.lan`)放行 TLS 失败重试
  - 三处自动降级点(`tryManifestIcons`、`fetchHTML`、`downloadIconForPage`)统一接入
  - 公网域名遇 TLS 错误现在直接失败,不再被 MITM 投毒成 icon

- **A4** Docker 操作审计 + 容器白名单
  - 新增 `audit_log` 表(generic schema:user/action/target_type/target_id/target_name/result/error_msg)
  - `internal/store/audit.go` `WriteAudit(AuditEntry)` 方法
  - `internal/docker/client.go` 新增 `ContainerName(ctx, id)` (best-effort 名称解析)
  - `internal/server/handlers_docker.go` 重写:每次 start/stop/restart 写一行 audit;若设置 `HEARTH_DOCKER_ALLOW_PATTERNS`,容器名必须匹配至少一条正则,否则 403 + audit "denied"
  - 启动时 `compileDockerAllowPatterns` 编译正则,语法错误 fail-fast(不能让 typo 静默封锁面板)

- **A5** 登录限流落 SQLite
  - 新增 `login_attempts` 表(`username/remote_ip/attempt_at/blocked_at`)
  - `auth.Service` 移除 in-memory `loginAttempts map` 与 `sync.Mutex`
  - `Login(username, password, remoteIP)` 签名加 `remoteIP`(handler 透传 `r.RemoteAddr`)
  - `checkRateLimit` / `recordFailedLogin` / `clearLoginAttempts` 全部走 DB;`cleanupExpiredLoginAttempts` 删 `attempt_at < now - max(window, blockDuration)`
  - 失败时 fail-open(DB 错误不锁所有人),attempt 写失败仅 slog.Warn
  - 测试 `TestRateLimitPersistence` 显式验证:5 次 wrong → 第 6 次 ErrTooManyAttempts → 重启 Service → 仍然 ErrTooManyAttempts(in-memory 实现做不到)

- README 同步:`HEARTH_DOCKER_ALLOW_PATTERNS` 加入 Configuration 表(en + zh)

### Batch 2b — 2026-05-01

完成项:**A6 · A7 · B1 · B2 · B3 · B4**。`go build ./...` / `go test ./...` / 前端 build 全部通过。

- **B4** SQLite 单连接模式扩展注释:解释 WAL 单写者语义 + 链接 SQLite 文档,防止后续 PR 误改成连接池
- **B2** Schema-evolution helper:`Store.hasColumn(table, column)` 用 `PRAGMA table_info` 查询;`addColumnIfMissing(table, column, def)` 替代 3 处 `strings.Contains(err.Error(), "duplicate")` 字符串匹配
- **B1** 路由超时分级:删全局 `r.Use(middleware.Timeout(30s))`(`context.WithTimeout` 只能缩短不能延长,所以全局短上限会让慢路由卡住)。改成两个 chi.Router.Group:fast=10s(SQLite CRUD、缓存读、Docker socket、metrics history),slow=60s(所有 widgets/* + icon/resolve + background/refresh)
- **B3** 外部 API 参数白名单:新建 `internal/server/validation.go` 提供 `validLang`(`^[a-z]{2}(-[A-Z]{2})?$`)和 `validRegion`(`^[a-z]{2}$`)。weather 三个 handler 的 `lang`、deals `region` 走白名单,非法值返回到 fallback 而非透传给上游
- **A7** 全局 slog 统一:`internal/server/handlers_background.go`(15+ 处)、`handlers_metrics.go`、`handlers_feeds.go`、`internal/widgets/deals.go` 的 `log.Printf` 全部替换为 `slog.Warn/Debug/Info`,且都带结构化字段(provider、source、url、error)。可被 Loki/ELK 按级别过滤
- **A6** 背景图 stale-cache 兜底:重写 `handleGetBackgroundImage`,缓存到期时把过期文件路径记到 `staleFile`,后续 `resolveBackgroundURL`/`FetchToFile` 任一失败即调 `serveStaleOrDefault`(优先 stale,再退到 bundled default)。Bing/Unsplash 抖动时用户看到的是昨天的照片而不是占位图

### 已知偏离/待跟进 (更新)
- 前端 build 仍报 `web/src/api/index.ts` 动静混合 import 警告(未引入,Phase 7 历史)
- B3 只覆盖了最常见的 lang/region 参数。markets `symbols`、currency `pairs`、weather `lat/lon` 等数值/列表参数未做格式校验 — 如果发现真实问题再加

### Batch 3 — 2026-05-01

完成项:**D1 · D4 · E1 · E2 · E3 · E6 · E7 · E8 · F6**(11 项中 9 项,D2/D3 见下)。`npm run build` / `npm run lint:i18n` 通过。

- **D1** 删 `react-icons`:`MarketLogo` 删掉中间那层 `FaApple/FaMicrosoft/FaBitcoin/FaEthereum` fallback,只保留 [缓存图 → 字母圈] 两层。`npm uninstall react-icons` 把依赖也卸了。bundle 主 chunk -2.26 KB gzipped(预期之内,4 个 SVG 图标 tree-shake 之后本来就不大)。
- **D4** `backdrop-filter` `@supports` 兜底:`index.css` 加规则,在不支持 backdrop-filter 的旧 Android WebView / Linux Firefox 上,所有 `.backdrop-blur-*` 元素自动改用 `rgba(0,0,0,0.85)` 不透明背景,保证文字可读。
- **E1** Quick Launch ARIA combobox 模式:input `role=combobox` + `aria-expanded` + `aria-controls` + `aria-autocomplete=list` + `aria-activedescendant`;list 容器 `role=listbox`;每个结果 `role=option` + `aria-selected`。Modal 容器 `role=dialog aria-modal=true`。
- **E2** Modal focus trap:`useRef<HTMLDivElement>` 拿到 panel,挂载时 `requestAnimationFrame` 把焦点移到第一个非"close"按钮的 focusable;`Tab`/`Shift+Tab` 在边界 wrap;关闭时 `setTimeout(0)` 把焦点还给原触发元素。
- **E3** `usePrefersReducedMotion` hook + 5 个 Effect 组件早退 + `index.css` 全局 `@media (prefers-reduced-motion: reduce)` 把 animation/transition duration 压到 0.001ms。神经过敏 / 前庭敏感的用户访问 Hearth 不再头晕。
- **E6** i18n parity CI 脚本:新建 `web/scripts/check-i18n-parity.mjs`,递归对比所有 locale 之间的 namespace key 集合,有 drift 退出码 1 + 详细 diff。`package.json` 加 `lint:i18n` script,首次运行通过(2 语言 × 5 namespace 全 OK)。
- **E7** iOS 安全区:`index.html` viewport meta 加 `viewport-fit=cover`(否则 `env(safe-area-inset-*)` 在 iPhone 上恒为 0);Quick Launch 改 flex 居中 + 顶部 padding `max(12vh, env(safe-area-inset-top) + 1.5rem)`,不再用 `mt-[15vh]`(被软键盘遮挡 / 刘海推下来都有救)。
- **E8** 动态背景对比度蒙层:`bg-black/25` → `bg-gradient-to-b from-black/40 via-black/20 to-black/30`,顶部加深保护无 glass 背景的标题/问候,中部稍亮,底部微暗。WCAG AA 文字对比度兜底。
- **F6** 季节氛围彩蛋:`seasonalEffect()` 按当前月份(北半球)返回对应 effect — 春樱/夏萤/秋星/冬雪。footer © 按钮点击不再随机,固定开当前季节;hover 显示 i18n tooltip "点击切换季节氛围 ✨" / "Click for seasonal atmosphere ✨"。

### 偏离/未做
- **D2** lucide-react tree-shake 验证:**确认不需要做**。实际 build 输出 `lucide-icons-CKQy0cg3.js 12.79 KB → 4.97 KB gzipped`,Vite 已经 tree-shake 到位,Round 2 评审里"全量 1.5MB"是误判。
- **D3** `pinyin-pro` (~138 KB gzipped)替换 / lazy-load:**未做**。是 D 段唯一真正能省体积的项,但要么切 `tiny-pinyin`(损失 `pattern: first` API,需自实现初首字母)、要么 lazy-load(改 useQuickLaunch 同步 → 异步)— 都需要单独决策与验证。建议作为独立小批次(可叫 batch 3.5 / 3a)。
