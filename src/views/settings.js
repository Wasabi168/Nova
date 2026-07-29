import { getSettings, saveSettings } from '../data/market.js'

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
}
