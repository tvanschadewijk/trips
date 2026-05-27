'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';

import { ACCOMMODATION_REVIEW_LANES } from '@/lib/accommodation-review';
import type {
  AccommodationCandidate,
  AccommodationReview,
  AccommodationReviewDestination,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';

interface Props {
  tripId: string;
  tripData: TripData;
  onTripDataUpdated?: (tripData: TripData) => void;
}

type ReviewResponse = {
  review: AccommodationReview;
  trip_data?: TripData | null;
};

function domainFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function laneLabel(lane: AccommodationReviewLane): string {
  return ACCOMMODATION_REVIEW_LANES.find((item) => item.id === lane)?.label ?? lane;
}

function destinationStatus(candidates: AccommodationCandidate[]): {
  label: string;
  tone: 'booked' | 'needs-work' | 'dismissed';
} {
  const bookedCount = candidates.filter((candidate) => candidate.lane === 'booked').length;
  if (bookedCount) return { label: 'Booked', tone: 'booked' };

  const activeCount = candidates.filter(
    (candidate) => candidate.lane === 'proposed' || candidate.lane === 'considering'
  ).length;
  if (activeCount) return { label: 'Review', tone: 'needs-work' };

  if (candidates.length) return { label: 'Dismissed', tone: 'dismissed' };

  return { label: 'Empty', tone: 'needs-work' };
}

function ratingText(candidate: AccommodationCandidate): string | null {
  const rating = candidate.ratings?.[0];
  if (!rating) return null;
  return [
    rating.hotelsCom ? `Hotels.com ${rating.hotelsCom}` : null,
    rating.tripadvisor ? `Tripadvisor ${rating.tripadvisor}` : null,
    rating.bookingCom ? `Booking ${rating.bookingCom}` : null,
    rating.google ? `Google ${rating.google}` : null,
  ].filter(Boolean).join(' · ') || rating.note || null;
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
        title: 'Accommodation review',
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
  onTripDataUpdated,
}: Props) {
  const [review, setReview] = useState<AccommodationReview | null>(null);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(null);
  const [draggingCandidateId, setDraggingCandidateId] = useState<string | null>(null);
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
  const [bookingPrompt, setBookingPrompt] = useState<{
    candidateId: string;
    lane: AccommodationReviewLane;
    conflictCandidateId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setActiveDestinationId((current) => current ?? json.review.destinations[0]?.id ?? null);
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
  }, [tripId]);

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

  const moveCandidate = useCallback(
    async (candidateId: string, lane: AccommodationReviewLane, confirmed = false) => {
      if (!review) return;
      const candidate = review.accommodations.find((item) => item.id === candidateId);
      if (!candidate || candidate.lane === lane) return;

      if (lane === 'booked' && !confirmed) {
        const destination = review.destinations.find(
          (item) => item.id === candidate.destinationId
        );
        const existingBooked = review.accommodations.find(
          (item) =>
            item.id !== candidateId &&
            item.destinationId === candidate.destinationId &&
            item.lane === 'booked'
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
            message: `Moved to ${laneLabel(lane)} from the in-trip Kanban board.`,
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
        if (json.trip_data) {
          onTripDataUpdated?.(json.trip_data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingCandidateId(null);
      }
    },
    [onTripDataUpdated, review, tripId]
  );

  const handleCandidateDrop = useCallback(
    (event: DragEvent<HTMLElement>, lane: AccommodationReviewLane) => {
      event.preventDefault();
      event.stopPropagation();
      const droppedCandidateId =
        draggingCandidateId || event.dataTransfer.getData('text/plain');
      if (droppedCandidateId) {
        moveCandidate(droppedCandidateId, lane);
      }
      setDraggingCandidateId(null);
    },
    [draggingCandidateId, moveCandidate]
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

  if (error && !review) {
    return (
      <div className="accommodation-review-empty">
        <div className="accommodation-review-empty-title">Accommodation review unavailable</div>
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

  return (
    <div className="accommodation-review-board">
      <nav className="accommodation-review-nav" aria-label="Stays">
        <div className="accommodation-review-nav-header">
          <div className="accommodation-review-nav-trip-title" title={tripData.trip.name}>
            {tripData.trip.name}
          </div>
          <div className="accommodation-review-nav-heading">Stays</div>
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
            <div className="accommodation-review-kicker">Stay review</div>
            <h3>{activeDestination?.title}</h3>
          </div>
          {error && <div className="accommodation-review-error">{error}</div>}
        </div>

        <div className="accommodation-review-kanban">
          {ACCOMMODATION_REVIEW_LANES.map((lane) => {
            const laneCandidates = candidatesForDestination.filter(
              (candidate) => candidate.lane === lane.id
            );
            return (
              <section
                key={lane.id}
                className={`accommodation-review-lane lane-${lane.id}${draggingCandidateId ? ' drag-active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => handleCandidateDrop(event, lane.id)}
              >
                <div className="accommodation-review-lane-header">
                  <span>{lane.label}</span>
                  <span>{laneCandidates.length}</span>
                </div>

                <div
                  className="accommodation-review-card-stack"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => handleCandidateDrop(event, lane.id)}
                >
                  {laneCandidates.map((candidate) => (
                    <article
                      key={candidate.id}
                      className={`accommodation-review-card${savingCandidateId === candidate.id ? ' saving' : ''}`}
                      draggable={savingCandidateId !== candidate.id}
                      tabIndex={0}
                      onClick={() => writeReviewContext(activeDestination, candidate)}
                      onFocus={() => writeReviewContext(activeDestination, candidate)}
                      onDragStart={(event) => {
                        setDraggingCandidateId(candidate.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', candidate.id);
                        writeReviewContext(activeDestination, candidate);
                      }}
                      onDragEnd={() => setDraggingCandidateId(null)}
                    >
                      <div className="accommodation-review-card-topline">
                        <h4>{candidate.candidate}</h4>
                        {candidate.price && <span>{candidate.price}</span>}
                      </div>

                      {candidate.why && (
                        <p className="accommodation-review-card-copy">{candidate.why}</p>
                      )}

                      <div className="accommodation-review-card-facts">
                        {candidate.rateCheck?.best && (
                          <span>Best {candidate.rateCheck.best}</span>
                        )}
                        {candidate.parking && <span>Parking {candidate.parking}</span>}
                        {candidate.dog && <span>Dog {candidate.dog}</span>}
                      </div>

                      {ratingText(candidate) && (
                        <div className="accommodation-review-card-rating">
                          <span className="accommodation-review-card-rating-label">Ratings</span>
                          <span>{ratingText(candidate)}</span>
                        </div>
                      )}

                      {candidate.links?.length ? (
                        <div className="accommodation-review-links">
                          {candidate.links.slice(0, 2).map((link) => (
                            <a
                              key={`${candidate.id}-${link.url}`}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              title={domainFor(link.url)}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span>{link.label}</span>
                            </a>
                          ))}
                        </div>
                      ) : null}

                      {(candidate.blockers || candidate.action || candidate.terms) && (
                        <div className="accommodation-review-card-notes">
                          {candidate.blockers && <span>{candidate.blockers}</span>}
                          {candidate.action && <span>{candidate.action}</span>}
                          {candidate.terms && <span>{candidate.terms}</span>}
                        </div>
                      )}
                    </article>
                  ))}

                  {laneCandidates.length === 0 && (
                    <div className="accommodation-review-lane-empty" />
                  )}
                </div>
              </section>
            );
          })}
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
              {bookingPrompt.conflictCandidateId ? 'Already booked' : 'Confirm booking'}
            </div>
            <h3 id="accommodation-review-booking-title">
              {bookingPrompt.conflictCandidateId
                ? bookingCandidate.stop
                : bookingCandidate.candidate}
            </h3>
            {bookingPrompt.conflictCandidateId ? (
              <p>
                {conflictingBookedCandidate?.candidate ?? 'Another stay'} is already marked as
                booked for this destination. Move it out of Booked before booking{' '}
                {bookingCandidate.candidate}.
              </p>
            ) : (
              <p>
                Move this stay to Booked and add it to the trip plan for{' '}
                {bookingCandidate.stop}.
              </p>
            )}
            <div className="accommodation-review-booking-actions">
              {bookingPrompt.conflictCandidateId ? (
                <button
                  type="button"
                  className="accommodation-review-booking-primary"
                  onClick={() => setBookingPrompt(null)}
                >
                  Got it
                </button>
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
