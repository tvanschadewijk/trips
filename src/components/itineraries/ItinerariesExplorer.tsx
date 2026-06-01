'use client';

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  itineraryCategories,
  type PublicItinerary,
  type PublicItineraryCategory,
} from '@/lib/public-itineraries';

type ItinerariesExplorerProps = {
  itineraries: PublicItinerary[];
};

type SliderKey = 'activity' | 'aspiration' | 'romance';

const sliderLabels: Array<{ key: SliderKey; label: string; low: string; high: string }> = [
  { key: 'activity', label: 'Activity', low: 'Slow', high: 'Full' },
  { key: 'aspiration', label: 'Aspiration', low: 'Easy', high: 'Rare' },
  { key: 'romance', label: 'Romance', low: 'Low', high: 'High' },
];

export default function ItinerariesExplorer({ itineraries }: ItinerariesExplorerProps) {
  const router = useRouter();
  const [category, setCategory] = useState<PublicItineraryCategory>('all');
  const [minimums, setMinimums] = useState<Record<SliderKey, number>>({
    activity: 1,
    aspiration: 1,
    romance: 1,
  });

  const filtered = useMemo(() => {
    return itineraries.filter((itinerary) => {
      const categoryMatch =
        category === 'all' ? true : itinerary.categories.includes(category);
      return (
        categoryMatch &&
        itinerary.activity >= minimums.activity &&
        itinerary.aspiration >= minimums.aspiration &&
        itinerary.romance >= minimums.romance
      );
    });
  }, [category, itineraries, minimums]);

  const resetFilters = () => {
    setCategory('all');
    setMinimums({ activity: 1, aspiration: 1, romance: 1 });
  };

  const openItinerary = (
    event: MouseEvent<HTMLAnchorElement>,
    itinerary: PublicItinerary
  ) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    try {
      sessionStorage.setItem(`vt-itinerary:${itinerary.canonicalPath}`, JSON.stringify({
        heroImage: itinerary.image,
        name: itinerary.name,
        subtitle: itinerary.subtitle,
      }));
    } catch {}

    const startViewTransition = (document as Document & {
      startViewTransition?: (callback: () => Promise<void>) => void;
    }).startViewTransition;

    if (!startViewTransition) return;

    event.preventDefault();
    const card = event.currentTarget.closest('.itinerary-card');
    const frame = card?.querySelector('.itinerary-card-image-link') as HTMLElement | null;
    if (frame) frame.style.viewTransitionName = 'trip-hero';

    startViewTransition.call(document, async () => {
      router.push(itinerary.canonicalPath);
      await new Promise<void>((resolve) => {
        (window as unknown as Record<string, unknown>).__tripTransitionResolve = resolve;
        setTimeout(resolve, 700);
      });
    });
  };

  return (
    <section className="itinerary-explorer" aria-label="Itinerary catalogue">
      <aside className="itinerary-filters" aria-label="Itinerary filters">
        <div className="itinerary-filter-top">
          <span className="itinerary-filter-kicker">Browse by mood</span>
          <span className="itinerary-filter-count">{filtered.length} shown</span>
        </div>

        <div className="itinerary-segments" aria-label="Trip style">
          {itineraryCategories.map((item) => (
            <button
              key={item.id}
              className={item.id === category ? 'itinerary-segment is-active' : 'itinerary-segment'}
              type="button"
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="itinerary-sliders">
          {sliderLabels.map((slider) => (
            <label className="itinerary-slider" key={slider.key}>
              <span className="itinerary-slider-row">
                <span>{slider.label}</span>
                <output>{minimums[slider.key]}/5</output>
              </span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={minimums[slider.key]}
                onChange={(event) =>
                  setMinimums((current) => ({
                    ...current,
                    [slider.key]: Number(event.target.value),
                  }))
                }
              />
              <span className="itinerary-slider-scale" aria-hidden="true">
                <span>{slider.low}</span>
                <span>{slider.high}</span>
              </span>
            </label>
          ))}
        </div>

        <button className="itinerary-reset" type="button" onClick={resetFilters}>
          Reset filters
        </button>
      </aside>

      <div className="itinerary-grid" aria-live="polite">
        {filtered.map((itinerary) => (
          <article className="itinerary-card" key={itinerary.name}>
            <Link className="itinerary-card-image-link" href={itinerary.canonicalPath} aria-label={itinerary.name} onClick={(event) => openItinerary(event, itinerary)}>
              <img src={itinerary.image} alt="" className="itinerary-card-image" loading="lazy" />
            </Link>
            <div className="itinerary-card-body">
              <div className="itinerary-card-meta">
                <span>{itinerary.days} days</span>
                <span>{itinerary.destinations} destinations</span>
              </div>
              <h2>{itinerary.name}</h2>
              <p className="itinerary-card-subtitle">{itinerary.subtitle}</p>
              <p className="itinerary-card-summary">{itinerary.summary}</p>
              <div className="itinerary-score-row" aria-label="Trip scores">
                <span>A{itinerary.activity}</span>
                <span>S{itinerary.aspiration}</span>
                <span>R{itinerary.romance}</span>
              </div>
              <div className="itinerary-tags">
                {itinerary.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <Link className="itinerary-card-link" href={itinerary.canonicalPath} onClick={(event) => openItinerary(event, itinerary)}>
                Open itinerary
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
