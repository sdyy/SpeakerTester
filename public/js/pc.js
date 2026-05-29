/**
 * 喇叭好壞測試器 - 電腦控制端 (PC) 邏輯
 */

let wsClient = null;
let audioCtx = null;
let masterGain = null;
let activeSource = null;
let isPlaying = false;
let testTimeout = null;
let testProgressInterval = null;
let calibrationTimeoutGuard = null;

// 圖表實例
let responseChart = null;

function initPC() {
    console.log('初始化電腦控制端...');
    
    // 1. 初始化圖表
    initChart();

    // 2. 獲取本機資訊並生成 QR Code
    fetch('/api/info')
        .then(res => res.json())
        .then(data => {
            const mobileUrl = `https://${data.primaryIP}:${data.httpsPort}/?role=mobile`;
            
            // 顯示文字網址
            const linkElem = document.getElementById('mobile-url-link');
            linkElem.href = mobileUrl;
            linkElem.innerText = mobileUrl;

            // 生成 QR Code
            document.getElementById('qrcode').innerHTML = ''; // 清空
            new QRCode(document.getElementById('qrcode'), {
                text: mobileUrl,
                width: 112,
                height: 112,
                colorDark: "#090e1a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        })
        .catch(err => {
            console.error('獲取伺服器資訊失敗，改為本機預設:', err);
            const fallbackUrl = `https://${window.location.hostname}:3001/?role=mobile`;
            document.getElementById('mobile-url-link').innerText = fallbackUrl;
            document.getElementById('mobile-url-link').href = fallbackUrl;
        });

    // 3. 連線 WebSocket
    wsClient = new WSClient('pc');
    
    wsClient.onConnectionChange = (isConnected, statusData) => {
        const dot = document.getElementById('pc-status-dot');
        const text = document.getElementById('pc-status-text');
        const ctrlCard = document.getElementById('control-card');
        const pairingCard = document.getElementById('pairing-card');

        if (isConnected && statusData) {
            if (statusData.mobileConnected) {
                dot.className = 'pulse-dot green';
                text.innerText = '手機已連線 (配對成功)';
                ctrlCard.classList.remove('disabled');
                pairingCard.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            } else {
                dot.className = 'pulse-dot red';
                text.innerText = '手機未連線';
                ctrlCard.classList.add('disabled');
                pairingCard.style.borderColor = 'var(--card-border)';
                stopAllPlayback();
            }
        } else {
            dot.className = 'pulse-dot red';
            text.innerText = '與伺服器斷開';
            ctrlCard.classList.add('disabled');
        }
    };

    // 監聽來自手機的訊息
    wsClient.addListener((msg) => {
        switch (msg.type) {
            case 'mic-level':
                // 更新即時資料綠色小燈與數值
                document.getElementById('live-data-dot').className = 'pulse-dot green';
                document.getElementById('live-data-text').innerText = `手機即時輸入: ${msg.db.toFixed(1)} dB`;
                break;

            case 'fft-data':
                // msg.fft 包含 [{freq: 100, db: -50}, ...] 的即時頻譜資料
                updateLiveFFTChart(msg.fft);
                break;

            case 'test-result':
                // 收到測試報告
                renderTestReport(msg.result);
                break;

            case 'volume-calibration-result':
                // 收到音量校準結果
                handleVolumeCalibrationResult(msg);
                break;
        }
    });

    wsClient.connect();
}

// 初始化 Chart.js 雙線圖 (頻率響應 + 即時 FFT)
function initChart() {
    const ctx = document.getElementById('responseChart').getContext('2d');
    
    // 生成預設的 x 軸標籤 (對數間距 20 ~ 20000Hz)
    const labels = [];
    for (let f = 20; f <= 20000; f = Math.round(f * 1.08)) {
        labels.push(f);
    }
    // 確保最後包含 20kHz
    if (labels[labels.length - 1] < 20000) labels.push(20000);

    responseChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: '測試頻率響應曲線 (掃頻結果)',
                    data: [], // 格式: {x: freq, y: db}
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    yAxisID: 'y'
                },
                {
                    label: '手機即時接收頻譜 (FFT)',
                    data: [], // 格式: {x: freq, y: db}
                    borderColor: 'rgba(6, 182, 212, 0.5)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    type: 'logarithmic',
                    title: {
                        display: true,
                        text: '頻率 (Hz)',
                        color: '#9ca3af',
                        font: { family: 'Outfit', size: 12 }
                    },
                    min: 20,
                    max: 20000,
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Outfit' },
                        callback: function(value) {
                            // 僅顯示主要頻率標籤
                            const targets = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
                            return targets.includes(value) ? `${value}Hz` : null;
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '相對振幅 (dB)',
                        color: '#9ca3af',
                        font: { family: 'Outfit', size: 12 }
                    },
                    min: -90,
                    max: 0,
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Outfit' }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#f3f4f6',
                        font: { family: 'Noto Sans TC', size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw.y.toFixed(1)} dB at ${context.raw.x} Hz`;
                        }
                    }
                }
            }
        }
    });
}

// 建立 Web Audio API 脈絡
function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.8; // 預設 80% 音量
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 停止所有聲音播放
function stopAllPlayback() {
    isPlaying = false;
    
    // 停止音源
    if (activeSource) {
        try {
            activeSource.stop();
        } catch (e) {}
        activeSource = null;
    }

    // 清理定時器
    if (testTimeout) {
        clearTimeout(testTimeout);
        testTimeout = null;
    }
    if (testProgressInterval) {
        clearInterval(testProgressInterval);
        testProgressInterval = null;
    }

    // 重設按鈕文字與進度條
    document.getElementById('btn-start-sweep').innerText = '🔊 開始掃頻測試';
    document.getElementById('btn-start-sweep').classList.remove('playing');
    document.getElementById('btn-start-single').innerText = '🔊 播放單音';
    document.getElementById('btn-start-single').classList.remove('playing');
    document.getElementById('btn-start-noise').innerText = '🔊 播放噪聲';
    document.getElementById('btn-start-noise').classList.remove('playing');
    document.getElementById('test-progress-container').classList.add('hidden');
}

// 啟動音量自動校準
function triggerVolumeCalibration() {
    if (isPlaying) {
        stopAllPlayback();
    }
    
    const btn = document.getElementById('btn-calibrate-vol');
    const statusBadge = document.getElementById('vol-cal-status');
    
    if (btn) btn.innerText = '⚡ 正在播放基準音...';
    if (statusBadge) {
        statusBadge.className = 'cal-status warning';
        statusBadge.innerText = '校準中';
    }

    ensureAudioContext();
    isPlaying = true;

    // 強制以 50% 基準音量播放，以防止初始過大或過小
    const baseVol = 0.5;
    masterGain.gain.setValueAtTime(baseVol, audioCtx.currentTime);

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime); // 1kHz 基準音
    osc.connect(masterGain);
    
    activeSource = osc;

    // 通知手機端開始採樣
    if (wsClient) {
        wsClient.send({
            type: 'calibrate-volume',
            duration: 1.5
        });
    }

    // 延遲 150ms 播放以確保手機端準備就緒
    setTimeout(() => {
        if (!isPlaying) return;
        osc.start();
        console.log('基準校準音播放開始，音量 50%');
    }, 150);

    if (calibrationTimeoutGuard) {
        clearTimeout(calibrationTimeoutGuard);
    }
    // 3.5 秒超時保護機制，防止卡死在「校準中」
    calibrationTimeoutGuard = setTimeout(() => {
        const statusBadge = document.getElementById('vol-cal-status');
        const descText = document.querySelector('#vol-calibration-section .cal-desc');
        if (statusBadge && statusBadge.innerText === '校準中') {
            statusBadge.className = 'cal-status warning';
            statusBadge.innerText = '校準失敗';
            if (descText) {
                descText.innerText = '⚠️ 校準逾時：未收到手機端反饋。請確保手機端已連線且已點選「授權麥克風」。';
            }
        }
    }, 3500);

    // 1.5 秒後自動停止播放
    testTimeout = setTimeout(() => {
        stopAllPlayback();
        if (btn) btn.innerText = '⚡ 開始自動調整音量';
    }, 1650);
}

// 處理音量校準結果，自動計算最佳音量並更新 Slider
function handleVolumeCalibrationResult(msg) {
    if (calibrationTimeoutGuard) {
        clearTimeout(calibrationTimeoutGuard);
        calibrationTimeoutGuard = null;
    }

    const statusBadge = document.getElementById('vol-cal-status');
    const descText = document.querySelector('#vol-calibration-section .cal-desc');
    const volSlider = document.getElementById('single-vol');
    
    // 檢查手機端是否尚未取得麥克風授權
    if (msg.error === 'mic-not-ready') {
        if (statusBadge) {
            statusBadge.className = 'cal-status warning';
            statusBadge.innerText = '未授權';
        }
        if (descText) {
            descText.innerText = '⚠️ 校準失敗：手機端尚未啟用麥克風。請先在手機點選「授權麥克風」。';
        }
        return;
    }

    const avgDb = msg.db !== undefined ? msg.db : -100;
    
    // 計算最佳音量
    const targetDb = -48; // 目標接收音量為 -48dB，確保 SNR 充足且防警報過度敏感
    const deltaDb = targetDb - avgDb;
    const baseVol = 0.5; // 播放基準音量為 50%
    
    let targetVol = baseVol * Math.pow(10, deltaDb / 20);
    let volPercent = Math.round(targetVol * 100);
    
    let statusClass = 'success';
    let statusText = '校準完成';
    let descMsg = '';
    
    if (volPercent > 100) {
        volPercent = 100;
        statusClass = 'warning';
        statusText = '建議靠近';
        descMsg = '⚠️ 已自動將測試音量調至最大 (100%)。若聲音依然偏小，請將手機更靠近喇叭，或調高電腦系統主音量。';
    } else if (volPercent < 10) {
        volPercent = 10;
        statusClass = 'success';
        statusText = '自動降音';
        descMsg = `🔊 偵測到聲音過大。已自動將測試音量調降至 ${volPercent}%，以防止手機端麥克風過載爆音。`;
    } else {
        statusClass = 'success';
        statusText = `已設定 ${volPercent}%`;
        descMsg = `✅ 音量校準完成！系統已根據手機端反饋，自動將測試音量調整至最佳的 ${volPercent}%。`;
    }
    
    // 更新拉霸與 UI
    if (volSlider) {
        volSlider.value = volPercent;
        const valDisp = document.getElementById('val-single-vol');
        if (valDisp) valDisp.innerText = volPercent;
    }
    
    // 更新 masterGain 增益
    if (masterGain) {
        masterGain.gain.setValueAtTime(volPercent / 100, audioCtx.currentTime);
    }
    
    if (statusBadge) {
        statusBadge.className = `cal-status ${statusClass}`;
        statusBadge.innerText = statusText;
    }
    if (descText) {
        descText.innerText = descMsg;
    }
}

// -------------------------------------------------------------
// 1. 掃頻測試 (Sine Sweep)
// -------------------------------------------------------------
function startSweep() {
    if (isPlaying) {
        stopAllPlayback();
        wsClient.send({ type: 'stop-sweep' });
        return;
    }

    ensureAudioContext();
    isPlaying = true;

    const duration = parseFloat(document.getElementById('sweep-duration').value);
    const startFreq = 20;
    const endFreq = 20000;

    // 清空圖表的歷史掃頻資料，但保留 FFT 資料集
    responseChart.data.datasets[0].data = [];
    responseChart.update();

    // 更新 UI 為播放狀態
    const btn = document.getElementById('btn-start-sweep');
    btn.innerText = '⏹️ 停止測試';
    btn.classList.add('playing');

    const progressContainer = document.getElementById('test-progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressLabel = document.getElementById('progress-label');

    progressContainer.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressPercent.innerText = '0%';
    progressLabel.innerText = '喇叭正在發聲掃頻中...';

    // 建立音源 (對數掃頻)
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    
    // 設定起點與終點頻率
    osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);

    // 串接與啟動
    osc.connect(masterGain);
    activeSource = osc;

    // 與手機端同步！
    // 預留 200ms 的延遲讓手機接收指令並建立準備，確保時間對齊
    const syncDelayMs = 250;
    const startTimestamp = Date.now() + syncDelayMs;

    setTimeout(() => {
        if (!isPlaying) return;
        osc.start();
        console.log(`發聲掃頻開始: ${startFreq}Hz -> ${endFreq}Hz, 時間長度: ${duration}s`);
    }, syncDelayMs);

    // 發送 WebSocket 同步指令給手機
    wsClient.send({
        type: 'start-sweep',
        duration: duration,
        startFreq: startFreq,
        endFreq: endFreq,
        startTime: startTimestamp
    });

    // 定期更新發聲進度條
    const startTime = Date.now() + syncDelayMs;
    const updateFreqMs = 50;
    testProgressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed < 0) return; // 還在同步延遲內
        
        let percent = Math.min((elapsed / duration) * 100, 100);
        progressFill.style.width = `${percent}%`;
        progressPercent.innerText = `${Math.round(percent)}%`;

        if (elapsed >= duration) {
            clearInterval(testProgressInterval);
            progressLabel.innerText = '掃頻完成，正在等待手機端運算數據...';
        } else {
            // 計算當前的預期播放頻率並更新 UI
            const currentFreq = Math.round(startFreq * Math.pow(endFreq / startFreq, elapsed / duration));
            progressLabel.innerText = `播放中: ${currentFreq} Hz (${elapsed.toFixed(1)}s / ${duration}s)`;

            // 通知手機端目前播放的頻率 (非必要，但有助於除錯與即時追蹤)
            wsClient.send({
                type: 'sound-played',
                frequency: currentFreq
            });
        }
    }, updateFreqMs);

    // 播放截止
    osc.onended = () => {
        console.log('聲音播放結束');
        stopAllPlayback();
    };

    // 音訊安全自動停止安全機制 (時長 + 1秒)
    testTimeout = setTimeout(() => {
        stopAllPlayback();
    }, (duration + 1) * 1000);
}

// -------------------------------------------------------------
// 2. 單音播放 (Single Tone)
// -------------------------------------------------------------
function toggleSingleTone() {
    if (isPlaying) {
        stopAllPlayback();
        return;
    }

    ensureAudioContext();
    isPlaying = true;

    const freq = parseFloat(document.getElementById('single-freq').value);
    const vol = parseFloat(document.getElementById('single-vol').value) / 100;

    masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.connect(masterGain);
    
    activeSource = osc;
    osc.start();

    const btn = document.getElementById('btn-start-single');
    btn.innerText = '⏹️ 停止播放';
    btn.classList.add('playing');

    // 通知手機端
    wsClient.send({
        type: 'sound-played',
        frequency: freq
    });
}

// 即時更新播放中的單音頻率
function updateActiveSingleToneFrequency(freq) {
    if (isPlaying && activeSource && activeSource.frequency) {
        activeSource.frequency.setValueAtTime(freq, audioCtx.currentTime);
        // 同步發送頻率更新訊息給手機端
        if (wsClient) {
            wsClient.send({
                type: 'sound-played',
                frequency: freq
            });
        }
        console.log(`即時更新單音頻率至: ${freq} Hz`);
    }
}

// 即時更新播放中的音量
function updateActiveSingleToneVolume(vol) {
    if (isPlaying && masterGain) {
        masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
        console.log(`即時更新播放音量至: ${Math.round(vol * 100)}%`);
    }
}

// -------------------------------------------------------------
// 3. 噪聲播放 (Pink/White Noise)
// -------------------------------------------------------------
function toggleNoise() {
    if (isPlaying) {
        stopAllPlayback();
        return;
    }

    ensureAudioContext();
    isPlaying = true;

    const noiseType = document.querySelector('input[name="noise-type"]:checked').value;
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    if (noiseType === 'white') {
        // 白噪聲: 完全隨機
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
    } else {
        // 粉紅噪聲: 每八度音程衰減 3dB (使用 Paul Kellet 的精確濾波演算法)
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            output[i] *= 0.11; // 修正音量增益
            b6 = white * 0.115926;
        }
    }

    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;
    noiseNode.connect(masterGain);
    
    activeSource = noiseNode;
    noiseNode.start();

    const btn = document.getElementById('btn-start-noise');
    btn.innerText = '⏹️ 停止播放';
    btn.classList.add('playing');

    // 通知手機端進入噪聲測試 (-1 代表噪聲)
    wsClient.send({
        type: 'sound-played',
        frequency: -1
    });
}

// -------------------------------------------------------------
// 圖表與測試報告繪製
// -------------------------------------------------------------

// 即時繪製手機端傳來的 FFT 資料
function updateLiveFFTChart(fftData) {
    if (!responseChart) return;
    
    // 轉換資料格式為 Chart.js 的點座標 {x, y}
    const points = fftData.map(item => ({ x: item.freq, y: item.db }));
    
    responseChart.data.datasets[1].data = points;
    responseChart.update('none'); // 用 'none' 停用動畫，提高即時繪製效能
}

// 手機端掃頻完成後會將「頻率響應曲線數據」上傳，此處進行呈現
function renderTestReport(result) {
    console.log('接收到測試分析數據:', result);

    // 1. 繪製頻率響應曲線
    if (result.curve && responseChart) {
        const points = result.curve.map(item => ({ x: item.freq, y: item.db }));
        responseChart.data.datasets[0].data = points;
        responseChart.update();
    }

    // 2. 移除 placeholder，顯示報告內容
    document.getElementById('report-placeholder').classList.add('hidden');
    document.getElementById('report-content').classList.remove('hidden');

    // 3. 填入數據
    document.getElementById('report-score').innerText = result.score;
    
    const badge = document.getElementById('report-badge');
    badge.innerText = result.rating;
    
    // 依分數套用不同顏色樣式
    if (result.score >= 85) {
        badge.style.color = '#34d399'; // Green
    } else if (result.score >= 70) {
        badge.style.color = '#60a5fa'; // Blue
    } else if (result.score >= 50) {
        badge.style.color = '#fbbf24'; // Yellow
    } else {
        badge.style.color = '#f87171'; // Red
    }

    // 填寫指標數值與狀態
    setMetricValue('metric-low-limit', `${result.lowLimit} Hz`, result.lowLimitStatus);
    setMetricValue('metric-high-limit', `${result.highLimit} Hz`, result.highLimitStatus);
    setMetricValue('metric-flatness', `±${result.flatness.toFixed(1)} dB`, result.flatnessStatus);
    setMetricValue('metric-thd', `${result.thd.toFixed(2)} %`, result.thdStatus);

    // 診斷說明文案
    document.getElementById('report-diagnose').innerHTML = `
        <strong>💡 聲學工程師診斷建議：</strong><br>
        ${result.suggestion}
    `;

    // 完成測試進度條
    const progressContainer = document.getElementById('test-progress-container');
    progressContainer.classList.add('hidden');
}

function setMetricValue(id, valueText, status) {
    const valElem = document.getElementById(id);
    const statusElem = document.getElementById(`${id}-status`);

    valElem.innerText = valueText;
    statusElem.innerText = getChineseStatus(status);
    
    // 設置顏色等級
    statusElem.className = 'metric-status';
    if (status === 'good' || status === 'excellent') {
        statusElem.classList.add('good');
    } else if (status === 'fair' || status === 'normal') {
        statusElem.classList.add('fair');
    } else {
        statusElem.classList.add('poor');
    }
}

function getChineseStatus(status) {
    const mapping = {
        'excellent': '優異 ✨',
        'good': '良好 👍',
        'fair': '普通 😐',
        'normal': '正常 👌',
        'poor': '低劣 ⚠️'
    };
    return mapping[status] || status;
}
