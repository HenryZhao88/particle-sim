// main.js
// Every open window is a swirling sphere of GPU dust in shared screen
// space, joined to the other windows by thin tapered funnels of the same
// dust. Window sync (localStorage store, storage events, ping/pong
// cleanup) follows multitab-particle-bridge (c) 2025 Kovalenko Dmytro,
// MIT — see README.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import ParticleSystem from './components/ParticleSystem.js';
import { tryToInitialize } from './helpers/sceneInitHelpers.js';
import { getSphereModelsFromWindows } from './helpers/utils.js';

function shouldIgnoreShortcut(event) {
  const target = event.target;
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function createCommandUi({ initialWarp, onWarpChange }) {
  const root = document.createElement('aside');
  root.className = 'command-ui';
  root.setAttribute('aria-label', 'Particle commands');
  root.innerHTML = `
    <div class="command-ui__header">
      <div>
        <p class="command-ui__eyebrow">Particle bridge</p>
        <p class="command-ui__status"><span data-window-count>1</span> <span data-window-label>window</span></p>
      </div>
      <button class="command-ui__button command-ui__button--quiet" type="button" data-command="beauty">
        Beauty
      </button>
    </div>
    <div class="command-ui__actions">
      <button class="command-ui__button" type="button" data-command="new-window">New window</button>
      <div class="command-ui__stepper" aria-label="Simulation speed">
        <button class="command-ui__icon-button" type="button" data-command="slower" aria-label="Slower">-</button>
        <output data-warp-label>${initialWarp}x</output>
        <button class="command-ui__icon-button" type="button" data-command="faster" aria-label="Faster">+</button>
      </div>
    </div>
    <dl class="command-ui__shortcuts">
      <div><dt>N</dt><dd>New window</dd></div>
      <div><dt>H/B</dt><dd>Hide UI</dd></div>
      <div><dt>-/+</dt><dd>Speed</dd></div>
      <div><dt>0</dt><dd>Reset speed</dd></div>
    </dl>
  `;
  document.body.appendChild(root);

  let warp = initialWarp;
  let hidden = false;
  const windowCount = root.querySelector('[data-window-count]');
  const windowLabel = root.querySelector('[data-window-label]');
  const warpLabel = root.querySelector('[data-warp-label]');

  const setWarp = (nextWarp) => {
    warp = Math.max(1, Math.min(12, Math.round(nextWarp)));
    warpLabel.textContent = `${warp}x`;
    onWarpChange(warp);

    const url = new URL(window.location.href);
    if (warp === 1) url.searchParams.delete('warp');
    else url.searchParams.set('warp', String(warp));
    window.history.replaceState(null, '', url);
  };

  const setHidden = (nextHidden) => {
    hidden = nextHidden;
    document.body.classList.toggle('ui-hidden', hidden);
    root.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  };

  const openWindow = () => {
    const url = new URL(window.location.href);
    if (warp === 1) url.searchParams.delete('warp');
    else url.searchParams.set('warp', String(warp));
    window.open(url.toString(), '_blank', 'popup,width=720,height=520');
  };

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-command]')
      : null;
    if (!button) return;

    switch (button.dataset.command) {
      case 'beauty':
        setHidden(true);
        break;
      case 'new-window':
        openWindow();
        break;
      case 'slower':
        setWarp(warp - 1);
        break;
      case 'faster':
        setWarp(warp + 1);
        break;
      default:
        break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (shouldIgnoreShortcut(event) || event.repeat) return;

    const key = event.key.toLowerCase();
    if (key === 'h' || key === 'b') {
      setHidden(!hidden);
    } else if (key === 'escape' && hidden) {
      setHidden(false);
    } else if (key === 'n') {
      openWindow();
    } else if (key === '-' || key === '_') {
      setWarp(warp - 1);
    } else if (key === '=' || key === '+') {
      setWarp(warp + 1);
    } else if (key === '0') {
      setWarp(1);
    }
  });

  return {
    setWindowCount(count) {
      windowCount.textContent = String(count);
      windowLabel.textContent = count === 1 ? 'window' : 'windows';
    }
  };
}

