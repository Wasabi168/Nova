import {
  fetchQuotes,
  fetchChart,
  searchYahoo,
  QUOTE_REFRESH_MS,
  quoteCache,
} from '../data/market.js'
import {
  getHoldings,
  addHolding,
  updateHolding,
  removeHolding,
} from '../data/portfolio.js'
import { getSymbolMeta, normalizeSymbol, searchLocal } from '../data/symbols.js'
import { isTaiwanSymbol } from '../data/twse.js'
import { formatPrice, changeClass } from '../utils/format.js'
import { pushSearchHistory } from '../data/watchlist.js'
import { renderAllocation } from './allocation.js'
import { getAssetStore, getAssetTab, setAssetTab, setUsdTwdRate } from '../data/assets.js'

const FX_SYMBOLS = ['TWD=X', 'USDTWD=X']

const SORT_KEY = 'nova.portfolio.sort'
const CURRENCY_KEY = 'nova.portfolio.currency'
const TYPE_LABEL = { spot: '現股', margin: '融資' }

const SORT_COLS = [
  { id: 'name', label: '庫存股', align: 'left' },
  { id: 'todayPL', label: '今日損益', align: 'right' },
  { id: 'price', label: '股價 / 漲跌幅', align: 'right' },
  { id: 'totalPL', label: '總損益', align: 'right' },
  { id: 'shares', label: '股數', align: 'right' },
  { id: 'cost', label: '均價 / 總成本', align: 'right' },
  { id: 'weight', label: '市值 / 佔比', align: 'right' },
  { id: 'ret5', label: '近5日漲幅', align: 'right' },
  { id: 'ret20', label: '近20日漲幅', align: 'right' },
  { id: 'retYtd', label: '今年以來漲幅', align: 'right' },
]

/** @type {Map<string, any[]>} */
const candleCache = new Map()
/** @type {{ key: string, points: { date: string, value: number }[], at: number } | null} */
let chartCache = null
const CHART_CACHE_MS = 10 * 60 * 1000
const CHART_FETCH_CONCURRENCY = 2
const CHART_RANGE = '1y'
const PL_RANGE_KEY = 'nova.portfolio.plRange'
const PL_RANGE_OPTS = [
  { months: 3, label: '3個月' },
  { months: 2, label: '2個月' },
  { months: 1, label: '1個月' },
]

function getDisplayCurrency() {
  const raw = localStorage.getItem(CURRENCY_KEY)
  return raw === 'USD' ? 'USD' : 'TWD'
}

function setDisplayCurrency(next) {
  const value = next === 'USD' ? 'USD' : 'TWD'
  localStorage.setItem(CURRENCY_KEY, value)
  return value
}

function getPlRangeMonths() {
  const n = Number(localStorage.getItem(PL_RANGE_KEY))
  return PL_RANGE_OPTS.some((o) => o.months === n) ? n : 3
}

function setPlRangeMonths(months) {
  const n = Number(months)
  const next = PL_RANGE_OPTS.some((o) => o.months === n) ? n : 3
  localStorage.setItem(PL_RANGE_KEY, String(next))
  return next
}

function getSortState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) || 'null')
    if (raw && SORT_COLS.some((c) => c.id === raw.col)) {
      return { col: raw.col, dir: raw.dir === 'asc' ? 'asc' : 'desc' }
    }
  } catch {
    /* ignore */
  }
  return { col: 'todayPL', dir: 'desc' }
}

function setSortState(state) {
  localStorage.setItem(SORT_KEY, JSON.stringify(state))
  return state
}

function displayCode(symbol) {
  return String(symbol || '').replace(/\.(TW|TWO)$/i, '')
}

