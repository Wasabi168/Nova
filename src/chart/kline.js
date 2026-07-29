import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  TickMarkType,
  LineStyle,
} from 'lightweight-charts'
import { calcSMA, calcMACD, calcKD, calcIntradayAvgPrice, toLineData } from './indicators.js'
import { formatPrice, formatKlineBarTime } from '../utils/format.js'

/** Lightweight Charts 的 Time → Date（以真實 UTC 瞬間解讀，再用本地時區顯示） */
function timeToDate(time) {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') {
    const [y, m, d] = time.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(time.year, time.month - 1, time.day)
}

/** 時間軸刻度：用瀏覽器當地時區（覆蓋庫預設的 UTC 顯示） */
function localTickMarkFormatter(time, tickMarkType, locale) {
  const date = timeToDate(time)
  const opts = {}
  switch (tickMarkType) {
    case TickMarkType.Year:
      opts.year = 'numeric'
      break
    case TickMarkType.Month:
      opts.month = 'short'
      break
    case TickMarkType.DayOfMonth:
      opts.day = 'numeric'
      break
    case TickMarkType.Time:
      opts.hour12 = false
      opts.hour = '2-digit'
      opts.minute = '2-digit'
      break
    case TickMarkType.TimeWithSeconds:
      opts.hour12 = false
      opts.hour = '2-digit'
      opts.minute = '2-digit'
      opts.second = '2-digit'
      break
    default:
      break
  }
  return date.toLocaleString(locale, opts)
}

function localTimeFormatter(time) {
  return timeToDate(time).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function klineTimeFormatter(kind) {
  return (time) => formatKlineBarTime(time, kind === 'monthly' ? 'monthly' : 'daily')
}

const UP = '#ef5350'
const DOWN = '#26a69a'

export const MA_PALETTE = [
  '#531dab',
  '#5b8ff9',
  '#73d13d',
  '#ff7a45',
  '#ef5350',
  '#36cfc9',
  '#b37feb',
  '#ffc53d',
  '#ff85c0',
  '#ffffff',
]

export const DEFAULT_MA_LINES = [
  { period: 5, color: MA_PALETTE[0] },
  { period: 10, color: MA_PALETTE[1] },
  { period: 20, color: MA_PALETTE[2] },
  { period: 60, color: MA_PALETTE[3] },
  { period: 120, color: MA_PALETTE[4] },
]

export const DEFAULT_KD_COLORS = {
  k: MA_PALETTE[0],
  d: MA_PALETTE[1],
}

export const DEFAULT_MACD_COLORS = {
  dif: MA_PALETTE[0],
  dea: MA_PALETTE[1],
}

const MA_PALETTE_SET = new Set(MA_PALETTE)

export function normalizeMaLines(lines) {
  const src = Array.isArray(lines) ? lines : []
  return DEFAULT_MA_LINES.map((fallback, i) => {
    const item = src[i] || {}
    let period = Number(item.period)
    if (!Number.isFinite(period)) period = fallback.period
    period = Math.min(500, Math.max(2, Math.round(period)))
    let color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : ''
    if (!MA_PALETTE_SET.has(color)) color = fallback.color
    return { period, color }
  })
}

function pickPaletteColor(value, fallback) {
  const c = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return MA_PALETTE_SET.has(c) ? c : fallback
}

export function normalizeKdColors(colors) {
  const src = colors && typeof colors === 'object' ? colors : {}
  return {
    k: pickPaletteColor(src.k, DEFAULT_KD_COLORS.k),
    d: pickPaletteColor(src.d, DEFAULT_KD_COLORS.d),
  }
}

export function normalizeMacdColors(colors) {
  const src = colors && typeof colors === 'object' ? colors : {}
  return {
    dif: pickPaletteColor(src.dif, DEFAULT_MACD_COLORS.dif),
    dea: pickPaletteColor(src.dea, DEFAULT_MACD_COLORS.dea),
  }
}

function chartTheme() {
  return {
    layout: {
      background: { type: ColorType.Solid, color: '#0d1117' },
      textColor: '#9aa4b2',
      fontFamily: '"Noto Sans TC", "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(255,255,255,0.65)',
        width: 1,
        style: 0,
        labelBackgroundColor: '#484f58',
      },
      horzLine: {
        color: 'rgba(255,255,255,0.65)',
        width: 1,
        style: 0,
        labelBackgroundColor: '#484f58',
      },
    },
    rightPriceScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      scaleMargins: { top: 0.08, bottom: 0.18 },
    },
    timeScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      minBarSpacing: 3,
      // 避免 zoom out 到資料區外大片空白
      fixLeftEdge: false,
      fixRightEdge: false,
    },
  }
}

