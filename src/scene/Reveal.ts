import { Color, Vector3, type Material, type Object3D } from 'three';

/**
 * Scene 01 opens on a sealed black frame. Instead of cross-fading opacity
 * (which forces every material into the transparent queue and wrecks sorting),
 * the car *materialises*: fragments ahead of a travelling cut plane are
 * discarded, and the cut itself glows.
 *
 * The cut travels along the car's own forward axis, so the reveal reads the
 * same however the car is turned.
 *
 * Once the sweep has finished, the whole thing is compiled back out. An
 * unconditional `discard` disables early-Z for every fragment of a 700k-triangle
 * model for the remaining 90% of the page — recompiling is worth it.
 */

export const revealUniforms = {
  /** 0 = fully dissolved, 1 = fully solid. */
  uReveal: { value: 1 },
  /** Car-space sweep direction (world-space on the GPU). */
  uSweepDir: { value: new Vector3(0, 0, 1) },
  /** World position the sweep is centred on. */
  uSweepCenter: { value: new Vector3() },
  /** Half-extent of the sweep along its own axis. */
  uSweepHalf: { value: 2.6 },
  /** Colour of the glowing cut edge. */
  uRevealColor: { value: new Color('#ff3b1f') },
  /** Edge softness in normalised sweep units. */
  uSweepSoft: { value: 0.18 },
};

/** Flipped once the sweep is done; triggers exactly one recompile. */
let armed = false;

const VERT_HEAD = /* glsl */ `
varying vec3 vRevealPos;
`;

const VERT_BODY = /* glsl */ `
vRevealPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vRevealPos;
uniform float uReveal;
uniform vec3 uSweepDir;
uniform vec3 uSweepCenter;
uniform float uSweepHalf;
uniform vec3 uRevealColor;
uniform float uSweepSoft;

float revealSweep() {
  return dot(vRevealPos - uSweepCenter, uSweepDir) / max(uSweepHalf, 0.0001) * 0.5 + 0.5;
}
`;

const FRAG_CLIP = /* glsl */ `
float sweep = revealSweep();
float solid = 1.0 - smoothstep(uReveal - uSweepSoft, uReveal, sweep);
if (solid < 0.004) discard;
`;

const FRAG_GLOW = /* glsl */ `
float glow = smoothstep(uReveal - uSweepSoft, uReveal - uSweepSoft * 0.18, sweep)
           * (1.0 - smoothstep(uReveal - uSweepSoft * 0.18, uReveal + uSweepSoft * 0.1, sweep));
// The cut glow is a transition, not a finish: by the time the sweep reaches
// the nose it must have faded out completely, or the front of the car stays
// permanently stained with the reveal colour.
glow *= 1.0 - smoothstep(0.86, 1.0, uReveal);
totalEmissiveRadiance += uRevealColor * glow * 0.8;
`;

const patched = new WeakSet<Material>();

/**
 * Adds the materialise effect to one material. Safe to call repeatedly — the
 * patch is idempotent, which matters because the GLTF shares materials across
 * dozens of meshes.
 */
export function applyRevealPatch(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = revealUniforms.uReveal;
    shader.uniforms.uSweepDir = revealUniforms.uSweepDir;
    shader.uniforms.uSweepCenter = revealUniforms.uSweepCenter;
    shader.uniforms.uSweepHalf = revealUniforms.uSweepHalf;
    shader.uniforms.uRevealColor = revealUniforms.uRevealColor;
    shader.uniforms.uSweepSoft = revealUniforms.uSweepSoft;

    if (armed) {
      // Sweep is finished: compile the plain material, no varying, no discard.
      material.customProgramCacheKey = () => 'f40-plain';
      return;
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_CLIP}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_GLOW}`);

    material.customProgramCacheKey = () => 'f40-reveal';
  };

  material.customProgramCacheKey = () => (armed ? 'f40-plain' : 'f40-reveal');
}

/**
 * Compiles the reveal out of every material under `root`. Called exactly once,
 * the first frame the sweep completes.
 */
export function retireReveal(root: Object3D): void {
  armed = true;
  revealUniforms.uReveal.value = 1;
  root.traverse((node) => {
    const material = (node as { material?: Material | Material[] }).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (patched.has(m)) m.needsUpdate = true;
    }
  });
}

export const revealIsArmed = () => armed;