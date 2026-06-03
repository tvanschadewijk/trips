'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { Check, CircleX, KeyRound, Mail } from 'lucide-react';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import '@/styles/connect.css';

type Step = 'loading' | 'invalid' | 'login' | 'authorize' | 'sending' | 'done' | 'error';

export default function ConnectPage() {
  return (
    <Suspense fallback={
      <div className="connect">
        <nav className="connect-nav"><span className="connect-logo">OurTrips<LogoSuffix /></span></nav>
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

  const [step, setStep] = useState<Step>(() => code ? 'loading' : 'invalid');
  const [email, setEmail] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
    if (!code) {
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
        // Auto-authorize if already logged in — skip the button click
        setStep('sending');
        try {
          const authRes = await fetch('/api/auth/device/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          setStep(authRes.ok ? 'done' : 'error');
        } catch {
          setStep('error');
        }
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
        <Link href="/" className="connect-logo">OurTrips<LogoSuffix /></Link>
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
              <CircleX aria-hidden="true" />
            </div>
            <h2 className="connect-title">Invalid or expired link</h2>
            <p className="connect-desc">This authorization link is no longer valid. Go back to Claude and try again.</p>
          </div>
        )}

        {step === 'login' && !magicLinkSent && (
          <>
            <div className="connect-icon">
              <KeyRound aria-hidden="true" />
            </div>
            <h2 className="connect-title">Connect to OurTrips</h2>
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
              <Mail aria-hidden="true" />
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
              <KeyRound aria-hidden="true" />
            </div>
            <h2 className="connect-title">Connect your skill</h2>
            <p className="connect-desc">
              Allow your Claude skill to save trips to your OurTrips account
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
              <Check aria-hidden="true" />
            </div>
            <h2 className="connect-title">Connected!</h2>
            <p className="connect-desc">Your Claude skill is now linked to your account. You can close this window and go back to Claude.</p>
          </div>
        )}

        {step === 'error' && (
          <div className="connect-center">
            <div className="connect-icon connect-icon-error">
              <CircleX aria-hidden="true" />
            </div>
            <h2 className="connect-title">Something went wrong</h2>
            <p className="connect-desc">Please go back to Claude and try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}
