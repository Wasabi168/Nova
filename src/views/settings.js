import { getSettings, saveSettings } from '../data/market.js'
import { createBackupPayload, importBackupPayload } from '../data/backup.js'

export async function renderSettings(root) {
  const settings = getSettings()

  root.innerHTML = `
    <header class="page-header">
      <div>
        <p class="eyebrow">設定</p>
        <h1>顯示與資料來源</h1>
      </div>
    </header>
    <section class="card-block">
      <h2>行情說明</h2>
      <p class="muted">台股報價優先使用證交所／櫃買公開資訊（接近即時）；美股與歷史 K 線使用 Yahoo Finance（約延遲 15 分鐘）。漲跌顏色採台股慣例：上漲紅、下跌綠。</p>
    </section>
    <section class="card-block">
      <h2>CORS 代理（正式環境）</h2>
      <p class="muted">本機開發會自動走 Vite 代理。若部署到靜態空間後美股無法載入，可填入自架 Yahoo 代理前綴（結尾不要斜線）。台股在正式環境會嘗試公開 CORS 代理。</p>
      <label class="field">
        <span>Yahoo 代理 Base URL</span>
        <input id="proxy" type="url" placeholder="https://your-worker.example.com" value="${settings.proxyBase || ''}" />
      </label>
      <button class="primary-btn" data-action="save">儲存</button>
      <p class="toast" id="toast" hidden>已儲存</p>
    </section>

    <section class="card-block">
      <h2>自選與設定備份</h2>
      <p class="muted">匯出後可在其他電腦匯入，恢復相同的自選群組/股票與頁面設定。</p>
      <p class="muted">匯入會覆蓋目前的自選群組/股票與設定；搜尋/瀏覽紀錄不會被還原。</p>
      <button class="primary-btn" data-action="export-backup" type="button">匯出設定</button>
      <button class="primary-btn" data-action="import-backup" type="button">匯入設定</button>
      <input id="backup-file" type="file" accept="application/json" hidden />
      <p class="toast" id="backup-toast" hidden></p>
    </section>

    <section class="card-block">
      <h2>關於</h2>
      <p class="muted">Nova — 靜態網頁 K 線看盤。自選支援多群組；操作風格參考籌碼K。</p>
    </section>
  `

  root.querySelector('[data-action="save"]')?.addEventListener('click', () => {
    const proxyBase = root.querySelector('#proxy').value.trim()
    saveSettings({ proxyBase })
    const toast = root.querySelector('#toast')
    toast.hidden = false
    setTimeout(() => {
      toast.hidden = true
    }, 1500)
  })

  const exportBtn = root.querySelector('[data-action="export-backup"]')
  const importBtn = root.querySelector('[data-action="import-backup"]')
  const fileInput = root.querySelector('#backup-file')
  const backupToast = root.querySelector('#backup-toast')

  function showBackupToast(message, { isError = false } = {}) {
    backupToast.textContent = message
    backupToast.hidden = false
    backupToast.style.color = isError ? '#ffa198' : '#3fb950'
    setTimeout(() => {
      backupToast.hidden = true
    }, 2500)
  }

  exportBtn?.addEventListener('click', () => {
    try {
      const payload = createBackupPayload()
      const text = JSON.stringify(payload, null, 2)
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `nova-backup-${date}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      showBackupToast(`匯出失敗：${err?.message || String(err)}`, { isError: true })
    }
  })

  importBtn?.addEventListener('click', () => {
    fileInput?.click()
  })

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      importBackupPayload(payload)
      showBackupToast('匯入成功，正在重新整理頁面…')
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      showBackupToast(`匯入失敗：${err?.message || String(err)}`, { isError: true })
    } finally {
      fileInput.value = ''
    }
  })
}
