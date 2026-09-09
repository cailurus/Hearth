<p align="center">
  <img src="https://raw.githubusercontent.com/cailurus/Hearth/main/web/public/campfire.png" alt="Hearth" width="80" height="80">
</p>

<h1 align="center">Hearth</h1>

<p align="center">
  一个轻量级、自托管的家庭服务仪表盘。
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/cailurus/Hearth/actions"><img src="https://img.shields.io/github/actions/workflow/status/cailurus/Hearth/dockerhub.yml?branch=main&style=flat-square" alt="构建状态"></a>
  <a href="https://hub.docker.com/r/cailurus/hearth"><img src="https://img.shields.io/docker/pulls/cailurus/hearth?style=flat-square" alt="Docker 拉取"></a>
  <a href="https://hub.docker.com/r/cailurus/hearth"><img src="https://img.shields.io/docker/image-size/cailurus/hearth/latest?style=flat-square" alt="镜像大小"></a>
  <a href="https://github.com/cailurus/Hearth/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cailurus/Hearth?style=flat-square" alt="许可证"></a>
  <a href="https://github.com/cailurus/Hearth/releases"><img src="https://img.shields.io/github/v/release/cailurus/Hearth?style=flat-square" alt="版本"></a>
  <a href="https://github.com/cailurus/Hearth"><img src="https://img.shields.io/github/stars/cailurus/Hearth?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cailurus/Hearth/main/screenshot.png" alt="截图" width="800">
</p>

## ✨ 功能特性

### 导航与布局
- 🏠 **应用分组** - 将服务组织到自定义分组中
- 🔖 **书签** - 紧凑的标签式快速链接
- 🔍 **快速启动** - `Cmd/Ctrl+K` 搜索应用，支持拼音匹配
- 🟢 **服务状态** - 实时健康检查指示灯（支持 HTTPS 自签名证书）
- 🖱️ **拖拽排序** - 自由拖拽调整分组和项目顺序
- 🎨 **毛玻璃 UI** - 无边框磨砂玻璃卡片设计

### 小组件
- 🌤️ **天气** - 当前天气及 7 日预报（Open-Meteo，无需 API Key）
- 📈 **行情** - 美股、港股和加密货币价格，当日走势图（Yahoo Finance）
- 💱 **汇率** - 最多 4 个货币对，30 天历史走势图 + 国旗标识（Frankfurter API）
- 📰 **RSS 订阅** - 聚合最多 10 个 RSS/Atom 源，支持手动刷新和高度调节
- 🕐 **世界时钟** - 最多 4 个可配置的时区时钟
- 📊 **系统状态** - CPU、内存、磁盘和网络监控，含 7 天历史趋势图
- 🐳 **Docker 监控** - 容器状态、资源占用、启动/停止/重启操作
- 🗓️ **假日** - 显示所选国家/地区的即将到来的假日
- 📝 **便签** - 快速笔记和备忘

### 个性化
- 👋 **问候语 & 每日一言** - 基于时间段的问候语，中文一言使用 Hitokoto，英文使用 ZenQuotes
- 🗓️ **二十四节气** - 可选在日期旁显示中国节气（可在设置中开关）
- 🎨 **动态背景** - Bing 每日、随机、Unsplash、Picsum 或视频背景
- 🌓 **中英双语** - 完整的国际化支持
- 📱 **移动端适配** - 响应式设计，适配所有设备
- ✨ **彩蛋** - 5 种隐藏粒子效果（雪花、雨、樱花、萤火虫、流星）

## 🚀 快速开始

### Docker（推荐）

```bash
docker run -d \
  --name hearth \
  -p 8787:8787 \
  -v hearth-data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  cailurus/hearth:latest
```

打开 `http://localhost:8787`，用户名为 `admin`。若配置了 `HEARTH_INITIAL_PASSWORD`，使用该密码；否则从 `docker logs hearth` 查看首次启动时生成的密码。

> Docker socket 挂载（`-v /var/run/docker.sock:...`）是**可选的** —— 它用于启用 Docker 监控组件。不挂载时，其他所有功能正常使用。

### Docker Compose

```yaml
services:
  hearth:
    image: cailurus/hearth:latest
    ports:
      - "8787:8787"
    volumes:
      - hearth-data:/data
      - /var/run/docker.sock:/var/run/docker.sock  # 可选：启用 Docker 监控
    restart: unless-stopped

volumes:
  hearth-data:
```

## 🔐 安全

| 项目 | 详情 |
|------|------|
| 首次用户名 | `admin` |
| 首次密码 | 若设置了 `HEARTH_INITIAL_PASSWORD`，则使用该值；否则 Hearth 会生成 16 位随机密码并以横幅形式打印到标准输出，首次登录时强制修改。该密码不会写入磁盘，也不会再次出现在结构化日志中。 |
| 频率限制 | 15 分钟内 5 次失败后锁定 5 分钟 |
| 重置密码 | `docker exec -it hearth /hearth/reset-password -db /data/hearth.db -password 新密码` |

