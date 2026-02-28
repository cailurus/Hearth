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
