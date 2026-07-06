// iteration.js
// Reads simulation tweak parameters from the URL and provides defaults.
// e.g. ?friction=0.95&steps=2&particles=3000

function num(params, key, fallback) {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback; // keep explicit 0, reject garbage
}

export default function getSimParams() {
  const params = new URLSearchParams(window.location.search);

  return {
    // How much velocity is kept each sub-step (0–1)
    friction: num(params, 'friction', 0.965),
    // Number of simulation sub-steps per frame
    steps: Math.max(1, Math.round(num(params, 'steps', 2))),
    // Number of particles
    particles: Math.max(0, Math.round(num(params, 'particles', 3500)))
  };
}
