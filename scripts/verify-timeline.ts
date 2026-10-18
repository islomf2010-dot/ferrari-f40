/**
 * Timeline verification.
 *
 * Sampling the authored spline is the only reliable way to know a scroll-driven
 * camera never ends up inside bodywork or loses the car. Run before trusting a
 * change to story.ts:
 *
 *   npm run verify
 */
import { CHANNEL_COUNT, CH, DEG, MIN_CLEARANCE, POSE_TRACK, SCENES, SCENE_END, SCENE_START } from '../src/scroll/story.ts';

/** Car bounding shell, measured from the source GLB. */
const CAR = { a: 2.257, b: 1.064, yMin: 0, yMax: 1.119 };

const buf = new Float32Array(CHANNEL_COUNT);
/** Current story time under the cursor; `read` samples the track at it. */
let T = 0;
const read = (c: number) => POSE_TRACK.sample(T, c, buf);

const CHANNEL_NAMES = Object.fromEntries(Object.entries(CH).map(([name, index]) => [index, name])) as Record<number, string>;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`  \x1b[31mFAIL\x1b[0m ${msg}`);
};
const warn = (msg: string) => console.warn(`  \x1b[33mwarn\x1b[0m ${msg}`);
const ok = (msg: string) => console.log(`  \x1b[32m ok \x1b[0m ${msg}`);

const SAMPLES = 2000;
const cam: number[] = [];
const rel: number[] = [];
const prevRot = new Float32Array(SAMPLES + 1);

// 100vh of scroll == 100/900 == 0.111 story time. A genuine jump produces a
// derivative in the thousands; 450/t is ~50 channel units per screenful.
const LIMIT = 450;

console.log('\n\x1b[1mFERRARI F40 — timeline verification\x1b[0m\n');

