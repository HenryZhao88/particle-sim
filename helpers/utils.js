// helpers/utils.js
// Vanilla port of multitab-particle-bridge src/helpers/utils.ts
// (c) 2025 Kovalenko Dmytro, MIT — see README.

export const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// Content-area origin in screen coords (accounts for browser chrome), so
// every window agrees on one shared world coordinate space.
export const getCurrentWindowDimensions = () => ({
  x: window.screenLeft,
  y: window.screenTop + (window.outerHeight - window.innerHeight),
  width: window.innerWidth,
  height: window.innerHeight,
});

export const areDifferentDimensions = (a, b) =>
  a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;

// Sphere models in WORLD (screen) coordinates, y-down. Every window derives
// the identical world from the shared store; rendering just points a camera
// at its own rect, so the scene lines up seamlessly across windows.
export const getSphereModelsFromWindows = (windows) => {
  return Object.entries(windows).map(([id, { x, y, width, height, color }]) => {
    const center = [x + width / 2, y + height / 2, 0];
    const radius = 0.3 * Math.min(width, height);

    return { center, color, id, radius };
  });
};

export const getAllBridgesBetweenSpheres = (spheres) => {
  const bridges = [];

  for (let i = 0; i < spheres.length; i++) {
    for (let j = 0; j < spheres.length; j++) {
      const sphereA = spheres[i];
      const sphereB = spheres[j];

      if (i !== j) {
        bridges.push({
          id: `${sphereA.id}-${sphereB.id}`,
          color: sphereA.color,
          from: sphereA.center,
          to: sphereB.center,
        });
      }
    }
  }

  return bridges;
};
