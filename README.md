# Ferrari F40 — Scroll-Driven 3D Experience

A production-quality, single-page WebGL study of the Ferrari F40 in which **page
scroll is the only clock**. One scrubbed GSAP timeline drives the camera, the
car, the light rig and the exposure from a single normalised value, so scrolling
down explores the car in cinematic space and scrolling back up replays the
story exactly in reverse.

Built on the model supplied in `lb-works-ferrari-f40-wwwvecarzcom.zip`.

---

## Quick start

```bash
npm install          # also fetches the Draco decoder-free GLB tooling
npm run assets       # optimise the source GLB -> public/models/ferrari-f40.draco.glb
npm run dev          # http://localhost:5173
```

`npm run assets` is only needed once, or whenever
`assets/source/lb-works_ferrari_f40_-__free.glb` changes. The optimised model is
committed, so a plain `npm install && npm run dev` also works.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and produce a production bundle in `dist/` |
| `npm run preview` | Serve the production build on :4173 |
| `npm run verify` | Validate the scroll timeline geometrically (see below) |
| `npm run inspect` | Print the measured world-space bounds of every part |
| `npm run assets` | Re-run the model optimisation pipeline |
| `npm run check` | `verify` + a production build |
| `node scripts/functional.mjs <url>` | 24 headless behavioural checks (see below) |
| `node scripts/shoot.mjs <url> "0,0.5,1"` | Capture frames of the story + the console log |
| `node scripts/diagnose.mjs <url> <t>` | Dump live scene state at a scroll position |

### URL parameters

| Parameter | Effect |
| --- | --- |
| `?q=high` / `?q=medium` / `?q=low` | Force a render tier instead of auto-detecting |
| `?debug=1` | Expose `window.__F40` for the tooling scripts |

---

## The model

`assets/source/lb-works_ferrari_f40_-__free.glb` is a Sketchfab export:
146 nodes, 54 meshes, 707k triangles, 29 PBR materials, no animation.

Measured bounds (metres, after normalisation — `npm run inspect`):

```
      +X right      +Y up      +Z = FRONT of the car
      4.515 long × 2.127 wide × 1.122 high   (ground at y = 0)
      front axle z ≈ +1.14   rear axle z ≈ −1.32   rear wing z ≈ −2.19
```

Named parts that the experience depends on: `Body_9_21`, `Glass.front`
(windscreen), `Headlights_17_41` (pop-up lamp pods), `Object_41` (rear
aerofoil), `Grid` (side vents and grille meshes), `Logos` (livery decals),
`RearLight_7_17`, `Tire.*`, `BrakeDisc*`.

There are **no animations in the source**, so nothing is invented: the car moves
by transforming the group, and every hotspot is pinned to a vertex-accurate
point on geometry that actually exists.

### Optimisation pipeline (`scripts/optimize-model.mjs`)

| Step | Result |
| --- | --- |
| prune / weld / dedup | 707k → 703k tris, geometry shared |
| texture resize + re-encode | 4096² paint map → 2048² WebP; all colour maps → WebP q82 |
| quantise + Draco (edgebreaker) | geometry → KHR_draco_mesh_compression |
| transmission → alpha-blended glass | removes a full extra scene pass per frame |

**26.2 MB → 3.35 MB (12.8 %)**, with the triangle count essentially untouched.
Decoders are served from `public/draco/`; nothing is fetched from a CDN at
runtime. Production build: 3.5 MB total, of which the model is 3.4 MB and the
application is ~77 kB gzipped (plus Three.js ~192 kB gzipped).

---

## Architecture

```
src/
  scroll/
    story.ts        THE TIMELINE — every keyframe, in one place
    track.ts        Hermite / Catmull-Rom + monotone interpolation
    useScroll.ts    the single ScrollTrigger, and the copy reveal
  scene/
    Director.tsx    the only writer: samples the timeline once per frame
    Ferrari.tsx     model load + normalisation
    prepareCar.ts   normalisation and per-material tuning
    Studio.tsx      lights, floor, backdrop
    studioEnv.ts    procedural HDR studio (generated, not downloaded)
    Reveal.ts       the materialise shader patch
    HotspotProjector.tsx  projects markers to screen space
  ui/               DOM layer: loader, HUD, scene copy, hotspots
  lib/              quality tiers, reduced-motion
  content.ts        all copy in one object
```

### The central idea

There is exactly **one** animation source. GSAP ScrollTrigger owns a single
scrubbed tween and writes one number, `scroll.target ∈ [0,1]`, into a plain
module-level object. Every frame, `Director` samples that number through
`Track` — a Catmull-Rom spline with settle points — and writes the result
directly onto Three.js objects.

This gives, for free:

- **C1 continuity.** No channel ever snaps; the spline is differentiable across
  every scene seam.
- **Exact reversibility.** Evaluation is a pure function of scroll position and
  never depends on history, so scrolling up is not a special case.
- **No conflicting animations.** One writer per property, by construction.
- **No React re-renders.** The timeline never touches component state.

Scroll position maps linearly onto *story time*, and each DOM section's height
is derived from the same spans (`applyLayout()` in `src/scene/stage.ts`), so the
copy and the 3D choreography can never drift apart.

### Camera authoring

Camera keys are written in a way that can be reasoned about rather than guessed
at:

| Channel | Meaning |
| --- | --- |
| `camTheta` | world azimuth of the camera, degrees from +Z toward +X |
| `camRadius` | horizontal distance from the origin |
| `tgt*` | look-at point in **car-local** space, so framing follows the part being described |
| `keyOffset` | key-light azimuth relative to the camera — rim, fill and accent are derived from it in `Director` |
| `frameOffset` | lateral dolly along the camera's right axis, used to push the car out of the copy's half of the frame |

