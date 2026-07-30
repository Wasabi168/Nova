import { fetchQuotes, searchYahoo } from '../data/market.js'
import {
  getGroups,
  getActiveGroupId,
  setActiveGroupId,
  getWatchlist,
  removeFromWatchlist,
  addToWatchlist,
  createGroup,
  renameGroup,
  deleteGroup,
  isInWatchlist,
  pushSearchHistory,
} from '../data/watchlist.js'
import { getSymbolMeta, normalizeSymbol, searchLocal } from '../data/symbols.js'
import { formatPrice, formatChange, changeClass } from '../utils/format.js'
import {
  getViewLayout,
  setViewLayout,
  applyViewLayout,
  renderViewToggle,
} from '../utils/viewLayout.js'

const SORT_KEY = 'nova.watchlist.sort'
const SORT_MODES = [
  { id: 'default', label: '自訂' },
  { id: 'change', label: '漲跌幅' },
  { id: 'name', label: '名稱' },
]
const DEFAULT_SORT_DIR = { change: 'desc', name: 'asc' }

function getSortState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) || 'null')
    if (raw && SORT_MODES.some((m) => m.id === raw.mode)) {
      const dir =
        raw.mode === 'default'
          ? 'asc'
          : raw.dir === 'asc' || raw.dir === 'desc'
            ? raw.dir
            : DEFAULT_SORT_DIR[raw.mode] || 'asc'
      return { mode: raw.mode, dir }
    }
    // 相容舊版只存字串 mode
    if (typeof raw === 'string' && SORT_MODES.some((m) => m.id === raw)) {
      return { mode: raw, dir: DEFAULT_SORT_DIR[raw] || 'asc' }
    }
  } catch {
    /* ignore */
  }
  const legacy = localStorage.getItem(SORT_KEY)
  if (legacy && SORT_MODES.some((m) => m.id === legacy)) {
    return { mode: legacy, dir: DEFAULT_SORT_DIR[legacy] || 'asc' }
  }
  return { mode: 'default', dir: 'asc' }
}

function setSortState(state) {
  localStorage.setItem(SORT_KEY, JSON.stringify(state))
  return state
}

function sortSymbols(symbols, quotes, mode, dir) {
  if (mode === 'default') return [...symbols]
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))
  const sign = dir === 'asc' ? 1 : -1
  return [...symbols].sort((a, b) => {
    const qa = bySymbol.get(a)
    const qb = bySymbol.get(b)
    if (mode === 'change') {
      const pa = qa?.changePercent
      const pb = qb?.changePercent
      const aOk = pa != null && Number.isFinite(pa)
      const bOk = pb != null && Number.isFinite(pb)
      if (aOk && bOk) return (pa - pb) * sign
      if (aOk) return -1
      if (bOk) return 1
      return a.localeCompare(b, 'zh-TW')
    }
    const nameA = qa?.name || getSymbolMeta(a)?.name || a
    const nameB = qb?.name || getSymbolMeta(b)?.name || b
    const byName = String(nameA).localeCompare(String(nameB), 'zh-TW')
    return (byName || a.localeCompare(b, 'zh-TW')) * sign
  })
}

