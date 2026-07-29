import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages 專案站：https://Wasabi168.github.io/Nova/
  base: '/Nova/',
  server: {
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      },
      '/api/twse': {
        target: 'https://mis.twse.com.tw',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twse/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://mis.twse.com.tw/',
        },
      },
    },
  },
})
