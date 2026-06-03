'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

type CopyState = 'idle' | 'copied' | 'failed';

type GuideCopyButtonProps = {
  value: string;
};

export default function GuideCopyButton({ value }: GuideCopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function copyValue() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }

    resetTimer.current = setTimeout(() => {
      setCopyState('idle');
    }, 1800);
  }

  const label =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'failed'
        ? 'Copy failed'
        : 'Copy to clipboard';

  return (
    <button
      type="button"
      className={`guide-copy-btn ${copyState === 'copied' ? 'guide-copy-btn-copied' : ''}`}
      onClick={copyValue}
      aria-label={label}
      title={label}
    >
      {copyState === 'copied' ? (
        <Check size={15} strokeWidth={2.3} aria-hidden="true" />
      ) : (
        <Copy size={15} aria-hidden="true" />
      )}
    </button>
  );
}
