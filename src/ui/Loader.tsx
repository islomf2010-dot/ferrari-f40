interface LoaderProps {
  /** 0..1 */
  progress: number;
  status: string;
  error: Error | null;
  onRetry: () => void;
  visible: boolean;
}

const STAGES = [
  { at: 0.02, label: 'Requesting model' },
  { at: 0.18, label: 'Decoding geometry' },
  { at: 0.72, label: 'Uploading textures' },
  { at: 0.94, label: 'Lighting the studio' },
];

function stageLabel(progress: number): string {
  let label = STAGES[0].label;
  for (const s of STAGES) if (progress >= s.at) label = s.label;
  return label;
}

/**
 * First-paint curtain. It holds for a beat even on a warm cache so the reveal
 * never flashes, and it becomes a real error screen when the model fails.
 */
export function Loader({ progress, status, error, onRetry, visible }: LoaderProps) {
  const pct = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <div
      className={`loader${visible ? '' : ' is-hidden'}${error ? ' is-error' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!error}
    >
      <div className="loader__inner">
        <p className="loader__eyebrow">Scuderia · Maranello</p>
        <h2 className="loader__mark">
          <span>Ferrari</span>
          <span className="loader__mark-model">F40</span>
        </h2>

        {error ? (
          <>
            <p className="loader__error-title">The model could not be loaded.</p>
            <p className="loader__error-body">{error.message}</p>
            <button type="button" className="btn btn--ghost loader__retry" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="loader__track" aria-hidden="true">
              <div className="loader__bar" style={{ transform: `scaleX(${Math.max(progress, 0.02)})` }} />
            </div>
            <div className="loader__meta">
              <span className="loader__status">{status || stageLabel(progress)}</span>
              <span className="loader__pct">{String(pct).padStart(3, '0')}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}