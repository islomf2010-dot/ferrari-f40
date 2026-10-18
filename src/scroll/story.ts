/**
 * THE STORY TIMELINE — single source of truth for the whole experience.
 *
 * One continuous choreography authored in "story time" (0 → 1). Scroll maps
 * linearly onto story time and the height of every DOM section is derived from
 * the same numbers, so copy and 3D can never drift apart.
 *
 * ── Measured model space (scripts/inspect-model.mjs, not guessed) ────────────
 *      +X right      +Y up      +Z = FRONT of the car
 *      4.515 long × 2.127 wide × 1.122 high   (≈ metres, ground at y = 0)
 *      front axle z ≈ +1.14   rear axle z ≈ −1.32   wing z ≈ −2.19
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Authoring conventions used below
 *
 *   camTheta    world azimuth of the camera, degrees from +Z toward +X
 *   camRadius   horizontal distance from the origin
 *   carRotY     car yaw in degrees; +Z of the car points at azimuth `carRotY`
 *   rel angle   `camTheta − carRotY` — 0° dead ahead of the nose,
 *               90° flank, 180° dead astern, 270° opposite flank
 *   target*     look-at point in CAR-LOCAL space, so the camera keeps its
 *               framing on the featured detail while the car turns
 *   keyOffset   key-light azimuth relative to the camera; rim / fill / accent
 *               lights are derived from the camera azimuth in Studio.tsx
 *
 * The choreography is verified by `npm run verify`, which samples the spline
 * and asserts camera clearance, monotone motion and shot framing.
 */

import { MonotoneTrack, Track } from './track.ts';

export type SceneId = 1 | 2 | 3 | 4 | 5 | 6;

export interface SceneMeta {
  id: SceneId;
  index: string;
  kicker: string;
  /** Share of the scrollable page. */
  span: number;
}

export const SCENES: SceneMeta[] = [
  { id: 1, index: '01', kicker: 'The Legend', span: 0.15 },
  { id: 2, index: '02', kicker: 'The Silhouette', span: 0.185 },
  { id: 3, index: '03', kicker: 'Engineered For Speed', span: 0.225 },
  { id: 4, index: '04', kicker: 'Form Follows Function', span: 0.19 },
  { id: 5, index: '05', kicker: 'The Legacy', span: 0.1 },
  { id: 6, index: '06', kicker: 'Final Reveal', span: 0.15 },
];

/** Scrollable distance of the page, in viewport heights. */
export const SCROLL_VH = 900;

export const SCENE_START = (() => {
  const out = {} as Record<SceneId, number>;
  let cursor = 0;
  for (const s of SCENES) {
    out[s.id] = cursor;
    cursor += s.span;
  }
  return out;
})();

export const SCENE_END = (() => {
  const out = {} as Record<SceneId, number>;
  for (const s of SCENES) out[s.id] = SCENE_START[s.id] + s.span;
  return out;
})();

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export const CH = {
  camTheta: 0,
  camRadius: 1,
  camY: 2,
  tgtX: 3,
  tgtY: 4,
  tgtZ: 5,
  fov: 6,
  carLift: 7,
  carRotY: 8,
  carScale: 9,
  keyOffset: 10,
  keyElev: 11,
  keyDist: 12,
  keyIntensity: 13,
  keyWarmth: 14,
  rimIntensity: 15,
  fillIntensity: 16,
  accentIntensity: 17,
  envIntensity: 18,
  reveal: 19,
  grade: 20,
  vignette: 21,
  ambient: 22,
  groundFade: 23,
  /** Camera dolly along its own right axis: pushes the car out of the copy's half. */
  frameOffset: 24,
} as const;

export const CHANNEL_COUNT = 25;

type Pose = number[];

interface Key {
  t: number;
  note: string;
  v: Pose;
}

/**
 * Every key is [camTheta, camRadius, camY, tgtX, tgtY, tgtZ, fov,
 *               carLift, carRotY, carScale,
 *               keyOffset, keyElev, keyDist, keyIntensity, keyWarmth,
 *               rimIntensity, fillIntensity, accentIntensity, envIntensity,
 *               reveal, grade, vignette, ambient, groundFade, frameOffset]
 */
