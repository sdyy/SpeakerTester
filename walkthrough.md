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
