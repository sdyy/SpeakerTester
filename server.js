const express = require('express');
const http = require('http');
const https = require('https');
const ws = require('ws');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

// 1. 偵測本機區域網路 IP
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 排除 IPv6 與 Loopback (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const localIPs = getLocalIPs();
const primaryIP = localIPs[0] || 'localhost';

// 2. 使用非同步 IIFE 來確保憑證生成完成後再啟動伺服器
(async () => {
  try {
    console.log('正在為 HTTPS 生成自簽憑證...');
    const attrs = [{ name: 'commonName', value: primaryIP }];
    const pems = await selfsigned.generate(attrs, {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: true
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
          clientAuth: true
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: primaryIP },
            ...localIPs.map(ip => ({ type: 7, ip: ip }))
          ]
        }
      ]
    });
    console.log('HTTPS 憑證生成完成！');

    // 3. 設定 Express 應用程式
    const app = express();
    
    // 簡單的 HTTP 請求日誌
    app.use((req, res, next) => {
      console.log(`[HTTP] ${req.method} ${req.url} - IP: ${req.ip}`);
      next();
    });
    
    app.use(express.static(path.join(__dirname, 'public')));

    // 路由：API 獲取 IP 清單與連線狀態
    app.get('/api/info', (req, res) => {
      res.json({
        ips: localIPs,
        primaryIP: primaryIP,
        httpPort: HTTP_PORT,
        httpsPort: HTTPS_PORT
      });
    });

    // 4. 啟動 HTTP 與 HTTPS 伺服器
    const HTTP_PORT = 3000;
    const HTTPS_PORT = 3001;

    const httpServer = http.createServer(app);
    const httpsServer = https.createServer({
      key: pems.private,
      cert: pems.cert
    }, app);

    // 5. 建立 WebSocket 伺服器並整合至 HTTP 與 HTTPS
    const wssHttp = new ws.Server({ noServer: true });
    const wssHttps = new ws.Server({ noServer: true });

    // 管理所有連接的客戶端
    const clients = new Set();

    function handleConnection(socket, req) {
      // 分配一個隨機 ID
      socket.id = Math.random().toString(36).substring(2, 9);
      socket.role = null;
      socket.userAgent = req.headers['user-agent'] || 'Unknown';
      socket.ip = req.socket.remoteAddress;

      clients.add(socket);
      console.log(`新連接建立 [ID: ${socket.id}] 來自 ${socket.ip}`);

      // 發送目前的連線狀態
      broadcastStatus();

      socket.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          switch (data.type) {
            case 'register':
              socket.role = data.role;
              if (data.userAgent) socket.userAgent = data.userAgent;
              console.log(`客戶端 [ID: ${socket.id}] 註冊角色為: ${socket.role}`);
              broadcastStatus();
              break;

            case 'start-sweep':
            case 'stop-sweep':
            case 'sound-played':
            case 'mic-level':
            case 'fft-data':
            case 'test-result':
            case 'calibrate-volume':
            case 'volume-calibration-result':
              // 轉發這類訊息給其他配對的客戶端（例如：PC 傳給 Mobile，或 Mobile 傳給 PC）
              forwardToOthers(socket, data);
              break;

            case 'ping':
              socket.send(JSON.stringify({ type: 'pong' }));
              break;

            default:
              console.log(`收到未知類型的訊息: ${data.type}`);
          }
        } catch (e) {
          console.error('解析 WebSocket 訊息失敗:', e);
        }
      });

      socket.on('close', () => {
        clients.delete(socket);
        console.log(`連線關閉 [ID: ${socket.id}] 角色: ${socket.role}`);
        broadcastStatus();
      });

      socket.on('error', (err) => {
        console.error(`Socket [ID: ${socket.id}] 發生錯誤:`, err);
        clients.delete(socket);
        broadcastStatus();
      });
    }

    // 監聽 Upgrade 事件以支援多伺服器共享 WebSocket 邏輯
    httpServer.on('upgrade', (request, socket, head) => {
      wssHttp.handleUpgrade(request, socket, head, (ws) => {
        wssHttp.emit('connection', ws, request);
      });
    });

    httpsServer.on('upgrade', (request, socket, head) => {
      wssHttps.handleUpgrade(request, socket, head, (ws) => {
        wssHttps.emit('connection', ws, request);
      });
    });

    wssHttp.on('connection', handleConnection);
    wssHttps.on('connection', handleConnection);

    // 廣播連線狀態給所有人
    function broadcastStatus() {
      const devices = [];
      let pcConnected = false;
      let mobileConnected = false;

      for (const client of clients) {
        if (client.role) {
          devices.push({
            id: client.id,
            role: client.role,
            userAgent: client.userAgent,
            ip: client.ip
          });
          if (client.role === 'pc') pcConnected = true;
          if (client.role === 'mobile') mobileConnected = true;
        }
      }

      const payload = JSON.stringify({
        type: 'status',
        pcConnected,
        mobileConnected,
        devices
      });

      for (const client of clients) {
        if (client.readyState === ws.OPEN) {
          client.send(payload);
        }
      }
    }

    // 轉發訊息給與發送者角色不同的所有連線客戶端
    function forwardToOthers(sender, data) {
      const payload = JSON.stringify(data);
      for (const client of clients) {
        if (client !== sender && client.readyState === ws.OPEN) {
          // 如果發送者是 PC，轉發給所有 Mobile；反之亦然
          if ((sender.role === 'pc' && client.role === 'mobile') ||
              (sender.role === 'mobile' && client.role === 'pc')) {
            client.send(payload);
          }
        }
      }
    }

    // 6. 啟動聆聽
    httpServer.listen(HTTP_PORT, () => {
      console.log(`\n==================================================`);
      console.log(`🔊 喇叭好壞測試器伺服器已啟動！`);
      console.log(`--------------------------------------------------`);
      console.log(`💻 電腦端控制面板 (HTTP):`);
      console.log(`   👉 http://localhost:${HTTP_PORT}/?role=pc`);
      console.log(`   👉 http://${primaryIP}:${HTTP_PORT}/?role=pc`);
      console.log(`--------------------------------------------------`);
      console.log(`📱 手機端接收器 (HTTPS - 啟用麥克風所需):`);
      console.log(`   👉 https://${primaryIP}:${HTTPS_PORT}/?role=mobile`);
      if (localIPs.length > 1) {
        console.log(`   其他可用 IP:`);
        localIPs.slice(1).forEach(ip => {
          console.log(`   👉 https://${ip}:${HTTPS_PORT}/?role=mobile`);
        });
      }
      console.log(`\n💡 提示：手機與電腦必須連接至同一個 Wi-Fi 區域網路！`);
      console.log(`   手機開啟 HTTPS 連結時，若提示「您的連線不是私密連線」，`);
      console.log(`   請點擊「進階」並選擇「繼續前往 (不安全)」即可正常運作。`);
      console.log(`==================================================\n`);
    });

    httpsServer.listen(HTTPS_PORT, () => {
      // HTTPS 啟動完成
    });

  } catch (err) {
    console.error('伺服器初始化失敗:', err);
  }
})();