function formatSigned(n, { digits = 0, withSign = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  if (!withSign || n === 0) return abs
  return n > 0 ? `+${abs}` : `-${abs}`
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function formatAxis(n) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function formatChartDate(time) {
  if (!time) return ''
  if (typeof time === 'string') {
    const parts = time.split('-')
    if (parts.length >= 3) return `${parts[1]}${parts[2]}`
    return time
  }
  if (typeof time === 'object' && time.month != null) {
    return `${String(time.month).padStart(2, '0')}${String(time.day || 1).padStart(2, '0')}`
  }
  return ''
}

/** hover 提示用：7/13 */
function formatChartTipDate(time) {
  if (!time) return ''
  if (typeof time === 'string') {
    const parts = time.split('-').map(Number)
    if (parts.length >= 3 && parts[1] && parts[2]) return `${parts[1]}/${parts[2]}`
    return time
  }
  if (typeof time === 'object' && time.month != null) {
    return `${Number(time.month)}/${Number(time.day || 1)}`
  }
  return ''
}

/**
 * @param {import('../data/portfolio.js').Holding} holding
 * @param {any} quote
 * @param {{ ret5?: number|null, ret20?: number|null, retYtd?: number|null, weight?: number|null }} [extra]
 */
function enrichHolding(holding, quote, extra = {}) {
  const price = quote?.price ?? null
  const change = quote?.change ?? null
  const changePercent = quote?.changePercent ?? null
  const prevClose = quote?.previousClose ?? (price != null && change != null ? price - change : null)
  const shares = holding.shares
  const cost = holding.costPrice * shares
  const marketValue = price != null ? price * shares : null
  const todayPL = change != null ? change * shares : null
  const todayBase = prevClose != null ? prevClose * shares : null
  const todayPLPercent =
    todayPL != null && todayBase ? (todayPL / todayBase) * 100 : null
  const totalPL = price != null ? (price - holding.costPrice) * shares : null
  const totalPLPercent =
    holding.costPrice > 0 && price != null
      ? ((price - holding.costPrice) / holding.costPrice) * 100
      : null
  const name = quote?.name || getSymbolMeta(holding.symbol)?.name || holding.symbol

  return {
    ...holding,
    name,
    price,
    change,
    changePercent,
    cost,
    marketValue,
    todayPL,
    todayPLPercent,
    totalPL,
    totalPLPercent,
    weight: extra.weight ?? null,
    ret5: extra.ret5 ?? null,
    ret20: extra.ret20 ?? null,
    retYtd: extra.retYtd ?? null,
  }
}

function candleYear(time) {
  if (typeof time === 'string') return Number(time.slice(0, 4)) || null
  if (typeof time === 'object' && time?.year != null) return Number(time.year)
  if (typeof time === 'number') return new Date(time * 1000).getFullYear()
  return null
}

function candleTimeKey(time) {
  if (typeof time === 'string') return time
  if (typeof time === 'object' && time?.year != null) {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day || 1).padStart(2, '0')}`
  }
  return String(time ?? '')
}

/** 近 N 個交易日漲幅（相對 N 根 K 線前收盤） */
function periodReturn(price, candles, tradingDays) {
  if (price == null || !Number.isFinite(price) || !candles?.length) return null
  const idx = candles.length - 1 - tradingDays
  if (idx < 0) return null
  const base = candles[idx]?.close
  if (base == null || !base) return null
  return ((price - base) / base) * 100
}

/** 今年以來：相對今年第一根日 K 收盤 */
function ytdReturn(price, candles) {
  if (price == null || !Number.isFinite(price) || !candles?.length) return null
  const year = new Date().getFullYear()
  let base = null
  for (const c of candles) {
    if (candleYear(c.time) === year && c.close != null) {
      base = c.close
      break
    }
  }
  if (base == null || !base) return null
  return ((price - base) / base) * 100
}

function filterCandlesLastMonths(candles, months = 3) {
  if (!candles?.length) return []
  const last = candles[candles.length - 1]
  const lastKey = candleTimeKey(last?.time)
  const end = lastKey ? new Date(`${lastKey}T00:00:00`) : new Date()
  if (Number.isNaN(end.getTime())) return candles.slice(-66)
  const start = new Date(end)
  start.setMonth(start.getMonth() - months)
  const startMs = start.getTime()
  return candles.filter((c) => {
    const key = candleTimeKey(c.time)
    const d = key ? new Date(`${key}T00:00:00`) : null
    return d && !Number.isNaN(d.getTime()) && d.getTime() >= startMs
  })
}

function summarize(rows) {
  let todayPL = 0
  let todayBase = 0
  let totalPL = 0
  let marketValue = 0
  let totalCost = 0
  let hasToday = false
  let hasMv = false

  for (const r of rows) {
    totalCost += r.cost
    if (r.marketValue != null) {
      marketValue += r.marketValue
      hasMv = true
    }
    if (r.todayPL != null) {
      todayPL += r.todayPL
      hasToday = true
      if (r.price != null && r.change != null) {
        todayBase += (r.price - r.change) * r.shares
      }
    }
    if (r.totalPL != null) totalPL += r.totalPL
  }

  const todayPLPercent = hasToday && todayBase ? (todayPL / todayBase) * 100 : null
  const totalPLPercent = totalCost > 0 && hasMv ? (totalPL / totalCost) * 100 : null

  return {
    todayPL: hasToday ? todayPL : null,
    todayPLPercent,
    totalPL: hasMv ? totalPL : null,
    totalPLPercent,
    marketValue: hasMv ? marketValue : null,
    totalCost,
  }
}

function cmpNullable(a, b) {
  if (a != null && b != null) return a - b
  if (a != null) return -1
  if (b != null) return 1
  return 0
}

function sortRows(rows, col, dir) {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (col === 'name') {
      cmp = String(a.name).localeCompare(String(b.name), 'zh-TW') || a.symbol.localeCompare(b.symbol)
    } else if (col === 'todayPL') cmp = cmpNullable(a.todayPL, b.todayPL)
    else if (col === 'price') cmp = cmpNullable(a.changePercent, b.changePercent)
    else if (col === 'totalPL') cmp = cmpNullable(a.totalPL, b.totalPL)
    else if (col === 'shares') cmp = cmpNullable(a.shares, b.shares)
    else if (col === 'cost') cmp = cmpNullable(a.cost, b.cost)
    else if (col === 'weight') cmp = cmpNullable(a.weight, b.weight)
    else if (col === 'ret5') cmp = cmpNullable(a.ret5, b.ret5)
    else if (col === 'ret20') cmp = cmpNullable(a.ret20, b.ret20)
    else if (col === 'retYtd') cmp = cmpNullable(a.retYtd, b.retYtd)
    return (cmp || a.symbol.localeCompare(b.symbol)) * sign
  })
}

/**
 * 以持股數量 × 日漲跌估算每日損益（假設期間庫存不變）
 * @param {import('../data/portfolio.js').Holding[]} holdings
 * @param {Map<string, any[]>} candlesBySymbol
 * @param {number} months
 */
function buildDailyPL(holdings, candlesBySymbol, months = 3) {
  /** @type {Map<string, number>} */
  const byDate = new Map()
  /** @type {string[]} */
  const dateOrder = []

  for (const h of holdings) {
    const candles = filterCandlesLastMonths(candlesBySymbol.get(h.symbol) || [], months)
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1]?.close
      const cur = candles[i]?.close
      const time = candles[i]?.time
      if (prev == null || cur == null || !time) continue
      const key = candleTimeKey(time)
      const pl = (cur - prev) * h.shares
      if (!byDate.has(key)) {
        byDate.set(key, 0)
        dateOrder.push(key)
      }
      byDate.set(key, byDate.get(key) + pl)
    }
  }

  dateOrder.sort()
  return dateOrder.map((date) => ({ date, value: byDate.get(date) || 0 }))
}

export async function renderPortfolio(root, { navigate }) {
  root.innerHTML = `
    <header class="page-header">
      <div>
        <p class="eyebrow">Nova</p>
        <h1>資產</h1>
      </div>
      <div class="pf-header-actions" id="pf-header-actions">
        <div class="pf-fx-toggle" id="pf-fx-toggle" role="group" aria-label="計價幣別">
          <button type="button" class="chip pf-fx-chip" data-fx="TWD">TWD</button>
          <button type="button" class="chip pf-fx-chip" data-fx="USD">USD</button>
        </div>
        <button class="icon-btn" data-action="refresh" title="重新整理" aria-label="重新整理">↻</button>
      </div>
    </header>
    <div class="asset-tabs" id="asset-tabs" role="tablist" aria-label="資產分頁">
      <button type="button" class="chip asset-tab" data-asset-tab="tw" role="tab">台股庫存</button>
      <button type="button" class="chip asset-tab" data-asset-tab="us" role="tab">美股庫存</button>
      <button type="button" class="chip asset-tab" data-asset-tab="alloc" role="tab">資產配置</button>
    </div>

    <div id="pf-hold-view">
    <div class="hint-bar" id="pf-hint">點列進入個股 · 長按編輯／刪除 · 表格可左右滑動</div>

    <section class="pf-summary" id="pf-summary">
      <div class="state">載入中…</div>
    </section>

    <section class="pf-chart-card" id="pf-chart-card">
      <div class="pf-chart-head">
        <span>每日損益 (<span id="pf-chart-unit">TWD</span>)</span>
        <div class="pf-range-tabs" id="pf-range-tabs" role="group" aria-label="每日損益區間"></div>
      </div>
      <div class="pf-chart" id="pf-chart">
        <div class="state">載入中…</div>
      </div>
    </section>

    <section class="pf-table-wrap">
      <div class="pf-table-scroll" id="pf-table-scroll">
        <div class="pf-table-inner">
          <div class="pf-table-head" id="pf-table-head"></div>
          <div class="pf-table-body" id="pf-table-body">
            <div class="state">載入中…</div>
          </div>
        </div>
      </div>
    </section>

    <button class="add-stock-btn" data-action="toggle-add" type="button">
      <span class="add-stock-plus">＋</span>
      <span>新增庫存</span>
    </button>

    <section class="add-stock-panel pf-add-panel" id="add-panel" hidden>
      <div class="search-box">
        <input id="add-q" type="search" placeholder="搜尋代號或名稱，例如 2330" autocomplete="off" />
      </div>
      <div class="list-wrap add-results" id="add-results">
        <div class="state">輸入關鍵字搜尋後加入庫存</div>
      </div>
      <form class="pf-hold-form" id="hold-form" hidden>
        <p class="pf-hold-symbol" id="hold-symbol-label"></p>
        <input type="hidden" id="hold-symbol" />
        <input type="hidden" id="hold-edit-id" />
        <label class="pf-field">
          <span>類型</span>
          <select id="hold-type">
            <option value="spot">現股</option>
            <option value="margin">融資</option>
          </select>
        </label>
        <label class="pf-field">
          <span>股數</span>
          <input id="hold-shares" type="number" min="1" step="1" placeholder="例如 1000" required />
        </label>
        <label class="pf-field">
          <span>成本價</span>
          <input id="hold-cost" type="number" min="0" step="any" placeholder="例如 580" required />
        </label>
        <div class="pf-form-actions">
          <button type="button" class="ghost-btn" data-action="cancel-form">取消</button>
          <button type="submit" class="primary-btn">儲存</button>
        </div>
      </form>
    </section>

    <div class="ctx-backdrop" id="ctx-backdrop" hidden></div>
    <div class="ctx-menu" id="ctx-menu" hidden>
      <p class="ctx-menu-title" id="ctx-menu-title"></p>
      <button type="button" data-ctx="edit">編輯庫存</button>
      <button type="button" data-ctx="delete" class="danger">刪除庫存</button>
      <button type="button" data-ctx="open">查看個股</button>
      <button type="button" data-ctx="cancel" class="ctx-menu-cancel">取消</button>
    </div>
    </div>
    <div id="pf-alloc-view" hidden></div>
  `

  const summaryEl = root.querySelector('#pf-summary')
  const chartEl = root.querySelector('#pf-chart')
  const rangeTabsEl = root.querySelector('#pf-range-tabs')
  const headEl = root.querySelector('#pf-table-head')
  const bodyEl = root.querySelector('#pf-table-body')
  const addPanel = root.querySelector('#add-panel')
  const toggleAddBtn = root.querySelector('[data-action="toggle-add"]')
  const addInput = root.querySelector('#add-q')
  const addResults = root.querySelector('#add-results')
  const holdForm = root.querySelector('#hold-form')
  const holdSymbol = root.querySelector('#hold-symbol')
  const holdEditId = root.querySelector('#hold-edit-id')
  const holdSymbolLabel = root.querySelector('#hold-symbol-label')
  const holdType = root.querySelector('#hold-type')
  const holdShares = root.querySelector('#hold-shares')
  const holdCost = root.querySelector('#hold-cost')
  const menuEl = root.querySelector('#ctx-menu')
  const menuTitleEl = root.querySelector('#ctx-menu-title')
  const backdropEl = root.querySelector('#ctx-backdrop')
  const holdView = root.querySelector('#pf-hold-view')
  const allocView = root.querySelector('#pf-alloc-view')
  const tabsEl = root.querySelector('#asset-tabs')
  const fxToggle = root.querySelector('#pf-fx-toggle')
  const headerActions = root.querySelector('#pf-header-actions')
  const hintEl = root.querySelector('#pf-hint')

  let assetTab = getAssetTab()
  let holdMarket = assetTab === 'us' ? 'us' : 'tw'
  let allocCleanup = null
  let tabGen = 0
  let { col: sortCol, dir: sortDir } = getSortState()
  let plMonths = getPlRangeMonths()
  let cachedRows = []
  let disposed = false
  let softGen = 0
  let softRefreshing = false
  let refreshTimer = null
  let searchTimer = null
  let chartPoints = []
  let ctxHoldingId = null
  let longPressTimer = null
  let longPressTriggered = false
  let longPressStart = null
  let usdTwd = getAssetStore().liquid.usdTwdRate
  let displayCurrency = getDisplayCurrency()
  const LONG_PRESS_MS = 500
  const LONG_PRESS_MOVE_PX = 10

  function applyFxQuote(quote) {
    if (!quote || !FX_SYMBOLS.includes(quote.symbol) || !(quote.price > 0)) return
    const rate = quote.price < 1 ? 1 / quote.price : quote.price
    if (rate > 1) {
      usdTwd = rate
      setUsdTwdRate(rate)
    }
  }

  function nativeCurrency() {
    return holdMarket === 'us' ? 'USD' : 'TWD'
  }

  function convertMoney(amount) {
    if (amount == null || !Number.isFinite(amount)) return null
    const from = nativeCurrency()
    if (from === displayCurrency) return amount
    if (usdTwd == null || !(usdTwd > 0)) return null
    return from === 'USD' ? amount * usdTwd : amount / usdTwd
  }

  function paintFxToggle() {
    fxToggle?.querySelectorAll('[data-fx]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-fx') === displayCurrency)
    })
    const unit = root.querySelector('#pf-chart-unit')
    if (unit) unit.textContent = displayCurrency
  }

  function marketLabel() {
    return holdMarket === 'us' ? '美股' : '台股'
  }

  function searchIdleText() {
    return `輸入關鍵字搜尋後加入${marketLabel()}庫存`
  }

  function getVisibleHoldings() {
    return getHoldings().filter((h) =>
      holdMarket === 'tw' ? isTaiwanSymbol(h.symbol) : !isTaiwanSymbol(h.symbol),
    )
  }

  function isTwSearchItem(item) {
    const symbol = normalizeSymbol(item.symbol) || item.symbol
    return isTaiwanSymbol(symbol) || item.market === 'TW'
  }

  function matchesHoldMarket(item) {
    return holdMarket === 'tw' ? isTwSearchItem(item) : !isTwSearchItem(item)
  }

  function syncHoldCopy() {
    if (addInput) {
      addInput.placeholder =
        holdMarket === 'us' ? '搜尋美股代號或名稱，例如 AAPL' : '搜尋台股代號或名稱，例如 2330'
    }
    if (hintEl) {
      hintEl.textContent = `點列進入個股 · 長按編輯／刪除 · 表格可左右滑動 · 目前為${marketLabel()}庫存`
    }
  }

  function paintTabs() {
    tabsEl?.querySelectorAll('[data-asset-tab]').forEach((btn) => {
      const on = btn.getAttribute('data-asset-tab') === assetTab
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    })
  }

  async function showAssetTab(tab) {
    const next = tab === 'us' || tab === 'alloc' || tab === 'tw' ? tab : 'tw'
    const gen = ++tabGen
    assetTab = setAssetTab(next)
    paintTabs()
    if (next === 'alloc') {
      holdView.hidden = true
      if (headerActions) headerActions.hidden = true
      allocView.hidden = false
      if (typeof allocCleanup === 'function') {
        allocCleanup.refresh?.()
        return
      }
      const cleanup = await renderAllocation(allocView, {
        onOpenMarket: (market) => {
          showAssetTab(market)
        },
      })
      if (gen !== tabGen) {
        if (typeof cleanup === 'function') cleanup()
        return
      }
      allocCleanup = cleanup
      return
    }
    holdMarket = next
    holdView.hidden = false
    if (headerActions) headerActions.hidden = false
    paintFxToggle()
    allocView.hidden = true
    syncHoldCopy()
    closeAddPanel()
    await load()
  }

  function renderRangeTabs() {
    if (!rangeTabsEl) return
    rangeTabsEl.innerHTML = PL_RANGE_OPTS.map(
      (o) => `
        <button type="button" class="chip pf-range-chip ${o.months === plMonths ? 'active' : ''}" data-pl-months="${o.months}">
          ${o.label}
        </button>
      `,
    ).join('')
  }

  function candlesMapFromCache(symbols) {
    const map = new Map()
    for (const symbol of symbols) {
      map.set(symbol, candleCache.get(symbol) || [])
    }
    return map
  }

  function paintChartFromCache(holdings) {
    const symbols = [...new Set(holdings.map((h) => h.symbol))]
    const hasAny = symbols.some((s) => (candleCache.get(s) || []).length > 1)
    if (!hasAny) {
      renderChart([])
      return false
    }
    const points = buildDailyPL(holdings, candlesMapFromCache(symbols), plMonths)
    chartCache = {
      key: chartCacheKey(holdings),
      points,
      months: plMonths,
      at: Date.now(),
    }
    renderChart(points)
    return true
  }

  function hideMenu() {
    menuEl.hidden = true
    backdropEl.hidden = true
    ctxHoldingId = null
  }

  function showMenu(holding) {
    ctxHoldingId = holding.id
    menuTitleEl.textContent = `${holding.name || holding.symbol} · ${displayCode(holding.symbol)}`
    backdropEl.hidden = false
    menuEl.hidden = false
    menuEl.classList.add('ctx-menu--center')
  }

  function clearLongPress() {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    longPressStart = null
  }

  function openAddPanel() {
    addPanel.hidden = false
    toggleAddBtn.classList.add('open')
    resetForm()
    addInput.focus()
  }

  function closeAddPanel() {
    addPanel.hidden = true
    toggleAddBtn.classList.remove('open')
    addInput.value = ''
    resetForm()
    addResults.innerHTML = `<div class="state">${searchIdleText()}</div>`
  }

  function resetForm() {
    holdForm.hidden = true
    addResults.hidden = false
    holdSymbol.value = ''
    holdEditId.value = ''
    holdSymbolLabel.textContent = ''
    holdType.value = 'spot'
    holdShares.value = ''
    holdCost.value = ''
  }

  function showForm(symbol, name, edit = null) {
    addResults.hidden = true
    holdForm.hidden = false
    holdSymbol.value = symbol
    holdEditId.value = edit?.id || ''
    holdSymbolLabel.textContent = `${name || symbol}（${displayCode(symbol)}）`
    holdType.value = edit?.type || 'spot'
    holdShares.value = edit?.shares != null ? String(edit.shares) : ''
    holdCost.value = edit?.costPrice != null ? String(edit.costPrice) : ''
    holdShares.focus()
  }

  function renderSummary(summary) {
    const todayCls = changeClass(summary.todayPL)
    const totalCls = changeClass(summary.totalPL)
    summaryEl.innerHTML = `
      <div class="pf-stat">
        <div class="pf-stat-label">今日損益</div>
        <div class="pf-stat-value ${todayCls}">${formatSigned(convertMoney(summary.todayPL), { digits: 0 })}</div>
        <div class="pf-stat-sub ${todayCls}">${formatPct(summary.todayPLPercent)}</div>
      </div>
      <div class="pf-stat">
        <div class="pf-stat-label">
          <span class="pf-stat-ico pie" aria-hidden="true"></span>
          累積損益
        </div>
        <div class="pf-stat-value ${totalCls}">${formatSigned(convertMoney(summary.totalPL), { digits: 0 })}</div>
        <div class="pf-stat-sub ${totalCls}">${formatPct(summary.totalPLPercent)}</div>
      </div>
      <div class="pf-stat">
        <div class="pf-stat-label">
          <span class="pf-stat-ico pie" aria-hidden="true"></span>
          股票市值
        </div>
        <div class="pf-stat-value">${formatSigned(convertMoney(summary.marketValue), { digits: 0, withSign: false })}</div>
        <div class="pf-stat-sub muted">成本 ${formatSigned(convertMoney(summary.totalCost), { digits: 0, withSign: false })}</div>
      </div>
    `
  }

  function renderChart(points) {
    chartPoints = points
    if (!points.length) {
      chartEl.innerHTML = `<div class="state">尚無每日損益資料</div>`
      return
    }

    const shown = points.map((p) => ({
      date: p.date,
      value: convertMoney(p.value) ?? p.value,
    }))
    const values = shown.map((p) => p.value)
    const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1)
    const top = maxAbs
    const bottom = -maxAbs
    const w = 100
    const h = 100
    const padY = 8
    const barW = Math.max(0.8, (w / shown.length) * 0.55)
    const zeroY = h / 2
    const scale = (h / 2 - padY) / maxAbs

    const bars = shown
      .map((p, i) => {
        const x = ((i + 0.5) / shown.length) * w - barW / 2
        const bh = Math.max(0.4, Math.abs(p.value) * scale)
        const y = p.value >= 0 ? zeroY - bh : zeroY
        const cls = p.value >= 0 ? 'up' : 'down'
        return `<rect class="pf-bar ${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${bh.toFixed(2)}" data-i="${i}" rx="0.4" />`
      })
      .join('')

    const topY = padY
    const bottomY = h - padY
    const firstLabel = formatChartDate(shown[0].date)
    const lastLabel = formatChartDate(shown[shown.length - 1].date)

    chartEl.innerHTML = `
      <div class="pf-chart-y">
        <span>${formatAxis(top)}</span>
        <span>${formatAxis(bottom)}</span>
      </div>
      <div class="pf-chart-main">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="pf-chart-svg" role="img" aria-label="每日損益長條圖">
          <line class="pf-guide" x1="0" y1="${topY}" x2="${w}" y2="${topY}" />
          <line class="pf-zero" x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" />
          <line class="pf-guide" x1="0" y1="${bottomY}" x2="${w}" y2="${bottomY}" />
          ${bars}
        </svg>
        <div class="pf-chart-x">
          <span>${firstLabel}</span>
          <span>${lastLabel}</span>
        </div>
        <div class="pf-chart-tip" id="pf-chart-tip" hidden></div>
      </div>
    `

    const tip = chartEl.querySelector('#pf-chart-tip')
    chartEl.querySelectorAll('.pf-bar').forEach((bar) => {
      bar.addEventListener('pointerenter', () => {
        const i = Number(bar.getAttribute('data-i'))
        const p = shown[i]
        if (!p || !tip) return
        tip.hidden = false
        tip.textContent = `${formatChartTipDate(p.date)}　${formatSigned(p.value, { digits: 0 })}`
        tip.style.left = `${((i + 0.5) / shown.length) * 100}%`
      })
      bar.addEventListener('pointerleave', () => {
        if (tip) tip.hidden = true
      })
    })
  }

  function renderHead() {
    headEl.innerHTML = SORT_COLS.map((c) => {
      const active = c.id === sortCol
      const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'
      return `
        <button type="button" class="pf-col-btn ${c.align === 'left' ? 'left' : ''} ${active ? 'active' : ''}" data-sort="${c.id}">
          <span>${c.label}</span>
          <span class="pf-sort-ico">${arrow}</span>
        </button>
      `
    }).join('')
  }

  function renderBody(rows) {
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="state pf-empty">尚未建立${marketLabel()}庫存<br/>點下方「新增庫存」加入持股</div>`
      return
    }

    const ordered = sortRows(rows, sortCol, sortDir)
    bodyEl.innerHTML = ordered
      .map((r) => {
        const todayCls = changeClass(r.todayPL)
        const chgCls = changeClass(r.change)
        const totalCls = changeClass(r.totalPL)
        const ret5Cls = changeClass(r.ret5)
        const ret20Cls = changeClass(r.ret20)
        const retYtdCls = changeClass(r.retYtd)
        return `
          <article class="pf-row" data-id="${r.id}" data-symbol="${r.symbol}">
            <div class="pf-cell pf-cell-name">
              <span class="pf-type">${TYPE_LABEL[r.type] || '現股'}</span>
              <strong>${escapeHtml(r.name)}</strong>
              <span class="code">${displayCode(r.symbol)}</span>
            </div>
            <div class="pf-cell pf-cell-num ${todayCls}">
              ${formatSigned(convertMoney(r.todayPL), { digits: 0 })}
            </div>
            <div class="pf-cell pf-cell-stack ${chgCls}">
              <span class="price">${formatPrice(convertMoney(r.price))}</span>
              <span class="chg">${formatPct(r.changePercent)}</span>
            </div>
            <div class="pf-cell pf-cell-stack ${totalCls}">
              <span class="price">${formatSigned(convertMoney(r.totalPL), { digits: 0 })}</span>
              <span class="chg">${formatPct(r.totalPLPercent)}</span>
            </div>
            <div class="pf-cell pf-cell-num">
              ${formatSigned(r.shares, { digits: 0, withSign: false })}
            </div>
            <div class="pf-cell pf-cell-stack">
              <span class="price">${formatPrice(convertMoney(r.costPrice))}</span>
              <span class="chg muted">${formatSigned(convertMoney(r.cost), { digits: 0, withSign: false })}</span>
            </div>
            <div class="pf-cell pf-cell-stack">
              <span class="price">${formatSigned(convertMoney(r.marketValue), { digits: 0, withSign: false })}</span>
              <span class="chg muted">${r.weight != null && Number.isFinite(r.weight) ? `${r.weight.toFixed(2)}%` : '—'}</span>
            </div>
            <div class="pf-cell pf-cell-num ${ret5Cls}">${formatPct(r.ret5)}</div>
            <div class="pf-cell pf-cell-num ${ret20Cls}">${formatPct(r.ret20)}</div>
            <div class="pf-cell pf-cell-num ${retYtdCls}">${formatPct(r.retYtd)}</div>
          </article>
        `
      })
      .join('')
  }

  function rowsFromHoldings(holdings) {
    const base = holdings.map((h) => {
      const quote = quoteCache.get(h.symbol)
      const candles = candleCache.get(h.symbol) || []
      const price = quote?.price ?? null
      return enrichHolding(h, quote, {
        ret5: periodReturn(price, candles, 5),
        ret20: periodReturn(price, candles, 20),
        retYtd: ytdReturn(price, candles),
      })
    })
    const totalMv = base.reduce((s, r) => s + (r.marketValue || 0), 0)
    return base.map((r) => ({
      ...r,
      weight:
        r.marketValue != null && totalMv > 0 ? (r.marketValue / totalMv) * 100 : null,
    }))
  }

  function paint(rows) {
    cachedRows = rows
    renderSummary(summarize(rows))
    renderHead()
    renderBody(rows)
  }

  function chartCacheKey(holdings) {
    return `${CHART_RANGE}|${holdings
      .map((h) => `${h.symbol}:${h.shares}`)
      .sort()
      .join('|')}`
  }

  async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length)
    let next = 0
    async function run() {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i], i)
      }
    }
    const n = Math.min(concurrency, Math.max(1, items.length))
    await Promise.all(Array.from({ length: n }, () => run()))
    return results
  }

  async function loadDailyChart(holdings, { force = false } = {}) {
    renderRangeTabs()
    if (!holdings.length) {
      chartCache = null
      renderChart([])
      return
    }

    const key = chartCacheKey(holdings)
    const symbols = [...new Set(holdings.map((h) => h.symbol))]
    const cacheReady =
      chartCache &&
      chartCache.key === key &&
      Date.now() - chartCache.at < CHART_CACHE_MS &&
      symbols.every((s) => candleCache.has(s))

    if (cacheReady && !force) {
      paintChartFromCache(holdings)
      paint(rowsFromHoldings(holdings))
      return
    }

    if (cacheReady) {
      paintChartFromCache(holdings)
    } else if (!paintChartFromCache(holdings)) {
      chartEl.innerHTML = `<div class="state">圖表載入中…</div>`
    }

    const candlesBySymbol = new Map()
    await mapPool(symbols, CHART_FETCH_CONCURRENCY, async (symbol) => {
      try {
        const data = await fetchChart(symbol, { interval: '1d', range: CHART_RANGE })
        const candles = data.candles || []
        candlesBySymbol.set(symbol, candles)
        candleCache.set(symbol, candles)
      } catch {
        candlesBySymbol.set(symbol, candleCache.get(symbol) || [])
      }
    })
    if (disposed) return
    const points = buildDailyPL(holdings, candlesBySymbol, plMonths)
    chartCache = { key, points, months: plMonths, at: Date.now() }
    renderChart(points)
    paint(rowsFromHoldings(getVisibleHoldings()))
  }

  async function refreshQuotes(holdings, gen) {
    if (!holdings.length) return
    try {
      const symbols = [...holdings.map((h) => h.symbol), ...FX_SYMBOLS]
      const quotes = await fetchQuotes(symbols)
      if (disposed || gen !== softGen) return
      for (const q of quotes) {
        if (FX_SYMBOLS.includes(q?.symbol)) applyFxQuote(q)
        else if (q?.symbol) quoteCache.set(q.symbol, q)
      }
      paint(rowsFromHoldings(getVisibleHoldings()))
    } catch (err) {
      if (disposed || gen !== softGen) return
      // 已有畫面就不整頁錯誤；僅首次且無快取時提示
      if (!cachedRows.length) {
        summaryEl.innerHTML = `<div class="state error">載入失敗：${escapeHtml(err.message)}</div>`
        bodyEl.innerHTML = `<div class="state error"><button class="link-btn" data-action="retry">重試</button></div>`
        bodyEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => load({ forceChart: true }))
      }
    }
  }

  async function load({ forceChart = false } = {}) {
    const gen = ++softGen
    const holdings = getVisibleHoldings()
    renderRangeTabs()
    if (!holdings.length) {
      cachedRows = []
      paint([])
      renderChart([])
      return
    }

    // 先用本地庫存 + 快取報價立刻上畫面，再背景更新
    paint(rowsFromHoldings(holdings))
    loadDailyChart(holdings, { force: forceChart })
    await refreshQuotes(holdings, gen)
  }

  async function softRefresh() {
    if (disposed || softRefreshing || document.hidden || assetTab === 'alloc') return
    softRefreshing = true
    const gen = ++softGen
    const holdings = getVisibleHoldings()
    try {
      if (!holdings.length) {
        paint([])
        return
      }
      await refreshQuotes(holdings, gen)
    } finally {
      softRefreshing = false
    }
  }

  async function runSearch(q) {
    const keyword = q.trim()
    if (!keyword) {
      addResults.innerHTML = `<div class="state">${searchIdleText()}</div>`
      return
    }
    addResults.innerHTML = `<div class="state">搜尋中…</div>`
    try {
      const local = searchLocal(keyword).slice(0, 8)
      let remote = []
      try {
        remote = await searchYahoo(keyword)
      } catch {
        /* ignore */
      }
      if (disposed) return
      const seen = new Set(local.map((x) => x.symbol))
      const merged = [
        ...local,
        ...remote.filter((x) => x?.symbol && !seen.has(x.symbol)),
      ]
        .filter(matchesHoldMarket)
        .slice(0, 20)

      if (!merged.length) {
        addResults.innerHTML = `<div class="state">查無結果</div>`
        return
      }

      addResults.innerHTML = merged
        .map((item) => {
          const symbol = normalizeSymbol(item.symbol) || item.symbol
          const name = item.name || getSymbolMeta(symbol)?.name || symbol
          return `
            <article class="quote-row" data-pick="${escapeHtml(symbol)}" data-name="${escapeHtml(name)}">
              <div class="quote-main">
                <div class="quote-title">
                  <strong>${escapeHtml(name)}</strong>
                  <span class="code">${escapeHtml(displayCode(symbol))}</span>
                </div>
              </div>
              <button class="ghost-btn" type="button" data-pick="${escapeHtml(symbol)}" data-name="${escapeHtml(name)}">加入</button>
            </article>
          `
        })
        .join('')
    } catch (err) {
      if (disposed) return
      addResults.innerHTML = `<div class="state error">搜尋失敗：${escapeHtml(err.message)}</div>`
    }
  }

  root.querySelector('[data-action="refresh"]')?.addEventListener('click', () =>
    load({ forceChart: true }),
  )

  fxToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fx]')
    if (!btn) return
    const next = btn.getAttribute('data-fx')
    if ((next !== 'TWD' && next !== 'USD') || next === displayCurrency) return
    displayCurrency = setDisplayCurrency(next)
    paintFxToggle()
    paint(cachedRows)
    renderChart(chartPoints)
  })

  tabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-asset-tab]')
    if (!btn) return
    const next = btn.getAttribute('data-asset-tab')
    if (!next || next === assetTab) return
    showAssetTab(next)
  })

  rangeTabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pl-months]')
    if (!btn) return
    const next = Number(btn.getAttribute('data-pl-months'))
    if (!PL_RANGE_OPTS.some((o) => o.months === next) || next === plMonths) return
    plMonths = setPlRangeMonths(next)
    renderRangeTabs()
    const holdings = getVisibleHoldings()
    if (!holdings.length) {
      renderChart([])
      return
    }
    if (!paintChartFromCache(holdings)) {
      loadDailyChart(holdings, { force: true })
    }
  })

  toggleAddBtn?.addEventListener('click', () => {
    if (addPanel.hidden) openAddPanel()
    else closeAddPanel()
  })

  root.querySelector('[data-action="cancel-form"]')?.addEventListener('click', () => {
    resetForm()
    if (!addInput.value.trim()) {
      addResults.innerHTML = `<div class="state">${searchIdleText()}</div>`
    } else {
      runSearch(addInput.value)
    }
  })

  addInput?.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => runSearch(addInput.value), 280)
  })

  addResults?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]')
    if (!btn) return
    const symbol = btn.getAttribute('data-pick')
    const name = btn.getAttribute('data-name') || symbol
    if (!symbol) return
    pushSearchHistory({ symbol, name })
    showForm(symbol, name)
  })

  holdForm?.addEventListener('submit', (e) => {
    e.preventDefault()
    const symbol = holdSymbol.value
    const shares = Number(holdShares.value)
    const costPrice = Number(holdCost.value)
    const type = holdType.value === 'margin' ? 'margin' : 'spot'
    const editId = holdEditId.value
    const isTw = isTaiwanSymbol(symbol)
    if (holdMarket === 'tw' && !isTw) {
      alert('此標的請到美股庫存分頁新增')
      return
    }
    if (holdMarket === 'us' && isTw) {
      alert('此標的請到台股庫存分頁新增')
      return
    }
    try {
      if (editId) {
        updateHolding(editId, { symbol, shares, costPrice, type })
      } else {
        addHolding({ symbol, shares, costPrice, type })
      }
      closeAddPanel()
      load()
    } catch (err) {
      alert(err?.message || '儲存失敗')
    }
  })

  headEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]')
    if (!btn) return
    const next = btn.getAttribute('data-sort')
    if (next === sortCol) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortCol = next
      sortDir = next === 'name' ? 'asc' : 'desc'
    }
    setSortState({ col: sortCol, dir: sortDir })
    renderHead()
    renderBody(cachedRows)
  })

  bodyEl?.addEventListener('click', (e) => {
    if (longPressTriggered) {
      longPressTriggered = false
      return
    }
    const row = e.target.closest('.pf-row')
    if (!row) return
    const symbol = row.getAttribute('data-symbol')
    if (symbol) navigate('stock', { symbol })
  })

  bodyEl?.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.pf-row')
    if (!row) return
    e.preventDefault()
    const id = row.getAttribute('data-id')
    const rowData = cachedRows.find((r) => r.id === id)
    const holding = getHoldings().find((h) => h.id === id)
    if (!holding) return
    showMenu({ ...holding, name: rowData?.name })
  })

  bodyEl?.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.pf-row')
    if (!row || e.button === 2) return
    longPressTriggered = false
    longPressStart = { x: e.clientX, y: e.clientY }
    const id = row.getAttribute('data-id')
    clearLongPress()
    longPressTimer = setTimeout(() => {
      longPressTriggered = true
      const rowData = cachedRows.find((r) => r.id === id)
      const holding = getHoldings().find((h) => h.id === id)
      if (holding) showMenu({ ...holding, name: rowData?.name })
    }, LONG_PRESS_MS)
  })

  bodyEl?.addEventListener('pointermove', (e) => {
    if (!longPressStart) return
    const dx = e.clientX - longPressStart.x
    const dy = e.clientY - longPressStart.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) clearLongPress()
  })

  bodyEl?.addEventListener('pointerup', clearLongPress)
  bodyEl?.addEventListener('pointercancel', clearLongPress)
  bodyEl?.addEventListener('pointerleave', clearLongPress)

  menuEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctx]')
    if (!btn) return
    const action = btn.getAttribute('data-ctx')
    const holding = getHoldings().find((h) => h.id === ctxHoldingId)
    hideMenu()
    if (!holding) return
    if (action === 'open') {
      navigate('stock', { symbol: holding.symbol })
      return
    }
    if (action === 'delete') {
      if (window.confirm(`確定刪除 ${displayCode(holding.symbol)} 庫存？`)) {
        removeHolding(holding.id)
        load()
      }
      return
    }
    if (action === 'edit') {
      openAddPanel()
      const name = getSymbolMeta(holding.symbol)?.name || holding.symbol
      showForm(holding.symbol, name, holding)
    }
  })

  backdropEl?.addEventListener('click', hideMenu)

  function onVisibility() {
    if (!document.hidden) softRefresh()
  }

  document.addEventListener('visibilitychange', onVisibility)
  refreshTimer = setInterval(softRefresh, QUOTE_REFRESH_MS)

  showAssetTab(assetTab)

  return () => {
    disposed = true
    clearTimeout(searchTimer)
    clearLongPress()
    if (refreshTimer) clearInterval(refreshTimer)
    if (typeof allocCleanup === 'function') allocCleanup()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
