'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ACCOMMODATION_REVIEW_LANES } from '@/lib/accommodation-review';
import type {
  AccommodationCandidate,
  AccommodationCandidateLink,
  AccommodationCandidateRating,
  AccommodationReview,
  AccommodationReviewDestination,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';

interface Props {
  tripId: string;
  tripData: TripData;
  initialDayNumber?: number;
  onTripDataUpdated?: (tripData: TripData) => void;
}

type ReviewResponse = {
  review: AccommodationReview;
  trip_data?: TripData | null;
};

type DestinationDisplayMode = 'hotel' | 'proposals';
type CandidateStatusValue = 'proposal' | 'booked';

function domainFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function laneLabel(lane: AccommodationReviewLane): string {
  if (lane === 'proposed') return 'Travel Agent Proposals';
  return ACCOMMODATION_REVIEW_LANES.find((item) => item.id === lane)?.label ?? lane;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function candidateLane(candidate: AccommodationCandidate): AccommodationReviewLane {
  const status = candidate.status?.toLowerCase();
  if (status === 'booked' || status === 'confirmed' || candidate.booking) return 'booked';
  return candidate.lane;
}

function candidateStatusValue(candidate: AccommodationCandidate): CandidateStatusValue {
  return candidateLane(candidate) === 'booked' ? 'booked' : 'proposal';
}

function displayModeForDestination(
  candidates: AccommodationCandidate[],
  isEditing: boolean
): DestinationDisplayMode {
  return candidates.some((candidate) => candidateLane(candidate) === 'booked') && !isEditing
    ? 'hotel'
    : 'proposals';
}

function displayCandidatesForDestination(
  candidates: AccommodationCandidate[],
  mode: DestinationDisplayMode
): AccommodationCandidate[] {
  if (mode === 'proposals') return candidates;
  const bookedCandidate = candidates.find((candidate) => candidateLane(candidate) === 'booked');
  return bookedCandidate ? [bookedCandidate] : candidates;
}

function destinationIdForDay(
  review: AccommodationReview,
  dayNumber: number | undefined
): string | undefined {
  if (!dayNumber) return undefined;
  return review.destinations.find((destination) =>
    destination.dayNumbers?.includes(dayNumber)
  )?.id;
}

function destinationStatus(candidates: AccommodationCandidate[]): {
  label: string;
  tone: 'booked' | 'needs-work' | 'dismissed';
} {
  const bookedCount = candidates.filter(
    (candidate) => candidateLane(candidate) === 'booked'
  ).length;
  if (bookedCount) return { label: 'Booked', tone: 'booked' };

  const activeCount = candidates.filter(
    (candidate) => candidateLane(candidate) !== 'booked'
  ).length;
  if (activeCount) return { label: 'Proposals', tone: 'needs-work' };

  if (candidates.length) return { label: 'Dismissed', tone: 'dismissed' };

  return { label: 'Empty', tone: 'needs-work' };
}

type CardDetailItem = {
  label: string;
  value: string;
};

const RATING_PLATFORMS: {
  key: keyof Pick<
    AccommodationCandidateRating,
    'hotelsCom' | 'tripadvisor' | 'bookingCom' | 'google'
  >;
  label: string;
  shortLabel: string;
}[] = [
  { key: 'bookingCom', label: 'Booking.com', shortLabel: 'Booking' },
  { key: 'google', label: 'Google', shortLabel: 'Google' },
  { key: 'tripadvisor', label: 'TripAdvisor', shortLabel: 'TripAdvisor' },
  { key: 'hotelsCom', label: 'Hotels.com', shortLabel: 'Hotels.com' },
];

function ratingText(candidate: AccommodationCandidate): string | null {
  const rating = candidate.ratings?.find((item) =>
    RATING_PLATFORMS.some((platform) => cleanText(item[platform.key]))
  );
  if (!rating) return null;
  return RATING_PLATFORMS.map((platform) => {
    const value = cleanText(rating[platform.key]);
    return value ? `${platform.shortLabel} ${value}` : null;
  }).filter(Boolean).join(' · ') || cleanText(rating.note);
}

function cardDetailItems(
  items: Array<[label: string, value: unknown]>
): CardDetailItem[] {
  return items
    .map(([label, value]) => {
      const text = cleanText(value);
      return text ? { label, value: text } : null;
    })
    .filter((item): item is CardDetailItem => Boolean(item));
}

function ratingRows(candidate: AccommodationCandidate): AccommodationCandidateRating[] {
  return (candidate.ratings ?? []).filter((rating) =>
    Boolean(
      cleanText(rating.name) ||
        cleanText(rating.checkedAt) ||
        cleanText(rating.note) ||
        RATING_PLATFORMS.some((platform) => cleanText(rating[platform.key]))
    )
  );
}

function stayDetailItems(candidate: AccommodationCandidate): CardDetailItem[] {
  return cardDetailItems([
    ['Dates', candidate.dates],
    ['Nights', candidate.nights ? `${candidate.nights} nt` : undefined],
    ['Address', candidate.address],
    ['Room', candidate.roomType],
    ['Check-in', candidate.checkIn],
    ['Check-out', candidate.checkOut],
    ['Phone', candidate.phone],
    ['Wi-Fi', candidate.wifi],
    ['Dog', candidate.dog],
    ['Parking', candidate.parking],
    ['Terms', candidate.terms],
    ['Policy', candidate.policyConfidence ? `${candidate.policyConfidence} confidence` : undefined],
  ]);
}

function rateDetailItems(candidate: AccommodationCandidate): CardDetailItem[] {
  const rateCheck = candidate.rateCheck;
  if (!rateCheck) return [];
  return cardDetailItems([
    ['Best', rateCheck.best],
    ['Direct', rateCheck.direct],
    ['OTA', rateCheck.ota],
    ['Status', rateCheck.status],
    ['Checked', rateCheck.checkedAt],
    ['Note', rateCheck.note],
  ]);
}

function noteDetailItems(candidate: AccommodationCandidate): CardDetailItem[] {
  return cardDetailItems([
    ['Watch-out', candidate.blockers],
    ['Action', candidate.action],
    ['Alternative', candidate.alternatives],
    ['Hotel note', candidate.hotelNote],
  ]);
}

function bookingDetailItems(candidate: AccommodationCandidate): CardDetailItem[] {
  const booking = candidate.booking;
  if (!booking) return [];
  return cardDetailItems([
    ['Source', booking.source],
    ['Confirmation', booking.confirmation],
    ['Price', booking.price],
    ['Booked', booking.bookedAt],
    ['Note', booking.note],
  ]);
}

function feedbackDetailItems(candidate: AccommodationCandidate): CardDetailItem[] {
  const feedbackLoop = candidate.feedbackLoop;
  if (!feedbackLoop) return [];
  return cardDetailItems([
    ['Feedback', feedbackLoop.userFeedback],
    ['Codex', feedbackLoop.codexResponse],
    ['Next', feedbackLoop.nextStep],
    ['Updated', feedbackLoop.updatedAt],
  ]);
}

function candidateLinks(candidate: AccommodationCandidate): AccommodationCandidateLink[] {
  const links: AccommodationCandidateLink[] = [];
  const seen = new Set<string>();

  for (const link of [
    ...(candidate.links ?? []),
    ...(candidate.rateCheck?.sources ?? []),
    candidate.policySource,
  ]) {
    if (!link?.url) continue;
    const key = link.url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }

  return links;
}

function writeReviewContext(
  destination?: AccommodationReviewDestination,
  candidate?: AccommodationCandidate
) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      'trip-chat-context',
      JSON.stringify({
        slideKind: 'accommodation_review',
        title: 'Accommodations',
        destination_id: destination?.id ?? null,
        destination_title: destination?.title ?? null,
        candidate_id: candidate?.id ?? null,
        candidate_name: candidate?.candidate ?? null,
      })
    );
  } catch {}
}

