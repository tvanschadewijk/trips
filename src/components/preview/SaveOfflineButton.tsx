'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, LoaderCircle } from 'lucide-react';
import { useOfflineTrip } from '@/lib/offline';
import { getTripOverviewImageUrl } from '@/lib/trip-images';
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
    heroImage: getTripOverviewImageUrl(data.trip),
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
          <LoaderCircle size={18} className="save-offline-spinner" aria-hidden="true" />
        ) : isSaved ? (
          <Check size={18} strokeWidth={2.4} aria-hidden="true" />
        ) : (
          <Download size={18} aria-hidden="true" />
        )}
      </button>

      {toast && <div className="save-offline-toast">{toast}</div>}

      {confirmingRemove && createPortal(
        <div className="save-offline-confirm">
          <div className="save-offline-confirm-backdrop" onClick={() => setConfirmingRemove(false)} />
          <div className="save-offline-confirm-dialog" role="dialog" aria-modal="true" aria-label="Remove offline copy?">
            <div className="save-offline-confirm-title">Remove offline copy?</div>
            <p className="save-offline-confirm-message">
              You&rsquo;ll need a connection to view this trip again.
            </p>
            <div className="save-offline-confirm-actions">
              <button className="save-offline-confirm-btn cancel" onClick={() => setConfirmingRemove(false)}>
                Keep saved
              </button>
              <button className="save-offline-confirm-btn delete" onClick={handleRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
