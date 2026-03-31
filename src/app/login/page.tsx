'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import '@/styles/login.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });

    setStatus(error ? 'error' : 'sent');
  }

  return (
    <div className="login">
      <nav className="login-nav">
        <Link href="/" className="login-logo">trips</Link>
      </nav>

      <div className="login-card">
        {status === 'sent' ? (
          <div className="login-sent">
            <div className="login-sent-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0-8.953 5.932a2.25 2.25 0 0 1-2.594 0L2.25 6.75" /></svg>
            </div>
            <h2 className="login-title">Check your email</h2>
            <p className="login-desc">
              We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
            </p>
            <button className="login-btn-text" onClick={() => setStatus('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h2 className="login-title">Sign in to trips</h2>
            <p className="login-desc">Enter your email to receive a magic link.</p>
            <form onSubmit={handleSubmit} className="login-form">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="login-input"
                required
                autoFocus
              />
              <button type="submit" className="login-btn" disabled={status === 'loading'}>
                {status === 'loading' ? 'Sending...' : 'Send magic link'}
              </button>
              {status === 'error' && (
                <p className="login-error">Something went wrong. Please try again.</p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
