import { useProgress } from '@react-three/drei/core/Progress.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';

import { Experience } from './scene/Experience.tsx';
import { FINALE, SCENE_COPY, SITE } from './content.ts';
import { SCENE_END } from './scroll/story.ts';
import { useCopyReveal, useScrollDriver } from './scroll/useScroll.ts';
import { initialQuality, settingsFor, type QualityTier } from './lib/quality.ts';
import { useReducedMotion } from './lib/useReducedMotion.ts';
import { applyLayout, replay, scroll } from './scene/stage.ts';
import { setPointer } from './scene/Director.tsx';
import { Hud } from './ui/Hud.tsx';
import { Hotspots } from './ui/Hotspots.tsx';
import { Loader } from './ui/Loader.tsx';
import { SceneBlock } from './ui/SceneBlock.tsx';

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const [quality, setQuality] = useState<QualityTier>(() => initialQuality().tier);
  const [scene, setScene] = useState(1);
  const [booted, setBooted] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loaderHidden, setLoaderHidden] = useState(false);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [dprFactor, setDprFactor] = useState(1);
  const dprRef = useRef(setDprFactor);
  dprRef.current = setDprFactor;

  const qualitySettings = useMemo(() => settingsFor(quality), [quality]);
  const dpr = useMemo<[number, number]>(
    () => [qualitySettings.dpr[0], Math.max(qualitySettings.dpr[0], qualitySettings.dpr[1] * dprFactor)],
    [qualitySettings, dprFactor],
  );
  const progress = useProgress();

  // ── Layout: section heights come from the story spans ─────────────────
  useEffect(() => {
    const relayout = () => applyLayout(rootRef.current);
    relayout();
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    return () => {
      window.removeEventListener('resize', relayout);
      window.removeEventListener('orientationchange', relayout);
    };
  }, []);

  // ── Scroll ────────────────────────────────────────────────────────────
  useScrollDriver(rootRef, booted);
  useCopyReveal(rootRef, booted);

  // ── Pointer parallax, scene 01 only ───────────────────────────────────
  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      if (scroll.t > 0.17) return;
      setPointer((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reducedMotion]);

  // ── Loader hand-off ───────────────────────────────────────────────────
  const handleReady = useCallback(() => setReady(true), []);
  const handleError = useCallback((err: Error) => setError(err), []);

  useEffect(() => {
    if (!ready || error) return;
    // Hold the curtain long enough for the reveal to read as a reveal.
    const id = window.setTimeout(() => {
      setLoaderHidden(true);
      setBooted(true);
    }, reducedMotion ? 180 : 900);
    return () => window.clearTimeout(id);
  }, [ready, error, reducedMotion]);

  useEffect(() => {
    const boot = document.getElementById('boot');
    if (!boot || !ready) return;
    boot.classList.add('is-done');
    const id = window.setTimeout(() => boot.remove(), 900);
    return () => window.clearTimeout(id);
  }, [ready]);

  // ── Close an open detail once its scene is behind us ──────────────────
  useEffect(() => {
    const tick = () => {
      if (activeHotspot && scroll.t > SCENE_END[4] + 0.05) setActiveHotspot(null);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [activeHotspot]);

  // ── Keyboard: Home / End jump cleanly to either end ───────────────────
  useEffect(() => {
    if (!booted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      window.scrollTo({
        top: event.key === 'Home' ? 0 : document.body.scrollHeight,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booted, reducedMotion]);

  const retry = useCallback(() => window.location.reload(), []);

  return (
    <div className="app" ref={rootRef}>
      {/* ── Fixed 3D stage ─────────────────────────────────────────────── */}
      <div className="stage" aria-hidden="true">
        <Experience
          quality={qualitySettings}
          reducedMotion={reducedMotion}
          onQualityChange={setQuality}
          onSceneChange={setScene}
          onReady={handleReady}
          onError={handleError}
          dpr={dpr}
          onDprFactorRef={dprRef}
        />
        <div className="stage__scrim" />
        <div className="stage__vignette" />
        <div className="stage__grain" />
      </div>

      {/* ── Fixed chrome ───────────────────────────────────────────────── */}
      <header className="masthead">
        <p className="masthead__mark">
          <span className="masthead__marque">{SITE.marque}</span>
          <span className="masthead__model">{SITE.model}</span>
        </p>
        <p className="masthead__meta">
          <span>1987</span>
          <span className="rule" aria-hidden="true" />
          <span>Maranello</span>
        </p>
      </header>

      {booted ? <Hud activeScene={scene} onReplay={replay} quality={quality} /> : null}
      {booted ? <Hotspots active={activeHotspot} onSelect={setActiveHotspot} /> : null}
      {booted ? <ScrollHint /> : null}

      {/* ── Scrolling copy ─────────────────────────────────────────────── */}
      <main className="scroll">
        {SCENE_COPY.map((content) => (
          <section className="scene" key={content.id} data-scene={content.id - 1} id={`scene-${content.id}`}>
            <div className={`scene__frame scene__frame--${content.align}`}>
              <SceneBlock content={content} />
            </div>
          </section>
        ))}

        {/* The closing frame. See FINALE in content.ts for why it lives here. */}
        <div data-tail className="tail">
          <div className="scene__frame scene__frame--center scene__frame--finale">
            <SceneBlock content={FINALE} />
            <button type="button" className="btn btn--primary scene__replay" onClick={replay}>
              {SITE.replay}
            </button>
          </div>
        </div>
      </main>

      <Loader
        visible={!loaderHidden}
        progress={error ? 1 : progress.progress}
        status={statusFor(progress)}
        error={error}
        onRetry={retry}
      />
    </div>
  );
}

/**
 * The scroll affordance fades out the moment the story moves. Driven from
 * GSAP's existing ticker rather than React state, so it costs nothing.
 */
function ScrollHint() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ref_ = ref;
    const tick = () => {
      const node = ref_.current;
      if (!node) return;
      const on = scroll.t < 0.012 && scroll.ready;
      if (node.classList.contains('is-on') !== on) node.classList.toggle('is-on', on);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <div className="scroll-hint" ref={ref} aria-hidden="true">
      <span className="scroll-hint__label">Scroll</span>
      <span className="scroll-hint__line" />
    </div>
  );
}

function statusFor(progress: { progress: number; total: number; active: boolean }): string {
  if (!progress.active && progress.total > 0) return 'Compiling shaders';
  if (progress.progress > 0.94) return 'Lighting the studio';
  if (progress.progress > 0.72) return 'Uploading textures';
  if (progress.progress > 0.2) return 'Decoding geometry';
  return 'Requesting model';
}