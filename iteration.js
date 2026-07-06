// iteration.js
// Reads simulation tweak parameters from the URL and provides defaults.

export default function getSimParams() {
    const params = new URLSearchParams(window.location.search);
  
    return {
      // How much velocity decays each frame (0–1)
      friction: parseFloat(params.get('friction')) || 0.98,
      // Number of simulation sub-steps per frame
      steps: parseInt(params.get('steps'), 10) || 1
    };
  }
  