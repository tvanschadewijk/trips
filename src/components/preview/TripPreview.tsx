'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import type { TripData, Day, Transport, Accommodation, Tip, Meal } from '@/lib/types';
import { ICONS } from './icons';
import '@/styles/preview.css';

/** Extract 3-letter IATA airport codes from a string like "Amsterdam (AMS) → New York (JFK)" */
function extractIataCodes(s: string): string[] {
  const matches = s.match(/\b[A-Z]{3}\b/g);
  return matches || [];
}

interface TripPreviewProps {
  trips: TripData[];
  onDelete?: (index: number) => void;
  autoOpen?: boolean;
  shareId?: string;
  tripId?: string;
}

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
}

function formatDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', opts);
}

const MAX_VISIBLE_DOTS = 7;
const TRIP_HERO_TRANSITION_NAME = 'trip-hero';

function SwipeDots({ total, current, onDotClick }: { total: number; current: number; onDotClick: (i: number) => void }) {
  if (total <= MAX_VISIBLE_DOTS) {
    return (
      <div className="swipe-dots" role="tablist" aria-label="Trip slides">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`swipe-dot ${i === current ? 'active' : ''}`}
            role="tab" aria-selected={i === current} aria-label={i === 0 ? 'Overview' : `Day ${i}`}
            tabIndex={i === current ? 0 : -1}
            style={{ cursor: 'pointer' }} onClick={() => onDotClick(i)} />
        ))}
      </div>
    );
  }

  // Windowed: show MAX_VISIBLE_DOTS dots centered on current, with edge dots shrinking
  const half = Math.floor(MAX_VISIBLE_DOTS / 2);
  let windowStart = current - half;
  if (windowStart < 0) windowStart = 0;
  if (windowStart + MAX_VISIBLE_DOTS > total) windowStart = total - MAX_VISIBLE_DOTS;

  const hasLeft = windowStart > 0;
  const hasRight = windowStart + MAX_VISIBLE_DOTS < total;

  return (
    <div className="swipe-dots" role="tablist" aria-label="Trip slides">
      {hasLeft && <div className="swipe-dot-fade left" />}
      {Array.from({ length: MAX_VISIBLE_DOTS }).map((_, vi) => {
        const i = windowStart + vi;
        const isEdge = (vi === 0 && hasLeft) || (vi === MAX_VISIBLE_DOTS - 1 && hasRight);
        const isNearEdge = (vi === 1 && hasLeft) || (vi === MAX_VISIBLE_DOTS - 2 && hasRight);
        const scale = isEdge ? 0.5 : isNearEdge ? 0.75 : 1;
        return (
          <div key={i} className={`swipe-dot ${i === current ? 'active' : ''}`}
            role="tab" aria-selected={i === current} aria-label={i === 0 ? 'Overview' : `Day ${i}`}
            tabIndex={i === current ? 0 : -1}
            style={{ cursor: 'pointer', transform: `scale(${scale})`, opacity: isEdge ? 0.3 : undefined }}
            onClick={() => onDotClick(i)} />
        );
      })}
      {hasRight && <div className="swipe-dot-fade right" />}
    </div>
  );
}

