// components/ParticleBridge.js
// Vanilla port of multitab-particle-bridge src/components/ParticlesBridge.tsx
// (c) 2025 Kovalenko Dmytro, MIT — see README.

import * as THREE from 'three';
import ParticleSphere from './ParticleSphere.js';
import {
  BRIDGE_GROW_DURATION,
  BRIDGE_PARTICLES_COUNT,
  BRIDGE_PARTICLES_SPEED,
  BRIDGE_WIDTH,
  EASING_MULTIPPLIER,
  INNER_SPHERE_PARTICLES_COUNT,
  INNER_SPHERE_RADIUS,
  MAX_PARTICLE_SIZE,
  MIN_BRIDGE_LENGTH,
  MIN_PARTICLE_SIZE,
} from '../constants.js';

const WIDTH_START = 1.5;
const WIDTH_MIDDLE = 0.5;
const WIDTH_END = 0.3;

const initialSceneSetup = (count = BRIDGE_PARTICLES_COUNT) => {
  const alphas = new Float32Array(count);
  const offsets = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const offsetsVecs = [];

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    alphas[i] = 0;
    offsetsVecs.push(new THREE.Vector3((Math.random() - 0.5) * BRIDGE_WIDTH, (Math.random() - 0.5) * BRIDGE_WIDTH, 0));
    offsets[i] = Math.random();
    positions[i3] = 0;
    positions[i3 + 1] = 0;
    positions[i3 + 2] = 0;
    sizes[i] = MIN_PARTICLE_SIZE + Math.random() * MAX_PARTICLE_SIZE;
  }
  return { alphas, offsets, offsetsVecs, positions, sizes };
};

const VERTEX_SHADER = `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;

  void main() {
      vAlpha = alpha;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size;
      gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 color;
  varying float vAlpha;

  void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
      if (a < 0.05) discard;
      gl_FragColor = vec4(color, a);
  }
`;

export default class ParticleBridge {
  constructor(scene, { color = 'white', from = [0, 0, 0], to = [0, 0, 0] } = {}) {
    this.scene = scene;
    this.from = from;
    this.to = to;

    this.smoothFrom = new THREE.Vector3(...from);
    this.smoothTo = new THREE.Vector3(...to);

    this.spawnStart = null;
    this.isInvisible = true;

    const { alphas, offsets, offsetsVecs, positions, sizes } = initialSceneSetup();
    this.offsets = offsets;
    this.offsetsVecs = offsetsVecs;
    this.sizes = sizes;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(alphas), 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(sizes), 1));

    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.innerSphere = new ParticleSphere(scene, {
      center: to,
      color,
      count: INNER_SPHERE_PARTICLES_COUNT,
      invisible: true,
      radius: INNER_SPHERE_RADIUS,
    });
  }

  setEndpoints(from, to) {
    this.from = from;
    this.to = to;
  }

  update(time, delta) {
    const mesh = this.points;

    if (this.spawnStart === null) {
      this.spawnStart = time;
    }

    const pixelDensityScale = window.devicePixelRatio || 1;

    const alpha = mesh.geometry.attributes.alpha.array;
    const pos = mesh.geometry.attributes.position.array;
    const newSizes = mesh.geometry.attributes.size.array;

    const growFactor = Math.min(1, (time - this.spawnStart) / BRIDGE_GROW_DURATION);

    this.smoothFrom.lerp(new THREE.Vector3(...this.from), EASING_MULTIPPLIER);
    this.smoothTo.lerp(new THREE.Vector3(...this.to), EASING_MULTIPPLIER);

    const dir = new THREE.Vector3().subVectors(this.smoothTo, this.smoothFrom);
    const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize();

    const bridgeLength = Math.hypot(this.from[0] - this.to[0], this.from[1] - this.to[1]);

    if (this.isInvisible && time - this.spawnStart > BRIDGE_GROW_DURATION) {
      this.isInvisible = false;
      this.innerSphere.setInvisible(false);
    }

    for (let i = 0; i < BRIDGE_PARTICLES_COUNT; i++) {
      const i3 = i * 3;
      const rawT = (time * BRIDGE_PARTICLES_SPEED + this.offsets[i]) % 1;
      if (rawT > growFactor) continue;
      const t = rawT;

      const base = this.smoothFrom.clone().addScaledVector(dir, t);

      const jitter = Math.sin(time * 2 + i) * 2.0;
      const offsetVec = this.offsetsVecs[i].clone();

      // Fade in and out alpha based on t
      let localAlpha = 1.0;
      if (t < 0.1) localAlpha = t / 0.1;
      else if (t > 0.9) localAlpha = (1.0 - t) / 0.1;
      alpha[i] = bridgeLength > MIN_BRIDGE_LENGTH ? localAlpha : 0;

      // Interpolate width with middle pinch
      let taperFactor;
      if (t < 0.5) {
        taperFactor = WIDTH_START + (WIDTH_MIDDLE - WIDTH_START) * (t / 0.5);
      } else {
        taperFactor = WIDTH_MIDDLE + (WIDTH_END - WIDTH_MIDDLE) * ((t - 0.5) / 0.5);
      }

      const wideOffset = perp
        .clone()
        .multiplyScalar(offsetVec.x * taperFactor)
        .add(new THREE.Vector3(0, 0, offsetVec.y * taperFactor));

      pos[i3 + 0] = base.x + wideOffset.x + jitter;
      pos[i3 + 1] = base.y + wideOffset.y + jitter * 0.5;
      pos[i3 + 2] = base.z + wideOffset.z;

      newSizes[i] = this.sizes[i] * pixelDensityScale;
    }
    mesh.geometry.attributes.alpha.needsUpdate = true;
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.size.needsUpdate = true;

    this.innerSphere.setCenter(this.to);
    this.innerSphere.update(delta);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.innerSphere.dispose();
  }
}
