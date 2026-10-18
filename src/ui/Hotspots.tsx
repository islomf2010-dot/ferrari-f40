import { useEffect } from 'react';

import { HOTSPOTS } from '../scroll/story.ts';
import { registerHotspotElement } from '../scene/HotspotProjector.tsx';

interface HotspotsProps {
  active: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * DOM markers. Positioning is owned by HotspotProjector inside the render
 * loop; React only owns the content and the click handling.
 */
export function Hotspots({ active, onSelect }: HotspotsProps) {
  useEffect(() => {
    return () => {
      HOTSPOTS.forEach((spot) => registerHotspotElement(spot.id, null));
    };
  }, []);

  const activeSpot = HOTSPOTS.find((spot) => spot.id === active) ?? null;

  return (
    <>
      <div className="hotspots" aria-live="polite">
        {HOTSPOTS.map((spot, index) => (
          <button
            key={spot.id}
            type="button"
            className={`hotspot${active === spot.id ? ' is-active' : ''}`}
            ref={(el) => registerHotspotElement(spot.id, el)}
            style={{ visibility: 'hidden' }}
            aria-label={`${spot.label} — open detail`}
            aria-pressed={active === spot.id}
            onClick={() => onSelect(active === spot.id ? null : spot.id)}
          >
            <span className="hotspot__pulse" aria-hidden="true" />
            <span className="hotspot__core" aria-hidden="true" />
            <span className="hotspot__tag" aria-hidden="true">
              <span className="hotspot__num">{String(index + 1).padStart(2, '0')}</span>
              <span className="hotspot__name">{spot.label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className={`detail${activeSpot ? ' is-open' : ''}`} aria-hidden={!activeSpot}>
        {activeSpot ? (
          <div className="detail__card" role="dialog" aria-label={activeSpot.label}>
            <p className="detail__kicker">
              <span className="detail__index">
                {String(HOTSPOTS.indexOf(activeSpot) + 1).padStart(2, '0')}
              </span>
              <span className="rule" aria-hidden="true" />
              {activeSpot.spec}
            </p>
            <h3 className="detail__title">{activeSpot.label}</h3>
            <p className="detail__body">{activeSpot.body}</p>
            <button type="button" className="detail__close" onClick={() => onSelect(null)}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}