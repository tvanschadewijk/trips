'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { createClient } from '@/lib/supabase/client';
import '@/styles/admin.css';

interface AnalyticsData {
  granularity: 'day' | 'month';
  users: {
    total: number;
    new_in_range: number;
    per_bucket: { bucket: string; new_users: number; total_users: number }[];
  };
  trips: {
    total: number;
    unique_users_with_trips: number;
    avg_per_user: number;
    per_bucket: { bucket: string; trips: number }[];
  };
  range: { from: string | null; to: string | null };
}

function formatBucket(bucket: string, granularity: 'day' | 'month') {
  if (granularity === 'day') {
    const d = new Date(bucket + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const [y, m] = bucket.split('-');
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatBucketLong(bucket: string, granularity: 'day' | 'month') {
  if (granularity === 'day') {
    const d = new Date(bucket + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }
  const [y, m] = bucket.split('-');
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const CustomTooltip = ({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
  formatter?: (label: string) => string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="admin-tooltip">
      <div className="admin-tooltip-label">{formatter ? formatter(label || '') : label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="admin-tooltip-row">
          <span className="admin-tooltip-dot" style={{ background: entry.color }} />
          <span className="admin-tooltip-name">{entry.name}</span>
          <span className="admin-tooltip-value">{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
};

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [activePreset, setActivePreset] = useState<string>('all');

  const fetchData = useCallback(async (from?: string, to?: string, granularity?: 'day' | 'month') => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (granularity) params.set('granularity', granularity);
    const qs = params.toString();

    const res = await fetch(`/api/admin/analytics${qs ? `?${qs}` : ''}`);
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    if (res.status === 403) {
      setError('forbidden');
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError('Failed to load analytics');
      setLoading(false);
      return;
    }
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login');
        return;
      }
      fetchData();
    });
  }, [fetchData, router]);

  function applyPreset(preset: string) {
    setActivePreset(preset);
    const now = new Date();

    if (preset === 'all') {
      setRangeFrom('');
      setRangeTo('');
      fetchData();
      return;
    }

    let from: Date;
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (preset === '7d') {
      from = new Date(to);
      from.setDate(from.getDate() - 7);
    } else if (preset === '30d') {
      from = new Date(to);
      from.setDate(from.getDate() - 30);
    } else if (preset === '90d') {
      from = new Date(to);
      from.setDate(from.getDate() - 90);
    } else if (preset === 'ytd') {
      from = new Date(now.getFullYear(), 0, 1);
    } else {
      return;
    }

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    setRangeFrom(fromStr);
    setRangeTo(toStr);
    const gran = (preset === '7d' || preset === '30d') ? 'day' as const : 'month' as const;
    fetchData(fromStr, toStr, gran);
  }

  function applyCustomRange() {
    if (!rangeFrom || !rangeTo) return;
    setActivePreset('custom');
    const diffDays = Math.round((new Date(rangeTo).getTime() - new Date(rangeFrom).getTime()) / 86400000);
    const gran = diffDays <= 30 ? 'day' as const : 'month' as const;
    fetchData(rangeFrom, rangeTo, gran);
  }

  if (loading && !data) {
    return (
      <div className="admin">
        <div className="admin-loading">
          <div className="admin-loading-dot" />
          <span>Loading analytics...</span>
        </div>
      </div>
    );
  }

  if (error === 'forbidden') {
    return (
      <div className="admin">
        <div className="admin-forbidden">
          <div className="admin-forbidden-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          </div>
          <h2>Access denied</h2>
          <p>You don&apos;t have permission to view this page.</p>
          <Link href="/dashboard" className="admin-back-link">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin">
        <div className="admin-forbidden">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="admin">
      <nav className="admin-nav">
        <div className="admin-nav-inner">
          <div className="admin-nav-left">
            <Link href="/dashboard" className="admin-nav-back" title="Back to dashboard">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <span className="admin-nav-title">Analytics</span>
            <span className="admin-nav-badge">Admin</span>
          </div>
        </div>
      </nav>

      <main className="admin-main">
        <div className="admin-controls">
          <div className="admin-presets">
            {[
              { key: 'all', label: 'All time' },
              { key: '7d', label: '7 days' },
              { key: '30d', label: '30 days' },
              { key: '90d', label: '90 days' },
              { key: 'ytd', label: 'YTD' },
            ].map(p => (
              <button
                key={p.key}
                className={`admin-preset-btn ${activePreset === p.key ? 'active' : ''}`}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="admin-date-range">
            <input type="date" className="admin-date-input" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
            <span className="admin-date-sep">to</span>
            <input type="date" className="admin-date-input" value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
            <button className="admin-apply-btn" onClick={applyCustomRange} disabled={!rangeFrom || !rangeTo}>Apply</button>
          </div>
        </div>

        <div className="admin-kpi-grid">
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Total Users</div>
            <div className="admin-kpi-value">{data.users.total.toLocaleString()}</div>
            <div className="admin-kpi-sub">All registered accounts</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Total Trips</div>
            <div className="admin-kpi-value">{data.trips.total.toLocaleString()}</div>
            <div className="admin-kpi-sub">{data.range.from ? 'In selected range' : 'All time'}</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Avg Trips / User</div>
            <div className="admin-kpi-value">{data.trips.avg_per_user}</div>
            <div className="admin-kpi-sub">Among {data.trips.unique_users_with_trips} users with trips</div>
          </div>
        </div>

        <div className="admin-chart-card">
          <div className="admin-chart-header">
            <h3 className="admin-chart-title">Users</h3>
            <span className="admin-chart-sub">Cumulative total and new signups per {data.granularity === 'day' ? 'day' : 'month'}</span>
          </div>
          <div className="admin-chart-body">
            {data.users.per_bucket.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.users.per_bucket} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5e6ad2" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#5e6ad2" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="bucket" tickFormatter={(v) => formatBucket(v, data.granularity)} stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} interval={data.granularity === 'day' && data.users.per_bucket.length > 14 ? Math.floor(data.users.per_bucket.length / 10) : 'preserveStartEnd'} />
                  <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip formatter={(v) => formatBucketLong(v, data.granularity)} />} />
                  <Area type="monotone" dataKey="total_users" name="Total users" stroke="#5e6ad2" fill="url(#gradUsers)" strokeWidth={2} />
                  <Area type="monotone" dataKey="new_users" name="New users" stroke="#7170ff" fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="admin-chart-empty">No user data available</div>
            )}
          </div>
        </div>

        <div className="admin-chart-card">
          <div className="admin-chart-header">
            <h3 className="admin-chart-title">Trips created</h3>
            <span className="admin-chart-sub">New trips per {data.granularity === 'day' ? 'day' : 'month'}</span>
          </div>
          <div className="admin-chart-body">
            {data.trips.per_bucket.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.trips.per_bucket} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradTrips" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7170ff" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#7170ff" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="bucket" tickFormatter={(v) => formatBucket(v, data.granularity)} stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} interval={data.granularity === 'day' && data.trips.per_bucket.length > 14 ? Math.floor(data.trips.per_bucket.length / 10) : 'preserveStartEnd'} />
                  <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip formatter={(v) => formatBucketLong(v, data.granularity)} />} />
                  <Bar dataKey="trips" name="Trips" fill="url(#gradTrips)" radius={[4, 4, 0, 0]} maxBarSize={data.granularity === 'day' ? 24 : 48} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="admin-chart-empty">No trip data available</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
