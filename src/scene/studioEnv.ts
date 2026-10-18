import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  Texture,
  type WebGLRenderer,
} from 'three';

/**
 * A procedural HDR studio, generated at runtime.
 *
 * The page has to work with no network and no binary asset beyond the model,
 * so the reflection environment is built as a small equirectangular float
 * buffer: two long soft-box strips, a cool top bounce, a warm floor bounce and
 * a low red kicker.
 *
 * Radiance values go above 1.0 so clear-coated paint picks up real, elongated
 * highlights — but they are kept deliberately modest. These lights drive every
 * reflection in the scene, so a "nice looking" 14.0 soft-box becomes a blown
 * white floor the moment the floor is even slightly metallic.
 */

interface Strip {
  /** Centre in u, 0..1 around the sphere. */
  u: number;
  /** Centre in v, 0 = zenith, 1 = nadir. */
  v: number;
  /** Angular half-width as a fraction of the u axis. */
  su: number;
  /** Angular half-height as a fraction of the v axis. */
  sv: number;
  /** Linear RGB radiance. */
  color: [number, number, number];
  intensity: number;
}

const STRIPS: Strip[] = [
  // Main overhead soft-box — long, so it smears down the flanks of the car.
  { u: 0.18, v: 0.24, su: 0.2, sv: 0.085, color: [1.0, 0.97, 0.93], intensity: 3.6 },
  // Cool vertical strip opposite: separates the silhouette from the black.
  { u: 0.63, v: 0.33, su: 0.05, sv: 0.18, color: [0.72, 0.83, 1.0], intensity: 2.4 },
  // Low warm bounce off the studio floor, front-right.
  { u: 0.86, v: 0.66, su: 0.16, sv: 0.12, color: [1.0, 0.84, 0.66], intensity: 0.42 },
  // Red kicker sitting low behind the subject — the signature F40 highlight.
  { u: 0.42, v: 0.71, su: 0.22, sv: 0.085, color: [1.0, 0.12, 0.06], intensity: 0.5 },
  // Faint top fill so the roof never goes fully black.
  { u: 0.4, v: 0.07, su: 0.42, sv: 0.07, color: [0.55, 0.6, 0.72], intensity: 0.3 },
];

const W = 512;
const H = 256;

function wrappedDelta(a: number, b: number): number {
  let d = a - b;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

function buildEquirect(): DataTexture {
  const data = new Float32Array(W * H * 4);

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H; // 0 = zenith, 1 = nadir
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;

      // Base sky/floor gradient, kept deliberately dark.
      const up = 1 - v;
      let r = 0.006 + up * 0.018;
      let g = 0.0065 + up * 0.02;
      let b = 0.009 + up * 0.028;

      // Floor bounce warms as it goes down.
      const down = Math.max(0, v - 0.55) / 0.45;
      r += down * 0.016;
      g += down * 0.009;
      b += down * 0.007;

      for (const s of STRIPS) {
        const du = wrappedDelta(u, s.u) / s.su;
        const dv = (v - s.v) / s.sv;
        // A hard-edged box reflects as a hard box, so soften the falloff.
        const q = du * du + dv * dv;
        if (q > 6) continue;
        const falloff = Math.exp(-q * 0.85);
        const edge = 1 - Math.exp(-q * 2.4);
        const k = falloff * (0.35 + 0.65 * edge) * s.intensity;
        r += s.color[0] * k;
        g += s.color[1] * k;
        b += s.color[2] * k;
      }

      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
  }

  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Prefilters the studio into a PMREM cube so `envMapIntensity` and roughness
 * behave the way a loaded HDRI would.
 */
export function createStudioEnvironment(renderer: WebGLRenderer): Texture {
  const source = buildEquirect();
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  target.texture.name = 'f40-studio-env';
  return target.texture;
}

/** A one-column gradient strip used by the visible backdrop sphere. */
export function createBackdropTexture(): DataTexture {
  const w = 4;
  const h = 256;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // Slightly brighter overhead, falling to near black at the floor line.
    const k = Math.pow(1 - v, 2.6);
    const r = 0.004 + k * 0.026;
    const g = 0.0045 + k * 0.028;
    const b = 0.006 + k * 0.038;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Radial falloff used as the floor's alpha map. Without it the floor ends in a
 * hard horizon line straight across the frame — the single most artificial
 * thing a studio scene can do.
 */
export function createFloorFalloff(inner: number): DataTexture {
  const size = 256;
  const data = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      // Solid under the car, then a long cubic ease to *exactly* zero. Any
      // residual alpha at the rim shows up as a horizon line straight across
      // the frame, which is the one thing a studio scene must never have.
      const a = 1 - Math.pow(Math.max(0, (d - inner) / (1 - inner)), 2.6);
      const i = (y * size + x) * 4;
      data[i] = 1;
      data[i + 1] = 1;
      data[i + 2] = 1;
      data[i + 3] = Math.max(0, Math.min(1, a));
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, FloatType);
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}