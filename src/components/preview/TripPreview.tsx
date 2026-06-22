'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { TripData, Day, Transport, Accommodation, Tip, Meal, Block, RichDetail, Service } from '@/lib/types';
import { TripIcon as Icon } from './icons';
import TripRouteAtlas from './TripRouteAtlas';
import ItineraryMap, { type ItineraryMapFocusRequest, type ItineraryMapViewAllRequest } from './ItineraryMap';
import AccommodationReviewBoard from './AccommodationReviewBoard';
import { renderTripMarkdown } from '@/lib/render-trip-markdown';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { createClient } from '@/lib/supabase/client';
import AppTopBar from '@/components/ui/AppTopBar';
import { buildTripOverviewRouteAtlas, buildTripRouteAtlas, type TripRouteAtlas as TripRouteAtlasData } from '@/lib/trip-route';
import {
  buildDayMapDataByNumber,
  EMPTY_DAY_MAP_ATLAS,
  mapPointDetailsForTrip,
} from '@/lib/day-map';
import { getTripOverviewImageUrl } from '@/lib/trip-images';
import { isConfirmedAccommodation } from '@/lib/trip-status';
import { isTripSavedOffline, useOfflineTrip } from '@/lib/offline';
import '@/styles/preview.css';

/** Extract 3-letter IATA airport codes from a string like "Amsterdam (AMS) → New York (JFK)" */
function extractIataCodes(s: string): string[] {
  const matches = s.match(/\b[A-Z]{3}\b/g);
  return matches || [];
}

const SHARE_MODE_OPTIONS = ['companion', 'remix', 'private'] as const;
type ShareMode = (typeof SHARE_MODE_OPTIONS)[number];
const TRIP_DATA_UPDATED_EVENT = 'ourtrips:trip-data-updated';

type TripDataUpdatedEventDetail = {
  tripId?: string;
  tripData?: TripData;
};

function detailFromTripDataEvent(event: CustomEvent<unknown>): TripDataUpdatedEventDetail | undefined {
  if (!event.detail || typeof event.detail !== 'object') return undefined;
  return event.detail as TripDataUpdatedEventDetail;
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
  shareMode?: ShareMode;
  tripId?: string;
  homeHref?: string;
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

function notifyOfflineStatusChanged(shareId: string, saved: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('ourtrips:offline-status-changed', {
      detail: { shareId, saved },
    })
  );
}

function shareModeLabel(mode: ShareMode): string {
  if (mode === 'private') return 'Private';
  if (mode === 'remix') return 'Remix link';
  return 'Companion link';
}

function shareModeHint(mode: ShareMode): string {
  if (mode === 'private') return 'Link is off';
  if (mode === 'remix') return 'Public, PII removed, others can remix';
  return 'Anyone with the link sees full bookings';
}

function shareModeIcon(mode: ShareMode): string {
  if (mode === 'private') return 'x';
  if (mode === 'remix') return 'shuffle';
  return 'users';
}

function routeStopCountFor(atlas: ReturnType<typeof buildTripRouteAtlas>): number {
  if (!atlas) return 0;
  const tripStops = atlas.points.filter((point) => point.role !== 'home' && point.role !== 'return');
  return tripStops.length || atlas.points.length;
}

type OverviewRouteGroups = {
  outbound: string[];
  returnVia: string[];
};

type OverviewHighlight = {
  icon: string;
  label: string;
};

type OverviewMetric = {
  icon: string;
  value: string;
  label: string;
};

