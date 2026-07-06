# Particle Sim

A multi-window particle visualization: every browser window you open becomes a
sphere of drifting particles in shared screen space, with bridges of glowing
particles flowing between windows.

## Run

```bash
python3 -m http.server
```

Open `http://localhost:8000` in two or more windows and drag them around.

## Credits

This is a vanilla three.js port of
[multitab-particle-bridge](https://github.com/KovDimaY/multitab-particle-bridge)
by Kovalenko Dmytro (MIT License), itself inspired by Bjørn Gunnar Staal's
original multi-window concept. The module structure mirrors the original:
`constants.js`, `helpers/` (localStorage window store, scene init, utils), and
`components/` (particle sphere, particle bridge), with React Three Fiber
replaced by a plain three.js render loop and `EffectComposer` bloom.
