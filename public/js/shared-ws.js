/**
 * 喇叭好壞測試器 - 共用 WebSocket 連線管理
 */
class WSClient {
    constructor(role) {
        this.role = role;
        this.ws = null;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.listeners = new Set();
        this.onConnectionChange = null; // 連線狀態變更回呼 (isConnected, devicesInfo)
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;

        console.log(`正在連線至 WebSocket 伺服器: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket 連線成功！');
            // 註冊角色
            this.send({
                type: 'register',
                role: this.role,
                userAgent: navigator.userAgent
            });

            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }

            // 啟動心跳機制 (Ping-Pong) 防止連線逾時斷開
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                // 處理特殊的 status 訊息
                if (message.type === 'status') {
                    if (this.onConnectionChange) {
                        this.onConnectionChange(true, message);
                    }
                    return;
                }

                // 分發其他訊息給註冊的監聽器
                for (const listener of this.listeners) {
                    listener(message);
                }
            } catch (e) {
                console.error('處理 WebSocket 訊息出錯:', e);
            }
        };

        this.ws.onclose = (event) => {
            console.log(`WebSocket 連線關閉 (Code: ${event.code})，1.5 秒後嘗試重連...`);
            this.cleanup();
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
            // 斷線重連
            this.reconnectTimer = setTimeout(() => this.connect(), 1500);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket 發生錯誤:', error);
            this.ws.close();
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('警告：WebSocket 尚未連線，無法發送訊息：', data);
        }
    }

    addListener(callback) {
        this.listeners.add(callback);
    }

    removeListener(callback) {
        this.listeners.delete(callback);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.pingInterval = setInterval(() => {
            this.send({ type: 'ping' });
        }, 10000); // 每 10 秒 Ping 一次
    }

    stopHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    cleanup() {
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
