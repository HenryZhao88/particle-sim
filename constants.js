// constants.js
// Tuning values for spheres, bridges, and timing. Structure follows
// multitab-particle-bridge (c) 2025 Kovalenko Dmytro, MIT — see README.

// Curated neon palette; assigned round-robin via a shared localStorage
// counter so every window gets a distinct, high-contrast identity.
export const COLORS = [
  '#ff4d6d', // coral red
  '#7cff5b', // lime
  '#ffe14d', // gold
  '#ff5bff', // magenta
  '#ffffff', // white
  '#4dfff0', // aqua
  '#4d7bff', // azure
  '#ff9f4d'  // orange
];
export const COLOR_COUNTER_KEY = 'particle_sim_color_counter';

// Motion smoothing: fraction of remaining distance covered per 60fps frame.
export const EASING = 0.1;

// Sphere properties
export const OUTER_SPHERE_RADIUS = 150;
export const INNER_SPHERE_RADIUS = 50;
export const OUTER_SPHERE_PARTICLES = 2000;
export const INNER_SPHERE_PARTICLES = 500;
export const SPHERE_DRIFT_SPEED = 30;    // px/s internal particle drift
export const SPHERE_FADE_SPEED = 2.0;    // alpha units/s for fade in/out

// Bridge properties
export const BRIDGE_PARTICLES = 500;
export const BRIDGE_WIDTH = OUTER_SPHERE_RADIUS;
export const BRIDGE_GROW_SECONDS = 4;    // time for a new bridge to span fully
export const BRIDGE_FLOW_SPEED = 0.1;    // full crossings per second
export const MIN_BRIDGE_LENGTH = 100;    // px; closer than this, no bridge

// Particle sprite sizes (CSS px, scaled by devicePixelRatio at render)
export const MIN_PARTICLE_SIZE = 1;
export const MAX_PARTICLE_SIZE = 10;