export default function AccommodationReviewBoard({
  tripId,
  tripData,
  initialDayNumber,
  onTripDataUpdated,
}: Props) {
  const [review, setReview] = useState<AccommodationReview | null>(null);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(null);
  const [mobileReviewMode, setMobileReviewMode] = useState<'overview' | 'edit'>('overview');
  const [editingDestinationIds, setEditingDestinationIds] = useState<Set<string>>(
    () => new Set()
  );
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [bookingPrompt, setBookingPrompt] = useState<{
    candidateId: string;
    lane: AccommodationReviewLane;
    conflictCandidateId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onReviewUpdated = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!detail?.tripId || detail.tripId === tripId) {
        setReloadToken((value) => value + 1);
      }
    };

    window.addEventListener('ourtrips:accommodation-review-updated', onReviewUpdated);
    return () => {
      window.removeEventListener('ourtrips:accommodation-review-updated', onReviewUpdated);
    };
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;
    async function loadReview() {
      setError(null);
      try {
        const response = await fetch(`/api/trips/${tripId}/accommodation-review`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const json = (await response.json()) as ReviewResponse;
        if (cancelled) return;
        setReview(json.review);
        setActiveDestinationId((current) => {
          const currentIsValid = current && json.review.destinations.some(
            (destination) => destination.id === current
          );
          if (currentIsValid) return current;
          return destinationIdForDay(json.review, initialDayNumber)
            ?? json.review.destinations[0]?.id
            ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    loadReview();
    return () => {
      cancelled = true;
    };
  }, [initialDayNumber, tripId, tripData, reloadToken]);

  const destinations = review?.destinations ?? [];
  const activeDestination = useMemo(() => {
    if (!destinations.length) return undefined;
    return (
      destinations.find((destination) => destination.id === activeDestinationId) ??
      destinations[0]
    );
  }, [activeDestinationId, destinations]);

  useEffect(() => {
    writeReviewContext(activeDestination);
  }, [activeDestination]);

  const candidatesForDestination = useMemo(() => {
    if (!review || !activeDestination) return [];
    return review.accommodations.filter(
      (candidate) => candidate.destinationId === activeDestination.id
    );
  }, [activeDestination, review]);

  useEffect(() => {
    if (!destinations.length) return;
    const destinationIds = new Set(destinations.map((destination) => destination.id));
    setEditingDestinationIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (destinationIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [destinations]);

  const activeDestinationEditing = Boolean(
    activeDestination && editingDestinationIds.has(activeDestination.id)
  );
  const activeDestinationMode = displayModeForDestination(
    candidatesForDestination,
    activeDestinationEditing
  );
  const visibleCandidatesForDestination = displayCandidatesForDestination(
    candidatesForDestination,
    activeDestinationMode
  );
  const activeDestinationHasBooked = candidatesForDestination.some(
    (candidate) => candidateLane(candidate) === 'booked'
  );
  const activeLaneLabel =
    activeDestinationMode === 'hotel' ? 'Hotel' : 'Travel Agent Proposals';

  const allDestinationsBooked = useMemo(() => {
    if (!review || !destinations.length) return false;
    return destinations.every((destination) =>
      review.accommodations.some(
        (candidate) =>
          candidate.destinationId === destination.id &&
          candidateLane(candidate) === 'booked'
      )
    );
  }, [destinations, review]);

  const bookedOverviewItems = useMemo(() => {
    if (!review) return [];
    return destinations.flatMap((destination) =>
      review.accommodations
        .filter(
          (candidate) =>
            candidate.destinationId === destination.id &&
            candidateLane(candidate) === 'booked'
        )
        .map((candidate) => ({ candidate, destination }))
    );
  }, [destinations, review]);

  useEffect(() => {
    if (!review) return;
    if (!allDestinationsBooked) {
      setMobileReviewMode('edit');
    }
  }, [allDestinationsBooked, review]);

  const setDestinationEditing = useCallback((destinationId: string, isEditing: boolean) => {
    setEditingDestinationIds((current) => {
      const next = new Set(current);
      if (isEditing) {
        next.add(destinationId);
      } else {
        next.delete(destinationId);
      }
      return next;
    });
  }, []);

  const moveCandidate = useCallback(
    async (candidateId: string, lane: AccommodationReviewLane, confirmed = false) => {
      if (!review) return;
      const candidate = review.accommodations.find((item) => item.id === candidateId);
      if (!candidate) return;
      const currentLane = candidateLane(candidate);
      if (lane === 'booked' ? currentLane === 'booked' : currentLane !== 'booked') return;

      if (lane === 'booked' && !confirmed) {
        const destination = review.destinations.find(
          (item) => item.id === candidate.destinationId
        );
        const existingBooked = review.accommodations.find(
          (item) =>
            item.id !== candidateId &&
            item.destinationId === candidate.destinationId &&
            candidateLane(item) === 'booked'
        );
        writeReviewContext(destination, candidate);
        setBookingPrompt({
          candidateId,
          lane,
          conflictCandidateId: existingBooked?.id,
        });
        return;
      }

      setSavingCandidateId(candidateId);
      setError(null);
      try {
        const response = await fetch(`/api/trips/${tripId}/accommodation-review`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'move_candidate',
            candidate_id: candidateId,
            lane,
            message: `Moved to ${laneLabel(lane)} from the in-trip accommodations reviewer.`,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (response.status === 409 && body.code === 'destination_already_booked') {
            setBookingPrompt({
              candidateId,
              lane,
              conflictCandidateId:
                typeof body.existing_candidate_id === 'string'
                  ? body.existing_candidate_id
                  : undefined,
            });
            return;
          }
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const json = (await response.json()) as ReviewResponse;
        setReview(json.review);
        setDestinationEditing(candidate.destinationId, lane !== 'booked');
        if (json.trip_data) {
          onTripDataUpdated?.(json.trip_data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingCandidateId(null);
      }
    },
    [onTripDataUpdated, review, setDestinationEditing, tripId]
  );

  const replaceBookedCandidate = useCallback(
    async (candidateId: string) => {
      if (!review) return;
      const candidate = review.accommodations.find((item) => item.id === candidateId);
      if (!candidate || candidateLane(candidate) === 'booked') return;

      setSavingCandidateId(candidateId);
      setError(null);
      try {
        const response = await fetch(`/api/trips/${tripId}/accommodation-review`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'replace_booked_candidate',
            candidate_id: candidateId,
            message: `Changed hotel to ${candidate.candidate} from the in-trip accommodations reviewer.`,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const json = (await response.json()) as ReviewResponse;
        setReview(json.review);
        setDestinationEditing(candidate.destinationId, false);
        if (json.trip_data) {
          onTripDataUpdated?.(json.trip_data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingCandidateId(null);
      }
    },
    [onTripDataUpdated, review, setDestinationEditing, tripId]
  );

  const bookingCandidate = useMemo(() => {
    if (!review || !bookingPrompt) return undefined;
    return review.accommodations.find((candidate) => candidate.id === bookingPrompt.candidateId);
  }, [bookingPrompt, review]);

  const conflictingBookedCandidate = useMemo(() => {
    if (!review || !bookingPrompt?.conflictCandidateId) return undefined;
    return review.accommodations.find(
      (candidate) => candidate.id === bookingPrompt.conflictCandidateId
    );
  }, [bookingPrompt, review]);

  const renderCandidateCard = (
    candidate: AccommodationCandidate,
    options: {
      destination?: AccommodationReviewDestination;
      showActions?: boolean;
      showDestination?: boolean;
    } = {}
  ) => {
    const cardDestination = options.destination ?? activeDestination;
    const showActions = options.showActions ?? true;
    const stayDetails = stayDetailItems(candidate);
    const rateDetails = rateDetailItems(candidate);
    const notes = noteDetailItems(candidate);
    const bookings = bookingDetailItems(candidate);
    const feedback = feedbackDetailItems(candidate);
    const ratings = ratingRows(candidate);
    const links = candidateLinks(candidate);
    const isBooked = candidateLane(candidate) === 'booked';

    return (
      <article
        key={candidate.id}
        className={`accommodation-review-card${savingCandidateId === candidate.id ? ' saving' : ''}${showActions ? '' : ' overview-card'}${isBooked ? ' is-booked' : ''}`}
        tabIndex={0}
        onClick={() => writeReviewContext(cardDestination, candidate)}
        onFocus={() => writeReviewContext(cardDestination, candidate)}
      >
        {options.showDestination && cardDestination && (
          <div className="accommodation-review-card-destination">
            <span>{cardDestination.title}</span>
            <span>{cardDestination.dates}</span>
          </div>
        )}

        <div className="accommodation-review-card-topline">
          <div className="accommodation-review-card-title">
            <h4>{candidate.candidate}</h4>
            {isBooked && <span className="accommodation-review-card-badge">Booked</span>}
          </div>
          {candidate.price && <span className="accommodation-review-card-price">{candidate.price}</span>}
        </div>

        {candidate.why && (
          <p className="accommodation-review-card-copy">{candidate.why}</p>
        )}

        {stayDetails.length ? (
          <dl className="accommodation-review-card-detail-grid">
            {stayDetails.map((item) => (
              <div key={`${candidate.id}-stay-${item.label}`} className="accommodation-review-card-detail">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {ratings.length ? (
          <section className="accommodation-review-card-section accommodation-review-card-ratings">
            <h5>Ratings</h5>
            {ratings.map((rating, ratingIndex) => (
              <div
                key={`${candidate.id}-rating-${rating.name ?? ratingIndex}`}
                className="accommodation-review-rating-row"
              >
                {(rating.name || rating.checkedAt) && (
                  <div className="accommodation-review-rating-meta">
                    {rating.name && <span>{rating.name}</span>}
                    {rating.checkedAt && <span>Checked {rating.checkedAt}</span>}
                  </div>
                )}
                <div className="accommodation-review-rating-platforms">
                  {RATING_PLATFORMS.map((platform) => {
                    const value = cleanText(rating[platform.key]);
                    return (
                      <span
                        key={`${candidate.id}-rating-${ratingIndex}-${platform.key}`}
                        className={`accommodation-review-rating-platform${value ? '' : ' is-missing'}`}
                      >
                        <b>{platform.label}</b>
                        <span>{value ?? 'Not found'}</span>
                      </span>
                    );
                  })}
                </div>
                {rating.note && <p>{rating.note}</p>}
              </div>
            ))}
          </section>
        ) : ratingText(candidate) ? (
          <div className="accommodation-review-card-rating">
            <span className="accommodation-review-card-rating-label">Ratings</span>
            <span>{ratingText(candidate)}</span>
          </div>
        ) : null}

        {rateDetails.length ? (
          <section className="accommodation-review-card-section">
            <h5>Rates</h5>
            <dl>
              {rateDetails.map((item) => (
                <div key={`${candidate.id}-rate-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {links.length ? (
          <div className="accommodation-review-links">
            {links.map((link) => (
              <a
                key={`${candidate.id}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                title={link.url}
                onClick={(event) => event.stopPropagation()}
              >
                <span>{link.label}</span>
                <small>{domainFor(link.url)}</small>
              </a>
            ))}
          </div>
        ) : null}

        {notes.length ? (
          <section className="accommodation-review-card-section accommodation-review-card-notes">
            <h5>Decision notes</h5>
            <dl>
              {notes.map((item) => (
                <div key={`${candidate.id}-note-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {bookings.length ? (
          <section className="accommodation-review-card-section">
            <h5>Booking</h5>
            <dl>
              {bookings.map((item) => (
                <div key={`${candidate.id}-booking-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {feedback.length ? (
          <section className="accommodation-review-card-section accommodation-review-card-feedback">
            <h5>Feedback tracker</h5>
            <dl>
              {feedback.map((item) => (
                <div key={`${candidate.id}-feedback-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {showActions && (
          <div
            className="accommodation-review-card-actions"
            aria-label={`Set status for ${candidate.candidate}`}
          >
            {isBooked ? (
              <span className="accommodation-review-status-badge">Current hotel</span>
            ) : (
              <label className="accommodation-review-status-control">
                <span>Status</span>
                <select
                  value={candidateStatusValue(candidate)}
                  disabled={savingCandidateId === candidate.id}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    writeReviewContext(cardDestination, candidate);
                    if (event.currentTarget.value === 'booked') {
                      moveCandidate(candidate.id, 'booked');
                    }
                  }}
                >
                  <option value="proposal">Proposal</option>
                  <option value="booked">Booked</option>
                </select>
              </label>
            )}
          </div>
        )}
      </article>
    );
  };

  if (error && !review) {
    return (
      <div className="accommodation-review-empty">
        <div className="accommodation-review-empty-title">Accommodations unavailable</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="accommodation-review-empty">
        <div className="accommodation-review-empty-title">Loading stays</div>
      </div>
    );
  }

  if (!destinations.length) {
    return (
      <div className="accommodation-review-empty">
        <div className="accommodation-review-empty-title">No stay stops yet</div>
        <p>{tripData.trip.name} does not have accommodation candidates attached yet.</p>
      </div>
    );
  }

  const boardClassName = [
    'accommodation-review-board',
    allDestinationsBooked ? 'all-booked' : null,
    allDestinationsBooked && mobileReviewMode === 'overview'
      ? 'mobile-overview-mode'
      : null,
  ].filter(Boolean).join(' ');

  return (
    <div className={boardClassName}>
      {allDestinationsBooked && (
        <section className="accommodation-review-booked-overview" aria-label="Booked stays">
          <div className="accommodation-review-booked-overview-header">
            <div>
              <div className="accommodation-review-kicker">Booked stays</div>
              <h3>{tripData.trip.name}</h3>
              <p>{bookedOverviewItems.length} stays confirmed</p>
            </div>
            <button
              type="button"
              className="accommodation-review-mode-button"
              onClick={() => setMobileReviewMode('edit')}
            >
              Edit
            </button>
          </div>
          <div className="accommodation-review-booked-overview-list">
            {bookedOverviewItems.map(({ candidate, destination }) =>
              renderCandidateCard(candidate, {
                destination,
                showActions: false,
                showDestination: true,
              })
            )}
          </div>
        </section>
      )}

      <nav className="accommodation-review-nav" aria-label="Overnight Stays">
        <div className="accommodation-review-nav-header">
          <div className="accommodation-review-nav-heading">Overnight Stays</div>
        </div>
        <div className="accommodation-review-nav-list">
          {destinations.map((destination) => {
            const destinationCandidates = review.accommodations.filter(
              (candidate) => candidate.destinationId === destination.id
            );
            const status = destinationStatus(destinationCandidates);
            return (
              <button
                type="button"
                key={destination.id}
                className={`accommodation-review-nav-item status-${status.tone}${destination.id === activeDestination?.id ? ' active' : ''}`}
                onClick={() => {
                  setActiveDestinationId(destination.id);
                  writeReviewContext(destination);
                }}
              >
                <span className="accommodation-review-nav-title">{destination.title}</span>
                <span className="accommodation-review-nav-meta">
                  {[destination.dates, destination.nights ? `${destination.nights} nt` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className={`accommodation-review-nav-status ${status.tone}`}>
                  <span aria-hidden="true" />
                  <span>{status.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="accommodation-review-main">
        <div className="accommodation-review-destination">
          <div>
            <h3>{activeDestination?.title}</h3>
          </div>
          <div className="accommodation-review-header-actions">
            {allDestinationsBooked && (
              <span className="accommodation-review-complete-pill">All booked</span>
            )}
            {activeDestination && activeDestinationHasBooked && (
              <button
                type="button"
                className="accommodation-review-mode-button accommodation-review-edit-button"
                onClick={() => {
                  setDestinationEditing(activeDestination.id, !activeDestinationEditing);
                  if (mobileReviewMode === 'overview') setMobileReviewMode('edit');
                }}
              >
                {activeDestinationEditing ? 'Show hotel' : 'Change hotel'}
              </button>
            )}
            {error && <div className="accommodation-review-error">{error}</div>}
          </div>
        </div>

        <div className="accommodation-review-kanban">
          <section
            className={`accommodation-review-lane lane-${activeDestinationMode}`}
          >
            <div className="accommodation-review-lane-header">
              <span>{activeLaneLabel}</span>
            </div>

            <div className="accommodation-review-card-stack">
              {visibleCandidatesForDestination.map((candidate) => renderCandidateCard(candidate))}

              {visibleCandidatesForDestination.length === 0 && (
                <div className="accommodation-review-lane-empty" />
              )}
            </div>
          </section>
        </div>
      </div>

      {bookingPrompt && bookingCandidate && (
        <div
          className="accommodation-review-booking-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accommodation-review-booking-title"
        >
          <div className="accommodation-review-booking-dialog">
            <div className="accommodation-review-booking-kicker">
              {bookingPrompt.conflictCandidateId ? 'Change hotel' : 'Confirm booking'}
            </div>
            <h3 id="accommodation-review-booking-title">{bookingCandidate.candidate}</h3>
            {bookingPrompt.conflictCandidateId ? (
              <p>
                {conflictingBookedCandidate?.candidate ?? 'Another stay'} is currently marked as
                the hotel for {bookingCandidate.stop}. Change the booking to{' '}
                {bookingCandidate.candidate}?
              </p>
            ) : (
              <p>
                Mark this stay as booked and add it to the trip plan for{' '}
                {bookingCandidate.stop}.
              </p>
            )}
            <div className="accommodation-review-booking-actions">
              {bookingPrompt.conflictCandidateId ? (
                <>
                  <button
                    type="button"
                    className="accommodation-review-booking-secondary"
                    onClick={() => setBookingPrompt(null)}
                  >
                    Keep current
                  </button>
                  <button
                    type="button"
                    className="accommodation-review-booking-primary"
                    onClick={() => {
                      const prompt = bookingPrompt;
                      setBookingPrompt(null);
                      replaceBookedCandidate(prompt.candidateId);
                    }}
                  >
                    Change booking
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="accommodation-review-booking-secondary"
                    onClick={() => setBookingPrompt(null)}
                  >
                    Keep reviewing
                  </button>
                  <button
                    type="button"
                    className="accommodation-review-booking-primary"
                    onClick={() => {
                      const prompt = bookingPrompt;
                      setBookingPrompt(null);
                      moveCandidate(prompt.candidateId, prompt.lane, true);
                    }}
                  >
                    Mark booked
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