const PRICE_SCALE_WIDTH = 64

/**
 * 建立主圖 + 副圖的 K 線視圖
 */
export function createKlineView(
  mainEl,
  subEl,
  {
    onCrosshair,
    maLines: initialMaLines,
    kdColors: initialKdColors,
    macdColors: initialMacdColors,
    timeKind = 'daily',
    swingRangeEl = null,
  } = {},
) {
  let maLines = normalizeMaLines(initialMaLines)
  let kdColors = normalizeKdColors(initialKdColors)
  let macdColors = normalizeMacdColors(initialMacdColors)
  const theme = chartTheme()
  const timeFormatter = klineTimeFormatter(timeKind)

  const mainChart = createChart(mainEl, {
    ...theme,
    width: mainEl.clientWidth,
    height: mainEl.clientHeight,
    localization: {
      timeFormatter,
    },
    timeScale: {
      ...theme.timeScale,
      // 刻度放在主圖底部＝K 線與技術線圖之間
      visible: true,
    },
    rightPriceScale: {
      ...theme.rightPriceScale,
      minimumWidth: PRICE_SCALE_WIDTH,
    },
  })

  const candleSeries = mainChart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderUpColor: UP,
    borderDownColor: DOWN,
    wickUpColor: UP,
    wickDownColor: DOWN,
    borderVisible: true,
    priceLineVisible: false,
    lastValueVisible: false,
  })

  const maSeries = maLines.map((line) =>
    mainChart.addSeries(LineSeries, {
      color: line.color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }),
  )

  const volumeSeries = mainChart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    priceLineVisible: false,
    lastValueVisible: false,
  })
  mainChart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  })

  const highLowLabels = new HighLowLabelsPrimitive()
  candleSeries.attachPrimitive(highLowLabels)

  const swingRangeLabel = swingRangeEl
  if (swingRangeLabel) {
    swingRangeLabel.hidden = true
    swingRangeLabel.textContent = ''
    swingRangeLabel.classList.remove('up', 'down')
  }

  const subChart = createChart(subEl, {
    ...theme,
    width: subEl.clientWidth,
    height: subEl.clientHeight,
    localization: {
      timeFormatter,
    },
    rightPriceScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      scaleMargins: { top: 0.12, bottom: 0.12 },
      minimumWidth: PRICE_SCALE_WIDTH,
    },
    timeScale: {
      ...theme.timeScale,
      // 時間軸改由主圖顯示，避免副圖底部重複刻度
      visible: false,
    },
  })

  let subSeries = []
  let subSnapSeries = null

  function clearSub() {
    for (const s of subSeries) subChart.removeSeries(s)
    subSeries = []
    subSnapSeries = null
  }

  function setSubIndicator(type, candles) {
    clearSub()
    const times = candles.map((c) => c.time)
    const closes = candles.map((c) => c.close)

    if (type === 'macd') {
      const { dif, dea, hist } = calcMACD(closes)
      currentSubValues = { type: 'macd', dif, dea, hist }
      const histSeries = subChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      histSeries.setData(
        times.map((time, i) => {
          if (hist[i] == null) return { time }
          return {
            time,
            value: hist[i],
            color: hist[i] >= 0 ? 'rgba(239,83,80,0.7)' : 'rgba(38,166,154,0.7)',
          }
        }),
      )

      const difSeries = subChart.addSeries(LineSeries, {
        color: macdColors.dif,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      difSeries.setData(toLineData(times, dif))

      const deaSeries = subChart.addSeries(LineSeries, {
        color: macdColors.dea,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      deaSeries.setData(toLineData(times, dea))
      subSeries = [histSeries, difSeries, deaSeries]
      subSnapSeries = difSeries
      return
    }

    // KD 預設
    const { k, d } = calcKD(candles)
    currentSubValues = { type: 'kd', k, d }
    const kSeries = subChart.addSeries(LineSeries, {
      color: kdColors.k,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const dSeries = subChart.addSeries(LineSeries, {
      color: kdColors.d,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    kSeries.setData(toLineData(times, k))
    dSeries.setData(toLineData(times, d))
    subSeries = [kSeries, dSeries]
    subSnapSeries = kSeries
  }

  let currentCandles = []
  let currentMaValues = []
  let currentSubValues = null
  let currentSub = 'kd'
  let syncingRange = false
  let syncingCrosshair = false
  let initialViewBars = null

  function buildSubPayload(index) {
    if (!currentSubValues) return null
    if (currentSubValues.type === 'macd') {
      return {
        type: 'macd',
        dif: currentSubValues.dif[index] ?? null,
        dea: currentSubValues.dea[index] ?? null,
        hist: currentSubValues.hist[index] ?? null,
      }
    }
    return {
      type: 'kd',
      k: currentSubValues.k[index] ?? null,
      d: currentSubValues.d[index] ?? null,
    }
  }

  function getSubSnapPrice(index) {
    if (!currentSubValues) return null
    if (currentSubValues.type === 'macd') return currentSubValues.dif[index] ?? null
    return currentSubValues.k[index] ?? null
  }

  function buildCrosshairPayload(index, { idle = false } = {}) {
    const bar = currentCandles[index]
    if (!bar) return null
    const ma = currentMaValues.map((values) => {
      const v = values?.[index]
      return v == null ? null : v
    })
    return { ...bar, ma, sub: buildSubPayload(index), idle }
  }

  function emitCrosshair(index, options) {
    onCrosshair?.(index == null ? null : buildCrosshairPayload(index, options))
  }

  function refreshMaSeries() {
    if (!currentCandles.length) {
      maLines.forEach((line, idx) => maSeries[idx].applyOptions({ color: line.color }))
      return
    }
    const closes = currentCandles.map((c) => c.close)
    const times = currentCandles.map((c) => c.time)
    currentMaValues = maLines.map((line, idx) => {
      maSeries[idx].applyOptions({ color: line.color })
      const values = calcSMA(closes, line.period)
      maSeries[idx].setData(toLineData(times, values))
      return values
    })
  }

  function updateSwingRangeLabel(high, low) {
    if (!swingRangeLabel) return
    if (!high || !low || high.price <= 0 || low.price <= 0 || high.price === low.price) {
      swingRangeLabel.hidden = true
      swingRangeLabel.textContent = ''
      swingRangeLabel.removeAttribute('title')
      swingRangeLabel.classList.remove('up', 'down')
      return
    }
    // 最低在左、最高在右 → 波段漲幅；(高-低)/低
    // 最高在左、最低在右 → 波段跌幅；(高-低)/高
    if (low.index < high.index) {
      const pct = ((high.price - low.price) / low.price) * 100
      swingRangeLabel.textContent = `波段漲幅 ${pct.toFixed(2)}%`
      swingRangeLabel.title =
        `可見區間最低價在左、最高價在右\n` +
        `波段漲幅 = (最高價 − 最低價) ÷ 最低價\n` +
        `= (${formatPrice(high.price)} − ${formatPrice(low.price)}) ÷ ${formatPrice(low.price)}`
      swingRangeLabel.classList.remove('down')
      swingRangeLabel.classList.add('up')
      swingRangeLabel.hidden = false
    } else if (high.index < low.index) {
      const pct = ((high.price - low.price) / high.price) * 100
      swingRangeLabel.textContent = `波段跌幅 ${pct.toFixed(2)}%`
      swingRangeLabel.title =
        `可見區間最高價在左、最低價在右\n` +
        `波段跌幅 = (最高價 − 最低價) ÷ 最高價\n` +
        `= (${formatPrice(high.price)} − ${formatPrice(low.price)}) ÷ ${formatPrice(high.price)}`
      swingRangeLabel.classList.remove('up')
      swingRangeLabel.classList.add('down')
      swingRangeLabel.hidden = false
    } else {
      swingRangeLabel.hidden = true
      swingRangeLabel.textContent = ''
      swingRangeLabel.removeAttribute('title')
      swingRangeLabel.classList.remove('up', 'down')
    }
  }

  function updateHighLowLabels(range) {
    if (!currentCandles.length) {
      highLowLabels.setPoints([])
      updateSwingRangeLabel(null, null)
      return
    }
    const logical = range || mainChart.timeScale().getVisibleLogicalRange()
    if (!logical) {
      highLowLabels.setPoints([])
      updateSwingRangeLabel(null, null)
      return
    }
    const from = Math.max(0, Math.floor(logical.from))
    const to = Math.min(currentCandles.length - 1, Math.ceil(logical.to))
    if (from > to) {
      highLowLabels.setPoints([])
      updateSwingRangeLabel(null, null)
      return
    }
    const { high, low } = findRangeHighLow(currentCandles.slice(from, to + 1))
    const hlPoints = []
    if (high) hlPoints.push({ ...high, kind: 'high' })
    if (low) hlPoints.push({ ...low, kind: 'low' })
    highLowLabels.setPoints(hlPoints)
    updateSwingRangeLabel(high, low)
  }

  function applyVisibleWindow(candles, viewBars) {
    if (!candles.length) return
    syncingRange = true
    if (viewBars && candles.length > viewBars) {
      const from = candles.length - viewBars
      const to = candles.length - 1 + 3
      mainChart.timeScale().setVisibleLogicalRange({ from, to })
      subChart.timeScale().setVisibleLogicalRange({ from, to })
    } else {
      const width = Math.max(mainEl.clientWidth || 0, 1)
      const minSpacing = Math.max(0.5, ((width - 80) * 0.98) / candles.length)
      mainChart.timeScale().applyOptions({ minBarSpacing: minSpacing })
      subChart.timeScale().applyOptions({ minBarSpacing: minSpacing })
      const to = candles.length - 0.5
      mainChart.timeScale().setVisibleLogicalRange({ from: -0.5, to })
      subChart.timeScale().setVisibleLogicalRange({ from: -0.5, to })
    }
    syncingRange = false
    updateHighLowLabels()
  }

  function getVisibleTimeRange() {
    try {
      return mainChart.timeScale().getVisibleRange()
    } catch {
      return null
    }
  }

  function applyVisibleTimeRange(range) {
    if (!range || range.from == null || range.to == null || !currentCandles.length) return false
    syncingRange = true
    try {
      mainChart.timeScale().setVisibleRange(range)
      subChart.timeScale().setVisibleRange(range)
      syncingRange = false
      updateHighLowLabels()
      return true
    } catch {
      syncingRange = false
      return false
    }
  }

  function clampVisibleRange(range) {
    if (!range || !currentCandles.length) return range
    const last = currentCandles.length - 1
    const minFrom = -2
    const maxTo = last + 6
    let { from, to } = range
    let changed = false

    if (from < minFrom) {
      const delta = minFrom - from
      from = minFrom
      to += delta
      changed = true
    }
    if (to > maxTo) {
      const delta = to - maxTo
      to = maxTo
      from = Math.max(minFrom, from - delta)
      changed = true
    }
    // 避免 zoom out 後可見區遠大於資料量（頭尾大片空白）
    const span = to - from
    const maxSpan = Math.max(currentCandles.length + 8, 20)
    if (span > maxSpan) {
      const mid = (from + to) / 2
      from = mid - maxSpan / 2
      to = mid + maxSpan / 2
      if (from < minFrom) {
        to += minFrom - from
        from = minFrom
      }
      if (to > maxTo) {
        from -= to - maxTo
        to = maxTo
      }
      changed = true
    }

    return changed ? { from, to } : range
  }

  function setData(
    candles,
    subType = currentSub,
    { viewBars = initialViewBars, preserveView = false, timeRange = null } = {},
  ) {
    currentCandles = candles
    currentSub = subType
    if (!preserveView && viewBars != null) initialViewBars = viewBars

    const candleData = candles.map(({ time, open, high, low, close }) => ({
      time,
      open,
      high,
      low,
      close,
    }))
    candleSeries.setData(candleData)

    refreshMaSeries()

    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(239,83,80,0.45)' : 'rgba(38,166,154,0.45)',
      })),
    )

    setSubIndicator(subType, candles)
    if (!preserveView) {
      const applied = timeRange ? applyVisibleTimeRange(timeRange) : false
      if (!applied) applyVisibleWindow(candles, initialViewBars)
    } else {
      updateHighLowLabels()
    }
    if (candles.length) emitCrosshair(candles.length - 1, { idle: true })
  }

  function applySyncedRange(range) {
    const next = clampVisibleRange(range)
    syncingRange = true
    mainChart.timeScale().setVisibleLogicalRange(next)
    subChart.timeScale().setVisibleLogicalRange(next)
    syncingRange = false
    updateHighLowLabels(next)
  }

  // 同步時間軸，並限制空白區；同時更新可見區間高低價標籤
  mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncingRange || !range) return
    applySyncedRange(range)
  })
  subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncingRange || !range) return
    applySyncedRange(range)
  })

  function syncCrosshairToIndex(index) {
    const bar = currentCandles[index]
    if (!bar) return
    const subPrice = getSubSnapPrice(index)
    syncingCrosshair = true
    mainChart.setCrosshairPosition(bar.close, bar.time, candleSeries)
    if (subSnapSeries && subPrice != null && Number.isFinite(subPrice)) {
      subChart.setCrosshairPosition(subPrice, bar.time, subSnapSeries)
    } else {
      subChart.clearCrosshairPosition()
    }
    syncingCrosshair = false
  }

  function handleCrosshairMove(param) {
    if (syncingCrosshair) return

    if (!param?.time || !param.point) {
      syncingCrosshair = true
      mainChart.clearCrosshairPosition()
      subChart.clearCrosshairPosition()
      syncingCrosshair = false
      emitCrosshair(currentCandles.length ? currentCandles.length - 1 : null, { idle: true })
      return
    }

    const index = currentCandles.findIndex((c) => c.time === param.time)
    if (index < 0) {
      emitCrosshair(currentCandles.length ? currentCandles.length - 1 : null, { idle: true })
      return
    }

    // 主圖橫線對齊收盤價；副圖橫線對齊主要指標，並讓兩圖垂直十字線對齊
    syncCrosshairToIndex(index)
    emitCrosshair(index)
  }

  mainChart.subscribeCrosshairMove(handleCrosshairMove)
  subChart.subscribeCrosshairMove(handleCrosshairMove)

  function fitAllOnDblClick() {
    if (!currentCandles.length) return
    applyVisibleWindow(currentCandles, null)
  }
  mainChart.subscribeDblClick(fitAllOnDblClick)
  subChart.subscribeDblClick(fitAllOnDblClick)

  function resize() {
    mainChart.applyOptions({ width: mainEl.clientWidth, height: mainEl.clientHeight })
    subChart.applyOptions({ width: subEl.clientWidth, height: subEl.clientHeight })
  }

  const ro = new ResizeObserver(resize)
  ro.observe(mainEl)
  ro.observe(subEl)

  function destroy() {
    ro.disconnect()
    if (swingRangeLabel) {
      swingRangeLabel.hidden = true
      swingRangeLabel.textContent = ''
      swingRangeLabel.removeAttribute('title')
      swingRangeLabel.classList.remove('up', 'down')
    }
    mainChart.remove()
    subChart.remove()
  }

  return {
    setData,
    getVisibleTimeRange,
    setMaLines(next) {
      maLines = normalizeMaLines(next)
      refreshMaSeries()
      if (currentCandles.length) emitCrosshair(currentCandles.length - 1, { idle: true })
    },
    setKdColors(next) {
      kdColors = normalizeKdColors(next)
      if (currentSub === 'kd' && subSeries.length >= 2) {
        subSeries[0].applyOptions({ color: kdColors.k })
        subSeries[1].applyOptions({ color: kdColors.d })
      }
      if (currentCandles.length) emitCrosshair(currentCandles.length - 1, { idle: true })
    },
    setMacdColors(next) {
      macdColors = normalizeMacdColors(next)
      if (currentSub === 'macd' && subSeries.length >= 3) {
        subSeries[1].applyOptions({ color: macdColors.dif })
        subSeries[2].applyOptions({ color: macdColors.dea })
      }
      if (currentCandles.length) emitCrosshair(currentCandles.length - 1, { idle: true })
    },
    setSubType(type) {
      if (!currentCandles.length) {
        currentSub = type
        return
      }
      const range = mainChart.timeScale().getVisibleLogicalRange()
      setData(currentCandles, type, { preserveView: true })
      if (range) {
        syncingRange = true
        mainChart.timeScale().setVisibleLogicalRange(range)
        subChart.timeScale().setVisibleLogicalRange(range)
        syncingRange = false
      }
    },
    resize,
    destroy,
  }
}

