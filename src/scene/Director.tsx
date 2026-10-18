import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import {
  Color,
  Group,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Vector3,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type SpotLight,
  type Texture,
} from 'three';

import { CH, CHANNEL_COUNT, DEG, POSE_TRACK, REVEAL_RAMP, SCENE_END, SCENE_START, sceneAt } from '../scroll/story.ts';
import { damp } from '../scroll/track.ts';
import { QualityGovernor, type QualityTier } from '../lib/quality.ts';
import { retireReveal, revealIsArmed, revealUniforms } from './Reveal.ts';
import { scroll } from './stage.ts';
import type { CarMetrics } from './prepareCar.ts';

/**
 * Everything the Director needs to drive, registered by the scene components
 * as they mount. A single module-level registry keeps the render loop free of
 * React and guarantees exactly one writer per property.
 */
export interface StageHandles {
  car: Group | null;
  metrics: CarMetrics | null;
  key: SpotLight | null;
  rim: SpotLight | null;
  fill: SpotLight | null;
  accent: PointLight | null;
  ambient: Object3D | null;
  floorMaterial: MeshStandardMaterial | null;
  ringMaterials: (MeshBasicMaterial | null)[];
  env: Texture | null;
}

export const stage: StageHandles = {
  car: null,
  metrics: null,
  key: null,
  rim: null,
  fill: null,
  accent: null,
  ambient: null,
  floorMaterial: null,
  ringMaterials: [],
  env: null,
};

const sample = new Float32Array(CHANNEL_COUNT);
const read = (channel: number) => POSE_TRACK.sample(scroll.t, channel, sample);

const UP = new Vector3(0, 1, 0);
const _camPos = new Vector3();
const _target = new Vector3();
const _forward = new Vector3();
const _view = new Vector3();
const _right = new Vector3();
const _keyColor = new Color();
const _WHITE = new Color('#fff4e8');
const _KEY_RED = new Color('#ff2c14');
const _RIM_COLOR = new Color('#cfdfff');
const _ACCENT_COLOR = new Color('#ff1c08');

/** Pointer parallax target, written by the stage shell. Never React state. */
export const pointer = { targetX: 0, targetY: 0, x: 0, y: 0 };

export function setPointer(nx: number, ny: number): void {
  pointer.targetX = MathUtils.clamp(nx, -1, 1);
  pointer.targetY = MathUtils.clamp(ny, -1, 1);
}

let envIntensity = 0.4;

/**
 * Places a light on an orbit around the car.
 *
 * Azimuths are expressed relative to the *camera*, so the rig follows the
 * subject the way a photographer's softboxes follow a car on a turntable:
 * whatever angle the viewer is at, there is a key on the near flank and a rim
 * behind the silhouette.
 */
function orbitLight(target: Object3D, azimuthDeg: number, elevationDeg: number, distance: number, height: number): void {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const planar = Math.cos(el) * distance;
  target.position.set(Math.sin(az) * planar, height + Math.sin(el) * distance, Math.cos(az) * planar);
  target.lookAt(0, height * 0.55, 0);
}

export interface DirectorProps {
  quality: QualityTier;
  onQualityChange: (tier: QualityTier) => void;
  reducedMotion: boolean;
  onSceneChange?: (id: number) => void;
}

