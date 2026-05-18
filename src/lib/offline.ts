'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TripData } from './types';

/**
 * Shared offline helpers for OurTrips.
 *
 * Trip data caching strategy:
 *  - The service worker caches trip HTML and /api/trip-data JSON.
 *  - This module persists a lightweight manifest per saved trip in
 *    localStorage so the dashboard can show "Saved" badges and the
 *    offline page can list downloadable trips.
 *  - The actual TripData JSON is mirrored to localStorage too as a
 *    last-resort hydration source if both SW and network fail.
 */

const MANIFEST_KEY = 'ourtrips:offline-manifest:v1';
const TRIP_KEY_PREFIX = 'ourtrips:offline-trip:v1:';

export interface OfflineManifestEntry {
  shareId: string;
  name: string;
  subtitle?: string;
  heroImage?: string;
  start?: string;
  end?: string;
  savedAt: number;
}

export type OfflineState =
  | { status: 'idle' }
  | { status: 'saving'; progress?: number }
  | { status: 'saved'; savedAt: number }
  | { status: 'removing' }
  | { status: 'error'; message: string };

function readManifest(): Record<string, OfflineManifestEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeManifest(manifest: Record<string, OfflineManifestEntry>): void {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    // quota exceeded — caller decides what to do
  }
}

export function listOfflineTrips(): OfflineManifestEntry[] {
  return Object.values(readManifest()).sort((a, b) => b.savedAt - a.savedAt);
}

export function isTripSavedOffline(shareId: string): boolean {
  return !!readManifest()[shareId];
}

export function getOfflineTripData(shareId: string): TripData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TRIP_KEY_PREFIX + shareId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: TripData };
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveOfflineTripData(shareId: string, data: TripData): void {
  try {
    localStorage.setItem(
      TRIP_KEY_PREFIX + shareId,
      JSON.stringify({ data, savedAt: Date.now() })
    );
  } catch {
    // ignore
  }
}

function clearOfflineTripData(shareId: string): void {
  try {
    localStorage.removeItem(TRIP_KEY_PREFIX + shareId);
  } catch {}
}

function setManifestEntry(entry: OfflineManifestEntry): void {
  const manifest = readManifest();
  manifest[entry.shareId] = entry;
  writeManifest(manifest);
}

function removeManifestEntry(shareId: string): void {
  const manifest = readManifest();
  delete manifest[shareId];
  writeManifest(manifest);
}

/**
 * Send a message to the active service worker and await a single reply
 * via MessageChannel. Resolves null if no SW is controlling the page.
 */
function postToSw<T>(message: unknown, timeoutMs = 30000): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      resolve(null);
      return;
    }
    const sw = navigator.serviceWorker.controller;
    if (!sw) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    let settled = false;
    const finish = (v: T | null) => {
      if (settled) return;
      settled = true;
      try { channel.port1.close(); } catch {}
      resolve(v);
    };
    channel.port1.onmessage = (e) => finish(e.data as T);
    setTimeout(() => finish(null), timeoutMs);
    try {
      sw.postMessage(message, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/**
 * Walk a TripData and return every URL that should be cached for full
 * offline viewing. Includes hero images, day heroes, and any image
 * referenced from blocks/services/notes.
 */
export function collectTripAssetUrls(shareId: string, data: TripData): string[] {
  const urls = new Set<string>();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // The page itself + JSON endpoint.
  urls.add(`${origin}/t/${shareId}`);
  urls.add(`${origin}/api/trip-data/${shareId}`);

  const addImage = (u?: string) => {
    if (!u) return;
    if (u.startsWith('data:')) return;
    urls.add(u);
  };

  addImage(data.trip.hero_image);
  addImage(data.trip.overview_image);
  for (const asset of Object.values(data.trip.image_assets ?? {})) {
    addImage(asset?.url);
  }

  for (const day of data.days) {
    addImage(day.hero_image);
    if (day.blocks) {
      for (const block of day.blocks) {
        // content may contain markdown-ish image references; best-effort regex.
        const matches = block.content?.match(/https?:\/\/\S+\.(jpg|jpeg|png|webp|gif|avif)/gi);
        if (matches) matches.forEach((m) => addImage(m));
      }
    }
  }

  return Array.from(urls);
}

export interface UseOfflineTripResult {
  state: OfflineState;
  isSaved: boolean;
  save(data: TripData): Promise<void>;
  remove(): Promise<void>;
}

export function useOfflineTrip(
  shareId: string | undefined,
  meta?: Pick<OfflineManifestEntry, 'name' | 'subtitle' | 'heroImage' | 'start' | 'end'>
): UseOfflineTripResult {
  const [state, setState] = useState<OfflineState>({ status: 'idle' });
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!shareId) return;
    const manifest = readManifest();
    const entry = manifest[shareId];
    if (entry) {
      setIsSaved(true);
      setState({ status: 'saved', savedAt: entry.savedAt });
    } else {
      setIsSaved(false);
      setState({ status: 'idle' });
    }
  }, [shareId]);

  const save = useCallback(async (data: TripData) => {
    if (!shareId) return;
    setState({ status: 'saving' });
    saveOfflineTripData(shareId, data);

    const urls = collectTripAssetUrls(shareId, data);
    const result = await postToSw<{ ok: number; failed: number } | null>({
      type: 'cache-trip-assets',
      urls,
    });

    if (!result) {
      // No service worker — still mark saved (we have the JSON in
      // localStorage as a fallback).
      const entry: OfflineManifestEntry = {
        shareId,
        name: meta?.name ?? data.trip.name,
        subtitle: meta?.subtitle ?? data.trip.subtitle,
        heroImage: meta?.heroImage ?? data.trip.hero_image,
        start: meta?.start ?? data.trip.dates?.start,
        end: meta?.end ?? data.trip.dates?.end,
        savedAt: Date.now(),
      };
      setManifestEntry(entry);
      setIsSaved(true);
      setState({ status: 'saved', savedAt: entry.savedAt });
      return;
    }

    const entry: OfflineManifestEntry = {
      shareId,
      name: meta?.name ?? data.trip.name,
      subtitle: meta?.subtitle ?? data.trip.subtitle,
      heroImage: meta?.heroImage ?? data.trip.hero_image,
      start: meta?.start ?? data.trip.dates?.start,
      end: meta?.end ?? data.trip.dates?.end,
      savedAt: Date.now(),
    };
    setManifestEntry(entry);
    setIsSaved(true);
    setState({ status: 'saved', savedAt: entry.savedAt });
  }, [shareId, meta?.name, meta?.subtitle, meta?.heroImage, meta?.start, meta?.end]);

  const remove = useCallback(async () => {
    if (!shareId) return;
    setState({ status: 'removing' });
    await postToSw({ type: 'remove-trip', shareId });
    removeManifestEntry(shareId);
    clearOfflineTripData(shareId);
    setIsSaved(false);
    setState({ status: 'idle' });
  }, [shareId]);

  return { state, isSaved, save, remove };
}

export function useIsOfflineSavedTrip(shareId: string | undefined): boolean {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!shareId) {
      setSaved(false);
      return;
    }
    setSaved(isTripSavedOffline(shareId));
  }, [shareId]);
  return saved;
}

export function useSavedTripIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setIds(new Set(Object.keys(readManifest())));
  }, []);
  return ids;
}
