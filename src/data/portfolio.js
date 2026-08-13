import { normalizeSymbol } from './symbols.js'

const KEY = 'nova.portfolio.v1'

/** @typedef {'spot' | 'margin'} HoldingType */

/**
 * @typedef {object} Holding
 * @property {string} id
 * @property {string} symbol
 * @property {HoldingType} type
 * @property {number} shares
 * @property {number} costPrice
 * @property {number} createdAt
 */

function uid() {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function defaultStore() {
  return { holdings: [] }
}

/**
 * @returns {{ holdings: Holding[] }}
 */
function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && Array.isArray(raw.holdings)) {
      return {
        holdings: raw.holdings
          .map((h) => sanitizeHolding(h))
          .filter(Boolean),
      }
    }
  } catch {
    /* ignore */
  }
  return defaultStore()
}

/**
 * @param {any} h
 * @returns {Holding | null}
 */
function sanitizeHolding(h) {
  if (!h || typeof h !== 'object') return null
  const symbol = normalizeSymbol(h.symbol) || String(h.symbol || '').trim()
  const shares = Number(h.shares)
  const costPrice = Number(h.costPrice)
  if (!symbol || !Number.isFinite(shares) || shares <= 0) return null
  if (!Number.isFinite(costPrice) || costPrice < 0) return null
  const type = h.type === 'margin' ? 'margin' : 'spot'
  return {
    id: String(h.id || uid()),
    symbol,
    type,
    shares,
    costPrice,
    createdAt: Number(h.createdAt) || Date.now(),
  }
}

/**
 * @param {{ holdings: Holding[] }} store
 */
function writeStore(store) {
  localStorage.setItem(KEY, JSON.stringify(store))
  return store
}

/** @returns {Holding[]} */
export function getHoldings() {
  return readStore().holdings
}

/**
 * 覆蓋寫入庫存（備份匯入用）
 * @param {{ holdings?: any[] } | any[]} next
 */
export function replacePortfolioStore(next) {
  const list = Array.isArray(next) ? next : next?.holdings
  const holdings = (Array.isArray(list) ? list : [])
    .map((h) => sanitizeHolding(h))
    .filter(Boolean)
  writeStore({ holdings })
  return holdings
}

/**
 * @param {{ symbol: string, shares: number, costPrice: number, type?: HoldingType }} input
 */
export function addHolding(input) {
  const store = readStore()
  const holding = sanitizeHolding({
    id: uid(),
    symbol: input.symbol,
    shares: input.shares,
    costPrice: input.costPrice,
    type: input.type,
    createdAt: Date.now(),
  })
  if (!holding) throw new Error('庫存資料無效')
  store.holdings.push(holding)
  writeStore(store)
  return holding
}

/**
 * @param {string} id
 * @param {Partial<{ symbol: string, shares: number, costPrice: number, type: HoldingType }>} patch
 */
export function updateHolding(id, patch) {
  const store = readStore()
  const idx = store.holdings.findIndex((h) => h.id === id)
  if (idx < 0) throw new Error('找不到此庫存')
  const next = sanitizeHolding({ ...store.holdings[idx], ...patch, id })
  if (!next) throw new Error('庫存資料無效')
  store.holdings[idx] = next
  writeStore(store)
  return next
}

/** @param {string} id */
export function removeHolding(id) {
  const store = readStore()
  store.holdings = store.holdings.filter((h) => h.id !== id)
  writeStore(store)
  return store.holdings
}
