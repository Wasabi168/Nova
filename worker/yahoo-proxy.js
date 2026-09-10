/**
 * Cloudflare Worker：Yahoo Finance + 證交所 MIS CORS 代理
 *
 * 部署後把 Worker 網址填進 GitHub Actions secret `VITE_PROXY_BASE`
 *（或瀏覽器 localStorage `nova.settings.proxyBase`）
 *
 * 路由：
 *   /v7|/v8|/v1/...          → query1.finance.yahoo.com
 *   /stock/api/...           → mis.twse.com.tw
 */
export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    const isTwse = url.pathname.startsWith('/stock/api/')
    const target = isTwse
      ? `https://mis.twse.com.tw${url.pathname}${url.search}`
      : `https://query1.finance.yahoo.com${url.pathname}${url.search}`

    const headers = {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    }
    if (isTwse) headers.Referer = 'https://mis.twse.com.tw/'

    const upstream = await fetch(target, { headers })
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=15',
      },
    })
  },
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }
}
