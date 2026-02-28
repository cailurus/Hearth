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
