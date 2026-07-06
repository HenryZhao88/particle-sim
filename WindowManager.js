// WindowManager.js
// Syncs this window's screen-space position (and blob appearance) with every
// other open window of the app via a BroadcastChannel.

const PEER_TIMEOUT_MS = 1200; // drop peers we haven't heard from in this long

/**
 * This window's content area in screen coordinates. screenX/screenY point at
 * the OS window's outer corner, so push top down past the browser chrome.
 */
export function contentRect() {
  return {
    left: window.screenX,
    top: window.screenY + (window.outerHeight - window.innerHeight),
    width: window.innerWidth,
    height: window.innerHeight
  };
}

class WindowManager {
  constructor(channelName = 'blob_sync') {
    this.id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.channel = new BroadcastChannel(channelName);
    this.peers = new Map(); // Map<peerId, { rect, blob, lastSeen }>
    this.meta = null;       // local blob appearance, set via setLocalBlob()

    this.channel.onmessage = (ev) => this._onMessage(ev.data);

    // Tell peers we're gone so they don't wait for the timeout.
    window.addEventListener('pagehide', () => {
      this.channel.postMessage({ type: 'bye', id: this.id });
    });

    this._startBroadcast();
  }

  /** Register the local blob's appearance so peers can render it. */
  setLocalBlob(blob) {
    this.meta = {
      color: blob.color,
      radius: blob.radius,
      strength: blob.strength
    };
    this._broadcast();
  }

  _startBroadcast(interval = 50) {
    this._broadcast();
    this._intervalHandle = setInterval(() => this._broadcast(), interval);
  }

  _broadcast() {
    this.channel.postMessage({
      type: 'hello',
      id: this.id,
      rect: contentRect(),
      blob: this.meta
    });
  }

  _onMessage(data) {
    if (!data || data.id === this.id) return;
    if (data.type === 'bye') {
      this.peers.delete(data.id);
      return;
    }
    // lastSeen must be OUR clock — sender timestamps aren't comparable
    // across windows.
    this.peers.set(data.id, {
      rect: data.rect,
      blob: data.blob,
      lastSeen: Date.now()
    });
  }

  /** Returns live peers: [{ id, rect, blob }, ...], pruning stale ones. */
  getPeers() {
    const now = Date.now();
    const out = [];
    for (const [id, info] of this.peers) {
      if (now - info.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
      } else {
        out.push({ id, rect: info.rect, blob: info.blob });
      }
    }
    return out;
  }

  destroy() {
    clearInterval(this._intervalHandle);
    this.channel.close();
  }
}

export default new WindowManager();
