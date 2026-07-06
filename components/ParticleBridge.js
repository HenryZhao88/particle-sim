// ParticleBridge.js
// A stream of particles flowing from one window's sphere to another's:
// tapered (wide at the source, pinched in the middle), faded at both ends,
// jittering, and growing across over a few seconds. An inner sphere fades in
// at the destination once the bridge has fully spanned.
// Ported to vanilla three.js from multitab-particle-bridge
// (c) 2025 Kovalenko Dmytro, MIT — see README. Enhancements: dt-scaled
// easing and uniform-driven whole-bridge fading for clean removal.

import * as THREE from 'three';
import ParticleSphere from './ParticleSphere.js';
import {
  BRIDGE_FLOW_SPEED,
  BRIDGE_GROW_SECONDS,
  BRIDGE_PARTICLES,
  BRIDGE_WIDTH,
  EASING,
  INNER_SPHERE_PARTICLES,
  INNER_SPHERE_RADIUS,
  MIN_BRIDGE_LENGTH,
  MIN_PARTICLE_SIZE,
  MAX_PARTICLE_SIZE,
  SPHERE_FADE_SPEED
} from '../constants.js';

const WIDTH_START = 1.5;
const WIDTH_MIDDLE = 0.5;
const WIDTH_END = 0.3;

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  uniform float uDpr;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform float uFade;
  varying float vAlpha;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha * uFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

export default class ParticleBridge {
  constructor(scene, { color = '#ffffff', from, to }) {
    this.scene = scene;
    this.smoothFrom = new THREE.Vector3().copy(from);
    this.smoothTo = new THREE.Vector3().copy(to);
    this.targetFrom = new THREE.Vector3().copy(from);
    this.targetTo = new THREE.Vector3().copy(to);
    this.age = 0;
    this.fade = 1;
    this.fadeTarget = 1;
    this.innerRevealed = false;

    const positions = new Float32Array(BRIDGE_PARTICLES * 3);
    const alphas = new Float32Array(BRIDGE_PARTICLES);
    const sizes = new Float32Array(BRIDGE_PARTICLES);
    this.offsets = new Float32Array(BRIDGE_PARTICLES);      // phase along bridge
    this.lateral = new Float32Array(BRIDGE_PARTICLES * 2);  // perp + z scatter

    for (let i = 0; i < BRIDGE_PARTICLES; i++) {
      this.offsets[i] = Math.random();
      this.lateral[i * 2] = (Math.random() - 0.5) * BRIDGE_WIDTH;
      this.lateral[i * 2 + 1] = (Math.random() - 0.5) * BRIDGE_WIDTH;
      sizes[i] = MIN_PARTICLE_SIZE + Math.random() * MAX_PARTICLE_SIZE;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFade: { value: 1 },
        uDpr: { value: 1 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Destination inner sphere: hidden until the bridge fully spans.
    this.innerSphere = new ParticleSphere(scene, {
      color,
      count: INNER_SPHERE_PARTICLES,
      radius: INNER_SPHERE_RADIUS,
      center: to,
      visible: false
    });
  }

  setEndpoints(from, to) {
    this.targetFrom.copy(from);
    this.targetTo.copy(to);
  }

  setVisible(visible) {
    this.fadeTarget = visible ? 1 : 0;
    if (!visible) this.innerSphere.setVisible(false);
  }

  get isFadedOut() { return this.fadeTarget === 0 && this.fade < 0.01; }

  update(dt, time, dpr) {
    this.age += dt;

    const ease = 1 - Math.pow(1 - EASING, dt * 60);
    this.smoothFrom.lerp(this.targetFrom, ease);
    this.smoothTo.lerp(this.targetTo, ease);

    const dir = Math.sign(this.fadeTarget - this.fade);
    if (dir !== 0) {
      this.fade = Math.max(0, Math.min(1, this.fade + dir * SPHERE_FADE_SPEED * dt));
    }
    this.material.uniforms.uFade.value = this.fade;
    this.material.uniforms.uDpr.value = dpr;

    const growFactor = Math.min(1, this.age / BRIDGE_GROW_SECONDS);
    if (!this.innerRevealed && growFactor >= 1 && this.fadeTarget === 1) {
      this.innerRevealed = true;
      this.innerSphere.setVisible(true);
    }

    const span = new THREE.Vector3().subVectors(this.smoothTo, this.smoothFrom);
    const bridgeLength = Math.hypot(span.x, span.y);
    const longEnough = bridgeLength > MIN_BRIDGE_LENGTH;
    // Perpendicular in the screen plane for lateral scatter.
    const perpX = -span.y / (bridgeLength || 1);
    const perpY = span.x / (bridgeLength || 1);

    const pos = this.geometry.attributes.position.array;
    const alpha = this.geometry.attributes.aAlpha.array;

    for (let i = 0; i < BRIDGE_PARTICLES; i++) {
      const i3 = i * 3;
      const t = (time * BRIDGE_FLOW_SPEED + this.offsets[i]) % 1;
      if (t > growFactor || !longEnough) {
        alpha[i] = 0;
        continue;
      }

      // Fade in near the source, out near the destination.
      let a = 1;
      if (t < 0.1) a = t / 0.1;
      else if (t > 0.9) a = (1 - t) / 0.1;
      alpha[i] = a;

      // Taper: wide at the source, pinched in the middle, narrow at the end.
      const taper = t < 0.5
        ? WIDTH_START + (WIDTH_MIDDLE - WIDTH_START) * (t / 0.5)
        : WIDTH_MIDDLE + (WIDTH_END - WIDTH_MIDDLE) * ((t - 0.5) / 0.5);

      const jitter = Math.sin(time * 2 + i) * 2;
      const side = this.lateral[i * 2] * taper;
      const depth = this.lateral[i * 2 + 1] * taper;

      pos[i3] = this.smoothFrom.x + span.x * t + perpX * side + jitter;
      pos[i3 + 1] = this.smoothFrom.y + span.y * t + perpY * side + jitter * 0.5;
      pos[i3 + 2] = this.smoothFrom.z + span.z * t + depth;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;

    this.innerSphere.setCenter(this.smoothTo);
    this.innerSphere.update(dt, dpr);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.innerSphere.dispose();
  }
}
