const KEY = 'nova.assets.v1'
const TAB_KEY = 'nova.assets.tab'

const US_BOND_TICKERS = new Set([
  'TLT', 'TBT', 'TMF', 'TTT', 'UBT', 'TYO', 'TMV', 'TBF',
  'BND', 'BNDX', 'BNDW', 'AGG', 'AGGH', 'SCHZ', 'SPAB',
  'LQD', 'LQDH', 'HYG', 'HYGH', 'JNK', 'SJNK', 'HYLB', 'USHY',
  'IEF', 'IEI', 'SHY', 'SHV', 'BSV', 'BIV', 'BLV', 'TLH',
  'GOVT', 'TIP', 'TIPS', 'VTIP', 'SCHP', 'STIP',
  'SGOV', 'BIL', 'TBIL', 'USFR', 'TFLO',
  'VCIT', 'VCSH', 'VGIT', 'VGLT', 'VGSH', 'VCLT',
  'MBB', 'MUB', 'VTEB', 'TFI', 'HYD',
  'EMB', 'VWOB', 'EMLC', 'PCY',
  'IGSB', 'IGIB', 'IGLB', 'FLOT', 'NEAR', 'MINT',
  'SPTL', 'SPTI', 'SPTS', 'ZROZ', 'EDV', 'BKLN',
])

/** @typedef {'tw' | 'us' | 'alloc'} AssetTab */
/** @typedef {'liquid' | 'invest' | 'debt'} AssetCategory */

/**
 * @typedef {object} DebtItem
 * @property {string} id
 * @property {string} name
 * @property {number} amount
 * @property {boolean} excluded
 * @property {number} updatedAt
 */

/**
 * @typedef {object} AssetStore
 * @property {boolean} hidden
 * @property {AssetCategory | null} expanded
 * @property {{ twd: number, usd: number, twdUpdatedAt: number, usdUpdatedAt: number, usdTwdRate: number | null, rateUpdatedAt: number }} liquid
 * @property {DebtItem[]} debts
 */

function uid(prefix = 'a') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function defaultStore() {
  const now = Date.now()
  return {
    hidden: false,
    expanded: null,
    liquid: {
      twd: 0,
      usd: 0,
      twdUpdatedAt: now,
      usdUpdatedAt: now,
      usdTwdRate: null,
      rateUpdatedAt: 0,
    },
    debts: [],
  }
}

function sanitizeDebt(item) {
  if (!item || typeof item !== 'object') return null
  const name = String(item.name || '').trim()
  const amount = Number(item.amount)
  if (!name || !Number.isFinite(amount)) return null
  return {
    id: String(item.id || uid('d')),
    name,
    amount,
    excluded: Boolean(item.excluded),
    updatedAt: Number(item.updatedAt) || Date.now(),
  }
}

function sanitizeStore(raw) {
  const base = defaultStore()
  if (!raw || typeof raw !== 'object') return base
  const liquid = raw.liquid && typeof raw.liquid === 'object' ? raw.liquid : {}
  const twd = Number(liquid.twd)
  const usd = Number(liquid.usd)
  const rate = Number(liquid.usdTwdRate)
  return {
    hidden: Boolean(raw.hidden),
    expanded: raw.expanded === 'liquid' || raw.expanded === 'invest' || raw.expanded === 'debt'
      ? raw.expanded
      : null,
    liquid: {
      twd: Number.isFinite(twd) && twd >= 0 ? twd : 0,
      usd: Number.isFinite(usd) && usd >= 0 ? usd : 0,
      twdUpdatedAt: Number(liquid.twdUpdatedAt) || base.liquid.twdUpdatedAt,
      usdUpdatedAt: Number(liquid.usdUpdatedAt) || base.liquid.usdUpdatedAt,
      usdTwdRate: Number.isFinite(rate) && rate > 0 ? rate : null,
      rateUpdatedAt: Number(liquid.rateUpdatedAt) || 0,
    },
    debts: (Array.isArray(raw.debts) ? raw.debts : []).map(sanitizeDebt).filter(Boolean),
  }
}

