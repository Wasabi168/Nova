import { getGroups, getActiveGroupId, replaceWatchlistStore } from './watchlist.js'
import { getSettings, replaceSettings } from './market.js'

export const BACKUP_APP = 'nova-chart'
export const BACKUP_SCHEMA_VERSION = 1

function isObjectLike(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function createBackupPayload() {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: BACKUP_APP,
    createdAt: new Date().toISOString(),
    watchlist: {
      groups: getGroups().map((g) => ({
        id: String(g.id),
        name: String(g.name),
        symbols: Array.isArray(g.symbols) ? [...g.symbols] : [],
      })),
      activeGroupId: getActiveGroupId(),
    },
    settings: getSettings(),
  }
}

/**
 * 以備份檔覆蓋目前 localStorage。
 * 不處理 `nova.searchHistory`（依你的需求排除）。
 * @param {any} payload
 */
export function importBackupPayload(payload) {
  if (!isObjectLike(payload)) {
    throw new Error('備份檔格式無效')
  }

  const version = payload.schemaVersion ?? BACKUP_SCHEMA_VERSION
  if (version !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`不支援的備份版本：${version}`)
  }

  const watchlist = payload.watchlist
  if (!isObjectLike(watchlist) || !Array.isArray(watchlist.groups)) {
    throw new Error('備份檔 watchlist 格式無效')
  }

  const settings = isObjectLike(payload.settings) ? payload.settings : {}

  // 設定先寫入，避免匯入期間 UI 若觸發報價時用到舊 proxy
  replaceSettings(settings)
  replaceWatchlistStore({ groups: watchlist.groups, activeGroupId: watchlist.activeGroupId })
  return true
}

