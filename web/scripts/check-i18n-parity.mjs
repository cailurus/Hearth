#!/usr/bin/env node
/**
 * Verify that every key in src/i18n/locales/<lang>/<ns>.json is present in every
 * other language. Exit code 0 = all locales agree; 1 = at least one drift.
 *
 * Run via `npm run lint:i18n` (defined in package.json) or directly with
 * `node scripts/check-i18n-parity.mjs`.
 *
 * The check is intentionally simple — it walks objects recursively and
 * compares key sets. It does NOT validate translation quality, formatting
 * tokens (`{{count}}`), or that values are non-empty.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = join(__dirname, '..', 'src', 'i18n', 'locales')

function collectKeys(obj, prefix = '') {
    const out = new Set()
    if (obj === null || typeof obj !== 'object') return out
    for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            for (const nested of collectKeys(v, full)) out.add(nested)
        } else {
            out.add(full)
        }
    }
    return out
}

function loadNamespace(lang, ns) {
    const path = join(LOCALES_DIR, lang, ns)
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw)
}

function main() {
    const langs = readdirSync(LOCALES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()

    if (langs.length < 2) {
        console.log(`only one language (${langs[0]}); nothing to compare`)
        process.exit(0)
    }

    // Use the first language as the reference for the file list. We separately
    // verify that every other language ships the same files.
    const referenceLang = langs[0]
    const referenceFiles = readdirSync(join(LOCALES_DIR, referenceLang)).filter((f) => f.endsWith('.json')).sort()

    let drift = false

    for (const lang of langs.slice(1)) {
        const files = readdirSync(join(LOCALES_DIR, lang)).filter((f) => f.endsWith('.json')).sort()

        const missing = referenceFiles.filter((f) => !files.includes(f))
        const extra = files.filter((f) => !referenceFiles.includes(f))
        if (missing.length || extra.length) {
            drift = true
            console.error(`✗ namespace files differ between ${referenceLang} and ${lang}`)
            if (missing.length) console.error(`  missing in ${lang}/: ${missing.join(', ')}`)
            if (extra.length)   console.error(`  extra   in ${lang}/: ${extra.join(', ')}`)
        }
    }

    for (const ns of referenceFiles) {
        const baseline = collectKeys(loadNamespace(referenceLang, ns))
        for (const lang of langs.slice(1)) {
            let other
            try {
                other = collectKeys(loadNamespace(lang, ns))
            } catch (err) {
                console.error(`✗ ${lang}/${ns}: cannot read (${err.message})`)
                drift = true
                continue
            }
            const missing = [...baseline].filter((k) => !other.has(k))
            const extra = [...other].filter((k) => !baseline.has(k))
            if (missing.length || extra.length) {
                drift = true
                console.error(`✗ key drift: ${ns}`)
                if (missing.length) console.error(`  missing in ${lang}: ${missing.join(', ')}`)
                if (extra.length)   console.error(`  extra   in ${lang}: ${extra.join(', ')}`)
            }
        }
    }

    if (drift) {
        console.error('\ni18n parity check failed — see drift above.')
        process.exit(1)
    }
    console.log(`✓ i18n parity OK across ${langs.length} languages, ${referenceFiles.length} namespaces`)
}

main()
