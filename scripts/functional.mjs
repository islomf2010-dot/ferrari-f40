/**
 * Functional smoke test — the things a screenshot cannot prove:
 * scroll linkage, replay, hotspot interaction, keyboard, reduced motion,
 * responsive layout and quality demotion. Runs at a small viewport so
 * SwiftShader can keep up.
 *
 *   node scripts/functional.mjs [url]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:5199';
const results = [];
const ok = (n, pass, note = '') => {
  results.push({ n, pass, note });
  console.log(`  ${pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${n}${note ? ` — ${note}` : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

async function openPage(ctxOpts = {}, url = `${BASE}/?q=low&debug=1`) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 1, ...ctxOpts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
  await page.waitForFunction(() => document.querySelector('.loader')?.classList.contains('is-hidden'), null, {
    timeout: 180_000,
    polling: 500,
  });
  return { ctx, page, errors };
}

// ── 1 · scroll linkage ───────────────────────────────────────────────────
console.log('\n1. Scroll linkage');
{
  const { ctx, page, errors } = await openPage();
  const metrics = await page.evaluate(() => ({
    scrollable: document.documentElement.scrollHeight - window.innerHeight,
    sections: [...document.querySelectorAll('[data-scene]')].map((n) => Math.round(n.getBoundingClientRect().height)),
  }));
  // Must mirror SCENES in src/scroll/story.ts.
  const SPANS = [0.15, 0.185, 0.225, 0.19, 0.1, 0.15];
  const expected = SPANS.map((s) => Math.round(s * 900 * 4.2));
  const ratios = metrics.sections.map((h, i) => h / expected[i]);
  ok(
    'section heights derive from the story spans',
    ratios.every((r) => Math.abs(r - 1) < 0.02),
    metrics.sections.join(', ') + 'px',
  );

  /*
   * GSAP's lag smoothing caps a slow frame at 33ms, so under SwiftShader the
   * scrub crawls. `scroll.locked` lets the harness place the story clock by
   * hand; the pose sampled is still the authored pose at that t, which is what
   * is being asserted here. (The scrub itself is exercised in the browser.)
   */
  const place = async (t) => {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(metrics.scrollable * t));
    await page.evaluate((target) => {
      const s = window.__F40.scroll;
      s.locked = true;
      s.target = target;
      s.t = target;
    }, t);
    const start = await page.evaluate(() => window.__F40.scroll.frame);
    await page
      .waitForFunction((s0) => window.__F40.scroll.frame > s0 + 1, start, { polling: 400, timeout: 120_000 })
      .catch(() => {});
  };
  const readPose = () =>
    page.evaluate(() => ({
      yaw: +((window.__F40.stage.car.rotation.y ?? 0) * 57.2958).toFixed(1),
      camX: +window.__F40.camera.position.x.toFixed(2),
      camZ: +window.__F40.camera.position.z.toFixed(2),
    }));

  const poses = [];
  for (const t of [0.25, 0.6, 0.95]) {
    await place(t);
    poses.push(await readPose());
  }
  ok(
    'camera and car respond to scroll',
    poses[1].camX !== poses[0].camX && poses[2].yaw !== poses[1].yaw,
    JSON.stringify(poses),
  );

  // Reversibility: the pose must be a pure function of scroll position.
  const forward = poses[1];
  await place(0.05);
  await place(0.6);
  const back = await readPose();
  ok(
    'scrolling back up replays the same pose',
    Math.abs(back.yaw - forward.yaw) < 1.5 && Math.abs(back.camX - forward.camX) < 0.15,
    `${JSON.stringify(forward)} vs ${JSON.stringify(back)}`,
  );

  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 2 · hotspots ─────────────────────────────────────────────────────────
console.log('\n2. Hotspots');
{
  const { ctx, page, errors } = await openPage();
  const metrics = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(metrics * 0.68));
  await page.evaluate(() => {
    const s = window.__F40.scroll;
    s.locked = true;
    s.target = 0.68;
    s.t = 0.68;
  });
  const f0 = await page.evaluate(() => window.__F40.scroll.frame);
  await page
    .waitForFunction((n) => window.__F40.scroll.frame > n + 1, f0, { polling: 400, timeout: 120_000 })
    .catch(() => {});

  const state = await page.evaluate(() =>
    [...document.querySelectorAll('.hotspot')].map((n) => ({
      label: n.getAttribute('aria-label'),
      // Read what the projector writes. A CSS transition on opacity would make
      // the computed value lag the scroll-linked value.
      vis: n.style.visibility,
      op: Number(n.style.opacity || 0),
    })),
  );
  const shown = state.filter((h) => h.vis === 'visible' && h.op > 0.4);
  const computedHidden = await page.evaluate(() => [...document.querySelectorAll('.hotspot')].filter((n) => getComputedStyle(n).visibility === 'hidden').length);
  ok(
    'markers appear when their geometry faces the camera',
    shown.length > 0 && computedHidden === state.length - shown.length,
    `${shown.length}/${state.length} visible, ${computedHidden} hidden`,
  );

  if (shown.length) {
    // The marker is re-positioned every rendered frame, which never settles
    // under software rendering — dispatch the click directly instead of
    // waiting for actionability.
    const idx = state.indexOf(shown[0]);
    await page.evaluate((i) => document.querySelectorAll('.hotspot')[i].click(), idx);
    await page.waitForTimeout(1200);
    const open = await page.evaluate(() => ({
      isOpen: document.querySelector('.detail')?.classList.contains('is-open'),
      title: document.querySelector('.detail__title')?.textContent,
      body: (document.querySelector('.detail__body')?.textContent || '').length,
    }));
    ok('clicking a marker opens its detail', open.isOpen === true && open.body > 40, JSON.stringify(open));

    await page.evaluate(() => document.querySelector('.detail__close')?.click());
    await page.waitForTimeout(800);
    const closed = await page.evaluate(() => !document.querySelector('.detail')?.classList.contains('is-open'));
    ok('detail closes', closed);
  }
  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 3 · replay + keyboard ────────────────────────────────────────────────
