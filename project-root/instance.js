export default class BlobInstance {
    constructor(options = {}) {
      this.id        = options.id || Date.now().toString();
      this.color     = options.color || [Math.random(), Math.random(), Math.random()];
      this.strength  = options.strength || 1.0;    // how strong the attractor is
      this.radius    = options.radius   || 0.2;    // normalized blob size
    }
  
    /**
     * Returns a flat Float32Array of parameters suitable for a shader uniform.
     * Layout per blob: [ x, y, r, strength, color.r, color.g, color.b ]
     */
    toUniformArray(x, y) {
      return new Float32Array([
        x, 
        y,
        this.radius,
        this.strength,
        this.color[0],
        this.color[1],
        this.color[2]
      ]);
    }
  }
  