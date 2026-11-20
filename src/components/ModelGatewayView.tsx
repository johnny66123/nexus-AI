import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  Sliders,
  Zap,
} from 'lucide-react';
import {
  AI_MODELS,
  GATEWAY_TASK_TYPES,
  getModelLabel,
} from '../../shared/schema.ts';
import type {
  AIModelId,
  AIProviderId,
  GatewayResponse,
  GatewayTaskType,
  ProviderAvailabilityStatus,
  ProviderSettingUpdateInput,
} from '../../shared/schema.ts';
import {
  fetchGatewayAnalytics,
  fetchGatewayProviders,
  formatRelativeTime,
  testGateway,
  updateGatewayProvider,
} from '../lib/api.ts';
import type { GatewayAnalyticsData } from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface ModelGatewayViewProps {
  canEdit: boolean;
}

export function ModelGatewayView({ canEdit }: ModelGatewayViewProps) {
  const [tab, setTab] = useState<'providers' | 'tester' | 'analytics'>('providers');
  const [providers, setProviders] = useState<ProviderAvailabilityStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<AIProviderId, ProviderSettingUpdateInput>>(
    {} as Record<AIProviderId, ProviderSettingUpdateInput>,
  );
  const [analytics, setAnalytics] = useState<GatewayAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<AIProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Gateway Tester State
  const [testPrompt, setTestPrompt] = useState(
    'Compare single-pass intelligent routing vs calling three LLMs simultaneously for latency and cost.',
  );
  const [testSystem, setTestSystem] = useState('');
  const [testProvider, setTestProvider] = useState<'auto' | AIProviderId>('auto');
  const [testModel, setTestModel] = useState<string>('auto');
  const [testTaskType, setTestTaskType] = useState<GatewayTaskType>('analysis');
  const [testAllowFallback, setTestAllowFallback] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GatewayResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerList, analyticsData] = await Promise.all([
        fetchGatewayProviders(),
        fetchGatewayAnalytics(),
      ]);
      setProviders(providerList);
      const nextDrafts = {} as Record<AIProviderId, ProviderSettingUpdateInput>;
      for (const p of providerList) {
        nextDrafts[p.provider] = {
          enabled: p.enabled,
          defaultModel: p.defaultModel,
          priority: p.priority,
          timeoutMs: p.timeoutMs,
          maxRetries: p.maxRetries,
          fallbackEnabled: p.fallbackEnabled,
        };
      }
      setDrafts(nextDrafts);
      setAnalytics(analyticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Model Gateway status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveProvider = async (providerId: AIProviderId) => {
    const draft = drafts[providerId];
    if (!draft || !canEdit) return;
    setSavingProvider(providerId);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateGatewayProvider(providerId, draft);
      setProviders((prev) => prev.map((p) => (p.provider === providerId ? updated : p)));
      setNotice(`Saved ${updated.label} adapter configuration.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider settings.');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || testing) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const response = await testGateway({
        prompt: testPrompt,
        systemInstruction: testSystem.trim() || undefined,
        provider: testProvider,
        model: testModel === 'auto' ? undefined : testModel,
        taskType: testTaskType,
        allowFallback: testAllowFallback,
      });
      setTestResult(response);
      const refreshedAnalytics = await fetchGatewayAnalytics();
      setAnalytics(refreshedAnalytics);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Model Gateway test failed.');
    } finally {
      setTesting(false);
    }
  };

  const availableTestModels =
    testProvider === 'auto'
      ? AI_MODELS
      : AI_MODELS.filter((m) => m.providerId === testProvider);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Unified Model Gateway
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure Google Gemini, Anthropic Claude, and OpenAI adapters, timeouts, retries,
            automatic fallback routing, and inspect real-time model telemetry.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0B1120] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Gateway</span>
        </button>
      </div>

      {/* Totals Strip */}
      {analytics && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Gateway Calls</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {analytics.totals.totalCalls}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Tokens Processed</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {analytics.totals.totalTokens.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Avg Latency</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {analytics.totals.avgLatencyMs}
              <span className="ml-1 text-xs font-normal text-slate-500">ms</span>
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Fallback Recoveries</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {analytics.totals.fallbackCalls}
            </p>
          </div>
        </div>
      )}

      {/* Segmented Navigation */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800/80 bg-[#0B1120] p-1">
        {[
          { id: 'providers', label: 'Provider Adapters & Routing', icon: Sliders },
          { id: 'tester', label: 'Live Gateway Tester', icon: Zap },
          { id: 'analytics', label: 'Performance & Usage Logs', icon: Activity },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: PROVIDER ADAPTERS */}
      {tab === 'providers' && (
        <div className="space-y-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-80 animate-pulse rounded-xl border border-slate-800 bg-[#0B1120]"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {providers.map((prov) => {
                const draft = drafts[prov.provider];
                if (!draft) return null;
                const isSaving = savingProvider === prov.provider;
                return (
                  <section
                    key={prov.provider}
                    className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-5"
                  >
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="font-display text-base font-semibold text-white">
                            {prov.label}
                          </h2>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                            Secret: {prov.envVarName}
                          </p>
                        </div>
                        <span
                          className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium ${
                            prov.configured
                              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                              : 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                          }`}
                        >
                          {prov.configured ? 'Configured' : 'Key Missing'}
                        </span>
                      </div>

                      {!prov.configured && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                          <span>
                            Add <code className="font-mono">{prov.envVarName}</code> in server
                            environment secrets to invoke {prov.label} models. Requests never fall
                            back to fabricated responses.
                          </span>
                        </div>
                      )}

                      <div className="space-y-3">
                        <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-slate-200 cursor-pointer">
                          <span>Adapter Enabled</span>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={draft.enabled}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [prov.provider]: { ...draft, enabled: e.target.checked },
                              }))
                            }
                          />
                        </label>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-300">
                            Default Model
                          </label>
                          <select
                            disabled={!canEdit}
                            value={draft.defaultModel}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [prov.provider]: {
                                  ...draft,
                                  defaultModel: e.target.value as AIModelId,
                                },
                              }))
                            }
                            className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                          >
                            {prov.models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label} ({m.tier})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label className="text-[11px] text-slate-400">Priority (1-10)</label>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              disabled={!canEdit}
                              value={draft.priority}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [prov.provider]: {
                                    ...draft,
                                    priority: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-slate-400">Timeout (ms)</label>
                            <input
                              type="number"
                              min={2000}
                              max={120000}
                              step={1000}
                              disabled={!canEdit}
                              value={draft.timeoutMs}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [prov.provider]: {
                                    ...draft,
                                    timeoutMs: Math.max(
                                      2000,
                                      Math.min(120000, Number(e.target.value) || 30000),
                                    ),
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-slate-400">Retries (0-3)</label>
                            <input
                              type="number"
                              min={0}
                              max={3}
                              disabled={!canEdit}
                              value={draft.maxRetries}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [prov.provider]: {
                                    ...draft,
                                    maxRetries: Math.max(
                                      0,
                                      Math.min(3, Number(e.target.value) || 0),
                                    ),
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                        </div>

                        <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-slate-300 cursor-pointer">
                          <span>Eligible for Automatic Fallback</span>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={draft.fallbackEnabled}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [prov.provider]: { ...draft, fallbackEnabled: e.target.checked },
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>

                    {canEdit && (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleSaveProvider(prov.provider)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600/20 border border-blue-500/40 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-600/30 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>{isSaving ? 'Saving...' : 'Save Adapter Settings'}</span>
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LIVE GATEWAY TESTER */}
      {tab === 'tester' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleRunTest}
            className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-5"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Unified Request Runner
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Execute a live request through the Model Gateway to verify provider routing,
                latency, token usage, and fallback behavior.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="gw-provider" className="text-xs font-medium text-slate-300">
                  Target Provider
                </label>
                <select
                  id="gw-provider"
                  value={testProvider}
                  onChange={(e) => {
                    const next = e.target.value as 'auto' | AIProviderId;
                    setTestProvider(next);
                    setTestModel('auto');
                  }}
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">Auto (Priority + Health)</option>
                  <option value="google">Google Gemini</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="gw-model" className="text-xs font-medium text-slate-300">
                  Model Override
                </label>
                <select
                  id="gw-model"
                  value={testModel}
                  onChange={(e) => setTestModel(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">Use Provider Default</option>
                  {availableTestModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="gw-task-type" className="text-xs font-medium text-slate-300">
                Task Classification Tag
              </label>
              <select
                id="gw-task-type"
                value={testTaskType}
                onChange={(e) => setTestTaskType(e.target.value as GatewayTaskType)}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                {GATEWAY_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="gw-system" className="text-xs font-medium text-slate-300">
                System Instruction (Optional)
              </label>
              <input
                id="gw-system"
                type="text"
                value={testSystem}
                onChange={(e) => setTestSystem(e.target.value)}
                placeholder="e.g., Respond as a concise cloud systems architect."
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="gw-prompt" className="text-xs font-medium text-slate-300">
                Prompt
              </label>
              <textarea
                id="gw-prompt"
                rows={4}
                required
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-slate-300 cursor-pointer">
              <span>Allow Automatic Provider Fallback on Error</span>
              <input
                type="checkbox"
                checked={testAllowFallback}
                onChange={(e) => setTestAllowFallback(e.target.checked)}
              />
            </label>

            <button
              type="submit"
              disabled={!canEdit || testing || testPrompt.trim().length < 2}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
            >
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Executing Gateway Request...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Invoke Model Gateway</span>
                </>
              )}
            </button>
          </form>

          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-white">
                Unified Gateway Response
              </h2>
              {testResult && (
                <span className="rounded-md border border-blue-500/40 bg-blue-950/30 px-2.5 py-1 font-mono text-[11px] text-blue-300">
                  {testResult.provider} · {getModelLabel(testResult.model as AIModelId)}
                </span>
              )}
            </div>

            {testError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <span>{testError}</span>
              </div>
            )}

            {!testResult && !testError && (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#060913]/60 p-8 text-center">
                <Cpu className="h-8 w-8 text-slate-600" />
                <p className="mt-3 text-sm text-slate-400">
                  Submit a test prompt to inspect the normalized GatewayResponse, token counts, and
                  provider attempt trace.
                </p>
              </div>
            )}

            {testResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="text-[11px] text-slate-500">Latency</p>
                    <p className="font-mono text-sm font-semibold text-white tabular-nums">
                      {testResult.latencyMs}ms
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="text-[11px] text-slate-500">Input Tokens</p>
                    <p className="font-mono text-sm font-semibold text-white tabular-nums">
                      {testResult.inputTokens}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="text-[11px] text-slate-500">Output Tokens</p>
                    <p className="font-mono text-sm font-semibold text-white tabular-nums">
                      {testResult.outputTokens}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="text-[11px] text-slate-500">Fallback Used</p>
                    <p
                      className={`font-mono text-sm font-semibold ${
                        testResult.fallbackUsed ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {testResult.fallbackUsed ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#060913] p-4">
                  <MarkdownRenderer content={testResult.text} />
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-400">Attempt Trace</p>
                  <div className="space-y-1.5">
                    {testResult.attemptedProviders.map((att, idx) => (
                      <div
                        key={`${att.provider}-${att.model}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs"
                      >
                        <span className="font-mono text-slate-200">
                          {idx + 1}. {att.provider} / {att.model}
                        </span>
                        <span
                          className={`font-mono ${
                            att.success ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {att.success
                            ? `OK (${att.latencyMs}ms)`
                            : `FAILED (${att.latencyMs}ms): ${att.error ?? 'Error'}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PERFORMANCE & USAGE ANALYTICS */}
      {tab === 'analytics' && analytics && (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-white">
              Model Performance Monitoring
            </h2>
            {analytics.metrics.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400">
                No model invocations recorded for your workspace yet. Run a chat, Master AI task,
                or Gateway test to populate metrics.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-[#0B1120]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-[#080D1A] text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Provider / Model</th>
                      <th className="px-4 py-3 font-medium text-right">Calls</th>
                      <th className="px-4 py-3 font-medium text-right">Success Rate</th>
                      <th className="px-4 py-3 font-medium text-right">Avg Latency</th>
                      <th className="px-4 py-3 font-medium text-right">P95 Latency</th>
                      <th className="px-4 py-3 font-medium text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {analytics.metrics.map((m) => (
                      <tr key={`${m.provider}-${m.model}`} className="hover:bg-slate-800/20">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">{m.model}</p>
                          <p className="font-mono text-[11px] text-slate-500">{m.provider}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                          {m.totalCalls}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-300">
                          {m.successRate}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                          {m.avgLatencyMs}ms
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                          {m.p95LatencyMs}ms
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                          {m.totalTokens.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-white">
              Recent Usage Records
            </h2>
            {analytics.records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400">
                No usage records yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-[#0B1120]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-[#080D1A] text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Provider / Model</th>
                      <th className="px-4 py-3 font-medium">Task</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {analytics.records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-800/20">
                        <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                          {formatRelativeTime(rec.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">{rec.model}</span>
                          <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                            ({rec.provider})
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300">{rec.taskType}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-mono ${
                              rec.status === 'success'
                                ? 'text-emerald-400'
                                : rec.status === 'fallback_success'
                                  ? 'text-amber-300'
                                  : 'text-rose-400'
                            }`}
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                          {rec.totalTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
                          {rec.latencyMs}ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
