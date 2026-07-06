# Particle Sim

A multi-window particle visualization: every browser window you open becomes a
swirling sphere of ~65,000 GPU-simulated dust particles in shared screen
space. Windows are joined by thin tapered funnels of the same dust, and each
window's material forms a small counter-swirl inside the others.

The dust is advected by curl noise and spring-bound to an implicit surface
(sphere ∪ funnel ∪ inner swirl, smooth-blended), simulated entirely on the
GPU via `GPUComputationRenderer`.

## Run

```bash
python3 -m http.server
```

Open `http://localhost:8000` in two or more windows and drag them around.

Dev parameters: `?force=1` skips the visibility gate (background-tab testing),
`?warp=N` runs N simulation substeps per frame.

## Credits

- Window synchronization (localStorage store, storage events, ping/pong
  dead-window cleanup) follows
  [multitab-particle-bridge](https://github.com/KovDimaY/multitab-particle-bridge)
  by Kovalenko Dmytro (MIT License).
- Visual concept inspired by Bjørn Gunnar Staal's multi-window demos.
