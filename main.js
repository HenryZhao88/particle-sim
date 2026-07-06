// main.js
// Vanilla port of multitab-particle-bridge src/App.tsx + PixelCamera.tsx
// + GlowingEffect.tsx (c) 2025 Kovalenko Dmytro, MIT — see README.
// Every open window is a particle sphere in shared screen space, with
// particle bridges flowing between all pairs of windows.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import ParticleSphere from './components/ParticleSphere.js';
import ParticleBridge from './components/ParticleBridge.js';
import { tryToInitialize } from './helpers/sceneInitHelpers.js';
import { getAllBridgesBetweenSpheres, getSphereModelsFromWindows } from './helpers/utils.js';
import { OUTER_SPHERE_RADIUS } from './constants.js';

// PixelCamera constants
const NEAR = 0.1;
const FAR = 1000;
const CAMERA_Z = 1000;

export default function init() {
  const windowId = crypto.randomUUID();
  let windows = null;
  const setWindows = (next) => { windows = next; };

  const cleanupFunctions = [];
  tryToInitialize(windowId, setWindows, cleanupFunctions);
  document.addEventListener('visibilitychange', () => {
    tryToInitialize(windowId, setWindows, cleanupFunctions);
  });

  // Renderer + scene (GlowingEffect: black background + bloom)
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('black');
  scene.add(new THREE.AmbientLight());

  // PixelCamera: orthographic, pixel units, y-up, looking down -z
  const camera = new THREE.OrthographicCamera(
    0, window.innerWidth, window.innerHeight, 0, NEAR, FAR
  );
  camera.position.set(0, 0, CAMERA_Z);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.0, // intensity
    0.6, // radius
    0.0  // luminanceThreshold
  ));

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.right = window.innerWidth;
    camera.top = window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // Scene entities, keyed the same way React keys the components
  const sphereEntities = new Map(); // window id → ParticleSphere
  const bridgeEntities = new Map(); // "fromId-toId" → ParticleBridge

  function syncEntities() {
    if (!windows || !windows[windowId]) return;

    const spheres = getSphereModelsFromWindows(windows, windowId);
    const bridges = getAllBridgesBetweenSpheres(spheres);

    const sphereIds = new Set();
    for (const { id, center, color } of spheres) {
      sphereIds.add(id);
      let entity = sphereEntities.get(id);
      if (!entity) {
        entity = new ParticleSphere(scene, { radius: OUTER_SPHERE_RADIUS, center, color });
        sphereEntities.set(id, entity);
      }
      entity.setCenter(center);
    }
    for (const [id, entity] of sphereEntities) {
      if (!sphereIds.has(id)) {
        entity.dispose();
        sphereEntities.delete(id);
      }
    }

    const bridgeIds = new Set();
    for (const { id, from, to, color } of bridges) {
      bridgeIds.add(id);
      let entity = bridgeEntities.get(id);
      if (!entity) {
        entity = new ParticleBridge(scene, { from, to, color });
        bridgeEntities.set(id, entity);
      }
      entity.setEndpoints(from, to);
    }
    for (const [id, entity] of bridgeEntities) {
      if (!bridgeIds.has(id)) {
        entity.dispose();
        bridgeEntities.delete(id);
      }
    }
  }

  const clock = new THREE.Clock();

  function animate() {
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    syncEntities();
    for (const sphere of sphereEntities.values()) sphere.update(delta);
    for (const bridge of bridgeEntities.values()) bridge.update(time, delta);

    composer.render();
    requestAnimationFrame(animate);
  }

  animate();
}