export default function init() {
  const windowId = crypto.randomUUID();
  let windows = null;
  const setWindows = (next) => { windows = next; };

  const cleanupFunctions = [];
  // ?force=1 skips the visibility gate (useful when testing in background tabs)
  const force = new URLSearchParams(window.location.search).has('force');
  tryToInitialize(windowId, setWindows, cleanupFunctions, force);
  document.addEventListener('visibilitychange', () => {
    tryToInitialize(windowId, setWindows, cleanupFunctions);
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('black');

  // The camera is a viewport into shared world (screen) coordinates, y-down.
  // It eases toward the window's actual rect, so dragging the window pans
  // through the dust field with a trailing feel.
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10000, 10000);
  const contentOrigin = () => ({
    x: window.screenLeft,
    y: window.screenTop + (window.outerHeight - window.innerHeight)
  });
  let view = contentOrigin();

  function updateCamera(dt) {
    const target = contentOrigin();
    const ease = 1 - Math.exp(-dt * 14);
    view.x += (target.x - view.x) * ease;
    view.y += (target.y - view.y) * ease;
    camera.left = view.x;
    camera.right = view.x + window.innerWidth;
    camera.top = view.y;
    camera.bottom = view.y + window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.7,  // strength
    0.5,  // radius
    0.0   // threshold
  ));

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const systems = new Map(); // window id → ParticleSystem
  const motion = new Map();  // window id → { x, y, vx, vy, kick }

  function syncEntities() {
    if (!windows || !windows[windowId]) return;

    const models = getSphereModelsFromWindows(windows);
    const ids = new Set();

    for (const model of models) {
      ids.add(model.id);
      let system = systems.get(model.id);
      if (!system) {
        system = new ParticleSystem(renderer, scene, model);
        systems.set(model.id, system);
      }
      system.setModel(model.center, model.radius);
      system.setOthers(models.filter((m) => m.id !== model.id));
    }
    for (const [id, system] of systems) {
      if (!ids.has(id)) {
        system.dispose();
        systems.delete(id);
        motion.delete(id);
      }
    }
    return models;
  }

  // Estimate each window's center velocity and acceleration in local
  // coordinates, smoothed so 100ms-quantized storage updates don't spike.
  function trackMotion(models, dt) {
    if (!models || dt < 1e-4) return;
    for (const model of models) {
      const system = systems.get(model.id);
      if (!system) continue;
      let m = motion.get(model.id);
      if (!m) {
        m = { x: model.center[0], y: model.center[1], vx: 0, vy: 0, kick: 0 };
        motion.set(model.id, m);
      }
      const instVx = (model.center[0] - m.x) / dt;
      const instVy = (model.center[1] - m.y) / dt;
      const s = 1 - Math.exp(-dt * 10);
      const vx = m.vx + (instVx - m.vx) * s;
      const vy = m.vy + (instVy - m.vy) * s;
      const acc = Math.hypot(vx - m.vx, vy - m.vy) / dt;
      m.kick = Math.max(m.kick * Math.exp(-3 * dt), Math.min(acc, 4000));
      m.x = model.center[0];
      m.y = model.center[1];
      m.vx = vx;
      m.vy = vy;
      system.setMotion(vx, vy, m.kick);
    }
  }

  const clock = new THREE.Clock();
  // ?warp=N multiplies the shared step rate (dev: evolve the sim fast).
  let warp = Math.max(1, parseInt(new URLSearchParams(window.location.search).get('warp'), 10) || 1);
  const commandUi = createCommandUi({
    initialWarp: warp,
    onWarpChange(nextWarp) {
      warp = nextWarp;
    }
  });

  // Fixed-step simulation driven by a wall clock shared across windows
  // (seconds since midnight), so every window computes the same dust field
  // step-for-step and the scene lines up seamlessly at window boundaries.
  const STEP_HZ = 60;
  const STEP_DT = 1 / STEP_HZ;
  const MAX_STEPS_PER_FRAME = 90;
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const sharedSteps = () => Math.floor(((Date.now() - dayStart) / 1000) * STEP_HZ * warp);
  let doneSteps = sharedSteps();

  function animate() {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    updateCamera(dt);
    const models = syncEntities();
    trackMotion(models, dt);
    commandUi.setWindowCount(systems.size);

    const due = sharedSteps();
    let pending = due - doneSteps;
    if (pending > MAX_STEPS_PER_FRAME) {
      doneSteps = due - MAX_STEPS_PER_FRAME;
      pending = MAX_STEPS_PER_FRAME;
    }
    for (let i = 0; i < pending; i++) {
      const simTime = (doneSteps + i + 1) * STEP_DT;
      for (const system of systems.values()) system.update(STEP_DT, simTime);
    }
    doneSteps = due;

    composer.render();
    requestAnimationFrame(animate);
  }

  animate();
}
