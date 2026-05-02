#!/usr/bin/env node
/**
 * Lints the widget registry by parsing widget files directly.
 * Avoids circular dependency issues that arise from importing the registry module.
 *
 * Catches:
 *  - Duplicate `kind` values across widgets
 *  - Missing labelKey i18n entries (referenced labelKey not defined in en/zh)
 *  - fetchData / pollIntervalMs type mismatches
 *
 * Run via:
 *   npm run check:widgets
 * which expands to:
 *   node --import tsx scripts/check-widget-registry.mjs
 *
 * Mirrors the style of check-i18n-parity.mjs.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = join(__dirname, '..', 'src', 'i18n', 'locales')
const WIDGETS_DIR = join(__dirname, '..', 'src', 'components', 'widgets')
const REGISTRY_PATH = join(__dirname, '..', 'src', 'widgets', 'registry.ts')

function loadJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'))
}

function lookupKey(json, dottedKey) {
    return dottedKey.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), json)
}

function extractWidgetDefinitions() {
    const widgets = []

    // Scan all .tsx files in the widgets directory
    const files = readdirSync(WIDGETS_DIR).filter((f) => f.endsWith('Widget.tsx') && f !== 'MetricsWidget.tsx')

    for (const file of files) {
        const filePath = join(WIDGETS_DIR, file)
        const content = readFileSync(filePath, 'utf8')

        // Extract the defineWidget call at the end of the file
        const defineWidgetMatch = content.match(
            /export const (\w+)\s*=\s*defineWidget[^{]*?\{([\s\S]*?)\}\s*\)/,
        )

        if (!defineWidgetMatch) {
            // Skip files without a defineWidget export (shouldn't happen)
            continue
        }

        // Extract kind and labelKey from the widget definition
        const widgetBody = defineWidgetMatch[2]

        const kindMatch = widgetBody.match(/kind:\s*['"]([^'"]+)['"]/)
        const labelKeyMatch = widgetBody.match(/labelKey:\s*['"]([^'"]+)['"]/)
        const hasFetchData = /fetchData\s*[:=]/i.test(widgetBody)
        const pollIntervalMatch = widgetBody.match(/pollIntervalMs\s*[:=]\s*([^,}]+)/)

        if (kindMatch && labelKeyMatch) {
            const kind = kindMatch[1]
            const labelKey = labelKeyMatch[1]
            const pollInterval = pollIntervalMatch ? pollIntervalMatch[1].trim() : undefined

            widgets.push({
                kind,
                labelKey,
                hasFetchData,
                pollInterval,
                file,
            })
        }
    }

    return widgets
}

function main() {
    const widgets = extractWidgetDefinitions()

    const enWidgets = loadJson(join(LOCALES_DIR, 'en', 'widgets.json'))
    const zhWidgets = loadJson(join(LOCALES_DIR, 'zh', 'widgets.json'))

    let failed = 0

    // 1. Duplicate kind detection
    const seen = new Map()
    for (const w of widgets) {
        if (seen.has(w.kind)) {
            console.error(`✗ duplicate kind '${w.kind}'`)
            failed++
        }
        seen.set(w.kind, w)
    }

    // 2. labelKey resolution. labelKey is `widgets:<key>` — look up <key> in
    // both en/widgets.json and zh/widgets.json.
    for (const w of widgets) {
        if (!w.labelKey.startsWith('widgets:')) {
            console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' must start with 'widgets:'`)
            failed++
            continue
        }
        const innerKey = w.labelKey.slice('widgets:'.length)
        if (!lookupKey(enWidgets, innerKey)) {
            console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' missing from en/widgets.json`)
            failed++
        }
        if (!lookupKey(zhWidgets, innerKey)) {
            console.error(`✗ ${w.kind}: labelKey '${w.labelKey}' missing from zh/widgets.json`)
            failed++
        }
    }

    // 3. pollIntervalMs vs fetchData consistency
    for (const w of widgets) {
        if (w.pollInterval === undefined) continue
        if (!w.hasFetchData) {
            console.error(`✗ ${w.kind}: pollIntervalMs set but no fetchData — invalid combination`)
            failed++
            continue
        }
        // Check if it's a number or a function reference (can't fully validate at static analysis time)
        const isNumberLike = /^\d+$/.test(w.pollInterval)
        const isFunctionRef = /^\w+/.test(w.pollInterval) || w.pollInterval.includes('(')
        if (!isNumberLike && !isFunctionRef) {
            console.error(`✗ ${w.kind}: pollIntervalMs must be number | function | undefined, got: ${w.pollInterval}`)
            failed++
        }
    }

    if (failed > 0) {
        console.error(`\n${failed} registry issue(s) found`)
        process.exit(1)
    }
    console.log(`✓ widget registry OK (${widgets.length} widgets)`)
}

main()
