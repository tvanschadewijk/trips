'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { TripData, Day, Transport, Accommodation } from '@/lib/types';
import { ICONS } from './icons';
import '@/styles/preview.css';

interface TripPreviewProps {
  trips: TripData[];
  onDelete?: (index: number) => void;
  autoOpen?: boolean;
}

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
}

function formatDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', opts);
}

export default function TripPreview({ trips: initialTrips, onDelete, autoOpen }: TripPreviewProps) {
  const [trips, setTrips] = useState(initialTrips);
  const [activeTripIndex, setActiveTripIndex] = useState<number | null>(autoOpen ? 0 : null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContent, setDetailContent] = useState<{ title: string; html: string }>({ title: '', html: '' });
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [overviewFaded, setOverviewFaded] = useState(autoOpen ? true : false);
  const [cardVars, setCardVars] = useState({ top: '0px', right: '0px', bottom: '0px', left: '0px' });
  const [showArchive, setShowArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dateStripRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);

  // Touch state
  const touchState = useRef({ startX: 0, startY: 0, dx: 0, isDragging: false, isScrolling: null as boolean | null });
  const didAutoNav = useRef(false);

  const trip = activeTripIndex !== null ? trips[activeTripIndex]?.trip : null;
  const days = activeTripIndex !== null ? trips[activeTripIndex]?.days || [] : [];
  const totalSlides = 1 + days.length;
  const isHero = currentSlide === 0;

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, totalSlides - 1));
    setCurrentSlide(clamped);
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(-${clamped * 100}cqi)`;
      trackRef.current.classList.remove('dragging');
    }
    // Scroll active date into view
    setTimeout(() => {
      const activeBtn = dateStripRef.current?.querySelector('.date-btn.active');
      activeBtn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 50);
    // Reset slide scroll position
    const slides = trackRef.current?.querySelectorAll('.slide');
    if (slides?.[clamped]) (slides[clamped] as HTMLElement).scrollTop = 0;
  }, [totalSlides]);

  // Open trip with grow animation
  const openTrip = useCallback((idx: number, cardEl: HTMLElement) => {
    const td = trips[idx];
    if (!td.days.length) return;

    const appEl = appRef.current;
    if (!appEl) return;
    const appRect = appEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    setCardVars({
      top: (cardRect.top - appRect.top) + 'px',
      right: (appRect.right - cardRect.right) + 'px',
      bottom: (appRect.bottom - cardRect.bottom) + 'px',
      left: (cardRect.left - appRect.left) + 'px',
    });

    setActiveTripIndex(idx);
    setCurrentSlide(0);
    setOverviewFaded(true);
    setIsAnimatingIn(true);
  }, [trips]);

  const closeTrip = useCallback(() => {
    if (activeTripIndex === null || autoOpen) return;
    setIsAnimatingOut(true);
    setOverviewFaded(false);
  }, [activeTripIndex, autoOpen]);

  // Handle nav back
  const handleBack = useCallback(() => {
    if (currentSlide > 0) goTo(0);
    else closeTrip();
  }, [currentSlide, goTo, closeTrip]);

  // Animation end — use timeout as fallback since animationend may not fire
  // when element enters the DOM and animation starts in the same frame
  useEffect(() => {
    if (!isAnimatingIn && !isAnimatingOut) return;
    const duration = isAnimatingIn ? 500 : 450;
    const timer = setTimeout(() => {
      if (isAnimatingIn) setIsAnimatingIn(false);
      if (isAnimatingOut) {
        setIsAnimatingOut(false);
        setActiveTripIndex(null);
      }
    }, duration);
    return () => clearTimeout(timer);
  }, [isAnimatingIn, isAnimatingOut]);

  // Touch handlers
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || activeTripIndex === null) return;

    const onStart = (e: TouchEvent) => {
      touchState.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, dx: 0, isDragging: true, isScrolling: null };
      trackRef.current?.classList.add('dragging');
    };
    const onMove = (e: TouchEvent) => {
      const ts = touchState.current;
      if (!ts.isDragging) return;
      const moveX = e.touches[0].clientX - ts.startX;
      const moveY = e.touches[0].clientY - ts.startY;
      if (ts.isScrolling === null && (Math.abs(moveX) > 10 || Math.abs(moveY) > 10)) {
        // Bias toward vertical scroll: require horizontal movement to be
        // noticeably dominant (>1.5× vertical) before treating as a swipe
        ts.isScrolling = Math.abs(moveX) <= Math.abs(moveY) * 1.5;
      }
      if (ts.isScrolling) return;
      e.preventDefault();
      ts.dx = moveX;
      if (trackRef.current) trackRef.current.style.transform = `translateX(calc(-${currentSlide * 100}cqi + ${ts.dx}px))`;
    };
    const onEnd = () => {
      const ts = touchState.current;
      if (!ts.isDragging) return;
      ts.isDragging = false;
      if (ts.isScrolling) { trackRef.current?.classList.remove('dragging'); return; }
      const threshold = vp.offsetWidth * 0.2;
      if (ts.dx < -threshold && currentSlide < totalSlides - 1) goTo(currentSlide + 1);
      else if (ts.dx > threshold && currentSlide > 0) goTo(currentSlide - 1);
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
        setActiveTripIndex(i);
        setOverviewFaded(true);
        setIsAnimatingIn(true);
        setCurrentSlide(slideIdx);
        setTimeout(() => {
          if (trackRef.current) {
            trackRef.current.style.transform = `translateX(-${slideIdx * 100}cqi)`;
          }
          const activeBtn = dateStripRef.current?.querySelector('.date-btn.active');
          activeBtn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }, 100);
        break;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detail sheet
  function openDetail(type: 'transport' | 'accommodation', item: Transport | Accommodation) {
    if (!item || !(item as Transport).detail && !(item as Accommodation).detail) return;

    if (type === 'transport') {
      const t = item as Transport;
      const d = t.detail!;
      const title = t.label || 'Transport';
      const fields: [string, string | undefined][] = [
        ['Route', `${t.from || ''} → ${t.to || ''}`],
        ['Departure', t.depart], ['Arrival', t.arrive], ['Duration', t.duration],
        ['Platform', d.platform], ['Flight', d.flight], ['Terminal', d.terminal], ['Gate', d.gate],
        ['Class', d.class], ['Cabin', d.cabin], ['Seats', d.seats || d.seat],
        ['Booking ref', d.booking_ref], ['Booked via', d.booking_platform],
        ['Cabin bag', d.cabin_bag], ['Hold bag', d.hold_bag], ['Check-in', d.check_in],
        ['Amenities', d.amenities], ['Cancellation', d.cancellation_policy], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value">${v}</span></div>`
      ).join('');
      setDetailContent({
        title,
        html: `<div class="detail-info-section"><div class="detail-info-section-title"><span class="text-section-title">${t.mode === 'plane' ? 'Flight' : 'Journey'} Details</span></div>${rows}</div>`
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
        <Image className="trip-card-img" src={img} alt={t.name} fill sizes="430px" style={{ objectFit: 'cover' }} />
        <div className="trip-card-gradient" />
        <div className="trip-card-badge">{statusLabel}</div>
        <button className="trip-card-delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(origIdx); }} aria-label={`Delete ${t.name}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
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

  // Render hero slide
  function renderHeroSlide() {
    if (!trip) return null;
    return (
      <div className="slide">
        <div className="hero-slide">
          <div className="hero-bg">
            <Image src={trip.hero_image} alt={trip.name} fill sizes="430px" priority style={{ objectFit: 'cover' }} />
          </div>
          <div className="hero-overlay" />
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
        <Image src={day.hero_image} alt={day.title} fill sizes="430px" style={{ objectFit: 'cover' }} />
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

    const progSection = day.blocks?.length ? (
      <div className="day-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="calendar" /></span>Programme</span>
        </div>
        <div className="time-blocks">
          {day.blocks.map((b, i) => (
            <div key={i} className={`time-block ${b.type === 'transport' ? 'is-transport' : ''}`}>
              <p className="text-label-dark" style={{ margin: '0 0 2px' }}>{b.time_label}</p>
              <p className="text-body" style={{ margin: 0 }}>{b.content}</p>
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
              <div className="transport-route">{t.from || ''} → {t.to || ''} {t.duration ? `· ${t.duration}` : ''}</div>
            </div>
            {t.depart && <div className="text-mono">{t.depart}</div>}
            {t.detail && <span className="tap-chevron"><Icon name="chevron" /></span>}
          </div>
        ))}
      </div>
    ) : null;

    // Services matched to this day
    let servicesSection = null;
    if (trip?.services?.length) {
      const dayServices = trip.services.filter(s => s.legs?.some(l => l.date === day.date));
      if (dayServices.length) {
        servicesSection = dayServices.map((svc, si) => {
          const todayLegs = svc.legs!.filter(l => l.date === day.date);
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
        });
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
          <div key={i} className="meal-row">
            <span className="meal-type-badge">{m.type}</span>
            <div className="meal-detail">
              <div className="text-name">{m.name}</div>
              {m.note && <div className="text-small" style={{ marginTop: 1 }}>{m.note}</div>}
            </div>
            {m.status && <span className={`text-status status-badge status-${m.status}`} style={{ flexShrink: 0 }}>{m.status}</span>}
          </div>
        ))}
      </div>
    ) : null;

    return (
      <div key={day.day_number} className="slide">
        <div className="day-slide">
          {heroSection}
          {progSection}
          {transSection}
          {servicesSection}
          {accomSection}
          {mealsSection}
        </div>
      </div>
    );
  }

  return (
    <div className="trip-app" ref={appRef}>
      {/* Overview Screen */}
      <div className={`overview-screen ${overviewFaded ? 'faded' : ''}`}>
        <div className="overview-header">
          {showArchive ? (
            <>
              <button className="overview-back" onClick={() => setShowArchive(false)} aria-label="Back to trips">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h1 className="overview-title">Archive</h1>
            </>
          ) : (
            <>
              <h1 className="overview-title">Trips</h1>
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
          className={`trip-screen ${isAnimatingIn ? 'animating-in' : ''} ${isAnimatingOut ? 'animating-out' : ''}`}
          style={{
            display: 'flex',
            '--card-top': cardVars.top,
            '--card-right': cardVars.right,
            '--card-bottom': cardVars.bottom,
            '--card-left': cardVars.left,
          } as React.CSSProperties}
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
                    onClick={() => goTo(day.day_number)}
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
          <div className="swipe-dots" role="tablist" aria-label="Trip slides">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <div key={i} className={`swipe-dot ${i === currentSlide ? 'active' : ''}`}
                role="tab" aria-selected={i === currentSlide} aria-label={i === 0 ? 'Overview' : `Day ${i}`}
                tabIndex={i === currentSlide ? 0 : -1}
                style={{ cursor: 'pointer' }} onClick={() => goTo(i)} />
            ))}
          </div>
        </div>
      )}

      {/* Detail sheet */}
      <div className={`detail-overlay ${detailOpen ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label={detailContent.title}>
        <div className="detail-backdrop" onClick={closeDetail} />
        <div className="detail-sheet">
          <div className="detail-header">
            <button className="detail-close" onClick={closeDetail} aria-label="Close details">
              <Icon name="back" />
            </button>
            <div className="text-nav-title" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}>
              {detailContent.title}
            </div>
          </div>
          <div className="detail-body" dangerouslySetInnerHTML={{ __html: detailContent.html }} />
        </div>
      </div>
    </div>
  );
}