/** 分時時間軸：以分鐘（HH:mm）為主刻度 */
function intradayTickMarkFormatter(time, tickMarkType, locale) {
  const date = timeToDate(time)
  if (
    tickMarkType === TickMarkType.Year ||
    tickMarkType === TickMarkType.Month ||
    tickMarkType === TickMarkType.DayOfMonth
  ) {
    return date.toLocaleString(locale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return date.toLocaleTimeString(locale, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

const INTRADAY_UP_LINE = '#ef5350'
const INTRADAY_DOWN_LINE = '#4caf50'
const INTRADAY_VOLUME = 'rgba(66, 165, 245, 0.75)'
/** 成交價平均線（均價） */
const INTRADAY_AVG_LINE = '#ffffff'

function dayKeyFromTime(time) {
  const d = timeToDate(time)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** 只保留最近 N 個交易日的分時資料 */
function filterLastTradingDays(candles, tradingDays) {
  if (!tradingDays || tradingDays <= 0 || !candles.length) return candles
  const keys = []
  const seen = new Set()
  for (let i = candles.length - 1; i >= 0; i--) {
    const key = dayKeyFromTime(candles[i].time)
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
    if (keys.length >= tradingDays) break
  }
  const keep = new Set(keys)
  return candles.filter((c) => keep.has(dayKeyFromTime(c.time)))
}

/** 找出「新交易日」第一根 K 的時間（跳過第一天，用來畫日界虛線） */
function findDayBoundaryTimes(candles) {
  if (candles.length < 2) return []
  const times = []
  let prev = dayKeyFromTime(candles[0].time)
  for (let i = 1; i < candles.length; i++) {
    const key = dayKeyFromTime(candles[i].time)
    if (key !== prev) {
      times.push(candles[i].time)
      prev = key
    }
  }
  return times
}

/** 可見區間最高／最低價位置（含相對索引，供判斷左右） */
function findRangeHighLow(candles) {
  let high = null
  let low = null
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const h = Number.isFinite(c.high) ? c.high : c.close
    const l = Number.isFinite(c.low) ? c.low : c.close
    if (h == null || !Number.isFinite(h) || l == null || !Number.isFinite(l)) continue
    if (!high || h > high.price) high = { time: c.time, price: h, index: i }
    if (!low || l < low.price) low = { time: c.time, price: l, index: i }
  }
  return { high, low }
}

/** 多日分時：日與日之間的垂直虛線 */
class DaySeparatorsPrimitive {
  constructor() {
    this._times = []
    this._chart = null
    this._requestUpdate = null
    this._paneView = {
      zOrder: () => 'bottom',
      renderer: () => {
        const chart = this._chart
        const times = this._times
        if (!chart || !times.length) return null
        return {
          draw: (target, utils) => {
            target.useBitmapCoordinateSpace((scope) => {
              const { context: ctx, bitmapSize, horizontalPixelRatio } = scope
              const timeScale = chart.timeScale()
              ctx.save()
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
              ctx.lineWidth = Math.max(1, Math.round(horizontalPixelRatio))
              utils?.setLineStyle?.(ctx, LineStyle.Dashed)
              if (!utils?.setLineStyle) ctx.setLineDash([6 * horizontalPixelRatio, 6 * horizontalPixelRatio])
              for (const t of times) {
                const x = timeScale.timeToCoordinate(t)
                if (x == null) continue
                const xr = Math.round(x * horizontalPixelRatio) + (ctx.lineWidth % 2 ? 0.5 : 0)
                ctx.beginPath()
                ctx.moveTo(xr, 0)
                ctx.lineTo(xr, bitmapSize.height)
                ctx.stroke()
              }
              ctx.restore()
            })
          },
        }
      },
    }
  }

  setTimes(times) {
    this._times = times
    this._requestUpdate?.()
  }

  attached({ chart, requestUpdate }) {
    this._chart = chart
    this._requestUpdate = requestUpdate
  }

  detached() {
    this._chart = null
    this._requestUpdate = null
  }

  updateAllViews() {}

  paneViews() {
    return [this._paneView]
  }
}

/** 在最高／最低價位置畫白色標籤（分時／K 線共用） */
class HighLowLabelsPrimitive {
  constructor() {
    this._points = []
    this._chart = null
    this._series = null
    this._requestUpdate = null
    this._paneView = {
      zOrder: () => 'top',
      renderer: () => {
        const chart = this._chart
        const series = this._series
        const points = this._points
        if (!chart || !series || !points.length) return null
        return {
          draw: (target) => {
            target.useMediaCoordinateSpace((scope) => {
              const { context: ctx, mediaSize } = scope
              const timeScale = chart.timeScale()
              ctx.save()
              ctx.font = '600 12px "Segoe UI", "Noto Sans TC", sans-serif'
              ctx.fillStyle = '#ffffff'
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
              ctx.lineWidth = 3
              ctx.lineJoin = 'round'

              for (const p of points) {
                const x = timeScale.timeToCoordinate(p.time)
                const y = series.priceToCoordinate(p.price)
                if (x == null || y == null) continue

                const text = formatPrice(p.price)
                const metrics = ctx.measureText(text)
                const pad = 8
                let tx = x
                if (tx - metrics.width / 2 < pad) tx = pad + metrics.width / 2
                if (tx + metrics.width / 2 > mediaSize.width - pad) {
                  tx = mediaSize.width - pad - metrics.width / 2
                }

                const ty = p.kind === 'high'
                  ? Math.max(pad + 2, y - 8)
                  : Math.min(mediaSize.height - pad, y + 8)

                ctx.textAlign = 'center'
                ctx.textBaseline = p.kind === 'high' ? 'bottom' : 'top'
                ctx.strokeText(text, tx, ty)
                ctx.fillText(text, tx, ty)
              }
              ctx.restore()
            })
          },
        }
      },
    }
  }

  setPoints(points) {
    this._points = points
    this._requestUpdate?.()
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart
    this._series = series
    this._requestUpdate = requestUpdate
  }

  detached() {
    this._chart = null
    this._series = null
    this._requestUpdate = null
  }

  updateAllViews() {}

  autoscaleInfo() {
    if (!this._points.length) return null
    let min = Infinity
    let max = -Infinity
    for (const p of this._points) {
      if (!Number.isFinite(p.price)) continue
      min = Math.min(min, p.price)
      max = Math.max(max, p.price)
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    return { priceRange: { minValue: min, maxValue: max } }
  }

  paneViews() {
    return [this._paneView]
  }
}

/** 分時／日內：以昨收為基準的紅／綠面積（填色只到昨收線） */
export function createIntradayView(mainEl, { onCrosshair } = {}) {
  const theme = chartTheme()
  const chart = createChart(mainEl, {
    ...theme,
    width: mainEl.clientWidth,
    height: mainEl.clientHeight,
    rightPriceScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      scaleMargins: { top: 0.08, bottom: 0.22 },
    },
    localization: {
      timeFormatter: localTimeFormatter,
    },
    timeScale: {
      ...theme.timeScale,
      timeVisible: true,
      secondsVisible: false,
      // 多日 1 分鐘資料點很多；實際下限在 fitIntradayContent 依資料量重算
      minBarSpacing: 0.01,
      rightOffset: 0,
      tickMarkFormatter: intradayTickMarkFormatter,
    },
  })

  // Baseline：高於昨收 → 紅；低於昨收 → 綠（填色只到昨收線）
  // 不可用 relativeGradient：當最高價 ≤ 昨收（或只短暫越過）時，
  // library 會把「昨收～可見最高價」之間的空隙 clamp 成整條實心紅帶
  const baselineSeries = chart.addSeries(BaselineSeries, {
    baseValue: { type: 'price', price: 0 },
    relativeGradient: false,
    topLineColor: INTRADAY_UP_LINE,
    topFillColor1: 'rgba(239, 83, 80, 0.45)',
    topFillColor2: 'rgba(239, 83, 80, 0)',
    bottomLineColor: INTRADAY_DOWN_LINE,
    bottomFillColor1: 'rgba(76, 175, 80, 0)',
    bottomFillColor2: 'rgba(76, 175, 80, 0.45)',
    lineWidth: 2,
    crosshairMarkerVisible: false,
    priceLineVisible: false,
    lastValueVisible: false,
  })

  const avgSeries = chart.addSeries(LineSeries, {
    color: INTRADAY_AVG_LINE,
    lineWidth: 1,
    crosshairMarkerVisible: false,
    priceLineVisible: false,
    lastValueVisible: false,
  })

  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    priceLineVisible: false,
    lastValueVisible: false,
  })
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  })

  const daySeparators = new DaySeparatorsPrimitive()
  baselineSeries.attachPrimitive(daySeparators)
  const highLowLabels = new HighLowLabelsPrimitive()
  baselineSeries.attachPrimitive(highLowLabels)

  let rows = []
  let avgValues = []
  let prevCloseRef = null
  let prevCloseLine = null
  let syncingCrosshair = false

  function emitIntradayCrosshair(idx) {
    if (!onCrosshair) return
    if (idx == null || idx < 0) {
      onCrosshair(null)
      return
    }
    const bar = rows[idx]
    let change = null
    let changePercent = null
    if (prevCloseRef != null && prevCloseRef !== 0 && bar.close != null) {
      change = bar.close - prevCloseRef
      changePercent = (change / prevCloseRef) * 100
    }
    onCrosshair({
      ...bar,
      avg: avgValues[idx] ?? null,
      change,
      changePercent,
    })
  }

  /** 橫線對齊該時間點成交價，且垂直線不超出第一／最後一筆 */
  function syncCrosshairToIndex(idx) {
    const bar = rows[idx]
    if (!bar) return
    syncingCrosshair = true
    chart.setCrosshairPosition(bar.close, bar.time, baselineSeries)
    syncingCrosshair = false
  }

  function clampCrosshairToData(param) {
    if (syncingCrosshair) return
    if (!rows.length) {
      emitIntradayCrosshair(null)
      return
    }
    if (!param?.point) {
      emitIntradayCrosshair(null)
      return
    }

    const first = rows[0]
    const last = rows[rows.length - 1]
    const ts = chart.timeScale()
    const firstX = ts.timeToCoordinate(first.time)
    const lastX = ts.timeToCoordinate(last.time)
    const x = param.point.x

    let idx = -1
    if (firstX != null && x < firstX) {
      idx = 0
    } else if (lastX != null && x > lastX) {
      idx = rows.length - 1
    } else if (param.time != null) {
      idx = rows.findIndex((c) => c.time === param.time)
    }

    if (idx < 0) {
      emitIntradayCrosshair(null)
      return
    }

    syncCrosshairToIndex(idx)
    emitIntradayCrosshair(idx)
  }

  function intradayMinBarSpacing(barCount) {
    const width = Math.max(mainEl.clientWidth || 0, 1)
    const n = Math.max(barCount, 1)
    // 預留右側價軸；下限要夠低，三日／五日才能一次塞進畫面
    const plotWidth = Math.max(width - 80, width * 0.78)
    return Math.max(0.01, (plotWidth * 0.98) / n)
  }

  function fitIntradayContent() {
    chart.timeScale().applyOptions({ minBarSpacing: intradayMinBarSpacing(rows.length) })
    // 明確指定邏輯範圍，避免 fitContent 受舊 minBarSpacing 夾住
    if (rows.length > 1) {
      chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: rows.length - 0.5 })
    } else {
      chart.timeScale().fitContent()
    }
  }

  function setData(candles, previousClose, { tradingDays } = {}) {
    const filtered = filterLastTradingDays(candles, tradingDays)
    rows = filtered
    const pc = previousClose ?? filtered[0]?.open ?? 0
    prevCloseRef = previousClose != null ? previousClose : (filtered[0]?.open ?? null)

    baselineSeries.applyOptions({
      baseValue: { type: 'price', price: pc },
    })
    baselineSeries.setData(filtered.map((c) => ({ time: c.time, value: c.close })))

    avgValues = calcIntradayAvgPrice(filtered, dayKeyFromTime)
    avgSeries.setData(toLineData(
      filtered.map((c) => c.time),
      avgValues,
    ))

    volumeSeries.setData(
      filtered.map((c) => ({
        time: c.time,
        value: c.volume || 0,
        color: INTRADAY_VOLUME,
      })),
    )

    daySeparators.setTimes(findDayBoundaryTimes(filtered))

    const { high, low } = findRangeHighLow(filtered)
    const hlPoints = []
    if (high) hlPoints.push({ ...high, kind: 'high' })
    if (low) hlPoints.push({ ...low, kind: 'low' })
    highLowLabels.setPoints(hlPoints)

    if (prevCloseLine) {
      baselineSeries.removePriceLine(prevCloseLine)
      prevCloseLine = null
    }
    if (previousClose != null) {
      prevCloseLine = baselineSeries.createPriceLine({
        price: previousClose,
        color: 'rgba(255,255,255,0.35)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      })
    }

    fitIntradayContent()
  }

  chart.subscribeCrosshairMove(clampCrosshairToData)
  chart.subscribeDblClick(() => {
    if (!rows.length) return
    fitIntradayContent()
  })

  function resize() {
    chart.applyOptions({ width: mainEl.clientWidth, height: mainEl.clientHeight })
    if (rows.length) {
      chart.timeScale().applyOptions({ minBarSpacing: intradayMinBarSpacing(rows.length) })
    }
  }

  const ro = new ResizeObserver(resize)
  ro.observe(mainEl)

  return {
    setData,
    resize,
    destroy() {
      ro.disconnect()
      chart.remove()
    },
  }
}
