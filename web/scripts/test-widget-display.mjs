import assert from 'node:assert/strict'
import { marketPrice, formatMarketPrice, financialRowState } from '../src/utils/financialDisplay.ts'
import { weatherCoordinates, weatherLocation, weatherQuery } from '../src/utils/weatherLocation.ts'
import { getWidgetSources, getWidgetSourceErrors } from '../src/utils/widgetSources.ts'

const quote = { symbol: '0700.HK', kind: 'stock', changePct24h: 1, series: [] }
assert.deepEqual(marketPrice({ ...quote, price: 500, currency: 'HKD' }, quote.symbol), { price: 500, currency: 'HKD' })
assert.match(formatMarketPrice({ ...quote, price: 500, currency: 'HKD' }, quote.symbol, 'en'), /HKD/)
assert.match(formatMarketPrice({ ...quote, price: 500, currency: 'HKD' }, quote.symbol, 'zh'), /HKD/)
assert.deepEqual(marketPrice({ ...quote, priceUsd: 500 }, quote.symbol), { price: 500, currency: 'HKD' })
assert.deepEqual(marketPrice({ ...quote, priceUsd: 100 }, 'AAPL'), { price: 100, currency: 'USD' })
assert.deepEqual(marketPrice({ ...quote, price: 90, priceUsd: 100, currency: 'EUR' }, 'SAP'), { price: 90, currency: 'EUR' })
assert.equal(marketPrice({ ...quote, priceUsd: 500, currency: 'HKD' }, quote.symbol), null)
assert.deepEqual(marketPrice({ ...quote, price: 500, priceUsd: 1, currency: 'HKD' }, quote.symbol), { price: 500, currency: 'HKD' })
for (const price of [0, -1, NaN, Infinity, '100']) {
    assert.equal(marketPrice({ ...quote, price }, quote.symbol), null)
}
assert.equal(marketPrice({ ...quote, price: 0, priceUsd: 100 }, quote.symbol), null)
assert.equal(formatMarketPrice(undefined, 'AAPL', 'en'), null)
assert.equal(financialRowState(false, { pending: true }), 'pending')
assert.equal(financialRowState(false, { error: 'failed' }), 'unavailable')
assert.equal(financialRowState(false, undefined, false), 'unavailable', 'Missing rows in completed responses are unavailable')
assert.equal(financialRowState(false, undefined, true), 'pending')
assert.equal(financialRowState(true, { pending: true, error: 'failed' }), 'ready', 'Refreshes retain valid cached values')
assert.equal(financialRowState(false, { pending: true }, false, 'failed'), 'unavailable', 'A failed refresh must not leave a retained pending row loading')

assert.deepEqual(getWidgetSources({ sources: [{ source: 'Official', sourceUrl: 'https://example.com/' }, { source: 'Unsafe', sourceUrl: 'javascript:alert(1)' }] }), [
    { source: 'Official', sourceUrl: 'https://example.com/' }, { source: 'Unsafe', sourceUrl: undefined },
])
assert.deepEqual(getWidgetSourceErrors({ sourceErrors: [{ source: 'Feed', error: 'Timed out' }, null, { source: 'Bad', error: 42 }] }), [{ source: 'Feed', error: 'Timed out' }])
assert.deepEqual(getWidgetSources(null), [])

const option = { displayName: 'Paris, France', lat: 48.8566, lon: 2.3522 }
const selected = weatherLocation(option.displayName, option)
assert.deepEqual(selected, { city: option.displayName, lat: option.lat, lon: option.lon })
assert.deepEqual(weatherLocation('Paris, Texas '), { city: 'Paris, Texas ' }, 'Editing text invalidates coordinates without trimming keystrokes')
assert.deepEqual(weatherCoordinates({ lat: 0, lon: 0 }), { lat: 0, lon: 0 })
for (const value of [{ lat: 91, lon: 1 }, { lat: 1, lon: -181 }, { lat: '1', lon: 2 }, { lat: NaN, lon: 2 }, { lat: 1 }]) {
    assert.deepEqual(weatherCoordinates(value), {})
}
assert.deepEqual(Object.fromEntries(weatherQuery(selected, 'en')), {
    city: option.displayName, lang: 'en', lat: '48.8566', lon: '2.3522',
})
assert.deepEqual(Object.fromEntries(weatherQuery({ city: ' Shanghai ' }, 'zh')), { city: 'Shanghai', lang: 'zh' })
assert.deepEqual(Object.fromEntries(weatherQuery({ city: 'Paris', lat: 48.8 }, 'en')), { city: 'Paris', lang: 'en' })
console.log('Widget display and weather-coordinate smoke tests passed')
