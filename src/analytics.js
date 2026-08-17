const MEASUREMENT_ID = (
  import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-PDY424NMRW'
).trim()

let started = false

export function initAnalytics() {
  if (started || !MEASUREMENT_ID) return
  started = true

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`
  document.head.appendChild(script)
}

export function trackPageView(path, params = {}) {
  if (!MEASUREMENT_ID || typeof window.gtag !== 'function') return

  const pagePath =
    path === 'stock' && params.symbol
      ? `/stock/${encodeURIComponent(params.symbol)}`
      : `/${path}`

  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_location: window.location.href,
    page_path: pagePath,
  })
}
