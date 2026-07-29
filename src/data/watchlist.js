import { DEFAULT_WATCHLIST, normalizeSymbol } from './symbols.js'

const KEY = 'nova.watchlist.v2'
const LEGACY_KEY = 'nova.watchlist'
const ACTIVE_KEY = 'nova.watchlist.activeGroup'

function uid() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function defaultStore() {
  return {
    groups: [
      {
        id: 'default',
        name: '預設',
        symbols: [...DEFAULT_WATCHLIST],
      },
    ],
  }
}

function migrateLegacy() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
    if (Array.isArray(raw) && raw.length) {
      return {
        groups: [{ id: 'default', name: '預設', symbols: [...new Set(raw.filter(Boolean))] }],
      }
    }
  } catch {
    /* ignore */
  }
  return defaultStore()
}

function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw?.groups?.length) {
      let changed = false
      const store = {
        groups: raw.groups.map((g) => {
          const symbols = [...new Set((g.symbols || []).filter(Boolean).map((s) => {
            const fixed = normalizeSymbol(s) || s
            if (fixed !== s) changed = true
            return fixed
          }))]
          return {
            id: g.id || uid(),
            name: g.name || '未命名',
            symbols,
          }
        }),
      }
      if (changed) writeStore(store)
      return store
    }
  } catch {
    /* ignore */
  }
  const migrated = migrateLegacy()
  writeStore(migrated)
  return migrated
}

function writeStore(store) {
  localStorage.setItem(KEY, JSON.stringify(store))
  return store
}

export function getGroups() {
  return readStore().groups
}

export function getActiveGroupId() {
  const groups = getGroups()
  const saved = localStorage.getItem(ACTIVE_KEY)
  if (saved && groups.some((g) => g.id === saved)) return saved
  return groups[0]?.id || 'default'
}

export function setActiveGroupId(id) {
  localStorage.setItem(ACTIVE_KEY, id)
  return id
}

export function getActiveGroup() {
  const groups = getGroups()
  const id = getActiveGroupId()
  return groups.find((g) => g.id === id) || groups[0]
}

/** 目前作用中群組的自選清單 */
export function getWatchlist() {
  return [...(getActiveGroup()?.symbols || [])]
}

export function setGroupSymbols(groupId, symbols) {
  const store = readStore()
  const group = store.groups.find((g) => g.id === groupId)
  if (!group) return getWatchlist()
  group.symbols = [...new Set(symbols.filter(Boolean))]
  writeStore(store)
  return [...group.symbols]
}

export function setWatchlist(symbols) {
  return setGroupSymbols(getActiveGroupId(), symbols)
}

export function addToWatchlist(symbol, groupId = getActiveGroupId()) {
  const store = readStore()
  const group = store.groups.find((g) => g.id === groupId) || store.groups[0]
  if (!group.symbols.includes(symbol)) group.symbols.unshift(symbol)
  writeStore(store)
  return [...group.symbols]
}

export function removeFromWatchlist(symbol, groupId = getActiveGroupId()) {
  const store = readStore()
  const group = store.groups.find((g) => g.id === groupId)
  if (!group) return getWatchlist()
  group.symbols = group.symbols.filter((s) => s !== symbol)
  writeStore(store)
  return [...group.symbols]
}

export function isInWatchlist(symbol, groupId = getActiveGroupId()) {
  const store = readStore()
  const group = store.groups.find((g) => g.id === groupId)
  return !!group?.symbols.includes(symbol)
}

export function isInAnyWatchlist(symbol) {
  return getGroups().some((g) => g.symbols.includes(symbol))
}

export function toggleWatchlist(symbol, groupId = getActiveGroupId()) {
  return isInWatchlist(symbol, groupId)
    ? removeFromWatchlist(symbol, groupId)
    : addToWatchlist(symbol, groupId)
}

export function createGroup(name) {
  const store = readStore()
  const group = { id: uid(), name: (name || '新群組').trim() || '新群組', symbols: [] }
  store.groups.push(group)
  writeStore(store)
  setActiveGroupId(group.id)
  return group
}

export function renameGroup(groupId, name) {
  const store = readStore()
  const group = store.groups.find((g) => g.id === groupId)
  if (!group) return null
  group.name = (name || '').trim() || group.name
  writeStore(store)
  return group
}

export function deleteGroup(groupId) {
  const store = readStore()
  if (store.groups.length <= 1) {
    throw new Error('至少需保留一個群組')
  }
  store.groups = store.groups.filter((g) => g.id !== groupId)
  writeStore(store)
  if (getActiveGroupId() === groupId) {
    setActiveGroupId(store.groups[0].id)
  }
  return store.groups
}

const HISTORY_KEY = 'nova.searchHistory'

export function getSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(raw) ? raw.slice(0, 20) : []
  } catch {
    return []
  }
}

export function pushSearchHistory(item) {
  const list = getSearchHistory().filter((x) => x.symbol !== item.symbol)
  list.unshift({ symbol: item.symbol, name: item.name || item.symbol })
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)))
  return list
}

export function clearSearchHistory() {
  localStorage.removeItem(HISTORY_KEY)
}
