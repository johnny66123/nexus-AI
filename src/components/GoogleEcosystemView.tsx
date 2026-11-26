import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Languages,
  Link2,
  ListTodo,
  Loader2,
  Mail,
  MapPin,
  Play,
  Presentation,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Unlink,
  Users,
  Youtube,
} from 'lucide-react';
import {
  disconnectGoogleAccount,
  executeGoogleAction,
  fetchGoogleStatus,
  formatRelativeTime,
  requestGoogleOAuthUrl,
  runGoogleCommand,
} from '../lib/api.ts';
import type {
  GoogleEcosystemStatusResponse,
  GoogleExecuteResult,
  GoogleServiceId,
  GoogleServiceStatusItem,
} from '../lib/api.ts';

interface GoogleEcosystemViewProps {
  canEdit: boolean;
  oauthNotice?: string | null;
  oauthError?: string | null;
}

const SERVICE_ICONS: Record<GoogleServiceId, typeof Globe> = {
  search: Globe,
  gmail: Mail,
  drive: HardDrive,
  docs: FileText,
  sheets: FileSpreadsheet,
  slides: Presentation,
  calendar: Calendar,
  maps: MapPin,
  contacts: Users,
  tasks: ListTodo,
  photos: ImageIcon,
  youtube: Youtube,
  translate: Languages,
  cloud: Cloud,
};

const QUICK_TEST_ACTION: Partial<
  Record<
    GoogleServiceId,
    { label: string; action: string; input: Record<string, unknown>; mutating?: boolean }
  >
> = {
  search: {
    label: 'Run Web Search',
    action: 'search_web',
    input: { query: 'Latest Google Gemini API release updates' },
  },
  translate: {
    label: 'Translate Sample',
    action: 'translate_text',
    input: { text: 'Welcome to NEVUS AI operating platform.', targetLanguage: 'fr' },
  },
  gmail: { label: 'Read Inbox', action: 'gmail_list', input: { query: '' } },
  drive: { label: 'List Files', action: 'drive_list', input: { query: '' } },
  calendar: { label: 'Upcoming Events', action: 'calendar_list', input: {} },
  docs: {
    label: 'Create Doc',
    action: 'docs_create',
    input: { title: 'NEVUS AI Executive Brief' },
    mutating: true,
  },
  sheets: {
    label: 'Create Sheet',
    action: 'sheets_create',
    input: { title: 'NEVUS AI Metrics Tracker' },
    mutating: true,
  },
  slides: {
    label: 'Create Deck',
    action: 'slides_create',
    input: { title: 'NEVUS AI Strategy Deck' },
    mutating: true,
  },
  maps: {
    label: 'Search Places',
    action: 'maps_places',
    input: { query: 'Googleplex Mountain View' },
  },
  contacts: { label: 'List Contacts', action: 'contacts_list', input: {} },
  tasks: { label: 'List Tasks', action: 'tasks_list', input: {} },
  photos: { label: 'List Albums', action: 'photos_albums', input: {} },
  youtube: {
    label: 'Search Videos',
    action: 'youtube_search',
    input: { query: 'Google Cloud Next keynote' },
  },
  cloud: { label: 'List Projects', action: 'cloud_projects', input: {} },
};

const PRESET_COMMANDS = [
  'Search Google for latest Vercel serverless Node.js 22 features',
  "Translate 'Good morning, your briefing is ready' to Spanish",
  'Check my upcoming Google Calendar events',
  'Check my latest Gmail messages',
  'Prepare for my meeting tomorrow',
];