const KEYS: Key[] = [
  // ───────────────────────────── SCENE 01 · THE LEGEND ──────────────────────
  {
    t: 0.0,
    note: 'sealed in the dark, car a silhouette',
    v: [6, 10.8, 1.7, 0, 1.34, 0.0, 26, 0, 0, 1, -46, 34, 8.2, 0.55, 0.9, 2.2, 0.06, 0.14, 0.42, 0.06, 0.2, 1.0, 0.1, 0.12, 0],
  },
  {
    t: 0.055,
    note: 'materialise sweep crosses the tail, key ignites',
    v: [17, 8.6, 1.24, 0, 0.82, 0.4, 27, 0, 0, 1, -44, 36, 7.6, 1.5, 0.82, 1.6, 0.12, 0.1, 0.7, 0.72, 0.3, 0.92, 0.16, 0.34, 0.05],
  },
  {
    t: 0.105,
    note: 'slow push toward the nose, red studio wash',
    v: [26, 7.1, 0.72, 0, 0.58, 1.0, 29, 0, -6, 1, -40, 32, 7.0, 2.6, 0.74, 2.0, 0.2, 0.16, 0.92, 1, 0.4, 0.84, 0.2, 0.66, 0.2],
  },
  {
    t: 0.155,
    note: 'low front three-quarter — title hands over to Scene 02',
    v: [32, 6.1, 0.5, 0, 0.52, 1.3, 31, 0, -14, 1, -38, 28, 6.6, 3.0, 0.68, 2.5, 0.24, 0.2, 1.05, 1, 0.46, 0.78, 0.24, 0.82, 0.3],
  },

  // ────────────────────────── SCENE 02 · THE SILHOUETTE ─────────────────────
  {
    t: 0.215,
    note: 'rotation opens the flank, rim light traces the shoulder line',
    v: [42, 6.0, 0.66, 0, 0.6, 0.7, 33, 0, -26, 1, -46, 34, 6.4, 2.9, 0.62, 2.7, 0.24, 0.2, 1.08, 1, 0.5, 0.74, 0.26, 0.92, -0.42],
  },
  {
    t: 0.28,
    note: 'over the roofline, canopy and screen',
    v: [56, 5.4, 1.38, 0, 0.68, 0.1, 34, 0.02, -42, 1, -54, 42, 6.0, 1.9, 0.62, 2.3, 0.18, 0.12, 0.95, 1, 0.46, 0.72, 0.3, 0.95, -0.4],
  },
  {
    t: 0.345,
    note: 'slides onto the rear quarter',
    v: [70, 5.6, 1.05, 0, 0.62, -0.5, 34, 0.02, -58, 1, -58, 36, 6.2, 2.1, 0.58, 2.2, 0.18, 0.12, 0.98, 1, 0.46, 0.68, 0.32, 0.92, -0.28],
  },

  // ─────────────────────── SCENE 03 · ENGINEERED FOR SPEED ──────────────────
  {
    t: 0.405,
    note: 'rear three-quarter, engine deck and louvres enter frame',
    v: [76, 6.3, 0.88, 0, 0.68, -1.05, 30, 0.01, -72, 1, -44, 30, 6.0, 2.7, 0.54, 2.4, 0.18, 0.2, 0.95, 1, 0.48, 0.64, 0.34, 0.86, 0.3],
  },
  {
    t: 0.4625,
    note: 'push in on the rear deck, red practical ignites',
    v: [88, 5.3, 0.74, 0, 0.74, -1.5, 27, 0.0, -86, 1, -32, 24, 5.4, 3.1, 0.5, 2.5, 0.16, 0.3, 0.9, 1, 0.5, 0.6, 0.34, 0.78, 0.46],
  },
  {
    t: 0.5225,
    note: 'circle the tail, aerofoil catches the key',
    v: [100, 5.0, 1.06, 0, 0.78, -1.2, 30, 0.0, -101, 1, -34, 30, 5.6, 2.9, 0.48, 2.4, 0.16, 0.24, 0.88, 1, 0.5, 0.58, 0.34, 0.74, 0.48],
  },
  {
    t: 0.575,
    note: 'rising over the flank',
    v: [108, 4.9, 1.3, 0, 0.72, -0.45, 34, 0.0, -112, 1, -48, 34, 6.0, 2.5, 0.46, 2.2, 0.18, 0.16, 0.92, 1, 0.5, 0.56, 0.34, 0.8, 0.42],
  },

  // ────────────────────── SCENE 04 · FORM FOLLOWS FUNCTION ───────────────────
  {
    t: 0.635,
    note: 'drop to hub height, low dolly along the sill',
    v: [110, 3.5, 0.34, 0, 0.3, -1.3, 30, 0, -128, 1, -66, 16, 5.0, 2.2, 0.52, 2.0, 0.2, 0.1, 0.96, 1, 0.5, 0.52, 0.32, 0.9, -0.3],
  },
  {
    t: 0.69,
    note: 'side intake at panel height',
    v: [110, 3.9, 0.32, 0, 0.42, -0.35, 32, 0, -138, 1, -70, 14, 5.0, 2.0, 0.58, 2.1, 0.2, 0.12, 0.98, 1, 0.5, 0.5, 0.32, 0.92, -0.42],
  },
  {
    t: 0.745,
    note: 'rear haunch, intakes and diffuser line',
    v: [110, 4.9, 0.6, 0, 0.58, -1.55, 32, 0, -148, 1, -62, 22, 5.6, 2.2, 0.6, 2.2, 0.2, 0.14, 1.0, 1, 0.5, 0.5, 0.34, 0.9, -0.38],
  },
  {
    t: 0.775,
    note: 'high behind the tail, hands over to Scene 05',
    v: [112, 5.6, 1.18, 0, 0.72, -1.35, 34, 0, -154, 1, -52, 32, 6.4, 2.4, 0.62, 2.3, 0.22, 0.16, 1.0, 1, 0.52, 0.48, 0.34, 0.86, -0.2],
  },

  // ───────────────────────── SCENE 05 · THE LEGACY ─────────────────────────
  {
    t: 0.83,
    note: 'swing wide to the far front quarter, grade opens up',
    v: [122, 7.0, 1.0, 0, 0.6, 0.4, 32, 0, -166, 1, -44, 38, 7.2, 2.6, 0.52, 2.4, 0.26, 0.14, 1.12, 1, 0.62, 0.38, 0.4, 0.82, 0.5],
  },
  {
    t: 0.885,
    note: 'the car squares up to camera',
    v: [124, 7.6, 0.8, 0, 0.58, 0.95, 30, 0, -176, 1, -38, 40, 7.8, 2.9, 0.46, 2.4, 0.28, 0.12, 1.18, 1, 0.7, 0.32, 0.44, 0.78, 0.34],
  },

  // ──────────────────────── SCENE 06 · FINAL REVEAL ─────────────────────────
  {
    t: 0.945,
    note: 'pull back to the hero frame, rotation slows',
    v: [130, 7.8, 2.0, 0, 0.9, 0.0, 29, 0, -186, 1, -33, 46, 8.6, 3.2, 0.42, 2.3, 0.3, 0.1, 1.24, 1, 0.76, 0.26, 0.48, 0.74, 0],
  },
  {
    t: 1.0,
    note: 'settle — final hero pose',
    v: [134, 8.6, 1.78, 0, 1.3, 0.0, 27, 0, -196, 1, -31, 48, 9.0, 3.4, 0.4, 2.2, 0.32, 0.1, 1.28, 1, 0.78, 0.22, 0.5, 0.72, 0],
  },
];

