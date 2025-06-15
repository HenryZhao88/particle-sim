// WindowManager.js

class WindowManager {
    constructor(channelName = 'blob_sync') {
      this.id = `${Date.now()}_${Math.random()}`;      // unique ID for this window
      this.channel = new BroadcastChannel(channelName);
      this.peers = new Map();                         // Map<peerId, { x, y, lastSeen }>
  
      // Start broadcasting our window's position
      this._startBroadcast();
  
      // Listen for incoming messages from other windows
      this.channel.onmessage = (ev) => this._onMessage(ev.data);
    }
  
    _startBroadcast(interval = 50) {
      this._broadcast();
      this._intervalHandle = setInterval(() => this._broadcast(), interval);
    }
  
    _broadcast() {
      const msg = {
        id: this.id,
        x: window.screenX,
        y: window.screenY,
        timestamp: performance.now()
      };
      this.channel.postMessage(msg);
    }
  
    _onMessage(data) {
      if (data.id === this.id) return;  // ignore our own messages
      this.peers.set(data.id, {
        x: data.x,
        y: data.y,
        lastSeen: data.timestamp
      });
    }
  
    /**
     * Returns an array of other windows' positions:
     * [ { id, x, y }, ... ]
     */
    getPeers() {
      // Optional: prune entries older than some threshold here
      return Array.from(this.peers.entries()).map(([id, info]) => ({
        id,
        x: info.x,
        y: info.y
      }));
    }
  
    // Clean up when you no longer need to sync
    destroy() {
      clearInterval(this._intervalHandle);
      this.channel.close();
    }
  }
  
  export default new WindowManager();
  