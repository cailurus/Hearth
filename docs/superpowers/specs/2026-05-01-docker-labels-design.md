# Docker Labels 服务发现 — 设计稿

**日期**: 2026-05-01
**作者**: Claude (with cailurus)
**关联 Round 2 todo 项**: F2

## 背景

Hearth 当前所有 app 链接都靠管理员在 UI 上手动添加。selfhost 圈头部产品(gethomepage/homepage、flame、homarr)都支持读取 docker container labels 自动发现服务——这是这一类产品"够不够格"的隐形门槛。Hearth 不支持时,用户拿 docker-compose 起 Jellyfin/Plex/Sonarr 等服务,还得在 dashboard 里再手动加一遍 URL,门槛与遗忘成本都高。

F2 在容器 `hearth.*` 或 `homepage.*` labels 出现时,自动把对应 app 显示在 dashboard,容器消失时自动撤回。

## 目标

零持久化、零迁移成本接管 docker-compose 的 labels 作为 app 来源:
- 兼容 `homepage.*` schema,直接吸纳现有 homepage 用户
- 用户在 docker-compose 里写一次 labels,Hearth 30 秒内反映
- 容器删除/停止 → app 自动消失,无孤儿数据需要清理
- 与现有手动 app 共存,UI 用小角标视觉区分

## 不做(YAGNI)

- 不做 homepage 的 `widget.*` 集成(Jellyfin 实时统计、Sonarr 队列等)。这是 F3/F4 的事。
- 不做 `weight` 排序字段。容器名字典序够用。
- 不做 healthcheck 端点解析。Hearth 已有的 `/api/apps/status` 探测覆盖足够。
- 不做自动 URL 推断(无 `href` label 时尝试从 exposed ports 拼 URL)。多端口/HTTPS/网络模式坑太深,V1 跳过。
- 不做 docker 事件订阅(`/events` 流)。30s 轮询对"我的容器什么时候出现在 dashboard"场景延迟可接受。
- 不做 K8s ingress 注解(F7 单独项)。

## 用户契约

### Docker-compose 例子

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin
    labels:
      - "hearth.name=Jellyfin"
      - "hearth.group=Media"
      - "hearth.href=http://nas.lan:8096/"
      - "hearth.icon=lucide:film"
      - "hearth.description=Movie & TV server"
```

或者用兼容 schema:

```yaml
    labels:
      - "homepage.name=Jellyfin"
      - "homepage.group=Media"
      - "homepage.href=http://nas.lan:8096/"
```

Hearth 30 秒内自动把 Jellyfin 加入 dashboard 的 "Media" 分组(若用户已经手动建了 Media 组),否则进虚拟 "Docker" 组。容器停掉后下一次扫描周期内消失。

### Label schema

| Hearth | Homepage 兼容 | 含义 | 必需 |
|---|---|---|---|
| `hearth.name` | `homepage.name` | 显示名 | 是 |
| `hearth.href` | `homepage.href` | 跳转 URL | 是 |
| `hearth.group` | `homepage.group` | 分组名 | 否 |
| `hearth.icon` | `homepage.icon` | 图标(URL / `lucide:name`) | 否 |
| `hearth.description` | `homepage.description` | 描述 | 否 |

**优先级**:`hearth.*` 与 `homepage.*` 同时存在 → `hearth.*` 优先。

**必需字段缺失**:`name` 或 `href` 任一缺失 → 跳过该容器,`slog.Debug` 一行(不报错,因为大量容器并不打算被 Hearth 发现,这是正常情况)。

**Icon label**:同 manual app 规则——`lucide:xxx` → Lucide CDN 图标;HTTP(S) URL → 直接 `<img src>`;其他值忽略,前端 fallback 到字母圈。

### 分组归属规则

1. 容器 `<prefix>.group=Media`:
   - 若用户已有同名(大小写不敏感)的分组 "Media"/"media"/"MEDIA" → 该 docker app 加入此 group
   - 若没匹配 → 加入运行时虚拟组 "Docker"
2. 容器没设 `<prefix>.group`:
   - 加入运行时虚拟组 "Docker"
3. 虚拟组 "Docker":
   - 运行时合成,不写入数据库
   - ID = `docker:`(`<group>` 前缀冲突保护)
   - 用户不能重命名 / 删除该组
4. 多个不同 `<prefix>.group` 值都没命中 → 全部进同一个 "Docker" 组(不为每个 group 值各建虚拟组,以免组数膨胀)

### 容器状态过滤

只取 `state="running"` 的容器。其他状态(exited / paused / created / dead / removing)一律跳过。

### 视觉区分

Docker-source app 卡片的图标**右上角**叠加一个小 Docker logo(~8×8 像素,深蓝色 inline SVG)。鼠标 hover 卡片显示 tooltip "Discovered from Docker"(或中文"通过 Docker 发现")。

注:右下角已经被 `StatusDot`(状态绿/灰/红点)占用,所以 Docker 角标固定走右上,避免重叠。

Manual app 与 docker app 在同一个 group 内可以共存(完全合规),小角标是它们之间的唯一视觉差。

### UI 行为限制

- Docker app 在 admin 模式下:**右键菜单 / hover 删除按钮 / 编辑按钮全部隐藏或禁用**。改这些 app 必须改 docker-compose,labels 才是 source of truth。
- 虚拟 "Docker" 组:**不可重命名 / 不可删除**(那些操作就当没传过来,后端忽略,前端按钮隐藏)。
- 用户匹配进来的现有用户 group(如 "Media"):**仍可正常重命名 / 删除**——这是用户自己的 group,只是被 docker app 共住。删除 group 时只删 manual apps;docker apps 自然下次扫描合并到虚拟"Docker"组。

## 后端架构

### 新文件:`internal/docker/labels.go`

```go
type LabelApp struct {
    ContainerID string  // full ID, used as stable React key seed
    Name        string  // hearth.name
    Group       string  // hearth.group (raw label value, may be "")
    Href        string  // hearth.href
    Icon        string  // hearth.icon (may be "")
    Description string  // hearth.description (may be "")
}

