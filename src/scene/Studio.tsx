import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  Color,
  DoubleSide,
  ShaderMaterial,
  type AmbientLight,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type SpotLight,
} from 'three';

import { createBackdropTexture, createFloorFalloff, createStudioEnvironment } from './studioEnv.ts';
import { stage } from './Director.tsx';
import type { QualitySettings } from '../lib/quality.ts';

interface StudioProps {
  quality: QualitySettings;
}

const AMBIENT_TINT = new Color('#93a9cf');
const FILL_TINT = new Color('#7f93bd');

/**
 * The stage the car sits on: a dark reflective floor, a gradient backdrop and
 * a four-light studio rig whose placement is driven from Director.
 *
 * Deliberately low-poly and shader-light. The only per-frame extra cost is the
 * single shadow map — no post-processing stack, no screen-space reflections.
 */
export function Studio({ quality }: StudioProps) {
  const { gl, scene } = useThree();

  const key = useRef<SpotLight>(null);
  const rim = useRef<SpotLight>(null);
  const fill = useRef<SpotLight>(null);
  const accent = useRef<PointLight>(null);
  const ambient = useRef<AmbientLight>(null);
  const floor = useRef<MeshStandardMaterial>(null);
  const ring = useRef<MeshBasicMaterial>(null);
  const ringOuter = useRef<MeshBasicMaterial>(null);

  // ── Procedural HDR environment ────────────────────────────────────────
  useEffect(() => {
    const env = createStudioEnvironment(gl);
    scene.environment = env;
    scene.environmentIntensity = 0.4;
    stage.env = env;
    return () => {
      scene.environment = null;
      stage.env = null;
      env.dispose();
    };
  }, [gl, scene]);

  // ── Backdrop: an inverted sphere with a hand-written gradient ─────────
  const backdrop = useMemo(() => {
    const texture = createBackdropTexture();
    return new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uMap: { value: texture } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uMap, vec2(0.5, vUv.y)).rgb;
          // A breath of warmth at the floor line so the car has ground to sit on.
          float floorGlow = smoothstep(0.5, 0.42, vUv.y) * 0.008;
          gl_FragColor = vec4(c + vec3(floorGlow * 1.6, floorGlow * 0.5, floorGlow * 0.3), 1.0);
        }
      `,
    });
  }, []);

  useEffect(() => () => backdrop.dispose(), [backdrop]);

  // ── Floor falloff: dissolves the disc instead of ending it in a line ───
  const falloff = useMemo(() => createFloorFalloff(0.14), []);
  useEffect(() => () => falloff.dispose(), [falloff]);

  useEffect(() => {
    stage.key = key.current;
    stage.rim = rim.current;
    stage.fill = fill.current;
    stage.accent = accent.current;
    stage.ambient = ambient.current;
    stage.floorMaterial = floor.current;
    stage.ringMaterials = [ring.current, ringOuter.current];
    return () => {
      stage.key = stage.rim = stage.fill = stage.accent = null;
      stage.ambient = null;
      stage.floorMaterial = null;
      stage.ringMaterials = [];
    };
  }, []);

  return (
    <>
      <ambientLight ref={ambient} intensity={0.12} color={AMBIENT_TINT} />

      {/* Key — the only shadow caster. A tight cone keeps the shadow-map
          resolution where it matters instead of spreading it over the floor. */}
      <spotLight
        ref={key}
        castShadow={quality.shadows}
        angle={0.58}
        penumbra={0.9}
        distance={42}
        decay={1.25}
        shadow-mapSize-width={quality.shadowMapSize}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-near={1.5}
        shadow-camera-far={24}
      />

      {/* Rim — separates the silhouette from the black. No shadow: at this
          angle a second shadow pass buys nothing visible. */}
      <spotLight ref={rim} angle={0.46} penumbra={1} distance={42} decay={1.1} />

      {/* Fill — very low and cool, opposite the key. */}
      <spotLight ref={fill} angle={0.8} penumbra={1} distance={48} decay={1.05} color={FILL_TINT} />

      {/* Red practical tucked low behind the car. */}
      <pointLight ref={accent} distance={8} decay={1.5} />

      {/* Floor. Roughness plus a low env contribution gives it a wet-looking
          sheen; the alpha falloff keeps it from ending in a hard horizon. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[26, 72]} />
        <meshStandardMaterial
          ref={floor}
          color="#08090b"
          roughness={0.42}
          metalness={0.55}
          transparent
          opacity={0.9}
          alphaMap={falloff}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* Two hairline circles — a plinth read without an actual pedestal. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[3.4, 3.412, 96]} />
        <meshBasicMaterial ref={ring} color="#ff2a12" transparent opacity={0.09} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[6.1, 6.106, 96]} />
        <meshBasicMaterial ref={ringOuter} color="#5a6272" transparent opacity={0.05} depthWrite={false} side={DoubleSide} />
      </mesh>

      {/* Backdrop */}
      <mesh renderOrder={-1}>
        <sphereGeometry args={[64, 32, 24]} />
        <primitive object={backdrop} attach="material" />
      </mesh>
    </>
  );
}
