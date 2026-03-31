'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import '@/styles/connect.css';

type Step = 'loading' | 'invalid' | 'login' | 'authorize' | 'sending' | 'done' | 'error';

export default function ConnectPage() {
  return (
    <Suspense fallback={
      <div className="connect">
        <nav className="connect-nav"><span className="connect-logo">trips</span></nav>
        <div className="connect-card"><div className="connect-center"><p className="connect-desc">Loading...</p></div></div>
      </div>
    }>
      <ConnectInner />
    </Suspense>
  );
}

function ConnectInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || '';

  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
    if (!code) {
      setStep('invalid');
      return;
    }

    async function init() {
      // Check if code is valid
      const res = await fetch(`/api/auth/device/poll?code=${code}`);
      const data = await res.json();
      if (data.error) {
        setStep('invalid');
        return;
      }

      // Check if user is logged in
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        setUserEmail(user.email || null);
        setStep('authorize');
      } else {
        setStep('login');
      }
    }

    init();
  }, [code]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(`/connect?code=${code}`)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStep('error');
    } else {
      setMagicLinkSent(true);
    }
  }

  async function handleAuthorize() {
    setStep('sending');

    try {
      const res = await fetch('/api/auth/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        setStep('done');
      } else {
        setStep('error');
      }
    } catch {
      setStep('error');
    }
  }

  return (
    <div className="connect">
      <nav className="connect-nav">
        <Link href="/" className="connect-logo">trips</Link>
      </nav>

      <div className="connect-card">
        {step === 'loading' && (
          <div className="connect-center">
            <p className="connect-desc">Verifying...</p>
          </div>
        )}

        {step === 'invalid' && (
          <div className="connect-center">
            <div className="connect-icon connect-icon-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            </div>
            <h2 className="connect-title">Invalid or expired link</h2>
            <p className="connect-desc">This authorization link is no longer valid. Go back to Claude and try again.</p>
          </div>
        )}

        {step === 'login' && !magicLinkSent && (
          <>
            <div className="connect-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>
            </div>
            <h2 className="connect-title">Connect to trips</h2>
            <p className="connect-desc">Sign in to link your Claude skill to your account.</p>
            <form onSubmit={handleLogin} className="connect-form">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="connect-input"
                required
                autoFocus
              />
              <button type="submit" className="connect-btn">Send magic link</button>
            </form>
          </>
        )}

        {step === 'login' && magicLinkSent && (
          <div className="connect-center">
            <div className="connect-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0-8.953 5.932a2.25 2.25 0 0 1-2.594 0L2.25 6.75" /></svg>
            </div>
            <h2 className="connect-title">Check your email</h2>
            <p className="connect-desc">
              We sent a magic link to <strong>{email}</strong>. Click it to connect your skill.
            </p>
          </div>
        )}

        {step === 'authorize' && (
          <div className="connect-center">
            <div className="connect-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>
            </div>
            <h2 className="connect-title">Connect your skill</h2>
            <p className="connect-desc">
              Allow your Claude skill to save trips to your account
              {userEmail && <> (<strong>{userEmail}</strong>)</>}?
            </p>
            <button className="connect-btn" onClick={handleAuthorize}>Authorize</button>
          </div>
        )}

        {step === 'sending' && (
          <div className="connect-center">
            <p className="connect-desc">Connecting...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="connect-center">
            <div className="connect-icon connect-icon-success">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h2 className="connect-title">Connected!</h2>
            <p className="connect-desc">Your Claude skill is now linked to your account. You can close this window and go back to Claude.</p>
          </div>
        )}

        {step === 'error' && (
          <div className="connect-center">
            <div className="connect-icon connect-icon-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            </div>
            <h2 className="connect-title">Something went wrong</h2>
            <p className="connect-desc">Please go back to Claude and try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}
