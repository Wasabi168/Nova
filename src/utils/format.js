export function formatPrice(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  // 整數價（如台積電 tick=5）不顯示小數；其餘依價位保留位數
  const whole = Math.abs(value - Math.round(value)) < 1e-6
  const d = whole ? 0 : abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 2 : 4
  return value.toLocaleString('zh-TW', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

export function formatChange(change, changePercent) {
  if (change == null || changePercent == null) return { text: '—', cls: 'flat' }
  if (change === 0) {
    return { text: `${formatPrice(0)}（0.00%）`, cls: 'flat' }
  }
  const arrow = change > 0 ? '▲' : '▼'
  const pctSign = changePercent > 0 ? '+' : ''
  return {
    text: `${arrow}${formatPrice(Math.abs(change))}（${pctSign}${changePercent.toFixed(2)}%）`,
    cls: change > 0 ? 'up' : 'down',
  }
}

export function formatVolume(v, { unit = 'share', fromShares = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—'
  let n = v
  if (unit === 'lot' && fromShares) n = v / 1000
  if (!Number.isFinite(n)) return '—'

  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}億`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}萬`
  return Math.round(n).toLocaleString('zh-TW')
}

/** 成交量欄位標籤：台股「張」、美股「股」 */
export function volumeLabelForSymbol(symbol) {
  return volumeUnitForSymbol(symbol) === 'lot' ? '張' : '股'
}

/** 依市場決定成交量顯示單位：台股張、美股股 */
export function volumeUnitForSymbol(symbol) {
  const s = String(symbol || '')
  return /\.(TW|TWO)$/i.test(s) ? 'lot' : 'share'
}

export function formatTime(ts, withTime = false) {
  if (ts == null) return '—'
  if (typeof ts === 'string') return ts
  // unix 秒 → 瀏覽器當地時區顯示
  const d = new Date(ts * 1000)
  if (withTime) {
    return d.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return d.toLocaleDateString(undefined)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 解析 K 線 time（business day 字串／物件／unix 秒）為年月日 */
function parseBarDate(time) {
  if (time == null) return null
  if (typeof time === 'string') {
    const [y, m, d] = time.split('-').map(Number)
    if (!y || !m) return null
    return { y, m, d: d || 1 }
  }
  if (typeof time === 'object' && time.year != null) {
    return { y: time.year, m: time.month, d: time.day || 1 }
  }
  if (typeof time === 'number') {
    const date = new Date(time * 1000)
    return {
      y: date.getFullYear(),
      m: date.getMonth() + 1,
      d: date.getDate(),
    }
  }
  return null
}

/**
 * 十字線／明細列的 K 線日期：
 * 日K、周K → 2026/07/03；月K → 2026/07
 */
export function formatKlineBarTime(time, kind = 'daily') {
  const parts = parseBarDate(time)
  if (!parts) return '—'
  if (kind === 'monthly') return `${parts.y}/${pad2(parts.m)}`
  return `${parts.y}/${pad2(parts.m)}/${pad2(parts.d)}`
}

export function changeClass(change) {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

export function formatIndicator(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}
