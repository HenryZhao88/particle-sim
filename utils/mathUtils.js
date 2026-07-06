// mathUtils.js
// Small math helpers shared by the particle simulation.

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Random float in [min, max). */
export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/** Random point inside a circle of the given radius around (cx, cy). */
export function randInCircle(cx, cy, radius) {
  const a = Math.random() * Math.PI * 2;
  const r = radius * Math.sqrt(Math.random());
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}
