import { getSymbolMeta, resolveDisplayName } from './symbols.js'
import { isTaiwanSymbol, fetchTwseQuotes } from './twse.js'

const SETTINGS_KEY = 'nova.settings'

export function getSettings() {
  try {
    return {
      proxyBase: '',
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
    }
  } catch {
    return { proxyBase: '' }
  }
}

export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

/**
 * 覆蓋寫入頁面設定（不做 merge；匯入後以檔案內容為準）
 * @param {any} next
 */
export function replaceSettings(next = {}) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    next = {}
  }
  // 確保 proxyBase 為字串（其餘欄位沿用 getSettings 的結構）
  const proxyBase = typeof next.proxyBase === 'string' ? next.proxyBase.trim() : ''
  const rest = { ...next, proxyBase }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest))
  return getSettings()
}

function yahooBase() {
  const { proxyBase } = getSettings()
  if (proxyBase) return proxyBase.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/api/yahoo'
  return ''
}

async function fetchViaCorsProxy(url) {
  const proxies = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ]

  let lastError
  for (const build of proxies) {
    try {
      const res = await fetch(build(url))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('無法取得行情資料')
}

async function yahooFetch(pathAndQuery) {
  const base = yahooBase()
  const absolute = `https://query1.finance.yahoo.com${pathAndQuery}`

  if (base) {
    const res = await fetch(`${base}${pathAndQuery}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  // 生產環境無自訂代理時，走公開 CORS 代理
  return fetchViaCorsProxy(absolute)
}

function num(v, fallback = null) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function fetchYahooQuotes(symbols) {
  const list = [...new Set(symbols.filter(Boolean))]
  if (!list.length) return []

  try {
    const data = await yahooFetch(
      `/v7/finance/spark?symbols=${encodeURIComponent(list.join(','))}&range=1d&interval=1d`,
    )
    return mapSparkResults(data?.spark?.result || [])
  } catch (err) {
    // 無效代號單獨請求常回 404；改逐檔抓，略過失敗項
    console.warn('Yahoo 批次報價失敗，改逐檔載入', err)
    const out = []
    for (const symbol of list) {
      try {
        const data = await yahooFetch(
          `/v7/finance/spark?symbols=${encodeURIComponent(symbol)}&range=1d&interval=1d`,
        )
        out.push(...mapSparkResults(data?.spark?.result || []))
      } catch {
        /* skip invalid symbol */
      }
    }
    return out
  }
}

function mapSparkResults(results) {
  return results.map((item) => {
    const meta = item.response?.[0]?.meta || {}
    const price = num(meta.regularMarketPrice)
    const prev = num(meta.chartPreviousClose ?? meta.previousClose)
    const change = price != null && prev != null ? price - prev : null
    const changePercent = change != null && prev ? (change / prev) * 100 : null

    return {
      symbol: item.symbol || meta.symbol,
      name: resolveDisplayName(
        item.symbol || meta.symbol,
        meta.shortName,
        meta.longName,
        getSymbolMeta(item.symbol || meta.symbol)?.name,
      ),
      price,
      change,
      changePercent,
      open: null,
      high: num(meta.regularMarketDayHigh),
      low: num(meta.regularMarketDayLow),
      volume: num(meta.regularMarketVolume, 0),
      previousClose: prev,
      currency: meta.currency || '',
      marketState: '',
      source: 'yahoo',
    }
  })
}

/**
 * 混搭報價：台股走證交所（接近即時），美股走 Yahoo（約延遲 15 分鐘）
 */
export async function fetchQuotes(symbols) {
  const list = [...new Set(symbols.filter(Boolean))]
  if (!list.length) return []

  const tw = list.filter(isTaiwanSymbol)
  const us = list.filter((s) => !isTaiwanSymbol(s))

  const [twResult, usResult] = await Promise.allSettled([
    tw.length
      ? fetchTwseQuotes(tw).catch(async (err) => {
          console.warn('台股即時失敗，改走 Yahoo', err)
          return fetchYahooQuotes(tw)
        })
      : Promise.resolve([]),
    us.length ? fetchYahooQuotes(us) : Promise.resolve([]),
  ])

  const twQuotes = twResult.status === 'fulfilled' ? twResult.value : []
  const usQuotes = usResult.status === 'fulfilled' ? usResult.value : []

  const bySymbol = new Map()
  for (const q of [...twQuotes, ...usQuotes]) {
    if (q?.symbol) bySymbol.set(q.symbol, q)
  }

  // 台股若證交所漏檔，補 Yahoo
  const missingTw = tw.filter((s) => !bySymbol.has(s))
  if (missingTw.length) {
    try {
      for (const q of await fetchYahooQuotes(missingTw)) {
        if (q?.symbol) bySymbol.set(q.symbol, { ...q, source: 'yahoo-fallback' })
      }
    } catch {
      /* ignore */
    }
  }

  return list.map((symbol) => bySymbol.get(symbol)).filter(Boolean)
}

/** 單檔詳細報價：台股優先證交所，美股／K 線細節用 Yahoo 補齊 */
export async function fetchQuote(symbol) {
  if (isTaiwanSymbol(symbol)) {
    try {
      const [tw] = await fetchTwseQuotes([symbol])
      // 只要證交所有回傳該檔就採用（即使尚無成交價）；勿因 price 為空改走 Yahoo
      if (tw) return tw
    } catch (err) {
      console.warn('台股即時報價失敗', err)
    }
  }

  const data = await fetchChart(symbol, { interval: '1d', range: '5d' })
  const last = data.candles[data.candles.length - 1]
  const prevCandle = data.candles[data.candles.length - 2]
  const price = data.regularMarketPrice ?? last?.close ?? null
  const prev = data.chartPreviousClose ?? prevCandle?.close ?? null
  const change = price != null && prev != null ? price - prev : null
  const changePercent = change != null && prev ? (change / prev) * 100 : null

  return {
    symbol: data.symbol || symbol,
    name: resolveDisplayName(symbol, data.name, getSymbolMeta(symbol)?.name),
    price,
    change,
    changePercent,
    open: last?.open ?? null,
    high: data.dayHigh ?? last?.high ?? null,
    low: data.dayLow ?? last?.low ?? null,
    volume: data.volume || last?.volume || 0,
    previousClose: prev,
    currency: data.currency || '',
    marketState: '',
    source: 'yahoo',
  }
}

/**
 * @param {string} symbol
 * @param {{ interval: string, range: string }} opts
 */
export async function fetchChart(symbol, { interval = '1d', range = '6mo' } = {}) {
  const data = await yahooFetch(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`,
  )

  const result = data?.chart?.result?.[0]
  if (!result) {
    const err = data?.chart?.error?.description || '查無圖表資料'
    throw new Error(err)
  }

  const ts = result.timestamp || []
  const quote = result.indicators?.quote?.[0] || {}
  const meta = result.meta || {}
  const useBusinessDay = interval === '1d' || interval === '1wk' || interval === '1mo'

  const gmtOffset = meta.gmtoffset || 0
  const candles = []
  for (let i = 0; i < ts.length; i++) {
    const open = num(quote.open?.[i])
    const high = num(quote.high?.[i])
    const low = num(quote.low?.[i])
    const close = num(quote.close?.[i])
    const volume = num(quote.volume?.[i], 0)
    // 台股 13:25 收盤集合競價時，Yahoo 分時常給 null 或 0 的假 K 棒
    if (open == null || high == null || low == null || close == null) continue
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue

    candles.push({
      time: useBusinessDay ? toBusinessDay(ts[i], gmtOffset) : ts[i],
      open,
      high,
      low,
      close,
      volume,
    })
  }

  // Yahoo 台股 13:30 收盤集合競價棒常有價無量；用全日總量補回差額
  if (!useBusinessDay && isTaiwanSymbol(symbol) && interval === '1m') {
    patchTaiwanClosingVolume(candles, num(meta.regularMarketVolume, 0), gmtOffset)
  }

  return {
    symbol: meta.symbol || symbol,
    name: resolveDisplayName(
      symbol,
      meta.shortName,
      meta.longName,
      getSymbolMeta(symbol)?.name,
    ),
    currency: meta.currency || '',
    exchangeName: meta.exchangeName || '',
    instrumentType: meta.instrumentType || '',
    regularMarketPrice: num(meta.regularMarketPrice),
    chartPreviousClose: num(meta.chartPreviousClose ?? meta.previousClose),
    dayHigh: num(meta.regularMarketDayHigh),
    dayLow: num(meta.regularMarketDayLow),
    volume: num(meta.regularMarketVolume, 0),
    candles,
    source: 'yahoo',
  }
}

/** Yahoo timestamp → Lightweight Charts business day（依交易所時區） */
function toBusinessDay(unixSec, gmtOffsetSec) {
  const d = new Date((unixSec + gmtOffsetSec) * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 交易所時區下的 HH:mm */
function exchangeClock(unixSec, gmtOffsetSec) {
  const d = new Date((unixSec + gmtOffsetSec) * 1000)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), day: toBusinessDay(unixSec, gmtOffsetSec) }
}

/**
 * 台股 Yahoo 1 分 K：13:30 收盤棒 volume 常為 0。
 * 以 meta.regularMarketVolume − 當日其餘分時量 回填收盤集合競價量。
 */
function patchTaiwanClosingVolume(candles, dayVolume, gmtOffsetSec) {
  if (!candles.length || !(dayVolume > 0)) return

  const last = candles[candles.length - 1]
  if (typeof last.time !== 'number' || last.volume > 0) return

  const clock = exchangeClock(last.time, gmtOffsetSec)
  if (clock.hour !== 13 || clock.minute !== 30) return

  let sum = 0
  for (const c of candles) {
    if (typeof c.time !== 'number') continue
    if (exchangeClock(c.time, gmtOffsetSec).day === clock.day) sum += c.volume || 0
  }

  const missing = dayVolume - sum
  if (missing > 0) last.volume = missing
}

export async function searchYahoo(query) {
  const q = String(query || '').trim()
  if (!q) return []

  const data = await yahooFetch(
    `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`,
  )

  const quotes = data?.quotes || []
  return quotes
    .filter((item) => item.symbol && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(item.quoteType))
    .map((item) => ({
      symbol: item.symbol,
      name: item.shortname || item.longname || item.symbol,
      exchange: item.exchDisp || item.exchange || '',
      type: item.quoteType || '',
      market: /\.TW|\.TWO|TAI/.test(`${item.symbol}${item.exchange || ''}`) ? 'TW' : 'US',
    }))
}

/** K 線週期：label 是顯示名；range 是實際向 Yahoo 抓的歷史量（夠 zoom out） */
export const PERIODS = [
  { id: '1d', label: '當日', interval: '1m', range: '1d', kind: 'intraday' },
  { id: '3d', label: '三日', interval: '1m', range: '7d', kind: 'intraday', tradingDays: 3 },
  { id: '5d', label: '五日', interval: '1m', range: '7d', kind: 'intraday', tradingDays: 5 },
  { id: '1mo', label: '月', interval: '1d', range: '2y', viewBars: 28, kind: 'daily' },
  { id: '3mo', label: '季', interval: '1d', range: '5y', viewBars: 65, kind: 'daily' },
  { id: '6mo', label: '半年', interval: '1d', range: '5y', viewBars: 130, kind: 'daily' },
  // Yahoo 對 range=max 常強制降採樣成 1mo/3mo，日／周K 改用 10y 才能拿到正確粒度
  { id: '1y', label: '一年', interval: '1d', range: '10y', viewBars: 260, kind: 'daily' },
  { id: 'daily', label: '日K', interval: '1d', range: '10y', viewBars: 130, kind: 'daily' },
  { id: 'weekly', label: '周K', interval: '1wk', range: '10y', viewBars: 104, kind: 'weekly' },
  { id: 'monthly', label: '月K', interval: '1mo', range: 'max', viewBars: 120, kind: 'monthly' },
]
