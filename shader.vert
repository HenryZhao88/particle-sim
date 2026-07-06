// shader.vert
// Fullscreen quad: geometry is already in NDC (-1..1), so skip the matrices.

void main() {
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
