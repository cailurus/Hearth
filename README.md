<p align="center">
  <img src="https://raw.githubusercontent.com/cailurus/Hearth/main/web/public/hearth.svg" alt="Hearth" width="80" height="80">
</p>

<h1 align="center">Hearth</h1>

<p align="center">
  A lightweight, self-hosted home dashboard for your services.
</p>

<p align="center">
  <a href="https://github.com/cailurus/Hearth/actions"><img src="https://img.shields.io/github/actions/workflow/status/cailurus/Hearth/docker.yml?branch=main&style=flat-square" alt="Build Status"></a>
  <a href="https://hub.docker.com/r/cailurus/hearth"><img src="https://img.shields.io/docker/pulls/cailurus/hearth?style=flat-square" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/cailurus/hearth"><img src="https://img.shields.io/docker/image-size/cailurus/hearth/latest?style=flat-square" alt="Docker Image Size"></a>
  <a href="https://github.com/cailurus/Hearth/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cailurus/Hearth?style=flat-square" alt="License"></a>
  <a href="https://github.com/cailurus/Hearth/releases"><img src="https://img.shields.io/github/v/release/cailurus/Hearth?style=flat-square" alt="Release"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/cailurus/Hearth/main/screenshot.png" alt="Screenshot" width="800">
</p>

## ✨ Features

- 🏠 **Grouped App Links** - Organize your services into custom groups
- 🌤️ **Weather Widget** - Current weather with 5-day forecast
- 🕐 **World Clock** - Up to 4 configurable timezone clocks
- 📊 **System Status** - CPU, memory, disk, and network monitoring
- 📈 **Market Ticker** - Stock and crypto price tracking
- 🎨 **Dynamic Backgrounds** - Bing daily or random images
- 🌓 **Bilingual UI** - Chinese and English support
- 📱 **Mobile Friendly** - Responsive design for all devices

## 🚀 Quick Start

### Docker (Recommended)

```bash
docker run -d \
  --name hearth \
  -p 8787:8787 \
  -v hearth-data:/data \
  --restart unless-stopped \
  cailurus/hearth:latest
```

Open `http://localhost:8787` and login with `admin` / `admin`.

### Docker Compose

```yaml
services:
  hearth:
    image: cailurus/hearth:latest
    ports:
      - "8787:8787"
    volumes:
      - hearth-data:/data
    restart: unless-stopped

volumes:
  hearth-data:
```

## 🔐 Security

| Item | Details |
|------|---------|
| Default Login | `admin` / `admin` |
| Rate Limiting | 5 attempts per 15 min, then 5 min lockout |
| Password Reset | `docker exec -it hearth /hearth/reset-password -db /data/hearth.db -password NEW` |

⚠️ **Change the default password after first login!**

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTH_ADDR` | `:8787` | Listen address |
| `HEARTH_DATA_DIR` | `/data` | Data directory |
| `HEARTH_SESSION_TTL` | `168h` | Session expiration |

## 🛠️ Development

```bash
# Prerequisites: Go 1.24+, Node.js 20+

git clone https://github.com/cailurus/Hearth
cd Hearth

# Dev mode (backend + frontend with hot reload)
make dev

# Build production
make build
./dist/hearth
```

## 📁 Data Storage

Data is stored in `/data` (container) or `./data` (local):

```
data/
├── hearth.db    # SQLite database
├── icons/       # Cached app icons
└── cache/       # Background images
```

## 📄 License

[MIT](LICENSE)
