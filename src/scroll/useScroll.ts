import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { scroll } from '../scene/stage.ts';

gsap.registerPlugin(ScrollTrigger);

/**
 * Owns the only scroll listener in the app.
 *
 * A single scrubbed tween drives `scroll.target`. Every other consumer — the
 * camera, the car, the light rig, the typography, the progress readout —
 * reads from that one number, which is why nothing can ever fight anything
 * else and why scrolling back up plays the story in reverse for free.
 */
export function useScrollDriver(root: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const element = root.current;
    if (!element) return;

    // One scrubbed tween is the page's only source of truth. `tween.progress()`
    // is the eased value GSAP computes for the scrub, so it is exactly the
    // weighted, reversible signal the render loop wants — no second trigger, no
    // second animation loop.
    const proxy = { t: 0 };
    const tween = gsap.to(proxy, {
      t: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: element,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.7,
        invalidateOnRefresh: true,
        onUpdate: () => {
          if (!scroll.locked) scroll.target = tween.progress();
        },
      },
    });

    scroll.target = tween.scrollTrigger?.progress ?? 0;
    scroll.t = scroll.target;

    if (import.meta.env.DEV) {
      const st = tween.scrollTrigger;
      // eslint-disable-next-line no-console
      console.info('[F40] scroll driver attached', {
        start: st?.start,
        end: st?.end,
        scroller: st?.scroller === window ? 'window' : String(st?.scroller),
        triggers: ScrollTrigger.getAll().length,
      });
    }

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [root, enabled]);
}

/**
 * Fades every scene block in and out against its own section. Separate from
 * the master timeline on purpose: copy should feel like editorial pacing
 * rather than a camera move.
 */
export function useCopyReveal(root: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const element = root.current;
    if (!element) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blocks = gsap.utils.toArray<HTMLElement>('[data-reveal]', element);

    const ctx = gsap.context(() => {
      // The closing frame rides in on the tail and holds to the end.
      const finale = element.querySelector('[data-tail] [data-reveal]');
      if (finale && !reduced) {
        gsap.fromTo(
          finale,
          { opacity: 0, yPercent: 10 },
          {
            opacity: 1,
            yPercent: 0,
            ease: 'none',
            scrollTrigger: { trigger: element.querySelector('[data-tail]'), start: 'top 94%', end: 'top 62%', scrub: 0.5 },
          },
        );
      }

      blocks.forEach((block) => {
        const scene = block.closest<HTMLElement>('[data-scene]');
        if (!scene) return;
        if (block.closest('[data-tail]')) return;
        const isHero = scene.dataset.scene === '1';
        // The closing credit hands over to the tail lock-up. They overlap in
        // scroll range by construction, so the credit leaves earlier and faster
        // than the default rule — only one block is ever loud at a time.
        const isCredit = scene.dataset.scene === '5';

        if (reduced) {
          gsap.set(block, { opacity: 1 });
          return;
        }

        if (!isHero) {
          gsap.fromTo(
            block,
            { opacity: 0, yPercent: 12 },
            {
              opacity: 1,
              yPercent: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: scene,
                start: 'top 88%',
                end: 'top 42%',
                scrub: 0.5,
              },
            },
          );
        }

        // Hold, then release. The block is sticky, so it only leaves the frame
        // as the section's bottom edge starts pushing it up.
        gsap.to(block, {
          opacity: 0,
          yPercent: isHero ? -12 : -7,
          ease: 'none',
          scrollTrigger: {
            trigger: scene,
            start: isHero ? 'top top' : isCredit ? 'bottom 100%' : 'bottom 92%',
            end: isHero ? 'bottom 45%' : isCredit ? 'bottom 80%' : 'bottom 44%',
            scrub: 0.5,
          },
        });
      });
    }, element);

    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [root, enabled]);
}