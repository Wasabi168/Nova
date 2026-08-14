import { fetchQuotes } from '../data/market.js'
import { getHoldings } from '../data/portfolio.js'
import { getSymbolMeta } from '../data/symbols.js'
import { isTaiwanSymbol } from '../data/twse.js'
import {
  getAssetStore,
  setAmountsHidden,
  setExpandedCategory,
  setLiquidTwd,
  setLiquidUsd,
  setUsdTwdRate,
  addDebt,
  updateDebt,
  removeDebt,
  expandCategory,
  isBondLike,
  formatMoney,
  formatUpdateLabel,
} from '../data/assets.js'

const FX_SYMBOL = 'TWD=X'
const HIDDEN_TEXT = '*****'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n, hidden, digits = 0) {
  if (hidden) return HIDDEN_TEXT
  return formatMoney(n, { digits })
}

function maxTs(...values) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0)
  return nums.length ? Math.max(...nums) : 0
}

function holdingTwdValue(holding, quote, usdTwd) {
  const price = quote?.price
  if (price == null || !Number.isFinite(price)) return null
  const mv = price * holding.shares
  if (isTaiwanSymbol(holding.symbol)) return mv
  if (usdTwd == null || !Number.isFinite(usdTwd)) return null
  return mv * usdTwd
}

function holdingName(holding, quote) {
  return quote?.name || getSymbolMeta(holding.symbol)?.name || holding.symbol
}

function iconBank() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.2 3 8v1.6h18V8L12 3.2ZM5.2 11v6.2H7.4V11H5.2Zm4.4 0v6.2h2.2V11H9.6Zm4.4 0v6.2h2.2V11H14Zm4.4 0v6.2h2.2V11h-2.2ZM3 18.6V20.4h18v-1.8H3Z"/></svg>`
}

function iconLoan() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4Zm.9 13.7h-1.8v-1.5H8.8v-1.6h2.3V12H9.2v-1.6h2V8.8h1.7v1.6h2.1v1.6h-2.1v1.4h2.3v1.6h-2.3v1.5Z"/></svg>`
}

function iconHouse() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.2 3.4 10.2h2.1V20h5.2v-6.2h2.6V20h5.2v-9.8h2.1L12 3.2Z"/></svg>`
}

function debtIcon(name) {
  if (/房|屋|宅/.test(name)) return iconHouse()
  if (/融資|信用|卡/.test(name)) return iconLoan()
  return iconBank()
}

/**
 * @param {HTMLElement} root
 * @param {{ onOpenMarket?: (market: 'tw' | 'us') => void }} ctx
 */
