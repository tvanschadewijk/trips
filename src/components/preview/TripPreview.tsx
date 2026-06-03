'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { TripData, Day, Transport, Accommodation, Tip, Meal, Block, RichDetail } from '@/lib/types';
import { ICONS } from './icons';
import SaveOfflineButton from './SaveOfflineButton';
import TripRouteAtlas from './TripRouteAtlas';
import ItineraryMap, { type ItineraryMapFocusRequest, type ItineraryMapViewAllRequest } from './ItineraryMap';
import AccommodationReviewBoard from './AccommodationReviewBoard';
import { renderTripMarkdown } from '@/lib/render-trip-markdown';
import { buildTripRouteAtlas } from '@/lib/trip-route';
import {
  buildDayMapDataByNumber,
  EMPTY_DAY_MAP_ATLAS,
  mapPointDetailsForTrip,
} from '@/lib/day-map';
import { getTripOverviewImageUrl } from '@/lib/trip-images';
import { isConfirmedAccommodation } from '@/lib/trip-status';
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
  /** True when the current viewer can save a copy of a shared trip. */
  canAddToTrips?: boolean;
  /** Trip's sharing mode — controls whether the floating CTA reads
   *  "Add to my trips" (companion) or "Remix this trip" (remix). */
  shareMode?: 'companion' | 'remix';
  tripId?: string;
}

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
}

function formatDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', opts);
}

function normalizedNightCount(nights: number | null | undefined): number | null {
  if (typeof nights !== 'number' || !Number.isFinite(nights) || nights <= 0) return null;
  return Math.round(nights);
}

function formatNightLabel(nights: number | null | undefined): string | null {
  const count = normalizedNightCount(nights);
  if (!count) return null;
  return `${count} ${count === 1 ? 'night' : 'nights'}`;
}

function formatBriefDateRange(dateStr: string, nights: number | null | undefined): string {
  const start = new Date(dateStr + 'T12:00:00');
  const count = normalizedNightCount(nights);
  if (!count) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  const end = new Date(start);
  end.setDate(start.getDate() + count);

  const startDay = start.toLocaleDateString('en-GB', { day: 'numeric' });
  const endDay = end.toLocaleDateString('en-GB', { day: 'numeric' });
  const startMonth = start.toLocaleDateString('en-GB', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-GB', { month: 'short' });
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();

  return sameMonth
    ? `${startDay}\u2013${endDay} ${endMonth}`
    : `${startDay} ${startMonth}\u2013${endDay} ${endMonth}`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMarkdownSection(title: string, content?: string): string {
  if (!content) return '';
  return `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${escapeHtml(title)}</span></div>${renderTripMarkdown(content)}</div>`;
}

function renderListSection(title: string, items?: string[]): string {
  if (!items?.length) return '';
  const list = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  return `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${escapeHtml(title)}</span></div><ul class="detail-list">${list}</ul></div>`;
}

function renderRichDetail(detail?: RichDetail): string {
  if (!detail) return '';
  return [
    renderMarkdownSection('Overview', detail.body),
    renderMarkdownSection('Why go', detail.why),
    renderMarkdownSection('Vibe', detail.vibe),
    renderListSection('Highlights', detail.highlights),
    renderListSection('What to see', detail.what_to_see),
    renderMarkdownSection('How to do it', detail.how_to_do_it),
    renderMarkdownSection('Practical notes', detail.practical),
    renderMarkdownSection('What to order', detail.what_to_order),
    renderMarkdownSection('Booking note', detail.booking_note),
    renderMarkdownSection('Dog note', detail.dog_note),
  ].join('');
}

const MAX_VISIBLE_DOTS = 7;
const TRIP_HERO_TRANSITION_NAME = 'trip-hero';
const DETAIL_CLOSE_MS = 420;
const NEARBY_SLIDE_RENDER_RADIUS = 1;

type DetailContent = {
  title: string;
  html: string;
  node?: ReactNode;
  sheetClassName?: string;
};
type SlideMotionMode = 'programmatic' | 'swipe' | 'settled';
type SlideDirection = 'forward' | 'backward' | 'none';
type DayMapFocusRequest = ItineraryMapFocusRequest & {
  dayNumber: number;
};
type DayMapViewAllRequest = ItineraryMapViewAllRequest & {
  dayNumber: number;
};

function normalizeMapFocusLabel(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function trimDisplayText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockDisplayText(block: Block): string {
  return (
    trimDisplayText(block.content) ||
    trimDisplayText(block.detail?.title) ||
    trimDisplayText(block.detail?.body) ||
    trimDisplayText(block.detail?.why) ||
    trimDisplayText(block.detail?.practical)
  );
}

function getDisplayableBlock(block: Block) {
  const timeLabel = trimDisplayText(block.time_label);
  const content = blockDisplayText(block);
  const options = block.options?.filter((option) => trimDisplayText(option.label)) ?? [];

  if (!content && !options.length) return null;

  return { block, timeLabel, content, options };
}

function accommodationStatusLabel(accommodation: Accommodation): string {
  return accommodation.status?.trim() || 'pending';
}

type TodoItemType = 'transport' | 'accommodation';
type TodoItemStatus = 'booked' | 'open';

function isTodoDoneStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === 'booked' || normalized === 'confirmed';
}

function todoStatusFromDone(done: boolean): TodoItemStatus {
  return done ? 'booked' : 'open';
}

function isPlaceholderAccommodationName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'hotel not confirmed yet' ||
    normalized === 'hotel pending' ||
    normalized === 'accommodation pending' ||
    normalized === 'to be confirmed' ||
    normalized === 'tbc' ||
    normalized === 'tbd'
  );
}

function accommodationTodoLabel(day: Day, accommodation: Accommodation): string {
  const name = trimDisplayText(accommodation.name);
  if (name && !isPlaceholderAccommodationName(name)) return name;
  return `Book hotel for ${trimDisplayText(day.title) || `Day ${day.day_number}`}`;
}

function accommodationTodoKey(day: Day, accommodation: Accommodation): string {
  const name = trimDisplayText(accommodation.name);
  if (name && !isPlaceholderAccommodationName(name)) {
    const checkIn = trimDisplayText(accommodation.detail?.check_in);
    const checkOut = trimDisplayText(accommodation.detail?.check_out);
    return `hotel:${normalizeMapFocusLabel(name)}:${normalizeMapFocusLabel(checkIn)}:${normalizeMapFocusLabel(checkOut)}`;
  }
  return `day:${day.day_number}`;
}

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