function formatHeroDateRange(startStr: string, endStr: string): string {
  const start = new Date(`${startStr}T12:00:00`);
  const end = new Date(`${endStr}T12:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.toLocaleDateString('en-GB', { day: 'numeric' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  if (sameYear) {
    return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function tripNightCount(startStr: string, endStr: string): number {
  const start = new Date(`${startStr}T12:00:00`);
  const end = new Date(`${endStr}T12:00:00`);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function cleanedRouteLabel(value: unknown): string {
  const text = trimDisplayText(value)
    .replace(/\s*\([A-Z]{3}\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  return text
    .replace(/\b(?:airport|terminal|station|centraal|central)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || text;
}

function addUniqueText(list: string[], value: unknown, max = Number.POSITIVE_INFINITY): void {
  if (list.length >= max) return;
  const label = cleanedRouteLabel(value);
  if (!label) return;
  const key = normalizeMapFocusLabel(label);
  if (!key || list.some((item) => normalizeMapFocusLabel(item) === key)) return;
  list.push(label);
}

function destinationFromDayTitle(title: string): string {
  const parts = title
    .replace(/[–—]/g, '→')
    .split('→')
    .map((part) => part.trim())
    .filter(Boolean);
  return cleanedRouteLabel(parts[parts.length - 1] || title);
}

function fallbackRouteLabels(days: Day[]): string[] {
  const labels: string[] = [];
  for (const day of days) {
    for (const transport of day.transport ?? []) {
      addUniqueText(labels, transport.from, 8);
      addUniqueText(labels, transport.to, 8);
    }
    addUniqueText(labels, destinationFromDayTitle(day.title), 8);
  }
  return labels;
}

function overviewRouteGroups(atlas: TripRouteAtlasData | undefined, days: Day[]): OverviewRouteGroups {
  const points = atlas?.points ?? [];
  if (!points.length) return { outbound: fallbackRouteLabels(days).slice(0, 6), returnVia: [] };

  const firstLabel = cleanedRouteLabel(points[0]?.label);
  const firstKey = normalizeMapFocusLabel(firstLabel);
  let returnStartIndex = points.findIndex((point, index) => index > 0 && point.role === 'return');

  if (returnStartIndex < 0 && firstKey && points.length > 5) {
    const lastKey = normalizeMapFocusLabel(points[points.length - 1]?.label);
    if (lastKey === firstKey) returnStartIndex = Math.max(2, Math.ceil((points.length - 1) / 2));
  }

  const outboundPoints = returnStartIndex >= 0 ? points.slice(0, returnStartIndex) : points;
  const returnPoints = returnStartIndex >= 0 ? points.slice(returnStartIndex) : [];
  const outbound: string[] = [];
  const returnVia: string[] = [];

  for (const point of outboundPoints) addUniqueText(outbound, point.label, 7);
  for (const point of returnPoints) {
    const key = normalizeMapFocusLabel(point.label);
    if (key && key === firstKey) continue;
    addUniqueText(returnVia, point.label, 6);
  }

  if (!outbound.length) return { outbound: fallbackRouteLabels(days).slice(0, 6), returnVia };
  return { outbound, returnVia };
}

function overviewHighlightIcon(label: string): string {
  const normalized = normalizeMapFocusLabel(label);
  if (/\b(wine|vineyard|winery)\b/.test(normalized)) return 'wine';
  if (/\b(lake|coast|beach|sea|river|island)\b/.test(normalized)) return 'map';
  if (/\b(mountain|peak|trail|park|forest|glen|valley|way)\b/.test(normalized)) return 'mountain';
  if (/\b(restaurant|dinner|lunch|food|market|cafe|bakery)\b/.test(normalized)) return 'fork';
  if (/\b(hotel|stay|camp|lodge)\b/.test(normalized)) return 'hotel';
  return 'binoculars';
}

function overviewHighlights(atlas: TripRouteAtlasData | undefined, days: Day[]): OverviewHighlight[] {
  const labels: string[] = [];
  const routePoints = (atlas?.points ?? []).filter((point) => point.role !== 'home' && point.role !== 'return');
  for (const point of routePoints) addUniqueText(labels, point.label, 6);

  for (const day of days) {
    addUniqueText(labels, day.description_title, 6);
    addUniqueText(labels, day.subtitle, 6);
    addUniqueText(labels, destinationFromDayTitle(day.title), 6);

    for (const block of day.blocks ?? []) {
      addUniqueText(labels, block.place?.name, 6);
      addUniqueText(labels, block.detail?.title, 6);
    }
  }

  return labels.slice(0, 6).map((label) => ({
    label,
    icon: overviewHighlightIcon(label),
  }));
}

function dominantTransportSummary(days: Day[]): { icon: string; label: string } {
  const text = days
    .flatMap((day) => day.transport ?? [])
    .flatMap((transport) => [transport.mode, transport.label])
    .map(trimDisplayText)
    .join(' ')
    .toLowerCase();

  if (/\b(car|drive|driving|self[-\s]?drive|road)\b/.test(text)) return { icon: 'car', label: 'Self-drive' };
  if (/\b(train|rail|eurostar)\b/.test(text)) return { icon: 'train', label: 'Rail' };
  if (/\b(ferry|ship|boat)\b/.test(text)) return { icon: 'ferry', label: 'Ferry' };
  if (/\b(plane|flight|air)\b/.test(text)) return { icon: 'plane', label: 'Flights' };
  if (/\b(walk|hike|trail)\b/.test(text)) return { icon: 'walk', label: 'Walking' };
  return { icon: 'route', label: 'Route' };
}

function distanceKmFromText(value: unknown): number {
  const text = trimDisplayText(value).replace(/,/g, '');
  if (!text) return 0;
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)\b/gi)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
}

function formatKm(value: number): string {
  if (value >= 1000) return `~${Math.round(value / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (value > 0) return `~${Math.round(value)}`;
  return '';
}

function overviewMetrics(days: Day[], atlas: TripRouteAtlasData | undefined, nights: number): OverviewMetric[] {
  const hotelNames: string[] = [];
  const natureLabels: string[] = [];
  let distanceKm = 0;

  for (const day of days) {
    const accommodationName = trimDisplayText(day.accommodation?.name);
    if (accommodationName && !isPlaceholderAccommodationName(accommodationName)) addUniqueText(hotelNames, accommodationName);

    const natureText = [
      day.title,
      day.subtitle,
      day.description_title,
      day.description,
      ...(day.blocks ?? []).flatMap((block) => [block.content, block.detail?.title]),
    ].join(' ');
    if (/\b(?:national park|park|lake|mountain|trail|forest|coast|beach|island|valley|glen|way)\b/i.test(natureText)) {
      addUniqueText(natureLabels, destinationFromDayTitle(day.title));
    }

    for (const transport of day.transport ?? []) {
      distanceKm += distanceKmFromText(transport.distance);
    }
  }

  const routeStops = routeStopCountFor(atlas);
  const metrics: OverviewMetric[] = [];

  if (hotelNames.length) {
    metrics.push({ icon: 'hotel', value: String(hotelNames.length), label: hotelNames.length === 1 ? 'Hotel' : 'Hotels' });
  } else {
    metrics.push({ icon: 'moon', value: String(nights), label: nights === 1 ? 'Night' : 'Nights' });
  }

  metrics.push({
    icon: 'mountain',
    value: String(natureLabels.length || Math.max(1, days.filter((day) => day.blocks?.length || day.meals?.length).length)),
    label: natureLabels.length ? 'Nature stops' : 'Planned days',
  });

  metrics.push({
    icon: 'map',
    value: String(routeStops || days.length),
    label: routeStops === 1 ? 'Route stop' : 'Route stops',
  });

  metrics.push({
    icon: dominantTransportSummary(days).icon,
    value: formatKm(distanceKm) || String(days.length),
    label: distanceKm > 0 ? 'km logged' : 'days planned',
  });

  return metrics;
}

function overviewSummaryText(summary: string | undefined): string {
  const text = trimDisplayText(summary);
  if (!text) return 'All the details about the route, stays, reservations and important notes.';
  if (text.length <= 120) return text;
  return `${text.slice(0, 117).replace(/\s+\S*$/, '')}...`;
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
const DETAIL_CLOSE_MS = 420;
const NEARBY_SLIDE_RENDER_RADIUS = 1;

type DetailContent = {
  title: string;
  html: string;
  node?: ReactNode;
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
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.toLowerCase() === 'undefined' ? '' : trimmed;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest('input, textarea, select, [contenteditable], [role="textbox"]');
  if (!editable) return false;
  if (editable instanceof HTMLElement && editable.isContentEditable) return true;
  return editable.matches('input, textarea, select, [role="textbox"]');
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

type DayIntro = {
  title: string;
  body: string;
  legacyBlock?: Block;
};

function getLegacyDayIntroBlock(day: Day): Block | undefined {
  const block = day.blocks?.[0];
  if (!block || block.type === 'note') return undefined;

  const type = trimDisplayText(block.type).toLowerCase();
  const isIntroType = type.includes('intro') || ['overview', 'description', 'summary'].includes(type);
  const isUntimed = !trimDisplayText(block.time_label);
  if (!isIntroType && !isUntimed) return undefined;

  const title = trimDisplayText(block.detail?.title) || trimDisplayText(block.content);
  const body = trimDisplayText(block.detail?.body) || trimDisplayText(block.detail?.why);
  return title && body ? block : undefined;
}

function getDayIntro(day: Day): DayIntro {
  const title = trimDisplayText(day.description_title);
  const body = trimDisplayText(day.description);
  if (title || body) return { title, body };

  const legacyBlock = getLegacyDayIntroBlock(day);
  if (!legacyBlock) return { title: '', body: '' };

  return {
    title: trimDisplayText(legacyBlock.detail?.title) || trimDisplayText(legacyBlock.content),
    body: trimDisplayText(legacyBlock.detail?.body) || trimDisplayText(legacyBlock.detail?.why),
    legacyBlock,
  };
}

function accommodationStatusLabel(accommodation: Accommodation): string {
  return accommodation.status?.trim() || 'pending';
}

type TodoItemType = 'transport' | 'accommodation' | 'meal';
type TodoItemStatus = 'booked' | 'open';

function todoBookingStatus(item: { booking_status?: string; status?: string }): string {
  return trimDisplayText(item.booking_status) || trimDisplayText(item.status);
}

function isTodoDoneStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === 'booked' || normalized === 'confirmed';
}

function todoStatusFromDone(done: boolean): TodoItemStatus {
  return done ? 'booked' : 'open';
}

function todoStatusFromItem(item: { booking_status?: string; status?: string }): TodoItemStatus {
  return todoStatusFromDone(isTodoDoneStatus(todoBookingStatus(item)));
}

function isNoActionBookingStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === 'not_required' || normalized === 'not required' || normalized === 'optional' || normalized === 'none' || normalized === 'n/a';
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

function mealReservationText(meal: Meal): string {
  return [
    meal.detail?.reservation,
    meal.detail?.booking_note,
    meal.detail?.practical,
    meal.note,
  ].map(trimDisplayText).filter(Boolean).join(' · ');
}

function isMealReservationAction(meal: Meal): boolean {
  const bookingStatus = trimDisplayText(meal.booking_status);
  const legacyStatus = trimDisplayText(meal.status);
  const status = bookingStatus || legacyStatus;
  const reservationText = mealReservationText(meal);
  if (isNoActionBookingStatus(status)) return false;
  if (meal.reservation_required) return true;
  if (/\b(?:reserv|book|pre-?book|table|advance|ahead|before|confirm|required|essential|recommended|vooraf|van tevoren)\b/i.test(reservationText)) return true;
  if (bookingStatus && meal.reservation_required !== false) return true;

  return isTodoDoneStatus(legacyStatus) && Boolean(reservationText);
}

function mealTodoLabel(meal: Meal): string {
  const name = trimDisplayText(meal.name) || trimDisplayText(meal.place?.name) || 'restaurant';
  return `Reserve ${name}`;
}

function mealTodoDetail(day: Day, meal: Meal): string {
  const mealType = trimDisplayText(meal.type) || 'meal';
  const reservation = mealReservationText(meal);
  return [`Day ${day.day_number}`, mealType, reservation].filter(Boolean).join(' · ');
}

function hasSelectedTextWithin(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  return Boolean(
    (selection.anchorNode && element.contains(selection.anchorNode)) ||
    (selection.focusNode && element.contains(selection.focusNode))
  );
}

function normalizeServiceText(value: unknown): string {
  return normalizeMapFocusLabel(trimDisplayText(value));
}

function isMealReservationService(service: Service, day: Day): boolean {
  const serviceText = normalizeServiceText([
    service.type,
    service.label,
    service.provider,
  ].filter(Boolean).join(' '));
  const legText = normalizeServiceText((service.legs ?? []).map((leg) => leg.route).join(' '));
  const mealNames = (day.meals ?? [])
    .map((meal) => normalizeServiceText(meal.place?.name || meal.name))
    .filter(Boolean);
  const mentionsDayMeal = mealNames.some((mealName) => serviceText.includes(mealName) || legText.includes(mealName));
  const hasMealWords = /\b(?:restaurant|restaurants|dining|meal|meals|breakfast|brunch|lunch|dinner)\b/.test(serviceText);
  const hasReservationWords = /\b(?:reservation|reservations|booking|bookings)\b/.test(serviceText);

  return hasMealWords || (hasReservationWords && mentionsDayMeal) || mentionsDayMeal;
}

function displayableTips(tips: Tip[] | undefined): Tip[] {
  return (tips ?? []).filter((tip) => trimDisplayText(tip.content));
}

function tipDisplayTitle(tip: Tip): string {
  return trimDisplayText(tip.title) || 'Tip';
}

function mealDisplayName(meal: Meal): string {
  return trimDisplayText(meal.name) || trimDisplayText(meal.place?.name);
}

function mealHasDetail(meal: Meal): boolean {
  if (!meal.detail) return false;
  return Boolean(
    renderRichDetail(meal.detail) ||
      trimDisplayText(meal.detail.address) ||
      trimDisplayText(meal.detail.phone) ||
      trimDisplayText(meal.detail.cuisine) ||
      trimDisplayText(meal.detail.price_range) ||
      trimDisplayText(meal.detail.reservation) ||
      trimDisplayText(meal.detail.hours) ||
      trimDisplayText(meal.detail.note)
  );
}

function displayableMeals(meals: Meal[] | undefined): Meal[] {
  return (meals ?? []).filter((meal) => (
    mealDisplayName(meal) ||
    trimDisplayText(meal.note) ||
    trimDisplayText(meal.detail?.body) ||
    trimDisplayText(meal.detail?.why) ||
    trimDisplayText(meal.detail?.booking_note) ||
    mealHasDetail(meal)
  ));
}

type TodayPlanItem = {
  key: string;
  icon: string;
  label: string;
  meta?: string;
  status?: string;
  mapLabel?: string;
  minute?: number;
};

type TodayPlan = {
  current?: TodayPlanItem;
  next?: TodayPlanItem;
  later: TodayPlanItem[];
  sleep?: TodayPlanItem;
  transport?: TodayPlanItem;
  meal?: TodayPlanItem;
  openActionCount: number;
};

const TIME_BUCKET_MINUTES: Record<string, number> = {
  sunrise: 390,
  early: 480,
  morning: 540,
  'late morning': 660,
  midday: 720,
  lunch: 750,
  afternoon: 900,
  'late afternoon': 1020,
  sunset: 1080,
  evening: 1140,
  dinner: 1170,
  night: 1260,
};

function firstTimeMinute(value: string | undefined): number | undefined {
  const raw = trimDisplayText(value);
  if (!raw) return undefined;
  const exact = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(raw);
  if (exact) return Number(exact[1]) * 60 + Number(exact[2]);

  const normalized = raw.toLowerCase();
  const matchingBucket = Object.entries(TIME_BUCKET_MINUTES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([label]) => normalized.includes(label));
  return matchingBucket?.[1];
}

function mealFallbackMinute(meal: Meal): number {
  const type = trimDisplayText(meal.type).toLowerCase();
  if (type.includes('breakfast')) return 510;
  if (type.includes('brunch')) return 660;
  if (type.includes('lunch')) return 750;
  if (type.includes('dinner')) return 1170;
  return 780;
}

function nowMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function statusForPlanItem(value: string | undefined): string | undefined {
  const status = trimDisplayText(value);
  return status || undefined;
}

function isOpenPlanStatus(value: string | undefined): boolean {
  const status = trimDisplayText(value).toLowerCase();
  return status === 'open' || status === 'pending' || status === 'reserved' || status === 'hold';
}

function buildTodayPlan(day: Day): TodayPlan {
  const items: TodayPlanItem[] = [];

  for (const [index, block] of (day.blocks ?? []).entries()) {
    const label = blockDisplayText(block);
    if (!label) continue;
    const timeLabel = trimDisplayText(block.time_label);
    const minute = firstTimeMinute(block.starts_at) ?? firstTimeMinute(timeLabel);
    items.push({
      key: `block-${index}`,
      icon: block.type === 'transport' ? 'route' : block.type === 'meal' ? 'fork' : 'binoculars',
      label,
      meta: [timeLabel, trimDisplayText(block.place?.name), trimDisplayText(block.cost_hint)].filter(Boolean).join(' · '),
      status: statusForPlanItem(block.booking_status),
      mapLabel: trimDisplayText(block.place?.name) || label,
      minute,
    });
  }

  for (const [index, transport] of (day.transport ?? []).entries()) {
    const route = [trimDisplayText(transport.from), trimDisplayText(transport.to)].filter(Boolean).join(' → ');
    const minute = firstTimeMinute(transport.depart);
    items.push({
      key: `transport-${index}`,
      icon: trimDisplayText(transport.mode) || 'route',
      label: trimDisplayText(transport.label) || route || 'Transport',
      meta: [trimDisplayText(transport.depart), route, trimDisplayText(transport.duration)].filter(Boolean).join(' · '),
      status: statusForPlanItem(transport.booking_status ?? transport.status),
      mapLabel: trimDisplayText(transport.to) || trimDisplayText(transport.from),
      minute,
    });
  }

  const visibleMeals = displayableMeals(day.meals);

  for (const [index, meal] of visibleMeals.entries()) {
    const minute = firstTimeMinute(meal.starts_at) ?? firstTimeMinute(meal.detail?.reservation) ?? mealFallbackMinute(meal);
    items.push({
      key: `meal-${index}`,
      icon: 'fork',
      label: trimDisplayText(meal.name) || 'Meal',
      meta: [trimDisplayText(meal.type), trimDisplayText(meal.starts_at), trimDisplayText(meal.detail?.cuisine), trimDisplayText(meal.cost_hint)].filter(Boolean).join(' · '),
      status: statusForPlanItem(meal.booking_status ?? meal.status),
      mapLabel: trimDisplayText(meal.place?.name) || trimDisplayText(meal.name),
      minute,
    });
  }

  const sorted = items.sort((left, right) => (left.minute ?? 9999) - (right.minute ?? 9999));
  const nowMinute = nowMinuteOfDay();
  const currentIndex = sorted.findIndex((item, index) => {
    if (typeof item.minute !== 'number') return false;
    const nextMinute = sorted.slice(index + 1).find((candidate) => typeof candidate.minute === 'number')?.minute;
    return item.minute <= nowMinute && (typeof nextMinute !== 'number' || nowMinute < nextMinute);
  });
  const current = currentIndex >= 0 ? sorted[currentIndex] : undefined;
  const next = sorted.find((item, index) => (
    index !== currentIndex &&
    (typeof item.minute !== 'number' || item.minute >= nowMinute)
  )) ?? sorted.find((item, index) => index !== currentIndex) ?? sorted[0];
  const later = sorted
    .filter((item) => item.key !== current?.key && item.key !== next?.key)
    .slice(0, 2);

  const accommodation = day.accommodation;
  const firstTransport = day.transport?.[0];
  const firstMeal = visibleMeals[0];

  let openActionCount = 0;
  for (const transport of day.transport ?? []) {
    if (isOpenPlanStatus(transport.booking_status ?? transport.status)) openActionCount += 1;
  }
  if (day.accommodation && !isTodoDoneStatus(day.accommodation.booking_status ?? day.accommodation.status)) openActionCount += 1;
  for (const meal of visibleMeals) {
    if (meal.reservation_required && !isTodoDoneStatus(meal.booking_status ?? meal.status)) openActionCount += 1;
  }

  return {
    current,
    next,
    later,
    sleep: accommodation
      ? {
          key: 'sleep',
          icon: 'hotel',
          label: isPlaceholderAccommodationName(accommodation.name) ? 'Hotel not confirmed yet' : accommodation.name,
          meta: [formatNightLabel(accommodation.nights), trimDisplayText(accommodation.detail?.check_in)].filter(Boolean).join(' · '),
          status: statusForPlanItem(accommodation.booking_status ?? accommodation.status),
          mapLabel: accommodation.name,
        }
      : undefined,
    transport: firstTransport
      ? {
          key: 'transport',
          icon: trimDisplayText(firstTransport.mode) || 'route',
          label: trimDisplayText(firstTransport.label) || [firstTransport.from, firstTransport.to].filter(Boolean).join(' → ') || 'Transport',
          meta: [trimDisplayText(firstTransport.depart), trimDisplayText(firstTransport.duration)].filter(Boolean).join(' · '),
          status: statusForPlanItem(firstTransport.booking_status ?? firstTransport.status),
          mapLabel: trimDisplayText(firstTransport.to) || trimDisplayText(firstTransport.from),
        }
      : undefined,
    meal: firstMeal
      ? {
          key: 'meal',
          icon: 'fork',
          label: trimDisplayText(firstMeal.name) || 'Meal',
          meta: [trimDisplayText(firstMeal.type), trimDisplayText(firstMeal.detail?.reservation)].filter(Boolean).join(' · '),
          status: statusForPlanItem(firstMeal.booking_status ?? firstMeal.status),
          mapLabel: trimDisplayText(firstMeal.place?.name) || trimDisplayText(firstMeal.name),
        }
      : undefined,
    openActionCount,
  };
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

export default function TripPreview({ trips: initialTrips, onDelete, autoOpen, shareId, canAddToTrips, shareMode, tripId, homeHref = '/' }: TripPreviewProps) {
  const normalizedInitialTrips = useMemo(
    () => initialTrips.map((tripData) => normalizeTripData(tripData)),
    [initialTrips]
  );
  const [trips, setTrips] = useState<TripData[]>(() => normalizedInitialTrips);
  // Sync to new initialTrips when the parent re-renders with fresh data (e.g.
  // after the admin chat panel applies an edit and calls router.refresh()).
  useEffect(() => {
    setTrips(normalizedInitialTrips);
  }, [normalizedInitialTrips]);
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
  const [showFullJourneyMap, setShowFullJourneyMap] = useState(false);
  const [isDesktopPreview, setIsDesktopPreview] = useState<boolean | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [coverToast, setCoverToast] = useState<string | null>(null);
  const [confirmingOfflineRemove, setConfirmingOfflineRemove] = useState(false);
  const [coverDeleteConfirm, setCoverDeleteConfirm] = useState(false);
  const [coverDeleteBusy, setCoverDeleteBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'already_saved' | 'already_owned' | 'error'>('idle');
  const [currentShareMode, setCurrentShareMode] = useState<ShareMode>(shareMode ?? 'companion');
  const [inlineBookingKey, setInlineBookingKey] = useState<string | null>(null);
  const [inlineBookingErrorKey, setInlineBookingErrorKey] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [dayMapFocusRequest, setDayMapFocusRequest] = useState<DayMapFocusRequest | null>(null);
  const [dayMapViewAllRequest, setDayMapViewAllRequest] = useState<DayMapViewAllRequest | null>(null);
  const [topbarHidden, setTopbarHidden] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
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
  const coverMenuRef = useRef<HTMLDivElement | null>(null);
  const coverToastTimerRef = useRef<number | null>(null);
  const dayMapFocusNonceRef = useRef(0);
  const dayMapViewAllNonceRef = useRef(0);

  // Touch state
  const touchState = useRef({ startX: 0, startY: 0, startTime: 0, dx: 0, isDragging: false, isScrolling: null as boolean | null });
  const didAutoNav = useRef(false);

  const activeTripData = activeTripIndex !== null ? trips[activeTripIndex] : undefined;
  const trip = activeTripData?.trip ?? null;
  const days = useMemo(() => activeTripData?.days ?? [], [activeTripData]);
  const offlineTripMeta = useMemo(() => activeTripData ? {
    name: activeTripData.trip.name,
    subtitle: activeTripData.trip.subtitle,
    heroImage: getTripOverviewImageUrl(activeTripData.trip),
    start: activeTripData.trip.dates?.start,
    end: activeTripData.trip.dates?.end,
  } : undefined, [activeTripData]);
  const offlineTrip = useOfflineTrip(shareId, offlineTripMeta);
  const displayableTripNotes = (trip?.notes ?? []).filter((note) => trimDisplayText(note.content));
  const markdownSource = activeTripData?.markdown_source;
  const totalSlides = 1 + days.length;
  const routeAtlases = useMemo(
    () => trips.map((tripData) => buildTripRouteAtlas(tripData)),
    [trips]
  );
  const routeAtlas = activeTripIndex !== null ? routeAtlases[activeTripIndex] : undefined;
  const tripGeographyAtlas = useMemo(
    () => routeAtlas ? buildTripOverviewRouteAtlas(routeAtlas, days) : undefined,
    [routeAtlas, days]
  );
  const overviewMapHidesAccess = Boolean(
    routeAtlas && tripGeographyAtlas && tripGeographyAtlas.points.length < routeAtlas.points.length
  );
  const overviewMapAtlas = showFullJourneyMap && routeAtlas ? routeAtlas : tripGeographyAtlas;
  const hasOverviewMapAtlas = Boolean(overviewMapAtlas);
  const overviewRoutePointDetails = useMemo(
    () => mapPointDetailsForTrip(overviewMapAtlas, days),
    [overviewMapAtlas, days]
  );

  useEffect(() => {
    setShowOverviewMap(false);
    setShowFullJourneyMap(false);
    setTransitionAnchorSlide(null);
  }, [activeTripIndex]);

  useEffect(() => {
    if (!overviewMapHidesAccess) setShowFullJourneyMap(false);
  }, [overviewMapHidesAccess]);

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
    if (isDesktopPreview === true && hasOverviewMapAtlas) setShowOverviewMap(true);
  }, [activeTripIndex, hasOverviewMapAtlas, isDesktopPreview]);

  const dayMapDataByNumber = useMemo(
    () => buildDayMapDataByNumber(
      routeAtlas,
      days,
      [trip?.name, trip?.subtitle, trip?.summary].map(trimDisplayText).filter(Boolean)
    ),
    [routeAtlas, days, trip?.name, trip?.subtitle, trip?.summary]
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

  useEffect(() => {
    if (!shareId || typeof window === 'undefined') {
      setOfflineSaved(false);
      return;
    }

    const sync = () => setOfflineSaved(isTripSavedOffline(shareId));
    const handleOfflineStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ shareId?: string; saved?: boolean }>).detail;
      if (detail?.shareId !== shareId) return;
      setOfflineSaved(Boolean(detail.saved));
    };

    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('ourtrips:offline-status-changed', handleOfflineStatus);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('ourtrips:offline-status-changed', handleOfflineStatus);
    };
  }, [shareId]);

  useEffect(() => {
    setCurrentShareMode(shareMode ?? 'companion');
  }, [shareMode]);

  useEffect(() => {
    setCoverMenuOpen(false);
  }, [activeTripIndex, currentSlide]);

  useEffect(() => {
    setTopbarHidden(false);
  }, [activeTripIndex, currentSlide]);

  useEffect(() => {
    if (activeTripIndex === null) return;
    const slide = trackRef.current?.querySelectorAll('.slide')[currentSlide] as HTMLElement | undefined;
    if (!slide) return;

    let previousScrollTop = slide.scrollTop;
    let ticking = false;

    const syncTopbar = () => {
      ticking = false;
      const nextScrollTop = slide.scrollTop;
      const scrollingDown = nextScrollTop > previousScrollTop;

      if (nextScrollTop <= 12 || nextScrollTop < previousScrollTop) {
        setTopbarHidden(false);
      } else if (nextScrollTop > 32 && scrollingDown) {
        setTopbarHidden(true);
      }

      previousScrollTop = nextScrollTop;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(syncTopbar);
    };

    slide.addEventListener('scroll', onScroll, { passive: true });
    syncTopbar();

    return () => {
      slide.removeEventListener('scroll', onScroll);
    };
  }, [activeTripIndex, currentSlide, days.length]);

  useEffect(() => {
    if (!coverMenuOpen) return;

    function closeCoverMenuOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && coverMenuRef.current?.contains(target)) return;
      setCoverMenuOpen(false);
    }

    document.addEventListener('pointerdown', closeCoverMenuOnOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', closeCoverMenuOnOutsidePointer, true);
    };
  }, [coverMenuOpen]);

  useEffect(() => {
    return () => {
      if (coverToastTimerRef.current) window.clearTimeout(coverToastTimerRef.current);
    };
  }, []);

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

  // Open trip with a soft crossfade (root view transition — no shared-element
  // hero morph; the geometric card→cover transform read as jarring).
  const openTrip = useCallback((idx: number) => {
    const td = trips[idx];
    if (!td.days.length) return;

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

    startViewTransition(() => {
      flushSync(() => {
        setOverviewFaded(false);
        setCurrentSlide(0);
        setActiveTripIndex(null);
      });
    });
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

  function renderAddToTripsButton() {
    if (!shareId || !canAddToTrips || saveStatus === 'already_owned') return null;

    const isSaved = saveStatus === 'saved' || saveStatus === 'already_saved';

    return (
      <button
        type="button"
        className={`add-to-trips-btn ${isSaved ? 'saved' : ''}`}
        onClick={isSaved ? () => { window.location.href = '/dashboard'; } : handleAddToTrips}
        disabled={saveStatus === 'saving'}
      >
        {saveStatus === 'saving' ? (
          'Saving...'
        ) : isSaved ? (
          <>
            <Icon name="check" />
            {saveStatus === 'already_saved' ? 'Already saved — View trips' : 'Saved — View trips'}
          </>
        ) : saveStatus === 'error' ? (
          'Failed — Try again'
        ) : shareMode === 'remix' ? (
          <>
            <Icon name="shuffle" />
            Remix this trip
          </>
        ) : (
          <>
            <Icon name="plus" />
            Add to my trips
          </>
        )}
      </button>
    );
  }

  function showCoverActionToast(message: string) {
    setCoverToast(message);
    if (coverToastTimerRef.current) window.clearTimeout(coverToastTimerRef.current);
    coverToastTimerRef.current = window.setTimeout(() => setCoverToast(null), 2200);
  }

  async function handleCopyShareLink() {
    if (!shareId || typeof window === 'undefined') return;

    const url = `${window.location.origin}/t/${shareId}`;
    setCoverMenuOpen(false);
    try {
      await navigator.clipboard.writeText(url);
      showCoverActionToast('Share link copied');
    } catch {
      showCoverActionToast('Could not copy link');
    }
  }

  async function handleToggleOfflineDownload() {
    if (!shareId || !activeTripData) return;
    if (offlineTrip.state.status === 'saving' || offlineTrip.state.status === 'removing') return;

    setCoverMenuOpen(false);
    if (offlineTrip.isSaved) {
      setConfirmingOfflineRemove(true);
      return;
    }

    await offlineTrip.save(activeTripData);
    notifyOfflineStatusChanged(shareId, true);
    showCoverActionToast('Downloaded for offline');
  }

  async function handleRemoveOfflineDownload() {
    if (!shareId) return;

    setConfirmingOfflineRemove(false);
    await offlineTrip.remove();
    notifyOfflineStatusChanged(shareId, false);
    showCoverActionToast('Download removed');
  }

  async function handleCoverShareModeChange(next: ShareMode) {
    if (!tripId || currentShareMode === next) return;

    const previous = currentShareMode;
    setCurrentShareMode(next);
    setCoverMenuOpen(false);

    try {
      const res = await fetch(`/api/trips/${tripId}/share-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_mode: next }),
      });
      if (!res.ok) throw new Error('Failed to update sharing');
      showCoverActionToast(`${shareModeLabel(next)} selected`);
    } catch {
      setCurrentShareMode(previous);
      showCoverActionToast('Could not update sharing');
    }
  }

  function requestCoverDelete() {
    setCoverMenuOpen(false);
    setCoverDeleteConfirm(true);
  }

  async function handleDeleteActiveTrip() {
    if (activeTripIndex === null) return;

    setCoverDeleteBusy(true);
    try {
      if (tripId) {
        const supabase = createClient();
        const { error } = await supabase.from('trips').delete().eq('id', tripId);
        if (error) throw error;
      } else {
        onDelete?.(activeTripIndex);
      }

      setTrips(prev => prev.filter((_, index) => index !== activeTripIndex));
      setCoverDeleteConfirm(false);

      if (autoOpen) {
        window.location.href = homeHref;
      } else {
        setActiveTripIndex(null);
        setOverviewFaded(false);
      }
    } catch {
      showCoverActionToast('Could not delete trip');
    } finally {
      setCoverDeleteBusy(false);
    }
  }

  function renderCoverActionsMenu() {
    if (!shareId || !activeTripData) return null;

    const offlineBusy = offlineTrip.state.status === 'saving' || offlineTrip.state.status === 'removing';
    const offlineLabel = offlineBusy
      ? (offlineTrip.state.status === 'removing' ? 'Removing download...' : 'Downloading...')
      : offlineTrip.isSaved
        ? 'Remove download'
        : 'Download trip';
    const offlineHint = offlineTrip.isSaved
      ? 'Remove this device copy'
      : 'Keep this itinerary on this device';
    const canManageTrip = Boolean(tripId);
    const canDeleteTrip = Boolean(tripId || onDelete);

    return (
      <div className="trip-cover-menu-wrap" ref={coverMenuRef}>
        <button
          type="button"
          className="trip-cover-menu-btn"
          onClick={() => setCoverMenuOpen((value) => !value)}
          aria-label="Trip actions"
          aria-haspopup="menu"
          aria-expanded={coverMenuOpen}
        >
          <Icon name="more" />
        </button>
        {coverMenuOpen && (
          <>
            <div className="trip-cover-menu-backdrop" onClick={() => setCoverMenuOpen(false)} />
            <div className="trip-cover-menu" role="menu" aria-label="Trip actions">
              <button type="button" className="trip-cover-menu-item" onClick={handleCopyShareLink} role="menuitem">
                <span className="trip-cover-menu-icon"><Icon name="link" /></span>
                <span className="trip-cover-menu-label">
                  <span>Copy share link</span>
                  <small>{currentShareMode === 'private' ? 'Link is currently off' : 'Share this trip'}</small>
                </span>
              </button>
              <button
                type="button"
                className="trip-cover-menu-item"
                onClick={handleToggleOfflineDownload}
                disabled={offlineBusy}
                aria-label={offlineTrip.isSaved ? 'Remove offline download' : 'Download trip for offline'}
                role="menuitem"
              >
                <span className="trip-cover-menu-icon"><Icon name={offlineTrip.isSaved ? 'check' : 'download'} /></span>
                <span className="trip-cover-menu-label">
                  <span>{offlineLabel}</span>
                  <small>{offlineHint}</small>
                </span>
              </button>

              {canManageTrip && (
                <>
                  <div className="trip-cover-menu-divider" />
                  <div className="trip-cover-menu-section">Sharing</div>
                  {SHARE_MODE_OPTIONS.map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={`trip-cover-menu-item ${currentShareMode === mode ? 'is-active' : ''}`}
                      onClick={() => handleCoverShareModeChange(mode)}
                      aria-checked={currentShareMode === mode}
                      role="menuitemradio"
                    >
                      <span className="trip-cover-menu-check" aria-hidden="true">
                        {currentShareMode === mode ? <Icon name="check" /> : <Icon name={shareModeIcon(mode)} />}
                      </span>
                      <span className="trip-cover-menu-label">
                        <span>{shareModeLabel(mode)}</span>
                        <small>{shareModeHint(mode)}</small>
                      </span>
                    </button>
                  ))}
                </>
              )}

              {canDeleteTrip && (
                <>
                  <div className="trip-cover-menu-divider" />
                  <button type="button" className="trip-cover-menu-item trip-cover-menu-item-danger" onClick={requestCoverDelete} role="menuitem">
                    <span className="trip-cover-menu-icon"><Icon name="trash" /></span>
                    <span className="trip-cover-menu-label">
                      <span>Delete trip</span>
                      <small>Remove it from your trips</small>
                    </span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
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
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditableKeyboardTarget(e.target)) return;
      if (detailOpen) {
        if (e.key === 'Escape') closeDetail();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(currentSlide + 1);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(currentSlide - 1);
        return;
      }
      if (e.key === 'ArrowDown' && currentSlide > 0 && currentSlide < totalSlides - 1) {
        e.preventDefault();
        goTo(currentSlide + 1);
        return;
      }
      if (e.key === 'ArrowUp' && currentSlide > 1) {
        e.preventDefault();
        goTo(currentSlide - 1);
        return;
      }
      if (e.key === 'Escape') { if (currentSlide === 0) closeTrip(); else goTo(0); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTripIndex, currentSlide, detailOpen, totalSlides, goTo, closeTrip]);

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
      updated[activeTripIndex] = normalizeTripData(nextTripData);
      return updated;
    });
  }, [activeTripIndex]);

  useEffect(() => {
    if (!tripId || typeof window === 'undefined') return;

    const onTripDataUpdated = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? detailFromTripDataEvent(event)
        : undefined;
      if (detail?.tripId !== tripId || !detail.tripData) return;
      handleTripDataUpdated(detail.tripData);
    };

    window.addEventListener(TRIP_DATA_UPDATED_EVENT, onTripDataUpdated);
    return () => {
      window.removeEventListener(TRIP_DATA_UPDATED_EVENT, onTripDataUpdated);
    };
  }, [handleTripDataUpdated, tripId]);

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
      const content = trimDisplayText(tip.content);
      if (!content) return;
      showDetail({
        title: tipDisplayTitle(tip),
        html: `<div class="detail-tip-body"><p class="detail-tip-text">${escapeHtml(content)}</p></div>`
      });
      return;
    }
    if (type === 'meal') {
      const m = item as Meal;
      if (!mealHasDetail(m)) return;
      const d = m.detail;
      if (!d) return;
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
        ['Phone', d.phone], ['Website', d.direct_website_url],
        ['Confirmation', d.confirmation], ['Booked via', d.booking_platform],
        ['Cancel by', d.cancellation_deadline], ['WiFi', d.wifi], ['Parking', d.parking], ['Note', d.note],
      ];
      const rows = fields.filter(([, v]) => v).map(([l, v]) =>
        `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-value${l === 'Phone' ? ' mono' : ''}">${
          l === 'Phone'
            ? `<a href="tel:${escapeHtml(v!)}">${escapeHtml(v!)}</a>`
            : l === 'Website' && /^https?:\/\//i.test(v!)
              ? `<a href="${escapeHtml(v!)}" target="_blank" rel="noreferrer">${escapeHtml(d.direct_website_label || 'Official website')}</a>`
              : escapeHtml(v!)
        }</span></div>`
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
        day.transport[itemIndex].booking_status = status;
      } else if (itemType === 'meal' && day.meals?.[itemIndex]) {
        day.meals[itemIndex].status = status;
        day.meals[itemIndex].booking_status = status;
      } else if (itemType === 'accommodation' && day.accommodation) {
        const rawAccommodationName = trimDisplayText(day.accommodation.name);
        const accommodationName = rawAccommodationName && !isPlaceholderAccommodationName(rawAccommodationName)
          ? rawAccommodationName
          : '';
        for (const tripDay of tripCopy.days) {
          if (!tripDay.accommodation) continue;
          const sameStay = accommodationName
            ? trimDisplayText(tripDay.accommodation.name) === accommodationName
            : tripDay.day_number === dayNumber;
          if (sameStay) {
            tripDay.accommodation.status = status;
            tripDay.accommodation.booking_status = status;
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
    const endpoint = tripId ? `/api/trips/${tripId}/toggle-status` : null;
    if (!endpoint || activeTripIndex === null) return false;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

  async function handleMarkAccommodationBooked(day: Day, accommodation: Accommodation) {
    if (!tripId) return;

    const actionKey = `${day.day_number}:${accommodationTodoKey(day, accommodation)}`;
    if (inlineBookingKey === actionKey) return;

    setInlineBookingKey(actionKey);
    setInlineBookingErrorKey(null);

    const saved = await handleToggleStatus(day.day_number, 'accommodation', 0, 'booked');
    if (!saved) {
      setInlineBookingErrorKey(actionKey);
    }
    setInlineBookingKey(null);
  }

  // Event delegation for action item clicks
  useEffect(() => {
    const el = detailBodyRef.current;
    if (!el || !tripId) return;

    const updateTodoHeader = () => {
      const allRows = el.querySelectorAll('.todo-item');
      const allDone = Array.from(allRows).every(r => (r as HTMLElement).dataset.done === 'true');
      const header = el.querySelector('.detail-info-section-title, .todo-ready');
      if (!header) return;
      if (allDone) {
        header.outerHTML = '<div class="todo-ready"><span class="todo-ready-icon"></span> Trip is ready to go</div>';
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
        check.innerHTML = '';
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

      if (itemType !== 'transport' && itemType !== 'accommodation' && itemType !== 'meal') return;

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
      if (hasSelectedTextWithin(row)) return;
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
        openTrip(origIdx);
      }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrip(origIdx); } }}>
        <div className="trip-card-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="trip-card-img" src={img} alt={t.name} style={{ opacity: brokenImages.has(img) ? 0 : 1 }} onError={() => onImgError(img)} loading="lazy" />
          <div className="trip-card-gradient" />
        </div>
        <div className="trip-card-badge">{statusLabel}</div>
        {onDelete && <button className="trip-card-delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(origIdx); }} aria-label={`Delete ${t.name}`}>
          <Icon name="trash" />
        </button>}
        <div className="trip-card-body">
          <div className="trip-card-dates">{startStr} — {endStr}</div>
          <div className="trip-card-name">{t.name}</div>
          <div className="trip-card-subtitle">{t.subtitle}</div>
          <div className="trip-card-stats">
            <div className="trip-card-stat">
              <Icon name="moon" />
              {nights} nights
            </div>
            {dayCount > 0 ? (
              <div className="trip-card-stat">
                <Icon name="calendar" />
                {dayCount} days
              </div>
            ) : (
              <div className="trip-card-stat">
                <Icon name="clock" />
                Coming soon
              </div>
            )}
            <div className="trip-card-stat">
              <Icon name="users" />
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
    const entries: {
      day: number;
      date: string;
      title: string;
      body: string;
      highlights?: string[];
    }[] = [];

    for (const d of days) {
      const intro = getDayIntro(d);
      if (intro.title || intro.body) {
        entries.push({
          day: d.day_number,
          date: d.date,
          title: intro.title || `Day ${d.day_number}`,
          body: intro.body,
          highlights: intro.legacyBlock?.detail?.highlights,
        });
      }

      for (const block of d.blocks || []) {
        if (block.type === 'note' || block === intro.legacyBlock) continue;
        const title = trimDisplayText(block.detail?.title) || trimDisplayText(block.content);
        const body = trimDisplayText(block.detail?.body) || trimDisplayText(block.detail?.why) || trimDisplayText(block.content);
        const highlights = block.detail?.highlights?.map(trimDisplayText).filter(Boolean);
        if (!title && !body && !highlights?.length) continue;
        entries.push({
          day: d.day_number,
          date: d.date,
          title: title || `Day ${d.day_number}`,
          body,
          highlights,
        });
      }
    }

    if (!entries.length) return { html: '', hasData: false };

    const rows = entries.map(({ day, date, title, body, highlights }) => {
      const dateLabel = formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
      const highlightsHtml = highlights?.length
        ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-muted)">${highlights.slice(0, 3).map(escapeHtml).join(' · ')}</span>`
        : '';

      return `<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:3px">
        <span class="detail-row-label" style="width:auto">Day ${day} · ${dateLabel}</span>
        <span class="detail-row-value" style="text-align:left;font-size:15px;font-weight:600">${escapeHtml(title)}</span>
        ${body && body !== title ? `<span class="detail-row-value" style="text-align:left;font-size:13px;color:var(--color-text-secondary)">${escapeHtml(body)}</span>` : ''}
        ${highlightsHtml}
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
      // Transport, stays, and reservable meals all belong in the readiness list.
      if (d.transport?.length) {
        for (let i = 0; i < d.transport.length; i++) {
          const t = d.transport[i];
          const statusValue = todoBookingStatus(t);
          if (!statusValue && !t.reservation_required) continue;
          const done = isTodoDoneStatus(statusValue);
          const routeLabel = [trimDisplayText(t.from), trimDisplayText(t.to)].filter(Boolean).join(' → ');
          const mode = trimDisplayText(t.mode) || 'transport';
          todoItems.push({
            label: trimDisplayText(t.label) || routeLabel || 'Transport booking',
            detail: `Day ${d.day_number} · ${mode}`,
            done,
            status: todoStatusFromItem(t),
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
          const done = isTodoDoneStatus(todoBookingStatus(d.accommodation));
          const nights = d.accommodation.nights
            ? ` · ${d.accommodation.nights} ${d.accommodation.nights === 1 ? 'night' : 'nights'}`
            : '';
          todoItems.push({
            label: accommodationTodoLabel(d, d.accommodation),
            detail: `Day ${d.day_number} · hotel${nights}`,
            done,
            status: todoStatusFromItem(d.accommodation),
            dayNumber: d.day_number,
            itemType: 'accommodation',
            itemIndex: 0,
          });
        }
      }

      if (d.meals?.length) {
        for (let i = 0; i < d.meals.length; i++) {
          const meal = d.meals[i];
          if (!isMealReservationAction(meal)) continue;
          const done = isTodoDoneStatus(todoBookingStatus(meal));
          todoItems.push({
            label: mealTodoLabel(meal),
            detail: mealTodoDetail(d, meal),
            done,
            status: todoStatusFromItem(meal),
            dayNumber: d.day_number,
            itemType: 'meal',
            itemIndex: i,
          });
        }
      }
    }

    if (!todoItems.length) return { html: '', hasData: false, allDone: false };

    const canUpdateActionItems = Boolean(tripId);
    const interactive = canUpdateActionItems ? ' todo-interactive' : '';
    const allDone = todoItems.every(t => t.done);
    const interactiveAttrs = (done: boolean) => canUpdateActionItems
      ? ` role="button" tabindex="0" aria-pressed="${done}"`
      : '';
    const rows = todoItems.map(t =>
      `<div class="detail-row todo-item${interactive}"${interactiveAttrs(t.done)} data-day="${t.dayNumber}" data-type="${t.itemType}" data-index="${t.itemIndex}" data-done="${t.done}" data-status="${t.status}" style="gap:10px;align-items:center">
        <span class="todo-check ${t.done ? 'done' : ''}"></span>
        <span style="flex:1;min-width:0">
          <span class="detail-row-value" style="text-align:left;font-size:14px;display:block${t.done ? ';text-decoration:line-through;opacity:0.45' : ''}">${escapeHtml(t.label)}</span>
          <span class="detail-row-label" style="width:auto;font-size:12px">${escapeHtml(t.detail)}</span>
        </span>
        <span class="text-status status-badge todo-status status-${t.status}">${t.status}</span>
      </div>`
    ).join('');

    const header = allDone
      ? `<div class="todo-ready"><span class="todo-ready-icon"></span> Trip is ready to go</div>`
      : `<div class="detail-info-section-title"><span class="text-section-title">Action Items</span></div>`;

    return { html: `<div class="detail-info-section">${header}${rows}</div>`, hasData: true, allDone };
  }

  function buildOverviewSections(): {
    icon: string;
    label: string;
    html: string;
    hasData: boolean;
    node?: ReactNode;
  }[] {
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
        }
      : { icon: 'bed', label: 'Accommodation', ...accommodation };
    const sections: {
      icon: string;
      label: string;
      html: string;
      hasData: boolean;
      node?: ReactNode;
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
    return sections;
  }

  function openTripOverview(sections: ReturnType<typeof buildOverviewSections>) {
    const visible = sections.filter((section) => section.hasData);
    if (!visible.length) {
      showDetail({
        title: 'Trip Overview',
        html: `<div class="detail-tip-body"><p class="detail-tip-text">${escapeHtml(overviewSummaryText(trip?.summary))}</p></div>`,
      });
      return;
    }

    showDetail({
      title: 'Trip Overview',
      html: '',
      node: (
        <div className="trip-overview-detail-list">
          {visible.map((section, index) => (
            <button
              key={`${section.label}-${index}`}
              type="button"
              className="trip-overview-detail-item"
              onClick={() => showDetail({
                title: section.label,
                html: section.html,
                node: section.node,
              })}
            >
              <span className="trip-overview-detail-icon"><Icon name={section.icon} /></span>
              <span className="trip-overview-detail-copy">
                <span>{section.label}</span>
                <small>{section.node ? 'Review and update this section.' : 'Open the full details.'}</small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      ),
    });
  }

  function renderOverviewRouteFlow(labels: string[]) {
    return labels.map((label, index) => (
      <span className="trip-overview-route-part" key={`${label}-${index}`}>
        <span>{label}</span>
        {index < labels.length - 1 ? <span className="trip-overview-route-arrow">→</span> : null}
      </span>
    ));
  }

  // Render hero slide
  function renderHeroSlide() {
    if (!trip) return null;
    const heroImage = getTripOverviewImageUrl(trip);
    const heroImageIsBroken = brokenImages.has(heroImage);
    const routeStopCount = routeStopCountFor(overviewMapAtlas);
    const nights = tripNightCount(trip.dates.start, trip.dates.end);
    const routeGroups = overviewRouteGroups(routeAtlas, days);
    const displayRouteGroups = routeGroups.outbound.length
      ? routeGroups
      : { outbound: [trip.name], returnVia: [] };
    const highlights = overviewHighlights(overviewMapAtlas ?? routeAtlas, days);
    const displayHighlights = highlights.length
      ? highlights
      : [{ icon: 'info', label: trimDisplayText(trip.subtitle) || overviewSummaryText(trip.summary) || trip.name }];
    const metrics = overviewMetrics(days, overviewMapAtlas ?? routeAtlas, nights);
    const transportSummary = dominantTransportSummary(days);
    const overviewSections = buildOverviewSections();
    const desktopOverviewMapVisible = Boolean(showOverviewMap && overviewMapAtlas && isDesktopPreview);
    const overviewMapScopeAria = showFullJourneyMap
      ? 'Hide access legs from overview map'
      : 'Show full journey on overview map';

    return (
      <div key="cover" className={`slide ${currentSlide === 0 ? 'active' : ''}`}>
        <div className="hero-slide">
          <div
            className={`hero-frame${desktopOverviewMapVisible ? ' is-map-visible' : ''}`}
          >
            {desktopOverviewMapVisible && overviewMapAtlas ? (
              <div className="hero-map-stage">
                <ItineraryMap
                  atlas={overviewMapAtlas}
                  title={`${trip.name} itinerary map`}
                  variant="overview-card"
                  interactive
                  pointDetails={overviewRoutePointDetails}
                  showLines
                  enabled={currentSlide === 0 && desktopOverviewMapVisible}
                  loadingLabel="Loading overview map"
                  loadingHint={routeStopCount >= 12 ? 'This might take a minute with this many stops.' : undefined}
                  fallback={<TripRouteAtlas atlas={overviewMapAtlas} />}
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
            {desktopOverviewMapVisible && overviewMapHidesAccess ? (
              <button
                type="button"
                className="hero-map-scope-toggle"
                onClick={() => setShowFullJourneyMap((value) => !value)}
                aria-pressed={showFullJourneyMap}
                aria-label={overviewMapScopeAria}
                title={overviewMapScopeAria}
              >
                <span aria-hidden="true"><Icon name="plane" /></span>
                <span>Full journey</span>
              </button>
            ) : null}
            {overviewMapAtlas ? (
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
            <p className="hero-date-range">{formatHeroDateRange(trip.dates.start, trip.dates.end)}</p>
            <div className="hero-meta-chips" aria-label="Trip highlights">
              <span className="hero-meta-chip"><Icon name="moon" />{nights} {nights === 1 ? 'Night' : 'Nights'}</span>
              <span className="hero-meta-chip"><Icon name="route" />{routeStopCount || days.length} {routeStopCount === 1 ? 'Stop' : 'Stops'}</span>
              <span className="hero-meta-chip"><Icon name={transportSummary.icon} />{transportSummary.label}</span>
            </div>

            <div className="trip-overview-dossier">
              <div className="trip-overview-dossier-main">
                <section className="trip-overview-route" aria-label="Route">
                  <h2>Route</h2>
                  <div className="trip-overview-route-flow">
                    {renderOverviewRouteFlow(displayRouteGroups.outbound)}
                  </div>
                  {displayRouteGroups.returnVia.length ? (
                    <>
                      <div className="trip-overview-return-rule" />
                      <p className="trip-overview-return-label">Return via</p>
                      <div className="trip-overview-route-flow trip-overview-route-flow-return">
                        {renderOverviewRouteFlow(displayRouteGroups.returnVia)}
                      </div>
                    </>
                  ) : null}
                </section>

                <section className="trip-overview-highlights" aria-label="Highlights">
                  <h2>Highlights</h2>
                  <ul>
                    {displayHighlights.map((highlight) => (
                      <li key={highlight.label}>
                        <span className="trip-overview-highlight-icon"><Icon name={highlight.icon} /></span>
                        <span>{highlight.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="trip-overview-metrics" aria-label="Trip metrics">
                {metrics.map((metric) => (
                  <div className="trip-overview-metric" key={`${metric.label}-${metric.value}`}>
                    <span className="trip-overview-metric-icon"><Icon name={metric.icon} /></span>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="trip-overview-action"
              onClick={() => openTripOverview(overviewSections)}
              aria-label="Open trip overview details"
            >
              <span className="trip-overview-action-icon"><Icon name="doc" /></span>
              <span className="trip-overview-action-copy">
                <span>Trip overview</span>
                <small>{overviewSummaryText(trip.summary)}</small>
              </span>
              <Icon name="chevron" />
            </button>

            {totalSlides > 1 && (
              <>
                <button className="hero-day-by-day-cta" type="button" onClick={() => goTo(1)} aria-label="Open day by day itinerary">
                  <span className="hero-day-by-day-icon"><Icon name="calendar" /></span>
                  <span>View day-by-day itinerary</span>
                  <Icon name="chevron" />
                </button>
                <p className="hero-day-by-day-helper">See the full plan, driving times, stays and activities for each day.</p>
              </>
            )}
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
                <Icon name="chevron" />
              </button>
            )}
            {overviewMapAtlas ? (
              <div className="hero-route-map-card">
                <div className="hero-route-map-header">
                  <span className="text-section-title"><span className="section-icon"><Icon name="route" /></span>Itinerary map</span>
                  <span className="hero-route-map-actions">
                    {overviewMapHidesAccess ? (
                      <button
                        type="button"
                        className="hero-route-map-scope"
                        onClick={() => setShowFullJourneyMap((value) => !value)}
                        aria-pressed={showFullJourneyMap}
                        aria-label={overviewMapScopeAria}
                        title={overviewMapScopeAria}
                      >
                        <Icon name="plane" />
                        <span>Full journey</span>
                      </button>
                    ) : null}
                    <span className="hero-route-map-count">{routeStopCount} stop{routeStopCount === 1 ? '' : 's'}</span>
                  </span>
                </div>
                <div className="hero-route-map-frame">
                  <ItineraryMap
                    atlas={overviewMapAtlas}
                    title={`${trip.name} itinerary map`}
                    variant="overview-card"
                    interactive
                    pointDetails={overviewRoutePointDetails}
                    showLines={false}
                    enabled={currentSlide === 0 && isDesktopPreview === false}
                    loadingLabel="Loading overview map"
                    loadingHint={routeStopCount >= 12 ? 'This might take a minute with this many stops.' : undefined}
                    fallback={<TripRouteAtlas atlas={overviewMapAtlas} />}
                  />
                </div>
              </div>
            ) : null}
            {displayableTripNotes.length ? (
              <div className="hero-notes">
                <button className="hero-note-btn" onClick={() => {
                  const notesHtml = displayableTripNotes.map(note => {
                    const title = trimDisplayText(note.title) || 'Note';
                    const content = trimDisplayText(note.content);
                    return (
                      `<div class="detail-info-section">
                        <div class="detail-info-section-title"><span class="text-section-title">${escapeHtml(title)}</span></div>
                        <div class="detail-tip-body"><p class="detail-tip-text">${escapeHtml(content)}</p></div>
                      </div>`
                    );
                  }).join('');
                  showDetail({ title: 'Trip Notes', html: notesHtml });
                }}>
                  <span className="hero-note-icon"><Icon name="info" /></span>
                  <span className="hero-note-label">Trip Notes</span>
                  <span className="hero-note-count">{displayableTripNotes.length}</span>
                  <Icon name="chevron" />
                </button>
              </div>
            ) : null}
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
    const stayNights = normalizedNightCount(day.accommodation?.nights);
    const nightLabel = formatNightLabel(stayNights);
    const dateRangeLabel = formatBriefDateRange(day.date, stayNights);
    const stayDateLabel = nightLabel ? `${nightLabel} (${dateRangeLabel})` : dateRangeLabel;
    const heroMeta = [nightLabel ? stayDateLabel : null, day.subtitle].filter(Boolean).join(' · ');
    const dayIntro = getDayIntro(day);
    const dayTitleId = `day-title-${day.day_number}`;

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
          <h2 className="text-card-title-light day-hero-title" id={dayTitleId} style={{ margin: 0 }}>{day.title}</h2>
          {dayIntro.title && <p className="day-hero-intro-title">{dayIntro.title}</p>}
          {dayIntro.body && <p className="day-hero-intro">{dayIntro.body}</p>}
          {heroMeta && <p className="text-hero-subtitle day-hero-meta" style={{ margin: '5px 0 0' }}>{heroMeta}</p>}
          {statsChips}
        </div>
      </div>
    ) : (
      <div className="day-header-plain">
        <p className="text-label-dark">Day {day.day_number} &middot; {dateStr}</p>
        <h2 className="text-card-title" id={dayTitleId} style={{ marginTop: 4 }}>{day.title}</h2>
        {dayIntro.title && <p className="day-header-plain-intro-title">{dayIntro.title}</p>}
        {dayIntro.body && <p className="day-header-plain-intro">{dayIntro.body}</p>}
        {day.subtitle && <p className="text-body-italic" style={{ marginTop: 4 }}>{day.subtitle}</p>}
        {statsChips}
      </div>
    );

    const dayMapSection = hasDayMapLocations ? (
      <div className="day-map-card" data-day-map-card={day.day_number}>
        <div className="day-map-header">
          <span className="text-section-title"><span className="section-icon"><Icon name="map" /></span>Day map</span>
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
    const visibleMeals = displayableMeals(day.meals);

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

    const todayPlan = todayInfo?.dayNumber === day.day_number ? buildTodayPlan(day) : null;

    const renderTodayPlanItem = (item: TodayPlanItem | undefined, label: string) => {
      if (!item) return null;
      const status = trimDisplayText(item.status);
      const statusClass = normalizeMapFocusLabel(status).replace(/\s+/g, '-') || 'info';
      return (
        <div className="today-mode-row">
          <span className="today-mode-row-icon"><Icon name={item.icon} /></span>
          <div className="today-mode-row-copy">
            <span className="today-mode-row-label">{label}</span>
            <h3 className="today-mode-row-title">
              {item.mapLabel ? renderBriefPlace(item.label, item.mapLabel, 'today-mode-place') : item.label}
            </h3>
            {item.meta && <p className="today-mode-row-meta">{item.meta}</p>}
          </div>
          {status && (
            <span className={`text-status status-badge today-mode-status status-${statusClass}`}>
              {status}
            </span>
          )}
        </div>
      );
    };

    const todayModeCard = todayPlan ? (() => {
      const laterItems = todayPlan.later.slice(0, 2);
      const quickItems = [todayPlan.transport, todayPlan.sleep, todayPlan.meal].filter((item): item is TodayPlanItem => Boolean(item));
      const readinessLabel = todayPlan.openActionCount === 0
        ? 'Ready'
        : `${todayPlan.openActionCount} open`;
      return (
        <section className="today-mode-card" aria-label={`Today mode for day ${day.day_number}`}>
          <div className="today-mode-header">
            <div>
              <p className="today-mode-overline">Today</p>
              <h3 className="today-mode-title">Day {day.day_number} at a glance</h3>
            </div>
            <span className={`today-mode-readiness ${todayPlan.openActionCount === 0 ? 'ready' : 'open'}`}>
              {readinessLabel}
            </span>
          </div>
          <div className="today-mode-timeline">
            {renderTodayPlanItem(todayPlan.current ?? todayPlan.next, todayPlan.current ? 'Now' : 'Next')}
            {todayPlan.current && renderTodayPlanItem(todayPlan.next, 'Next')}
            {laterItems.map((item, index) => renderTodayPlanItem(item, index === 0 ? 'Later' : 'After'))}
          </div>
          <div className="today-mode-grid">
            <div className="today-mode-fact">
              <span className="today-mode-fact-icon"><Icon name="map" /></span>
              <span className="today-mode-fact-copy">
                <span className="today-mode-fact-label">Map</span>
                <span className="today-mode-fact-value">{dayMapCountLabel}</span>
              </span>
            </div>
            {shareId && (
              <div className="today-mode-fact">
                <span className="today-mode-fact-icon"><Icon name={offlineSaved ? 'check' : 'download'} /></span>
                <span className="today-mode-fact-copy">
                  <span className="today-mode-fact-label">Offline</span>
                  <span className="today-mode-fact-value">{offlineSaved ? 'Saved' : 'Not saved'}</span>
                </span>
              </div>
            )}
            {quickItems.slice(0, 2).map((item) => (
              <div className="today-mode-fact" key={item.key}>
                <span className="today-mode-fact-icon"><Icon name={item.icon} /></span>
                <span className="today-mode-fact-copy">
                  <span className="today-mode-fact-label">{item.key}</span>
                  <span className="today-mode-fact-value">{item.label}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      );
    })() : null;

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
          <span className="day-brief-card-icon"><Icon name="binoculars" /></span>
          <span>See &amp; do</span>
        </div>
        <div className="day-brief-programme-list">
          {displayBlocks.map(({ block: b, timeLabel, content, options }, i) => {
            const detailTitle = trimDisplayText(b.detail?.title) || content || 'this programme item';
            return (
              <div
                key={i}
                className={[
                  'day-brief-programme-row',
                  timeLabel ? '' : 'no-time',
                  b.detail ? 'has-detail' : '',
                ].filter(Boolean).join(' ')}
              >
                {timeLabel && <span className="day-brief-time">{timeLabel}: </span>}
                <div className="day-brief-programme-copy">
                  {content && (
                    <h3 className="day-card-title day-brief-programme-title">
                      {renderBriefActivityText(content)}
                    </h3>
                  )}
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
                </div>
                {b.detail && (
                  <span className="day-brief-programme-action">
                    {renderBriefDetailButton(`More about ${detailTitle}`, () => openDetail('block', b))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

    const stayCard = day.accommodation ? (() => {
      const a = day.accommodation!;
      const statusLabel = accommodationStatusLabel(a);
      if (!isTodoDoneStatus(a.status)) {
        const hotelName = trimDisplayText(a.name);
        const hasNamedHotel = hotelName && !isPlaceholderAccommodationName(hotelName);
        const roomMeta = trimDisplayText(a.detail?.room_type);
        const pendingStayMeta = [dateRangeLabel, roomMeta].filter(Boolean).join(' · ');
        const normalizedStatusLabel = statusLabel.trim().toLowerCase();
        const pendingStatusLabel = normalizedStatusLabel === 'open'
          ? 'Pending'
          : normalizedStatusLabel
            ? `${normalizedStatusLabel.charAt(0).toUpperCase()}${normalizedStatusLabel.slice(1)}`
            : 'Pending';
        const actionKey = `${day.day_number}:${accommodationTodoKey(day, a)}`;
        const isMarkingBooked = inlineBookingKey === actionKey;
        const hasBookingError = inlineBookingErrorKey === actionKey;
        const canMarkBooked = Boolean(tripId && hasNamedHotel);

        return (
          <article className="day-brief-detail-card day-brief-hotel-inline-card">
            <div className="day-brief-hotel-inline-main">
              <span className="day-brief-hotel-inline-icon"><Icon name="hotel" /></span>
              <div className="day-brief-hotel-inline-copy">
                <h3 className="day-brief-card-title day-brief-hotel-inline-title">
                  {hasNamedHotel
                    ? renderBriefPlace(hotelName, hotelName, 'day-brief-card-place')
                    : 'Hotel not confirmed yet'}
                </h3>
                {pendingStayMeta && <p className="day-brief-card-meta day-brief-hotel-inline-meta">{pendingStayMeta}</p>}
              </div>
            </div>
            <div className="day-brief-hotel-inline-actions">
              <span className="day-brief-pending-pill">
                <Icon name="clock" />
                <span>{pendingStatusLabel}</span>
              </span>
              {canMarkBooked && (
                <button
                  type="button"
                  className="day-brief-mark-booked-btn"
                  onClick={() => void handleMarkAccommodationBooked(day, a)}
                  disabled={isMarkingBooked}
                  aria-label={`Mark ${hasNamedHotel ? hotelName : 'hotel'} as booked`}
                >
                  <Icon name="check" />
                  <span>{isMarkingBooked ? 'Marking...' : hasBookingError ? 'Try again' : 'Mark as booked'}</span>
                </button>
              )}
            </div>
            {hasBookingError && (
              <p className="day-brief-inline-error" role="status">Could not mark this stay as booked. Try again.</p>
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
          <h3 className="day-brief-card-title">
            {renderBriefPlace(trimDisplayText(a.name) || 'Accommodation', a.name, 'day-brief-card-place')}
          </h3>
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

    const mealCard = visibleMeals.length ? (() => {
      const mealLabel = visibleMeals.length === 1
        ? trimDisplayText(visibleMeals[0].type).replace(/^\w/, (char) => char.toUpperCase()) || 'Dining'
        : 'Dining';
      return (
        <article className="day-brief-detail-card">
          <div className="day-brief-card-topline">
            <div className="day-brief-card-kicker">
              <span className="day-brief-card-icon"><Icon name="fork" /></span>
              <span>{mealLabel}</span>
            </div>
            {visibleMeals.length === 1 && visibleMeals[0].status ? (
              <span className={`text-status status-badge day-brief-status status-${visibleMeals[0].status}`}>
                {visibleMeals[0].status}
              </span>
            ) : null}
          </div>
          <div className="day-brief-meal-list">
            {visibleMeals.map((m, i) => {
              const mealName = mealDisplayName(m) || trimDisplayText(m.note) || 'Meal';
              return (
                <div key={i} className="day-brief-meal-entry">
                  {visibleMeals.length > 1 && m.type ? (
                    <div className="day-brief-meal-type">{m.type}</div>
                  ) : null}
                  <h3 className="day-brief-card-title">
                    {renderBriefPlace(mealName, mealDisplayName(m), 'day-brief-card-place')}
                  </h3>
                  {m.note && <p className="day-brief-card-copy">{m.note}</p>}
                  <div className="day-brief-card-actions">
                    {visibleMeals.length > 1 && m.status ? (
                      <span className={`text-status status-badge day-brief-status status-${m.status}`}>
                        {m.status}
                      </span>
                    ) : null}
                    {mealHasDetail(m) && renderBriefCardAction('Meal details', () => openDetail('meal', m))}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      );
    })() : null;

    const hasBriefItems = Boolean(todayModeCard || seeAndDoBlock || stayCard || mealCard);
    const briefSection = (
      <section className="day-brief" aria-labelledby={dayTitleId}>
        <div className="day-brief-header">
          <p className="day-brief-overline">Day {day.day_number} &middot; {dateStr}</p>
          <p className="day-brief-heading" aria-hidden="true">
            <span>{day.title}</span>
          </p>
          <div className="day-brief-meta-row">
            <span>{stayDateLabel}</span>
            {day.subtitle && <em>{day.subtitle}</em>}
          </div>
        </div>
        {hasBriefItems && (
          <div className="day-brief-body">
            {todayModeCard}
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
          <span className="text-section-title"><span className="section-icon"><Icon name={trimDisplayText(day.transport[0]?.mode) || 'route'} /></span>Transport</span>
        </div>
        {day.transport.map((t, i) => {
          const route = [trimDisplayText(t.from), trimDisplayText(t.to)].filter(Boolean).join(' \u2192 ');
          const title = trimDisplayText(t.label) || route || 'Transport';
          const routeMeta = [route, trimDisplayText(t.duration), trimDisplayText(t.distance)].filter(Boolean).join(' \u00b7 ');
          return (
            <div key={i} className={`transport-row${t.detail ? ' tappable' : ''}`}
              onClick={t.detail ? () => openDetail('transport', t) : undefined}>
              <div className="transport-detail">
                <h3 className="day-card-title transport-title">{title}</h3>
                {routeMeta && <div className="transport-route">{routeMeta}</div>}
              </div>
              {t.depart && <div className="text-mono">{t.depart}</div>}
              <span className={`text-status status-badge status-${t.status || 'pending'}`}>{t.status || 'pending'}</span>
              {t.detail && <span className="tap-chevron"><Icon name="chevron" /></span>}
            </div>
          );
        })}
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

      const dayServices = trip.services.filter(s => (
        s.legs?.some(l => l.date === day.date) &&
        !isMealReservationService(s, day)
      ));
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
                    <h3 className="day-card-title transport-title">{svc.provider}</h3>
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

    const visibleTips = displayableTips(day.tips);
    const tipsSection = visibleTips.length ? (
      <div className="day-section tips-section">
        <div className="day-section-title">
          <span className="text-section-title"><span className="section-icon"><Icon name="info" /></span>Tips</span>
        </div>
        {visibleTips.map((tip, i) => (
          <div key={i} className={`tip-row ${tip.priority === 'high' ? 'tip-high' : ''}`}
            onClick={() => openDetail('tip', tip)}>
            <div className="tip-icon-wrap">
              <Icon name={tip.icon || 'info'} />
            </div>
            <div className="tip-content">
              <h3 className="day-card-title tip-title">{tipDisplayTitle(tip)}</h3>
            </div>
            <div className="tip-chevron">
              <Icon name="chevron" />
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
                <Icon name="back" />
              </button>
              <h1 className="overview-title">Archive</h1>
            </>
          ) : (
            <>
              <h1 className="overview-title">OurTrips</h1>
              <div className="overview-menu-wrap">
                <button className="overview-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Settings menu">
                  <Icon name="more" />
                </button>
                {menuOpen && (
                  <>
                    <div className="overview-menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <div className="overview-menu">
                      <button className="overview-menu-item" onClick={() => { setMenuOpen(false); setShowArchive(true); }}>
                        <Icon name="archive" />
                        Archive{archiveTrips.length > 0 ? ` (${archiveTrips.length})` : ''}
                      </button>
                      <button className="overview-menu-item overview-menu-item-danger" onClick={() => { setMenuOpen(false); window.location.href = '/'; }}>
                        <Icon name="logout" />
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
          <AppTopBar
            href={homeHref}
            suffix={trip?.name}
            className={`trip-topbar ${topbarHidden ? 'is-scroll-hidden' : ''}`}
            actions={
              <>
                {!isHero ? (
                  <button
                    type="button"
                    className="trip-topbar-overview"
                    onClick={() => goTo(0)}
                    aria-label="Back to trip overview"
                  >
                    <Icon name="back" size={15} strokeWidth={2.4} />
                    <span>Trip overview</span>
                  </button>
                ) : null}
              {renderAddToTripsButton()}
              {isHero && renderCoverActionsMenu()}
              </>
            }
          />

          {/* Date Strip */}
          <div className={`date-strip ${isHero ? 'hidden' : ''}`}>
            <div className="date-strip-inner" ref={dateStripRef}>
              {days.map((day, dayIndex) => {
                const date = new Date(day.date + 'T12:00:00');
                const wd = date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
                const d = date.getDate();
                const tripDayNumber = dayIndex + 1;
                const slideIndex = dayIndex + 1;
                return (
                  <button key={day.day_number} className={`date-btn ${currentSlide === slideIndex ? 'active' : ''}`}
                    onClick={() => { if (!dateStripDragged.current) goTo(slideIndex); }}
                    aria-current={currentSlide === slideIndex ? 'date' : undefined}
                    aria-label={`Day ${tripDayNumber}, ${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
                    <span className="date-btn-number-row">
                      <span className="date-btn-trip-day">{tripDayNumber}</span>
                      <span className="date-btn-date-stack">
                        <span className="date-btn-wd">{wd}</span>
                        <span className="date-btn-d">{d}</span>
                      </span>
                    </span>
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

          {/* Bottom drawer — sticky chrome holding swipe-dots on day slides.
              The cover's Day by Day CTA lives in the trip overview content. */}
          {currentSlide !== 0 && (
            <div className="trip-bottom-drawer">
              <SwipeDots total={totalSlides} current={currentSlide} onDotClick={goTo} />
            </div>
          )}

        </div>
      )}

      {coverToast && <div className="trip-cover-action-toast">{coverToast}</div>}

      {confirmingOfflineRemove && (
        <div className="save-offline-confirm">
          <div className="save-offline-confirm-backdrop" onClick={() => setConfirmingOfflineRemove(false)} />
          <div className="save-offline-confirm-dialog" role="dialog" aria-modal="true" aria-label="Remove offline copy?">
            <div className="save-offline-confirm-title">Remove offline copy?</div>
            <p className="save-offline-confirm-message">
              You&rsquo;ll need a connection to view this trip again.
            </p>
            <div className="save-offline-confirm-actions">
              <button className="save-offline-confirm-btn cancel" onClick={() => setConfirmingOfflineRemove(false)}>
                Keep saved
              </button>
              <button className="save-offline-confirm-btn delete" onClick={handleRemoveOfflineDownload}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {coverDeleteConfirm && activeTripIndex !== null && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirm deletion">
          <div className="confirm-backdrop" onClick={() => !coverDeleteBusy && setCoverDeleteConfirm(false)} />
          <div className="confirm-dialog">
            <div className="confirm-title">Delete trip?</div>
            <p className="confirm-message">
              &ldquo;{trips[activeTripIndex]?.trip.name}&rdquo; will be permanently removed. This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setCoverDeleteConfirm(false)} disabled={coverDeleteBusy}>Cancel</button>
              <button className="confirm-btn confirm-btn-delete" onClick={handleDeleteActiveTrip} disabled={coverDeleteBusy}>
                {coverDeleteBusy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail sheet */}
      <div className={`detail-overlay ${detailOpen ? 'open' : ''} ${detailClosing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={detailContent.title}>
        <div className="detail-backdrop" onClick={closeDetail} />
        <div className="detail-sheet">
          <div className="detail-header">
            <div className="text-nav-title" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}>
              {detailContent.title}
            </div>
            <button className="detail-close" onClick={closeDetail} aria-label="Close details">
              <Icon name="x" />
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