type LabelDiscovery struct {
    client   *Client
    interval time.Duration

    mu     sync.RWMutex
    apps   []LabelApp
    
    stopCh chan struct{}
}

func NewLabelDiscovery(client *Client, interval time.Duration) *LabelDiscovery
func (d *LabelDiscovery) Start(ctx context.Context)  // launches polling goroutine
func (d *LabelDiscovery) Stop()
func (d *LabelDiscovery) Apps() []LabelApp           // RLock copy
```

`Start` 内部:`tick := time.NewTicker(interval)`、立即 `scan` 一次、循环 select `<-tick.C` / `<-stopCh` / `<-ctx.Done`。`scan(ctx)` 调 `client.listContainers(ctx)`,过滤 `state="running"`,解析 labels,WLock 替换 `apps`。

`HEARTH_DOCKER_LABEL_INTERVAL=0` → `Start` 不启动 goroutine,`Apps()` 永远返回空。

### Docker 客户端扩展:`internal/docker/client.go`

`listContainers` 已经存在(私有,给 `Collect` 用)。把它**保持私有**,但同时返回每个 entry 完整的 `Labels` map(目前已经在 `containerListEntry` 里了,只需要 `LabelDiscovery` 在同包内调用即可——无需改 client API)。

### Server wiring:`internal/server/server.go`

`Server` 加字段:

```go
labelDiscovery *docker.LabelDiscovery
```

`New` 初始化(在 `dockerClient := docker.New(...)` 后):

```go
labelInterval, _ := time.ParseDuration(cfg.DockerLabelInterval)
ld := docker.NewLabelDiscovery(dockerClient, labelInterval)
ld.Start(context.Background())  // independent context, stopped via Close
s.labelDiscovery = ld
```

`Close` 加:

```go
s.labelDiscovery.Stop()
```

### Config:`internal/server/config.go`

新字段 `DockerLabelInterval string`,env `HEARTH_DOCKER_LABEL_INTERVAL`,默认 `"30s"`。`time.ParseDuration` 失败 → 启动报错(fail-fast,跟其他 config 一致)。

### handleListApps 合并

`internal/server/handlers_groups_apps.go` 的 `handleListApps`:

```go
manualApps, err := s.store.ListApps()
labelApps := s.labelDiscovery.Apps()
groups, _ := s.store.ListGroups()
merged := mergeAppsWithDocker(manualApps, labelApps, groups)
writeJSON(w, http.StatusOK, merged)
```

`mergeAppsWithDocker` 写在 `internal/server/handlers_groups_apps.go` 同文件(内聚),输出顺序:**先 manual app(按现有 sort_order),再 docker app(按 container name 字典序)**。

合并后每个 docker app 形成一个 `AppItem`,字段映射:

| Field | 值 |
|---|---|
| ID | `docker:<containerID 前 12 位>` |
| GroupID | 命中用户组 → 该 group ID;否则 `docker:`(虚拟组 ID) |
| Name | `LabelApp.Name` |
| URL | `LabelApp.Href` |
| Description | `LabelApp.Description`(可空) |
| IconPath | `LabelApp.Icon`(可空) |
| IconSource | `"docker"`(新枚举值) |
| SortOrder | container name 字典序的稳定 index |
| CreatedAt | 0(占位) |
| **`Source`** | `"docker"`(新字段) |

### handleListGroups 合并

类似:

```go
manualGroups, _ := s.store.ListGroups()
labelApps := s.labelDiscovery.Apps()
merged := mergeGroupsWithDocker(manualGroups, labelApps)
```

虚拟 "Docker" 组只有当至少 1 个 label app 没命中现有用户组时才加进返回列表。否则不返回(避免空组挂在 UI 上)。

虚拟组数据形态:

```go
{
    ID:        "docker:",
    Name:      "Docker",
    Kind:      "app",     // 走普通 app group 渲染路径
    SortOrder: math.MaxInt32,  // 永远排在用户组后面
    CreatedAt: 0,
}
```

### Apps / Groups 编辑路由的保护

- `handleUpdateApp` / `handleDeleteApp`:若 `id` 以 `docker:` 开头 → 返回 `403 Forbidden`,body `{"error":"docker-discovered apps are managed via labels"}`,前端不应该发到这里(UI 隐藏按钮),但作为后端兜底
- `handleUpdateGroup` / `handleDeleteGroup` / `handleReorderApps`(对 `groupId="docker:"` 的请求):同样 403

## 前端改动

### 类型扩展

`web/src/types/api.ts` 与 `web/src/types/models.ts` 的 `AppItem`(取决于哪边定义,需读)加:

```ts
source?: 'manual' | 'docker'
```

默认 undefined / 'manual'。docker app 由后端打成 `'docker'`。

### 角标组件

新组件 `web/src/components/cards/DockerBadge.tsx`:小尺寸 SVG inline,绝对定位在 AppIcon 右下角。Hearth 现有图标布局有 `relative` 容器(BookmarkGroup 已经有 StatusDot 同位置),follow same pattern。

### 渲染调整

`AppIcon` 调用处(GroupBlock / BookmarkGroup / QuickLaunch):

```tsx
<div className="relative">
    <AppIcon ... />
    {a.source === 'docker' ? <DockerBadge className="absolute bottom-0 right-0" /> : null}