The *relative* view angle (`camTheta − carRotY`) is what the visitor actually
sees, and it is the channel the story is built on:

```
Scene 01  THE LEGEND             view  23°   front three-quarter, materialising
Scene 02  THE SILHOUETTE         view  80°   flank — the shape reads on its own
Scene 03  ENGINEERED FOR SPEED   view 168°   dead astern — engine, wing, intakes
Scene 04  FORM FOLLOWS FUNCTION  view 242°   low along the flank, at hub height
Scene 05  THE LEGACY             view 276°   front three-quarter again, grade opens up
Scene 06  FINAL REVEAL           view 311°   hero frame, rotation decelerates to rest
```

324° of relative sweep, 196° of car yaw, one direction, no reversals.

### Why the closing frame lives in the page tail

The document is exactly one viewport taller than its scrollable distance — that
identity is what makes scroll position map linearly onto story time, so the last
viewport is always the tail. That makes the tail the natural home for the
closing lock-up, and it guarantees the final composition is framed correctly the
moment the visitor stops scrolling. Verified in check 8 above.

### `npm run verify`

The timeline is not trusted, it is measured. The script samples the spline at
2000 points and asserts:

1. **Continuity** — peak channel rate stays under ~50 units per screenful.
2. **Camera clearance** — the camera never enters the car's rotated footprint
   plus a 0.55-unit shell. Worst case: 1.40 units.
3. **Camera height** — stays between the wheel hubs and well above the roof.
4. **Relative view sweep** — monotonic (no spin-back).
5. **Car yaw** — monotonic.
6. **Framing** — the car never shrinks below a usable share of the frame.
7. **Layout** — scene spans sum to 1.
8. **Copy choreography** — no two copy blocks are ever above 50% opacity at the
   same time, the closing lock-up holds to the end of the page, and no block
   appears before its own scene.

It has already caught four real bugs during development: a 500°/s yaw spike in
Scene 03, a Catmull-Rom tail overshoot that reversed the car at the very end of
the page, and two copy blocks shouting over each other at the top and the
bottom of the story. Run it after any edit to `story.ts`.

### `npm run functional`

24 behavioural checks in a real browser — the things a screenshot cannot prove:
scroll linkage, exact replay of the same pose when scrolling back up, hotspot
visibility and click-through, detail open/close, replay button, `Home`/`End`,
`prefers-reduced-motion`, mobile layout and horizontal overflow, all three
quality tiers, and a zero-console-error assertion on every page it opens.

> Both scripts run under software rendering in this environment, so they place
> the story clock directly (`scroll.locked`) rather than waiting on GSAP's
> scrubbed tween — which, with lag smoothing on a multi-second frame, would
> advance ~30× slower than wall clock.

---

## Performance

Targets a Surface Laptop 4 with integrated graphics.

| Tier | Pixel ratio | Shadow map | Floor reflections |
| --- | --- | --- | --- |
| high | ≤ 2 | 2048² | on |
| medium | ≤ 1.5 | 1024² | on |
| low | ≤ 1.15 | 512² | off |

- The tier is chosen from pointer type and core count, and **steps down on its
  own**: `QualityGovernor` watches frame time and demotes after two consecutive
  bad windows. It never promotes — hunting between tiers is more distracting
  than being one notch conservative.
- Within a tier, drei's `PerformanceMonitor` shifts the pixel ratio before the
  governor has to give up a whole tier.
- **No post-processing stack.** ACES tone mapping plus two composited CSS
  layers (scrim, vignette) and a baked static grain tile do the grading for
  free.
- **One** shadow-casting light. One depth pass per frame over 703k triangles.
- Transmission materials were stripped at asset-build time; they force a full
  extra scene render every frame for a look that a tinted clearcoat reproduces.
- Materials are static and share a program cache key; the model is traversed
  exactly once at load.
- `<Preload all />` compiles every material before the curtain lifts.

### Loading and failure

`assets/source → dist` drops the model from 26 MB to 3.3 MB. The loader screen
reports real byte progress, holds for 900 ms so the reveal reads as a reveal,
and becomes a real error screen with a retry if the model fails to load —
model loading sits behind a React error boundary, not an empty canvas.

### Reduced motion

`prefers-reduced-motion: reduce` drops the materialise sweep, the pointer
parallax and the animated grain, and removes the CSS transitions, while keeping
the content and the scroll-linked camera. The page becomes a calm gallery
rather than an empty one.

### Mobile

Coarse pointers start at the low tier: pixel ratio capped at 1.15, 512²
shadows, no reflections, and 38 px hit targets on the markers. Type scales with
`clamp()`, and the copy columns collapse to full width under 760 px.

---

## Interaction

- **Hotspots** are pinned to real geometry. Visibility is derived from the
  anchor's outward normal versus the camera direction — never from hard-coded
  timings — so the markers cannot fall out of sync with the camera if the
  timeline is retimed. Clicking opens a spec card.
- **Replay** appears in the HUD once the story has moved, and again on the final
  frame. Both scroll smoothly back to the top.
- `Home` / `End` jump to either end of the story.

---

## Licensing

The 3D model is redistributed with this project under the terms of its original
source (`vecarz.com` / Sketchfab). The typefaces are Inter Tight and JetBrains
Mono, both SIL Open Font License. Everything else is original.