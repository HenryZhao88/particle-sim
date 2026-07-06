// shader.frag
// Backdrop: deep-space gradient with a breathing vignette and a sparse
// twinkling starfield. The spheres, bridges, and swarm are real particle
// geometry rendered on top (see components/), then bloomed.

precision highp float;

uniform float u_time;
uniform vec2  u_resolution;

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 px = gl_FragCoord.xy;
    vec2 st = px / u_resolution;

    // Deep navy with a soft vignette that slowly breathes.
    float vig = smoothstep(1.25, 0.35, distance(st, vec2(0.5)));
    vig *= 0.92 + 0.08 * sin(u_time * 0.4);
    vec3 color = mix(vec3(0.006, 0.008, 0.022), vec3(0.024, 0.036, 0.075), vig);

    // Starfield: sparse hashed cells, each twinkling at its own rate.
    vec2 cell = floor(px / 3.0);
    float h = hash21(cell);
    if (h > 0.9982) {
        float tw = 0.5 + 0.5 * sin(u_time * (1.0 + h * 6.0) + h * 90.0);
        color += vec3(0.75, 0.82, 1.0) * tw * tw * 0.30;
    }

    // Fine grain hides gradient banding in the dark background.
    color += (hash21(px + fract(u_time)) - 0.5) * 0.010;

    gl_FragColor = vec4(color, 1.0);
}
