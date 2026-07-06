// shader.frag
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform int u_peerCount;
uniform float u_peerPositions[20];  // maxPeers * 2

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution;
    vec2 center = vec2(0.5);
    
    // Base background color
    vec3 color = vec3(0.0);

    // Draw local blob at center
    float dist0 = distance(st, center);
    float blob0 = smoothstep(0.18, 0.2, dist0);
    color = mix(color, vec3(0.2, 0.5, 0.8), blob0);

    // For each peer, draw bridge and peer blob
    for (int i = 0; i < 10; i++) {
        if (i >= u_peerCount) break;
        vec2 peer = vec2(
            u_peerPositions[i * 2],
            u_peerPositions[i * 2 + 1]
        );
        
        // Bridge effect
        vec2 dir = peer - center;
        float len2 = dot(dir, dir);
        if (len2 > 0.0) {
            float t = clamp(dot(st - center, dir) / len2, 0.0, 1.0);
            vec2 proj = center + dir * t;
            float dLine = distance(st, proj);
            float bridge = smoothstep(0.01, 0.0, dLine);
            color = mix(color, vec3(1.0, 0.6, 0.2), bridge);
        }

        // Peer blob
        float dPeer = distance(st, peer);
        float blobPeer = smoothstep(0.018, 0.02, dPeer);
        color = mix(color, vec3(0.8, 0.5, 0.2), blobPeer);
    }

    gl_FragColor = vec4(color, 1.0);
}
