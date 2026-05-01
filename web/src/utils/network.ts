/**
 * Private-host detection used by VPN compat mode.
 *
 * The frontend can't do DNS lookups, so this only recognises literal IP
 * addresses and well-known homelab suffixes. The browser bypassing the
 * VPN to reach these hosts works precisely because the user's machine
 * already knows how to route them — DNS-name targets that resolve into
 * private space (e.g. nas.example.com) aren't recognised here. Users
 * with that setup either use the IP directly or keep VPN mode off.
 *
 * Keep in sync with web/scripts/test-network.mjs.
 */

export function isPrivateHost(input: string): boolean {
    if (!input) return false
    // Accept "host:port" for caller convenience; strip the port.
    const host = stripPort(input).toLowerCase()
    if (host === 'localhost') return true
    if (host.endsWith('.local') || host.endsWith('.lan')) return true

    const v4 = parseIPv4(host)
    if (v4) {
        return inIPv4CIDR(v4, [10, 0, 0, 0], 8)
            || inIPv4CIDR(v4, [172, 16, 0, 0], 12)
            || inIPv4CIDR(v4, [192, 168, 0, 0], 16)
            || inIPv4CIDR(v4, [127, 0, 0, 0], 8)
            || inIPv4CIDR(v4, [169, 254, 0, 0], 16)
    }
    const v6 = parseIPv6(host)
    if (v6) {
        if (v6 === '::1') return true
        // ULA fc00::/7 (matches both fc.. and fd..)
        if (v6.startsWith('fc') || v6.startsWith('fd')) return true
        // link-local fe80::/10
        if (v6.startsWith('fe80') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) return true
    }
    return false
}

function stripPort(host: string): string {
    // IPv6 literals are bracketed: [::1]:8080. Don't be tripped up by the colons inside.
    if (host.startsWith('[')) {
        const end = host.indexOf(']')
        if (end > 0) return host.slice(1, end)
        return host
    }
    // IPv4 / hostname: only one colon means host:port; multiple colons means IPv6 (no port).
    const colons = host.match(/:/g)
    if (colons && colons.length === 1) {
        const idx = host.indexOf(':')
        return host.slice(0, idx)
    }
    return host
}

function parseIPv4(host: string): [number, number, number, number] | null {
    const parts = host.split('.')
    if (parts.length !== 4) return null
    const out: number[] = []
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null
        const n = Number(p)
        if (n < 0 || n > 255) return null
        out.push(n)
    }
    return [out[0], out[1], out[2], out[3]]
}

function inIPv4CIDR(
    ip: [number, number, number, number],
    network: [number, number, number, number],
    prefix: number
): boolean {
    const ipInt = (ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]
    const netInt = (network[0] << 24) | (network[1] << 16) | (network[2] << 8) | network[3]
    if (prefix === 0) return true
    const mask = (~0) << (32 - prefix)
    return (ipInt & mask) === (netInt & mask)
}

function parseIPv6(host: string): string | null {
    // Strip surrounding brackets if any leaked through stripPort.
    let h = host
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
    // Cheap IPv6 sniff: contains '::' OR has at least 2 ':' segments.
    if (!h.includes(':')) return null
    // Reject if it has a '.' that isn't part of an IPv4-mapped suffix —
    // we only need URL hosts here, so we keep this simple.
    if (h.includes('.')) return null
    // Validate: only hex digits and ':'
    if (!/^[0-9a-f:]+$/.test(h)) return null
    return h
}
