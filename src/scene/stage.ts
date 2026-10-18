import { SCROLL_VH, SCENES } from '../scroll/story.ts';

/**
 * The single mutable hand-off between the scroll layer and the render loop.
 *
 * GSAP's ScrollTrigger writes `target`; the render loop damps `t` towards it.
 * Nothing in here is React state, so scrolling never triggers a re-render.
 */
export const scroll = {
  /** Smoothed story time actually used for rendering. */
  t: 0,
  /** Raw ScrollTrigger progress. */
  target: 0,
  /** Story-time units per second, smoothed. Positive = scrolling down. */
  velocity: 0,
  /** True once the first frame with the model has been rendered. */
  ready: false,
  /** Frames rendered since mount — lets tooling wait on real rendered output. */
  frame: 0,
  /** Set by tooling to place the story clock by hand instead of via the scrub. */
  locked: false,
  /** Set when the model or the environment could not be loaded. */
  error: null as Error | null,
  /** Bumped by the replay control so consumers can react without polling. */
  replayCount: 0,
};

export function sectionHeightVh(sceneIndex: number): number {
  return SCENES[sceneIndex].span * SCROLL_VH;
}

/** Applies the section heights that make scroll == story time. */
export function applyLayout(root: HTMLElement | null): void {
  if (!root) return;
  const sections = root.querySelectorAll<HTMLElement>('[data-scene]');
  sections.forEach((el) => {
    const index = Number(el.dataset.scene);
    if (Number.isFinite(index)) el.style.height = `${sectionHeightVh(index)}vh`;
  });
  // The tail is exactly one viewport tall. Combined with the sections above
  // it, that makes the scrollable distance equal the section total, which is
  // what lets scroll position map linearly onto story time.
  const tail = root.querySelector<HTMLElement>('[data-tail]');
  if (tail) tail.style.height = '100vh';
}

/** Scrolls back to the top of the story without a hard jump. */
export function replay(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  scroll.replayCount++;
}