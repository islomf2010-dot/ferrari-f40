/**
 * Frame capture rig.
 *
 * SwiftShader renders this scene in software at well under 1 fps, so every
 * capture has to give the page time to settle AND time to produce at least one
 * frame. `--wait` controls that budget.
 *
 *   node scripts/shoot.mjs <url> <sceneCount> [--wait=9000]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../shots', process.env.SHOT_DIR || 'run');

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')),
);
const positional = args.filter((a) => !a.startsWith('--'));
const URL_BASE = positional[0] || 'http://127.0.0.1:5199/?q=low&debug=1';
const TIMES = positional[1]
  ? positional[1].split(',').map(Number)
  : [0, 0.09, 0.2, 0.3, 0.4, 0.47, 0.55, 0.63, 0.7, 0.76, 0.84, 0.93, 1];
const W = Number(flags.w || 1440);
const H = Number(flags.h || 810);
const WAIT = Number(flags.wait || 9000);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300_000);

const logs = [];
page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: `${e.message}\n${e.stack || ''}` }));
page.on('requestfailed', (r) => logs.push({ type: 'requestfailed', text: `${r.url()} — ${r.failure()?.errorText}` }));

console.log(`→ ${URL_BASE}  (${W}×${H}, ${WAIT}ms per frame)`);
await page.goto(URL_BASE, { waitUntil: 'load', timeout: 180_000 });
await page.waitForFunction(() => document.querySelector('.loader')?.classList.contains('is-hidden'), { timeout: 300_000, polling: 500 });
await page.waitForTimeout(WAIT);

const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
console.log('scrollable', scrollable);

const shots = [];
const settle = async (t) => {
  /*
   * GSAP's lag smoothing caps a slow frame at 33ms, so under SwiftShader the
   * scrub would advance ~30x slower than wall clock and never settle. For a
   * deterministic capture we place the story clock directly instead — the pose
   * sampled is exactly the authored pose at `t`.
   */
  await page.evaluate((target) => {
    const s = window.__F40.scroll;
    s.locked = true;
    s.target = target;
    s.t = target;
  }, t);
  const start = await page.evaluate(() => window.__F40?.scroll.frame ?? 0);
  await page
    .waitForFunction((s0) => (window.__F40?.scroll.frame ?? 0) > s0 + 1, start, { timeout: WAIT, polling: 400 })
    .catch(() => console.warn('  (frame wait timed out)'));
};

for (const t of TIMES) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(scrollable * t));
  await settle(t);
  const name = `t${String(Math.round(t * 100)).padStart(3, '0')}.png`;
  await page.screenshot({ path: path.join(OUT, name), timeout: 300_000, animations: 'disabled' });
  shots.push(name);
  const state = await page.evaluate(() => ({
    t: +window.__F40?.scroll?.t.toFixed(3),
    frame: window.__F40?.scroll?.frame,
    yaw: +((window.__F40?.stage?.car?.rotation?.y ?? 0) * 57.2958).toFixed(1),
    cam: window.__F40?.camera?.position?.toArray?.().map((n) => +n.toFixed(2)),
  }));
  console.log(`  ${name}  t=${state.t} yaw=${state.yaw} cam=${JSON.stringify(state.cam)}`);
}

const errors = logs.filter((l) => ['error', 'pageerror', 'requestfailed'].includes(l.type));
await writeFile(path.join(OUT, 'console.json'), JSON.stringify({ shots, logs }, null, 2));
console.log(`\nconsole: ${logs.length} messages, ${errors.length} errors`);
for (const l of errors.slice(0, 15)) console.log(`  [${l.type}] ${l.text.slice(0, 300)}`);
await browser.close();
process.exit(errors.length ? 1 : 0);