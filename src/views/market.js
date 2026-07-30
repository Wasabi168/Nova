import { MARKET_SECTIONS } from '../data/symbols.js'
import { fetchQuotes } from '../data/market.js'
import { formatPrice, formatChange, changeClass } from '../utils/format.js'
import {
  getViewLayout,
  setViewLayout,
  applyViewLayout,
  renderViewToggle,
} from '../utils/viewLayout.js'

export async function renderMarket(root, { navigate }) {
  let viewLayout = getViewLayout()

  root.innerHTML = `
    <header class="page-header">
      <div>
        <p class="eyebrow">行情</p>
        <h1>指數・ETF・熱門</h1>
      </div>
      <button class="icon-btn" data-action="refresh" title="重新整理">↻</button>
    </header>
    <div class="market-tabs" id="market-tabs">
      ${MARKET_SECTIONS.map(
        (s, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-section="${s.id}">${s.title}</button>`,
      ).join('')}
    </div>
    <div class="layout-bar" id="layout-bar">
      <span class="sort-label">顯示</span>
      ${renderViewToggle(viewLayout)}
    </div>
    <div class="list-wrap" id="market-list"><div class="state">載入中…</div></div>
  `

  let activeId = MARKET_SECTIONS[0].id
  const listEl = root.querySelector('#market-list')
  const tabsEl = root.querySelector('#market-tabs')
  const layoutBarEl = root.querySelector('#layout-bar')
  applyViewLayout(listEl, viewLayout)

  function renderLayoutBar() {
    layoutBarEl.innerHTML = `
      <span class="sort-label">顯示</span>
      ${renderViewToggle(viewLayout)}
    `
  }

  async function load() {
    const section = MARKET_SECTIONS.find((s) => s.id === activeId)
    if (!section) return

    listEl.innerHTML = `<div class="state">載入中…</div>`
    try {
      const symbols = section.items.map((i) => i.symbol)
      const quotes = await fetchQuotes(symbols)
      const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))

      listEl.innerHTML = section.items
        .map((item) => {
          const q = bySymbol.get(item.symbol)
          const change = formatChange(q?.change, q?.changePercent)
          return `
            <article class="quote-row" data-symbol="${item.symbol}">
              <div class="quote-main">
                <div class="quote-title">
                  <strong>${item.name}</strong>
                  <span class="code">${item.symbol}</span>
                </div>
                <div class="quote-price ${changeClass(q?.change)}">
                  <span class="price">${formatPrice(q?.price)}</span>
                  <span class="chg">${change.text}</span>
                </div>
              </div>
            </article>
          `
        })
        .join('')
    } catch (err) {
      listEl.innerHTML = `<div class="state error">載入失敗：${err.message}</div>`
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]')
    if (!btn) return
    activeId = btn.dataset.section
    tabsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn))
    load()
  })

  layoutBarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layout]')
    if (!btn) return
    const next = btn.dataset.layout
    if (next === viewLayout) return
    viewLayout = setViewLayout(next)
    applyViewLayout(listEl, viewLayout)
    renderLayoutBar()
  })

  root.querySelector('[data-action="refresh"]')?.addEventListener('click', load)
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-symbol]')
    if (row) navigate('stock', { symbol: row.dataset.symbol })
  })

  await load()
}
