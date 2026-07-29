/** 技術指標計算（純前端） */

export function calcSMA(closes, period) {
  const out = new Array(closes.length).fill(null)
  if (period <= 0) return out

  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function calcEMA(closes, period) {
  const out = new Array(closes.length).fill(null)
  if (!closes.length || period <= 0) return out

  const k = 2 / (period + 1)
  let ema = closes[0]
  out[0] = ema
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    out[i] = ema
  }
  return out
}

export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const dif = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  )

  const difVals = dif.map((v) => v ?? 0)
  const deaRaw = calcEMA(difVals, signal)
  const dea = dif.map((v, i) => (v == null ? null : deaRaw[i]))
  const hist = dif.map((v, i) => (v == null || dea[i] == null ? null : v - dea[i]))

  return { dif, dea, hist }
}

export const KD_DEFAULTS = { period: 9, kSmooth: 3, dSmooth: 3 }

export function calcKD(
  candles,
  period = KD_DEFAULTS.period,
  kSmooth = KD_DEFAULTS.kSmooth,
  dSmooth = KD_DEFAULTS.dSmooth,
) {
  const rsv = new Array(candles.length).fill(null)

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue
    let highest = -Infinity
    let lowest = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j].high)
      lowest = Math.min(lowest, candles[j].low)
    }
    const range = highest - lowest
    rsv[i] = range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100
  }

  const k = new Array(candles.length).fill(null)
  const d = new Array(candles.length).fill(null)
  let prevK = 50
  let prevD = 50

  for (let i = 0; i < candles.length; i++) {
    if (rsv[i] == null) continue
    const curK = (prevK * (kSmooth - 1) + rsv[i]) / kSmooth
    const curD = (prevD * (dSmooth - 1) + curK) / dSmooth
    k[i] = curK
    d[i] = curD
    prevK = curK
    prevD = curD
  }

  return { k, d }
}

/**
 * 分時成交價平均線（成交量加權均價 VWAP）。
 * 同一交易日內累計；跨日（三日／五日）會重算。
 * typical = (high + low + close) / 3；缺高低時改用 close。
 */
export function calcIntradayAvgPrice(candles, getDayKey) {
  const out = new Array(candles.length).fill(null)
  if (!candles.length) return out

  let day = null
  let cumPV = 0
  let cumV = 0
  let last = null

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const key = getDayKey ? getDayKey(c.time) : 0
    if (key !== day) {
      day = key
      cumPV = 0
      cumV = 0
      last = null
    }

    const vol = Number(c.volume) || 0
    const close = c.close
    if (close == null || !Number.isFinite(close)) {
      out[i] = last
      continue
    }

    const high = Number.isFinite(c.high) ? c.high : close
    const low = Number.isFinite(c.low) ? c.low : close
    const typical = (high + low + close) / 3

    if (vol > 0) {
      cumPV += typical * vol
      cumV += vol
      last = cumPV / cumV
    } else if (last == null) {
      last = typical
    }
    out[i] = last
  }
  return out
}

/** 轉成折線資料；無值處放 whitespace，確保與 K 線時間軸索引對齊 */
export function toLineData(times, values) {
  const out = []
  for (let i = 0; i < times.length; i++) {
    if (values[i] == null || !Number.isFinite(values[i])) {
      out.push({ time: times[i] })
      continue
    }
    out.push({ time: times[i], value: values[i] })
  }
  return out
}