export async function renderAllocation(root, { onOpenMarket } = {}) {
  root.innerHTML = `
    <section class="aa-page">
      <header class="aa-hero">
        <div class="aa-hero-copy">
          <div class="aa-hero-title">
            <span>我的淨資產 (TWD)</span>
            <button class="aa-eye" data-aa="toggle-hide" type="button" aria-label="顯示或隱藏金額"></button>
          </div>
          <div class="aa-hero-value-row">
            <div class="aa-hero-value" id="aa-net">—</div>
            <div class="aa-leverage" id="aa-leverage" title="槓桿比例 = 投資 ÷ 淨資產">—</div>
          </div>
        </div>
      </header>

      <div class="aa-list" id="aa-list">
        <div class="state">載入中…</div>
      </div>
    </section>

    <div class="aa-backdrop" id="aa-backdrop" hidden></div>
    <div class="aa-sheet" id="aa-sheet" hidden>
      <form id="aa-form">
        <h3 id="aa-form-title">修改餘額</h3>
        <label class="pf-field" id="aa-name-field">
          <span>名目</span>
          <input id="aa-name" type="text" maxlength="20" placeholder="例如 房貸、信貸" autocomplete="off" />
        </label>
        <label class="pf-field">
          <span id="aa-amount-label">金額</span>
          <input id="aa-amount" type="number" min="0" step="any" placeholder="0" required />
        </label>
        <label class="aa-check" id="aa-exclude-field" hidden>
          <input id="aa-exclude" type="checkbox" />
          <span>不統計（不計入淨資產）</span>
        </label>
        <input type="hidden" id="aa-mode" />
        <input type="hidden" id="aa-debt-id" />
        <div class="pf-form-actions">
          <button type="button" class="ghost-btn" data-aa="cancel-form">取消</button>
          <button type="submit" class="primary-btn">儲存</button>
        </div>
      </form>
    </div>

    <div class="ctx-backdrop" id="aa-ctx-backdrop" hidden></div>
    <div class="ctx-menu" id="aa-ctx-menu" hidden>
      <p class="ctx-menu-title" id="aa-ctx-title"></p>
      <div id="aa-ctx-actions"></div>
      <button type="button" data-aa-ctx="cancel" class="ctx-menu-cancel">取消</button>
    </div>
  `

  const listEl = root.querySelector('#aa-list')
  const netEl = root.querySelector('#aa-net')
  const leverageEl = root.querySelector('#aa-leverage')
  const eyeBtn = root.querySelector('[data-aa="toggle-hide"]')
  const sheet = root.querySelector('#aa-sheet')
  const backdrop = root.querySelector('#aa-backdrop')
  const form = root.querySelector('#aa-form')
  const formTitle = root.querySelector('#aa-form-title')
  const nameField = root.querySelector('#aa-name-field')
  const nameInput = root.querySelector('#aa-name')
  const amountInput = root.querySelector('#aa-amount')
  const amountLabel = root.querySelector('#aa-amount-label')
  const excludeField = root.querySelector('#aa-exclude-field')
  const excludeInput = root.querySelector('#aa-exclude')
  const modeInput = root.querySelector('#aa-mode')
  const debtIdInput = root.querySelector('#aa-debt-id')
  const menuEl = root.querySelector('#aa-ctx-menu')
  const menuTitleEl = root.querySelector('#aa-ctx-title')
  const menuActionsEl = root.querySelector('#aa-ctx-actions')
  const menuBackdrop = root.querySelector('#aa-ctx-backdrop')

  let disposed = false
  /** @type {Map<string, any>} */
  const quoteMap = new Map()
  let usdTwd = getAssetStore().liquid.usdTwdRate
  let investUpdatedAt = 0

  function hideMenu() {
    menuEl.hidden = true
    menuBackdrop.hidden = true
  }

  function showMenu(title, actions) {
    menuTitleEl.textContent = title
    menuActionsEl.innerHTML = actions
      .map(
        (a) =>
          `<button type="button" data-aa-ctx="${escapeHtml(a.id)}" ${a.danger ? 'class="danger"' : ''}>${escapeHtml(a.label)}</button>`,
      )
      .join('')
    menuBackdrop.hidden = false
    menuEl.hidden = false
    menuEl.classList.add('ctx-menu--center')
  }

  function closeSheet() {
    sheet.hidden = true
    backdrop.hidden = true
    form.reset()
    modeInput.value = ''
    debtIdInput.value = ''
  }

  function openSheet(mode, defaults = {}) {
    hideMenu()
    modeInput.value = mode
    debtIdInput.value = defaults.id || ''
    nameInput.value = defaults.name || ''
    amountInput.value = defaults.amount != null ? String(defaults.amount) : ''
    excludeInput.checked = Boolean(defaults.excluded)
    nameField.hidden = mode !== 'add-debt' && mode !== 'edit-debt'
    excludeField.hidden = mode !== 'add-debt' && mode !== 'edit-debt'
    if (mode === 'edit-usd') {
      formTitle.textContent = '修改美金餘額'
      amountLabel.textContent = '美金金額'
      nameInput.required = false
    } else if (mode === 'edit-twd') {
      formTitle.textContent = '修改台幣餘額'
      amountLabel.textContent = '台幣金額'
      nameInput.required = false
    } else if (mode === 'edit-debt') {
      formTitle.textContent = '修改負債'
      amountLabel.textContent = '金額（TWD）'
      nameInput.required = true
    } else {
      formTitle.textContent = '新增負債'
      amountLabel.textContent = '金額（TWD）'
      nameInput.required = true
    }
    sheet.hidden = false
    backdrop.hidden = false
    const focusEl = nameField.hidden ? amountInput : nameInput
    focusEl.focus()
  }

  function investBuckets() {
    const buckets = {
      bond: { value: 0, has: false, updatedAt: 0 },
      tw: { value: 0, has: false, updatedAt: 0 },
      us: { value: 0, has: false, updatedAt: 0 },
    }
    for (const h of getHoldings()) {
      const quote = quoteMap.get(h.symbol)
      const name = holdingName(h, quote)
      const twd = holdingTwdValue(h, quote, usdTwd)
      const key = isBondLike(h.symbol, name) ? 'bond' : isTaiwanSymbol(h.symbol) ? 'tw' : 'us'
      if (twd != null) {
        buckets[key].value += twd
        buckets[key].has = true
      }
    }
    return buckets
  }

  function paint() {
    const store = getAssetStore()
    const hidden = store.hidden
    const buckets = investBuckets()
    const usdTwdValue = usdTwd != null && Number.isFinite(usdTwd) ? usdTwd : null
    const usdInTwd = usdTwdValue != null ? store.liquid.usd * usdTwdValue : null
    const liquidTotal =
      usdInTwd != null ? store.liquid.twd + usdInTwd : store.liquid.usd > 0 ? null : store.liquid.twd
    const investTotal =
      buckets.bond.has || buckets.tw.has || buckets.us.has
        ? buckets.bond.value + buckets.tw.value + buckets.us.value
        : 0
    const investHas = buckets.bond.has || buckets.tw.has || buckets.us.has
    const countedDebts = store.debts.filter((d) => !d.excluded)
    const debtTotal = countedDebts.reduce((s, d) => s + d.amount, 0)
    const net =
      liquidTotal != null && (investHas || investTotal === 0)
        ? liquidTotal + (investHas ? investTotal : 0) - debtTotal
        : null

    netEl.textContent = money(net, hidden)
    if (net != null && net > 0 && Number.isFinite(investTotal)) {
      leverageEl.textContent = `槓桿 ${Math.round((investTotal / net) * 100)}%`
    } else {
      leverageEl.textContent = '槓桿 —'
    }
    eyeBtn.innerHTML = hidden
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.3 3.3 2 4.6l3.1 3.1C3.4 9.1 2.3 10.5 1.6 12c1.7 3.7 5.4 6.2 10.4 6.2 1.6 0 3.1-.3 4.4-.8l3.6 3.6 1.3-1.3L3.3 3.3ZM12 6.2c4.9 0 8.6 2.5 10.4 6.2-.7 1.4-1.7 2.6-3 3.5l-2.2-2.2A4.7 4.7 0 0 0 12 7.6c-.4 0-.8.1-1.2.2L9.2 6.2C10.1 6.3 11 6.2 12 6.2Zm0 3.1a2.7 2.7 0 0 1 2.7 2.7c0 .4-.1.8-.3 1.1l-3.5-3.5c.3-.2.7-.3 1.1-.3Z"/></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 6.2c4.9 0 8.6 2.5 10.4 6.2-1.8 3.7-5.5 6.2-10.4 6.2S3.4 16.1 1.6 12.4C3.4 8.7 7.1 6.2 12 6.2Zm0 2.4A3.8 3.8 0 1 0 12 16a3.8 3.8 0 0 0 0-7.4Zm0 2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z"/></svg>`
    eyeBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false')

    const liquidNames = ['美金', '台幣']
    const investNames = ['債券', '台股', '美股']
    const debtNames = store.debts.map((d) => d.name)
    const liquidUpdated = maxTs(store.liquid.twdUpdatedAt, store.liquid.usdUpdatedAt, store.liquid.rateUpdatedAt)
    const investUpdated = investUpdatedAt || Date.now()
    const debtUpdated = maxTs(...store.debts.map((d) => d.updatedAt))
    const investPctBase = investHas && investTotal > 0 ? investTotal : 0
    const liquidPctBase = liquidTotal != null && liquidTotal > 0 ? liquidTotal : 0
    const assetBase = (liquidTotal || 0) + (investHas ? investTotal : 0)

    const pct = (value, base) => {
      if (!base || value == null || !Number.isFinite(value)) return 0
      return Math.round((value / base) * 100)
    }

    const rateText =
      usdTwdValue != null
        ? `r${usdTwdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`
        : '匯率載入中'

    listEl.innerHTML = [
      renderCategory({
        id: 'liquid',
        title: '流動資金',
        names: liquidNames,
        total: liquidTotal,
        updatedAt: liquidUpdated,
        expanded: store.expanded === 'liquid',
        hidden,
        percent: pct(liquidTotal, assetBase),
        children: `
          <button class="aa-item" type="button" data-aa="edit-usd">
            <span class="aa-pct" aria-hidden="true">${pct(usdInTwd, liquidPctBase)}%</span>
            <span class="aa-item-copy">
              <strong>美金</strong>
              <span class="aa-item-sub">${hidden ? HIDDEN_TEXT : `USD ${formatMoney(store.liquid.usd, { digits: 2 })}, ${rateText}`}</span>
            </span>
            <span class="aa-item-right">
              <span class="aa-item-amt up">${money(usdInTwd, hidden)}</span>
              <span class="aa-item-date">${formatUpdateLabel(store.liquid.usdUpdatedAt).replace(' 更新', '')}</span>
            </span>
          </button>
          <button class="aa-item" type="button" data-aa="edit-twd">
            <span class="aa-pct" aria-hidden="true">${pct(store.liquid.twd, liquidPctBase)}%</span>
            <span class="aa-item-copy">
              <strong>台幣</strong>
              <span class="aa-item-sub">修改餘額</span>
            </span>
            <span class="aa-item-right">
              <span class="aa-item-amt up">${money(store.liquid.twd, hidden)}</span>
              <span class="aa-item-date">${formatUpdateLabel(store.liquid.twdUpdatedAt).replace(' 更新', '')}</span>
            </span>
          </button>
        `,
      }),
      renderCategory({
        id: 'invest',
        title: '投資',
        names: investNames,
        total: investHas ? investTotal : 0,
        updatedAt: investUpdated,
        expanded: store.expanded === 'invest',
        hidden,
        percent: pct(investHas ? investTotal : 0, assetBase),
        children: `
          ${renderInvestChild('bond', '債券', buckets.bond, pct(buckets.bond.value, investPctBase), hidden)}
          ${renderInvestChild('tw', '台股', buckets.tw, pct(buckets.tw.value, investPctBase), hidden)}
          ${renderInvestChild('us', '美股', buckets.us, pct(buckets.us.value, investPctBase), hidden)}
        `,
      }),
      renderCategory({
        id: 'debt',
        title: '負債',
        names: debtNames.length ? debtNames : ['尚未新增'],
        total: debtTotal,
        updatedAt: debtUpdated,
        expanded: store.expanded === 'debt',
        hidden,
        negative: true,
        children: `${
          store.debts.length
            ? store.debts
                .map(
                  (d) => `
                    <button class="aa-item" type="button" data-aa="edit-debt" data-id="${escapeHtml(d.id)}">
                      <span class="aa-item-ico debt">${debtIcon(d.name)}</span>
                      <span class="aa-item-copy">
                        <strong>${escapeHtml(d.name)}${d.excluded ? '<span class="aa-badge">不統計</span>' : ''}</strong>
                        <span class="aa-item-sub action">修改餘額</span>
                      </span>
                      <span class="aa-item-right">
                        <span class="aa-item-amt">${money(d.amount, hidden)}</span>
                        <span class="aa-item-date">${formatUpdateLabel(d.updatedAt).replace(' 更新', '')}</span>
                      </span>
                    </button>
                  `,
                )
                .join('')
            : `<div class="aa-empty">尚未新增負債</div>`
        }
          <button class="aa-add-item" data-aa="add-debt" type="button">
            <span class="aa-add-item-ico" aria-hidden="true">＋</span>
            <span>新增負債</span>
          </button>`,
      }),
    ].join('')
  }

  function renderInvestChild(id, title, bucket, percent, hidden) {
    return `
      <button class="aa-item" type="button" data-aa="invest-${id}">
        <span class="aa-pct" aria-hidden="true">${percent}%</span>
        <span class="aa-item-copy">
          <strong>${title}</strong>
          <span class="aa-item-sub action">更新價格</span>
        </span>
        <span class="aa-item-right">
          <span class="aa-item-amt">${money(bucket.has ? bucket.value : 0, hidden)}</span>
        </span>
      </button>
    `
  }

  function renderCategory({ id, title, names, total, updatedAt, expanded, hidden, children, negative = false, percent = null }) {
    const pctHtml =
      percent != null
        ? `<span class="aa-pct aa-card-pct" aria-hidden="true">${percent}%</span>`
        : ''
    return `
      <article class="aa-card ${id} ${expanded ? 'expanded' : ''} ${percent != null ? 'has-pct' : ''}" data-cat="${id}">
        <button class="aa-card-head" type="button" data-aa="toggle" data-cat="${id}">
          ${pctHtml}
          <span class="aa-card-copy">
            <strong>${title}</strong>
            <span class="aa-card-sub">${escapeHtml(names.join('、'))}</span>
          </span>
          <span class="aa-card-right">
            <span class="aa-card-amt">${negative && total ? `<span class="aa-minus">−</span>` : ''}${money(total, hidden)}</span>
            <span class="aa-card-date">${formatUpdateLabel(updatedAt)}</span>
          </span>
        </button>
        <button class="aa-dots" type="button" data-aa="menu-cat" data-cat="${id}" aria-label="更多">⋯</button>
        <div class="aa-collapse">
          <div class="aa-collapse-inner">
            <div class="aa-children">${children}</div>
          </div>
        </div>
      </article>
    `
  }

  function applyExpanded(expandedId) {
    listEl.querySelectorAll('.aa-card').forEach((card) => {
      card.classList.toggle('expanded', card.getAttribute('data-cat') === expandedId)
    })
  }

  async function refreshQuotes() {
    const symbols = [...new Set(getHoldings().map((h) => h.symbol))]
    try {
      const quotes = await fetchQuotes([...symbols, FX_SYMBOL, 'USDTWD=X'])
      if (disposed) return
      for (const q of quotes) {
        if ((q?.symbol === FX_SYMBOL || q?.symbol === 'USDTWD=X') && q.price > 0) {
          const rate = q.price < 1 ? 1 / q.price : q.price
          if (rate > 1) {
            usdTwd = rate
            setUsdTwdRate(rate)
          }
        } else if (q?.symbol) {
          quoteMap.set(q.symbol, q)
        }
      }
      investUpdatedAt = Date.now()
      paint()
    } catch {
      if (disposed) return
      paint()
    }
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-aa]')
    if (!btn) return
    const action = btn.getAttribute('data-aa')
    if (action === 'toggle-hide') {
      setAmountsHidden(!getAssetStore().hidden)
      paint()
      return
    }
    if (action === 'add-debt') {
      openSheet('add-debt')
      return
    }
    if (action === 'cancel-form') {
      closeSheet()
      return
    }
    if (action === 'toggle') {
      setExpandedCategory(btn.getAttribute('data-cat'))
      applyExpanded(getAssetStore().expanded)
      return
    }
    if (action === 'edit-usd') {
      openSheet('edit-usd', { amount: getAssetStore().liquid.usd })
      return
    }
    if (action === 'edit-twd') {
      openSheet('edit-twd', { amount: getAssetStore().liquid.twd })
      return
    }
    if (action === 'edit-debt') {
      const id = btn.getAttribute('data-id')
      const item = getAssetStore().debts.find((d) => d.id === id)
      if (!item) return
      openSheet('edit-debt', item)
      return
    }
    if (action === 'invest-tw' || action === 'invest-us' || action === 'invest-bond') {
      refreshQuotes()
      return
    }
    if (action === 'menu-cat') {
      e.stopPropagation()
      const cat = btn.getAttribute('data-cat')
      if (cat === 'liquid') {
        showMenu('流動資金', [
          { id: 'edit-usd', label: '修改美金' },
          { id: 'edit-twd', label: '修改台幣' },
        ])
      } else if (cat === 'invest') {
        showMenu('投資', [
          { id: 'refresh', label: '更新價格' },
          { id: 'open-tw', label: '查看台股庫存' },
          { id: 'open-us', label: '查看美股庫存' },
        ])
      } else if (cat === 'debt') {
        showMenu('負債', [{ id: 'add-debt', label: '新增負債' }])
      }
    }
  })

  menuEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-aa-ctx]')
    if (!btn) return
    const action = btn.getAttribute('data-aa-ctx')
    hideMenu()
    if (action === 'cancel') return
    if (action === 'edit-usd') openSheet('edit-usd', { amount: getAssetStore().liquid.usd })
    if (action === 'edit-twd') openSheet('edit-twd', { amount: getAssetStore().liquid.twd })
    if (action === 'add-debt') openSheet('add-debt')
    if (action === 'refresh') refreshQuotes()
    if (action === 'open-tw') onOpenMarket?.('tw')
    if (action === 'open-us') onOpenMarket?.('us')
    if (action === 'edit-one') {
      const id = menuEl.dataset.debtId
      const item = getAssetStore().debts.find((d) => d.id === id)
      if (item) openSheet('edit-debt', item)
    }
    if (action === 'delete-debt') {
      const id = btn.getAttribute('data-id')
      if (id && window.confirm('確定刪除此負債？')) {
        removeDebt(id)
        paint()
      }
    }
    if (action === 'toggle-exclude') {
      const id = btn.getAttribute('data-id')
      const item = getAssetStore().debts.find((d) => d.id === id)
      if (!item) return
      updateDebt(id, { excluded: !item.excluded })
      paint()
    }
  })

  // long-press / context menu on debt items
  listEl.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('[data-aa="edit-debt"]')
    if (!item) return
    e.preventDefault()
    openDebtMenu(item.getAttribute('data-id'))
  })

  let longPressTimer = null
  let longPressTriggered = false
  let longPressStart = null

  function openDebtMenu(id) {
    const debt = getAssetStore().debts.find((d) => d.id === id)
    if (!debt) return
    menuTitleEl.textContent = debt.name
    menuActionsEl.innerHTML = `
      <button type="button" data-aa-ctx="edit-one">修改餘額</button>
      <button type="button" data-aa-ctx="toggle-exclude" data-id="${escapeHtml(id)}">${debt.excluded ? '改為統計' : '設為不統計'}</button>
      <button type="button" data-aa-ctx="delete-debt" data-id="${escapeHtml(id)}" class="danger">刪除</button>
    `
    menuBackdrop.hidden = false
    menuEl.hidden = false
    menuEl.classList.add('ctx-menu--center')
    menuEl.dataset.debtId = id
  }

  listEl.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('[data-aa="edit-debt"]')
    if (!item || e.button === 2) return
    longPressTriggered = false
    longPressStart = { x: e.clientX, y: e.clientY }
    const id = item.getAttribute('data-id')
    clearTimeout(longPressTimer)
    longPressTimer = setTimeout(() => {
      longPressTriggered = true
      openDebtMenu(id)
    }, 500)
  })
  listEl.addEventListener('pointermove', (e) => {
    if (!longPressStart) return
    const dx = e.clientX - longPressStart.x
    const dy = e.clientY - longPressStart.y
    if (dx * dx + dy * dy > 100) {
      clearTimeout(longPressTimer)
      longPressStart = null
    }
  })
  const clearLp = () => {
    clearTimeout(longPressTimer)
    longPressStart = null
  }
  listEl.addEventListener('pointerup', clearLp)
  listEl.addEventListener('pointercancel', clearLp)
  listEl.addEventListener('pointerleave', clearLp)

  listEl.addEventListener('click', (e) => {
    if (!longPressTriggered) return
    longPressTriggered = false
    e.preventDefault()
    e.stopPropagation()
  }, true)

  menuBackdrop.addEventListener('click', hideMenu)
  backdrop.addEventListener('click', closeSheet)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const mode = modeInput.value
    const amount = Number(amountInput.value)
    try {
      if (mode === 'edit-usd') setLiquidUsd(amount)
      else if (mode === 'edit-twd') setLiquidTwd(amount)
      else if (mode === 'add-debt') {
        addDebt({ name: nameInput.value, amount, excluded: excludeInput.checked })
        expandCategory('debt')
      } else if (mode === 'edit-debt') {
        updateDebt(debtIdInput.value, {
          name: nameInput.value,
          amount,
          excluded: excludeInput.checked,
        })
      }
      closeSheet()
      paint()
    } catch (err) {
      alert(err?.message || '儲存失敗')
    }
  })

  paint()
  refreshQuotes()

  return () => {
    disposed = true
    clearTimeout(longPressTimer)
  }
}