export function Director({ quality, onQualityChange, reducedMotion, onSceneChange }: DirectorProps) {
  const { camera, gl, scene } = useThree();

  // Inspection handle for the console and for the capture/diagnostic scripts.
  // Gated on dev builds or an explicit ?debug flag so it never ships by default.
  useEffect(() => {
    if (!import.meta.env.DEV && !new URLSearchParams(window.location.search).has('debug')) return;
    (window as unknown as Record<string, unknown>).__F40 = { scene, camera, gl, stage, scroll, revealUniforms };
  }, [scene, camera, gl]);

  const governor = useRef<QualityGovernor | null>(null);
  if (!governor.current) governor.current = new QualityGovernor(quality, onQualityChange);

  const lastScene = useRef(0);
  const exposure = useRef(0.2);

  useEffect(() => {
    governor.current = new QualityGovernor(quality, onQualityChange);
  }, [quality, onQualityChange]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    governor.current?.sample(delta);

    // ── Story time ───────────────────────────────────────────────────────
    // ScrollTrigger smooths through GSAP's scrub; this second damp absorbs
    // keyboard and trackpad jumps without adding lag to a normal wheel scroll.
    const previous = scroll.t;
    scroll.t = reducedMotion ? scroll.target : damp(scroll.t, scroll.target, 14, dt);
    scroll.velocity = dt > 0 ? (scroll.t - previous) / dt : 0;
    const t = scroll.t;

    // Pointer parallax, heavily damped so it reads as breath rather than drag.
    pointer.x = damp(pointer.x, pointer.targetX, 3.5, dt);
    pointer.y = damp(pointer.y, pointer.targetY, 3.5, dt);

    // ── Camera ───────────────────────────────────────────────────────────
    const theta = read(CH.camTheta) * DEG;
    const radius = read(CH.camRadius);
    _camPos.set(Math.sin(theta) * radius, read(CH.camY), Math.cos(theta) * radius);

    const car = stage.car;
    if (car) {
      // Look-at points are authored in car space, so framing follows the part
      // being described rather than the car's current heading.
      _target.set(read(CH.tgtX), read(CH.tgtY), read(CH.tgtZ));
      _target.applyQuaternion(car.quaternion).add(car.position);
      if (!reducedMotion) {
        _target.x += pointer.x * 0.07;
        _target.y += pointer.y * 0.05;
      }
    } else {
      _target.set(0, 0.55, 0);
    }

    // Composition offset: dolly the camera along its own right axis so the car
    // sits in the half of the frame the copy is not using. Purely lateral, so
    // it never changes the angle on the subject.
    const offset = read(CH.frameOffset);
    if (Math.abs(offset) > 0.001) {
      _view.copy(_target).sub(_camPos).normalize();
      _right.crossVectors(_view, UP).normalize();
      _camPos.addScaledVector(_right, offset);
    }

    const cam = camera as PerspectiveCamera;
    cam.position.copy(_camPos);
    cam.up.copy(UP);
    cam.lookAt(_target);
    const fov = read(CH.fov);
    if (Math.abs(cam.fov - fov) > 0.002) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // ── Car ──────────────────────────────────────────────────────────────
    const yaw = read(CH.carRotY) * DEG;
    if (car) {
      car.position.y = read(CH.carLift);
      car.rotation.y = yaw;
      const scale = read(CH.carScale);
      if (Math.abs(car.scale.x - scale) > 1e-6) car.scale.setScalar(scale);
      car.updateMatrixWorld();
    }

    // Angle the viewer sits at, measured from the car's own nose. Every light
    // placement below is relative to it.
    const camAz = theta - yaw;
    const camAzDeg = (camAz * 180) / Math.PI;

    // ── Light rig ────────────────────────────────────────────────────────
    const key = stage.key;
    if (key) {
      orbitLight(key, camAzDeg + read(CH.keyOffset), read(CH.keyElev), read(CH.keyDist), 0.55);
      _keyColor.copy(_WHITE).lerp(_KEY_RED, MathUtils.clamp(read(CH.keyWarmth), 0, 1) * 0.32);
      key.color.copy(_keyColor);
      key.intensity = read(CH.keyIntensity) * 19;
    }

    const rim = stage.rim;
    if (rim) {
      orbitLight(rim, camAzDeg + 152, 22, 9, 0.95);
      rim.color.copy(_RIM_COLOR);
      rim.intensity = read(CH.rimIntensity) * 11;
    }

    const fill = stage.fill;
    if (fill) {
      orbitLight(fill, camAzDeg + 74, 8, 10.5, 0.5);
      fill.intensity = read(CH.fillIntensity) * 9;
    }

    const accent = stage.accent;
    if (accent) {
      orbitLight(accent, camAzDeg + 124, 3.5, 4.6, 0.4);
      accent.color.copy(_ACCENT_COLOR);
      accent.intensity = read(CH.accentIntensity) * 15;
    }

    const ambient = stage.ambient as { intensity?: number } | null;
    if (ambient) ambient.intensity = read(CH.ambient) * 1.6;

    // ── Floor ────────────────────────────────────────────────────────────
    const floor = stage.floorMaterial;
    if (floor) {
      const fade = read(CH.groundFade);
      floor.opacity = 0.28 + fade * 0.72;
      floor.color.setRGB(0.0055 + fade * 0.006, 0.006 + fade * 0.0065, 0.0075 + fade * 0.01);
      // The floor is a large flat mirror: even a modest environment term
      // smears the soft-boxes across the whole lower half of the frame.
      floor.envMapIntensity = 0.1 + fade * 0.22;
      floor.roughness = 0.52 - fade * 0.16;
      for (const ring of stage.ringMaterials) {
        if (!ring) continue;
        ring.opacity = (ring === stage.ringMaterials[0] ? 0.09 : 0.05) * (0.2 + fade * 0.8);
      }
    }

    // ── Environment + tone mapping ───────────────────────────────────────
    envIntensity = damp(envIntensity, read(CH.envIntensity), 6, dt);
    scene.environmentIntensity = envIntensity;
    exposure.current = damp(exposure.current, 0.34 + read(CH.grade) * 0.82, 6, dt);
    gl.toneMappingExposure = exposure.current;

    // ── Materialise sweep ─────────────────────────────────────────────────
    if (reducedMotion) {
      revealUniforms.uReveal.value = 1;
      if (car && !revealIsArmed()) retireReveal(car);
    } else if (revealIsArmed()) {
      // Already retired; nothing left to do.
    } else {
      revealUniforms.uReveal.value = REVEAL_RAMP.at(t);
      if (car) {
        _forward.set(0, 0, 1).applyQuaternion(car.quaternion).normalize();
        revealUniforms.uSweepDir.value.copy(_forward);
        revealUniforms.uSweepCenter.value.copy(car.position);
        revealUniforms.uSweepHalf.value = (stage.metrics?.halfLength ?? 2.2) * 1.08;
        // Compile the discard away the moment the sweep lands.
        if (revealUniforms.uReveal.value >= 0.999) retireReveal(car);
      }
    }

    // ── Page signals ─────────────────────────────────────────────────────
    scroll.ready = true;
    scroll.frame = (scroll.frame + 1) | 0;
    const sceneId = sceneAt(t).id;
    if (sceneId !== lastScene.current) {
      lastScene.current = sceneId;
      onSceneChange?.(sceneId);
    }
  }, -1);

  return null;
}

/** Master opacity for the interactive markers; the geometry does the rest. */
export function hotspotOpacity(t: number): number {
  const inRange = MathUtils.smoothstep(t, SCENE_START[3] - 0.005, SCENE_START[3] + 0.035);
  const outRange = 1 - MathUtils.smoothstep(t, SCENE_END[4] - 0.035, SCENE_END[4] + 0.005);
  return Math.min(inRange, outRange);
}


