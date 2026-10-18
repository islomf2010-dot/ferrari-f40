export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  dpr: [number, number];
  shadows: boolean;
  shadowMapSize: number;
  /** Floor reflection costs an extra full-scene pass; iGPUs may not afford it. */
  reflector: boolean;
  shadowRadius: number;
}

const PRESETS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  high: { dpr: [1, 2], shadows: true, shadowMapSize: 2048, reflector: true, shadowRadius: 3 },
  medium: { dpr: [1, 1.5], shadows: true, shadowMapSize: 1024, reflector: true, shadowRadius: 2 },
  low: { dpr: [1, 1.15], shadows: true, shadowMapSize: 512, reflector: false, shadowRadius: 1 },
};

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

/** Coarse pointer (phone / tablet) always starts at the low tier. */
function initialTier(): QualityTier {
  if (typeof window === 'undefined') return 'medium';
  const forced = new URLSearchParams(window.location.search).get('q');
  if (forced === 'high' || forced === 'medium' || forced === 'low') return forced;
  if (window.matchMedia('(pointer: coarse)').matches) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 4) return 'low';
  if (cores <= 8) return 'medium';
  return 'high';
}

export function settingsFor(tier: QualityTier): QualitySettings {
  return { tier, ...PRESETS[tier] };
}

export function initialQuality(): QualitySettings {
  return settingsFor(initialTier());
}

/**
 * Watches frame time and steps the tier down if the machine cannot keep up.
 * Never steps back up: hunting between tiers is more distracting than being
 * one notch conservative.
 */
export class QualityGovernor {
  private samples = 0;
  private accum = 0;
  private strikes = 0;

  constructor(
    private tier: QualityTier,
    private onChange: (tier: QualityTier) => void,
  ) {}

  get current(): QualityTier {
    return this.tier;
  }

  get settings(): QualitySettings {
    return settingsFor(this.tier);
  }

  sample(deltaSeconds: number): void {
    if (deltaSeconds <= 0 || deltaSeconds > 0.5) return;
    this.accum += deltaSeconds;
    this.samples++;
    if (this.accum < 1.6) return;

    const fps = this.samples / this.accum;
    this.accum = 0;
    this.samples = 0;

    // Ignore the first window: shader compilation dominates it.
    if (fps >= 45) {
      this.strikes = 0;
      return;
    }
    if (fps >= 34) {
      this.strikes += 0.5;
    } else {
      this.strikes += 1;
    }
    if (this.strikes < 2) return;

    const next = ORDER[Math.min(ORDER.indexOf(this.tier) + 1, ORDER.length - 1)];
    this.strikes = 0;
    if (next === this.tier) return;
    this.tier = next;
    this.onChange(next);
  }
}