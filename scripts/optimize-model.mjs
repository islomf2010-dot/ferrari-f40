/**
 * Optimises the source Ferrari F40 GLB into a web-ready asset.
 *
 * Source : assets/source/lb-works_ferrari_f40_-__free.glb   (Sketchfab export, ~27.5 MB)
 * Output : public/models/ferrari-f40.draco.glb
 *
 * Pipeline
 *   1. prune  – drop unused nodes / non-renderable assets
 *   2. dedup  – share duplicated geometry + textures
 *   3. resize – clamp oversized textures (4096px paint map -> 2048px) and re-encode
 *   4. quantise + draco – mesh compression (EXT_meshopt / KHR_draco_mesh_compression)
 *   5. glass  – strip KHR_materials_transmission so three.js does not need an
 *               extra full-scene transmission pass per frame (huge win on iGPUs)
 *
 * Run: npm run assets
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression, KHRMaterialsClearcoat, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { dedup, prune, weld, draco, textureCompress, instance, quantize } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SOURCE = path.join(ROOT, 'assets/source/lb-works_ferrari_f40_-__free.glb');
const OUT_DIR = path.join(ROOT, 'public/models');
const OUT = path.join(OUT_DIR, 'ferrari-f40.draco.glb');

/** Texture slots are re-encoded to WebP; alpha is only preserved where needed. */
const MAX_SIZE = 2048;

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

async function optimizeTextures(doc) {
  const seen = new Map();
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;

    const mime = texture.getMimeType();
    const name = texture.getName() || `texture_${seen.size}`;
    const key = image.byteLength + ':' + name;

    // 1x1 helper masks (grid decals) – keep tiny.
    if (mime === 'image/png' && image.byteLength < 4096) continue;

    let pipeline = sharp(image);
    const meta = await pipeline.metadata();
    const needsResize = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_SIZE;
    const hasAlpha = meta.channels === 4 || meta.hasAlpha === true;

    if (needsResize) pipeline = pipeline.resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true });

    // Alpha-carrying maps (decals, logos) stay PNG, everything else becomes WebP.
    let out;
    let nextMime;
    if (hasAlpha) {
      out = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      nextMime = 'image/png';
    } else {
      out = await pipeline.webp({ quality: 82, effort: 5 }).toBuffer();
      nextMime = 'image/webp';
    }

    // Skip the swap if a bigger texture came out.
    if (out.byteLength >= image.byteLength && !needsResize) continue;

    texture.setImage(out).setMimeType(nextMime);
    seen.set(key, out.byteLength);
    console.log(
      `  texture ${name.padEnd(26)} ${String(meta.width).padStart(4)}x${String(meta.height).padEnd(4)} ` +
        `${mime.replace('image/', '').padEnd(4)} ${mb(image.byteLength).padStart(9)} -> ${nextMime.replace('image/', '').padEnd(4)} ${mb(out.byteLength).padStart(9)}`,
    );
  }
}

/**
 * The car has to survive a dark studio: transmission materials trigger a full
 * extra scene render every frame in three.js. We keep the tinted-glass look with
 * a cheap alpha-blended physical material instead.
 */
function replaceTransmission(doc) {
  let touched = 0;
  for (const material of doc.getRoot().listMaterials()) {
    const ext = material.getExtension('KHR_materials_transmission');
    if (!ext) continue;

    const tint = material.getBaseColorFactor();
    // Sketchfab author used transmission = 1 with a 0.25 alpha tint.
    material.setAlphaMode('BLEND');
    material.setDoubleSided(true);
    material.setBaseColorFactor([tint[0], tint[1], tint[2], 0.34]);

    // Metallic-rough workflow: glass reads best with a smooth dielectric.
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.05);
    const clearcoat = doc.createExtension(KHRMaterialsClearcoat).createClearcoat();
    clearcoat.setClearcoatFactor(1);
    clearcoat.setClearcoatRoughnessFactor(0.03);
    material.setExtension('KHR_materials_clearcoat', clearcoat);

    const specular = doc.createExtension(KHRMaterialsSpecular).createSpecular();
    specular.setSpecularFactor(1);
    material.setExtension('KHR_materials_specular', specular);

    ext.dispose();
    touched++;
  }
  return touched;
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`[assets] source model not found: ${SOURCE}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[assets] source ${SOURCE} ${mb((await stat(SOURCE)).size)}`);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    });

  const doc = await io.read(SOURCE);

  console.log('[assets] scene graph:', doc.getRoot().listNodes().length, 'nodes /', doc.getRoot().listMeshes().length, 'meshes');

  await doc.transform(
    prune({ keepAttributes: false }),
    weld({ tolerance: 0 }),
    dedup(),
    instance(),
  );

  console.log('[assets] optimising textures…');
  await optimizeTextures(doc);

  const stripped = replaceTransmission(doc);
  console.log(`[assets] replaced ${stripped} transmission material(s) with alpha-blended glass`);

  console.log('[assets] compressing geometry (draco, quantised)…');
  await doc.transform(
    quantize({ pattern: /.*/ }),
    draco({
      method: 'edgebreaker',
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
      quantizeGeneric: 12,
    }),
  );

  const glb = await io.writeBinary(doc);
  await writeFile(OUT, glb);
  console.log(`[assets] wrote ${OUT} ${mb(glb.byteLength)}  (${((glb.byteLength / (await stat(SOURCE)).size) * 100).toFixed(1)}% of source)`);
}

// Referenced so linters do not strip the extension imports that register the
// Draco/quantize helpers used above.
void KHRDracoMeshCompression;
void copyFile;
void readFile;

main().catch((error) => {
  console.error('[assets] failed:', error);
  process.exitCode = 1;
});