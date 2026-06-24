'use client';

import { useEffect, useRef } from 'react';

interface AppTopBarScrollControllerProps {
  enabled?: boolean;
  scrollRootSelector?: string;
  scrollRootKey?: string | number;
  hideAfter?: number;
  revealAtTop?: number;
  directionThreshold?: number;
}

type ScrollRoot = HTMLElement | Window;
type ScrollDirection = 'up' | 'down';

function scrollTopFor(root: ScrollRoot): number {
  if (root instanceof HTMLElement) {
    return Math.max(0, root.scrollTop);
  }

  return Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
}

function addScrollListener(root: ScrollRoot, listener: () => void): () => void {
  root.addEventListener('scroll', listener, { passive: true });
  return () => root.removeEventListener('scroll', listener);
}

export default function AppTopBarScrollController({
  enabled = false,
  scrollRootSelector,
  scrollRootKey,
  hideAfter = 32,
  revealAtTop = 12,
  directionThreshold = 8,
}: AppTopBarScrollControllerProps) {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    const topbar = marker?.closest<HTMLElement>('.app-topbar');
    if (!topbar) return;

    if (!enabled) {
      topbar.classList.remove('is-scroll-hidden');
      return;
    }

    const scope = topbar.closest<HTMLElement>('.trip-screen, .trip-app');
    const selectedRoot = scrollRootSelector
      ? scope?.querySelector(scrollRootSelector) ?? document.querySelector(scrollRootSelector)
      : null;
    const scrollRoot: ScrollRoot = selectedRoot instanceof HTMLElement ? selectedRoot : window;

    let hidden = false;
    let lastScrollTop = scrollTopFor(scrollRoot);
    let currentDirection: ScrollDirection | null = null;
    let directionDistance = 0;
    let frame = 0;

    const setHidden = (nextHidden: boolean) => {
      if (hidden === nextHidden) return;
      hidden = nextHidden;
      topbar.classList.toggle('is-scroll-hidden', nextHidden);
    };

    const syncTopbar = () => {
      frame = 0;
      const nextScrollTop = scrollTopFor(scrollRoot);
      const delta = nextScrollTop - lastScrollTop;

      if (nextScrollTop <= revealAtTop) {
        setHidden(false);
        currentDirection = null;
        directionDistance = 0;
        lastScrollTop = nextScrollTop;
        return;
      }

      if (Math.abs(delta) >= 1) {
        const nextDirection: ScrollDirection = delta > 0 ? 'down' : 'up';
        directionDistance = nextDirection === currentDirection
          ? directionDistance + Math.abs(delta)
          : Math.abs(delta);
        currentDirection = nextDirection;

        if (
          nextDirection === 'down'
          && !hidden
          && nextScrollTop > hideAfter
          && directionDistance >= directionThreshold
        ) {
          setHidden(true);
          directionDistance = 0;
        } else if (
          nextDirection === 'up'
          && hidden
          && directionDistance >= directionThreshold
        ) {
          setHidden(false);
          directionDistance = 0;
        }
      }

      lastScrollTop = nextScrollTop;
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(syncTopbar);
    };

    topbar.classList.remove('is-scroll-hidden');
    const removeScrollListener = addScrollListener(scrollRoot, onScroll);
    syncTopbar();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      removeScrollListener();
      topbar.classList.remove('is-scroll-hidden');
    };
  }, [
    directionThreshold,
    enabled,
    hideAfter,
    revealAtTop,
    scrollRootKey,
    scrollRootSelector,
  ]);

  return <span ref={markerRef} hidden aria-hidden="true" />;
}
