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

- 🏠 **应用分组** - 将服务组织到自定义分组中
- 🔖 **书签** - 紧凑的标签式快速链接
- 🔍 **快速启动** - `Cmd/Ctrl+K` 搜索应用，支持拼音匹配
- 🟢 **服务状态** - 每个应用卡片上的实时健康检查指示灯
- 👋 **问候语** - 基于时间段的个性化问候消息
- 🌤️ **天气组件** - 当前天气及 5 日预报
- 🕐 **世界时钟** - 最多 4 个可配置的时区时钟
- 📊 **系统状态** - CPU、内存、磁盘和网络监控
- 📈 **行情组件** - 美股、港股和加密货币价格追踪
- 🗓️ **假日组件** - 显示所选国家/地区的即将到来的假日
- 🎨 **动态背景** - Bing 每日、随机或视频背景
- 🌓 **中英双语** - 完整的国际化支持
- 📱 **移动端适配** - 响应式设计，适配所有设备
- 🐳 **Docker 监控** - 容器状态、CPU、内存和网络 I/O
- 🖱️ **拖拽排序** - 拖拽调整分组和项目顺序

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

打开 `http://localhost:8787`，使用 `admin` / `admin` 登录。

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
| 默认登录 | `admin` / `admin` |
| 频率限制 | 15 分钟内 5 次失败后锁定 5 分钟 |
| 重置密码 | `docker exec -it hearth /hearth/reset-password -db /data/hearth.db -password 新密码` |

⚠️ **首次登录后请立即修改默认密码！**

## ⚙️ 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HEARTH_ADDR` | `:8787` | 监听地址 |
| `HEARTH_DATA_DIR` | `/data` | 数据目录 |
| `HEARTH_SESSION_TTL` | `168h` | 会话过期时间 |
| `HEARTH_COOKIE_SECURE` | `auto` | Secure Cookie 标志（`auto` / `true` / `false`） |
| `HEARTH_DOCKER_SOCKET` | 自动检测 | Docker socket 路径（自动检测常见路径） |

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

## 🛠️ 开发

```bash
# 环境要求：Go 1.24+、Node.js 20+

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
