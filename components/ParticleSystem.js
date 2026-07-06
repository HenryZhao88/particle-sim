// components/ParticleSystem.js
// One window's material rendered as ~65k GPU-simulated dust particles.
// The particles are spring-bound to an implicit surface: the window's own
// sphere, smoothly blended with a tapered funnel to every other window and
// a small counter-swirl inside each of them. Curl noise plus a coherent
// spin advect the dust into wispy filaments.

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

const TEX_SIZE = 256; // 256^2 = 65,536 particles
const MAX_OTHERS = 9;

// Ashima 3D simplex noise + curl, shared by the velocity shader.
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec3 snoiseVec3(vec3 x){
  float s  = snoise(x);
  float s1 = snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2));
  float s2 = snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4));
  return vec3(s, s1, s2);
}

vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 p_x0 = snoiseVec3(p - dx); vec3 p_x1 = snoiseVec3(p + dx);
  vec3 p_y0 = snoiseVec3(p - dy); vec3 p_y1 = snoiseVec3(p + dy);
  vec3 p_z0 = snoiseVec3(p - dz); vec3 p_z1 = snoiseVec3(p + dz);
  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
  return normalize(vec3(x, y, z) / (2.0 * e) + vec3(1e-6));
}
`;

const SDF_GLSL = /* glsl */`
uniform vec3 uOwn;
uniform float uRadius;
uniform vec3 uOthers[${MAX_OTHERS}];
uniform float uOtherInner[${MAX_OTHERS}];
uniform int uOtherCount;

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float bridgeRadius(float ra, float rb, float t){
  float nearR = max(28.0, ra * 0.30);
  float farR = max(20.0, rb * 0.45);
  float waist = 1.0 - 0.25 * sin(3.14159 * t);
  return mix(nearR, farR, smoothstep(0.0, 1.0, t)) * waist;
}

// Straight tube between window centers; the sphere union hides the inner span.
float sdFunnel(vec3 p, vec3 a, vec3 b, float ra, float rb){
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
  float r = bridgeRadius(ra, rb, t);
  return distance(p, a + ab * t) - r;
}

// xyz = flow direction along the nearest bridge, w = influence 0..1
vec4 nearestBridgeFlow(vec3 p){
  vec3 dir = vec3(0.0);
  float bestDist = 1e20;
  float influence = 0.0;

  for (int i = 0; i < ${MAX_OTHERS}; i++){
    if (i >= uOtherCount) break;
    vec3 c = uOthers[i];
    float rin = uOtherInner[i];
    if (distance(uOwn, c) > uRadius){
      vec3 ab = c - uOwn;
      float t = clamp(dot(p - uOwn, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
      float distToRail = distance(p, uOwn + ab * t);
      if (distToRail < bestDist){
        bestDist = distToRail;
        float r = bridgeRadius(uRadius, rin, t);
        // Soft capture band: fluffy edges without a huge halo.
        influence = 1.0 - smoothstep(r * 1.1, r * 2.5 + 70.0, distToRail);
        // Long, gentle end fades so dust never dams up at either mouth.
        influence *= smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.85, 1.0, t));
        dir = normalize(ab);
      }
    }
  }

  return vec4(dir, influence);
}

float sdf(vec3 p){
  float d = length(p - uOwn) - uRadius;
  for (int i = 0; i < ${MAX_OTHERS}; i++){
    if (i >= uOtherCount) break;
    vec3 c = uOthers[i];
    float rin = uOtherInner[i];
    if (distance(uOwn, c) > uRadius){
      d = smin(d, sdFunnel(p, uOwn, c, uRadius, rin), 48.0);
      d = smin(d, length(p - c) - rin, 48.0);
    }
  }
  return d;
}

// Travelers bind to the bridge network only (funnels + far swirls), so the
// span stays permanently dense instead of relying on strays drifting in.
float sdfTraveler(vec3 p){
  float d = 1e6;
  for (int i = 0; i < ${MAX_OTHERS}; i++){
    if (i >= uOtherCount) break;
    vec3 c = uOthers[i];
    float rin = uOtherInner[i];
    if (distance(uOwn, c) > uRadius){
      d = smin(d, sdFunnel(p, uOwn, c, uRadius, rin), 48.0);
      d = smin(d, length(p - c) - rin, 48.0);
    }
  }
  return d;
}