export async function renderWatchlist(root, { navigate }) {
  root.innerHTML = `
    <header class="page-header">
      <div>
        <p class="eyebrow">Nova</p>
        <h1>自選股</h1>
      </div>
      <button class="icon-btn" data-action="refresh" title="重新整理" aria-label="重新整理">↻</button>
    </header>
    <div class="group-tabs" id="group-tabs"></div>
    <div class="sort-bar" id="sort-bar"></div>
    <div class="hint-bar">台股接近即時 · 美股約延遲 15 分鐘 · 群組 Tab 可右鍵編輯</div>
    <div class="list-wrap" id="watch-list">
      <div class="state">載入中…</div>
    </div>
    <button class="add-stock-btn" data-action="toggle-add" type="button">
      <span class="add-stock-plus">＋</span>
      <span>新增股票</span>
    </button>
    <section class="add-stock-panel" id="add-panel" hidden>
      <div class="search-box">
        <input id="add-q" type="search" placeholder="搜尋代號或名稱，例如 2330、AAPL" autocomplete="off" />
      </div>
      <div class="list-wrap add-results" id="add-results">
        <div class="state">輸入關鍵字搜尋後加入目前群組</div>
      </div>
    </section>
    <div class="ctx-menu" id="ctx-menu" hidden>
      <button type="button" data-ctx="rename">重新命名</button>
      <button type="button" data-ctx="delete" class="danger">刪除群組</button>
    </div>
  `

  const tabsEl = root.querySelector('#group-tabs')
  const sortBarEl = root.querySelector('#sort-bar')
  const listEl = root.querySelector('#watch-list')
  const menuEl = root.querySelector('#ctx-menu')
  const addPanel = root.querySelector('#add-panel')
  const addInput = root.querySelector('#add-q')
  const addResults = root.querySelector('#add-results')
  const toggleAddBtn = root.querySelector('[data-action="toggle-add"]')
  let ctxGroupId = null
  let searchTimer = null
  let { mode: sortMode, dir: sortDir } = getSortState()
  let viewLayout = getViewLayout()
  let cachedSymbols = []
  let cachedQuotes = []
  applyViewLayout(listEl, viewLayout)

  function hideMenu() {
    menuEl.hidden = true
    ctxGroupId = null
  }

  function showMenu(x, y, groupId) {
    ctxGroupId = groupId
    menuEl.hidden = false
    menuEl.style.left = '0px'
    menuEl.style.top = '0px'
    const pad = 8
    const rect = menuEl.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - pad)
    const top = Math.min(y, window.innerHeight - rect.height - pad)
    menuEl.style.left = `${Math.max(pad, left)}px`
    menuEl.style.top = `${Math.max(pad, top)}px`
  }

  function openAddPanel() {
    addPanel.hidden = false
    toggleAddBtn.classList.add('open')
    addInput.focus()
    if (!addInput.value.trim()) {
      addResults.innerHTML = `<div class="state">輸入關鍵字搜尋後加入目前群組</div>`
    }
  }

  function closeAddPanel() {
    addPanel.hidden = true
    toggleAddBtn.classList.remove('open')
    addInput.value = ''
    addResults.innerHTML = `<div class="state">輸入關鍵字搜尋後加入目前群組</div>`
  }

  function renderTabs() {
    const groups = getGroups()
    const active = getActiveGroupId()
    tabsEl.innerHTML = `
      ${groups
        .map(
          (g) => `
        <button class="chip group-chip ${g.id === active ? 'active' : ''}" data-group="${g.id}" title="右鍵可編輯群組">
          ${escapeHtml(g.name)}
          <span class="group-count">${g.symbols.length}</span>
        </button>
      `,
        )
        .join('')}
      <button class="chip group-add" data-action="add-group" title="新增群組">＋</button>
    `
  }

  function renderSortBar() {
    sortBarEl.innerHTML = `
      <div class="sort-modes">
        <span class="sort-label">排序</span>
        ${SORT_MODES.map((m) => {
          const active = m.id === sortMode
          const arrow =
            active && m.id !== 'default' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
          return `
          <button class="chip sort-chip ${active ? 'active' : ''}" data-sort="${m.id}" type="button">
            ${m.label}${arrow}
          </button>
        `
        }).join('')}
      </div>
      ${renderViewToggle(viewLayout)}
    `
  }

  function paintList(symbols, quotes) {
    cachedSymbols = symbols
    cachedQuotes = quotes
    const ordered = sortSymbols(symbols, quotes, sortMode, sortDir)
    listEl.innerHTML = renderQuoteRows(ordered, quotes)
  }

  function renderQuoteRows(symbols, quotes) {
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))
    return symbols
      .map((symbol) => {
        const q = bySymbol.get(symbol)
        const meta = getSymbolMeta(symbol)
        const name = q?.name || meta?.name || symbol
        const change = formatChange(q?.change, q?.changePercent)
        const sourceHint = !q
          ? '查無報價'
          : q.source === 'twse'
            ? '即時'
            : q.source
              ? '延遲'
              : ''
        return `
          <article class="quote-row" data-symbol="${symbol}">
            <div class="quote-main">
              <div class="quote-title">
                <strong>${escapeHtml(name)}</strong>
                <span class="code">${symbol}${sourceHint ? ` · ${sourceHint}` : ''}</span>
              </div>
              <div class="quote-price ${changeClass(q?.change)}">
                <span class="price">${formatPrice(q?.price)}</span>
                <span class="chg">${change.text}</span>
              </div>
            </div>
            <button class="ghost-btn danger" data-remove="${symbol}" title="移出此群組">✕</button>
          </article>
        `
      })
      .join('')
  }

  async function load() {
    hideMenu()
    renderTabs()
    renderSortBar()
    const symbols = getWatchlist()
    if (!symbols.length) {
      cachedSymbols = []
      cachedQuotes = []
      listEl.innerHTML = `<div class="state">此群組尚未加入標的<br/>點下方「新增股票」搜尋加入</div>`
      return
    }

    listEl.innerHTML = `<div class="state">載入中…</div>`
    try {
      const quotes = await fetchQuotes(symbols)
      paintList(symbols, quotes)
    } catch (err) {
      cachedSymbols = []
      cachedQuotes = []
      listEl.innerHTML = `<div class="state error">載入失敗：${escapeHtml(err.message)}<br/><button class="link-btn" data-action="retry">重試</button></div>`
      listEl.querySelector('[data-action="retry"]')?.addEventListener('click', load)
    }
  }

  function renderSearchItems(items, emptyText) {
    if (!items.length) {
      addResults.innerHTML = `<div class="state">${emptyText}</div>`
      return
    }
    addResults.innerHTML = items
      .map((item) => {
        const added = isInWatchlist(item.symbol)
        return `
          <article class="quote-row search-row" data-add-symbol="${item.symbol}" data-add-name="${escapeHtml(item.name)}">
            <div class="quote-main">
              <div class="quote-title">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="code">${item.symbol}${item.exchange ? ` · ${item.exchange}` : ''}</span>
              </div>
            </div>
            <button class="ghost-btn ${added ? 'added' : ''}" data-add="${item.symbol}" title="${added ? '已在群組' : '加入目前群組'}">${added ? '✓' : '＋'}</button>
          </article>
        `
      })
      .join('')
  }

  async function runAddSearch(raw) {
    const q = raw.trim()
    if (!q) {
      addResults.innerHTML = `<div class="state">輸入關鍵字搜尋後加入目前群組</div>`
      return
    }

    const local = searchLocal(q)
    const normalized = normalizeSymbol(q)
    const seed = []
    if (normalized && !local.some((x) => x.symbol === normalized)) {
      seed.push({ symbol: normalized, name: normalized, exchange: '' })
    }

    addResults.innerHTML = `<div class="state">搜尋中…</div>`
    try {
      const remote = await searchYahoo(q)
      const merged = []
      const seen = new Set()
      for (const item of [...local, ...seed, ...remote]) {
        if (seen.has(item.symbol)) continue
        seen.add(item.symbol)
        merged.push(item)
      }
      renderSearchItems(merged, '找不到符合的標的')
    } catch {
      renderSearchItems(
        [...local, ...seed],
        local.length || seed.length ? '線上搜尋失敗，顯示本地結果' : '搜尋失敗，請檢查網路',
      )
    }
  }

  function renameCtxGroup(groupId) {
    const group = getGroups().find((g) => g.id === groupId)
    if (!group) return
    const name = window.prompt('群組名稱', group.name)
    if (name == null) return
    renameGroup(group.id, name)
    load()
  }

  function deleteCtxGroup(groupId) {
    const groups = getGroups()
    const group = groups.find((g) => g.id === groupId)
    if (!group) return
    if (groups.length <= 1) {
      window.alert('至少需保留一個群組')
      return
    }
    if (!window.confirm(`確定刪除群組「${group.name}」？`)) return
    try {
      deleteGroup(group.id)
      load()
    } catch (err) {
      window.alert(err.message)
    }
  }

  root.querySelector('[data-action="refresh"]')?.addEventListener('click', load)

  sortBarEl.addEventListener('click', (e) => {
    const layoutBtn = e.target.closest('[data-layout]')
    if (layoutBtn) {
      const next = layoutBtn.dataset.layout
      if (next === viewLayout) return
      viewLayout = setViewLayout(next)
      applyViewLayout(listEl, viewLayout)
      renderSortBar()
      return
    }

    const btn = e.target.closest('[data-sort]')
    if (!btn) return
    const next = btn.dataset.sort
    if (!SORT_MODES.some((m) => m.id === next)) return

    if (next === 'default') {
      if (sortMode === 'default') return
      sortMode = 'default'
      sortDir = 'asc'
    } else if (next === sortMode) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortMode = next
      sortDir = DEFAULT_SORT_DIR[next] || 'asc'
    }

    setSortState({ mode: sortMode, dir: sortDir })
    renderSortBar()
    if (cachedSymbols.length) paintList(cachedSymbols, cachedQuotes)
  })

  toggleAddBtn.addEventListener('click', () => {
    if (addPanel.hidden) openAddPanel()
    else closeAddPanel()
  })

  addInput.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => runAddSearch(addInput.value), 280)
  })

  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddPanel()
      return
    }
    if (e.key === 'Enter') {
      clearTimeout(searchTimer)
      const symbol = normalizeSymbol(addInput.value)
      if (!symbol) return
      addToWatchlist(symbol)
      pushSearchHistory({ symbol, name: symbol })
      closeAddPanel()
      load()
    }
  })

  addResults.addEventListener('click', (e) => {
    const row = e.target.closest('[data-add-symbol]')
    if (!row) return
    const symbol = row.dataset.addSymbol
    const name = row.dataset.addName || symbol
    if (isInWatchlist(symbol)) return
    addToWatchlist(symbol)
    pushSearchHistory({ symbol, name })
    closeAddPanel()
    load()
  })

  tabsEl.addEventListener('click', (e) => {
    hideMenu()
    const add = e.target.closest('[data-action="add-group"]')
    if (add) {
      const name = window.prompt('新群組名稱', `群組 ${getGroups().length + 1}`)
      if (name == null) return
      createGroup(name)
      closeAddPanel()
      load()
      return
    }
    const tab = e.target.closest('[data-group]')
    if (!tab) return
    setActiveGroupId(tab.dataset.group)
    closeAddPanel()
    load()
  })

  tabsEl.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('[data-group]')
    if (!tab) return
    e.preventDefault()
    showMenu(e.clientX, e.clientY, tab.dataset.group)
  })

  menuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctx]')
    if (!btn || !ctxGroupId) return
    const action = btn.dataset.ctx
    const groupId = ctxGroupId
    hideMenu()
    if (action === 'rename') renameCtxGroup(groupId)
    if (action === 'delete') deleteCtxGroup(groupId)
  })

  document.addEventListener('click', (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu()
  })

  listEl.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]')
    if (remove) {
      e.stopPropagation()
      removeFromWatchlist(remove.dataset.remove)
      load()
      return
    }
    const row = e.target.closest('[data-symbol]')
    if (row) navigate('stock', { symbol: row.dataset.symbol })
  })

  await load()
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
