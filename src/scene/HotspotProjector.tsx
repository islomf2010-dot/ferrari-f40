import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';

import { HOTSPOTS } from '../scroll/story.ts';
import { hotspotOpacity, stage } from './Director.tsx';
import { scroll } from './stage.ts';

/**
 * Screen-space markers pinned to real points on the car.
 *
 * Visibility is derived from geometry, not from hard-coded timings: a marker
 * shows when its anchor is genuinely turned toward the camera and the master
 * opacity for Scene 04 allows it. The markers therefore cannot drift out of
 * sync with the camera no matter how the timeline is retimed.
 *
 * The DOM lives outside the Canvas (see ui/Hotspots.tsx); this half only
 * writes `style.transform` for elements registered there.
 */
const elements = new Map<string, HTMLElement>();

const _world = new Vector3();
const _outwardLocal = new Vector3();
const _outwardWorld = new Vector3();
const _toCamera = new Vector3();

/** Half-angle of the cone in which a marker counts as facing the viewer. */
const FACING_COS = Math.cos(MathUtils.degToRad(74));

export function registerHotspotElement(id: string, element: HTMLElement | null): void {
  if (element) elements.set(id, element);
  else elements.delete(id);
}

export function HotspotProjector() {
  const { camera, size } = useThree();

  useFrame(() => {
    const car = stage.car;
    if (!car || elements.size === 0) return;
    car.updateMatrixWorld();

    const master = hotspotOpacity(scroll.t);
    const cam = camera as PerspectiveCamera;

    for (const spot of HOTSPOTS) {
      const element = elements.get(spot.id);
      if (!element) continue;

      if (master < 0.02) {
        if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden';
        continue;
      }

      // Outward surface normal, in world space.
      const out = spot.out ?? [spot.at[0], spot.at[2]];
      const len = Math.hypot(out[0], out[1]) || 1;
      _outwardLocal.set(out[0] / len, 0, out[1] / len).applyQuaternion(car.quaternion).normalize();

      _world.set(spot.at[0], spot.at[1], spot.at[2]).applyMatrix4(car.matrixWorld);
      _toCamera.copy(cam.position).sub(_world);
      const dist = _toCamera.length();
      _toCamera.divideScalar(dist || 1);
      _outwardWorld.copy(_outwardLocal);

      const facing = _outwardWorld.dot(_toCamera);
      // Centreline parts face forward and backward; allow both.
      const threshold = Math.abs(out[0]) < 0.01 ? -0.12 : FACING_COS;
      if (facing < threshold) {
        if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden';
        continue;
      }

      _world.project(cam);
      const x = (_world.x * 0.5 + 0.5) * size.width;
      const y = (-_world.y * 0.5 + 0.5) * size.height;
      const onScreen = _world.z <= 1 && x > -80 && x < size.width + 80 && y > -40 && y < size.height + 40;

      if (!onScreen) {
        if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden';
        continue;
      }

      element.style.visibility = 'visible';
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // Anchors far from the camera read as less important.
      const fade = master * MathUtils.clamp(1.6 - (dist - 2.4) * 0.28, 0.3, 1);
      element.style.opacity = fade.toFixed(3);
      element.style.pointerEvents = fade > 0.5 ? 'auto' : 'none';
    }
  });

  useEffect(
    () => () => {
      elements.clear();
    },
    [],
  );

  return null;
}