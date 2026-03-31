'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import '@/styles/login.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  }

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
            <p className="login-desc">Sign in to manage and share your trips.</p>

            <button type="button" className="login-btn-google" onClick={handleGoogle}>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="login-divider">
              <span>or</span>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="login-input"
                required
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
