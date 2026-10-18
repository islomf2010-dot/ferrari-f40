/**
 * Live scene diagnostics — answers "why can't I see the car?" without
 * guessing. Run against a running dev/preview server:
 *
 *   node scripts/diagnose.mjs http://localhost:5173 0.4
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv[2] || 'http://localhost:5173';
const T = Number(process.argv[3] ?? 0.4);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180_000);

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${URL_BASE}?q=low`, { waitUntil: 'load', timeout: 120_000 });
await page.waitForFunction(() => document.querySelector('.loader')?.classList.contains('is-hidden'), { timeout: 180_000 });
await page.waitForTimeout(1500);

const scrollable = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(scrollable * T));
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__DBG = 1; });

// The app exposes the R3F root through the canvas' __r3f store.
const scrollInfo = await page.evaluate(() => ({
  scrollY: window.scrollY,
  bodyScrollHeight: document.body.scrollHeight,
  docScrollHeight: document.documentElement.scrollHeight,
  innerHeight: window.innerHeight,
  appH: document.querySelector('.app')?.getBoundingClientRect().height,
  scrollH: document.querySelector('.scroll')?.getBoundingClientRect().height,
  t: window.__F40?.scroll?.t,
  target: window.__F40?.scroll?.target,
}));
console.log('scroll', scrollInfo);

const report = await page.evaluate(() => {
  const store = window.__F40;
  if (!store) return { error: 'window.__F40 not available (dev build required)' };

  const { scene, camera, gl, stage } = store;
  const V3 = scene.position.constructor;
  const out = {
    exposure: gl.toneMappingExposure,
    envIntensity: scene.environmentIntensity,
    hasEnvironment: !!scene.environment,
    camera: {
      position: camera.position.toArray().map((n) => +n.toFixed(3)),
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    },
    children: [],
    tree: [],
  };
  const walk = (node, depth) => {
    if (depth > 4) return;
    out.tree.push(`${'  '.repeat(depth)}${node.type}${node.name ? `#${node.name}` : ''} kids=${node.children.length}${node.isMesh ? ` mat=${Array.isArray(node.material) ? node.material[0]?.name : node.material?.name}` : ''}`);
    node.children.forEach((c) => walk(c, depth + 1));
  };
  scene.children.forEach((c) => walk(c, 0));

  scene.traverse((o) => {
    if (!o.isMesh && !o.isGroup && !o.isLight) return;
    out.children.push({
      type: o.type,
      name: o.name,
      visible: o.visible,
      world: o.getWorldPosition(new V3()).toArray().map((n) => +n.toFixed(3)),
      children: o.children.length,
    });
  });

  // Inspect the car subtree specifically.
  const car = scene.getObjectByName('ferrari-f40');
  if (car) {
    out.carFound = true;
    out.carWorldPos = car.getWorldPosition(new V3()).toArray().map((n) => +n.toFixed(3));
    out.carScale = car.scale.toArray();
    const meshes = [];
    car.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      meshes.push({
        name: o.name,
        mat: m?.name,
        visible: o.visible,
        tris: (o.geometry.getIndex()?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3,
        hasMap: !!m?.map,
        opacity: m?.opacity,
        transparent: m?.transparent,
        color: m?.color ? m.color.getHexString() : null,
      });
    });
    out.carMeshes = meshes.slice(0, 6);
    out.carMeshCount = meshes.length;
    out.carChildTree = [];
    const walkCar = (n, d) => {
      if (d > 3) return;
      out.carChildTree.push(`${'  '.repeat(d)}${n.type}${n.name ? `#${n.name}` : ''} kids=${n.children.length}`);
      n.children.forEach((c) => walkCar(c, d + 1));
    };
    walkCar(car, 0);
    out.carTriangles = meshes.reduce((a, m) => a + m.tris, 0);

    // Project the car centre to screen space.
    const centre = car.position.clone();
    const p = centre.project(camera);
    out.carCentreNdc = [p.x, p.y, p.z].map((n) => +n.toFixed(3));

    // World bounding box of the whole car.
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    car.updateMatrixWorld(true);
    car.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i += 37) {
        const v = new V3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
    });
    out.carWorldBox = { min: [minX, minY, minZ].map((n) => +n.toFixed(2)), max: [maxX, maxY, maxZ].map((n) => +n.toFixed(2)) };
    out.reveal = window.__F40.THREE_REVEAL.uReveal.value;
  } else {
    out.carFound = false;
    out.topLevelNames = scene.children.map((c) => c.name || c.type);
  }

  return out;
});

console.log(JSON.stringify(report, null, 2));
console.log('\n--- console ---');
for (const l of logs.slice(0, 30)) console.log(l);

await browser.close();