#version 300 es
// aura-default / aurora: slow, low-contrast aurora bands drifting over a dark navy ground.
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
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = vec2(uv.x * (res.x / res.y), uv.y);
  float t = u_time * (6.2831853 / PERIOD);

  // Very light parallax from the pointer / stick (no-op when the UI leaves it at zero).
  vec2 m = u_mouse / res - 0.5;
  p += m * 0.04;

  vec3 accent = dot(u_accent, u_accent) > 0.001 ? u_accent : vec3(0.43, 0.91, 1.0);
  vec3 violet = mix(accent, vec3(0.49, 0.42, 1.0), 0.65);

  // Ground: dark navy, a touch lighter towards the top.
  vec3 col = GROUND + vec3(0.008, 0.012, 0.028) * uv.y;

  // Aurora: three soft ridges whose height drifts with slow noise.
  float warp = fbm(vec2(p.x * 0.9 + t * 0.35, p.y * 0.6 - t * 0.12)) - 0.5;
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.58 + 0.11 * fi
      + 0.10 * sin(p.x * (1.3 + 0.4 * fi) + t * (1.0 + 0.3 * fi) + fi * 2.1)
      + warp * 0.35;
    float d = abs(p.y - y);
    band += (1.0 - smoothstep(0.0, 0.22, d)) * (0.55 - 0.12 * fi);
  }
  float grain = fbm(vec2(p.x * 3.0 - t * 0.5, p.y * 2.0 + t * 0.2));
  band *= 0.6 + 0.4 * grain;

  vec3 aurora = mix(accent, violet, smoothstep(0.3, 0.9, uv.y + 0.15 * sin(t)));
  col += aurora * band * 0.22;

  // Vignette, then a 1-LSB dither so the dark ground does not band.
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * 0.55;
  col += (hash21(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
