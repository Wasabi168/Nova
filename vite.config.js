import https from 'node:https'
import { defineConfig } from 'vite'

/** 證交所 MIS 多 IP 輪詢且 TTL 極短；keep-alive 會黏在死掉的 IP 上導致 ETIMEDOUT */
const PROXY_MS = 8_000
const twseAgent = new https.Agent({ keepAlive: false, timeout: PROXY_MS })

function attachProxyGuards(label) {
  return (proxy) => {
    proxy.on('error', (err, _req, res) => {
      console.warn(`[vite] ${label} proxy:`, err.code || err.message)
      if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `${label} unreachable` }))
      }
    })
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.setTimeout(PROXY_MS, () => {
        proxyReq.destroy()
      })
    })
  }
}

export default defineConfig({
  // GitHub Pages 專案站：https://Wasabi168.github.io/Nova/
  base: '/Nova/',
  server: {
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        timeout: PROXY_MS,
        proxyTimeout: PROXY_MS,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        configure: attachProxyGuards('yahoo'),
      },
      '/api/twse': {
        target: 'https://mis.twse.com.tw',
        changeOrigin: true,
        timeout: PROXY_MS,
        proxyTimeout: PROXY_MS,
        agent: twseAgent,
        rewrite: (path) => path.replace(/^\/api\/twse/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://mis.twse.com.tw/',
        },
        configure: attachProxyGuards('twse'),
      },
    },
  },
})
