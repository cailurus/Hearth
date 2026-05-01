# Lessons Learned

## Icon Resolver — Test Assumptions Before Coding
- **Mistake 1**: Assumed the HTML had no icon tags (SPA). Reality: Nuxt SSR *does* render `<link rel="icon">` in server HTML, but they all pointed to the same logo image.
- **Mistake 2**: Assumed Google favicon service would return the correct icon. Reality: Google also returned the 240x120 logo, not the 64x64 tab favicon.
- **Mistake 3**: Assumed `/apple-touch-icon.png` existed and was the source of the wrong logo. Reality: it returned 404. The wrong icon came from the `<link rel="icon">` tags themselves.
- **Root cause**: ALL `<link rel="icon">`, `<link rel="shortcut icon">`, and `<link rel="apple-touch-icon">` pointed to the same OSS-hosted logo (240x120). The correct 64x64 favicon was only in the **PWA web-app manifest** (`<link rel="manifest">`), which the resolver never parsed.
- **Fix**: Added `tryManifestIcons()` — fetch `<link rel="manifest">` JSON, extract icons, prefer 16-64px square sizes. Manifest icons are tried first (Step 2) before any `<link rel="icon">` candidates.
- **Lesson**: ALWAYS `curl` the actual URLs before writing code. Don't rely on AI summarization of page content (WebFetch). Don't assume what a URL returns — verify it.

## General: Verify Before Claiming Done
- Never say "this should work" without actually running the code against the real input.
- For icon resolution bugs, curl every candidate URL and check dimensions/content.

## When auditing previously "fixed" security items, check the default branch
- During Round 2 review (2026-05-01), `tasks/todo.md` listed Phase 1.1 ("CORS configuration fix") and Phase 1.3 ("Remove TLS auto-downgrade") as completed. Both turned out to be only partially fixed:
  - Phase 1.1 added `HEARTH_CORS_ORIGINS` support but left the unset-default as `AllowedOrigins=["*"]` — i.e. the documented "fix" only protects users who actively configure it.
  - Phase 1.3 didn't remove the `InsecureSkipVerify` client; it just delayed it to a "TLS-error retry" path that's still triggered automatically.
- **Lesson**: when a past commit claims "fixed X via env var Y", read the *unset-Y* code path before trusting it. The dangerous default is the one most users will run.
- **How to apply**: for any "[x] Phase N.M security fix", grep for the env var, then read the `else` branch / fallback. Don't rely on the todo description.

## Swapping Chinese pinyin libraries: test polyphones, not just the API surface
- 2026-05-01 swap of `pinyin-pro` (302 KB / 138 KB gzipped) → `tiny-pinyin` (8 KB / 3.6 KB gzipped) was driven by bundle size. The two libraries have similar APIs for the calls we use (`convertToPinyin`, `parse`), so the *code-shape* port was trivial.
- The functional regression was elsewhere: tiny-pinyin's dictionary doesn't disambiguate polyphones from context. Concrete cases that broke full-pinyin search: "音乐" (`yinyue` → `yinlao`), "银行" (`yinhang` → `yinxing`), "行情" (`hangqing` → `xingqing`). Initials-search still worked because polyphones share the same声母 ("y"/"x"), so user impact was bounded but real.
- **Lesson**: when swapping a Chinese-language utility library — even one with an "almost-identical" API — write a smoke test against actual project content (NAS apps, Chinese brand names) before trusting the swap. The dictionary choices are part of the contract, not just the function signatures.
- **How to apply**: build a list of canonical inputs from the project's actual user data (or representative samples) and snapshot the outputs. Any library swap must produce comparable outputs on that list, or the regression must be acknowledged in the commit and lessons.

## NAS / docker-self-host first-run secrets: print to stdout, don't write a file
- Initial design (2026-05-01) wrote the auto-generated admin password to `<data>/initial-admin.txt`. User pushed back: "directly print to terminal, no file."
- **Why**: NAS UIs (fnOS / Synology / 极空间) often *don't* expose a shell, but they always show container logs. `docker logs hearth` is one click; `docker exec cat /data/initial-admin.txt` is two layers of friction. Files also linger after rotation/restore and become a stale credential leak.
- **How to apply**: for any first-run / break-glass / generated-secret in a self-host product, default to "print once to stdout as a loud banner". Provide a file fallback only if the user explicitly opts in. Never both. The banner should:
  1. Be visually distinct (full-width separator bars) so it survives `docker logs | tail`.
  2. Print **outside** the slog/structured pipeline, so it can't accidentally end up in Loki/ELK aggregators.
  3. Self-document its impermanence ("not logged again, not written to disk").
- **Process lesson**: when offering options to the user, sample the *non-obvious* good answer too. I gave them a/b/c all involving file persistence, missed "stdout-only". They had to add the option themselves.