export default function TripPreview({ trips: initialTrips, onDelete, autoOpen, shareId, tripId }: TripPreviewProps) {
  const [trips, setTrips] = useState(initialTrips);
  const [activeTripIndex, setActiveTripIndex] = useState<number | null>(autoOpen ? 0 : null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContent, setDetailContent] = useState<{ title: string; html: string }>({ title: '', html: '' });
  const [overviewFaded, setOverviewFaded] = useState(autoOpen ? true : false);
  const [transitionTripIndex, setTransitionTripIndex] = useState<number | null>(autoOpen ? 0 : null);
  const [showArchive, setShowArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'already_saved' | 'already_owned' | 'error'>('idle');
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const onImgError = useCallback((src: string) => {
    setBrokenImages(prev => { const next = new Set(prev); next.add(src); return next; });
  }, []);

  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dateStripRef = useRef<HTMLDivElement>(null);
  const dateStripDragged = useRef(false);
  const detailBodyRef = useRef<HTMLDivElement>(null);

  // Touch state
  const touchState = useRef({ startX: 0, startY: 0, startTime: 0, dx: 0, isDragging: false, isScrolling: null as boolean | null });
  const didAutoNav = useRef(false);

  const trip = activeTripIndex !== null ? trips[activeTripIndex]?.trip : null;
  const days = activeTripIndex !== null ? trips[activeTripIndex]?.days || [] : [];
  const totalSlides = 1 + days.length;
  const isHero = currentSlide === 0;

  const startViewTransition = useCallback((update: () => void) => {
    const vt = (document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    }).startViewTransition;

    if (!vt) {
      update();
      return null;
    }

    return vt.call(document, update);
  }, []);

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, totalSlides - 1));
    setCurrentSlide(clamped);
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(-${clamped * 100}cqi)`;
      trackRef.current.classList.remove('dragging');
    }
    // Scroll active date into view (scoped to date strip only — scrollIntoView
    // can scroll parent containers too, shifting the entire viewport on later days)
    setTimeout(() => {
      const strip = dateStripRef.current;
      const activeBtn = strip?.querySelector('.date-btn.active') as HTMLElement | null;
      if (strip && activeBtn) {
        const stripRect = strip.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        const scrollLeft = strip.scrollLeft + (btnRect.left + btnRect.width / 2) - (stripRect.left + stripRect.width / 2);
        strip.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }, 50);
    // Reset scroll position of ALL slides (so previous day isn't scrolled down
    // when the user swipes back to it)
    const slides = trackRef.current?.querySelectorAll('.slide');
    slides?.forEach((s) => { (s as HTMLElement).scrollTop = 0; });
  }, [totalSlides]);

  // Open trip with grow animation
  const openTrip = useCallback((idx: number, cardEl: HTMLElement) => {
    const td = trips[idx];
    if (!td.days.length) return;

    const heroFrame = cardEl.querySelector('.trip-card-media') as HTMLElement | null;
    if (heroFrame) {
      heroFrame.style.viewTransitionName = TRIP_HERO_TRANSITION_NAME;
    }

    flushSync(() => {
      setTransitionTripIndex(idx);
    });

    startViewTransition(() => {
      flushSync(() => {
        setActiveTripIndex(idx);
        setCurrentSlide(0);
        setOverviewFaded(true);
      });
    });
  }, [startViewTransition, trips]);

  const closeTrip = useCallback(() => {
    if (activeTripIndex === null || autoOpen) return;

    flushSync(() => {
      setTransitionTripIndex(activeTripIndex);
    });

    const transition = startViewTransition(() => {
      flushSync(() => {
        setOverviewFaded(false);
        setCurrentSlide(0);
        setActiveTripIndex(null);
      });
    });

    if (transition) {
      transition.finished.finally(() => {
        setTransitionTripIndex(null);
      });
      return;
    }

    setTransitionTripIndex(null);
  }, [activeTripIndex, autoOpen, startViewTransition]);

  // Signal view transition readiness (coordinates with dashboard startViewTransition)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.__tripTransitionResolve === 'function') {
      (w.__tripTransitionResolve as () => void)();
      w.__tripTransitionResolve = null;
    }
  }, []);

  // Handle nav back
  const handleBack = useCallback(() => {
    if (currentSlide > 0) goTo(0);
    else if (autoOpen) {
      // Re-set vt-trip so the dashboard can apply viewTransitionName on the matching card
      const seg = window.location.pathname.split('/').pop();
      if (seg) sessionStorage.setItem('vt-trip', seg);
      const vt = (document as unknown as { startViewTransition?: (cb: () => void) => void }).startViewTransition;
      if (vt) {
        vt.call(document, () => { window.history.back(); });
      } else {
        window.history.back();
      }
    }
    else closeTrip();
  }, [currentSlide, goTo, autoOpen, closeTrip]);

  // Save (clone) trip to user's account
  async function handleAddToTrips() {
    if (!shareId) return;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/trips/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_id: shareId }),
      });
      if (res.status === 401) {
        // Not logged in — save intent and redirect to login
        sessionStorage.setItem('save-trip-after-login', shareId);
        window.location.href = `/login?next=${encodeURIComponent(`/t/${shareId}`)}`;
        return;
      }
      const data = await res.json();
      if (data.already_owned) {
        setSaveStatus('already_owned');
      } else if (data.status === 'already_saved') {
        setSaveStatus('already_saved');
      } else if (data.status === 'saved') {
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }

  // Auto-save trip after login redirect
  useEffect(() => {
    if (!shareId) return;
    const pending = sessionStorage.getItem('save-trip-after-login');
    if (pending === shareId) {
      sessionStorage.removeItem('save-trip-after-login');
      handleAddToTrips();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  // Touch handlers
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || activeTripIndex === null) return;

    const onStart = (e: TouchEvent) => {
      touchState.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startTime: Date.now(), dx: 0, isDragging: true, isScrolling: null };
    };
    const onMove = (e: TouchEvent) => {
      const ts = touchState.current;
      if (!ts.isDragging) return;
      const moveX = e.touches[0].clientX - ts.startX;
      const moveY = e.touches[0].clientY - ts.startY;
      if (ts.isScrolling === null) {
        const absX = Math.abs(moveX);
        const absY = Math.abs(moveY);
        const totalMove = Math.sqrt(moveX * moveX + moveY * moveY);
        // Wait for at least 15px of total displacement before deciding direction.
        // This prevents premature locking from tiny finger drift.
        if (totalMove < 15) return;
        // Use angle-based detection: only treat as a horizontal swipe when the
        // gesture is within ~22° of the horizontal axis (absX > absY * 2.5).
        // Everything else is treated as vertical scroll. This strongly biases
        // toward keeping native scroll working, which is the main complaint.
        ts.isScrolling = absX <= absY * 2.5;
      }
      if (ts.isScrolling) return;
      // Confirmed horizontal swipe — take over from the browser
      e.preventDefault();
      trackRef.current?.classList.add('dragging');
      ts.dx = moveX;
      if (trackRef.current) trackRef.current.style.transform = `translateX(calc(-${currentSlide * 100}cqi + ${ts.dx}px))`;
    };
    const onEnd = () => {
      const ts = touchState.current;
      if (!ts.isDragging) return;
      ts.isDragging = false;
      trackRef.current?.classList.remove('dragging');
      if (ts.isScrolling || ts.isScrolling === null) return;
      // Use both distance threshold and velocity for swipe detection.
      // A fast flick (velocity > 0.3px/ms) with at least 30px of movement
      // should also trigger a slide change, even if below the 20% threshold.
      const elapsed = Math.max(Date.now() - ts.startTime, 1);
      const velocity = Math.abs(ts.dx) / elapsed;
      const distThreshold = vp.offsetWidth * 0.2;
      const isSwipe = Math.abs(ts.dx) > distThreshold || (velocity > 0.3 && Math.abs(ts.dx) > 30);
      if (isSwipe && ts.dx < 0 && currentSlide < totalSlides - 1) goTo(currentSlide + 1);
      else if (isSwipe && ts.dx > 0 && currentSlide > 0) goTo(currentSlide - 1);
      else goTo(currentSlide);
    };

    vp.addEventListener('touchstart', onStart, { passive: true });
    vp.addEventListener('touchmove', onMove, { passive: false });
    vp.addEventListener('touchend', onEnd, { passive: true });
    vp.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      vp.removeEventListener('touchstart', onStart);
      vp.removeEventListener('touchmove', onMove);
      vp.removeEventListener('touchend', onEnd);
      vp.removeEventListener('touchcancel', onEnd);
    };
  }, [activeTripIndex, currentSlide, totalSlides, goTo]);

  // Date strip: suppress click after drag/scroll
  useEffect(() => {
    const strip = dateStripRef.current;
    if (!strip) return;
    let startX = 0;
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; dateStripDragged.current = false; };
    const onTouchMove = (e: TouchEvent) => { if (Math.abs(e.touches[0].clientX - startX) > 6) dateStripDragged.current = true; };
    strip.addEventListener('touchstart', onTouchStart, { passive: true });
    strip.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => { strip.removeEventListener('touchstart', onTouchStart); strip.removeEventListener('touchmove', onTouchMove); };
  }, [activeTripIndex]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeTripIndex === null) return;
      if (detailOpen) {
        if (e.key === 'Escape') closeDetail();
        return;
      }
      if (e.key === 'ArrowRight') goTo(currentSlide + 1);
      if (e.key === 'ArrowLeft') goTo(currentSlide - 1);
      if (e.key === 'Escape') { if (currentSlide === 0) closeTrip(); else goTo(0); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTripIndex, currentSlide, detailOpen, goTo, closeTrip]);

  // Auto-navigate to today's date if it falls within a trip
  useEffect(() => {
    if (didAutoNav.current) return;
    didAutoNav.current = true;

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      const start = new Date(t.trip.dates.start + 'T12:00:00');
      const end = new Date(t.trip.dates.end + 'T12:00:00');
      if (today >= start && today <= end) {
        // Find which day matches today
        const todayStr = today.toISOString().slice(0, 10);
        const dayIdx = t.days.findIndex(d => d.date === todayStr);
        const slideIdx = dayIdx >= 0 ? dayIdx + 1 : 1; // +1 because slide 0 is hero

        // Open the matching trip and navigate to the day
        setTransitionTripIndex(i);
        setActiveTripIndex(i);
        setOverviewFaded(true);
        setCurrentSlide(slideIdx);
        setTimeout(() => {
          if (trackRef.current) {
            trackRef.current.style.transform = `translateX(-${slideIdx * 100}cqi)`;
          }
          const strip = dateStripRef.current;
          const activeBtn = strip?.querySelector('.date-btn.active') as HTMLElement | null;
          if (strip && activeBtn) {
            const stripRect = strip.getBoundingClientRect();
            const btnRect = activeBtn.getBoundingClientRect();
            const scrollLeft = strip.scrollLeft + (btnRect.left + btnRect.width / 2) - (stripRect.left + stripRect.width / 2);
            strip.scrollTo({ left: scrollLeft, behavior: 'smooth' });
          }
        }, 100);
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detail sheet
  function openDetail(type: 'transport' | 'accommodation' | 'tip' | 'meal', item: Transport | Accommodation | Tip | Meal) {
    if (type === 'tip') {
      const tip = item as Tip;
      setDetailContent({
        title: tip.title,
        html: `<div class="detail-tip-body"><p class="detail-tip-text">${tip.content}</p></div>`
      });
      setDetailOpen(true);
      window.history.pushState({ detail: true }, '');
      return;
    }
    if (type === 'meal') {
      const m = item as Meal;
      if (!m.detail) return;
      const d = m.detail;
      const fields: [string, string | undefined][] = [
        ['Cuisine', d.cuisine], ['Price range', d.price_range], ['Address', d.address],
        ['Phone', d.phone], ['Hours', d.hours],
        ['Reservation', d.reservation], ['Booked via', d.booking_platform], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value${l === 'Phone' ? ' mono' : ''}">${l === 'Phone' ? `<a href="tel:${v}">${v}</a>` : v}</span></div>`
      ).join('');
      setDetailContent({
        title: m.name,
        html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Restaurant Details</span></div>${rows}</div>`
      });
      setDetailOpen(true);
      window.history.pushState({ detail: true }, '');
      return;
    }
    if (!item || !(item as Transport).detail && !(item as Accommodation).detail) return;

    if (type === 'transport') {
      const t = item as Transport;
      const d = t.detail!;
      const title = t.label || 'Transport';
      const fields: [string, string | undefined][] = [
        ['Route', `${t.from || ''} \u2192 ${t.to || ''}`],
        ['Departure', t.depart], ['Arrival', t.arrive], ['Duration', t.duration],
        ['Distance', t.distance],
        ['Driving route', d.route],
        ['Platform', d.platform], ['Flight', d.flight], ['Terminal', d.terminal], ['Gate', d.gate],
        ['Class', d.class], ['Cabin', d.cabin], ['Seats', d.seats || d.seat],
        ['Booking ref', d.booking_ref], ['Booked via', d.booking_platform],
        ['Cabin bag', d.cabin_bag], ['Hold bag', d.hold_bag], ['Check-in', d.check_in],
        ['Amenities', d.amenities], ['Cancellation', d.cancellation_policy], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value">${v}</span></div>`
      ).join('');

      let chargingHtml = '';
      if (d.charging_stops?.length) {
        const stops = d.charging_stops.map(s =>
          `<div class="detail-charging-stop"><div class="detail-charging-name">${s.name}</div>${s.location ? `<div class="detail-charging-meta">${s.location}</div>` : ''}${s.network ? `<div class="detail-charging-meta">Network: ${s.network}${s.kw ? ` \u00b7 ${s.kw}` : ''}</div>` : ''}${s.note ? `<div class="detail-charging-note">${s.note}</div>` : ''}</div>`
        ).join('');
        chargingHtml = `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Charging Stops</span></div>${stops}</div>`;
      }

      let borderHtml = '';
      if (d.border) {
        const b = d.border;
        borderHtml = `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Border Crossing</span></div><div class="detail-row"><span class="detail-row-label">Crossing</span><span class="detail-row-value">${b.name}</span></div>${b.documents ? `<div class="detail-row"><span class="detail-row-label">Documents</span><span class="detail-row-value">${b.documents}</span></div>` : ''}${b.note ? `<div class="detail-row"><span class="detail-row-label">Note</span><span class="detail-row-value">${b.note}</span></div>` : ''}</div>`;
      }

      setDetailContent({
        title,
        html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${t.mode === 'plane' ? 'Flight' : t.mode === 'car' ? 'Driving' : 'Journey'} Details</span></div>${rows}</div>${chargingHtml}${borderHtml}`
      });
    } else {
      const a = item as Accommodation;
      const d = a.detail!;
      const fields: [string, string | undefined][] = [
        ['Room type', d.room_type], ['Check-in', d.check_in], ['Check-out', d.check_out],
        ['Nights', a.nights ? a.nights + (a.nights > 1 ? ' nights' : ' night') : undefined],
        ['Price', a.price], ['Address', d.address],
        ['Phone', d.phone], ['Confirmation', d.confirmation], ['Booked via', d.booking_platform],
        ['Cancel by', d.cancellation_deadline], ['WiFi', d.wifi], ['Parking', d.parking], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value${l === 'Phone' ? ' mono' : ''}">${l === 'Phone' ? `<a href="tel:${v}">${v}</a>` : v}</span></div>`
      ).join('');
      setDetailContent({
        title: a.name || 'Accommodation',
        html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Booking Details</span></div>${rows}</div>`
      });
    }
    setDetailOpen(true);
    window.history.pushState({ detail: true }, '');
  }

  function closeDetail() {
    if (detailOpen) {
      setDetailOpen(false);
      window.history.back();
    }
  }

  // Handle browser back to close detail sheet
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      if (detailOpen) {
        e.preventDefault();
        setDetailOpen(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [detailOpen]);

  // Toggle action item status (owner only)
  function handleToggleStatus(dayNumber: number, itemType: string, itemIndex: number, newStatus: 'booked' | 'pending') {
    if (!tripId || activeTripIndex === null) return;

    // Optimistic update
    flushSync(() => {
      setTrips(prev => {
        const updated = [...prev];
        const tripCopy = JSON.parse(JSON.stringify(updated[activeTripIndex])) as TripData;
        const day = tripCopy.days.find(d => d.day_number === dayNumber);
        if (!day) return prev;

        const statusVal = newStatus === 'booked' ? 'booked' : undefined;

        if (itemType === 'transport' && day.transport?.[itemIndex]) {
          day.transport[itemIndex].status = statusVal;
        } else if (itemType === 'accommodation' && day.accommodation) {
          // Update all days with same accommodation name
          const accomName = day.accommodation.name;
          for (const d of tripCopy.days) {
            if (d.accommodation?.name === accomName) {
              d.accommodation.status = statusVal;
            }
          }
        } else if (itemType === 'meal' && day.meals?.[itemIndex]) {
          day.meals[itemIndex].status = statusVal;
        }

        updated[activeTripIndex] = tripCopy;
        return updated;
      });
    });

    // Rebuild detail content from updated state
    const thingsToDo = buildThingsToDoHtml();
    setDetailContent({
      title: thingsToDo.allDone ? 'Ready to Go' : 'Action Items',
      html: thingsToDo.html,
    });

    // Persist to database
    fetch(`/api/trips/${tripId}/toggle-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_number: dayNumber, item_type: itemType, item_index: itemIndex, new_status: newStatus }),
    }).catch(() => { /* silently fail — optimistic update stands */ });
  }

  // Event delegation for action item clicks
  useEffect(() => {
    const el = detailBodyRef.current;
    if (!el || !tripId) return;

    const handler = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest('.todo-item') as HTMLElement | null;
      if (!row) return;

      const dayNumber = Number(row.dataset.day);
      const itemType = row.dataset.type!;
      const itemIndex = Number(row.dataset.index);
      const wasDone = row.dataset.done === 'true';

      handleToggleStatus(dayNumber, itemType, itemIndex, wasDone ? 'pending' : 'booked');
    };

    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  });

  // Delete trip
  function handleDeleteTrip(idx: number) {
    onDelete?.(idx);
    setTrips(prev => prev.filter((_, i) => i !== idx));
    setDeleteConfirm(null);
  }

  // Split trips into upcoming and archive
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const upcomingTrips: { td: TripData; origIdx: number }[] = [];
  const archiveTrips: { td: TripData; origIdx: number }[] = [];
  trips.forEach((td, idx) => {
    const endD = new Date(td.trip.dates.end + 'T12:00:00');
    if (endD < now) archiveTrips.push({ td, origIdx: idx });
    else upcomingTrips.push({ td, origIdx: idx });
  });

  // Render overview cards
  function renderTripCard(td: TripData, origIdx: number) {
    const t = td.trip;
    const img = t.overview_image || t.hero_image;
    const startD = new Date(t.dates.start + 'T12:00:00');
    const endD = new Date(t.dates.end + 'T12:00:00');
    const startStr = startD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const endStr = endD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const nights = Math.round((endD.getTime() - startD.getTime()) / 86400000);
    const dayCount = td.days.length;
    const isPast = endD < now;
    const statusLabel = isPast ? 'Completed' : (dayCount === 0 ? 'Planning' : `${nights} nights`);

    return (
      <div key={origIdx} className="trip-card" role="button" tabIndex={0} aria-label={`${t.name} — ${t.subtitle}`} onClick={(e) => {
        if ((e.target as HTMLElement).closest('.trip-card-delete')) return;
        openTrip(origIdx, e.currentTarget);
      }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrip(origIdx, e.currentTarget as HTMLElement); } }}>
        <div
          className="trip-card-media"
          style={activeTripIndex === null && transitionTripIndex === origIdx ? { viewTransitionName: TRIP_HERO_TRANSITION_NAME } as React.CSSProperties : undefined}
        >
          <Image className="trip-card-img" src={img} alt={t.name} fill sizes="430px" style={{ objectFit: 'cover', opacity: brokenImages.has(img) ? 0 : 1 }} onError={() => onImgError(img)} />
          <div className="trip-card-gradient" />
        </div>
        <div className="trip-card-badge">{statusLabel}</div>
        {onDelete && <button className="trip-card-delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(origIdx); }} aria-label={`Delete ${t.name}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>}
        <div className="trip-card-body">
          <div className="trip-card-dates">{startStr} — {endStr}</div>
          <div className="trip-card-name">{t.name}</div>
          <div className="trip-card-subtitle">{t.subtitle}</div>
          <div className="trip-card-stats">
            <div className="trip-card-stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
              {nights} nights
            </div>
            {dayCount > 0 ? (
              <div className="trip-card-stat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>
                {dayCount} days
              </div>
            ) : (
              <div className="trip-card-stat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                Coming soon
              </div>
            )}
            <div className="trip-card-stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              {t.travelers.length}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Overview section builders ---

  function buildLogisticsHtml(): { html: string; hasData: boolean } {
    const legs: { day: number; date: string; t: Transport }[] = [];
    for (const d of days) {
      if (d.transport?.length) {
        for (const t of d.transport) legs.push({ day: d.day_number, date: d.date, t });
      }
    }
    if (!legs.length) return { html: '', hasData: false };
    const rows = legs.map(({ day, date, t }) => {
      const dateLabel = formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
      const route = [t.from, t.to].filter(Boolean).join(' → ');
      const times = [t.depart, t.arrive].filter(Boolean).join(' – ');
      return `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <span class="detail-row-label" style="width:auto">Day ${day} · ${dateLabel}</span>
          ${t.status ? `<span class="text-status status-badge status-${t.status}">${t.status}</span>` : ''}
        </div>
        <span class="detail-row-value" style="text-align:left;font-size:15px;font-weight:600">${t.label || route}</span>
        ${route && t.label ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${route}</span>` : ''}
        ${times || t.duration ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${[times, t.duration].filter(Boolean).join(' · ')}</span>` : ''}
      </div>`;
    }).join('');
    return { html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">All Transport</span></div>${rows}</div>`, hasData: true };
  }

  function buildAccommodationHtml(): { html: string; hasData: boolean } {
    const seen = new Set<string>();
    const accoms: { a: Accommodation; dayStart: number; dateStart: string }[] = [];
    for (const d of days) {
      if (d.accommodation && !seen.has(d.accommodation.name)) {
        seen.add(d.accommodation.name);
        accoms.push({ a: d.accommodation, dayStart: d.day_number, dateStart: d.date });
      }
    }
    if (!accoms.length) return { html: '', hasData: false };
    const rows = accoms.map(({ a, dateStart }) => {
      const dateLabel = formatDate(dateStart, { weekday: 'short', day: 'numeric', month: 'short' });
      const meta = [a.price, a.rating, a.nights ? `${a.nights} night${a.nights > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
      return `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <span class="detail-row-label" style="width:auto">From ${dateLabel}</span>
          ${a.status ? `<span class="text-status status-badge status-${a.status}">${a.status}</span>` : ''}
        </div>
        <span class="detail-row-value" style="text-align:left;font-size:15px;font-weight:600">${a.name}</span>
        ${meta ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${meta}</span>` : ''}
        ${a.note ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-secondary)">${a.note}</span>` : ''}
      </div>`;
    }).join('');
    return { html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Where You're Staying</span></div>${rows}</div>`, hasData: true };
  }

  function buildBudgetHtml(): { html: string; hasData: boolean } {
    const items: { category: string; label: string; amount: string }[] = [];
    const seenAccom = new Set<string>();
    for (const d of days) {
      if (d.accommodation?.price && !seenAccom.has(d.accommodation.name)) {
        seenAccom.add(d.accommodation.name);
        items.push({ category: 'Accommodation', label: d.accommodation.name, amount: d.accommodation.price });
      }
      if (d.meals?.length) {
        for (const m of d.meals) {
          if (m.detail?.price_range) items.push({ category: 'Dining', label: m.name, amount: m.detail.price_range });
        }
      }
    }
    if (!items.length) return { html: '', hasData: false };
    // Group by category
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category)!.push(item);
    }
    let html = '';
    for (const [cat, entries] of groups) {
      const rows = entries.map(e =>
        `<div class="detail-row"><span class="detail-row-label" style="width:auto;flex:1">${e.label}</span><span class="detail-row-value" style="flex:none">${e.amount}</span></div>`
      ).join('');
      html += `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${cat}</span></div>${rows}</div>`;
    }
    return { html, hasData: true };
  }

  function buildThingsToDoHtml(): { html: string; hasData: boolean; allDone: boolean } {
    const todoItems: { label: string; detail: string; done: boolean; dayNumber: number; itemType: string; itemIndex: number }[] = [];
    const seenAccom = new Set<string>();

    for (const d of days) {
      // Pending transport bookings
      if (d.transport?.length) {
        for (let i = 0; i < d.transport.length; i++) {
          const t = d.transport[i];
          const done = t.status === 'booked' || t.status === 'confirmed';
          todoItems.push({ label: t.label || `${t.from} → ${t.to}`, detail: `Day ${d.day_number} · ${t.mode}`, done, dayNumber: d.day_number, itemType: 'transport', itemIndex: i });
        }
      }
      // Pending accommodation bookings (deduplicated)
      if (d.accommodation && !seenAccom.has(d.accommodation.name)) {
        seenAccom.add(d.accommodation.name);
        const done = d.accommodation.status === 'booked' || d.accommodation.status === 'confirmed';
        todoItems.push({ label: d.accommodation.name, detail: `Accommodation · ${d.accommodation.nights || 1} night${(d.accommodation.nights || 1) > 1 ? 's' : ''}`, done, dayNumber: d.day_number, itemType: 'accommodation', itemIndex: 0 });
      }
      // Pending meal reservations
      if (d.meals?.length) {
        for (let i = 0; i < d.meals.length; i++) {
          const m = d.meals[i];
          const done = m.status === 'booked' || m.status === 'confirmed';
          todoItems.push({ label: m.name, detail: `Day ${d.day_number} · ${m.type}`, done, dayNumber: d.day_number, itemType: 'meal', itemIndex: i });
        }
      }
    }

    if (!todoItems.length) return { html: '', hasData: false, allDone: false };

    const interactive = tripId ? ' todo-interactive' : '';
    const allDone = todoItems.every(t => t.done);
    const rows = todoItems.map(t =>
      `<div class="detail-row todo-item${interactive}" data-day="${t.dayNumber}" data-type="${t.itemType}" data-index="${t.itemIndex}" data-done="${t.done}" style="gap:10px;align-items:center">
        <span class="todo-check ${t.done ? 'done' : ''}">${t.done ? '&#10003;' : ''}</span>
        <span style="flex:1;min-width:0">
          <span class="detail-row-value" style="text-align:left;font-size:14px;display:block${t.done ? ';text-decoration:line-through;opacity:0.45' : ''}">${t.label}</span>
          <span class="detail-row-label" style="width:auto;font-size:12px">${t.detail}</span>
        </span>
      </div>`
    ).join('');

    const header = allDone
      ? `<div class="todo-ready"><span class="todo-ready-icon">&#10003;</span> Trip is ready to go</div>`
      : `<div class="detail-info-section-title"><span class="text-section-title">Action Items</span></div>`;

    return { html: `<div class="detail-info-section">${header}${rows}</div>`, hasData: true, allDone };
  }

  // Render hero slide
  function renderHeroSlide() {
    if (!trip) return null;
    return (
      <div className="slide">
        <div className="hero-slide">
          <div
            className="hero-frame"
            style={activeTripIndex !== null && transitionTripIndex === activeTripIndex ? { viewTransitionName: TRIP_HERO_TRANSITION_NAME } as React.CSSProperties : undefined}
          >
            <div className="hero-bg">
              <Image src={trip.hero_image} alt={trip.name} fill sizes="430px" priority style={{ objectFit: 'cover', opacity: brokenImages.has(trip.hero_image) ? 0 : 1 }} onError={() => onImgError(trip.hero_image)} />
            </div>
            <div className="hero-overlay" />
          </div>
          <div className="hero-body">
            <div className="hero-pill">
              <Icon name="users" />
              <span className="text-hero-meta" style={{ textTransform: 'none', letterSpacing: '0.03em', fontWeight: 500 }}>
                {trip.travelers.join(' & ')}
              </span>
            </div>
            <h1 className="text-hero-title">{trip.name}</h1>
            <p className="text-hero-subtitle" style={{ marginTop: 6 }}>{trip.subtitle}</p>
            <div className="hero-divider" />
            <p className="text-hero-summary">{trip.summary}</p>
            <div className="hero-stats">
              <div><div className="hero-stat-val">{days.length > 0 ? days.length - 1 : '?'}</div><div className="hero-stat-lbl">nights</div></div>
              <div><div className="hero-stat-val">{formatDate(trip.dates.start, { day: 'numeric', month: 'short' })}</div><div className="hero-stat-lbl">start</div></div>
              <div><div className="hero-stat-val">{formatDate(trip.dates.end, { day: 'numeric', month: 'short' })}</div><div className="hero-stat-lbl">end</div></div>
            </div>
            {trip.notes?.length ? (
              <div className="hero-notes">
                <button className="hero-note-btn" onClick={() => {
                  const notesHtml = trip.notes!.map(note =>
                    `<div class="detail-info-section">
                      <div class="detail-info-section-title"><span class="text-section-title">${note.title}</span></div>
                      <div class="detail-tip-body"><p class="detail-tip-text">${note.content}</p></div>
                    </div>`
                  ).join('');
                  setDetailContent({ title: 'Trip Notes', html: notesHtml });
                  setDetailOpen(true);
                  window.history.pushState({ detail: true }, '');
                }}>
                  <span className="hero-note-icon"><Icon name="info" /></span>
                  <span className="hero-note-label">Trip Notes</span>
                  <span className="hero-note-count">{trip.notes.length}</span>
                  <Icon name="chevron" />
                </button>
              </div>
            ) : null}
            {(() => {
              const logistics = buildLogisticsHtml();
              const accommodation = buildAccommodationHtml();
              const thingsToDo = buildThingsToDoHtml();
              const sections = [
                { icon: 'route', label: 'Logistics', ...logistics },
                { icon: 'bed', label: 'Accommodation', ...accommodation },
                { icon: thingsToDo.allDone ? 'check' : 'warning', label: thingsToDo.allDone ? 'Ready to Go' : 'Action Items', ...thingsToDo },
              ].filter(s => s.hasData);
              if (!sections.length) return null;
              return (
                <div className="hero-overview-btns">
                  <div className="hero-overview-label">Overview</div>
                  {sections.map((s, i) => (
                    <button key={i} className="hero-note-btn" onClick={() => {
                      setDetailContent({ title: s.label, html: s.html });
                      setDetailOpen(true);
                      window.history.pushState({ detail: true }, '');
                    }}>
                      <span className="hero-note-icon"><Icon name={s.icon} /></span>
                      <span className="hero-note-label">{s.label}</span>
                      <Icon name="chevron" />
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <button className="hero-hint" onClick={() => goTo(1)} aria-label="Explore day by day">
            explore
            <Icon name="chevron" />
          </button>
        </div>
      </div>
    );
  }

  // Render day slide
  function renderDaySlide(day: Day) {
    const dateStr = formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' });

    const statsChips = day.stats?.length ? (
      <div className="hero-stats-row">
        {day.stats.map((s, i) => (
          <div key={i} className="hero-stat-chip">
            <span className="hero-stat-chip-icon"><Icon name={s.icon} /></span>
            <span>{s.value}</span>
          </div>
        ))}
      </div>
    ) : null;

    const heroSection = day.hero_image ? (
      <div className="day-hero">
        <Image src={day.hero_image} alt={day.title} fill sizes="430px" style={{ objectFit: 'cover', opacity: brokenImages.has(day.hero_image) ? 0 : 1 }} onError={() => onImgError(day.hero_image!)} />
        <div className="day-hero-gradient" />
        <div className="day-hero-text">
          <p className="text-label" style={{ margin: '0 0 4px' }}>Day {day.day_number} &middot; {dateStr}</p>
          <h2 className="text-card-title-light" style={{ margin: 0 }}>{day.title}</h2>
          {day.subtitle && <p className="text-hero-subtitle" style={{ margin: '5px 0 0', fontSize: 14 }}>{day.subtitle}</p>}
          {statsChips}
        </div>
      </div>
    ) : (
      <div className="day-header-plain">
        <p className="text-label-dark">Day {day.day_number} &middot; {dateStr}</p>
        <h2 className="text-card-title" style={{ marginTop: 4 }}>{day.title}</h2>
        {day.subtitle && <p className="text-body-italic" style={{ marginTop: 4, color: 'rgba(255,255,255,0.55)' }}>{day.subtitle}</p>}
        {statsChips}
      </div>
    );

    const descSection = day.description ? (
      <p className="day-description">{day.description}</p>
    ) : null;

    const progSection = day.blocks?.length ? (
      <div className="day-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="calendar" /></span>Programme</span>
        </div>
        <div className="time-blocks">
          {day.blocks.map((b, i) => (
            <div key={i} className={`time-block ${b.type === 'transport' ? 'is-transport' : ''} ${b.type === 'options' ? 'is-options' : ''}`}>
              <p className="text-label-dark" style={{ margin: '0 0 2px' }}>{b.time_label}</p>
              <p className="text-body" style={{ margin: 0 }}>{b.content}</p>
              {b.type === 'options' && b.options?.length ? (
                <div className="options-list">
                  {b.options.map((opt, oi) => (
                    <div key={oi} className="option-card">
                      <div className="option-header">
                        <span className="option-label">{opt.label}</span>
                        {opt.duration && <span className="option-duration">{opt.duration}</span>}
                      </div>
                      {opt.description && <p className="option-desc">{opt.description}</p>}
                      {opt.note && <p className="option-note">{opt.note}</p>}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    ) : null;

    const transSection = day.transport?.length ? (
      <div className="day-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="route" /></span>Transport</span>
        </div>
        {day.transport.map((t, i) => (
          <div key={i} className={`transport-row${t.detail ? ' tappable' : ''}`}
            onClick={t.detail ? () => openDetail('transport', t) : undefined}>
            <div className="transport-icon-wrap"><Icon name={t.mode || 'train'} /></div>
            <div className="transport-detail">
              <div className="text-name-accent">{t.label}</div>
              <div className="transport-route">{t.from || ''} \u2192 {t.to || ''} {t.duration ? `\u00b7 ${t.duration}` : ''}{t.distance ? ` \u00b7 ${t.distance}` : ''}</div>
            </div>
            {t.depart && <div className="text-mono">{t.depart}</div>}
            <span className={`text-status status-badge status-${t.status || 'pending'}`}>{t.status || 'pending'}</span>
            {t.detail && <span className="tap-chevron"><Icon name="chevron" /></span>}
          </div>
        ))}
      </div>
    ) : null;

    // Services matched to this day — deduplicated against transport entries
    let servicesSection = null;
    if (trip?.services?.length) {
      // Build set of route signatures from day's transport to avoid duplicating
      const transportRoutes = new Set<string>();
      if (day.transport?.length) {
        for (const t of day.transport) {
          const codes = extractIataCodes(`${t.from || ''} ${t.to || ''}`);
          if (codes.length >= 2) transportRoutes.add(`${codes[0]}-${codes[codes.length - 1]}`);
        }
      }

      const dayServices = trip.services.filter(s => s.legs?.some(l => l.date === day.date));
      if (dayServices.length) {
        servicesSection = dayServices.map((svc, si) => {
          // Filter out legs that already appear in the transport section
          const todayLegs = svc.legs!.filter(l => {
            if (l.date !== day.date) return false;
            if (transportRoutes.size === 0) return true;
            const legCodes = extractIataCodes(l.route);
            if (legCodes.length >= 2) {
              const sig = `${legCodes[0]}-${legCodes[legCodes.length - 1]}`;
              return !transportRoutes.has(sig);
            }
            return true; // keep non-flight legs
          });
          if (todayLegs.length === 0) return null;
          return (
            <div key={si} className="day-section">
              <div className="day-section-title">
                <span className="text-section-title"><span className="section-icon"><Icon name={svc.icon} /></span>{svc.label}</span>
              </div>
              {todayLegs.map((leg, li) => (
                <div key={li} className="transport-row">
                  <div className="transport-icon-wrap"><Icon name={svc.icon} /></div>
                  <div className="transport-detail">
                    <div className="text-name-accent">{svc.provider}</div>
                    <div className="transport-route">{leg.route}</div>
                    {(svc.ref || svc.price) && <div className="text-small" style={{ marginTop: 2 }}>{svc.ref ? svc.ref + ' · ' : ''}{svc.price || ''}</div>}
                  </div>
                  {svc.status && svc.status !== 'info' && <span className={`text-status status-badge status-${svc.status}`}>{svc.status}</span>}
                </div>
              ))}
            </div>
          );
        }).filter(Boolean);
        if (servicesSection.length === 0) servicesSection = null;
      }
    }

    const accomSection = day.accommodation ? (() => {
      const a = day.accommodation!;
      return (
        <div className="day-section">
          <div className="day-section-title">
            <span className="text-section-title"><span className="section-icon"><Icon name="bed" /></span>Stay</span>
          </div>
          <div className={`accom-card${a.detail ? ' tappable' : ''}`}
            onClick={a.detail ? () => openDetail('accommodation', a) : undefined}>
            <div className="accom-icon-wrap"><Icon name="hotel" /></div>
            <div className="accom-info">
              <div className="text-name">{a.name}</div>
              <div className="accom-meta">
                {a.price && <span className="text-mono">{a.price}</span>}
                {a.nights && a.nights > 1 && <span className="text-small">· {a.nights} nights</span>}
                {a.rating && <span className="text-small">· {a.rating}</span>}
              </div>
              {a.note && <div className="text-small accom-note">{a.note}</div>}
            </div>
            <span className={`text-status status-badge status-${a.status || 'pending'}`}>{a.status || 'pending'}</span>
            {a.detail && <span className="tap-chevron"><Icon name="chevron" /></span>}
          </div>
        </div>
      );
    })() : null;

    const mealsSection = day.meals?.length ? (
      <div className="day-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="fork" /></span>Eating</span>
        </div>
        {day.meals.map((m, i) => (
          <div key={i} className={`meal-row${m.detail ? ' meal-has-detail' : ''}`}
            onClick={m.detail ? () => openDetail('meal', m) : undefined}>
            <span className="meal-type-badge">{m.type}</span>
            <div className="meal-detail">
              <div className="text-name">{m.name}</div>
              {m.note && <div className="text-small" style={{ marginTop: 1 }}>{m.note}</div>}
            </div>
            {m.status && <span className={`text-status status-badge status-${m.status}`} style={{ flexShrink: 0 }}>{m.status}</span>}
            {m.detail && <div className="meal-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>}
          </div>
        ))}
      </div>
    ) : null;

    const tipsSection = day.tips?.length ? (
      <div className="day-section tips-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="info" /></span>Tips</span>
        </div>
        {day.tips.map((tip, i) => (
          <div key={i} className={`tip-row ${tip.priority === 'high' ? 'tip-high' : ''}`}
            onClick={() => openDetail('tip', tip)}>
            <div className="tip-icon-wrap">
              <Icon name={tip.icon || 'info'} />
            </div>
            <div className="tip-content">
              <div className="text-name">{tip.title}</div>
            </div>
            <div className="tip-chevron">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </div>
        ))}
      </div>
    ) : null;

    return (
      <div key={day.day_number} className="slide">
        <div className="day-slide">
          {heroSection}
          {descSection}
          {progSection}
          {transSection}
          {servicesSection}
          {accomSection}
          {mealsSection}
          {tipsSection}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="trip-desktop-bg" />
    <div className="trip-app">
      {/* Overview Screen */}
      <div className={`overview-screen ${overviewFaded ? 'faded' : ''}`}>
        <div className="overview-header">
          {showArchive ? (
            <>
              <button className="overview-back" onClick={() => setShowArchive(false)} aria-label="Back to Our Trips">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h1 className="overview-title">Archive</h1>
            </>
          ) : (
            <>
              <h1 className="overview-title">Our Trips</h1>
              <div className="overview-menu-wrap">
                <button className="overview-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Settings menu">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
                {menuOpen && (
                  <>
                    <div className="overview-menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <div className="overview-menu">
                      <button className="overview-menu-item" onClick={() => { setMenuOpen(false); setShowArchive(true); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                        Archive{archiveTrips.length > 0 ? ` (${archiveTrips.length})` : ''}
                      </button>
                      <button className="overview-menu-item overview-menu-item-danger" onClick={() => { setMenuOpen(false); window.location.href = '/'; }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="overview-body">
          {showArchive ? (
            archiveTrips.length > 0
              ? archiveTrips.map(({ td, origIdx }) => renderTripCard(td, origIdx))
              : <div className="overview-empty">No past trips yet</div>
          ) : (
            upcomingTrips.length > 0
              ? upcomingTrips.map(({ td, origIdx }) => renderTripCard(td, origIdx))
              : <div className="overview-empty">No upcoming trips</div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm !== null && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirm deletion">
          <div className="confirm-backdrop" onClick={() => setDeleteConfirm(null)} />
          <div className="confirm-dialog">
            <div className="confirm-title">Delete trip?</div>
            <p className="confirm-message">
              &ldquo;{trips[deleteConfirm]?.trip.name}&rdquo; will be permanently removed. This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="confirm-btn confirm-btn-delete" onClick={() => handleDeleteTrip(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Trip Screen */}
      {activeTripIndex !== null && (
        <div
          className={`trip-screen ${detailOpen ? 'detail-behind' : ''}`}
          style={{ display: 'flex' }}
        >
          {/* Nav Bar */}
          <div className={`nav-bar ${isHero ? 'over-hero' : ''}`}>
            <button className="nav-back" onClick={handleBack} aria-label={isHero ? 'All trips' : 'Back to cover'}>
              <Icon name="back" />
            </button>
            <div className="nav-title-text">
              {!isHero && trip && (
                <>
                  <div className="text-nav-title">{trip.name} — {trip.subtitle}</div>
                  <div className="text-nav-dates">
                    {formatDate(trip.dates.start, { day: 'numeric', month: 'short', year: 'numeric' })} — {formatDate(trip.dates.end, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Date Strip */}
          <div className={`date-strip ${isHero ? 'hidden' : ''}`}>
            <div className="date-strip-inner" ref={dateStripRef}>
              {days.map(day => {
                const date = new Date(day.date + 'T12:00:00');
                const wd = date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
                const d = date.getDate();
                return (
                  <button key={day.day_number} className={`date-btn ${currentSlide === day.day_number ? 'active' : ''}`}
                    onClick={() => { if (!dateStripDragged.current) goTo(day.day_number); }}
                    aria-selected={currentSlide === day.day_number}
                    aria-label={`Day ${day.day_number}, ${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
                    <span className="date-btn-wd">{wd}</span>
                    <span className="date-btn-d">{d}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Swipe viewport */}
          <div className="swipe-viewport" ref={viewportRef}>
            <div className="swipe-track" ref={trackRef}>
              {renderHeroSlide()}
              {days.map(day => renderDaySlide(day))}
            </div>
          </div>

          {/* Swipe dots */}
          <SwipeDots total={totalSlides} current={currentSlide} onDotClick={goTo} />

          {/* Floating Add to Trips button */}
          {shareId && saveStatus !== 'already_owned' && (
            <div className="floating-save">
              <button
                className={`floating-save-btn ${saveStatus === 'saved' || saveStatus === 'already_saved' ? 'saved' : ''}`}
                onClick={saveStatus === 'saved' || saveStatus === 'already_saved' ? () => { window.location.href = '/dashboard'; } : handleAddToTrips}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  'Saving...'
                ) : saveStatus === 'saved' || saveStatus === 'already_saved' ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {saveStatus === 'already_saved' ? 'Already saved — View trips' : 'Saved — View trips'}
                  </>
                ) : saveStatus === 'error' ? (
                  'Failed — Try again'
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add to my trips
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail sheet */}
      <div className={`detail-overlay ${detailOpen ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label={detailContent.title}>
        <div className="detail-backdrop" onClick={closeDetail} />
        <div className="detail-sheet">
          <div className="detail-header">
            <div className="text-nav-title" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}>
              {detailContent.title}
            </div>
            <button className="detail-close" onClick={closeDetail} aria-label="Close details">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </div>
          <div ref={detailBodyRef} className="detail-body" dangerouslySetInnerHTML={{ __html: detailContent.html }} />
        </div>
      </div>
    </div>
    </>
  );
}