float field(vec3 p, float traveler){
  if (traveler > 0.5 && uOtherCount > 0){
    float dB = sdfTraveler(p);
    if (dB < 1e5) return dB;
  }
  return sdf(p);
}
`;

const VELOCITY_SHADER = /* glsl */`
uniform float uTime;
uniform float uDt;
uniform vec3 uAxis;
uniform float uSeed;
uniform vec3 uOwnVel;  // this window's center velocity, px/s in local coords
uniform float uKick;   // smoothed acceleration magnitude, px/s^2
${NOISE_GLSL}
${SDF_GLSL}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posRole = texture2D(texturePosition, uv);
  vec3 pos = posRole.xyz;
  float traveler = step(0.65, posRole.w); // ~35% live in the bridge network
  vec3 vel = texture2D(textureVelocity, uv).xyz;

  vec3 rel = pos - uOwn;
  float l = length(rel) + 1e-5;
  float speed = length(uOwnVel);

  // Spring toward the implicit surface (residents: shell + bridge blend;
  // travelers: bridge network only). Fast window motion loosens the grip
  // so dust smears and trails behind.
  float d = field(pos, traveler);
  vec2 k = vec2(1.0, -1.0);
  const float h = 2.0;
  vec3 n = normalize(
    k.xyy * field(pos + k.xyy * h, traveler) +
    k.yyx * field(pos + k.yyx * h, traveler) +
    k.yxy * field(pos + k.yxy * h, traveler) +
    k.xxx * field(pos + k.xxx * h, traveler) + vec3(1e-6));
  // Near the bridge the surface grip relaxes, letting dust drift loosely
  // around the tube instead of getting pinned onto it.
  vec4 flow = nearestBridgeFlow(pos);
  float grip = 1.0 / (1.0 + speed * 0.003);
  grip *= 1.0 - 0.5 * flow.w;
  // Travelers are held a touch more loosely: fuzzy edges, tight core.
  float stiffness = mix(14.0, 11.5, traveler);
  vel += -n * clamp(d, -300.0, 300.0) * stiffness * grip * uDt;

  // Stream dust along the bridge span; travelers ride it hard, residents
  // only feel a gentle drift near the mouth.
  vel += flow.xyz * mix(40.0, 210.0, traveler) * flow.w * uDt;

  // Wispy filaments; motion and jolts whip up extra turbulence.
  float curlStrength = 420.0 * (1.0 + min(speed / 350.0, 1.6) + min(uKick / 2500.0, 1.4));
  vel += curlNoise(pos * (1.0 / 140.0) + vec3(uSeed) + uTime * 0.05) * curlStrength * uDt;

  // Coherent rotation, strongest on the shell.
  float shellW = exp(-abs(l - uRadius) / (uRadius * 0.5));
  vel += normalize(cross(uAxis, rel / l) + vec3(1e-6)) * 300.0 * shellW * uDt;

  // Wake: the moving window sheds dust opposite its direction of travel.
  float wakeW = exp(-max(0.0, l - uRadius * 1.2) / uRadius);
  vel += -uOwnVel * 0.9 * wakeW * uDt;

  // Counter-rotation inside the other windows' spheres.
  for (int i = 0; i < ${MAX_OTHERS}; i++){
    if (i >= uOtherCount) break;
    vec3 rel2 = pos - uOthers[i];
    float l2 = length(rel2) + 1e-5;
    float w2 = exp(-abs(l2 - uOtherInner[i]) / (uOtherInner[i] + 1.0));
    vel += normalize(cross(-uAxis, rel2 / l2) + vec3(1e-6)) * 300.0 * w2 * uDt;
  }

  vel *= exp(-2.2 * uDt);
  float cap = 340.0 + speed;
  float sp = length(vel);
  if (sp > cap) vel *= cap / sp;

  gl_FragColor = vec4(vel, 1.0);
}
`;

const POSITION_SHADER = /* glsl */`
uniform float uTime;
uniform float uDt;
uniform vec3 uOwn;
uniform float uRadius;
uniform float uRecycleRadius;
uniform vec3 uOthers[${MAX_OTHERS}];
uniform float uOtherInner[${MAX_OTHERS}];
uniform int uOtherCount;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posRole = texture2D(texturePosition, uv);
  vec3 pos = posRole.xyz;
  float role = posRole.w;
  vec3 vel = texture2D(textureVelocity, uv).xyz;

  pos += vel * uDt;

  // Conveyor: travelers that reached a far swirl hop back to this side's
  // bridge mouth, keeping the span permanently supplied with dust.
  if (role > 0.65){
    for (int i = 0; i < ${MAX_OTHERS}; i++){
      if (i >= uOtherCount) break;
      vec3 c = uOthers[i];
      if (distance(pos, c) < uOtherInner[i] * 0.8 &&
          hash12(uv + fract(uTime)) < 0.02){
        vec3 dir = normalize(c - uOwn + vec3(1e-3));
        vec3 lat = normalize(vec3(-dir.y, dir.x, 0.35));
        float h1 = hash12(uv * 3.1 + fract(uTime * 0.53));
        float h2 = hash12(uv * 7.7 + fract(uTime * 0.31));
        pos = uOwn
            + dir * uRadius * (0.45 + 0.45 * h1)
            + lat * (h2 - 0.5) * uRadius * 0.9;
      }
    }
  }

  // Recycle strays and numeric blowups, but keep long bridge spans alive.
  if (!(length(pos - uOwn) < uRecycleRadius)){
    float a = hash12(uv + fract(uTime)) * 6.28318;
    float z = hash12(uv.yx + fract(uTime * 0.7)) * 2.0 - 1.0;
    float rr = sqrt(max(0.0, 1.0 - z * z));
    pos = uOwn + vec3(rr * cos(a), rr * sin(a), z) * uRadius;
  }

  gl_FragColor = vec4(pos, role);
}
`;

const RENDER_VERTEX = /* glsl */`
uniform sampler2D texturePosition;
uniform float uDpr;
attribute vec2 ref;
attribute float aRand;
varying float vShade;

