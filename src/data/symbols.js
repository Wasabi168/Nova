/** 預設標的清單：指數、ETF、熱門個股 */

export const MARKET_SECTIONS = [
  {
    id: 'tw-index',
    title: '台股指數',
    items: [
      { symbol: '^TWII', name: '加權指數', market: 'TW' },
      { symbol: '^TWOII', name: '櫃買指數', market: 'TW' },
    ],
  },
  {
    id: 'us-index',
    title: '美股指數',
    items: [
      { symbol: '^DJI', name: 'Dow Jones', market: 'US' },
      { symbol: '^GSPC', name: 'S&P 500', market: 'US' },
      { symbol: '^IXIC', name: 'Nasdaq', market: 'US' },
      { symbol: '^SOX', name: 'PHLX Semiconductor', market: 'US' },
      { symbol: '^VIX', name: 'VIX', market: 'US' },
    ],
  },
  {
    id: 'tw-etf',
    title: '台股 ETF',
    items: [
      { symbol: '0050.TW', name: '元大台灣50', market: 'TW' },
      { symbol: '0056.TW', name: '元大高股息', market: 'TW' },
      { symbol: '00878.TW', name: '國泰永續高股息', market: 'TW' },
      { symbol: '00919.TW', name: '群益台灣精選高息', market: 'TW' },
      { symbol: '006208.TW', name: '富邦台50', market: 'TW' },
      { symbol: '00929.TW', name: '復華台灣科技優息', market: 'TW' },
    ],
  },
  {
    id: 'us-etf',
    title: '美股 ETF',
    items: [
      { symbol: 'SPY', name: 'SPDR S&P 500', market: 'US' },
      { symbol: 'QQQ', name: 'Invesco QQQ', market: 'US' },
      { symbol: 'VOO', name: 'Vanguard S&P 500', market: 'US' },
      { symbol: 'IWM', name: 'iShares Russell 2000', market: 'US' },
      { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', market: 'US' },
      { symbol: 'SOXL', name: 'Direxion Semiconductor Bull 3X', market: 'US' },
    ],
  },
  {
    id: 'tw-stock',
    title: '台股熱門',
    items: [
      { symbol: '2330.TW', name: '台積電', market: 'TW' },
      { symbol: '2317.TW', name: '鴻海', market: 'TW' },
      { symbol: '2454.TW', name: '聯發科', market: 'TW' },
      { symbol: '2308.TW', name: '台達電', market: 'TW' },
      { symbol: '2382.TW', name: '廣達', market: 'TW' },
      { symbol: '2881.TW', name: '富邦金', market: 'TW' },
      { symbol: '2882.TW', name: '國泰金', market: 'TW' },
      { symbol: '2303.TW', name: '聯電', market: 'TW' },
      { symbol: '3711.TW', name: '日月光投控', market: 'TW' },
      { symbol: '2603.TW', name: '長榮', market: 'TW' },
    ],
  },
  {
    id: 'us-stock',
    title: '美股熱門',
    items: [
      { symbol: 'AAPL', name: 'Apple', market: 'US' },
      { symbol: 'MSFT', name: 'Microsoft', market: 'US' },
      { symbol: 'NVDA', name: 'NVIDIA', market: 'US' },
      { symbol: 'GOOGL', name: 'Alphabet', market: 'US' },
      { symbol: 'AMZN', name: 'Amazon', market: 'US' },
      { symbol: 'META', name: 'Meta', market: 'US' },
      { symbol: 'TSLA', name: 'Tesla', market: 'US' },
      { symbol: 'AMD', name: 'AMD', market: 'US' },
      { symbol: 'AVGO', name: 'Broadcom', market: 'US' },
      { symbol: 'TSM', name: 'TSMC ADR', market: 'US' },
    ],
  },
]

export const DEFAULT_WATCHLIST = [
  '2330.TW',
  '0050.TW',
  '2317.TW',
  'AAPL',
  'NVDA',
  'SPY',
  '^TWII',
  '^GSPC',
]

const catalog = new Map()
for (const section of MARKET_SECTIONS) {
  for (const item of section.items) {
    catalog.set(item.symbol, item)
  }
}

export function getSymbolMeta(symbol) {
  return catalog.get(symbol) || null
}

export function getAllSymbols() {
  return [...catalog.values()]
}

function isTwMarket(symbol) {
  const s = String(symbol || '')
  return /\.(TW|TWO)$/i.test(s) || s === '^TWII' || s === '^TWOII'
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''))
}

/**
 * 顯示名稱：台股優先中文，美股優先英文
 * @param {string} symbol
 * @param {...(string|null|undefined)} candidates 遠端／其他備選名稱
 */
export function resolveDisplayName(symbol, ...candidates) {
  const meta = getSymbolMeta(symbol)
  const names = candidates.map((c) => String(c || '').trim()).filter(Boolean)

  if (isTwMarket(symbol)) {
    if (meta?.name && hasCjk(meta.name)) return meta.name
    const zh = names.find(hasCjk)
    if (zh) return zh
    if (meta?.name) return meta.name
    return names[0] || symbol
  }

  const enRemote = names.find((n) => !hasCjk(n))
  if (enRemote) return enRemote
  if (meta?.name && !hasCjk(meta.name)) return meta.name
  if (meta?.name) return meta.name
  return names[0] || symbol
}

/** 報價／圖表資料來源標籤 */
export function formatDataSource(source) {
  switch (source) {
    case 'twse':
      return '台灣證交所（接近即時）'
    case 'yahoo-fallback':
      return 'Yahoo Finance（證交所備援）'
    case 'yahoo':
      return 'Yahoo Finance（約延遲 15 分鐘）'
    default:
      return source ? String(source) : ''
  }
}

/** 將使用者輸入正規成 Yahoo 代號 */
export function normalizeSymbol(input) {
  const raw = String(input || '').trim().toUpperCase()
  if (!raw) return ''

  if (raw.startsWith('^')) return raw

  // 已有市場後綴
  if (/\.(TW|TWO|US)$/i.test(raw)) return raw

  // 純數字 → 台股上市 .TW（4～6 碼）
  if (/^\d{4,6}$/.test(raw)) return `${raw}.TW`

  // 已知別名／常見拼字
  const aliases = {
    TAIEX: '^TWII',
    加權: '^TWII',
    櫃買: '^TWOII',
    NVDIA: 'NVDA',
    NVIDIA: 'NVDA',
  }
  if (aliases[raw]) return aliases[raw]

  return raw
}

export function searchLocal(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  return getAllSymbols().filter((item) => {
    return (
      item.symbol.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.symbol.replace(/\.(TW|TWO)$/i, '').includes(q)
    )
  })
}
