import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Download,
  Shield,
  Upload,
  Users,
} from 'lucide-react';
import { USER_ROLES } from '../../shared/schema.ts';
import type { AuthUser, UserRole } from '../../shared/schema.ts';
import {
  exportAdminBackup,
  fetchAdminDashboard,
  formatRelativeTime,
  restoreAdminBackup,
  updateAdminUser,
} from '../lib/api.ts';
import type { AdminDashboardData } from '../lib/api.ts';

interface AdminViewProps {
  currentUser: AuthUser;
  onWorkspaceRestored: () => Promise<void>;
}

export function AdminView({ currentUser, onWorkspaceRestored }: AdminViewProps) {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'users' | 'usage' | 'audit' | 'errors'>('users');
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchAdminDashboard();
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Admin access required.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUserUpdate = async (
    userId: string,
    updates: { role?: UserRole; status?: 'active' | 'suspended' },
  ) => {
    setError(null);
    try {
      const updated = await updateAdminUser(userId, updates);
      setData((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((u) => (u.id === updated.id ? updated : u)),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  const handleDownloadBackup = async () => {
    setError(null);
    try {
      const backup = await exportAdminBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage('Full workspace backup exported.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup export failed.');
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setStatusMessage(null);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await restoreAdminBackup(parsed);
      await onWorkspaceRestored();
      setStatusMessage(`Restored ${res.restoredCount} assistant configuration(s) from backup.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup restore failed.');
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl h-96 animate-pulse rounded-xl bg-[#0B1120]" />;
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-rose-500/40 bg-rose-950/30 p-6 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Administration &amp; Security
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage RBAC permissions, monitor API token usage and errors, inspect audit logs, and
            back up or restore workspace state.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleRestoreFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Restore Backup</span>
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadBackup()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Backup</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Analytics Summary */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
          <p className="text-xs text-slate-400">API Calls Logged</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
            {data.analytics.totalApiCalls}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
          <p className="text-xs text-slate-400">Est. Tokens Processed</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
            {data.analytics.totalEstimatedTokens}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
          <p className="text-xs text-slate-400">Avg. Model Latency</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
            {data.analytics.avgLatencyMs}ms
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
          <p className="text-xs text-slate-400">Recorded Errors</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
            {data.analytics.counts.errors}
          </p>
        </div>
      </section>

      {/* Admin Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-[#0B1120] p-1">
        {[
          { id: 'users', label: `Users & Permissions (${data.users.length})`, icon: Users },
          { id: 'usage', label: `API Usage (${data.apiUsage.length})`, icon: Activity },
          { id: 'audit', label: `Audit Logs (${data.auditLogs.length})`, icon: Shield },
          { id: 'errors', label: `Error Monitor (${data.errorLogs.length})`, icon: AlertCircle },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as 'users' | 'usage' | 'audit' | 'errors')}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-[#0B1120]">
        {tab === 'users' && (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/20">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{u.displayName}</p>
                    <p className="font-mono text-[11px] text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={u.id === currentUser.id}
                      onChange={(e) =>
                        void handleUserUpdate(u.id, { role: e.target.value as UserRole })
                      }
                      className="rounded border border-slate-800 bg-[#060913] px-2 py-1 text-xs text-white disabled:opacity-60"
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={u.id === currentUser.id}
                      onClick={() =>
                        void handleUserUpdate(u.id, {
                          status: u.status === 'active' ? 'suspended' : 'active',
                        })
                      }
                      className={`rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 cursor-pointer ${
                        u.status === 'active'
                          ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                      }`}
                    >
                      {u.status}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                    {formatRelativeTime(u.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'usage' && (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium text-right">Status</th>
                <th className="px-4 py-3 font-medium text-right">Latency</th>
                <th className="px-4 py-3 font-medium text-right">Est. Tokens</th>
                <th className="px-4 py-3 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {data.apiUsage.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-sans text-slate-500">
                    No AI API requests logged yet.
                  </td>
                </tr>
              ) : (
                data.apiUsage.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 text-slate-200">{row.endpoint}</td>
                    <td className="px-4 py-2.5 text-blue-300">{row.model}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{row.statusCode}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{row.latencyMs}ms</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{row.estimatedTokens}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {formatRelativeTime(row.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {tab === 'audit' && (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 font-mono text-blue-300">{log.action}</td>
                  <td className="px-4 py-2.5 text-slate-300">{log.userEmail}</td>
                  <td className="px-4 py-2.5 text-slate-300">{log.details}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-500">
                    {formatRelativeTime(log.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'errors' && (
          <div className="divide-y divide-slate-800/70">
            {data.errorLogs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">
                No runtime errors recorded.
              </p>
            ) : (
              data.errorLogs.map((errLog) => (
                <div key={errLog.id} className="flex items-start justify-between gap-4 px-4 py-3 text-xs">
                  <div>
                    <p className="font-mono text-rose-300">
                      {errLog.source} · HTTP {errLog.statusCode}
                    </p>
                    <p className="mt-0.5 text-slate-300">{errLog.message}</p>
                  </div>
                  <span className="font-mono tabular-nums text-slate-500 shrink-0">
                    {formatRelativeTime(errLog.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
