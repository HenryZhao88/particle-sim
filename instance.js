// instance.js
// The local window's identity in the shared space: its palette color and
// how strongly its sphere attracts the ambient swarm.

export default class BlobInstance {
  constructor(options = {}) {
    this.id       = options.id ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.color    = options.color ?? '#ffffff'; // hex string
    this.strength = options.strength ?? 1.0;    // swarm attraction weight
  }
}
