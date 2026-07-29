import { fetchChart, fetchQuote, PERIODS, getSettings, saveSettings } from '../data/market.js'
import { getSymbolMeta, resolveDisplayName, formatDataSource } from '../data/symbols.js'
import {
  getGroups,
  isInWatchlist,
  isInAnyWatchlist,
  toggleWatchlist,
  pushSearchHistory,
} from '../data/watchlist.js'
import {
  createKlineView,
  createIntradayView,
  normalizeMaLines,
  normalizeKdColors,
  normalizeMacdColors,
  MA_PALETTE,
} from '../chart/kline.js'
import { KD_DEFAULTS } from '../chart/indicators.js'
import {
  formatPrice,
  formatChange,
  formatVolume,
  volumeUnitForSymbol,
  volumeLabelForSymbol,
  formatTime,
  formatKlineBarTime,
  formatIndicator,
  changeClass,
} from '../utils/format.js'

export async function renderStock(root, { navigate, params }) {
  const symbol = params.symbol
  if (!symbol) {
    navigate('search')
    return
  }

  const meta = getSymbolMeta(symbol)
  const initialName = resolveDisplayName(symbol, meta?.name)
  let quote = null
  let chartSource = null
  let periodId = '6mo'
  let tab = 'kline'
  let subType = 'kd'
  let chartView = null
  let inflight = 0
  /** 日K／周K／月K 切換時沿用可見日曆區間；月／季／半年／一年仍套用各自視窗 */
  const WINDOW_PERIOD_IDS = new Set(['1mo', '3mo', '6mo', '1y'])
  let savedTimeRange = null
  let maLines = normalizeMaLines(getSettings().maLines)
  let kdColors = normalizeKdColors(getSettings().kdColors)
  let macdColors = normalizeMacdColors(getSettings().macdColors)
  let lastMaValues = null
  let lastSubValues = null
  let editingMaIndex = null
  let editingMaColor = MA_PALETTE[0]
  let editingSubKey = null
  let editingSubColor = MA_PALETTE[0]

  root.innerHTML = `
    <header class="stock-header">
      <button class="icon-btn" data-action="back" aria-label="返回">←</button>
      <div class="stock-heading">
        <h1 id="stock-name">${escapeHtml(initialName)}</h1>
        <span class="code" id="stock-symbol">${escapeHtml(symbol)}</span>
        <span class="source-badge" id="stock-source">資料來源載入中…</span>
      </div>
      <div class="watch-wrap">
        <button class="icon-btn" data-action="watch" aria-label="自選群組" title="選擇自選群組">☆</button>
        <div class="watch-menu" id="watch-menu" hidden>
          <div class="watch-menu-title">自選群組</div>
          <div class="watch-menu-list" id="watch-menu-list"></div>
        </div>
      </div>
    </header>

    <section class="quote-panel" id="quote-panel">
      <div class="state">載入報價…</div>
    </section>

    <nav class="segmented" id="tabs" role="tablist" aria-label="圖表模式">
      <button type="button" class="seg" role="tab" aria-selected="false" data-tab="intraday">即時</button>
      <button type="button" class="seg active" role="tab" aria-selected="true" data-tab="kline">K線</button>
    </nav>

    <div class="toolbar" id="period-bar"></div>
    <div class="ma-legend-wrap" id="ma-legend-wrap" hidden>
      <div class="ma-legend" id="ma-legend"></div>
      <div class="ma-editor" id="ma-editor" hidden>
        <div class="ma-editor-title">編輯均線</div>
        <label class="field">
          <span>天數</span>
          <input id="ma-period" type="number" min="2" max="500" step="1" />
        </label>
        <div class="field">
          <span>顏色</span>
          <div class="ma-swatches" id="ma-swatches">
            ${MA_PALETTE.map(
              (color) =>
                `<button type="button" class="ma-swatch" data-color="${color}" style="background:${color}" aria-label="${color}"></button>`,
            ).join('')}
          </div>
        </div>
        <div class="ma-editor-actions">
          <button type="button" class="ma-editor-btn" data-action="ma-cancel">取消</button>
          <button type="button" class="ma-editor-btn primary" data-action="ma-apply">套用</button>
        </div>
      </div>
    </div>
    <div class="ohlc-bar" id="ohlc-bar">移動圖表可查看明細</div>

    <div class="chart-stack" id="chart-stack">
      <div class="chart-main" id="chart-main"></div>
      <div class="chart-sub-head">
        <div class="sub-legend-wrap" id="sub-legend-wrap">
          <div class="sub-legend" id="sub-legend"></div>
          <div class="ma-editor kd-editor" id="sub-color-editor" hidden>
            <div class="ma-editor-title" id="sub-color-editor-title">編輯顏色</div>
            <div class="field">
              <span>顏色</span>
              <div class="ma-swatches" id="sub-color-swatches">
                ${MA_PALETTE.map(
                  (color) =>
                    `<button type="button" class="ma-swatch" data-color="${color}" style="background:${color}" aria-label="${color}"></button>`,
                ).join('')}
              </div>
            </div>
            <div class="ma-editor-actions">
              <button type="button" class="ma-editor-btn" data-action="sub-color-cancel">取消</button>
            </div>
          </div>
        </div>
        <select id="sub-select">
          <option value="kd">KD</option>
          <option value="macd">MACD</option>
        </select>
      </div>
      <div class="chart-sub" id="chart-sub"></div>
    </div>
  `

  const quotePanel = root.querySelector('#quote-panel')
  const periodBar = root.querySelector('#period-bar')
  const maLegendWrap = root.querySelector('#ma-legend-wrap')
  const maLegend = root.querySelector('#ma-legend')
  const maEditor = root.querySelector('#ma-editor')
  const maPeriodInput = root.querySelector('#ma-period')
  const maSwatches = root.querySelector('#ma-swatches')
  const ohlcBar = root.querySelector('#ohlc-bar')
  const chartMain = root.querySelector('#chart-main')
  const chartSub = root.querySelector('#chart-sub')
  const subLegend = root.querySelector('#sub-legend')
  const subLegendWrap = root.querySelector('#sub-legend-wrap')
  const subColorEditor = root.querySelector('#sub-color-editor')
  const subColorEditorTitle = root.querySelector('#sub-color-editor-title')
  const subColorSwatches = root.querySelector('#sub-color-swatches')
  const subSelect = root.querySelector('#sub-select')
  const watchBtn = root.querySelector('[data-action="watch"]')
  const watchMenu = root.querySelector('#watch-menu')
  const watchMenuList = root.querySelector('#watch-menu-list')

  function syncWatchBtn() {
    const inAny = isInAnyWatchlist(symbol)
    watchBtn.textContent = inAny ? '★' : '☆'
    watchBtn.classList.toggle('active', inAny)
  }

  function renderWatchMenu() {
    const groups = getGroups()
    watchMenuList.innerHTML = groups
      .map((g) => {
        const checked = isInWatchlist(symbol, g.id)
        return `
          <div class="watch-menu-item ${checked ? 'on' : ''}" data-group-id="${g.id}">
            <span class="watch-check">${checked ? '★' : '☆'}</span>
            <span class="watch-name">${escapeHtml(g.name)}</span>
            <input class="watch-box" type="checkbox" ${checked ? 'checked' : ''} aria-label="${escapeHtml(g.name)}" />
          </div>
        `
      })
      .join('')
  }

  function openWatchMenu() {
    renderWatchMenu()
    watchMenu.hidden = false
  }

  function closeWatchMenu() {
    watchMenu.hidden = true
  }

  syncWatchBtn()

  function updateSourceBadge() {
    const el = root.querySelector('#stock-source')
    if (!el) return
    const quoteLabel = formatDataSource(quote?.source)
    const chartLabel = formatDataSource(chartSource)
    if (quoteLabel && chartLabel && quote?.source !== chartSource) {
      el.textContent = `報價：${quoteLabel} · 圖表：${chartLabel}`
    } else if (quoteLabel) {
      el.textContent = `資料來源：${quoteLabel}`
    } else if (chartLabel) {
      el.textContent = `圖表：${chartLabel}`
    } else {
      el.textContent = '資料來源載入中…'
    }
  }

  function renderQuote() {
    if (!quote) {
      quotePanel.innerHTML = `<div class="state">暫無報價</div>`
      updateSourceBadge()
      return
    }
    const change = formatChange(quote.change, quote.changePercent)
    const displayName = resolveDisplayName(symbol, quote.name, meta?.name)
    const volUnit = volumeUnitForSymbol(symbol)
    const volFromShares = quote.source !== 'twse'
    const volLabel = volumeLabelForSymbol(symbol)
    quotePanel.innerHTML = `
      <div class="quote-hero ${changeClass(quote.change)}">
        <div class="hero-price">${formatPrice(quote.price)}</div>
        <div class="hero-chg">${change.text}</div>
      </div>
      <div class="quote-grid">
        <div><span>開</span><b>${formatPrice(quote.open)}</b></div>
        <div><span>高</span><b class="up">${formatPrice(quote.high)}</b></div>
        <div><span>低</span><b class="down">${formatPrice(quote.low)}</b></div>
        <div><span>${volLabel}</span><b>${formatVolume(quote.volume, { unit: volUnit, fromShares: volFromShares })}</b></div>
      </div>
    `
    root.querySelector('#stock-name').textContent = displayName
    pushSearchHistory({ symbol, name: displayName })
    updateSourceBadge()
  }

  function renderPeriods() {
    const visible =
      tab === 'intraday'
        ? PERIODS.filter((p) => p.kind === 'intraday')
        : PERIODS.filter((p) => p.kind !== 'intraday')

    if (tab === 'intraday' && !visible.some((p) => p.id === periodId)) periodId = '1d'
    if (tab === 'kline' && !visible.some((p) => p.id === periodId)) periodId = '6mo'

    periodBar.innerHTML = visible
      .map(
        (p) =>
          `<button class="chip ${p.id === periodId ? 'active' : ''}" data-period="${p.id}">${p.label}</button>`,
      )
      .join('')

    const showMa = tab === 'kline'
    maLegendWrap.hidden = !showMa
    if (!showMa) closeMaEditor()
    else updateMaLegend(lastMaValues)

    root.querySelector('.chart-sub-head').hidden = tab === 'intraday'
    if (tab === 'intraday') closeSubColorEditor()
    chartSub.hidden = tab === 'intraday'
    chartMain.classList.toggle('solo', tab === 'intraday')
  }

  function destroyChart() {
    chartView?.destroy()
    chartView = null
    chartMain.innerHTML = ''
    chartSub.innerHTML = ''
  }

  function updateMaLegend(ma) {
    if (maLegendWrap.hidden) return
    if (ma) lastMaValues = ma
    maLegend.innerHTML = maLines
      .map((line, i) => {
        const text = formatPrice(lastMaValues?.[i])
        return `<span class="ma-tag" data-ma-index="${i}" style="color:${line.color}" title="雙擊可編輯天數與顏色">${line.period}MA ${text}</span>`
      })
      .join('')
  }

  function syncMaSwatches() {
    maSwatches.querySelectorAll('.ma-swatch').forEach((el) => {
      el.classList.toggle('active', el.dataset.color === editingMaColor)
    })
  }

  function openMaEditor(index) {
    closeSubColorEditor()
    editingMaIndex = index
    const line = maLines[index]
    if (!line) return
    maPeriodInput.value = String(line.period)
    editingMaColor = line.color
    syncMaSwatches()
    maEditor.hidden = false
    maPeriodInput.focus()
    maPeriodInput.select()
  }

  function closeMaEditor() {
    editingMaIndex = null
    maEditor.hidden = true
  }

  function applyMaEditor() {
    if (editingMaIndex == null) return
    const next = normalizeMaLines(
      maLines.map((line, i) =>
        i === editingMaIndex
          ? { period: maPeriodInput.value, color: editingMaColor }
          : line,
      ),
    )
    maLines = next
    saveSettings({ maLines: next })
    chartView?.setMaLines?.(next)
    closeMaEditor()
    updateMaLegend(lastMaValues)
  }

  const SUB_COLOR_TITLES = { k: 'K', d: 'D', dif: 'DIF', dea: 'DEA' }

  function syncSubColorSwatches() {
    subColorSwatches.querySelectorAll('.ma-swatch').forEach((el) => {
      el.classList.toggle('active', el.dataset.color === editingSubColor)
    })
  }

  function openSubColorEditor(key) {
    if (!SUB_COLOR_TITLES[key]) return
    closeMaEditor()
    editingSubKey = key
    editingSubColor =
      key === 'k' || key === 'd' ? kdColors[key] : macdColors[key]
    subColorEditorTitle.textContent = `編輯 ${SUB_COLOR_TITLES[key]} 顏色`
    syncSubColorSwatches()
    subColorEditor.hidden = false
  }

  function closeSubColorEditor() {
    editingSubKey = null
    subColorEditor.hidden = true
  }

  function applySubColorEditor() {
    if (editingSubKey == null) return
    if (editingSubKey === 'k' || editingSubKey === 'd') {
      const next = normalizeKdColors({
        ...kdColors,
        [editingSubKey]: editingSubColor,
      })
      kdColors = next
      saveSettings({ kdColors: next })
      chartView?.setKdColors?.(next)
    } else {
      const next = normalizeMacdColors({
        ...macdColors,
        [editingSubKey]: editingSubColor,
      })
      macdColors = next
      saveSettings({ macdColors: next })
      chartView?.setMacdColors?.(next)
    }
    closeSubColorEditor()
    updateSubLegend(lastSubValues)
  }

  function updateSubLegend(sub) {
    if (!subLegend || root.querySelector('.chart-sub-head')?.hidden) return
    if (sub) lastSubValues = sub
    if (!lastSubValues) {
      subLegend.innerHTML = ''
      return
    }
    if (lastSubValues.type === 'macd') {
      const histCls = lastSubValues.hist > 0 ? 'up' : lastSubValues.hist < 0 ? 'down' : ''
      subLegend.innerHTML = `
        <span class="sub-tag sub-color-tag" data-sub-color="dif" style="color:${macdColors.dif}" title="雙擊可編輯顏色">DIF ${formatIndicator(lastSubValues.dif)}</span>
        <span class="sub-tag sub-color-tag" data-sub-color="dea" style="color:${macdColors.dea}" title="雙擊可編輯顏色">DEA ${formatIndicator(lastSubValues.dea)}</span>
        <span class="sub-tag ${histCls}">MACD ${formatIndicator(lastSubValues.hist)}</span>
      `
      return
    }
    const kdN = KD_DEFAULTS.period
    subLegend.innerHTML = `
      <span class="sub-tag sub-color-tag" data-sub-color="k" style="color:${kdColors.k}" title="雙擊可編輯顏色">K(${kdN}) ${formatIndicator(lastSubValues.k)}</span>
      <span class="sub-tag sub-color-tag" data-sub-color="d" style="color:${kdColors.d}" title="雙擊可編輯顏色">D(${kdN}) ${formatIndicator(lastSubValues.d)}</span>
    `
  }

  function updateOhlc(bar) {
    updateMaLegend(bar?.ma)
    updateSubLegend(bar?.sub)
    if (!bar || bar.idle) {
      ohlcBar.textContent = '移動圖表可查看明細'
      return
    }
    const volUnit = volumeUnitForSymbol(symbol)
    const volUnitLabel = volumeLabelForSymbol(symbol)
    const volHtml = `<span>量 <b>${formatVolume(bar.volume, { unit: volUnit, fromShares: volUnit === 'lot' })}${volUnitLabel}</b></span>`

    if (tab === 'intraday') {
      const cls =
        bar.change > 0 ? 'up' : bar.change < 0 ? 'down' : bar.close >= bar.open ? 'up' : 'down'
      const avgHtml =
        bar.avg != null && Number.isFinite(bar.avg)
          ? `<span style="color:#ffffff">均 <b>${formatPrice(bar.avg)}</b></span>`
          : ''
      const chg =
        bar.change != null && bar.changePercent != null
          ? formatChange(bar.change, bar.changePercent)
          : null
      const chgHtml = chg ? `<span class="${chg.cls}">${chg.text}</span>` : ''
      ohlcBar.innerHTML = `
        <span>${formatTime(bar.time, true)}</span>
        <span class="${cls}">價 <b>${formatPrice(bar.close)}</b></span>
        ${volHtml}
        ${avgHtml}
        ${chgHtml}
      `
      return
    }

    const cls = bar.close >= bar.open ? 'up' : 'down'
    const period = PERIODS.find((p) => p.id === periodId)
    // 圖表資料來自 Yahoo，台股成交量為股數，顯示張時需換算
    ohlcBar.innerHTML = `
      <span>${formatKlineBarTime(bar.time, period?.kind)}</span>
      <span>開 <b>${formatPrice(bar.open)}</b></span>
      <span>高 <b class="up">${formatPrice(bar.high)}</b></span>
      <span>低 <b class="down">${formatPrice(bar.low)}</b></span>
      <span class="${cls}">收 <b>${formatPrice(bar.close)}</b></span>
      ${volHtml}
    `
  }

  async function loadChart() {
    const period = PERIODS.find((p) => p.id === periodId) || PERIODS[4]
    const my = ++inflight
    const prevTimeRange = chartView?.getVisibleTimeRange?.() || null
    destroyChart()
    chartMain.innerHTML = `<div class="state chart-state">載入圖表…</div>`

    try {
      const data = await fetchChart(symbol, {
        interval: period.interval,
        range: period.range,
      })
      if (my !== inflight) return

      chartSource = data.source || 'yahoo'
      updateSourceBadge()

      if (!data.candles.length) {
        chartMain.innerHTML = `<div class="state chart-state">此週期暫無資料</div>`
        return
      }

      chartMain.innerHTML = ''
      chartSub.innerHTML = ''

      if (tab === 'intraday' || period.kind === 'intraday') {
        savedTimeRange = null
        chartView = createIntradayView(chartMain, { onCrosshair: updateOhlc })
        chartView.setData(data.candles, data.chartPreviousClose ?? quote?.previousClose, {
          tradingDays: period.tradingDays,
        })
      } else {
        const keepRange = !WINDOW_PERIOD_IDS.has(period.id)
        if (prevTimeRange) savedTimeRange = prevTimeRange
        const timeRange = keepRange ? savedTimeRange : null
        if (!keepRange) savedTimeRange = null

        chartView = createKlineView(chartMain, chartSub, {
          onCrosshair: updateOhlc,
          maLines,
          kdColors,
          macdColors,
          timeKind: period.kind,
        })
        chartView.setData(data.candles, subType, {
          viewBars: period.viewBars,
          timeRange,
        })
      }
    } catch (err) {
      if (my !== inflight) return
      chartMain.innerHTML = `<div class="state chart-state error">圖表載入失敗：${err.message}</div>`
    }
  }

  root.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    history.length > 1 ? history.back() : navigate('watchlist')
  })

  watchBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (watchMenu.hidden) openWatchMenu()
    else closeWatchMenu()
  })

  watchMenuList.addEventListener('click', (e) => {
    const item = e.target.closest('[data-group-id]')
    if (!item || !watchMenuList.contains(item)) return
    e.preventDefault()
    e.stopPropagation()
    toggleWatchlist(symbol, item.dataset.groupId)
    syncWatchBtn()
    renderWatchMenu()
  })

  maLegend.addEventListener('dblclick', (e) => {
    const tag = e.target.closest('[data-ma-index]')
    if (!tag || maLegendWrap.hidden) return
    e.preventDefault()
    openMaEditor(Number(tag.dataset.maIndex))
  })

  subLegend.addEventListener('dblclick', (e) => {
    const tag = e.target.closest('[data-sub-color]')
    if (!tag) return
    e.preventDefault()
    openSubColorEditor(tag.dataset.subColor)
  })

  maEditor.addEventListener('click', (e) => {
    e.stopPropagation()
    const swatch = e.target.closest('.ma-swatch')
    if (swatch) {
      editingMaColor = swatch.dataset.color
      syncMaSwatches()
      applyMaEditor()
      return
    }
    const action = e.target.closest('[data-action]')?.dataset.action
    if (action === 'ma-cancel') closeMaEditor()
    if (action === 'ma-apply') applyMaEditor()
  })

  subColorEditor.addEventListener('click', (e) => {
    e.stopPropagation()
    const swatch = e.target.closest('.ma-swatch')
    if (swatch) {
      editingSubColor = swatch.dataset.color
      syncSubColorSwatches()
      applySubColorEditor()
      return
    }
    const action = e.target.closest('[data-action]')?.dataset.action
    if (action === 'sub-color-cancel') closeSubColorEditor()
  })

  maPeriodInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyMaEditor()
    }
  })

  const onDocClick = (e) => {
    if (!watchMenu.hidden && !root.querySelector('.watch-wrap')?.contains(e.target)) {
      closeWatchMenu()
    }
    if (!maEditor.hidden && !maLegendWrap.contains(e.target)) {
      closeMaEditor()
    }
    if (!subColorEditor.hidden && !subLegendWrap.contains(e.target)) {
      closeSubColorEditor()
    }
  }
  const onDocKey = (e) => {
    if (e.key === 'Escape') {
      closeWatchMenu()
      closeMaEditor()
      closeSubColorEditor()
    }
  }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)

  root.querySelector('#tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]')
    if (!btn) return
    tab = btn.dataset.tab
    root.querySelectorAll('#tabs .seg').forEach((el) => {
      const on = el === btn
      el.classList.toggle('active', on)
      el.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    renderPeriods()
    loadChart()
  })

  periodBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]')
    if (!btn) return
    periodId = btn.dataset.period
    renderPeriods()
    loadChart()
  })

  subSelect.addEventListener('change', () => {
    subType = subSelect.value
    closeSubColorEditor()
    chartView?.setSubType?.(subType)
  })

  renderPeriods()

  try {
    quote = await fetchQuote(symbol)
    renderQuote()
  } catch {
    quotePanel.innerHTML = `<div class="state error">報價載入失敗</div>`
  }

  await loadChart()

  return () => {
    inflight += 1
    destroyChart()
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKey)
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
