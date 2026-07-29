import './style.css'
import { renderWatchlist } from './views/watchlist.js'
import { renderMarket } from './views/market.js'
import { renderSearch } from './views/search.js'
import { renderSettings } from './views/settings.js'
import { renderStock } from './views/stock.js'

const routes = {
  watchlist: renderWatchlist,
  market: renderMarket,
  search: renderSearch,
  settings: renderSettings,
  stock: renderStock,
}

const app = document.querySelector('#app')
let cleanup = null

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'watchlist'
  const [path, query = ''] = raw.split('?')
  const params = Object.fromEntries(new URLSearchParams(query))
  return { path: path || 'watchlist', params }
}

function navigate(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}

function renderShell(activePath) {
  const hideNav = activePath === 'stock'
  return `
    <div class="app-shell ${hideNav ? 'stock-mode' : ''}">
      <main id="page" class="page"></main>
      <nav class="bottom-nav" ${hideNav ? 'hidden' : ''}>
        <button data-nav="watchlist" class="${activePath === 'watchlist' ? 'active' : ''}">
          <span class="nav-ico">◎</span><span>自選</span>
        </button>
        <button data-nav="market" class="${activePath === 'market' ? 'active' : ''}">
          <span class="nav-ico">▦</span><span>行情</span>
        </button>
        <button data-nav="search" class="${activePath === 'search' ? 'active' : ''}">
          <span class="nav-ico">⌕</span><span>搜尋</span>
        </button>
        <button data-nav="settings" class="${activePath === 'settings' ? 'active' : ''}">
          <span class="nav-ico">⚙</span><span>設定</span>
        </button>
      </nav>
    </div>
  `
}

async function render() {
  if (typeof cleanup === 'function') {
    cleanup()
    cleanup = null
  }

  const { path, params } = parseHash()
  const view = routes[path] || routes.watchlist
  const navPath = path === 'stock' ? 'stock' : path in routes ? path : 'watchlist'

  app.innerHTML = renderShell(navPath)
  const page = app.querySelector('#page')

  app.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav))
  })

  try {
    cleanup = await view(page, { navigate, params })
  } catch (err) {
    page.innerHTML = `<div class="state error">頁面錯誤：${err.message}</div>`
  }
}

window.addEventListener('hashchange', render)
render()
