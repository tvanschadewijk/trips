import Link from 'next/link';
import type { ReactNode } from 'react';

interface AppTopBarProps {
  href?: string;
  suffix?: ReactNode;
  actions?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export default function AppTopBar({
  href = '/',
  suffix,
  actions,
  className,
  ariaLabel = 'OurTrips navigation',
}: AppTopBarProps) {
  return (
    <nav className={['app-topbar', className].filter(Boolean).join(' ')} aria-label={ariaLabel}>
      <div className="app-topbar-inner">
        <Link href={href} className="app-topbar-logo" aria-label="OurTrips home">
          <span className="app-topbar-logo-word">
            OurTrips<span className="app-topbar-logo-to">.To</span>
          </span>
          {suffix ? <span className="app-topbar-suffix">{suffix}</span> : null}
        </Link>
        {actions ? <div className="app-topbar-actions">{actions}</div> : null}
      </div>
    </nav>
  );
}