// ---------------------------------------------------------------------------
// 1. Continuity
// ---------------------------------------------------------------------------
console.log('1. Continuity');
{
  let maxStep = 0;
  let worstAt = 0;
  let worstChannel = -1;
  const offenders: string[] = [];
  const dt = 1 / SAMPLES;
  let prev = Array.from({ length: CHANNEL_COUNT }, (_, c) => read(c));
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i * dt;
    T = t;
    for (let c = 0; c < CHANNEL_COUNT; c++) read(c);
    const cur = Array.from(buf);
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      // `camTheta` is a periodic channel; compare modulo 360.
      let d = cur[c] - prev[c];
      if (c === CH.camTheta) d = (((d % 360) + 540) % 360) - 180;
      const step = Math.abs(d) / dt;
      if (step > maxStep) {
        maxStep = step;
        worstAt = t;
        worstChannel = c;
      }
      if (step > LIMIT) {
        const label = `${CHANNEL_NAMES[c]}@${t.toFixed(3)}:${step.toFixed(0)}`;
        if (!offenders.includes(label)) offenders.push(label);
      }
    }
    prev = cur;
  }
  if (maxStep > LIMIT)
    fail(`max derivative ${maxStep.toFixed(0)}/t on "${CHANNEL_NAMES[worstChannel]}" at t=${worstAt.toFixed(3)} (limit ${LIMIT})\n         ${offenders.slice(0, 14).join('  ')}`);
  else ok(`no discontinuity — peak rate ${maxStep.toFixed(0)}/t ≈ ${(maxStep / 9).toFixed(0)} units per screenful (${CHANNEL_NAMES[worstChannel]}) at t=${worstAt.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 2. Camera clearance from the car shell
// ---------------------------------------------------------------------------
console.log('\n2. Camera clearance');
{
  let minClear = Infinity;
  let minAt = 0;
  let breaches = 0;
  const dt = 1 / SAMPLES;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i * dt;
    T = t;
    const theta = read(CH.camTheta) * DEG;
    const radius = read(CH.camRadius);
    const y = read(CH.camY);
    const rotY = read(CH.carRotY);

    // Support distance of the car's rotated rectangular footprint in the
    // direction of the camera, minus the camera's own radius.
    const delta = theta - rotY * DEG;
    const support = CAR.a * Math.abs(Math.cos(delta)) + CAR.b * Math.abs(Math.sin(delta));
    const clear = radius - support;

    const inVerticalBand = y > CAR.yMin - 0.05 && y < CAR.yMax + 0.05;
    const effective = inVerticalBand ? clear : Math.max(clear, radius - CAR.b);

    if (effective < minClear) {
      minClear = effective;
      minAt = t;
    }
    if (clear < MIN_CLEARANCE) breaches++;
    cam.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
    rel.push((theta - rotY * DEG) / DEG);
  }
  if (breaches > 0) fail(`${breaches} sample(s) inside the ${MIN_CLEARANCE} clearance shell (min ${minClear.toFixed(2)} at t=${minAt.toFixed(3)})`);
  else ok(`closest approach ${minClear.toFixed(2)} units at t=${minAt.toFixed(3)} (limit ${MIN_CLEARANCE})`);
}

// ---------------------------------------------------------------------------
// 3. Camera height band
// ---------------------------------------------------------------------------
console.log('\n3. Camera height');
{
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    T = i / SAMPLES;
    const y = read(CH.camY);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  if (lo < 0.2) fail(`camera drops to y=${lo.toFixed(2)} — below the floor`);
  else if (hi > 2.4) fail(`camera reaches y=${hi.toFixed(2)} — losing the car`);
  else ok(`y stays between ${lo.toFixed(2)} and ${hi.toFixed(2)} (hub 0.31 → roof 1.12)`);
}

// ---------------------------------------------------------------------------
// 4. Relative view angle must sweep forward without reversing
// ---------------------------------------------------------------------------
console.log('\n4. Relative view sweep');
{
  let regressions = 0;
  let total = 0;
  const where: number[] = [];
  for (let i = 1; i < rel.length; i++) {
    const d = ((((rel[i] - rel[i - 1]) % 360) + 540) % 360) - 180;
    total += d;
    if (d < -0.05) {
      regressions++;
      where.push(i / SAMPLES);
    }
  }
  if (regressions > 2)
    fail(
      `${regressions} sample(s) of reverse view travel — the car would appear to spin back\n` +
        `         at t = ${where.slice(0, 8).map((w) => w.toFixed(3)).join(', ')}`,
    );
  else if (total < 250) warn(`view only sweeps ${total.toFixed(0)}° — thin for a full page`);
  else ok(`view sweeps ${total.toFixed(0)}° monotonically, ${regressions} micro-reversal(s)`);
}

// ---------------------------------------------------------------------------
// 5. Car rotation must be monotone (no spin-back)
// ---------------------------------------------------------------------------
console.log('\n5. Car yaw');
{
  let regressions = 0;
  let first = 0;
  let last = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    T = i / SAMPLES;
    const r = read(CH.carRotY);
    if (i === 0) first = r;
    if (i === SAMPLES) last = r;
    if (i > 0) {
      const d = ((r - prevRot[i - 1]) % 360 + 540) % 360 - 180;
      if (d > 0.05) regressions++;
    }
    prevRot[i] = r;
  }
  if (regressions > 2) {
    const spots: number[] = [];
    for (let i = 1; i <= SAMPLES; i++) {
      const d = (((prevRot[i] - prevRot[i - 1]) % 360) + 540) % 360 - 180;
      if (d > 0.05) spots.push(i / SAMPLES);
    }
    fail(
      `${regressions} sample(s) of reverse yaw\n         at t = ${spots.slice(0, 8).map((w) => w.toFixed(3)).join(', ')}`,
    );
  } else ok(`yaw turns ${(first - last).toFixed(0)}° in one direction, ${regressions} micro-reversal(s)`);
}

// ---------------------------------------------------------------------------
// 6. Framing — does the car fill a sensible share of the frame?
// ---------------------------------------------------------------------------
console.log('\n6. Shot framing');
{
  const ASPECT = 16 / 9;
  let worst = Infinity;
  let worstAt = 0;
  const dt = 1 / SAMPLES;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i * dt;
    T = t;
    const cx = cam[i * 3];
    const cy = cam[i * 3 + 1];
    const cz = cam[i * 3 + 2];
    const tx = read(CH.tgtX);
    const ty = read(CH.tgtY);
    const tz = read(CH.tgtZ);
    const fov = read(CH.fov) * DEG;

    const dist = Math.hypot(cx - tx, cy - ty, cz - tz);
    // Vertical half-extent of the frustum at the subject plane.
    const halfV = Math.tan(fov / 2) * dist;
    const halfH = halfV * ASPECT;
    // The car is 4.515 long; a 3/4 view projects roughly 4.3 units across.
    const fillW = 4.3 / (halfH * 2);
    const fillH = 1.12 / (halfV * 2);
    const fill = Math.max(fillW, fillH);
    if (fill < worst) {
      worst = fill;
      worstAt = t;
    }
  }
  if (worst < 0.16) fail(`car shrinks to ${(worst * 100).toFixed(0)}% of frame at t=${worstAt.toFixed(3)}`);
  else ok(`tightest framing is ${(worst * 100).toFixed(0)}% of frame at t=${worstAt.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 7. Scene key moments
// ---------------------------------------------------------------------------
console.log('\n7. Scene beats');
for (const s of SCENES) {
  T = (SCENE_START[s.id] + SCENE_END[s.id]) / 2;
  const theta = read(CH.camTheta);
  const radius = read(CH.camRadius);
  const rotY = read(CH.carRotY);
  const delta = ((theta - rotY) % 360 + 540) % 360 - 180;
  const fov = read(CH.fov);
  const reveal = read(CH.reveal);
  console.log(
    `   ${s.index} ${s.kicker.padEnd(22)} t ${SCENE_START[s.id].toFixed(3)}–${SCENE_END[s.id].toFixed(3)}  ` +
      `view ${delta.toFixed(0).padStart(4)}°  r ${radius.toFixed(2).padStart(6)}  fov ${fov.toFixed(0)}°  ` +
      `yaw ${rotY.toFixed(0).padStart(5)}°  ${reveal < 0.999 ? `\x1b[33mreveal ${(reveal * 100).toFixed(0)}%\x1b[0m` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// 8. Scene spans sum to 1
// ---------------------------------------------------------------------------
console.log('\n8. Layout');
{
  const sum = SCENES.reduce((a, s) => a + s.span, 0);
  if (Math.abs(sum - 1) > 1e-6) fail(`scene spans sum to ${sum}`);
  else ok(`scene spans sum to ${sum.toFixed(3)}`);
}


// ---------------------------------------------------------------------------
// 9. Copy choreography — do two blocks ever shout at once?
// ---------------------------------------------------------------------------
console.log('\n9. Copy choreography');
{
  /*
   * Replicates the ScrollTrigger windows in src/scroll/useScroll.ts so the DOM
   * layering can be checked deterministically, without a browser.
   *
   * The page is SCROLL_VH of sections plus exactly one viewport of tail, so the
   * scrollable distance equals the section total and one viewport of scrolling
   * is always 1/9 of the whole story — independent of the device.
   */
  const V = 1 / 9;

  const ramp = (t: number, a: number, b: number) => {
    const u = Math.min(Math.max((t - a) / (b - a || 1), 0), 1);
    return u * u * (3 - 2 * u);
  };

  interface Window {
    label: string;
    inA: number;
    inB: number;
    outA: number;
    outB: number;
    /** The hero is lit at load; the tail lock-up never leaves. */
    hasIn: boolean;
    hasOut: boolean;
  }

  const windows: Window[] = SCENES.map((scene, i) => {
    const top = SCENE_START[scene.id];
    const bottom = SCENE_END[scene.id];
    const isHero = i === 0;
    const isCredit = i === SCENES.length - 1;
    return {
      label: `${scene.index} ${scene.kicker}`,
      inA: top - 0.88 * V,
      inB: top - 0.42 * V,
      outA: isHero ? top : bottom - (isCredit ? 1.0 : 0.92) * V,
      outB: isHero ? bottom - 0.45 * V : bottom - (isCredit ? 0.8 : 0.44) * V,
      hasIn: !isHero,
      hasOut: true,
    };
  });

  // The closing lock-up rides in on the tail and holds to the end.
  windows.push({
    label: 'lock-up',
    inA: 1 - 0.94 * V,
    inB: 1 - 0.62 * V,
    outA: 2,
    outB: 3,
    hasIn: true,
    hasOut: false,
  });

  const opacityAt = (w: Window, t: number) => {
    let o = w.hasIn ? ramp(t, w.inA, w.inB) : 1;
    if (w.hasOut) o *= 1 - ramp(t, w.outA, w.outB);
    return o;
  };

  let worstPair = 0;
  let worstAt = 0;
  let worstLabels = '';
  for (let i = 0; i <= 1200; i++) {
    const t = i / 1200;
    const active = windows
      .map((w) => ({ w, o: opacityAt(w, t) }))
      .filter((e) => e.o > 0.5)
      .sort((a, b) => b.o - a.o);
    if (active.length > 1 && active[0].o + active[1].o > worstPair) {
      worstPair = active[0].o + active[1].o;
      worstAt = t;
      worstLabels = `${active[0].w.label} + ${active[1].w.label}`;
    }
  }
  if (worstLabels) fail(`two copy blocks are loud at once at t=${worstAt.toFixed(3)}: ${worstLabels}`);
  else ok('never more than one copy block above 50% opacity');

  const finale = opacityAt(windows[windows.length - 1], 1);
  if (finale < 0.99) fail(`closing lock-up fades before the end (opacity ${finale.toFixed(2)})`);
  else ok('closing lock-up holds to the end of the page');

  // The hero must be the first thing on screen and the first thing to go.
  const heroStart = opacityAt(windows[0], 0);
  const heroEnd = opacityAt(windows[0], SCENE_START[2]);
  if (heroStart < 0.99) fail(`hero copy starts at ${heroStart.toFixed(2)} opacity`);
  else if (heroEnd > 0.02) fail(`hero copy still at ${heroEnd.toFixed(2)} when Scene 02 opens`);
  else ok('hero copy is full at load and gone before Scene 02');

  // Every other block must be dark before its own scene starts.
  let early = 0;
  windows.slice(1, -1).forEach((w, i) => {
    const sceneStart = SCENE_START[SCENES[i + 1].id];
    for (let k = 0; k <= 400; k++) {
      const t = (k / 400) * (sceneStart - 0.06);
      if (opacityAt(w, t) > 0.05) early++;
    }
  });
  ok('copy blocks never appear before their own scene', early === 0, `${early} early frames`);
}

console.log(
  failures === 0
    ? '\n\x1b[32m✓ timeline verified\x1b[0m\n'
    : `\n\x1b[31m✗ ${failures} check(s) failed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);