</div>
```

StatusDot 占 `-bottom-0.5 -right-0.5`,DockerBadge 占 `-top-0.5 -right-0.5`(右上),互不重叠。两者并存时一个 app 卡片右下绿点 + 右上鲸鱼,各自表达独立维度(状态 / 来源)。

### Context menu / 编辑按钮隐藏

`useWidgetEditor` / GroupBlock 的右键菜单:

```ts
const isDockerApp = a.source === 'docker'
// 编辑/删除菜单项不渲染:
{!isDockerApp ? <button onClick={...}>{t('common:edit')}</button> : null}
```

虚拟 "Docker" 组(groupId === 'docker:')的删除/重命名按钮隐藏。判定:

```ts
const isDockerGroup = group.id.startsWith('docker:')
```

### Hover tooltip

DockerBadge 自带 `title="Discovered from Docker"`(取 i18n key `dockerDiscovered`),无需额外组件。

### i18n

新键 `common.json`:
- `dockerDiscovered` (en: "Discovered from Docker", zh: "通过 Docker 发现")

## 错误 & 失败模式

- Docker socket 不可用 → `client.Available()` 返回 false → `LabelDiscovery.scan` 立即返回,`apps` 留空切片 → handleListApps 只返 manual,日志层 slog.Debug
- `HEARTH_DOCKER_LABEL_INTERVAL` 解析失败 → `New` 返 error,启动失败(fail-fast,与其他 invalid config 同级)
- `HEARTH_DOCKER_LABEL_INTERVAL=0` → `Start` 不启动 goroutine(显式禁用,不创建 ticker)
- 容器 label 字段超长(`hearth.description` 几 KB) → 后端不限,直接传给前端;前端 CSS 已经 `truncate`
- `hearth.href` 不是合法 URL(`mailto:` / 相对路径) → V1 不校验,前端点不动用户能看到。后续可能加正则校验
- 同名 docker app(两个容器都标 `hearth.name=Jellyfin`) → 都显示,各自走独立 ID(`docker:<containerID>`),用户在 docker-compose 自己改

## 测试

### 单测

`internal/docker/labels_test.go`:
- `TestLabelDiscoveryParse`:输入 fake `containerListEntry` 切片(running / exited 各几个,labels 各种组合),验证 `LabelApp` 输出
  - hearth.* 优先于 homepage.*
  - 缺 name 跳过
  - 缺 href 跳过
  - 只 running 状态进入
  - icon / description 可空
  - 多种 prefix 组合都覆盖
- `TestLabelDiscoveryEmpty`:无容器 → empty 切片,无 panic

`internal/server/server_test.go`(现有文件,加测试 case):
- `TestListAppsMergesDocker`:store 里 1 manual app,通过 `Server` 字段注入 fake LabelDiscovery 返回 2 docker apps(1 命中现有 group, 1 进虚拟组),验证 GET /api/apps 返回 3 个 app + 含 source 字段 + GET /api/groups 包含虚拟 Docker 组
- 测试需要的"注入"机制:把 `LabelDiscovery` 的 `Apps()` 方法做成可由测试替换的形式(比如把 `Apps()` 改成接口 `LabelSource interface { Apps() []LabelApp }`,Server 持有 `LabelSource` 而非具体类型,测试塞入 fake 实现)。这是测试可注入性的标准模式

### 后端集成

`internal/server/server_test.go` 加 `TestDockerAppEditRefused`:
- POST /api/apps/`docker:abc123` UPDATE → 403
- DELETE /api/apps/`docker:abc123` → 403

### 前端

无单测基础设施,手动验证清单见后。

## 影响面 & 风险

- 启动多一个 goroutine(LabelDiscovery 30s ticker)。CPU 几乎为 0,内存几 KB
- Docker socket 调用频率 +1/30s,与现有 docker widget 的查询并不冲突(独立 HTTP 客户端)
- handleListApps 现在跑两个 store 调用 + 一个 in-mem 读 + 一次合并。当前 manual apps 数量小(< 100),docker apps 同量级,O(N+M) 合并性能无忧
- 前端类型扩展兼容:`source` optional,旧数据(数据库里的 manual apps)默认无该字段,渲染走 manual 路径,无回归
- VPN 兼容模式 + docker app:VPN 模式开启时,docker app 也走前端 status 探测(其 URL 大概率是私网)+ favicon 直接加载——已经是现有逻辑,自动覆盖

## 文件改动清单

| 路径 | 类型 | 内容 |
|---|---|---|
| `internal/docker/labels.go` | 新增 | LabelApp / LabelDiscovery / scan / 解析逻辑 |
| `internal/docker/labels_test.go` | 新增 | 解析单测 |
| `internal/server/config.go` | 修改 | 加 `DockerLabelInterval` + env |
| `internal/server/server.go` | 修改 | LabelDiscovery 初始化 + Close 关闭 + 字段 |
| `internal/server/handlers_groups_apps.go` | 修改 | handleListApps / handleListGroups 合并;handleUpdate/Delete 拦截 docker: 前缀 |
| `internal/server/server_test.go` | 修改 | 加 TestListAppsMergesDocker / TestDockerAppEditRefused |
| `web/src/types/models.ts` | 修改 | AppItem 加 `source?: 'manual' \| 'docker'` |
| `web/src/components/cards/DockerBadge.tsx` | 新增 | 小角标 SVG 组件 |
| `web/src/components/layout/GroupBlock.tsx` 等 callsites | 修改 | 在 `<AppIcon>` 外层 `relative` 容器里添加 `<DockerBadge>`(已有 StatusDot 同位置),三处:GroupBlock / BookmarkGroup / QuickLaunch |
| `web/src/components/layout/GroupBlock.tsx` | 修改 | 隐藏 docker app 的编辑/删除按钮;虚拟 docker group 的重命名/删除按钮 |
| `web/src/components/layout/BookmarkGroup.tsx` | 修改 | 同上 |
| `web/src/i18n/locales/en/common.json` + zh | 修改 | `dockerDiscovered` key |
| `README.md` / `README_CN.md` | 修改 | "Docker Labels" 小节 + docker-compose 例子 + 兼容 homepage 一句话 |
| `tasks/todo.md` | 修改 | F2 完成日志 |

## 手动验证清单

1. 起一个测试容器,docker-compose 标 `hearth.name=TestApp` + `hearth.href=http://localhost:8080/`
2. 30 秒内,Hearth dashboard "Docker" 分组出现 TestApp 卡片,图标右下角带 docker 角标
3. `docker stop test_container` → 30 秒内 TestApp 消失
4. 用户手动建一个 group "Media",再起容器标 `hearth.group=Media` → docker app 进入 Media 组
5. 把 `hearth.*` 改成 `homepage.*` → 行为一致
6. 试图在 UI 编辑 docker app → 编辑/删除按钮不见;手动 curl PUT /api/apps/docker:xxx → 403
7. 试图重命名 / 删除虚拟 "Docker" 组 → 按钮不见;curl 直接打 → 403
8. `HEARTH_DOCKER_LABEL_INTERVAL=0` 重启 → docker app 全部消失,manual 不变
9. VPN 兼容模式开 + docker app(LAN URL)→ 状态绿点 + favicon 通过浏览器加载,与之前 manual app 表现一致
