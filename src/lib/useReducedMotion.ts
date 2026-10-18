import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `true` when the visitor has asked the OS to reduce motion.
 *
 * When set, the experience drops the materialise sweep, the idle camera drift
 * and the film grain, and heavily damps the scroll camera so the page reads as
 * a calm, still gallery instead of a moving one.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    setReduced(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}