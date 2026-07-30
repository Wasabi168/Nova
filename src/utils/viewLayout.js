const KEY = 'nova.quote.layout'

export const LAYOUT_MODES = [
  { id: 'list', label: '條列' },
  { id: 'grid', label: '方塊' },
]

export function getViewLayout() {
  return localStorage.getItem(KEY) === 'grid' ? 'grid' : 'list'
}

export function setViewLayout(mode) {
  const next = mode === 'grid' ? 'grid' : 'list'
  localStorage.setItem(KEY, next)
  return next
}

export function applyViewLayout(listEl, mode) {
  if (!listEl) return
  listEl.classList.toggle('layout-grid', mode === 'grid')
}

export function renderViewToggle(mode) {
  return `
    <div class="view-toggle" role="group" aria-label="顯示方式">
      ${LAYOUT_MODES.map(
        (m) => `
        <button type="button" class="chip view-chip ${m.id === mode ? 'active' : ''}" data-layout="${m.id}">
          ${m.label}
        </button>
      `,
      ).join('')}
    </div>
  `
}
