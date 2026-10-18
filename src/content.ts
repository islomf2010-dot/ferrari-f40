import type { SceneId } from './scroll/story.ts';

export interface SpecItem {
  value: string;
  unit?: string;
  label: string;
}

/**
 * All copy lives here so the DOM, the HUD and the print stylesheet can never
 * disagree about what a scene says.
 *
 * Figures are for the original European-specification F40 built 1987–1992.
 */
export interface SceneContent {
  id: SceneId;
  index: string;
  kicker: string;
  align: 'center' | 'left' | 'right';
  /** Centred scenes come in three very different sizes. */
  variant?: 'hero' | 'finale' | 'credit';
  title: string[];
  titleAccent?: string[];
  lede?: string;
  body?: string[];
  specs?: SpecItem[];
  footnote?: string;
  marquee?: string;
}

export const SCENE_COPY: SceneContent[] = [
  {
    id: 1,
    index: '01',
    kicker: 'The Legend',
    align: 'center',
    variant: 'hero',
    title: ['Ferrari'],
    titleAccent: ['F40'],
    lede: 'Born to be unforgettable.',
  },
  {
    id: 2,
    index: '02',
    kicker: 'The Silhouette',
    align: 'left',
    title: ['Pure form.'],
    titleAccent: ['No unnecessary', 'details.'],
    body: [
      'The F40 is a wedge with nothing left on it. The nose falls away in a single line, the pop-up headlamps fold down into it and vanish, and every crease across the flank exists to move air rather than to decorate a panel.',
      'Nothing interrupts the surface. There are no door handles to catch the light, no trim to break the shoulder — only the shape, and the light running along it.',
    ],
  },
  {
    id: 3,
    index: '03',
    kicker: 'Engineered For Speed',
    align: 'right',
    title: ['Engineered'],
    titleAccent: ['for speed.'],
    body: [
      'Two turbochargers, five valves per cylinder, and a rear bodywork shaped entirely around feeding the engine and the radiators that kept it alive.',
    ],
    specs: [
      { value: '2.9', unit: 'L', label: 'Twin-turbocharged V8' },
      { value: '478', unit: 'PS', label: 'European specification' },
      { value: '4.1', unit: 's', label: '0–100 km/h' },
      { value: '324', unit: 'km/h', label: 'Top speed' },
    ],
    footnote: 'Original European-specification F40 · 1987–1992',
  },
  {
    id: 4,
    index: '04',
    kicker: 'Form Follows Function',
    align: 'left',
    title: ['Form follows'],
    titleAccent: ['function.'],
    body: [
      'Every opening in the bodywork earns its place. Select a marker to read what the shape is actually doing.',
    ],
    footnote: 'All markers correspond to geometry present in the source model.',
  },
  {
    id: 5,
    index: '05',
    kicker: 'The Legacy',
    align: 'right',
    title: ['Unveiled in'],
    titleAccent: ['1987.'],
    body: [
      'Revealed at the Bologna Motor Show in 1987 to mark Ferrari’s fortieth anniversary — and named for it. The F40 carried forty years of competition history and, by the end of production in 1992, had become one of the most identifiable shapes ever built. It was the last car signed off personally by Enzo Ferrari.',
    ],
    specs: [
      { value: '1,311', label: 'Cars produced' },
      { value: '1987', label: 'First shown' },
      { value: '1992', label: 'Last built' },
    ],
    footnote: 'Bologna Motor Show · 1987',
  },
  {
    id: 6,
    index: '06',
    kicker: 'Final Reveal',
    align: 'center',
    variant: 'credit',
    title: ['Ferrari F40'],
    body: ['1,311 built between 1987 and 1992'],
    footnote: 'Maranello · Italy',
  },
];

/**
 * The lock-up lives in the page tail rather than in a scene section.
 *
 * The page is exactly one viewport taller than its scrollable distance — that
 * is what makes scroll position map linearly onto story time — so the last
 * viewport is always the tail. That makes it the natural home for the closing
 * frame, and it guarantees the final composition is perfectly framed the
 * moment the visitor stops scrolling.
 */
export const FINALE: SceneContent = {
  id: 6,
  index: '06',
  kicker: 'Final Reveal',
  align: 'center',
  variant: 'finale',
  title: ['Not built', 'to follow.'],
  titleAccent: ['Built to be', 'remembered.'],
  body: ['Ferrari F40 · 1987'],
};

export const SITE = {
  marque: 'Ferrari',
  model: 'F40',
  tagline: 'Born to be unforgettable.',
  replay: 'Replay experience',
} as const;