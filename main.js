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

  // Pixel-unit orthographic camera, y-up; wide z range so the 3D dust
  // never clips.
  const camera = new THREE.OrthographicCamera(
    0, window.innerWidth, window.innerHeight, 0, -10000, 10000
  );

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
    camera.right = window.innerWidth;
    camera.top = window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const systems = new Map(); // window id → ParticleSystem

  function syncEntities() {
    if (!windows || !windows[windowId]) return;

    const models = getSphereModelsFromWindows(windows, windowId);
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
      }
    }
  }

  const clock = new THREE.Clock();
  // ?warp=N runs N fixed sim substeps per frame (dev: evolve the sim fast)
  const warp = Math.max(1, parseInt(new URLSearchParams(window.location.search).get('warp'), 10) || 1);
  let simTime = 0;

  function animate() {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    syncEntities();
    for (let i = 0; i < warp; i++) {
      const stepDt = warp > 1 ? 1 / 60 : dt;
      simTime += stepDt;
      for (const system of systems.values()) system.update(stepDt, simTime);
    }

    composer.render();
    requestAnimationFrame(animate);
  }

  animate();
}
