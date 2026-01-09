# Hearth

Hearth is a lightweight home dashboard for self-hosted services.

![Hearth screenshot](https://raw.githubusercontent.com/cailurus/Hearth/main/screenshot.png)

- Backend: Go + SQLite
- Frontend: React (Vite)
- Features: grouped app links, built-in widgets (weather / world clock / system status), background wallpaper

## 🚀 Quick Start

### Docker CLI

```bash
docker pull cailurus/hearth:latest

docker run -d \
  --name hearth \
  -p 8787:8787 \
  -v hearth-data:/data \
  --restart unless-stopped \
  cailurus/hearth:latest
```

Open `http://localhost:8787`.

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

## 🔐 Security Notes

**Default admin credentials:**
- Username: `admin`
- Password: `admin`

⚠️ **Please change the default password after first login!**

### Changing Password

You can change your admin password in **Settings > Change Password** after logging in.

### Reset Forgotten Password

If you forget your admin password, you can reset it using the CLI tool:

```bash
# Using the shell script (requires Go)
./scripts/reset-admin-password.sh

# Or using Go directly
go run ./cmd/reset-password/main.go -db data/hearth.db -password newpassword

# In Docker
docker exec -it hearth /hearth/reset-password -db /data/hearth.db -password newpassword
```

### Login Rate Limiting

The application includes built-in login rate limiting to protect against brute-force attacks:
- Maximum 5 failed attempts within 15 minutes
- After exceeding the limit, the account is blocked for 5 minutes

### Network Considerations

This application is designed for **internal network (LAN) use**. If you need to expose it to the internet:
- Consider using a reverse proxy (nginx, Traefik, Caddy)
- Enable HTTPS at the reverse proxy level
- Implement additional authentication if needed

## 📦 Data Storage

Data is stored under `/data` inside the container:
- `hearth.db` - SQLite database (settings, apps, groups)
- `icons/` - Cached application icons
- `cache/` - Background image cache

If you bind-mount a host folder to `/data` (e.g. `-v ./data:/data`), that folder must be writable by the container.

## ⚙️ Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTH_ADDR` | `:8787` | Listen address |
| `HEARTH_DATA_DIR` | `/data` (Docker) / `./data` (local) | Data directory path |
| `HEARTH_DB_DSN` | `<data_dir>/hearth.db` | SQLite database path |
| `HEARTH_SESSION_TTL` | `168h` | Session expiration time |
| `HEARTH_MARKET_ICON_BASE_URL` | `https://raw.githubusercontent.com/nvstly/icons/main` | Market icons source |

## 🔌 API Endpoints

### Health Check

```bash
curl http://localhost:8787/api/health
```

Response:
```json
{
  "ok": true,
  "version": "dev",
  "database": true
}
```

## 🛠️ Development

### Prerequisites

- Go 1.24+
- Node.js 20+

### Build from Source

```bash
git clone https://github.com/cailurus/Hearth
cd Hearth

# Build frontend + backend
make build

# Run
./dist/hearth
```

### Development Mode

```bash
# Start both backend and frontend dev servers
make dev
```

- Backend: http://localhost:8787
- Frontend (hot reload): http://localhost:5173

### Docker Build

```bash
# Build local image
make docker

# Run with docker-compose
make docker-compose-up
```

## 📁 Project Structure

```
├── cmd/hearth/          # Application entry point
├── internal/
│   ├── auth/            # Authentication & session management
│   ├── background/      # Background image service
│   ├── icon/            # Icon resolver & cache
│   ├── metrics/         # Host metrics collection
│   ├── server/          # HTTP server & handlers
│   ├── store/           # SQLite data access layer
│   └── widgets/         # Weather, markets, holidays APIs
└── web/                 # React frontend (Vite)
```

## 📄 License

MIT