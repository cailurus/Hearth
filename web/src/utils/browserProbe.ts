/**
 * browserProbe — best-effort reachability check from the user's browser.
 *
 * Used by useAppStatus when VPN compat mode is on: the backend may not be
 * able to reach LAN targets (its socket binds to a VPN-claimed primary
 * interface), but the browser sitting next to the user usually can.
 *
 * Caveats baked into the contract:
 * - mode: 'no-cors' means we can't read the response status. We treat
 *   "fetch resolved without throwing" as "up" — anything from 200 to
 *   500 to a CORS-stripped opaque response counts. This is the right
 *   contract for a status dot; users care about live/dead, not status
 *   codes.
 * - AbortError or TypeError (network unreachable, DNS fail, mixed content
 *   block) → "down".
 */

export type BrowserProbeResult = 'up' | 'down'

export async function browserProbe(url: string, timeoutMs = 5000): Promise<BrowserProbeResult> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
        await fetch(url, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            redirect: 'follow',
            signal: controller.signal,
            // Don't send cookies / credentials — the target may be a
            // foreign origin and we don't want to leak Hearth's cookies.
            credentials: 'omit',
        })
        return 'up'
    } catch {
        return 'down'
    } finally {
        window.clearTimeout(timer)
    }
}
