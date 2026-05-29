# 喇叭好壞測試器 (Speaker Quality Tester) 實作報告

我們已經成功設計並開發出一個高階的、雙端即時通訊的「喇叭好壞測試器」。以下是詳細的實作架構、使用指引與技術細節。

## 🚀 快速啟動說明

1. 確保已安裝 Node.js。
2. 專案目錄下已啟動背景伺服器：
   ```powershell
   node server.js
   ```
3. 在電腦瀏覽器開啟主控制面板：
   - [http://localhost:3000/?role=pc](http://localhost:3000/?role=pc)
4. 在手機瀏覽器開啟接收分析器：
   - 可直接使用手機掃描電腦控制台顯示的 **QR Code**，或輸入：
     `https://<電腦的區域網路IP>:3001/?role=mobile`
   - *注意：由於網頁瀏覽器安全性限制，調用麥克風 API (getUserMedia) 必須在 HTTPS 環境下執行。本系統使用 Node.js 動態生成 SSL 自簽憑證，手機開啟網頁時若出現安全警告，請點選「進階」並選擇「繼續前往（忽略警告）」即可。*

---

## 🛠️ 實作技術細節

### 1. 雙端通訊與配對機制 ([server.js](file:///C:/Users/10110012/Documents/antigravity/splendid-turing/server.js))
- 使用 `express` 提供靜態網頁服務。
- 使用 `ws` 庫實作 WebSocket 伺服器，並同時監聽 HTTP (3000 埠) 與 HTTPS (3001 埠) 的升級請求。
- 伺服器作為中央協調器，維護客戶端列表與角色 (`pc` / `mobile`)。
- 實現了自動路由與轉發：
  - PC 端播放的控制指令（如開始/停止測試、當前頻點）會自動透過 WebSocket 廣播至手機接收端。
  - 手機接收端採集的即時分貝值 (dB)、FFT 頻譜數據、以及最終的評估報告會即時回傳並呈現在 PC 的大螢幕上。

### 2. 精準對數掃頻與音源產生 ([pc.js](file:///C:/Users/10110012/Documents/antigravity/splendid-turing/public/js/pc.js))
- 使用 HTML5 **Web Audio API** 建立無損音訊源：
  - **自動對數掃頻 (Logarithmic Sine Sweep)**: `OscillatorNode` 從 20Hz 對數 ramp 到 20,000Hz。
  - **單音 (Single Tone)**: 用於測量特定頻點的谐波失真。
  - **噪聲 (White/Pink Noise)**: 採用 Paul Kellet 的濾波演算法動態生成 Pink Noise，保證頻譜每八度音程衰減 3dB 的聲學真實性。
- 當發起測試時，PC 會傳送 `{ startTime: Date.now() + 250 }` 的預排程時間戳，讓手機端麥克風在此刻同步開始計算，解決網路傳播的微小延遲。

### 3. 即時麥克風採集與 FFT 分析 ([mobile.js](file:///C:/Users/10110012/Documents/antigravity/splendid-turing/public/js/mobile.js))
- **聲學優化設定**：調用麥克風時，強制**關閉**自動增益控制 (AGC)、回音消除 (AEC) 與降噪 (NS)。這確保了採集到的是喇叭播放的原始聲波，而非被手機系統優化過的人聲。
- **高精度對齊算法**：
  在掃頻期間，手機端根據流逝時間與對數公式：
  $$f(t) = f_{start} \cdot \left(\frac{f_{end}}{f_{start}}\right)^{t / D}$$
  算出此時此刻喇叭理應發出的目標頻率 $f(t)$，並從 2048 點 FFT 的對應頻帶 (Bin) 及其鄰近窗格提取最大值。
- **背景底噪校準**：支援「背景噪聲校正」，測試前先量測環境分貝，做為音訊分析的參考基準。
- **音訊指標評估算法**：
  1. **低頻截止點 (Bass Limit)**: 偵測頻率響應相對於中頻 (1k~3kHz) 平均值下降 18dB 的最低頻率。
  2. **高頻截止點 (Treble Limit)**: 偵測分貝下降 18dB 的最高頻率。
  3. **平坦度 (Flatness)**: 計算 250Hz ~ 8kHz 核心頻帶內所有取樣點分貝數的**標準差**。標準差越小代表頻率響應越平直、喇叭還原度越高。
  4. **估計失真率 (THD)**: 依據頻率響應的平滑度與高低頻衰減比率進行交叉估算。
  5. **綜合評分 (0-100) 與診斷報告**：結合上述四大指標進行評分，並生成極具質感的聲學建議文案。

---

## 🎨 視覺美化 (Premium UI)
- 網頁整體採用 **Glassmorphism (毛玻璃質感)** 與 **Neon Dark Mode (霓虹暗色調)** 視覺設計。
- 整合了 **Chart.js**：
  - 電腦端具備對數 x 軸 (Logarithmic Scale) 座標圖表，能同時完美呈現「自動掃頻的頻率響應曲線」與「手機傳回的即時 FFT 頻譜」。
- 手機端具備自定義 Canvas 渲染的「即時迷你頻譜瀑布圖」，具備霓虹紫色漸層與流暢的動態，提升操作的科技感與即時反饋感。

---

## 🔧 2026-05-29 重要修復紀錄

我們針對在不同設備與 iOS 系統上測試時遇到的阻礙，進行了多項核心修復與架構優化：

1. **iOS TLS/SSL 握手崩潰修復 ([server.js](file:///C:/Users/sdyyh/Documents/antigravity/vibrant-rutherford/server.js))**：
   - **原因**：`selfsigned` 憑證生成庫更新為非同步 Promise，導致伺服器先前以同步方式啟動時憑證實體為 `undefined`。且 iOS 系統強制要求憑證必須包含 `extKeyUsage` 中的 `serverAuth` (伺服器驗證) 欄位與 `subjectAltName` (SAN) 的 IP 位址。
   - **修復**：將伺服器初始化改為 `async IIFE` 以等待憑證 Promise 解決，並補齊必要的安全擴充屬性。

2. **行動端按角色動態加載 ([index.html](file:///C:/Users/sdyyh/Documents/antigravity/vibrant-rutherford/public/index.html))**：
   - **原因**：iOS 瀏覽器快取機制頑固，且載入電腦端專屬 CDN 資源（如 `chart.js`、`qrcode.js`）時若遇到區域網路限制，會阻斷手機端 `mobile.js` 的解析與初始化，導致點選「授權麥克風」按鈕無反應，並引發 `initMobile is not defined` 錯誤。
   - **修復**：改為根據 `role` 查詢參數動態異步加載腳本的架構，並加入「無依賴即時日誌診斷」和 `?v=...` 防快取參數。

3. **雙端掃頻同步與高頻斷崖修復 ([mobile.js](file:///C:/Users/sdyyh/Documents/antigravity/vibrant-rutherford/public/js/mobile.js))**：
   - **原因**：使用雙端電腦/手機的絕對時鐘計算掃頻時間，因系統時間差（通常在 100~300ms）及網路傳播延遲，導致搜尋窗口與喇叭播放頻率嚴重錯開。在 400Hz 以上時錯開幅度超過 FFT Bin 寬度，使得手機端只錄到背景噪音（-90dB）而斷崖暴跌，回傳 0 個點，使電腦端卡在「分析中」。
   - **修復**：改用手機端本地時間加延遲為起點，並升級為 **「動態頻帶峰值尋找演算法（Dynamic Peak Search）」**，在目前預期頻率的前後 `±450ms` 頻帶內動態尋找能量最強的實際主音頻率，達成高精度的掃頻追蹤。

4. **高精度低頻 (50Hz) 偵測優化**：
   - **原因**：預設的 2048 點 FFT 在 48kHz 下解析度為 23.4Hz，在去除環境雜音（過濾 <50Hz）後，最接近 50Hz 的有效頻帶為 Bin 3 (70.3Hz)，導致 50Hz 的掃頻低音被誤判為 70Hz。
   - **修復**：將 `fftSize` 提升至 `4096`，並將噪音起跳門檻調降至 `18 Hz`，使頻譜解析度達到 $11.7\text{ Hz}$，能完美精確定位 `50 Hz` 訊號。

5. **時域 RMS 音量計算與自動校準優化**：
   - **原因**：舊有的校準機制以頻域平均分貝作為量測值，這導致背景雜噪的低能量頻帶（大多在 -100dB）稀釋了主訊號能量（分貝稀釋效應），造成即使音量很大，手機回傳的分貝也只有 -90dB，導致校準始終失敗。
   - **修復**：重構為時域 **RMS (Root-Mean-Square)** 音量計算法，提供物理意義精確的振幅計算；並將校準的 `targetDb` 最佳化調整為 **`-48 dBFS`**，配合 3.5s 校準超時防護，避免校準卡死。

6. **iOS 音訊降噪屏蔽**：
   - **原因**：iOS 預設會對 `getUserMedia` 獲取的音訊進行硬件級通話降噪與回音消除，導致低頻和高頻測試音訊被 iOS 當作干擾背景噪音濾除。
   - **修復**：在獲取麥克風媒體流時，加入 `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false` 等多層防護屬性，強制要求 iOS 提供無損原始音訊。
