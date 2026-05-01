'use client';

import { useState } from 'react';
import { useOfflineTrip } from '@/lib/offline';
import type { TripData } from '@/lib/types';

interface Props {
  shareId: string;
  data: TripData;
}

/**
 * Small icon-pill button in the trip nav top-right that toggles offline
 * download for the current trip. Shows idle / saving / saved states with
 * a long-press confirm to remove. Hidden until the SW is registered.
 */
export default function SaveOfflineButton({ shareId, data }: Props) {
  const { state, isSaved, save, remove } = useOfflineTrip(shareId, {
    name: data.trip.name,
    subtitle: data.trip.subtitle,
    heroImage: data.trip.hero_image,
    start: data.trip.dates?.start,
    end: data.trip.dates?.end,
  });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleClick = async () => {
    if (state.status === 'saving' || state.status === 'removing') return;
    if (isSaved) {
      setConfirmingRemove(true);
      return;
    }
    await save(data);
    setToast('Saved for offline');
    setTimeout(() => setToast(null), 2200);
  };

  const handleRemove = async () => {
    setConfirmingRemove(false);
    await remove();
    setToast('Removed from offline');
    setTimeout(() => setToast(null), 2200);
  };

  const label = (() => {
    if (state.status === 'saving') return 'Saving for offline…';
    if (state.status === 'removing') return 'Removing…';
    if (isSaved) return 'Saved offline — tap to remove';
    return 'Save for offline';
  })();

  return (
    <>
      <button
        type="button"
        className={`save-offline-btn ${isSaved ? 'saved' : ''} ${state.status === 'saving' || state.status === 'removing' ? 'busy' : ''}`}
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        {state.status === 'saving' || state.status === 'removing' ? (
          <SpinnerIcon />
        ) : isSaved ? (
          <CheckIcon />
        ) : (
          <DownloadIcon />
        )}
      </button>

      {toast && <div className="save-offline-toast">{toast}</div>}

      {confirmingRemove && (
        <div className="confirm-overlay">
          <div className="confirm-backdrop" onClick={() => setConfirmingRemove(false)} />
          <div className="confirm-dialog">
            <div className="confirm-title">Remove offline copy?</div>
            <p className="confirm-message">
              You&rsquo;ll need a connection to view this trip again.
            </p>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setConfirmingRemove(false)}>
                Keep saved
              </button>
              <button className="confirm-btn confirm-btn-delete" onClick={handleRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="save-offline-spinner">
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}
