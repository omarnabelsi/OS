/**
 * WebGL2 canvas that runs a theme's fragment shader as the wallpaper.
 *
 * Theme shaders are GLSL ES 3.00 and receive `u_time`, `u_resolution`, `u_accent` and `u_mouse`
 * (see `themes/aura-default/shaders/aurora.frag`). Everything here fails soft: no WebGL2, a
 * shader that will not compile, or a lost context all end with the canvas hidden, and the
 * background layer underneath - a flat themed colour - carries the screen.
 */

import { useEffect, useRef, useState } from 'react';

/** A fullscreen triangle: cheaper than a quad and needs no index buffer. */
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

/** Retina is lovely; 4K at native resolution is not worth the frame budget for a wallpaper. */
const MAX_PIXEL_RATIO = 1.5;

/** `#6ee7ff` / `rgb(...)` -> [r, g, b] in 0..1, or null when it cannot be read. */
export function parseColor(css: string | null | undefined): [number, number, number] | null {
  if (!css) return null;
  const value = css.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1];
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16) / 255;
    if (digits.length === 3 || digits.length === 4) {
      return [expand(digits[0]!), expand(digits[1]!), expand(digits[2]!)];
    }
    if (digits.length === 6 || digits.length === 8) {
      return [
        expand(digits.slice(0, 2)),
        expand(digits.slice(2, 4)),
        expand(digits.slice(4, 6)),
      ];
    }
    return null;
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb?.[1]) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length < 3) return null;
    const channels = parts.map((p) =>
      p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p) / 255,
    );
    if (channels.some((c) => !Number.isFinite(c))) return null;
    return [channels[0]!, channels[1]!, channels[2]!];
  }

  return null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[aura] shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface ShaderCanvasProps {
  /** GLSL ES 3.00 fragment shader source. */
  source: string;
  /** Accent colour as a CSS string; passed to the shader as `u_accent`. */
  accent?: string | null;
  /** Render a single frame instead of animating. */
  paused?: boolean;
  className?: string;
}

export function ShaderCanvas({
  source,
  accent,
  paused = false,
  className,
}: ShaderCanvasProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  // Read through refs so changing the accent or pausing never rebuilds the GL program.
  const accentRef = useRef(accent);
  accentRef.current = accent;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, source);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (!vertex || !fragment || !program) {
      setFailed(true);
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[aura] shader program failed to link:', gl.getProgramInfoLog(program));
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uAccent = gl.getUniformLocation(program, 'u_accent');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');

    const mouse = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      mouse.x = event.clientX;
      mouse.y = window.innerHeight - event.clientY; // GL origin is bottom-left
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    let frame = 0;
    let lost = false;
    const start = performance.now();

    const draw = () => {
      if (lost) return;
      resize();
      const seconds = (performance.now() - start) / 1000;
      const rgb = parseColor(accentRef.current) ?? [0, 0, 0];

      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform3f(uAccent, rgb[0], rgb[1], rgb[2]);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!pausedRef.current) frame = requestAnimationFrame(draw);
    };

    // Repaint once when un-pausing (reduced motion still deserves a rendered frame).
    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [source]);

  // Restart the loop when motion is re-enabled.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  if (failed) return null;
  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
