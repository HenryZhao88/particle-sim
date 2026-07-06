import WindowManager, { contentRect } from './WindowManager.js';
import BlobInstance from './instance.js';
import getSimParams from './iteration.js';
import { clamp, lerp, randRange, randInCircle } from './utils/mathUtils.js';

const MAX_PEERS = 10;
const MAX_BLOBS = MAX_PEERS + 1;      // local blob + peers
const FLOATS_PER_BLOB = 7;            // x, y, radius, strength, r, g, b
const GRAVITY = 3.0e7;                // px^3/s^2 pull toward each blob
const SOFTENING = 1.2e4;              // keeps close-range forces sane
const TRAIL_DECAY = 0.90;             // trail brightness kept per frame
const TRAIL_SCALE = 0.6;              // trail buffer resolution vs screen
const ENTER_MS = 750;                 // blob pop-in duration
const EXIT_MS = 450;                  // blob shrink-out duration

const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export default async function init(THREE) {
  const params = getSimParams();

  const [vertexShader, fragmentShader] = await Promise.all([
    fetch('./shader.vert').then((r) => r.text()),
    fetch('./shader.frag').then((r) => r.text())
  ]);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false; // every pass overwrites or blends deliberately
  document.body.appendChild(renderer.domElement);

  // Camera in CSS-pixel coordinates, y pointing down, matching the
  // screen-space coordinates the windows broadcast.
  const camera = new THREE.OrthographicCamera(
    0, window.innerWidth, 0, window.innerHeight, -1000, 1000
  );

  // This window's blob. Peers receive its appearance over the channel.
  const localBlob = new BlobInstance({
    id: WindowManager.id,
    color: new THREE.Color().setHSL(Math.random(), 0.75, 0.62).toArray(),
    radius: 0.16,                    // fraction of the window's short side
    strength: randRange(0.8, 1.4)
  });
  WindowManager.setLocalBlob(localBlob);
  const bootTime = performance.now();

  // --- Background scene (blobs + bridges + stars shader) -------------------
  const bgMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2() },
      u_blobCount: { value: 1 },
      u_blobs: { value: new Float32Array(MAX_BLOBS * FLOATS_PER_BLOB) }
    }
  });
  const bgScene = new THREE.Scene();
  const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMaterial);
  bgQuad.frustumCulled = false; // vertex shader outputs NDC directly
  bgScene.add(bgQuad);

  // --- Particles (custom soft-sprite shader) --------------------------------
  const N = params.particles;
  const positions = new Float32Array(N * 3);
  const velocities = new Float32Array(N * 2);
  const colors = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const speeds = new Float32Array(N); // normalized speed, drives brightness

  function respawn(i) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const p = randInCircle(cx, cy, Math.min(cx, cy) * 0.9);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    // Tangential velocity for a loose orbit around the local blob.
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const speed = Math.sqrt((GRAVITY * localBlob.strength) / (d + 120)) * randRange(0.6, 1.1);
    velocities[i * 2] = (-dy / d) * speed;
    velocities[i * 2 + 1] = (dx / d) * speed;
    // Local blob color, nudged toward white for sparkle.
    const w = Math.random() * 0.55;
    colors[i * 3] = lerp(localBlob.color[0], 1, w);
    colors[i * 3 + 1] = lerp(localBlob.color[1], 1, w);
    colors[i * 3 + 2] = lerp(localBlob.color[2], 1, w);
    sizes[i] = randRange(1.6, 4.2);
  }
  for (let i = 0; i < N; i++) respawn(i);

  const pGeometry = new THREE.BufferGeometry();
  pGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  pGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  pGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const pMaterial = new THREE.ShaderMaterial({
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
        // Fast particles run brighter and slightly larger.
        vColor = aColor * mix(0.45, 1.7, aSpeed);
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
  const pointsScene = new THREE.Scene();
  const points = new THREE.Points(pGeometry, pMaterial);
  points.frustumCulled = false;
  pointsScene.add(points);

  // --- Trail feedback pipeline ----------------------------------------------
  // Particles accumulate into a half-res buffer that fades a little each
  // frame, leaving comet trails. Ping-pong between two targets.
  const trailQuadVert = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }`;

  function makeTrailTarget(w, h) {
    return new THREE.WebGLRenderTarget(
      Math.max(1, Math.round(w * TRAIL_SCALE)),
      Math.max(1, Math.round(h * TRAIL_SCALE)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false
      }
    );
  }
  const bufW = () => window.innerWidth * renderer.getPixelRatio();
  const bufH = () => window.innerHeight * renderer.getPixelRatio();
  let trailRead = makeTrailTarget(bufW(), bufH());
  let trailWrite = makeTrailTarget(bufW(), bufH());

  const fadeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tPrev: { value: trailRead.texture },
      u_decay: { value: TRAIL_DECAY }
    },
    vertexShader: trailQuadVert,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tPrev;
      uniform float u_decay;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tPrev, vUv).rgb * u_decay;
        // Floor tiny values so trails die instead of ghosting forever.
        gl_FragColor = vec4(max(c - 0.0015, 0.0), 1.0);
      }`
  });
  const fadeScene = new THREE.Scene();
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
  fadeQuad.frustumCulled = false;
  fadeScene.add(fadeQuad);

  const compositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    uniforms: { tTrail: { value: trailWrite.texture } },
    vertexShader: trailQuadVert,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tTrail;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tTrail, vUv).rgb * 0.85;
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const compositeScene = new THREE.Scene();
  const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
  compositeQuad.frustumCulled = false;
  compositeScene.add(compositeQuad);

  // Trail buffers start with whatever memory the GPU hands us — clear them.
  renderer.setRenderTarget(trailRead);
  renderer.clear(true, false, false);
  renderer.setRenderTarget(trailWrite);
  renderer.clear(true, false, false);
  renderer.setRenderTarget(null);

  // --- Resize ----------------------------------------------------------------
  function onWindowResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.right = w;
    camera.bottom = h;
    camera.updateProjectionMatrix();
    trailRead.setSize(Math.max(1, Math.round(bufW() * TRAIL_SCALE)), Math.max(1, Math.round(bufH() * TRAIL_SCALE)));
    trailWrite.setSize(Math.max(1, Math.round(bufW() * TRAIL_SCALE)), Math.max(1, Math.round(bufH() * TRAIL_SCALE)));
  }
  window.addEventListener('resize', onWindowResize);

  // --- HUD ---------------------------------------------------------------------
  const hud = {
    windows: document.getElementById('hud-windows'),
    particles: document.getElementById('hud-particles'),
    fps: document.getElementById('hud-fps'),
    params: document.getElementById('hud-params'),
    hint: document.getElementById('hud-hint'),
    swatch: document.getElementById('hud-swatch')
  };
  if (hud.particles) hud.particles.textContent = N.toLocaleString();
  if (hud.params) hud.params.textContent = `friction ${params.friction} · ${params.steps} step${params.steps > 1 ? 's' : ''}/frame`;
  if (hud.swatch) {
    const rgb = `rgb(${localBlob.color.map((c) => Math.round(c * 255)).join(',')})`;
    hud.swatch.style.background = rgb;
    hud.swatch.style.color = rgb; // drives the glow via currentColor
  }

  // --- Blob lifecycle (pop in / shrink out) -------------------------------------
  // id → { peer, firstSeen, dying, dieAt }
  const blobStates = new Map();

  function lifecycleScale(state, now) {
    if (state.dying) {
      const t = (now - state.dieAt) / EXIT_MS;
      return t >= 1 ? 0 : (1 - t) * (1 - t);
    }
    return easeOutBack(Math.min((now - state.firstSeen) / ENTER_MS, 1));
  }

  // --- Animation -----------------------------------------------------------------
  const clock = new THREE.Clock();
  const attractors = []; // { x, y, radiusPx, strength, color }

  function rebuildAttractors() {
    const now = performance.now();
    const my = contentRect();
    attractors.length = 0;

    const introScale = easeOutBack(Math.min((now - bootTime) / ENTER_MS, 1));
    attractors.push({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      radiusPx: localBlob.radius * Math.min(window.innerWidth, window.innerHeight) * introScale,
      strength: localBlob.strength * introScale,
      color: localBlob.color
    });

    const live = new Set();
    for (const peer of WindowManager.getPeers()) {
      if (!peer.rect || !peer.blob) continue;
      live.add(peer.id);
      let state = blobStates.get(peer.id);
      if (!state) {
        state = { peer, firstSeen: now, dying: false, dieAt: 0 };
        blobStates.set(peer.id, state);
      }
      state.peer = peer;
      state.dying = false;
    }
    for (const [id, state] of blobStates) {
      if (!live.has(id) && !state.dying) {
        state.dying = true;
        state.dieAt = now;
      }
      const s = lifecycleScale(state, now);
      if (s <= 0) {
        blobStates.delete(id);
        continue;
      }
      if (attractors.length >= MAX_BLOBS) continue;
      const { rect, blob } = state.peer;
      attractors.push({
        x: rect.left + rect.width / 2 - my.left,
        y: rect.top + rect.height / 2 - my.top,
        radiusPx: blob.radius * Math.min(rect.width, rect.height) * s,
        strength: blob.strength * s,
        color: blob.color
      });
    }
  }

  function updateBlobUniforms() {
    const dpr = renderer.getPixelRatio();
    const arr = bgMaterial.uniforms.u_blobs.value;
    for (let i = 0; i < attractors.length; i++) {
      const b = attractors[i];
      const o = i * FLOATS_PER_BLOB;
      arr[o] = b.x * dpr;
      arr[o + 1] = b.y * dpr;
      arr[o + 2] = b.radiusPx * dpr;
      arr[o + 3] = b.strength;
      arr[o + 4] = b.color[0];
      arr[o + 5] = b.color[1];
      arr[o + 6] = b.color[2];
    }
    bgMaterial.uniforms.u_blobCount.value = attractors.length;
    bgMaterial.uniforms.u_resolution.value.set(bufW(), bufH());
  }

  const SPEED_REF = 900; // px/s that counts as "fast" for brightness
  function stepParticles(dt) {
    const sub = dt / params.steps;
    const keep = Math.pow(params.friction, sub * 60); // friction is per-60fps-frame
    const maxDist = Math.max(window.innerWidth, window.innerHeight) * 3 + 2000;
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const nA = attractors.length;

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
      const vx = velocities[i * 2], vy = velocities[i * 2 + 1];
      speeds[i] = clamp(Math.hypot(vx, vy) / SPEED_REF, 0, 1);
    }
    pGeometry.attributes.position.needsUpdate = true;
    pGeometry.attributes.aSpeed.needsUpdate = true;
    if (respawned) {
      pGeometry.attributes.aColor.needsUpdate = true;
      pGeometry.attributes.aSize.needsUpdate = true;
    }
  }

  // --- FPS meter --------------------------------------------------------------------
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  // Don't average FPS across time spent hidden (rAF is suspended there).
  document.addEventListener('visibilitychange', () => {
    fpsFrames = 0;
    fpsWindowStart = performance.now();
  });

  let lastCount = -1;
  function animate() {
    const dt = clamp(clock.getDelta(), 0, 0.05);

    rebuildAttractors();
    updateBlobUniforms();
    stepParticles(dt);
    bgMaterial.uniforms.u_time.value = clock.getElapsedTime();
    pMaterial.uniforms.u_dpr.value = renderer.getPixelRatio();

    // 1) Fade last frame's trails into the write buffer, then stamp the
    //    current particles on top.
    fadeMaterial.uniforms.tPrev.value = trailRead.texture;
    renderer.setRenderTarget(trailWrite);
    renderer.render(fadeScene, camera);
    renderer.render(pointsScene, camera);

    // 2) Screen: background shader, then trails (additive), then crisp
    //    particle cores.
    renderer.setRenderTarget(null);
    renderer.render(bgScene, camera);
    compositeMaterial.uniforms.tTrail.value = trailWrite.texture;
    renderer.render(compositeScene, camera);
    renderer.render(pointsScene, camera);

    // 3) Swap trail buffers.
    const tmp = trailRead;
    trailRead = trailWrite;
    trailWrite = tmp;

    // HUD: window count on change, FPS twice a second.
    if (attractors.length !== lastCount && hud.windows) {
      lastCount = attractors.length;
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
