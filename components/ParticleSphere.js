// components/ParticleSphere.js
// Vanilla port of multitab-particle-bridge src/components/ParticlesSphere.tsx
// (c) 2025 Kovalenko Dmytro, MIT — see README.

import * as THREE from 'three';
import {
  EASING_MULTIPPLIER,
  MIN_PARTICLE_SIZE,
  MAX_PARTICLE_SIZE,
  OUTER_SPHERE_PARTICLES_COUNT,
  OUTER_SPHERE_RADIUS,
} from '../constants.js';

const FADE_SPEED = 0.25;

const initialSceneSetup = (count, radius) => {
  const alphas = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    const r = radius * (1 - Math.random() / 6);
    const theta = Math.random() * 2 * Math.PI;
    const phi = Math.acos(2 * Math.random() - 1);
    alphas[i] = 1;

    positions[i3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi);

    velocities[i3 + 0] = (Math.random() - 0.5) * 0.5;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.5;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;

    sizes[i] = MIN_PARTICLE_SIZE + Math.random() * MAX_PARTICLE_SIZE;
  }

  return { positions, velocities, sizes, alphas };
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
      float dist = distance(gl_PointCoord, vec2(0.5));
      float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(color, alpha);
  }
`;

export default class ParticleSphere {
  constructor(scene, {
    center = [0, 0, 0],
    color = 'white',
    count = OUTER_SPHERE_PARTICLES_COUNT,
    invisible = false,
    radius = OUTER_SPHERE_RADIUS,
  } = {}) {
    this.scene = scene;
    this.center = center;
    this.count = count;
    this.radius = radius;
    this.invisible = invisible;

    this.smoothedCenter = new THREE.Vector3(...center);
    this.fadeAlpha = invisible ? 0 : 1;

    const { alphas, positions, sizes, velocities } = initialSceneSetup(count, radius);
    this.velocities = velocities;
    this.sizes = sizes;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(alphas), 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(sizes), 1));

    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      uniforms: {
        color: { value: new THREE.Color(color) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.position.set(...center);
    scene.add(this.points);
  }

  setCenter(center) { this.center = center; }
  setInvisible(invisible) { this.invisible = invisible; }

  update(delta) {
    const mesh = this.points;
    const count = this.count;
    const radius = this.radius;
    const velocities = this.velocities;
    const sizes = this.sizes;

    const pixelDensityScale = window.devicePixelRatio || 1;

    // Smooth fade logic
    const fade = this.fadeAlpha;
    const target = this.invisible ? 0 : 1;
    this.fadeAlpha += (target - fade) * delta * FADE_SPEED;
    this.fadeAlpha = Math.max(0, Math.min(1, this.fadeAlpha));

    // Smooth center logic
    this.smoothedCenter.lerp(new THREE.Vector3(...this.center), EASING_MULTIPPLIER);
    mesh.position.set(...this.smoothedCenter.toArray());

    const alpha = mesh.geometry.attributes.alpha.array;
    const pos = mesh.geometry.attributes.position.array;
    const newSizes = mesh.geometry.attributes.size.array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      pos[i3 + 0] += velocities[i3 + 0];
      pos[i3 + 1] += velocities[i3 + 1];
      pos[i3 + 2] += velocities[i3 + 2];

      const dx = pos[i3 + 0];
      const dy = pos[i3 + 1];
      const dz = pos[i3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > radius) {
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const vDotN = velocities[i3 + 0] * nx + velocities[i3 + 1] * ny + velocities[i3 + 2] * nz;

        velocities[i3 + 0] -= 2 * vDotN * nx;
        velocities[i3 + 1] -= 2 * vDotN * ny;
        velocities[i3 + 2] -= 2 * vDotN * nz;

        pos[i3 + 0] = nx * radius * 0.999;
        pos[i3 + 1] = ny * radius * 0.999;
        pos[i3 + 2] = nz * radius * 0.999;
      }

      alpha[i] = this.fadeAlpha;
      newSizes[i] = sizes[i] * pixelDensityScale;
    }

    mesh.geometry.attributes.alpha.needsUpdate = true;
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.size.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
