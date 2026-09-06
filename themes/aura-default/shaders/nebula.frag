#version 300 es
// aura-default / nebula: slow, accent-tinted clouds with sparse faint stars on a dark ground.
// GLSL ES 3.00 (WebGL2). Uniforms are set by the UI background layer every frame.
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_accent;
uniform vec2 u_mouse;

out vec4 fragColor;

const float PERIOD = 20.0;
const vec3 GROUND = vec3(0.027, 0.031, 0.047);

// Cheap 2D hash -> [0, 1).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Smooth value noise built on the hash.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p = rot * p * 2.02 + vec2(3.1, 1.7);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float t = u_time * (6.2831853 / PERIOD);

  // Very light parallax from the pointer / stick (no-op when the UI leaves it at zero).
  vec2 m = u_mouse / res - 0.5;
  p -= m * 0.03;

  vec3 accent = dot(u_accent, u_accent) > 0.001 ? u_accent : vec3(0.43, 0.91, 1.0);
  vec3 violet = mix(accent, vec3(0.62, 0.36, 0.95), 0.7);

  // Domain-warped fbm: q bends the lookup, n is the cloud density.
  vec2 drift = vec2(0.25 * sin(t), 0.18 * cos(t * 0.7));
  vec2 q = vec2(
    fbm(p * 1.4 + vec2(0.0, 0.1) * t * 0.6),
    fbm(p * 1.4 + vec2(5.2, 1.3) - vec2(0.1, 0.0) * t * 0.6)
  );
  float n = fbm(p * 1.8 + 1.4 * (q - 0.5) + drift);
  float cloud = smoothstep(0.38, 0.82, n);
  float wisps = smoothstep(0.52, 0.78, fbm(p * 3.4 - q * 0.8 + vec2(t * 0.15, 0.0)));

  vec3 col = GROUND;
  col += mix(violet, accent, q.x) * cloud * 0.16;
  col += accent * wisps * 0.05;

  // Sparse stars: roughly one per 400 3px cells, twinkling gently, dimmed behind cloud.
  vec2 cell = floor(gl_FragCoord.xy / 3.0);
  vec2 f = fract(gl_FragCoord.xy / 3.0) - 0.5;
  float s = hash21(cell + 17.0);
  float star = step(0.9975, s) * (1.0 - smoothstep(0.0, 0.55, length(f)));
  star *= 0.55 + 0.45 * sin(u_time * (0.8 + 2.5 * s) + s * 60.0);
  col += vec3(star) * 0.32 * (1.0 - cloud * 0.6);

  // Vignette, then a 1-LSB dither so the dark ground does not band.
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.6;
  col += (hash21(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