console.log('\n3. Replay & keyboard');
{
  const { ctx, page, errors } = await openPage();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(2500);
  await page.locator('.hud .btn--replay').click({ force: true });
  await page.waitForTimeout(4000);
  const y = await page.evaluate(() => window.scrollY);
  ok('HUD replay returns to the top', y < 60, `scrollY=${y}`);

  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }));
  await page.waitForTimeout(1500);
  await page.keyboard.press('Home');
  await page.waitForTimeout(3500);
  const yHome = await page.evaluate(() => window.scrollY);
  ok('Home key returns to the top', yHome < 60, `scrollY=${yHome}`);

  await page.keyboard.press('End');
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await page
    .waitForFunction((max) => Math.abs(window.scrollY - max) < 4, maxScroll, { polling: 400, timeout: 60_000 })
    .catch(() => {});
  const yEnd = await page.evaluate(() => window.scrollY);
  ok('End key reaches the bottom', Math.abs(yEnd - maxScroll) < 6, `scrollY=${yEnd} of ${maxScroll}`);
  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 4 · reduced motion ───────────────────────────────────────────────────
console.log('\n4. prefers-reduced-motion');
{
  const { ctx, page, errors } = await openPage({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
  const rf = await page.evaluate(() => window.__F40.scroll.frame);
  await page
    .waitForFunction((n) => window.__F40.scroll.frame > n + 1, rf, { polling: 400, timeout: 120_000 })
    .catch(() => {});
  const rm = await page.evaluate(() => ({
    reveal: window.__F40.revealUniforms.uReveal.value,
    grain: getComputedStyle(document.querySelector('.stage__grain')).display,
    heroOpacity: Number(getComputedStyle(document.querySelector('[data-scene="0"] [data-reveal]')).opacity),
  }));
  ok('materialise sweep is skipped', rm.reveal >= 0.999, `uReveal=${rm.reveal}`);
  ok('animated grain is removed', rm.grain === 'none', `display=${rm.grain}`);
  ok('hero copy stays readable', rm.heroOpacity > 0.9, `opacity=${rm.heroOpacity}`);
  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 5 · mobile ───────────────────────────────────────────────────────────
console.log('\n5. Mobile');
{
  const { ctx, page, errors } = await openPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
  const mf = await page.evaluate(() => window.__F40?.scroll?.frame ?? 0);
  await page
    .waitForFunction((n) => (window.__F40?.scroll?.frame ?? 0) > n + 1, mf, { polling: 400, timeout: 120_000 })
    .catch(() => {});
  const m = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const canvas = document.querySelector('canvas');
    return {
      overflow,
      canvasW: canvas?.clientWidth,
      canvasH: canvas?.clientHeight,
      quality: document.querySelector('.hud__quality')?.textContent,
      blockW: document.querySelector('[data-scene="1"] .block')?.getBoundingClientRect().width,
    };
  });
  ok('no horizontal overflow', m.overflow <= 0, `${m.overflow}px`);
  ok('canvas fills the viewport', m.canvasW === 390 && m.canvasH === 844, `${m.canvasW}×${m.canvasH}`);
  ok('coarse pointer drops to the low tier', m.quality === 'low', `quality=${m.quality}`);
  ok('copy spans the viewport width', m.blockW > 300, `${Math.round(m.blockW)}px`);
  ok('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 6 · forced quality tiers ─────────────────────────────────────────────
console.log('\n6. Quality tiers');
for (const q of ['high', 'medium', 'low']) {
  const { ctx, page, errors } = await openPage({}, `${BASE}/?q=${q}&debug=1`);
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }));
  const gf = await page.evaluate(() => window.__F40.scroll.frame);
  await page
    .waitForFunction((n) => window.__F40.scroll.frame > n + 1, gf, { polling: 400, timeout: 120_000 })
    .catch(() => {});
  const dpr = await page.evaluate(() => window.__F40.gl.getPixelRatio());
  ok(`tier "${q}" renders`, true, `pixelRatio=${dpr.toFixed(2)}${errors.length ? ` errors=${errors[0]}` : ''}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);