function readStore() {
  try {
    return sanitizeStore(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch {
    return defaultStore()
  }
}

function writeStore(store) {
  const next = sanitizeStore(store)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function getAssetStore() {
  return readStore()
}

export function replaceAssetStore(next) {
  return writeStore(next && typeof next === 'object' ? next : defaultStore())
}

export function setAmountsHidden(hidden) {
  const store = readStore()
  store.hidden = Boolean(hidden)
  return writeStore(store)
}

/** @param {AssetCategory | null} category */
export function setExpandedCategory(category) {
  const store = readStore()
  store.expanded = category === store.expanded ? null : category
  return writeStore(store)
}

/** @param {AssetCategory} category */
export function expandCategory(category) {
  const store = readStore()
  store.expanded = category
  return writeStore(store)
}

export function setLiquidTwd(amount) {
  const store = readStore()
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) throw new Error('台幣金額無效')
  store.liquid.twd = n
  store.liquid.twdUpdatedAt = Date.now()
  return writeStore(store)
}

export function setLiquidUsd(amount) {
  const store = readStore()
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) throw new Error('美金金額無效')
  store.liquid.usd = n
  store.liquid.usdUpdatedAt = Date.now()
  return writeStore(store)
}

export function setUsdTwdRate(rate) {
  const store = readStore()
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0) return store
  store.liquid.usdTwdRate = n
  store.liquid.rateUpdatedAt = Date.now()
  return writeStore(store)
}

/**
 * @param {{ name: string, amount: number, excluded?: boolean }} input
 */
export function addDebt(input) {
  const store = readStore()
  const item = sanitizeDebt({
    id: uid('d'),
    name: input.name,
    amount: input.amount,
    excluded: input.excluded,
    updatedAt: Date.now(),
  })
  if (!item) throw new Error('負債資料無效')
  store.debts.push(item)
  return writeStore(store)
}

/**
 * @param {string} id
 * @param {Partial<{ name: string, amount: number, excluded: boolean }>} patch
 */
export function updateDebt(id, patch) {
  const store = readStore()
  const idx = store.debts.findIndex((d) => d.id === id)
  if (idx < 0) throw new Error('找不到此負債')
  const next = sanitizeDebt({ ...store.debts[idx], ...patch, id, updatedAt: Date.now() })
  if (!next) throw new Error('負債資料無效')
  store.debts[idx] = next
  return writeStore(store)
}

export function removeDebt(id) {
  const store = readStore()
  store.debts = store.debts.filter((d) => d.id !== id)
  return writeStore(store)
}

/** @returns {AssetTab} */
export function getAssetTab() {
  const raw = localStorage.getItem(TAB_KEY)
  return raw === 'us' || raw === 'alloc' || raw === 'tw' ? raw : 'tw'
}

/** @param {AssetTab} tab */
export function setAssetTab(tab) {
  const next = tab === 'us' || tab === 'alloc' || tab === 'tw' ? tab : 'tw'
  localStorage.setItem(TAB_KEY, next)
  return next
}

export function isBondLike(symbol, name = '') {
  const s = String(symbol || '').toUpperCase()
  const n = String(name || '')
  if (/^\d{4,6}B\.(TW|TWO)$/.test(s)) return true
  if (/債/.test(n)) return true
  const base = s.replace(/\.(TW|TWO|US)$/i, '')
  if (US_BOND_TICKERS.has(base)) return true
  if (/(bond|treasury|t-bill|gilt)/i.test(n)) return true
  if (/(BOND|TREASURY)/.test(base)) return true
  return false
}

export function formatMoney(n, { digits = 0 } = {}) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n * 10 ** digits) / 10 ** digits === n || digits === 0
    ? n.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    : n.toLocaleString('zh-TW', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
}

export function formatUpdateLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${md} 更新`
  return `${md} 更新`
}
