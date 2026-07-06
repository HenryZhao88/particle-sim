// shader.frag
// Renders every window's blob (local + peers) plus glowing bridges between
// this window and each peer, over a twinkling starfield. All coordinates are
// device pixels, y-down, in this window's content space — the CPU side maps
// peer screen rects here.

precision highp float;

#define MAX_BLOBS 11
#define FLOATS_PER_BLOB 7

uniform float u_time;
uniform vec2  u_resolution;
uniform int   u_blobCount;                          // includes the local blob at index 0
uniform float u_blobs[MAX_BLOBS * FLOATS_PER_BLOB]; // x, y, radius, strength, r, g, b

vec2 blobPos(int i)    { return vec2(u_blobs[i * 7], u_blobs[i * 7 + 1]); }
float blobRadius(int i){ return u_blobs[i * 7 + 2]; }
vec3 blobColor(int i)  { return vec3(u_blobs[i * 7 + 4], u_blobs[i * 7 + 5], u_blobs[i * 7 + 6]); }

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Distance from p to segment ab, plus normalized position along it.
float segDist(vec2 p, vec2 a, vec2 b, out float t) {
    vec2 ab = b - a;
    t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return distance(p, a + ab * t);
}

void main() {
    // Flip y: gl_FragCoord is bottom-up, our blob coords are top-down.
    vec2 px = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec2 st = px / u_resolution;

    // Background: deep navy with a soft vignette that slowly breathes.
    float vig = smoothstep(1.25, 0.35, distance(st, vec2(0.5)));
    vig *= 0.92 + 0.08 * sin(u_time * 0.4);
    vec3 color = mix(vec3(0.008, 0.010, 0.026), vec3(0.030, 0.045, 0.090), vig);

    // Starfield: sparse hashed cells, each twinkling at its own rate.
    vec2 cell = floor(px / 3.0);
    float h = hash21(cell);
    if (h > 0.9982) {
        float tw = 0.5 + 0.5 * sin(u_time * (1.0 + h * 6.0) + h * 90.0);
        color += vec3(0.75, 0.82, 1.0) * tw * tw * 0.35;
    }

    // Bridges from the local blob (index 0) to each peer.
    vec2 localPos = blobPos(0);
    vec3 localCol = blobColor(0);
    for (int i = 1; i < MAX_BLOBS; i++) {
        if (i >= u_blobCount) break;
        float t;
        float d = segDist(px, localPos, blobPos(i), t);
        vec3 bridgeCol = mix(localCol, blobColor(i), t);

        // Flowing shimmer along the whole bridge.
        float flow = 0.55 + 0.45 * sin(t * 28.0 - u_time * 5.0);
        color += bridgeCol * flow * (smoothstep(2.5, 0.0, d) * 0.85
                                   + smoothstep(24.0, 0.0, d) * 0.14);

        // Bright energy packets racing from window to window.
        float packet = pow(max(0.0, sin(t * 12.566 - u_time * 4.5)), 24.0);
        color += bridgeCol * packet * smoothstep(9.0, 0.0, d) * 1.6;
    }

    // Blobs: wobbling organic edge, bright core, gaussian glow, pulsing rim.
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= u_blobCount) break;
        vec2  pos = blobPos(i);
        vec3  col = blobColor(i);
        float fi  = float(i);
        vec2  dl  = px - pos;
        float d   = length(dl);
        float ang = atan(dl.y, dl.x);

        float R = blobRadius(i);
        R *= 1.0
           + 0.045 * sin(ang * 5.0 + u_time * 1.6 + fi * 2.1)
           + 0.030 * sin(ang * 3.0 - u_time * 2.3 + fi * 4.7)
           + 0.030 * sin(u_time * 2.0 + fi * 1.7);

        float core = 1.0 - smoothstep(R * 0.50, R * 0.72, d);
        float glow = exp(-(d * d) / (R * R * 1.5));
        float rim  = smoothstep(R * 1.03, R * 0.99, d) - smoothstep(R * 0.99, R * 0.94, d);
        float rimPulse = 0.65 + 0.35 * sin(u_time * 3.0 - d * 0.05 + fi);

        color += col * (core * 0.9 + glow * 0.6 + rim * rimPulse * 0.9);
        color += vec3(1.0) * core * glow * 0.3; // hot center
    }

    // Gentle tone map so overlapping glows don't clip harshly.
    color = 1.0 - exp(-color * 1.4);

    // Fine grain hides gradient banding in the dark background.
    color += (hash21(px + fract(u_time)) - 0.5) * 0.012;

    gl_FragColor = vec4(color, 1.0);
}