void main(){
  vec3 pos = texture2D(texturePosition, ref).xyz;
  vShade = 0.45 + 0.55 * clamp(pos.z / 400.0 + 0.5, 0.0, 1.0);
  gl_PointSize = uDpr * mix(1.0, 2.2, aRand * aRand);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const RENDER_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vShade;

void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * uOpacity * vShade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0) / 4294967295;
}

// Seeded PRNG: every window must spawn identical particles for a given
// system id, or the shared world wouldn't match across windows.
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class ParticleSystem {
  constructor(renderer, scene, { id, color, center, radius }) {
    this.scene = scene;
    this.opacity = 0;

    const h = hashString(String(id));
    const axis = new THREE.Vector3(
      Math.sin(h * 12.9) * 0.7,
      Math.cos(h * 7.3) * 0.7,
      0.9
    ).normalize();

    // --- Simulation ---------------------------------------------------------
    this.gpu = new GPUComputationRenderer(TEX_SIZE, TEX_SIZE, renderer);

    const rand = mulberry32(Math.floor(h * 2 ** 31));
    const posTex = this.gpu.createTexture();
    const velTex = this.gpu.createTexture();
    const pArr = posTex.image.data;
    const vArr = velTex.image.data;
    for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
      const a = rand() * Math.PI * 2;
      const z = rand() * 2 - 1;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      const r = radius * (0.9 + rand() * 0.2);
      pArr[i * 4] = center[0] + rr * Math.cos(a) * r;
      pArr[i * 4 + 1] = center[1] + rr * Math.sin(a) * r;
      pArr[i * 4 + 2] = z * r;
      pArr[i * 4 + 3] = rand(); // role: > 0.65 becomes a bridge traveler
      vArr[i * 4] = (rand() - 0.5) * 20;
      vArr[i * 4 + 1] = (rand() - 0.5) * 20;
      vArr[i * 4 + 2] = (rand() - 0.5) * 20;
      vArr[i * 4 + 3] = 1;
    }

    this.posVar = this.gpu.addVariable('texturePosition', POSITION_SHADER, posTex);
    this.velVar = this.gpu.addVariable('textureVelocity', VELOCITY_SHADER, velTex);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    const others = new Array(MAX_OTHERS).fill().map(() => new THREE.Vector3());
    const inner = new Float32Array(MAX_OTHERS);
    this.velUniforms = this.velVar.material.uniforms;
    Object.assign(this.velUniforms, {
      uTime: { value: 0 },
      uDt: { value: 0 },
      uOwn: { value: new THREE.Vector3(...center) },
      uRadius: { value: radius },
      uOthers: { value: others },
      uOtherInner: { value: inner },
      uOtherCount: { value: 0 },
      uAxis: { value: axis },
      uSeed: { value: h * 100 },
      uOwnVel: { value: new THREE.Vector3() },
      uKick: { value: 0 }
    });
    this.posUniforms = this.posVar.material.uniforms;
    Object.assign(this.posUniforms, {
      uTime: { value: 0 },
      uDt: { value: 0 },
      uOwn: { value: new THREE.Vector3(...center) },
      uRadius: { value: radius },
      uRecycleRadius: { value: radius * 8 },
      uOthers: { value: new Array(MAX_OTHERS).fill().map(() => new THREE.Vector3()) },
      uOtherInner: { value: new Float32Array(MAX_OTHERS) },
      uOtherCount: { value: 0 }
    });

    const error = this.gpu.init();
    if (error !== null) console.error('GPUComputationRenderer:', error);

    // --- Rendering ----------------------------------------------------------
    const count = TEX_SIZE * TEX_SIZE;
    const positions = new Float32Array(count * 3); // unused; ref drives position
    const refs = new Float32Array(count * 2);
    const rands = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      refs[i * 2] = (i % TEX_SIZE) / TEX_SIZE + 0.5 / TEX_SIZE;
      refs[i * 2 + 1] = Math.floor(i / TEX_SIZE) / TEX_SIZE + 0.5 / TEX_SIZE;
      rands[i] = rand();
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
    this.geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));

    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      uniforms: {
        texturePosition: { value: null },
        uDpr: { value: window.devicePixelRatio || 1 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 }
      },
      vertexShader: RENDER_VERTEX,
      fragmentShader: RENDER_FRAGMENT
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Own sphere in local pixel coords. */
  setModel(center, radius) {
    this.velUniforms.uOwn.value.set(...center);
    this.velUniforms.uRadius.value = radius;
    this.posUniforms.uOwn.value.set(...center);
    this.posUniforms.uRadius.value = radius;
  }

  /** This window's motion: center velocity (px/s) and acceleration kick. */
  setMotion(vx, vy, kick) {
    this.velUniforms.uOwnVel.value.set(vx, vy, 0);
    this.velUniforms.uKick.value = kick;
  }

  /** The other windows' spheres: [{ center, radius }] */
  setOthers(others) {
    const n = Math.min(others.length, MAX_OTHERS);
    const own = this.posUniforms.uOwn.value;
    const ownRadius = this.posUniforms.uRadius.value;
    let recycleRadius = ownRadius * 8;

    for (let i = 0; i < n; i++) {
      this.velUniforms.uOthers.value[i].set(...others[i].center);
      this.velUniforms.uOtherInner.value[i] = others[i].radius * 0.35;
      this.posUniforms.uOthers.value[i].set(...others[i].center);
      this.posUniforms.uOtherInner.value[i] = others[i].radius * 0.35;

      const [x, y, z] = others[i].center;
      const dx = x - own.x;
      const dy = y - own.y;
      const dz = z - own.z;
      const distanceToOther = Math.sqrt(dx * dx + dy * dy + dz * dz);
      recycleRadius = Math.max(
        recycleRadius,
        distanceToOther + ownRadius + others[i].radius + 420
      );
    }
    this.velUniforms.uOtherCount.value = n;
    this.posUniforms.uOtherCount.value = n;
    this.posUniforms.uRecycleRadius.value = recycleRadius;
  }

  update(dt, time) {
    this.opacity = Math.min(1, this.opacity + dt * 1.5);
    this.material.uniforms.uOpacity.value = this.opacity * 0.75;
    this.material.uniforms.uDpr.value = window.devicePixelRatio || 1;

    this.velUniforms.uTime.value = time;
    this.velUniforms.uDt.value = dt;
    this.posUniforms.uTime.value = time;
    this.posUniforms.uDt.value = dt;

    this.gpu.compute();
    this.material.uniforms.texturePosition.value =
      this.gpu.getCurrentRenderTarget(this.posVar).texture;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    for (const v of [this.posVar, this.velVar]) {
      v.renderTargets.forEach((rt) => rt.dispose());
      v.material.dispose();
    }
  }
}