export default function TripPreview({ trips: initialTrips, onDelete, autoOpen, shareId, canAddToTrips, shareMode, tripId }: TripPreviewProps) {
  const [trips, setTrips] = useState(initialTrips);
  // Sync to new initialTrips when the parent re-renders with fresh data (e.g.
  // after the admin chat panel applies an edit and calls router.refresh()).
  useEffect(() => {
    setTrips(initialTrips);
  }, [initialTrips]);
  const [activeTripIndex, setActiveTripIndex] = useState<number | null>(autoOpen ? 0 : null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailClosing, setDetailClosing] = useState(false);
  const [detailContent, setDetailContent] = useState<DetailContent>({ title: '', html: '' });
  const [slideMotionMode, setSlideMotionMode] = useState<SlideMotionMode>('settled');
  const [slideDirection, setSlideDirection] = useState<SlideDirection>('none');
  const [transitionAnchorSlide, setTransitionAnchorSlide] = useState<number | null>(null);
  const [overviewFaded, setOverviewFaded] = useState(autoOpen ? true : false);
  const [showOverviewMap, setShowOverviewMap] = useState(false);
  const [isDesktopPreview, setIsDesktopPreview] = useState<boolean | null>(null);
  const [transitionTripIndex, setTransitionTripIndex] = useState<number | null>(autoOpen ? 0 : null);
  const [showArchive, setShowArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'already_saved' | 'already_owned' | 'error'>('idle');
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [dayMapFocusRequest, setDayMapFocusRequest] = useState<DayMapFocusRequest | null>(null);
  const [dayMapViewAllRequest, setDayMapViewAllRequest] = useState<DayMapViewAllRequest | null>(null);
  const onImgError = useCallback((src: string) => {
    setBrokenImages(prev => { const next = new Set(prev); next.add(src); return next; });
  }, []);

  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dateStripRef = useRef<HTMLDivElement>(null);
  const dateStripDragged = useRef(false);
  const detailBodyRef = useRef<HTMLDivElement>(null);
  const detailCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailClosingRef = useRef(false);
  const dayMapFocusNonceRef = useRef(0);
  const dayMapViewAllNonceRef = useRef(0);

  // Touch state
  const touchState = useRef({ startX: 0, startY: 0, startTime: 0, dx: 0, isDragging: false, isScrolling: null as boolean | null });
  const didAutoNav = useRef(false);

  const activeTripData = activeTripIndex !== null ? trips[activeTripIndex] : undefined;
  const trip = activeTripData?.trip ?? null;
  const days = useMemo(() => activeTripData?.days ?? [], [activeTripData]);
  const markdownSource = activeTripData?.markdown_source;
  const totalSlides = 1 + days.length;
  const routeAtlases = useMemo(
    () => trips.map((tripData) => buildTripRouteAtlas(tripData)),
    [trips]
  );
  const routeAtlas = activeTripIndex !== null ? routeAtlases[activeTripIndex] : undefined;
  const routePointDetails = useMemo(
    () => mapPointDetailsForTrip(routeAtlas, days),
    [routeAtlas, days]
  );

  useEffect(() => {
    setShowOverviewMap(false);
    setTransitionAnchorSlide(null);
  }, [activeTripIndex]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const query = window.matchMedia('(min-width: 1024px)');
    const syncPreviewMode = () => setIsDesktopPreview(query.matches);

    syncPreviewMode();
    query.addEventListener('change', syncPreviewMode);

    return () => query.removeEventListener('change', syncPreviewMode);
  }, []);

  useEffect(() => {
    if (isDesktopPreview === false) setShowOverviewMap(false);
  }, [isDesktopPreview]);

  const dayMapDataByNumber = useMemo(
    () => buildDayMapDataByNumber(routeAtlas, days),
    [routeAtlas, days]
  );

  const focusDayMapPoi = useCallback((dayNumber: number, target: { id?: string; label?: string }) => {
    if (!target.id && !target.label) return;
    const nonce = ++dayMapFocusNonceRef.current;
    setDayMapFocusRequest({ dayNumber, ...target, nonce });

    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-day-map-card="${dayNumber}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  }, []);

  const viewAllDayMapLocations = useCallback((dayNumber: number) => {
    const nonce = ++dayMapViewAllNonceRef.current;
    setDayMapFocusRequest(null);
    setDayMapViewAllRequest({ dayNumber, nonce });
  }, []);

  // Prewarm the trip JSON cache the SW maintains. Fire-and-forget; even
  // if we never click 'Save offline', the next slow/offline visit can
  // hydrate from cache.
  useEffect(() => {
    if (!shareId || typeof window === 'undefined') return;
    fetch(`/api/trip-data/${shareId}`, { credentials: 'omit', cache: 'no-cache' }).catch(() => {});
  }, [shareId]);

  // Publish current slide as context for the chat panel. Stored in
  // sessionStorage so the chat component can pick it up without prop
  // drilling. Slide 0 = cover; slide N = day N.
  useEffect(() => {
    if (typeof window === 'undefined' || !trip) return;
    const dayIndex = currentSlide - 1; // -1 means cover
    const day = dayIndex >= 0 ? days[dayIndex] : null;
    const payload = {
      slide: currentSlide,
      slideKind: currentSlide === 0 ? 'cover' : 'day',
      day_number: day?.day_number ?? null,
      date: day?.date ?? null,
      title: day?.title ?? null,
    };
    try {
      sessionStorage.setItem('trip-chat-context', JSON.stringify(payload));
    } catch {}
    // Toggle a body class so global components (chat entry pill) can
    // restyle without prop drilling.
    document.body.classList.toggle('trip-on-cover', currentSlide === 0);
    return () => {
      document.body.classList.remove('trip-on-cover');
    };
  }, [currentSlide, trip, days]);

  // Compute today's day info (if today is within this trip)
  const todayInfo = useMemo(() => {
    if (!trip) return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(trip.dates.start + 'T12:00:00');
    const end = new Date(trip.dates.end + 'T12:00:00');
    if (today < start || today > end) return null;
    const todayStr = today.toISOString().slice(0, 10);
    const dayIdx = days.findIndex(d => d.date === todayStr);
    if (dayIdx < 0) return null;
    return {
      dayIdx,
      dayNumber: days[dayIdx].day_number,
      dateLabel: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    };
  }, [trip, days]);
  const isHero = currentSlide === 0;
  const shouldRenderSlideContent = useCallback(
    (slideIndex: number) => (
      Math.abs(currentSlide - slideIndex) <= NEARBY_SLIDE_RENDER_RADIUS
      || (
        transitionAnchorSlide !== null
        && Math.abs(transitionAnchorSlide - slideIndex) <= NEARBY_SLIDE_RENDER_RADIUS
      )
    ),
    [currentSlide, transitionAnchorSlide]
  );

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

  const goTo = useCallback((idx: number, options?: { source?: SlideMotionMode }) => {
    const clamped = Math.max(0, Math.min(idx, totalSlides - 1));
    const direction: SlideDirection = clamped > currentSlide ? 'forward' : clamped < currentSlide ? 'backward' : 'none';
    const source = options?.source ?? 'programmatic';
    setTransitionAnchorSlide(direction === 'none' ? null : currentSlide);
    setSlideDirection(direction);
    setSlideMotionMode(source);
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
    // Reset only the target slide, and defer it slightly so the content does
    // not jump while the horizontal page motion is still visible.
    if (direction !== 'none') {
      window.setTimeout(() => {
        const targetSlide = trackRef.current?.querySelectorAll('.slide')[clamped] as HTMLElement | undefined;
        if (targetSlide) targetSlide.scrollTop = 0;
      }, source === 'swipe' ? 120 : 240);
    }
    window.setTimeout(() => {
      setSlideMotionMode('settled');
      setSlideDirection('none');
      setTransitionAnchorSlide(null);
    }, 520);
  }, [currentSlide, totalSlides]);

  // Open trip with grow animation
  const openTrip = useCallback((idx: number, cardEl: HTMLElement) => {
    const td = trips[idx];
    if (!td.days.length) return;

    const heroFrame = cardEl.querySelector('.trip-card-media') as HTMLElement | null;
    if (heroFrame) {
      heroFrame.style.viewTransitionName = TRIP_HERO_TRANSITION_NAME;
    }

    startViewTransition(() => {
      flushSync(() => {
        setTransitionTripIndex(idx);
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

  // Signal view transition readiness — wait for hero image decode so the
  // transition captures a fully-painted state instead of a placeholder
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.__tripTransitionResolve !== 'function') return;

    const firstTrip = trips[0]?.trip;
    const url = firstTrip ? getTripOverviewImageUrl(firstTrip) : undefined;
    if (!url) { (w.__tripTransitionResolve as () => void)(); w.__tripTransitionResolve = null; return; }

    const img = new window.Image();
    img.src = url;
    img.decode().then(() => {
      if (typeof w.__tripTransitionResolve === 'function') {
        (w.__tripTransitionResolve as () => void)();
        w.__tripTransitionResolve = null;
      }
    }).catch(() => {
      if (typeof w.__tripTransitionResolve === 'function') {
        (w.__tripTransitionResolve as () => void)();
        w.__tripTransitionResolve = null;
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (isSwipe && ts.dx < 0 && currentSlide < totalSlides - 1) goTo(currentSlide + 1, { source: 'swipe' });
      else if (isSwipe && ts.dx > 0 && currentSlide > 0) goTo(currentSlide - 1, { source: 'swipe' });
      else goTo(currentSlide, { source: 'swipe' });
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
        // Open the trip on the cover (slide 0). The cover renders a
        // 'Continue to today' CTA so the user gets context first.
        setTransitionTripIndex(i);
        setActiveTripIndex(i);
        setOverviewFaded(true);
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (detailCloseTimerRef.current) clearTimeout(detailCloseTimerRef.current);
    };
  }, []);

  const handleTripDataUpdated = useCallback((nextTripData: TripData) => {
    setTrips((prev) => {
      if (activeTripIndex === null) return prev;
      const updated = [...prev];
      updated[activeTripIndex] = nextTripData;
      return updated;
    });
  }, [activeTripIndex]);

  const showDetail = useCallback((content: DetailContent) => {
    if (detailCloseTimerRef.current) {
      clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    setDetailContent(content);
    detailClosingRef.current = false;
    setDetailClosing(false);
    setDetailOpen(true);
    window.history.pushState({ detail: true }, '');
  }, []);

  const openAccommodationReviewer = useCallback((day?: Day) => {
    if (!tripId || !activeTripData) return;
    showDetail({
      title: 'Accommodations',
      html: '',
      node: (
        <AccommodationReviewBoard
          tripId={tripId}
          tripData={activeTripData}
          initialDayNumber={day?.day_number}
          onTripDataUpdated={handleTripDataUpdated}
        />
      ),
      sheetClassName: 'detail-sheet-review',
    });
  }, [activeTripData, handleTripDataUpdated, showDetail, tripId]);

  const startCloseDetail = useCallback(() => {
    if (!detailOpen || detailClosingRef.current) return;
    detailClosingRef.current = true;
    setDetailClosing(true);
    detailCloseTimerRef.current = setTimeout(() => {
      setDetailOpen(false);
      detailClosingRef.current = false;
      setDetailClosing(false);
      setDetailContent({ title: '', html: '' });
      detailCloseTimerRef.current = null;
    }, DETAIL_CLOSE_MS);
  }, [detailOpen]);

  // Detail sheet
  function openDetail(type: 'transport' | 'accommodation' | 'tip' | 'meal' | 'block', item: Transport | Accommodation | Tip | Meal | Block) {
    if (type === 'block') {
      const block = item as Block;
      if (!block.detail) return;
      const title = trimDisplayText(block.detail.title) || trimDisplayText(block.content) || 'Programme';
      const fallbackBody = trimDisplayText(block.content) || title;
      const html = renderRichDetail(block.detail);
      showDetail({
        title,
        html: html || `<div class="detail-tip-body"><p class="detail-tip-text">${escapeHtml(fallbackBody)}</p></div>`,
      });
      return;
    }
    if (type === 'tip') {
      const tip = item as Tip;
      showDetail({
        title: tip.title,
        html: `<div class="detail-tip-body"><p class="detail-tip-text">${escapeHtml(tip.content)}</p></div>`
      });
      return;
    }
    if (type === 'meal') {
      const m = item as Meal;
      if (!m.detail) return;
      const d = m.detail;
      const detailForRender = {
        ...d,
        body: d.body || m.note,
      };
      const richHtml = renderRichDetail(detailForRender);
      const fields: [string, string | undefined][] = [
        ['Cuisine', d.cuisine], ['Price range', d.price_range], ['Address', d.address],
        ['Phone', d.phone], ['Hours', d.hours],
        ['Reservation', d.reservation], ['Booked via', d.booking_platform], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value${l === 'Phone' ? ' mono' : ''}">${l === 'Phone' ? `<a href="tel:${escapeHtml(v!)}">${escapeHtml(v!)}</a>` : escapeHtml(v!)}</span></div>`
      ).join('');
      showDetail({
        title: m.name,
        html: `${richHtml}<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Restaurant Details</span></div>${rows}</div>`
      });
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

      showDetail({
        title,
        html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${t.mode === 'plane' ? 'Flight' : t.mode === 'car' ? 'Driving' : 'Journey'} Details</span></div>${rows}</div>${chargingHtml}${borderHtml}`
      });
    } else {
      const a = item as Accommodation;
      const d = a.detail!;
      const richHtml = renderRichDetail(d);
      const fields: [string, string | undefined][] = [
        ['Room type', d.room_type], ['Check-in', d.check_in], ['Check-out', d.check_out],
        ['Nights', a.nights ? a.nights + (a.nights > 1 ? ' nights' : ' night') : undefined],
        ['Price', a.price], ['Address', d.address],
        ['Phone', d.phone], ['Confirmation', d.confirmation], ['Booked via', d.booking_platform],
        ['Cancel by', d.cancellation_deadline], ['WiFi', d.wifi], ['Parking', d.parking], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value${l === 'Phone' ? ' mono' : ''}">${l === 'Phone' ? `<a href="tel:${escapeHtml(v!)}">${escapeHtml(v!)}</a>` : escapeHtml(v!)}</span></div>`
      ).join('');
      showDetail({
        title: a.name || 'Accommodation',
        html: `${richHtml}<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Booking Details</span></div>${rows}</div>`
      });
    }
  }

  function closeDetail() {
    if (detailOpen && !detailClosing) {
      startCloseDetail();
      window.history.back();
    }
  }

  // Handle browser back to close detail sheet
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      if (detailOpen) {
        e.preventDefault();
        startCloseDetail();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [detailOpen, startCloseDetail]);

  function applyTodoStatusToLocalTrip(
    dayNumber: number,
    itemType: TodoItemType,
    itemIndex: number,
    status: TodoItemStatus
  ) {
    if (activeTripIndex === null) return;
    setTrips(prev => {
      const updated = [...prev];
      const tripCopy = JSON.parse(JSON.stringify(updated[activeTripIndex])) as TripData;
      const day = tripCopy.days.find(d => d.day_number === dayNumber);
      if (!day) return prev;

      if (itemType === 'transport' && day.transport?.[itemIndex]) {
        day.transport[itemIndex].status = status;
      } else if (itemType === 'accommodation' && day.accommodation) {
        const accommodationName = trimDisplayText(day.accommodation.name);
        for (const tripDay of tripCopy.days) {
          if (!tripDay.accommodation) continue;
          const sameStay = accommodationName
            ? trimDisplayText(tripDay.accommodation.name) === accommodationName
            : tripDay.day_number === dayNumber;
          if (sameStay) {
            tripDay.accommodation.status = status;
          }
        }
      }

      updated[activeTripIndex] = tripCopy;
      return updated;
    });
  }

  // Toggle owner action item status.
  async function handleToggleStatus(
    dayNumber: number,
    itemType: TodoItemType,
    itemIndex: number,
    newStatus: TodoItemStatus
  ): Promise<boolean> {
    const endpoint = tripId
      ? `/api/trips/${tripId}/toggle-status`
      : shareId
        ? '/api/trips/toggle-status'
        : null;
    if (!endpoint || activeTripIndex === null) return false;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(tripId ? {} : { share_id: shareId }),
        day_number: dayNumber,
        item_type: itemType,
        item_index: itemIndex,
        new_status: newStatus,
      }),
    }).catch(() => null);

    if (!res?.ok) return false;

    const payload = await res.json().catch(() => null) as { new_status?: string } | null;
    const persistedStatus = payload?.new_status === 'booked' ? 'booked' : 'open';
    flushSync(() => {
      applyTodoStatusToLocalTrip(dayNumber, itemType, itemIndex, persistedStatus);
    });
    return true;
  }

  // Event delegation for action item clicks
  useEffect(() => {
    const el = detailBodyRef.current;
    if (!el || (!tripId && !shareId)) return;

    const updateTodoHeader = () => {
      const allRows = el.querySelectorAll('.todo-item');
      const allDone = Array.from(allRows).every(r => (r as HTMLElement).dataset.done === 'true');
      const header = el.querySelector('.detail-info-section-title, .todo-ready');
      if (!header) return;
      if (allDone) {
        header.outerHTML = '<div class="todo-ready"><span class="todo-ready-icon">&#10003;</span> Trip is ready to go</div>';
      } else {
        header.outerHTML = '<div class="detail-info-section-title"><span class="text-section-title">Action Items</span></div>';
      }
    };

    const setTodoRowState = (row: HTMLElement, done: boolean) => {
      const statusValue = todoStatusFromDone(done);
      row.dataset.done = String(done);
      row.dataset.status = statusValue;
      row.setAttribute('aria-pressed', String(done));
      const check = row.querySelector('.todo-check');
      if (check) {
        check.classList.toggle('done', done);
        check.innerHTML = done ? '&#10003;' : '';
      }
      const value = row.querySelector('.detail-row-value') as HTMLElement | null;
      if (value) {
        value.style.textDecoration = done ? 'line-through' : 'none';
        value.style.opacity = done ? '0.45' : '1';
      }
      const status = row.querySelector('.todo-status');
      if (status) {
        status.classList.remove('status-booked', 'status-open');
        status.classList.add(`status-${statusValue}`);
        status.textContent = statusValue;
      }
    };

    const toggleTodoRow = (row: HTMLElement) => {
      if (row.dataset.pending === 'true') return;

      const dayNumber = Number(row.dataset.day);
      const itemType = row.dataset.type as TodoItemType | undefined;
      const itemIndex = Number(row.dataset.index);
      const wasDone = row.dataset.done === 'true';
      const nowDone = !wasDone;
      const nextStatus = todoStatusFromDone(nowDone);

      if (itemType !== 'transport' && itemType !== 'accommodation') return;

      row.dataset.pending = 'true';
      row.setAttribute('aria-disabled', 'true');
      setTodoRowState(row, nowDone);
      updateTodoHeader();

      void handleToggleStatus(dayNumber, itemType, itemIndex, nextStatus).then((saved) => {
        if (!saved) {
          setTodoRowState(row, wasDone);
          updateTodoHeader();
        }
      }).finally(() => {
        delete row.dataset.pending;
        row.removeAttribute('aria-disabled');
      });
    };

    const handler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest('.todo-item.todo-interactive') as HTMLElement | null;
      if (!row) return;
      toggleTodoRow(row);
    };

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest('.todo-item.todo-interactive') as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      toggleTodoRow(row);
    };

    el.addEventListener('click', handler);
    el.addEventListener('keydown', keyHandler);
    return () => {
      el.removeEventListener('click', handler);
      el.removeEventListener('keydown', keyHandler);
    };
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
    const img = getTripOverviewImageUrl(t);
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="trip-card-img" src={img} alt={t.name} style={{ opacity: brokenImages.has(img) ? 0 : 1 }} onError={() => onImgError(img)} loading="lazy" />
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
      if (
        d.accommodation &&
        isConfirmedAccommodation(d.accommodation) &&
        !seen.has(d.accommodation.name)
      ) {
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

  function buildActivitiesHtml(): { html: string; hasData: boolean } {
    const entries: { day: number; date: string; block: Block }[] = [];
    for (const d of days) {
      for (const block of d.blocks || []) {
        if (block.type === 'note') continue;
        entries.push({ day: d.day_number, date: d.date, block });
      }
    }
    if (!entries.length) return { html: '', hasData: false };

    const rows = entries.map(({ day, date, block }) => {
      const dateLabel = formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
      const title = block.detail?.title || block.content;
      const body = block.detail?.body || block.detail?.why || block.content;
      const highlights = block.detail?.highlights?.length
        ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${block.detail.highlights.slice(0, 3).map(escapeHtml).join(' · ')}</span>`
        : '';

      return `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:3px">
        <span class="detail-row-label" style="width:auto">Day ${day} · ${dateLabel}</span>
        <span class="detail-row-value" style="text-align:left;font-size:15px;font-weight:600">${escapeHtml(title)}</span>
        ${body && body !== title ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-secondary)">${escapeHtml(body)}</span>` : ''}
        ${highlights}
      </div>`;
    }).join('');

    return { html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Activity Highlights</span></div>${rows}</div>`, hasData: true };
  }

  function buildDiningHtml(): { html: string; hasData: boolean } {
    const entries: { day: number; date: string; meal: Meal }[] = [];
    for (const d of days) {
      for (const meal of d.meals || []) entries.push({ day: d.day_number, date: d.date, meal });
    }
    if (!entries.length) return { html: '', hasData: false };

    const rows = entries.map(({ day, date, meal }) => {
      const dateLabel = formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
      const detail = meal.detail;
      const meta = [
        meal.type,
        detail?.cuisine,
        detail?.price_range,
        detail?.reservation,
      ].filter(Boolean).join(' · ');
      const note = detail?.body || meal.note || detail?.why;
      const practical = detail?.practical || detail?.booking_note;

      return `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:3px">
        <span class="detail-row-label" style="width:auto">Day ${day} · ${dateLabel}${meta ? ` · ${escapeHtml(meta)}` : ''}</span>
        <span class="detail-row-value" style="text-align:left;font-size:15px;font-weight:600">${escapeHtml(meal.name)}</span>
        ${note ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-secondary)">${escapeHtml(note)}</span>` : ''}
        ${practical ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${escapeHtml(practical)}</span>` : ''}
      </div>`;
    }).join('');

    return { html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">Restaurant Shortlist</span></div>${rows}</div>`, hasData: true };
  }

  function buildBudgetHtml(): { html: string; hasData: boolean } {
    const items: { category: string; label: string; amount: string }[] = [];
    const seenAccom = new Set<string>();
    for (const d of days) {
      if (
        d.accommodation?.price &&
        isConfirmedAccommodation(d.accommodation) &&
        !seenAccom.has(d.accommodation.name)
      ) {
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
    const todoItems: {
      label: string;
      detail: string;
      done: boolean;
      status: TodoItemStatus;
      dayNumber: number;
      itemType: TodoItemType;
      itemIndex: number;
    }[] = [];
    const seenAccommodationTodos = new Set<string>();

    for (const d of days) {
      // Transport bookings and hotel bookings. Restaurant reservations stay out of this checklist.
      if (d.transport?.length) {
        for (let i = 0; i < d.transport.length; i++) {
          const t = d.transport[i];
          if (!t.status) continue;
          const done = isTodoDoneStatus(t.status);
          const routeLabel = [trimDisplayText(t.from), trimDisplayText(t.to)].filter(Boolean).join(' → ');
          const mode = trimDisplayText(t.mode) || 'transport';
          todoItems.push({
            label: trimDisplayText(t.label) || routeLabel || 'Transport booking',
            detail: `Day ${d.day_number} · ${mode}`,
            done,
            status: todoStatusFromDone(done),
            dayNumber: d.day_number,
            itemType: 'transport',
            itemIndex: i,
          });
        }
      }

      if (d.accommodation) {
        const key = accommodationTodoKey(d, d.accommodation);
        if (!seenAccommodationTodos.has(key)) {
          seenAccommodationTodos.add(key);
          const done = isTodoDoneStatus(d.accommodation.status);
          const nights = d.accommodation.nights
            ? ` · ${d.accommodation.nights} ${d.accommodation.nights === 1 ? 'night' : 'nights'}`
            : '';
          todoItems.push({
            label: accommodationTodoLabel(d, d.accommodation),
            detail: `Day ${d.day_number} · hotel${nights}`,
            done,
            status: todoStatusFromDone(done),
            dayNumber: d.day_number,
            itemType: 'accommodation',
            itemIndex: 0,
          });
        }
      }
    }

    if (!todoItems.length) return { html: '', hasData: false, allDone: false };

    const canUpdateActionItems = Boolean(tripId || shareId);
    const interactive = canUpdateActionItems ? ' todo-interactive' : '';
    const allDone = todoItems.every(t => t.done);
    const interactiveAttrs = (done: boolean) => canUpdateActionItems
      ? ` role="button" tabindex="0" aria-pressed="${done}"`
      : '';
    const rows = todoItems.map(t =>
      `<div class="detail-row todo-item${interactive}"${interactiveAttrs(t.done)} data-day="${t.dayNumber}" data-type="${t.itemType}" data-index="${t.itemIndex}" data-done="${t.done}" data-status="${t.status}" style="gap:10px;align-items:center">
        <span class="todo-check ${t.done ? 'done' : ''}">${t.done ? '&#10003;' : ''}</span>
        <span style="flex:1;min-width:0">
          <span class="detail-row-value" style="text-align:left;font-size:14px;display:block${t.done ? ';text-decoration:line-through;opacity:0.45' : ''}">${escapeHtml(t.label)}</span>
          <span class="detail-row-label" style="width:auto;font-size:12px">${escapeHtml(t.detail)}</span>
        </span>
        <span class="text-status status-badge todo-status status-${t.status}">${t.status}</span>
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
    const heroImage = getTripOverviewImageUrl(trip);
    const heroImageIsBroken = brokenImages.has(heroImage);
    const routeStopCount = routeAtlas
      ? routeAtlas.points.filter((point) => point.role !== 'home').length || routeAtlas.points.length
      : 0;
    const desktopOverviewMapVisible = Boolean(showOverviewMap && routeAtlas && isDesktopPreview);

    return (
      <div key="cover" className={`slide ${currentSlide === 0 ? 'active' : ''}`}>
        <div className="hero-slide">
          <div
            className={`hero-frame${desktopOverviewMapVisible ? ' is-map-visible' : ''}`}
            style={activeTripIndex !== null && transitionTripIndex === activeTripIndex ? { viewTransitionName: TRIP_HERO_TRANSITION_NAME } as React.CSSProperties : undefined}
          >
            {desktopOverviewMapVisible && routeAtlas ? (
              <div className="hero-map-stage">
                <ItineraryMap
                  atlas={routeAtlas}
                  title={`${trip.name} itinerary map`}
                  variant="overview-card"
                  interactive
                  pointDetails={routePointDetails}
                  showLines
                  enabled={currentSlide === 0 && desktopOverviewMapVisible}
                  loadingLabel="Loading overview map"
                  loadingHint={routeStopCount >= 12 ? 'This might take a minute with this many stops.' : undefined}
                  fallback={<TripRouteAtlas atlas={routeAtlas} />}
                />
              </div>
            ) : (
              <>
                <div className="hero-bg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={heroImage}
                    alt={trip.name}
                    draggable={false}
                    style={{ opacity: heroImageIsBroken ? 0 : 1 }}
                    onError={() => onImgError(heroImage)}
                  />
                </div>
                <div className="hero-overlay" />
              </>
            )}
            {routeAtlas ? (
              <button
                type="button"
                className="hero-map-toggle"
                onClick={() => setShowOverviewMap((value) => !value)}
                aria-pressed={showOverviewMap}
                aria-label={showOverviewMap ? 'Show trip photo' : 'Show itinerary map'}
              >
                <span aria-hidden="true"><Icon name={showOverviewMap ? 'mountain' : 'route'} /></span>
                <span>{showOverviewMap ? 'Photo' : 'Map'}</span>
              </button>
            ) : null}
          </div>
          <div className="hero-body">
            <h1 className="text-hero-title">{trip.name}</h1>
            <div className="hero-paper">
              <p className="text-hero-subtitle">{trip.subtitle}</p>
              <div className="hero-divider" />
              <p className="text-hero-summary">{trip.summary}</p>
              <div className="hero-stats">
                <div><div className="hero-stat-val">{days.length > 0 ? days.length - 1 : '?'}</div><div className="hero-stat-lbl">nights</div></div>
                <div><div className="hero-stat-val">{formatDate(trip.dates.start, { day: 'numeric', month: 'short' })}</div><div className="hero-stat-lbl">start</div></div>
                <div><div className="hero-stat-val">{formatDate(trip.dates.end, { day: 'numeric', month: 'short' })}</div><div className="hero-stat-lbl">end</div></div>
              </div>
            </div>
            {routeAtlas ? (
              <div className="hero-route-map-card">
                <div className="hero-route-map-header">
                  <span className="text-section-title"><span className="section-icon"><Icon name="route" /></span>Itinerary map</span>
                  <span className="hero-route-map-count">{routeStopCount} stop{routeStopCount === 1 ? '' : 's'}</span>
                </div>
                <div className="hero-route-map-frame">
                  <ItineraryMap
                    atlas={routeAtlas}
                    title={`${trip.name} itinerary map`}
                    variant="day"
                    interactive
                    pointDetails={routePointDetails}
                    showLines={false}
                    enabled={currentSlide === 0 && isDesktopPreview === false}
                    loadingLabel="Loading overview map"
                    loadingHint={routeStopCount >= 12 ? 'This might take a minute with this many stops.' : undefined}
                    fallback={<TripRouteAtlas atlas={routeAtlas} />}
                  />
                </div>
              </div>
            ) : null}
            {todayInfo && (
              <button
                className="hero-today-cta"
                onClick={() => goTo(todayInfo.dayIdx + 1)}
                aria-label={`Continue to today, day ${todayInfo.dayNumber}, ${todayInfo.dateLabel}`}
              >
                <span className="hero-today-cta-eyebrow">Today</span>
                <span className="hero-today-cta-label">
                  Continue to Day {todayInfo.dayNumber}
                  <span className="hero-today-cta-date"> · {todayInfo.dateLabel}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            )}
            {trip.notes?.length ? (
              <div className="hero-notes">
                <button className="hero-note-btn" onClick={() => {
                  const notesHtml = trip.notes!.map(note =>
                    `<div class="detail-info-section">
                      <div class="detail-info-section-title"><span class="text-section-title">${note.title}</span></div>
                      <div class="detail-tip-body"><p class="detail-tip-text">${note.content}</p></div>
                    </div>`
                  ).join('');
                  showDetail({ title: 'Trip Notes', html: notesHtml });
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
              const activities = buildActivitiesHtml();
              const dining = buildDiningHtml();
              const thingsToDo = buildThingsToDoHtml();
              const accommodationSection = tripId && activeTripData
                ? {
                    icon: 'hotel',
                    label: 'Accommodations',
                    html: '',
                    hasData: true,
                    node: (
                      <AccommodationReviewBoard
                        tripId={tripId}
                        tripData={activeTripData}
                        onTripDataUpdated={handleTripDataUpdated}
                      />
                    ),
                    sheetClassName: 'detail-sheet-review',
                  }
                : { icon: 'bed', label: 'Accommodation', ...accommodation };
              const sections: {
                icon: string;
                label: string;
                html: string;
                hasData: boolean;
                node?: ReactNode;
                sheetClassName?: string;
              }[] = [
                { icon: 'route', label: 'Logistics', ...logistics },
                accommodationSection,
                { icon: 'mountain', label: 'Activities', ...activities },
                { icon: 'fork', label: 'Restaurants', ...dining },
                { icon: thingsToDo.allDone ? 'check' : 'warning', label: thingsToDo.allDone ? 'Ready to Go' : 'Action Items', ...thingsToDo },
              ];
              if (markdownSource) {
                sections.push({
                  icon: 'doc',
                  label: 'Original plan',
                  html: renderTripMarkdown(markdownSource),
                  hasData: true,
                });
              }
              const visible = sections.filter(s => s.hasData);
              if (!visible.length) return null;
              return (
                <div className="hero-overview-btns">
                  <div className="hero-overview-label">Overview</div>
                  {visible.map((s, i) => (
                    <button key={i} className="hero-note-btn" onClick={() => {
                      showDetail({
                        title: s.label,
                        html: s.html,
                        node: s.node,
                        sheetClassName: s.sheetClassName,
                      });
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
        </div>
      </div>
    );
  }

  // Preserve slide indexes for the swipe track while avoiding hidden map/image work.
  function renderPlaceholderSlide(slideIndex: number, key: string | number) {
    const isActive = currentSlide === slideIndex;
    return (
      <div
        key={key}
        className={`slide slide-placeholder ${isActive ? 'active' : ''}`}
        aria-hidden={!isActive}
      />
    );
  }

  // Render day slide
  function renderDaySlide(day: Day, slideIndex: number) {
    const dateStr = formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' });
    const dayMapData = dayMapDataByNumber[day.day_number];
    const dayMapAtlas = dayMapData?.atlas;
    const itineraryMapAtlas = dayMapAtlas ?? EMPTY_DAY_MAP_ATLAS;
    const dayMapSearchTargets = dayMapData?.searchTargets ?? [];
    const hasDayMapLocations = Boolean(dayMapAtlas?.points.length || dayMapSearchTargets.length);
    const findDayMapTarget = (label: string | undefined): { id?: string; label?: string } | undefined => {
      const normalized = normalizeMapFocusLabel(label);
      if (!normalized) return undefined;

      const searchTarget = dayMapSearchTargets.find((target) => (
        normalizeMapFocusLabel(target.label) === normalized
        || normalizeMapFocusLabel(target.detail?.title) === normalized
      ));
      if (searchTarget) return { id: searchTarget.id, label: searchTarget.label };

      const atlasPoint = dayMapAtlas?.points.find((point) => normalizeMapFocusLabel(point.label) === normalized);
      return atlasPoint ? { id: atlasPoint.id, label: atlasPoint.label } : undefined;
    };
    const focusDayMapTarget = (target: { id?: string; label?: string } | undefined) => {
      if (!target) return;
      focusDayMapPoi(day.day_number, target);
    };
    const dayMapStopCount = hasDayMapLocations
      ? dayMapSearchTargets.length || dayMapAtlas?.points.filter((point) => point.role !== 'home').length || dayMapAtlas?.points.length || 0
      : 0;
    const dayMapCountNoun = dayMapSearchTargets.length ? 'location' : 'stop';
    const dayMapCountLabel = `${dayMapStopCount} ${dayMapCountNoun}${dayMapStopCount === 1 ? '' : 's'}`;

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={day.hero_image} alt={day.title} style={{ opacity: brokenImages.has(day.hero_image) ? 0 : 1 }} onError={() => onImgError(day.hero_image!)} loading="lazy" />
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
        {day.subtitle && <p className="text-body-italic" style={{ marginTop: 4 }}>{day.subtitle}</p>}
        {statsChips}
      </div>
    );

    const dayMapSection = hasDayMapLocations ? (
      <div className="day-map-card" data-day-map-card={day.day_number}>
        <div className="day-map-header">
          <span className="text-section-title"><span className="section-icon"><Icon name="route" /></span>Day map</span>
          <button
            type="button"
            className="day-map-count"
            onClick={() => viewAllDayMapLocations(day.day_number)}
            aria-label={`Show all ${dayMapCountLabel} on the day map`}
            title={`Show all ${dayMapCountLabel}`}
          >
            {dayMapCountLabel}
          </button>
        </div>
        <div className="day-map-frame">
          <ItineraryMap
            atlas={itineraryMapAtlas}
            title={`Day ${day.day_number} activity map`}
            variant="day"
            interactive
            pointDetails={dayMapData?.details}
            searchTargets={dayMapSearchTargets}
            focusRequest={dayMapFocusRequest?.dayNumber === day.day_number ? dayMapFocusRequest : undefined}
            viewAllRequest={dayMapViewAllRequest?.dayNumber === day.day_number ? dayMapViewAllRequest : undefined}
            showLines={false}
            enabled={currentSlide === slideIndex}
            loadingLabel={dayMapSearchTargets.length ? 'Finding day places' : 'Loading day map'}
            loadingHint={dayMapSearchTargets.length ? 'Looking up hotels, restaurants and sights for this day.' : undefined}
            fallback={dayMapAtlas ? <TripRouteAtlas atlas={dayMapAtlas} numberStart /> : undefined}
          />
        </div>
      </div>
    ) : null;

    const visualSection = dayMapSection ? (
      <div className="day-visual-stack">
        {heroSection}
        {dayMapSection}
      </div>
    ) : heroSection;

    const displayBlocks = (day.blocks ?? []).map(getDisplayableBlock).filter((block) => block !== null);
    const stayNights = normalizedNightCount(day.accommodation?.nights);
    const nightLabel = formatNightLabel(stayNights);
    const dateRangeLabel = formatBriefDateRange(day.date, stayNights);
    const stayDateLabel = nightLabel ? `${nightLabel} (${dateRangeLabel})` : dateRangeLabel;

    const renderBriefDetailButton = (label: string, onClick: () => void) => (
      <button
        type="button"
        className="day-brief-detail-btn"
        aria-label={label}
        title={label}
        onClick={onClick}
      >
        <Icon name="info" />
      </button>
    );

    const renderBriefCardAction = (label: string, onClick: () => void, icon: string = 'chevron') => (
      <button
        type="button"
        className="day-brief-card-action"
        aria-label={label}
        onClick={onClick}
      >
        <span>{label}</span>
        <Icon name={icon} />
      </button>
    );

    const renderBriefPlace = (label: string, mapLabel?: string, className?: string) => {
      const mapTarget = findDayMapTarget(mapLabel || label);
      const classes = ['day-brief-place', className].filter(Boolean).join(' ');
      if (!mapTarget) return <span className={classes}>{label}</span>;
      return (
        <button
          type="button"
          className={classes}
          onClick={() => focusDayMapTarget(mapTarget)}
        >
          {label}
        </button>
      );
    };

    const renderBriefActivityText = (value: string): ReactNode => {
      const text = trimDisplayText(value);
      if (!text) return null;

      const candidates = dayMapSearchTargets
        .filter((target) => target.role === 'excursion')
        .map((target) => ({
          label: trimDisplayText(target.detail?.title) || trimDisplayText(target.label),
          target: { id: target.id, label: target.label },
        }))
        .filter(({ label }) => label.length >= 3)
        .sort((a, b) => b.label.length - a.label.length);

      const matches: {
        start: number;
        end: number;
        label: string;
        target: { id?: string; label?: string };
      }[] = [];

      for (const candidate of candidates) {
        const match = new RegExp(escapeRegExp(candidate.label), 'iu').exec(text);
        if (!match) continue;

        const start = match.index;
        const end = start + match[0].length;
        const overlaps = matches.some((existing) => start < existing.end && end > existing.start);
        if (overlaps) continue;

        matches.push({ start, end, label: match[0], target: candidate.target });
      }

      if (!matches.length) return text;

      matches.sort((a, b) => a.start - b.start);
      const parts: ReactNode[] = [];
      let cursor = 0;

      for (const [index, match] of matches.entries()) {
        if (cursor < match.start) parts.push(text.slice(cursor, match.start));
        parts.push(
          <button
            key={`${match.label}-${index}`}
            type="button"
            className="day-brief-place day-brief-site-link"
            onClick={() => focusDayMapTarget(match.target)}
          >
            {match.label}
          </button>
        );
        cursor = match.end;
      }

      if (cursor < text.length) parts.push(text.slice(cursor));
      return parts;
    };

    const seeAndDoBlock = displayBlocks.length ? (
      <div className="day-brief-see-card">
        <div className="day-brief-card-kicker">
          <span className="day-brief-card-icon"><Icon name="mountain" /></span>
          <span>See &amp; do</span>
        </div>
        <div className="day-brief-programme-list">
          {displayBlocks.map(({ block: b, timeLabel, content, options }, i) => {
            const detailTitle = trimDisplayText(b.detail?.title) || content || 'this programme item';
            return (
              <div key={i} className={`day-brief-programme-row ${timeLabel ? '' : 'no-time'}`}>
                {timeLabel && <span className="day-brief-time">{timeLabel}: </span>}
                <span className="day-brief-programme-copy">
                  {content && <span>{renderBriefActivityText(content)}</span>}
                  {b.detail && renderBriefDetailButton(`More about ${detailTitle}`, () => openDetail('block', b))}
                  {options.length ? (
                    <span className="day-brief-options">
                      {content ? ' ' : ''}
                      <span className="day-brief-time">Options: </span>
                      {options.map((opt, oi) => (
                        <span key={oi}>
                          <span className="day-brief-emphasis">{trimDisplayText(opt.label)}</span>
                          {opt.duration && <span className="day-brief-muted-inline"> ({opt.duration})</span>}
                          {opt.description && <span className="day-brief-muted-inline"> - {opt.description}</span>}
                          {oi < options.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

    const stayCard = day.accommodation ? (() => {
      const a = day.accommodation!;
      const statusLabel = accommodationStatusLabel(a);
      const canOpenReviewer = Boolean(tripId && activeTripData);
      if (!isConfirmedAccommodation(a)) {
        return (
          <article className="day-brief-detail-card day-brief-detail-card-warning">
            <div className="day-brief-card-topline">
              <div className="day-brief-card-kicker">
                <span className="day-brief-card-icon"><Icon name="hotel" /></span>
                <span>Accommodation</span>
              </div>
              <span className={`text-status status-badge day-brief-status status-${statusLabel}`}>
                {statusLabel}
              </span>
            </div>
            <h4 className="day-brief-card-title">Hotel not confirmed yet</h4>
            <p className="day-brief-card-copy">Use Accommodations to confirm the stay for this stop.</p>
            {canOpenReviewer && (
              <div className="day-brief-card-actions">
                {renderBriefCardAction('Review accommodation', () => openAccommodationReviewer(day))}
              </div>
            )}
          </article>
        );
      }

      const stayMeta = [
        stayDateLabel,
        a.price,
        a.rating,
      ].filter(Boolean).join(' · ');

      return (
        <article className="day-brief-detail-card">
          <div className="day-brief-card-topline">
            <div className="day-brief-card-kicker">
              <span className="day-brief-card-icon"><Icon name="hotel" /></span>
              <span>Accommodation</span>
            </div>
            <span className={`text-status status-badge day-brief-status status-${a.status || 'pending'}`}>
              {a.status || 'pending'}
            </span>
          </div>
          <h4 className="day-brief-card-title">
            {renderBriefPlace(trimDisplayText(a.name) || 'Accommodation', a.name, 'day-brief-card-place')}
          </h4>
          {stayMeta && <p className="day-brief-card-meta">{stayMeta}</p>}
          {a.note && <p className="day-brief-card-copy">{a.note}</p>}
          {a.detail && (
            <div className="day-brief-card-actions">
              {renderBriefCardAction('Stay details', () => openDetail('accommodation', a))}
            </div>
          )}
        </article>
      );
    })() : null;

    const mealCard = day.meals?.length ? (() => {
      const mealLabel = day.meals.length === 1
        ? trimDisplayText(day.meals[0].type).replace(/^\w/, (char) => char.toUpperCase()) || 'Dinner'
        : 'Dining';
      return (
        <article className="day-brief-detail-card">
          <div className="day-brief-card-topline">
            <div className="day-brief-card-kicker">
              <span className="day-brief-card-icon"><Icon name="fork" /></span>
              <span>{mealLabel}</span>
            </div>
            {day.meals.length === 1 && day.meals[0].status ? (
              <span className={`text-status status-badge day-brief-status status-${day.meals[0].status}`}>
                {day.meals[0].status}
              </span>
            ) : null}
          </div>
          <div className="day-brief-meal-list">
            {day.meals.map((m, i) => (
              <div key={i} className="day-brief-meal-entry">
                {day.meals!.length > 1 && m.type ? (
                  <div className="day-brief-meal-type">{m.type}</div>
                ) : null}
                <h4 className="day-brief-card-title">
                  {renderBriefPlace(trimDisplayText(m.name) || 'Restaurant', m.name, 'day-brief-card-place')}
                </h4>
                {m.note && <p className="day-brief-card-copy">{m.note}</p>}
                <div className="day-brief-card-actions">
                  {day.meals!.length > 1 && m.status ? (
                    <span className={`text-status status-badge day-brief-status status-${m.status}`}>
                      {m.status}
                    </span>
                  ) : null}
                  {m.detail && renderBriefCardAction('Meal details', () => openDetail('meal', m))}
                </div>
              </div>
            ))}
          </div>
        </article>
      );
    })() : null;

    const hasBriefItems = Boolean(seeAndDoBlock || stayCard || mealCard);
    const briefSection = (
      <section className="day-brief" aria-labelledby={`day-brief-title-${day.day_number}`}>
        <div className="day-brief-header">
          <p className="day-brief-overline">Day {day.day_number} &middot; {dateStr}</p>
          <h3 className="day-brief-heading" id={`day-brief-title-${day.day_number}`}>
            <span>{day.title}</span>
          </h3>
          <div className="day-brief-meta-row">
            <span>{stayDateLabel}</span>
            {day.subtitle && <em>{day.subtitle}</em>}
          </div>
        </div>
        {day.description && <p className="day-brief-lead">{day.description}</p>}
        {hasBriefItems && (
          <div className="day-brief-body">
            {seeAndDoBlock}
            {(stayCard || mealCard) && (
              <div className="day-brief-card-list">
                {stayCard}
                {mealCard}
              </div>
            )}
          </div>
        )}
      </section>
    );

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
      <div key={day.day_number} className={`slide ${currentSlide === slideIndex ? 'active' : ''}`}>
        <div className="day-slide">
          {visualSection}
          <div className="day-content-stack">
            {briefSection}
            {transSection}
            {servicesSection}
            {tipsSection}
          </div>
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
              <button className="overview-back" onClick={() => setShowArchive(false)} aria-label="Back to OurTrips">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h1 className="overview-title">Archive</h1>
            </>
          ) : (
            <>
              <h1 className="overview-title">OurTrips</h1>
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
                <div className="text-nav-title">{trip.name} — {trip.subtitle}</div>
              )}
            </div>
            {shareId && trip && (
              <SaveOfflineButton shareId={shareId} data={{ trip, days }} />
            )}
          </div>

          {/* Date Strip */}
          <div className={`date-strip ${isHero ? 'hidden' : ''}`}>
            <div className="date-strip-inner" ref={dateStripRef}>
              {days.map((day, dayIndex) => {
                const date = new Date(day.date + 'T12:00:00');
                const wd = date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
                const d = date.getDate();
                const slideIndex = dayIndex + 1;
                return (
                  <button key={day.day_number} className={`date-btn ${currentSlide === slideIndex ? 'active' : ''}`}
                    onClick={() => { if (!dateStripDragged.current) goTo(slideIndex); }}
                    aria-current={currentSlide === slideIndex ? 'date' : undefined}
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
            <div className={`swipe-track motion-${slideMotionMode} direction-${slideDirection}`} ref={trackRef}>
              {shouldRenderSlideContent(0) ? renderHeroSlide() : renderPlaceholderSlide(0, 'cover')}
              {days.map((day, dayIndex) => {
                const slideIndex = dayIndex + 1;
                return shouldRenderSlideContent(slideIndex)
                  ? renderDaySlide(day, slideIndex)
                  : renderPlaceholderSlide(slideIndex, day.day_number);
              })}
            </div>
          </div>

          {/* Bottom drawer — sticky chrome holding swipe-dots and the
              Explore CTA on the cover. Content above scrolls behind it. */}
          <div className={`trip-bottom-drawer ${currentSlide === 0 ? 'on-hero' : ''}`}>
            {currentSlide !== 0 && (
              <SwipeDots total={totalSlides} current={currentSlide} onDotClick={goTo} />
            )}
            {currentSlide === 0 && totalSlides > 1 && (
              <button className="hero-hint" onClick={() => goTo(1)} aria-label="Open day by day itinerary">
                Day by Day
                <Icon name="chevron" />
              </button>
            )}
          </div>

          {/* Floating Add to Trips button */}
          {shareId && canAddToTrips && saveStatus !== 'already_owned' && (
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
                ) : shareMode === 'remix' ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                    Remix this trip
                  </>
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
      <div className={`detail-overlay ${detailOpen ? 'open' : ''} ${detailClosing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={detailContent.title}>
        <div className="detail-backdrop" onClick={closeDetail} />
        <div className={`detail-sheet ${detailContent.sheetClassName ?? ''}`}>
          <div className="detail-header">
            <div className="text-nav-title" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}>
              {detailContent.title}
            </div>
            <button className="detail-close" onClick={closeDetail} aria-label="Close details">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </div>
          <div ref={detailBodyRef} className={`detail-body ${detailContent.node ? 'detail-body-react' : ''}`}>
            {detailContent.node ?? (
              <div dangerouslySetInnerHTML={{ __html: detailContent.html }} />
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
