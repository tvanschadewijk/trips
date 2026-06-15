import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formatTripLogisticsLedgerForRead } from '@/lib/trip-service';
import '@/styles/admin.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Trip Logistics Ledger — OurTrips Admin',
  robots: {
    index: false,
    follow: false,
  },
};

type PageSearchParams = Promise<{
  trip_id?: string | string[];
}>;

type TripRecord = {
  id: string;
  name: string;
  share_id: string;
  share_mode?: string;
  created_at: string;
  updated_at: string;
  data: unknown;
};

async function isAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(date: string | null | undefined, weekday?: string): string {
  if (!date) return 'Not set';
  return weekday ? `${weekday}, ${date}` : date;
}

function dayRangeLabel(dayNumbers: number[]): string {
  if (dayNumbers.length === 0) return '';
  if (dayNumbers.length === 1) return `Day ${dayNumbers[0]}`;
  return `Days ${dayNumbers[0]}-${dayNumbers[dayNumbers.length - 1]}`;
}

function statusClass(status: 'ok' | 'needs_repair'): string {
  return status === 'ok' ? 'is-ok' : 'needs-repair';
}

export default async function AdminLogisticsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  if (!(await isAdmin(user.id))) {
    return (
      <div className="admin admin-logistics">
        <div className="admin-forbidden">
          <h2>Access denied</h2>
          <p>You don&apos;t have permission to view this page.</p>
          <Link href="/dashboard" className="admin-back-link">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();
  const params = await searchParams;
  const selectedTripId = one(params.trip_id);

  const { data: recentTrips, error: recentTripsError } = await admin
    .from('trips')
    .select('id, name, share_id, share_mode, created_at, updated_at, data')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (recentTripsError) {
    throw new Error(recentTripsError.message);
  }

  const trips = (recentTrips ?? []) as TripRecord[];
  let selectedTrip =
    (selectedTripId ? trips.find((trip) => trip.id === selectedTripId) : undefined) ?? trips[0];

  if (selectedTripId && !selectedTrip) {
    const { data: exactTrip, error: exactTripError } = await admin
      .from('trips')
      .select('id, name, share_id, share_mode, created_at, updated_at, data')
      .eq('id', selectedTripId)
      .single();

    if (!exactTripError && exactTrip) {
      selectedTrip = exactTrip as TripRecord;
    }
  }

  const ledger = selectedTrip
    ? formatTripLogisticsLedgerForRead(selectedTrip as unknown as Record<string, unknown>, '')
    : null;

  return (
    <div className="admin admin-logistics">
      <nav className="admin-nav">
        <div className="admin-nav-inner admin-logistics-nav-inner">
          <div className="admin-nav-left">
            <Link href="/admin" className="admin-nav-back" title="Back to analytics">
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <span className="admin-nav-title">Trip Logistics</span>
            <span className="admin-nav-badge">Admin</span>
          </div>
          {ledger ? (
            <Link href={`/t/${ledger.share_id}`} className="admin-logistics-trip-link">
              Open trip
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </nav>

      <main className="admin-main admin-logistics-main">
        <section className="admin-logistics-hero">
          <div>
            <div className="admin-logistics-overline">Canonical ledger</div>
            <h1>Dates, sleeps, stays.</h1>
          </div>
          <form className="admin-logistics-selector" method="get">
            <label htmlFor="trip_id">Trip</label>
            <div className="admin-logistics-selector-row">
              <select id="trip_id" name="trip_id" defaultValue={selectedTrip?.id ?? ''}>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
              <button type="submit">View</button>
            </div>
          </form>
        </section>

        {!ledger ? (
          <section className="admin-logistics-card">
            <h2>No trips found</h2>
            <p className="admin-logistics-muted">Create a trip first, then its ledger will appear here.</p>
          </section>
        ) : (
          <>
            <section className="admin-logistics-card admin-logistics-summary">
              <div className="admin-logistics-card-header">
                <div>
                  <div className="admin-logistics-overline">Source</div>
                  <h2>{ledger.trip_name}</h2>
                  <p>{ledger.trip_id}</p>
                </div>
                <span className={`admin-logistics-status ${statusClass(ledger.status)}`}>
                  {ledger.status === 'ok' ? 'OK' : 'Needs repair'}
                </span>
              </div>

              <div className="admin-logistics-kpis">
                <div>
                  <span>Starts</span>
                  <strong>{dateLabel(ledger.trip_span.start_date, ledger.trip_span.start_weekday)}</strong>
                </div>
                <div>
                  <span>Ends</span>
                  <strong>{dateLabel(ledger.trip_span.end_date, ledger.trip_span.end_weekday)}</strong>
                </div>
                <div>
                  <span>Itinerary days</span>
                  <strong>{ledger.trip_span.actual_itinerary_day_count}</strong>
                </div>
                <div>
                  <span>Scheduled sleeps</span>
                  <strong>{ledger.trip_span.scheduled_sleep_count}</strong>
                </div>
              </div>
            </section>

            <section className="admin-logistics-grid">
              <article className="admin-logistics-card">
                <div className="admin-logistics-card-header">
                  <div>
                    <div className="admin-logistics-overline">Day ledger</div>
                    <h2>Calendar</h2>
                  </div>
                </div>
                <div className="admin-logistics-table-wrap">
                  <table className="admin-logistics-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Date</th>
                        <th>Title</th>
                        <th>Sleep</th>
                        <th>Transport</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.day_ledger.map((day) => (
                        <tr key={day.day_number}>
                          <td>{day.day_number}</td>
                          <td>{dateLabel(day.date, day.weekday)}</td>
                          <td>{day.title || 'Untitled day'}</td>
                          <td>
                            {day.sleep_location ?? 'No sleep scheduled'}
                            {day.sleep_status ? <span>{day.sleep_status}</span> : null}
                          </td>
                          <td>{day.transport_summary.join(', ') || 'Local / none'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="admin-logistics-card">
                <div className="admin-logistics-card-header">
                  <div>
                    <div className="admin-logistics-overline">Stay ledger</div>
                    <h2>Nights by stay</h2>
                  </div>
                </div>
                <div className="admin-logistics-stays">
                  {ledger.stay_ledger.length === 0 ? (
                    <p className="admin-logistics-muted">No accommodation sleeps are scheduled.</p>
                  ) : (
                    ledger.stay_ledger.map((stay) => (
                      <div className="admin-logistics-stay" key={stay.index}>
                        <div>
                          <strong>{stay.stay_name}</strong>
                          <span>{dayRangeLabel(stay.day_numbers)}</span>
                        </div>
                        <dl>
                          <div>
                            <dt>Check-in</dt>
                            <dd>{stay.check_in ?? 'Not set'}</dd>
                          </div>
                          <div>
                            <dt>Check-out</dt>
                            <dd>{stay.check_out ?? 'Not set'}</dd>
                          </div>
                          <div>
                            <dt>Nights</dt>
                            <dd>{stay.nights}</dd>
                          </div>
                        </dl>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>

            <section className="admin-logistics-card">
              <div className="admin-logistics-card-header">
                <div>
                  <div className="admin-logistics-overline">Validation</div>
                  <h2>Issues</h2>
                </div>
                <span className={`admin-logistics-status ${statusClass(ledger.status)}`}>
                  {ledger.validation.error_count} errors
                </span>
              </div>
              {ledger.validation.errors.length === 0 && ledger.validation.warnings.length === 0 ? (
                <p className="admin-logistics-muted">No logistics errors or warnings.</p>
              ) : (
                <div className="admin-logistics-issues">
                  {ledger.validation.errors.map((issue) => (
                    <p className="is-error" key={issue}>{issue}</p>
                  ))}
                  {ledger.validation.warnings.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
