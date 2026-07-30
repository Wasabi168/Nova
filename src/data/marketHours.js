import { isTaiwanSymbol } from './twse.js'

/** 台股：09:00–13:30（含收盤集合競價） */
const TW_SESSION = { openMinute: 9 * 60, closeMinute: 13 * 60 + 30 }

/** 美股常規：09:30–16:00（交易所當地時間） */
const US_SESSION = { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 }

/**
 * @param {string} symbol
 * @returns {{ openMinute: number, closeMinute: number }}
 */
export function sessionForSymbol(symbol) {
  return isTaiwanSymbol(symbol) ? TW_SESSION : US_SESSION
}

/**
 * 交易所時區下的曆日（與 Yahoo gmtoffset 一致）
 * @param {number} unixSec
 * @param {number} gmtOffsetSec
 */
export function exchangeDayParts(unixSec, gmtOffsetSec) {
  const d = new Date((unixSec + gmtOffsetSec) * 1000)
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    day: d.getUTCDate(),
  }
}

/**
 * 交易所時區當日 00:00 的 unix 秒
 * @param {{ y: number, mo: number, day: number }} parts
 * @param {number} gmtOffsetSec
 */
export function exchangeMidnightUnix(parts, gmtOffsetSec) {
  return Math.floor(Date.UTC(parts.y, parts.mo, parts.day) / 1000) - gmtOffsetSec
}

/**
 * 依市場開～收盤，為每個交易日補齊每分鐘時間點（供 Lightweight Charts whitespace）
 * @param {Array<{ time: number }>} candles 已過濾的分時資料（unix 秒）
 * @param {{ openMinute: number, closeMinute: number }} session
 * @param {number} gmtOffsetSec
 * @returns {number[]}
 */
export function buildSessionMinuteTimes(candles, session, gmtOffsetSec = 0) {
  if (!candles.length) return []

  const dayOrder = []
  const seen = new Set()
  for (const c of candles) {
    if (typeof c.time !== 'number') continue
    const parts = exchangeDayParts(c.time, gmtOffsetSec)
    const key = `${parts.y}-${parts.mo}-${parts.day}`
    if (seen.has(key)) continue
    seen.add(key)
    dayOrder.push(parts)
  }

  const { openMinute, closeMinute } = session
  const times = []
  for (const parts of dayOrder) {
    const midnight = exchangeMidnightUnix(parts, gmtOffsetSec)
    for (let m = openMinute; m <= closeMinute; m++) {
      times.push(midnight + m * 60)
    }
  }
  return times
}
