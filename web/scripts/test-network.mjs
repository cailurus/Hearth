#!/usr/bin/env node
// Smoke test for utils/network.ts. Asserts the public truth table the
// VPN compat mode relies on. Mirrors the source — keep in sync when
// isPrivateHost changes.

import { isPrivateHost } from '../src/utils/network.ts'

const cases = [
    // localhost / loopback
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    // RFC1918 private
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.255.254', true],
    // link-local
    ['169.254.1.1', true],
    // homelab suffixes
    ['nas.local', true],
    ['fnos.lan', true],
    ['router.local', true],
    // IPv6 loopback / ULA / link-local
    ['::1', true],
    ['fc00::1', true],
    ['fd00::abcd', true],
    ['fe80::1', true],
    // Public — must be false
    ['github.com', false],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.15.0.1', false],   // 172.15 is OUTSIDE the 172.16/12 block
    ['172.32.0.1', false],   // 172.32 is OUTSIDE the 172.16/12 block
    ['11.0.0.1', false],
    ['example.com', false],
    // IPv4 with port stripped — caller is expected to pass the host alone
    // but we also accept "host:port" for safety
    ['192.168.2.125:5666', true],
    ['github.com:443', false],
    // Edge cases
    ['', false],
    ['not.an.ip', false],
]

let failed = 0
for (const [host, want] of cases) {
    const got = isPrivateHost(host)
    if (got !== want) {
        console.error(`✗ isPrivateHost(${JSON.stringify(host)}) = ${got}, want ${want}`)
        failed++
    }
}
if (failed > 0) {
    console.error(`\n${failed} case(s) failed`)
    process.exit(1)
}
console.log(`✓ isPrivateHost OK across ${cases.length} cases`)
