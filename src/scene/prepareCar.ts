import {
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Material,
} from 'three';
import { applyRevealPatch } from './Reveal.ts';

export interface CarMetrics {
  /** Model extents in metres after normalisation. */
  size: Vector3;
  /** Height of the car's visual centre, used as the default look-at. */
  centreY: number;
  halfLength: number;
  halfWidth: number;
  height: number;
}

const PAINT_NAME = /^paint$/i;
const GLASS_NAME = /^(glass|windows|glass\.front|glassback|rearlightsglass|ll shell)$/i;
const GRID_NAME = /^grid$/i;
const TIRE_NAME = /^tires$/i;
const RUBBERY_NAME = /^(alcantara|leather|interiorblack|cockpitstuff|cockpitstuff.*|cockpit)$/i;

/** The source model measures 4.515 units long; the real F40 is 4.43 m. */
const TARGET_LENGTH = 4.43;

export interface PreparedCar {
  model: Group;
  metrics: CarMetrics;
  summary: string;
}

/**
 * Normalising reparents the source scene, so it must run exactly once per
 * model. React's StrictMode deliberately double-invokes render and memo
 * factories; without this guard the second call would steal the scene into an
 * orphaned wrapper and the committed tree would come up empty.
 */
const prepared = new WeakMap<Object3D, PreparedCar>();

/**
 * Normalises the source model and tunes its materials for a dark studio.
 *
 * The Sketchfab export already arrives the right way up, nose toward +Z and
 * sitting on y = 0 — verified with `npm run inspect`. Rather than hard-coding
 * that, the transform is derived from the measured bounding box, so swapping in
 * a different car export will not silently break the timeline.
 */
export function prepareCar(source: Object3D): PreparedCar {
  const cached = prepared.get(source);
  if (cached) return cached;

  const model = new Group();
  model.name = 'ferrari-f40';

  const pivot = new Group();
  pivot.name = 'f40-pivot';
  pivot.add(source);
  model.add(pivot);

  // 1 · centre on X/Z and drop onto y = 0.
  const box = new Box3().setFromObject(model);
  const centre = box.getCenter(new Vector3());
  pivot.position.set(-centre.x, -box.min.y, -centre.z);

  // 2 · scale to real-world length.
  const sized = new Box3().setFromObject(model).getSize(new Vector3());
  const scale = TARGET_LENGTH / Math.max(sized.x, sized.z);
  model.scale.setScalar(scale);

  const finalSize = sized.multiplyScalar(scale);
  const metrics: CarMetrics = {
    size: finalSize,
    centreY: finalSize.y * 0.5,
    halfLength: Math.max(finalSize.x, finalSize.z) / 2,
    halfWidth: Math.min(finalSize.x, finalSize.z) / 2,
    height: finalSize.y,
  };

  source.traverse(tuneNode);

  const result: PreparedCar = { model, metrics, summary: summarise(source) };
  prepared.set(source, result);
  return result;
}

/** Mesh flags plus per-material tuning. Runs once, at load. */
function tuneNode(node: Object3D): void {
  if (!(node instanceof Mesh)) return;
  node.castShadow = true;
  node.receiveShadow = true;
  node.matrixAutoUpdate = false;
  node.updateMatrix();

  const materials = Array.isArray(node.material) ? node.material : [node.material];
  for (const material of materials) {
    if (!material) continue;
    tuneOne(material);
    applyRevealPatch(material);
  }
}

function tuneOne(material: Material): void {
  const pbr = material as MeshStandardMaterial;
  const physical = material as MeshPhysicalMaterial;
  const name = material.name ?? '';

  // ---- paint ------------------------------------------------------------
  // The hero surface. Keep it glossy and let the studio do the talking.
  if (PAINT_NAME.test(name)) {
    pbr.envMapIntensity = 1.35;
    pbr.roughness = Math.min(pbr.roughness ?? 0.4, 0.22);
    pbr.metalness = Math.max(pbr.metalness ?? 0, 0.35);
    if (material instanceof MeshPhysicalMaterial) {
      const paint = physical;
      paint.clearcoat = 1;
      paint.clearcoatRoughness = 0.028;
      paint.envMapIntensity = 1.35;
    }
  }

  // ---- glass ------------------------------------------------------------
  // Transmission was stripped by the asset pipeline because it forces an extra
  // full-scene pass every frame. Tinted alpha + a hard clearcoat reads the same
  // in a dark studio and costs a fraction as much.
  if (GLASS_NAME.test(name)) {
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = Math.min(material.opacity || 0.3, 0.38);
    pbr.envMapIntensity = 2.4;
    pbr.roughness = 0.03;
    pbr.metalness = 0;
    if (material instanceof MeshPhysicalMaterial) {
      const glass = physical;
      glass.clearcoat = 1;
      glass.clearcoatRoughness = 0.015;
      glass.specularIntensity = 1;
      glass.envMapIntensity = 2.4;
    }
  }

  // ---- alpha-masked decals (vents, grille meshes) -----------------------
  if (GRID_NAME.test(name)) {
    material.transparent = false;
    material.alphaTest = 0.42;
    material.depthWrite = true;
    pbr.envMapIntensity = 1.6;
  }

  // ---- rubber -----------------------------------------------------------
  if (TIRE_NAME.test(name)) {
    pbr.roughness = Math.min(pbr.roughness ?? 0.6, 0.6);
    pbr.envMapIntensity = 0.5;
    pbr.color.multiplyScalar(0.92);
  }

  // ---- cabin -----------------------------------------------------------
  if (RUBBERY_NAME.test(name)) {
    pbr.envMapIntensity = Math.min(pbr.envMapIntensity ?? 1, 0.75);
    pbr.roughness = Math.max(pbr.roughness ?? 0.7, 0.62);
  }

  // ---- brakes / discs ---------------------------------------------------
  if (/^brakedisc|^brake|^brembo/i.test(name)) {
    pbr.envMapIntensity = 1.5;
    pbr.roughness = Math.min(pbr.roughness ?? 0.3, 0.24);
  }

  // ---- global -----------------------------------------------------------
  pbr.envMapIntensity = pbr.envMapIntensity ?? 1;
  pbr.needsUpdate = true;
}

/** Console summary — useful when swapping the model. */
function summarise(source: Object3D): string {
  let meshes = 0;
  const materials = new Set<string>();
  let triangles = 0;
  source.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    meshes++;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => materials.add(m?.name || '(unnamed)'));
    const index = child.geometry.getIndex();
    triangles += index ? index.count / 3 : (child.geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return `${meshes} meshes · ${Math.round(triangles).toLocaleString('en-US')} triangles · ${materials.size} materials`;
}
