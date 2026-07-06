// ParticleSphere.js
// A window rendered as a cloud of particles drifting inside a spherical
// boundary, bouncing elastically off the inside of the shell.
// Ported to vanilla three.js from multitab-particle-bridge
// (c) 2025 Kovalenko Dmytro, MIT — see README. Enhancements: dt-scaled
// physics (frame-rate independent) and uniform-driven fading.

import * as THREE from 'three';
import {
  EASING,
  MIN_PARTICLE_SIZE,
  MAX_PARTICLE_SIZE,
  SPHERE_DRIFT_SPEED,
  SPHERE_FADE_SPEED
} from '../constants.js';

const VERT = /* glsl */`
  attribute float aSize;
  uniform float uDpr;
  void main() {
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform float uFade;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * uFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

export default class ParticleSphere {
  constructor(scene, { color = '#ffffff', count, radius, center, visible = true }) {
    this.scene = scene;
    this.radius = radius;
    this.count = count;
    this.targetCenter = new THREE.Vector3().copy(center);
    this.smoothedCenter = new THREE.Vector3().copy(center);
    this.fade = visible ? 1 : 0;
    this.fadeTarget = visible ? 1 : 0;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    this.velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Uniform-ish spherical distribution, biased toward the shell.
      const r = radius * (1 - Math.random() / 6);
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      this.velocities[i3] = (Math.random() - 0.5) * SPHERE_DRIFT_SPEED;
      this.velocities[i3 + 1] = (Math.random() - 0.5) * SPHERE_DRIFT_SPEED;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * SPHERE_DRIFT_SPEED;

      sizes[i] = MIN_PARTICLE_SIZE + Math.random() * MAX_PARTICLE_SIZE;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFade: { value: this.fade },
        uDpr: { value: 1 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.position.copy(center);
    scene.add(this.points);
  }

  setCenter(v) { this.targetCenter.copy(v); }
  setVisible(visible) { this.fadeTarget = visible ? 1 : 0; }
  get isFadedOut() { return this.fadeTarget === 0 && this.fade < 0.01; }

  update(dt, dpr) {
    // Ease toward the target center (EASING is per-60fps-frame).
    const ease = 1 - Math.pow(1 - EASING, dt * 60);
    this.smoothedCenter.lerp(this.targetCenter, ease);
    this.points.position.copy(this.smoothedCenter);

    // Fade toward the target alpha.
    const dir = Math.sign(this.fadeTarget - this.fade);
    if (dir !== 0) {
      this.fade = Math.max(0, Math.min(1, this.fade + dir * SPHERE_FADE_SPEED * dt));
    }
    this.material.uniforms.uFade.value = this.fade;
    this.material.uniforms.uDpr.value = dpr;

    // Drift particles; reflect off the inside of the sphere shell.
    const pos = this.geometry.attributes.position.array;
    const vel = this.velocities;
    const R = this.radius;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      const dx = pos[i3], dy = pos[i3 + 1], dz = pos[i3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > R) {
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const vDotN = vel[i3] * nx + vel[i3 + 1] * ny + vel[i3 + 2] * nz;
        vel[i3] -= 2 * vDotN * nx;
        vel[i3 + 1] -= 2 * vDotN * ny;
        vel[i3 + 2] -= 2 * vDotN * nz;
        pos[i3] = nx * R * 0.999;
        pos[i3 + 1] = ny * R * 0.999;
        pos[i3 + 2] = nz * R * 0.999;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