export const POSE_TRACK = new Track(
  KEYS.map((k) => ({ t: k.t, v: k.v })),
  // Slightly under classic Catmull-Rom: hugs the keys and avoids overshoot.
  0.82,
  // The experience begins and ends at rest — this also kills the tail
  // overshoot Catmull-Rom otherwise produces after a decelerating run of keys.
  [0, 1],
);

/** Camera clearance never drops below this horizontal distance from the car shell. */
export const MIN_CLEARANCE = 0.55;

// ---------------------------------------------------------------------------
// Monotone ramps — used for values that must settle instead of overshoot.
// ---------------------------------------------------------------------------

/**
 * Scene 01 materialise sweep: 0 = fully dissolved, 1 = fully solid.
 *
 * It does not start at zero. A completely empty frame reads as a broken page
 * rather than as a held breath, so the tail is already present and the sweep
 * simply completes the car.
 */
export const REVEAL_RAMP = new MonotoneTrack([
  { t: 0.0, v: 0.055 },
  { t: 0.012, v: 0.055 },
  { t: 0.105, v: 1 },
  { t: 1.0, v: 1 },
]);

/** Which scene a given story time belongs to. */
export function sceneAt(t: number): SceneMeta {
  for (let i = SCENES.length - 1; i >= 0; i--) {
    if (t >= SCENE_START[SCENES[i].id]) return SCENES[i];
  }
  return SCENES[0];
}

