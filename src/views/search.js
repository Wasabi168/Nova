import { normalizeSymbol, searchLocal } from '../data/symbols.js'
import { searchYahoo } from '../data/market.js'
import {
  getSearchHistory,
  pushSearchHistory,
  clearSearchHistory,
  addToWatchlist,
  getActiveGroup,
} from '../data/watchlist.js'

export async function renderSearch(root, { navigate }) {
  const activeGroup = getActiveGroup()

  root.innerHTML = `
    <header class="page-header">
      <div>
        <p class="eyebrow">搜尋</p>
        <h1>找指數・ETF・個股</h1>
      </div>
    </header>
    <div class="hint-bar">加入自選會進目前群組「${activeGroup?.name || '預設'}」</div>
    <div class="search-box">
      <input id="q" type="search" placeholder="輸入代號或名稱，例如 2330、AAPL、台積電" autocomplete="off" />
    </div>
    <div class="section-head">
      <h2>結果</h2>
      <button class="link-btn" data-action="clear-history">清除瀏覽紀錄</button>
    </div>
    <div class="list-wrap" id="results"></div>
  `

  const input = root.querySelector('#q')
  const results = root.querySelector('#results')
  let timer = null

  function renderItems(items, emptyText) {
    if (!items.length) {
      results.innerHTML = `<div class="state">${emptyText}</div>`
      return
    }
    results.innerHTML = items
      .map(
        (item) => `
        <article class="quote-row search-row" data-symbol="${item.symbol}" data-name="${item.name}">
          <div class="quote-main">
            <div class="quote-title">
              <strong>${item.name}</strong>
              <span class="code">${item.symbol}${item.exchange ? ` · ${item.exchange}` : ''}</span>
            </div>
          </div>
          <button class="ghost-btn" data-add="${item.symbol}" title="加入目前群組">＋</button>
        </article>
      `,
      )
      .join('')
  }

  function showHistory() {
    const hist = getSearchHistory()
    renderItems(hist, '輸入關鍵字開始搜尋')
  }

  async function runSearch(raw) {
    const q = raw.trim()
    if (!q) {
      showHistory()
      return
    }

    const local = searchLocal(q)
    const normalized = normalizeSymbol(q)
    const seed = []
    if (normalized && !local.some((x) => x.symbol === normalized)) {
      seed.push({ symbol: normalized, name: normalized, exchange: '' })
    }

    results.innerHTML = `<div class="state">搜尋中…</div>`
    try {
      const remote = await searchYahoo(q)
      const merged = []
      const seen = new Set()
      for (const item of [...local, ...seed, ...remote]) {
        if (seen.has(item.symbol)) continue
        seen.add(item.symbol)
        merged.push(item)
      }
      renderItems(merged, '找不到符合的標的')
    } catch {
      renderItems([...local, ...seed], local.length ? '線上搜尋失敗，顯示本地結果' : '搜尋失敗，請檢查網路或代理設定')
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => runSearch(input.value), 320)
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer)
      const symbol = normalizeSymbol(input.value)
      if (symbol) {
        pushSearchHistory({ symbol, name: symbol })
        navigate('stock', { symbol })
      }
    }
  })

  results.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]')
    if (add) {
      e.stopPropagation()
      addToWatchlist(add.dataset.add)
      add.textContent = '✓'
      return
    }
    const row = e.target.closest('[data-symbol]')
    if (row) {
      pushSearchHistory({ symbol: row.dataset.symbol, name: row.dataset.name })
      navigate('stock', { symbol: row.dataset.symbol })
    }
  })

  root.querySelector('[data-action="clear-history"]')?.addEventListener('click', () => {
    clearSearchHistory()
    showHistory()
  })

  showHistory()
  input.focus()
}
