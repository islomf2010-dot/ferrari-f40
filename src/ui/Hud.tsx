import { useEffect, useRef } from 'react';
import gsap from 'gsap';

import { SCENES } from '../scroll/story.ts';
import { scroll } from '../scene/stage.ts';

interface HudProps {
  activeScene: number;
  onReplay: () => void;
  quality: string;
}

/**
 * Fixed chrome: the running scene index, a hairline progress rule and the
 * replay control. Driven from `gsap.ticker`, which reuses ScrollTrigger's
 * existing rAF rather than starting a second animation loop.
 */
export function Hud({ activeScene, onReplay, quality }: HudProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  const lastPercent = useRef('');

  useEffect(() => {
    const tick = () => {
      const t = scroll.t;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${t})`;
      if (percentRef.current) {
        const value = String(Math.round(t * 100)).padStart(3, '0');
        if (value !== lastPercent.current) {
          lastPercent.current = value;
          percentRef.current.textContent = value;
        }
      }
      // The replay control only earns its place once the visitor has actually
      // started the story — and it steps aside for the closing frame, which
      // carries its own.
      const engaged = t > 0.02 && t < 0.93;
      const root = rootRef.current;
      if (root && root.classList.contains('is-engaged') !== engaged) root.classList.toggle('is-engaged', engaged);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  const meta = SCENES.find((s) => s.id === activeScene) ?? SCENES[0];

  return (
    <div className="hud" ref={rootRef}>
      <div className="hud__rail" aria-hidden="true">
        <div className="hud__rail-fill" ref={progressRef} />
      </div>

      <div className="hud__row">
        <p className="hud__left">
          <span className="hud__marque">Ferrari</span>
          <span className="hud__sep" aria-hidden="true" />
          <span className="hud__model">F40</span>
        </p>

        <p className="hud__center" aria-live="polite">
          <span className="hud__index">{meta.index}</span>
          <span className="hud__kicker">{meta.kicker}</span>
        </p>

        <p className="hud__right">
          <span className="hud__percent" ref={percentRef}>
            000
          </span>
          <span className="hud__unit">%</span>
          <span className="hud__quality" title={`Render quality: ${quality}`}>
            {quality}
          </span>
        </p>
      </div>

      <button type="button" className="btn btn--replay" onClick={onReplay}>
        <span className="btn__glyph" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" />
            <path d="M13.6 1.9v3.1h-3.1" />
          </svg>
        </span>
        Replay experience
      </button>
    </div>
  );
}