import { useEffect, useState } from 'react';
import { AlertCircle, Info, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import type { AuthUser } from '../../shared/schema.ts';
import { login, loginWithFirebaseIdToken, registerAccount } from '../lib/api.ts';
import { signInWithGooglePopup } from '../lib/firebase.ts';
import { NexusLogo } from './NexusLogo.tsx';

interface AuthGateViewProps {
  onAuthenticated: (user: AuthUser) => void;
  initialNotice?: string | null;
}

export function AuthGateView({ onAuthenticated, initialNotice = null }: AuthGateViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('admin@nexus.ai');
  const [password, setPassword] = useState('nexus-admin-2026');
  const [displayName, setDisplayName] = useState('');
  const [roleTitle, setRoleTitle] = useState('AI Systems Engineer');
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNotice(initialNotice ?? null);
  }, [initialNotice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await registerAccount({ email, password, displayName, roleTitle });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const quickSignIn = async (presetEmail: string, presetPass: string) => {
    setError(null);
    setNotice(null);
    setEmail(presetEmail);
    setPassword(presetPass);
    setSubmitting(true);
    try {
      const user = await login(presetEmail, presetPass);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const idToken = await signInWithGooglePopup();
      const user = await loginWithFirebaseIdToken(idToken);
      onAuthenticated(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060913] px-4 py-12 text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 sm:p-8">
        <div className="space-y-3">
          <NexusLogo />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              {mode === 'login' ? 'Sign in to NEXUS AI' : 'Create Workspace Account'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {mode === 'login'
                ? 'Authenticated session required for agent orchestration, memory, and workspace tools.'
                : 'Register a new developer account protected by scrypt password hashing.'}
            </p>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-slate-800 bg-[#060913] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'login' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'register' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Register
          </button>
        </div>

        {notice && !error && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-blue-500/40 bg-blue-950/35 p-3 text-xs text-blue-200"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-950/35 p-3 text-xs text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="text-xs font-medium text-slate-300">
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="auth-title" className="text-xs font-medium text-slate-300">
                  Role Title
                </label>
                <input
                  id="auth-title"
                  type="text"
                  required
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="text-xs font-medium text-slate-300">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="text-xs font-medium text-slate-300">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {mode === 'login' ? <KeyRound className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            <span>{submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleGoogleSignIn()}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-700 bg-[#060913] px-4 py-2.5 text-sm font-medium text-slate-100 hover:border-blue-500/60 hover:bg-slate-900 disabled:opacity-60 transition-colors cursor-pointer"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          <span>Continue with Google (Firebase Auth)</span>
        </button>

        {mode === 'login' && (
          <div className="space-y-2.5 border-t border-slate-800/80 pt-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
              <span>Workspace Role Accounts</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void quickSignIn('admin@nexus.ai', 'nexus-admin-2026')}
                className="rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-blue-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Admin
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void quickSignIn('dev@nexus.ai', 'nexus-dev-2026')}
                className="rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-blue-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Developer
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void quickSignIn('viewer@nexus.ai', 'nexus-view-2026')}
                className="rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-blue-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Viewer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
