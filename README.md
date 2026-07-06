# Particle Sim

A multi-window particle visualization: every browser window you open becomes a
sphere of drifting particles in a shared screen space, with particle bridges
flowing between windows and an ambient swarm orbiting it all, finished with
bloom.

## Run

```bash
python3 -m http.server
```

Open `http://localhost:8000` in two or more windows and drag them around —
the windows find each other over a `BroadcastChannel`.

URL parameters: `?particles=1500&friction=0.965&steps=2&bloom=0.9`

## Credits

The particle-sphere and particle-bridge visuals are ported from
[multitab-particle-bridge](https://github.com/KovDimaY/multitab-particle-bridge)
by Kovalenko Dmytro (MIT License), itself inspired by Bjørn Gunnar Staal's
original multi-window concept. Ported from React Three Fiber to vanilla
three.js with frame-rate-independent physics, BroadcastChannel-based window
sync, browser-chrome-corrected coordinates, lifecycle fades, an ambient
gravity swarm, and a starfield backdrop.
