import { getSymbolMeta, resolveDisplayName } from './symbols.js'

/** 常見以 .TW 出現但實際為上櫃的代號（可再擴充） */
const KNOWN_OTC = new Set([
  '6488', '4966', '8299', '5274', '3529', '3105', '3227', '6548', '8069',
])

export function isTaiwanSymbol(symbol) {
  const s = String(symbol || '')
  return /\.(TW|TWO)$/i.test(s) || s === '^TWII' || s === '^TWOII'
}

/** Yahoo 代號 → 證交所 ex_ch（如 tse_2330.tw） */
export function toTwseExCh(symbol) {
  if (symbol === '^TWII') return 'tse_t00.tw'
  if (symbol === '^TWOII') return 'otc_o00.tw'

  const m = String(symbol).match(/^(\d{4,6})\.(TW|TWO)$/i)
  if (!m) return null

  const code = m[1]
  if (m[2].toUpperCase() === 'TWO' || KNOWN_OTC.has(code)) {
    return `otc_${code}.tw`
  }
  return `tse_${code}.tw`
}

/** 證交所回傳代號 → Yahoo 風格 */
export function fromTwseCode(code, exchange) {
  if (code === 't00') return '^TWII'
  if (code === 'o00') return '^TWOII'
  const ex = String(exchange || '').toLowerCase()
  if (ex === 'otc') return `${code}.TWO`
  return `${code}.TW`
}

function twseBase() {
  if (import.meta.env.DEV) return '/api/twse'
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
  throw lastError || new Error('無法取得台股行情')
}

async function twseFetch(exChList) {
  const query = `?ex_ch=${encodeURIComponent(exChList)}&json=1&delay=0`
  const absolute = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp${query}`
  const base = twseBase()

  if (base) {
    const res = await fetch(`${base}/stock/api/getStockInfo.jsp${query}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  return fetchViaCorsProxy(absolute)
}

function parseNum(v) {
  if (v == null || v === '' || v === '-') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 有效成交價（排除 0：收盤集合競價時證交所常把 z 清成 0） */
function positivePrice(v) {
  const n = parseNum(v)
  return n != null && n > 0 ? n : null
}

/** 五檔第一檔（真實 tick，非買賣中價） */
function bestLevel(field) {
  return positivePrice(String(field || '').split('_')[0])
}

/** 同一次瀏覽期間記住各檔最後有效價，供集合競價清空時沿用 */
const lastGoodPriceByKey = new Map()

/**
 * 最新價：優先實際成交價（不含買賣中價，避免半檔 tick）。
 * 13:25 收盤集合競價時 z／pz 常變 0/-，依序改採：
 * 前一筆成交 → 最佳買／賣 → 本次連線快取 → 開盤／昨收。
 */
function lastPrice(row) {
  const key = `${String(row.ex || '').toLowerCase()}_${row.c}`
  const price =
    positivePrice(row.z) ??
    positivePrice(row.pz) ??
    bestLevel(row.b) ??
    bestLevel(row.a) ??
    lastGoodPriceByKey.get(key) ??
    positivePrice(row.o) ??
    positivePrice(row.y)

  if (price != null) lastGoodPriceByKey.set(key, price)
  return price
}

/**
 * @param {string[]} symbols Yahoo 風格台股代號
 */
export async function fetchTwseQuotes(symbols) {
  const list = [...new Set(symbols.filter(Boolean))]
  if (!list.length) return []

  const pairs = list
    .map((symbol) => ({ symbol, exCh: toTwseExCh(symbol) }))
    .filter((p) => p.exCh)

  if (!pairs.length) return []

  // 證交所一次可多檔，以 | 分隔
  const data = await twseFetch(pairs.map((p) => p.exCh).join('|'))
  const rows = data?.msgArray || []

  return rows
    .map((row) => {
      const exChKey = `${String(row.ex || '').toLowerCase()}_${row.c}.tw`
      const requested = pairs.find((p) => p.exCh.toLowerCase() === exChKey)
      const symbol =
        requested?.symbol ||
        list.find((s) => {
          const code = String(s).replace(/\.(TW|TWO)$/i, '').replace(/^\^/, '')
          return code === row.c || (row.c === 't00' && s === '^TWII') || (row.c === 'o00' && s === '^TWOII')
        }) ||
        fromTwseCode(row.c, row.ex)

      const price = lastPrice(row)
      const prev = parseNum(row.y)
      const change = price != null && prev != null ? price - prev : null
      const changePercent = change != null && prev ? (change / prev) * 100 : null
      // 成交量：個股多為「張」，指數單位不同；顯示用原始值
      const volume = parseNum(row.v) ?? 0

      return {
        symbol,
        name: resolveDisplayName(symbol, row.n, row.nf, getSymbolMeta(symbol)?.name),
        price,
        change,
        changePercent,
        open: parseNum(row.o),
        high: parseNum(row.h),
        low: parseNum(row.l),
        volume,
        previousClose: prev,
        currency: 'TWD',
        marketState: 'TWSE',
        source: 'twse',
      }
    })
    .filter((q) => q.symbol)
}
