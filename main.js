import WindowManager from './WindowManager.js';

export default function init(THREE) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();

  // Camera (orthographic for fullscreen quad)
  const camera = new THREE.OrthographicCamera(
    window.innerWidth / -2, window.innerWidth / 2,
    window.innerHeight / 2, window.innerHeight / -2,
    -1000, 1000
  );
  camera.position.z = 1;

  // Fullscreen quad geometry
  const geometry = new THREE.PlaneGeometry(window.innerWidth, window.innerHeight);

  // Shader material (using embedded shaders in index.html)
  const maxPeers = 10; // max peers to track
  const material = new THREE.ShaderMaterial({
    vertexShader: document.getElementById('vertexShader').textContent,
    fragmentShader: document.getElementById('fragmentShader').textContent,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      u_peerCount: { value: 0 },
      u_peerPositions: { value: new Float32Array(maxPeers * 2) }
    }
  });

  const quad = new THREE.Mesh(geometry, material);
  scene.add(quad);

  // Handle window resize
  window.addEventListener('resize', onWindowResize);

  // Clock for animation timing
  const clock = new THREE.Clock();

  function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    material.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
  }

  function animate() {
    // Sync peer positions
    const peers = WindowManager.getPeers();
    const count = Math.min(peers.length, maxPeers);
    material.uniforms.u_peerCount.value = count;
    // Fill positions (normalized)
    for (let i = 0; i < maxPeers; i++) {
      const offset = i * 2;
      if (i < count) {
        const p = peers[i];
        material.uniforms.u_peerPositions.value[offset]     = p.x / window.innerWidth;
        material.uniforms.u_peerPositions.value[offset + 1] = p.y / window.innerHeight;
      } else {
        material.uniforms.u_peerPositions.value[offset]     = 0;
        material.uniforms.u_peerPositions.value[offset + 1] = 0;
      }
    }

    // Update time uniform
    material.uniforms.u_time.value = clock.getElapsedTime();

    // Render scene
    renderer.render(scene, camera);

    // Loop
    requestAnimationFrame(animate);
  }

  // Start animation
  animate();
}
