/** 公開 CORS 代理／自訂 Worker 的共用抓取 */

export const FETCH_MS = 8_000

function readProxyBase() {
  try {
    const raw = localStorage.getItem('nova.settings')
    const s = raw ? JSON.parse(raw) : {}
    const v = typeof s?.proxyBase === 'string' ? s.proxyBase.trim() : ''
    if (v) return v.replace(/\/$/, '')
  } catch {
    /* ignore */
  }
  const env = String(import.meta.env.VITE_PROXY_BASE || '').trim()
  return env ? env.replace(/\/$/, '') : ''
}

export function yahooBase() {
  const custom = readProxyBase()
  if (custom) return custom
  if (import.meta.env.DEV) return '/api/yahoo'
  return ''
}

export function twseBase() {
  const custom = readProxyBase()
  if (custom) return custom
  if (import.meta.env.DEV) return '/api/twse'
  return ''
}

export async function fetchJson(url, { timeout = FETCH_MS, signal } = {}) {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * GitHub Pages 無法走 Vite 代理；公開代理改並行競速 + 逾時，
 * 避免 corsproxy.io 403 後再卡死在 allorigins。
 */
const CORS_PROXIES = [
  (u) => `https://corx.venipa.workers.dev/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
]

export async function fetchViaCorsProxy(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_MS)
  const attempts = CORS_PROXIES.map((build) => fetchJson(build(url), { signal: ac.signal }))
  try {
    return await Promise.any(attempts)
  } catch {
    throw new Error('無法取得行情資料')
  } finally {
    clearTimeout(timer)
    ac.abort()
    for (const p of attempts) p.catch(() => {})
  }
}

/**
 * @param {'yahoo' | 'twse'} kind
 * @param {string} pathAndQuery 例如 `/v7/finance/spark?...` 或 `/stock/api/getStockInfo.jsp?...`
 */
export async function fetchUpstream(kind, pathAndQuery) {
  const absolute =
    kind === 'twse'
      ? `https://mis.twse.com.tw${pathAndQuery}`
      : `https://query1.finance.yahoo.com${pathAndQuery}`
  const base = kind === 'twse' ? twseBase() : yahooBase()
  const retries = base && import.meta.env.DEV && kind === 'twse' ? 2 : 1

  if (base) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetchJson(`${base}${pathAndQuery}`)
      } catch (err) {
        if (i + 1 < retries) continue
        console.warn(`${kind} 代理失敗，改走 CORS 代理`, err)
      }
    }
  }

  return fetchViaCorsProxy(absolute)
}
