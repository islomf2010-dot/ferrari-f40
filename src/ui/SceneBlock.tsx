import type { SceneContent } from '../content.ts';

interface SceneBlockProps {
  content: SceneContent;
  children?: React.ReactNode;
}

/**
 * One scene of editorial copy. The 3D stage is fixed behind the page, so the
 * type sits in the margins and never sits on top of the car.
 */
export function SceneBlock({ content }: SceneBlockProps) {
  const { align } = content;

  return (
    <div className={`block block--${align}${content.variant ? ` block--${content.variant}` : ''}`} data-reveal>
      <p className="block__kicker">
        <span className="block__index">{content.index}</span>
        <span className="rule" aria-hidden="true" />
        <span className="block__kicker-text">{content.kicker}</span>
      </p>

      <h2 className="block__title">
        {content.title.map((line) => (
          <span className="block__line" key={line}>
            {line}
          </span>
        ))}
        {content.titleAccent?.map((line) => (
          <span className="block__line block__line--accent" key={line}>
            {line}
          </span>
        ))}
      </h2>

      {content.lede ? <p className="block__lede">{content.lede}</p> : null}

      {content.body?.map((paragraph) => (
        <p className="block__body" key={paragraph.slice(0, 32)}>
          {paragraph}
        </p>
      ))}

      {content.specs ? (
        <dl className="specs">
          {content.specs.map((spec) => (
            <div className="specs__row" key={spec.label}>
              <dt className="specs__label">{spec.label}</dt>
              <dd className="specs__value">
                {spec.value}
                {spec.unit ? <span className="specs__unit">{spec.unit}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {content.footnote ? <p className="block__footnote">{content.footnote}</p> : null}
    </div>
  );
}