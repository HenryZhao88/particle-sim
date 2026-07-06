// main.js
// Orchestrates the shared-space scene: every window is a particle sphere,
// particle bridges flow between windows, an ambient swarm orbits the
// spheres, and the whole frame is bloomed.
// Sphere/bridge visuals ported from multitab-particle-bridge
// (c) 2025 Kovalenko Dmytro, MIT — see README.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import WindowManager, { contentRect, pickColor } from './WindowManager.js';
import BlobInstance from './instance.js';
import ParticleSphere from './components/ParticleSphere.js';
import ParticleBridge from './components/ParticleBridge.js';
import getSimParams from './iteration.js';
import { clamp, lerp, randRange, randInCircle } from './utils/mathUtils.js';
import { OUTER_SPHERE_RADIUS, OUTER_SPHERE_PARTICLES } from './constants.js';

const GRAVITY = 3.0e7;   // px^3/s^2 swarm pull toward each sphere
const SOFTENING = 1.2e4; // keeps close-range forces sane

export default async function init() {
  const params = getSimParams();

  const [bgVert, bgFrag] = await Promise.all([
    fetch('./shader.vert').then((r) => r.text()),
    fetch('./shader.frag').then((r) => r.text())
  ]);

  // --- Renderer + bloom pipeline --------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    0, window.innerWidth, 0, window.innerHeight, -2000, 2000
  );

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    params.bloom, // strength
    0.45,         // radius
    0.08          // threshold: particles glow, the dark backdrop stays dark
  );
  composer.addPass(bloom);

  // --- Starfield backdrop ----------------------------------------------------
  const bgMaterial = new THREE.ShaderMaterial({
    vertexShader: bgVert,
    fragmentShader: bgFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2() }
    }
  });
  const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMaterial);
  bgQuad.frustumCulled = false; // vertex shader outputs NDC directly
  bgQuad.renderOrder = -1;
  scene.add(bgQuad);

  // --- Local identity ---------------------------------------------------------
  const localBlob = new BlobInstance({
    id: WindowManager.id,
    color: pickColor(),
    strength: randRange(0.8, 1.4)
  });
  WindowManager.setLocalBlob(localBlob);

  // --- Window entities ----------------------------------------------------------
  const spheres = new Map(); // windowId → ParticleSphere
  const bridges = new Map(); // "fromId|toId" → ParticleBridge

  function localCenter() {
    return new THREE.Vector3(window.innerWidth / 2, window.innerHeight / 2, 0);
  }

  /** All windows in local pixel coordinates: [{ id, center, color, strength }] */
  function collectWindows() {
    const my = contentRect();
    const out = [{
      id: WindowManager.id,
      center: localCenter(),
      color: localBlob.color,
      strength: localBlob.strength
    }];
    for (const peer of WindowManager.getPeers()) {
      if (!peer.rect || !peer.blob) continue;
      out.push({
        id: peer.id,
        center: new THREE.Vector3(
          peer.rect.left + peer.rect.width / 2 - my.left,
          peer.rect.top + peer.rect.height / 2 - my.top,
          0
        ),
        color: peer.blob.color,
        strength: peer.blob.strength ?? 1
      });
    }
    return out;
  }

  function syncEntities(windows) {
    const liveIds = new Set(windows.map((w) => w.id));

    // Spheres: create/update for live windows, fade out the departed.
    for (const w of windows) {
      let sphere = spheres.get(w.id);
      if (!sphere) {
        sphere = new ParticleSphere(scene, {
          color: w.color,
          count: OUTER_SPHERE_PARTICLES,
          radius: OUTER_SPHERE_RADIUS,
          center: w.center,
          visible: false // fades in on arrival
        });
        sphere.setVisible(true);
        spheres.set(w.id, sphere);
      }
      sphere.setCenter(w.center);
      sphere.setVisible(true);
    }
    for (const [id, sphere] of spheres) {
      if (!liveIds.has(id)) {
        sphere.setVisible(false);
        if (sphere.isFadedOut) {
          sphere.dispose();
          spheres.delete(id);
        }
      }
    }

    // Bridges: one per ordered pair of live windows, colored by the source.
    const wanted = new Set();
    for (const a of windows) {
      for (const b of windows) {
        if (a.id === b.id) continue;
        const key = `${a.id}|${b.id}`;
        wanted.add(key);
        let bridge = bridges.get(key);
        if (!bridge) {
          bridge = new ParticleBridge(scene, { color: a.color, from: a.center, to: b.center });
          bridges.set(key, bridge);
        }
        bridge.setEndpoints(a.center, b.center);
        bridge.setVisible(true);
      }
    }
    for (const [key, bridge] of bridges) {
      if (!wanted.has(key)) {
        bridge.setVisible(false);
        if (bridge.isFadedOut) {
          bridge.dispose();
          bridges.delete(key);
        }
      }
    }
  }

  // --- Ambient swarm ---------------------------------------------------------------
  const N = params.particles;
  const positions = new Float32Array(N * 3);
  const velocities = new Float32Array(N * 2);
  const colors = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const speeds = new Float32Array(N);
  const localRGB = new THREE.Color(localBlob.color);

  function respawn(i) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const p = randInCircle(cx, cy, Math.min(cx, cy) * 0.9);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const speed = Math.sqrt((GRAVITY * localBlob.strength) / (d + 120)) * randRange(0.6, 1.1);
    velocities[i * 2] = (-dy / d) * speed;
    velocities[i * 2 + 1] = (dx / d) * speed;
    const w = Math.random() * 0.55;
    colors[i * 3] = lerp(localRGB.r, 1, w);
    colors[i * 3 + 1] = lerp(localRGB.g, 1, w);
    colors[i * 3 + 2] = lerp(localRGB.b, 1, w);
    sizes[i] = randRange(1.2, 3.2);
  }
  for (let i = 0; i < N; i++) respawn(i);

  const swarmGeometry = new THREE.BufferGeometry();
  swarmGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  swarmGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  swarmGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  swarmGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  const swarmMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { u_dpr: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSpeed;
      uniform float u_dpr;
      varying vec3 vColor;
      void main() {
        vColor = aColor * mix(0.35, 1.3, aSpeed);
        gl_PointSize = aSize * u_dpr * mix(0.85, 1.5, aSpeed);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.06, d);
        gl_FragColor = vec4(vColor * a, a);
      }`
  });
  const swarm = new THREE.Points(swarmGeometry, swarmMaterial);
  swarm.frustumCulled = false;
  scene.add(swarm);

  const SPEED_REF = 900; // px/s that counts as "fast" for brightness
  function stepSwarm(dt) {
    const attractors = [];
    for (const sphere of spheres.values()) {
      if (sphere.fade > 0.05) {
        attractors.push({
          x: sphere.smoothedCenter.x,
          y: sphere.smoothedCenter.y,
          strength: sphere.fade
        });
      }
    }
    const nA = attractors.length;
    const sub = dt / params.steps;
    const keep = Math.pow(params.friction, sub * 60);
    const maxDist = Math.max(window.innerWidth, window.innerHeight) * 3 + 2000;
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;

    for (let s = 0; s < params.steps; s++) {
      for (let i = 0; i < N; i++) {
        let ax = 0, ay = 0;
        const px = positions[i * 3], py = positions[i * 3 + 1];
        for (let a = 0; a < nA; a++) {
          const b = attractors[a];
          const dx = b.x - px, dy = b.y - py;
          const d2 = dx * dx + dy * dy + SOFTENING;
          const f = (GRAVITY * b.strength) / d2 / Math.sqrt(d2);
          ax += dx * f;
          ay += dy * f;
        }
        const vx = (velocities[i * 2] + ax * sub) * keep;
        const vy = (velocities[i * 2 + 1] + ay * sub) * keep;
        velocities[i * 2] = vx;
        velocities[i * 2 + 1] = vy;
        positions[i * 3] = px + vx * sub;
        positions[i * 3 + 1] = py + vy * sub;
      }
    }

    let respawned = false;
    for (let i = 0; i < N; i++) {
      const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy > maxDist * maxDist) {
        respawn(i);
        respawned = true;
      }
      speeds[i] = clamp(Math.hypot(velocities[i * 2], velocities[i * 2 + 1]) / SPEED_REF, 0, 1);
    }
    swarmGeometry.attributes.position.needsUpdate = true;
    swarmGeometry.attributes.aSpeed.needsUpdate = true;
    if (respawned) {
      swarmGeometry.attributes.aColor.needsUpdate = true;
      swarmGeometry.attributes.aSize.needsUpdate = true;
    }
  }

  // --- Resize --------------------------------------------------------------------
  function onWindowResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.right = w;
    camera.bottom = h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onWindowResize);

  // --- HUD ----------------------------------------------------------------------
  const hud = {
    windows: document.getElementById('hud-windows'),
    particles: document.getElementById('hud-particles'),
    fps: document.getElementById('hud-fps'),
    params: document.getElementById('hud-params'),
    hint: document.getElementById('hud-hint'),
    swatch: document.getElementById('hud-swatch')
  };
  if (hud.particles) hud.particles.textContent = N.toLocaleString();
  if (hud.params) hud.params.textContent = `friction ${params.friction} · ${params.steps} step${params.steps > 1 ? 's' : ''}/frame · bloom ${params.bloom}`;
  if (hud.swatch) {
    hud.swatch.style.background = localBlob.color;
    hud.swatch.style.color = localBlob.color;
  }

  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  document.addEventListener('visibilitychange', () => {
    fpsFrames = 0;
    fpsWindowStart = performance.now();
  });

  // --- Frame loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  let lastCount = -1;

  function animate() {
    const dt = clamp(clock.getDelta(), 0, 0.05);
    const time = clock.getElapsedTime();
    const dpr = renderer.getPixelRatio();

    const windows = collectWindows();
    syncEntities(windows);

    for (const sphere of spheres.values()) sphere.update(dt, dpr);
    for (const bridge of bridges.values()) bridge.update(dt, time, dpr);
    stepSwarm(dt);

    bgMaterial.uniforms.u_time.value = time;
    bgMaterial.uniforms.u_resolution.value.set(
      window.innerWidth * dpr, window.innerHeight * dpr
    );
    swarmMaterial.uniforms.u_dpr.value = dpr;

    composer.render();

    if (windows.length !== lastCount && hud.windows) {
      lastCount = windows.length;
      hud.windows.textContent = String(lastCount);
      if (hud.hint) hud.hint.classList.toggle('hidden', lastCount > 1);
    }
    fpsFrames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 500) {
      if (hud.fps) hud.fps.textContent = String(Math.round(fpsFrames * 1000 / (now - fpsWindowStart)));
      fpsFrames = 0;
      fpsWindowStart = now;
    }

    requestAnimationFrame(animate);
  }

  animate();
}
