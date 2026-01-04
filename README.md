# Hearth

Hearth is a lightweight home dashboard for self-hosted services.

![Hearth screenshot](./screenshot.png)

- Backend: Go + SQLite
- Frontend: React (Vite)
- Features: grouped app links, built-in widgets (weather / world clock / system status), background wallpaper

## Download & Run (Local)

Prerequisites: Go and Node.js.

### Build from source

The build includes the web frontend. `make build` will run `npm ci` inside `web/` and then build the Go binary.

```bash
git clone https://github.com/cailurus/Hearth
cd Hearth

# Optional: start from a clean state
# make clean

make build
./dist/hearth
```

Open `http://localhost:8787`.

Default admin login: `admin` / `admin`.