获取容器启动时打印的初始密码：

```bash
docker logs hearth | head -20
```

## ⚙️ 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HEARTH_ADDR` | `:8787` | 监听地址 |
| `HEARTH_DATA_DIR` | `/data` | 数据目录 |
| `HEARTH_SESSION_TTL` | `168h` | 会话过期时间 |
| `HEARTH_COOKIE_SECURE` | `auto` | Secure Cookie 标志（`auto` / `true` / `false`） |
| `HEARTH_DOCKER_SOCKET` | 自动检测 | Docker socket 路径（自动检测常见路径） |
| `HEARTH_INITIAL_PASSWORD` | _(空)_ | 初始管理员密码。未设置时自动生成 16 位随机密码并打印到标准输出（通过 `docker logs` 查看）。 |
| `HEARTH_COINGECKO_API_KEY` | _(空)_ | 可选的 CoinGecko Demo Key，用于加密货币备用源和搜索。仅在服务端使用，不返回浏览器；不配置时保留原有匿名备用访问方式，但不保证可用性。请遵守账户配额，遇到 429 时退避，不密集重试。 |
| `HEARTH_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 跨域允许列表（逗号分隔）。默认仅允许内置的 Vite 开发服务器；生产部署因前后端同源无需调整，除非将前端部署到独立域名。 |
| `HEARTH_DOCKER_ALLOW_PATTERNS` | _(空)_ | 容器 `start`/`stop`/`restart` 操作的容器名正则白名单（逗号分隔）。留空则允许操作任何 Docker 守护进程暴露的容器。示例：`^(jellyfin\|sonarr\|radarr)$`。不匹配则返回 403 并记入审计日志。 |
| `HEARTH_DOCKER_LABEL_INTERVAL` | `30s` | 容器 `hearth.*`/`homepage.*` 标签发现的轮询间隔。`0s`（或 `0`）彻底关闭轮询。 |
| `HEARTH_TRUSTED_PROXY_HEADER` | _(空)_ | 当 Hearth 部署在 forward-auth 反代后（Authelia / Authentik / oauth2-proxy / Caddy `forward_auth` / Traefik `forwardAuth`），用于携带认证用户名的 HTTP 头部名称。常用值：`X-Remote-User`、`Remote-User`。必须同时设置 `HEARTH_TRUSTED_PROXY_NETWORKS`，否则 Hearth 拒绝启动。 |
| `HEARTH_TRUSTED_PROXY_NETWORKS` | _(空)_ | 反代源 IP 的 CIDR 白名单（逗号分隔）。只有从这些网段进来的请求才会信任上面的头部 — 绕过反代直连 Hearth 无法伪造头部。示例：`10.0.0.0/8,172.20.0.0/16`。 |

### 组件数据与离线行为

- 各组件独立加载。刷新失败时保留仍可使用的旧数据，并明确显示警告，不再把上游失败包装成零价格或无尽加载占位。
- 天气、已解析坐标、参考汇率、RSS 元数据、年度假日和一言使用 `$HEARTH_DATA_DIR/widget-cache` 下的有界快照，现有 Docker 数据卷即可跨重启保留。缓存过期但仍在可用期限内时先显示旧数据，后台合并刷新；超过保留期限的数据不当作当前数据展示。
- 首次没有任何有效快照时，仍需要数据源成功返回。超时、部分结果、后台刷新及数据时间会明确显示；RSS 手动刷新会绕过新鲜缓存。
- 选择天气城市时同时保存坐标。已有仅城市名的配置继续兼容，但解析过程有缓存和超时限制，不再先查询时区才读取天气。
- Frankfurter v1 提供工作日**参考汇率**，不是银行买入/卖出价。行情保留实际币种及供应商数据时间，不保证是实时交易数据。Yahoo/CoinGecko 行情仅保留内存缓存，部署者仍需遵守供应商数据使用条款。
- 随应用附带经过核实的 2026 年中国假日数据、许可证及来源信息，支持离线首启；年度数据后台更新，不虚构尚未公布的未来假期。
- 中文每日一言使用 Hitokoto，英文使用 ZenQuotes，页面保留来源署名。不自动启用付费数据源，也不内置共用 API 凭据。

<details>
<summary><b>NAS Docker 监控配置</b>（飞牛 fnOS、群晖 Synology 等）</summary>

NAS 的 Docker 管理界面通常只能挂载**目录**，不能挂载单个文件。启用 Docker 监控的方法：

1. 在 NAS Docker 设置中添加**目录挂载**：

   | 宿主机路径 | 容器路径 |
   |-----------|---------|
   | `/var/run` | `/host-run` |

2. 添加**环境变量**：

   | 变量 | 值 |
   |------|---|
   | `HEARTH_DOCKER_SOCKET` | `/host-run/docker.sock` |

如果 NAS 限制访问 `/var/run`，可通过 SSH 登录后执行：
```bash
mkdir -p /vol2/1000/ServiceStore/docker-sock
mount --bind /var/run /vol2/1000/ServiceStore/docker-sock
```
然后将 `/vol2/1000/ServiceStore/docker-sock` 挂载到 `/host-run`。

</details>

## 🔍 同类对比

自托管仪表盘已有不少成熟方案。Hearth 面向使用 NAS（飞牛 OS / 群晖 / 极空间）的中文家庭用户，定位是带有温度感的个人启动页 —— 拼音 Cmd+K、玻璃态 UI、24 节气、粒子彩蛋。下表仅作参考，不是排名。

| 维度        | Hearth        | homepage     | glance       | homarr         |
| ----------- | ------------- | ------------ | ------------ | -------------- |
| 适合谁      | 中文家用 NAS  | 重度玩家     | 信息聚合党   | 团队多用户     |
| 技术栈      | Go + React 19 | Next.js      | 纯 Go        | Next.js + tRPC |
| 配置方式    | UI + JSON     | YAML 文件    | YAML 文件    | UI 拖拽        |
| 小组件      | 精选集合      | 100+ 集成    | RSS / HN / 微博 | 插件市场    |
| 服务发现    | 手动添加      | Docker 标签  | 手动添加     | Docker + K8s   |
| 多用户      | 单用户        | 无           | 无           | OIDC + RBAC    |
| 体积        | 单 Go 二进制  | Node 运行时  | 二进制 ~25MB | Node 运行时    |

**怎么选。** 如果你有几十个服务、想用 Docker 标签自动发现，选 **homepage**；如果你想要颜值最高、体积最小的报刊风信息聚合，选 **glance**；如果你要给团队提供带 SSO 和 RBAC 的共享仪表盘，选 **homarr**；如果你是中文家庭用户，想要拼音搜索、节气彩蛋和单二进制后端，Hearth 就是为这种口味做的。

## 🐳 Docker 标签自动发现

Hearth 可以从正在运行的 Docker 容器的 labels 自动把服务加进
dashboard,不需要在 UI 上一个一个手填。在任意容器的
`docker-compose.yml` 加几个 label,~30 秒内自动出现:

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

| Label | 必需 | 用途 |
|---|---|---|
| `hearth.name` | 是 | 显示名 |
| `hearth.href` | 是 | 卡片跳转链接 |
| `hearth.group` | 否 | 落入同名用户组(大小写不敏感)或虚拟"Docker"组 |
| `hearth.icon` | 否 | URL 或 `lucide:图标名` |
| `hearth.description` | 否 | 副标题 |

**已经在用 gethomepage/homepage?** Hearth 同样识别 `homepage.*`
labels(字段名相同),你的 docker-compose 一行不用改。同时存在两套
prefix 时,`hearth.*` 在每个字段上分别优先。

**生命周期:**容器必须在 `state="running"` 才显示。停止或删除容器,
对应的 app 在 30 秒内从 dashboard 消失。通过 Docker 发现的 app
在 UI 上只读(后端拒绝 `PUT` / `DELETE`)——labels 才是真相之源。

**关闭自动发现:**设置 `HEARTH_DOCKER_LABEL_INTERVAL=0` 即可彻底
关闭轮询。

## 🛠️ 开发

```bash
# 环境要求：Go 1.25+、Node.js 20+

git clone https://github.com/cailurus/Hearth
cd Hearth

# 开发模式（后端 + 前端热重载）
make dev

# 生产构建
make build
./dist/hearth
```

## 📁 数据存储与持久化

所有数据（包括用户凭证、应用链接、设置）存储在 `/data` 目录下：

```
data/
├── hearth.db    # SQLite 数据库（用户、应用、设置）
├── icons/       # 缓存的应用图标
└── cache/       # 背景图片缓存
```

### 容器更新时保留数据

使用 Docker 命名卷或宿主机目录挂载以确保数据持久化：

**使用 Docker 命名卷（推荐）：**
```bash
docker run -d -v hearth-data:/data cailurus/hearth:latest
```

**使用宿主机目录：**
```bash
docker run -d -v /path/to/my/data:/data cailurus/hearth:latest
```

更新容器时数据会自动保留：
```bash
docker pull cailurus/hearth:latest
docker stop hearth && docker rm hearth
docker run -d --name hearth -p 8787:8787 \
  -v hearth-data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  cailurus/hearth:latest
```

## 📄 许可证

[MIT](LICENSE)
