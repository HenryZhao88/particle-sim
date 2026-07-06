// shader.vert
// Simple pass-through vertex shader for fullscreen quad

void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