export const DEG = Math.PI / 180;

export interface Hotspot {
  id: string;
  /** Car-local anchor. */
  at: readonly [number, number, number];
  /**
   * Outward direction in car-local XZ, used to decide whether the detail is
   * turned toward the camera. Defaults to the anchor's own radial direction,
   * which only needs an override for centreline parts like the wing.
   */
  out?: readonly [number, number];
  label: string;
  spec: string;
  body: string;
}

/**
 * Anchors are placed on geometry that genuinely exists in the source model —
 * no invented parts, no exploded diagrams. Coordinates were read off the
 * measured part bounds in scripts/inspect-model.mjs.
 *
 * Scene 04 puts the viewer on the car's left flank, travelling from the tail
 * toward the door, so the interactive set is biased to the −X side. Scene 03's
 * callouts pick up the centreline parts.
 */
export const HOTSPOTS: Hotspot[] = [
  {
    id: 'aerofoil',
    at: [0.0, 0.9, -2.16],
    out: [0, -1],
    label: 'Rear Aerofoil',
    spec: 'Strut-mounted wing',
    body: 'The wing stands clear of the engine cover on two struts: enough downforce to settle the tail at speed, enough gap to keep feeding the rear radiators.',
  },
  {
    id: 'deck',
    at: [0.0, 0.96, -1.3],
    out: [0, -1],
    label: 'Engine Deck',
    spec: 'Louvred cover',
    body: 'The louvred panel sits directly over the 2.9-litre twin-turbocharged V8, letting the heat from two turbos and five exhaust runners leave the bay.',
  },
  {
    id: 'lightbar',
    at: [0.52, 0.56, -2.14],
    label: 'Rear Light Cluster',
    spec: 'Full-width band',
    body: 'One continuous band of lamps spans the tail — the same full-width treatment the F40 carried across the body itself.',
  },
  {
    id: 'quarter',
    at: [-0.94, 0.55, -0.96],
    label: 'Rear Quarter Intake',
    spec: 'Radiator feed',
    body: 'Ahead of the rear wheel, the flank opens into a deep scoop that pulls air into the side radiators rather than letting it pass.',
  },
  {
    id: 'rearwheel',
    at: [-0.92, 0.34, -1.42],
    label: 'Rear Wheel & Brake',
    spec: '245 / 35 R15',
    body: 'Fifteen-inch rear wheels, sized for the weight the engine puts through them, with ventilated discs clamped by fixed multi-piston calipers.',
  },
  {
    id: 'doorduct',
    at: [-0.94, 0.58, -0.16],
    label: 'Side Air Intake',
    spec: 'Ducted charge feed',
    body: 'The signature F40 duct, cut into the door skin. It feeds the engine bay and doubles as the surface the whole silhouette is drawn around.',
  },
  {
    id: 'sill',
    at: [-0.96, 0.2, 0.34],
    label: 'Side Sill',
    spec: 'Full-length skirt',
    body: 'A full-length skirt closes the underside and feeds the flat floor — less drag, and a cleaner line where the eye meets the ground.',
  },
];