export function GoogleEcosystemView({
  canEdit,
  oauthNotice = null,
  oauthError = null,
}: GoogleEcosystemViewProps) {
  const [status, setStatus] = useState<GoogleEcosystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(oauthError);
  const [notice, setNotice] = useState<string | null>(oauthNotice);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const [selectedOAuthServices, setSelectedOAuthServices] = useState<GoogleServiceId[]>([
    'gmail',
    'drive',
    'docs',
    'sheets',
    'slides',
    'calendar',
    'contacts',
    'tasks',
  ]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [command, setCommand] = useState('');
  const [runningCommand, setRunningCommand] = useState(false);
  const [commandResult, setCommandResult] = useState<GoogleExecuteResult | null>(null);

  const [pendingConfirmation, setPendingConfirmation] = useState<{
    source: 'command' | 'action';
    command?: string;
    action: string;
    input?: Record<string, unknown>;
    summary: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGoogleStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Google Ecosystem status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (oauthNotice) setNotice(oauthNotice);
  }, [oauthNotice]);

  useEffect(() => {
    if (oauthError) setError(oauthError);
  }, [oauthError]);

  const handleCopyRedirect = async () => {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleConnectOAuth = async () => {
    setError(null);
    setNotice(null);
    setConnecting(true);
    try {
      const res = await requestGoogleOAuthUrl(selectedOAuthServices);
      if (res.configured && res.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
      setNotice(
        res.message ||
          'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel Environment Variables to authorize Google OAuth.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate Google OAuth.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    setNotice(null);
    setDisconnecting(true);
    try {
      const res = await disconnectGoogleAccount();
      setStatus(res.status);
      setNotice('Google Account disconnected and stored tokens cleared.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google Account.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRunCommand = async (rawCmd: string) => {
    if (!rawCmd.trim() || !canEdit || runningCommand) return;
    setError(null);
    setNotice(null);
    setRunningCommand(true);
    try {
      const res = await runGoogleCommand(rawCmd.trim(), false);
      if (res.requiresConfirmation) {
        setPendingConfirmation({
          source: 'command',
          command: rawCmd.trim(),
          action: res.action,
          summary: res.confirmationSummary || `Confirm executing ${res.action}.`,
        });
      } else {
        setCommandResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Ecosystem command failed.');
    } finally {
      setRunningCommand(false);
    }
  };

  const handleRunQuickAction = async (
    action: string,
    input: Record<string, unknown>,
  ) => {
    if (!canEdit || runningCommand) return;
    setError(null);
    setNotice(null);
    setRunningCommand(true);
    try {
      const res = await executeGoogleAction(action, input, false);
      if (res.requiresConfirmation) {
        setPendingConfirmation({
          source: 'action',
          action,
          input,
          summary: res.confirmationSummary || `Confirm executing ${action}.`,
        });
      } else {
        setCommandResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google API execution failed.');
    } finally {
      setRunningCommand(false);
    }
  };

  const handleConfirmPending = async () => {
    if (!pendingConfirmation) return;
    setConfirming(true);
    setError(null);
    try {
      const res =
        pendingConfirmation.source === 'command' && pendingConfirmation.command
          ? await runGoogleCommand(pendingConfirmation.command, true)
          : await executeGoogleAction(
              pendingConfirmation.action,
              pendingConfirmation.input ?? {},
              true,
            );
      setCommandResult(res);
      setPendingConfirmation(null);
      setNotice(`Executed confirmed Google action: ${res.action}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmed Google action failed.');
      setPendingConfirmation(null);
    } finally {
      setConfirming(false);
    }
  };

  const toggleOAuthService = (id: GoogleServiceId) => {
    setSelectedOAuthServices((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const services = status?.services ?? [];
  const connectedCount = services.filter((s) => s.status === 'connected').length;
  const oauthServices = services.filter((s) => s.authType === 'oauth2');
  const categories: Array<GoogleServiceStatusItem['category']> = [
    'Productivity',
    'Intelligence & Search',
    'Location & Media',
    'Cloud & Platform',
  ];

  const getStatusBadge = (item: GoogleServiceStatusItem) => {
    if (item.status === 'connected') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Connected
        </span>
      );
    }
    if (item.status === 'needs_oauth') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/35 px-2 py-0.5 text-[11px] font-medium text-amber-300">
          OAuth Required
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-300">
        API Key Required
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Google Ecosystem Integration
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Official OAuth 2.0 &amp; Google API connectors across Search, Gmail, Drive, Docs,
            Sheets, Slides, Calendar, Maps, Contacts, Tasks, Photos, YouTube, Translate, and Cloud.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-1.5 font-mono text-xs text-slate-300">
            {connectedCount}/{services.length || 14} Active
          </span>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm text-emerald-200"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* OAuth 2.0 Connection & Vercel Redirect URI Card */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Google OAuth 2.0 Connection
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Tokens are AES-256-GCM encrypted server-side per user and persisted across Vercel
                serverless invocations.
              </p>
            </div>
            {status?.oauthConfigured ? (
              <span className="rounded-md border border-emerald-500/40 bg-emerald-950/35 px-2.5 py-1 text-xs font-medium text-emerald-300">
                OAuth Client Ready
              </span>
            ) : (
              <span className="rounded-md border border-amber-500/40 bg-amber-950/35 px-2.5 py-1 text-xs font-medium text-amber-300">
                Needs GOOGLE_CLIENT_ID / SECRET
              </span>
            )}
          </div>

          {status?.connection?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  Connected as {status.connection.googleEmail}
                </p>
                <p className="font-mono text-xs text-slate-400">
                  Source: {status.connection.authSource} ·{' '}
                  {status.connection.grantedScopes.length} granted scopes · Updated{' '}
                  {formatRelativeTime(status.connection.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-950/60 cursor-pointer"
              >
                <Unlink className="h-3.5 w-3.5" />
                <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-800 bg-[#060913] p-3.5 text-xs text-slate-300">
              No active Google OAuth account connected for your workspace yet. Select the services
              you want to authorize below and click{' '}
              <span className="font-semibold text-white">Connect Google Account</span>.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Scopes to Request</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedOAuthServices(oauthServices.map((s) => s.id))
                }
                className="text-blue-400 hover:underline cursor-pointer"
              >
                Select All OAuth Services
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {oauthServices.map((svc) => {
                const checked = selectedOAuthServices.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggleOAuthService(svc.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      checked
                        ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                        : 'border-slate-800 bg-[#060913] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {svc.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={connecting || selectedOAuthServices.length === 0}
              onClick={() => void handleConnectOAuth()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              <span>
                {status?.connection?.connected
                  ? 'Reconnect / Update Scopes'
                  : 'Connect Google Account (OAuth 2.0)'}
              </span>
            </button>
          </div>
        </div>

        {/* Redirect URI & Vercel OAuth Setup Info */}
        <div className="space-y-3 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5">
          <h2 className="font-display text-base font-semibold text-white">
            Vercel OAuth Redirect URI
          </h2>
          <p className="text-xs leading-relaxed text-slate-400">
            Add this callback URL to Authorized Redirect URIs in Google Cloud Console and set{' '}
            <code className="text-slate-200">GOOGLE_OAUTH_REDIRECT_URI</code> in Vercel.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#060913] p-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-blue-300">
              {status?.redirectUri ?? '/api/google/oauth/callback'}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyRedirect()}
              aria-label="Copy OAuth redirect URI"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              {copiedRedirect ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="space-y-1.5 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
            <p className="font-medium text-slate-300">Required Server Env Vars:</p>
            <ul className="space-y-1 font-mono text-[11px] text-slate-400">
              <li>GOOGLE_CLIENT_ID</li>
              <li>GOOGLE_CLIENT_SECRET</li>
              <li>GOOGLE_OAUTH_REDIRECT_URI</li>
              <li>GOOGLE_MAPS_API_KEY (Maps)</li>
              <li>YOUTUBE_API_KEY (Optional fallback)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Natural Language NEVUS Ecosystem Command Runner */}
      <section className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span>NEVUS Natural-Language Google Command</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Route plain-English requests across Google Search, Translate, Calendar, Gmail, Drive,
              Maps, Docs, Sheets, and multi-step meeting briefings. Mutating actions always pause
              for explicit approval.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleRunCommand(command);
          }}
          className="flex flex-col gap-2.5 sm:flex-row"
        >
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!canEdit || runningCommand}
            placeholder="e.g., Search Google for latest AI safety benchmarks, or Prepare for my meeting tomorrow..."
            className="flex-1 rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canEdit || runningCommand || !command.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {runningCommand ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>Execute Command</span>
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {PRESET_COMMANDS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={!canEdit || runningCommand}
              onClick={() => {
                setCommand(preset);
                void handleRunCommand(preset);
              }}
              className="rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1 text-xs text-slate-300 hover:border-blue-500/50 hover:text-white cursor-pointer disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
        </div>

        {commandResult && (
          <div className="space-y-2 rounded-lg border border-slate-800 bg-[#060913] p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-blue-300">
                Action: {commandResult.action} ({commandResult.serviceId})
              </span>
              <button
                type="button"
                onClick={() => setCommandResult(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
              {JSON.stringify(commandResult.data, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* All 14 Google Ecosystem Services */}
      {categories.map((category) => {
        const items = services.filter((s) => s.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <h2 className="font-display text-base font-semibold text-white">{category}</h2>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
              {items.map((svc) => {
                const Icon = SERVICE_ICONS[svc.id] ?? FolderOpen;
                const quick = QUICK_TEST_ACTION[svc.id];
                return (
                  <article
                    key={svc.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-[#060913]">
                            <Icon className="h-4 w-4 text-blue-400" />
                          </div>
                          <h3 className="font-display text-sm font-semibold text-white">
                            {svc.name}
                          </h3>
                        </div>
                        {getStatusBadge(svc)}
                      </div>

                      <p className="text-xs leading-relaxed text-slate-400">{svc.description}</p>
                      <p className="text-[11px] text-slate-300">{svc.detail}</p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-800/70 pt-3">
                      <span className="font-mono text-[10px] text-slate-500">
                        {svc.requiredEnvVars.join(', ')}
                      </span>
                      {quick && canEdit && (
                        <button
                          type="button"
                          disabled={runningCommand}
                          onClick={() => void handleRunQuickAction(quick.action, quick.input)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#060913] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-blue-500/60 hover:text-white cursor-pointer disabled:opacity-50"
                        >
                          <ExternalLink className="h-3 w-3 text-blue-400" />
                          <span>{quick.label}</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Confirmation Gate Modal for Mutating Actions */}
      {pendingConfirmation && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border border-amber-500/40 bg-[#0B1120] p-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Confirm Google Account Action
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {pendingConfirmation.summary}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={confirming}
                onClick={() => setPendingConfirmation(null)}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirming}
                onClick={() => void handleConfirmPending()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer"
              >
                {confirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Approve &amp; Execute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
