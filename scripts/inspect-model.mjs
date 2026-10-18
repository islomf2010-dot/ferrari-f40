/**
 * Prints the world-space bounds of every named part in the optimised GLB.
 * Used to author camera keyframes and hotspot positions without guessing.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../public/models/ferrari-f40.draco.glb');

const buf = await readFile(FILE);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binChunkOffset = 20 + jsonLen + 8;

const V = new Float32Array(3);
function mul(a, b) {
  // column-major 4x4 multiply, returns new array
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function compose(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function xf(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const results = [];
const global = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

function walk(index, parent, depth) {
  const n = json.nodes[index];
  const local = compose(n.translation, n.rotation, n.scale);
  const world = mul(parent, local);
  if (n.mesh !== undefined) {
    for (const prim of json.meshes[n.mesh].primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc.min || !acc.max) continue;
      // Draco/quantize emit normalized integer accessors; they are a pure scale
      // of the original floats, so de-normalising min/max stays exact.
      const k = acc.normalized ? 1 / 32767 : 1;
      const lo = [acc.min[0] * k, acc.min[1] * k, acc.min[2] * k];
      const hi = [acc.max[0] * k, acc.max[1] * k, acc.max[2] * k];
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) {
        const p = xf(world, [i < 4 ? lo[0] : hi[0], i < 4 ? lo[1] : hi[1], i % 4 < 2 ? lo[2] : hi[2]]);
        for (let k = 0; k < 3; k++) {
          b[k] = Math.min(b[k], p[k]);
          b[k + 3] = Math.max(b[k + 3], p[k]);
          global[k] = Math.min(global[k], p[k]);
          global[k + 3] = Math.max(global[k + 3], p[k]);
        }
      }
      results.push({ name: n.name, depth, mesh: n.mesh, material: json.materials[prim.material]?.name, b });
    }
  }
  for (const c of n.children ?? []) walk(c, world, depth + 1);
}

for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENT, 0);

const f = (v) => v.toFixed(3).padStart(7);
console.log('\n=== WHOLE MODEL WORLD BOUNDS ===');
console.log(`  min [${f(global[0])} ${f(global[1])} ${f(global[2])}]`);
console.log(`  max [${f(global[3])} ${f(global[4])} ${f(global[5])}]`);
console.log(`  size ${f(global[3] - global[0])} x ${f(global[4] - global[1])} x ${f(global[5] - global[2])}`);

console.log('\n=== NAMED GROUP / MESH BOUNDS (smallest height first) ===');
for (const r of results.sort((a, b) => (b.b[4] - b.b[1]) - (a.b[4] - a.b[1]))) {
  console.log(
    `${'  '.repeat(r.depth)}${r.name.padEnd(28)} ${(r.material ?? '-').padEnd(16)} ` +
      `min[${f(r.b[0])},${f(r.b[1])},${f(r.b[2])}] max[${f(r.b[3])},${f(r.b[4])},${f(r.b[5])}]`,
  );
}

void binChunkOffset;
void V;