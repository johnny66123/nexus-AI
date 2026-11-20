import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  History,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AI_MODELS, getProviderForModel } from '../../shared/schema.ts';
import type {
  AIProviderId,
  AgentTask,
  KnowledgeDocument,
  MasterExecutionResult,
  SpecialistAgent,
  SpecialistAgentUpdateInput,
} from '../../shared/schema.ts';
import {
  dispatchAgentTask,
  executeMasterRequest,
  fetchAgentTasks,
  fetchDocuments,
  fetchMasterRuns,
  fetchSpecialistAgents,
  formatRelativeTime,
  updateSpecialistAgent,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface AgentsMasterViewProps {
  canEdit: boolean;
  selectedModelOverride?: string;
}

export function AgentsMasterView({
  canEdit,
  selectedModelOverride = 'auto',
}: AgentsMasterViewProps) {
  const [tab, setTab] = useState<'master' | 'agents'>('master');
  const [agents, setAgents] = useState<SpecialistAgent[]>([]);
  const [masterRuns, setMasterRuns] = useState<MasterExecutionResult[]>([]);
  const [activeRun, setActiveRun] = useState<MasterExecutionResult | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Master Intelligence Request Form
  const [masterRequest, setMasterRequest] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [externalRequested, setExternalRequested] = useState(false);
  const [approvalGranted, setApprovalGranted] = useState(false);
  const [executingMaster, setExecutingMaster] = useState(false);

  // Specialist Agent Manager State
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<SpecialistAgentUpdateInput | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [savingAgent, setSavingAgent] = useState(false);
  const [directPrompt, setDirectPrompt] = useState('');
  const [directExternal, setDirectExternal] = useState(false);
  const [directApproved, setDirectApproved] = useState(false);
  const [dispatchingTask, setDispatchingTask] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentData, runList, docList] = await Promise.all([
        fetchSpecialistAgents(),
        fetchMasterRuns(),
        fetchDocuments(),
      ]);
      setAgents(agentData.agents);
      setMasterRuns(runList);
      setDocuments(docList);
      setActiveRun((prev) => prev ?? runList[0] ?? null);
      if (agentData.agents.length > 0) {
        setSelectedAgentId((prev) => prev ?? agentData.agents[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Master Intelligence & Agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null;

  useEffect(() => {
    if (!selectedAgent) return;
    setAgentDraft({
      name: selectedAgent.name,
      description: selectedAgent.description,
      instructions: selectedAgent.instructions,
      preferredProvider: selectedAgent.preferredProvider,
      preferredModel: selectedAgent.preferredModel,
      permissions: { ...selectedAgent.permissions },
      enabled: selectedAgent.enabled,
    });
    void fetchAgentTasks(selectedAgent.id)
      .then((res) => setAgentTasks(res.tasks))
      .catch(() => setAgentTasks([]));
  }, [selectedAgent]);

  const resolvedHeaderProvider: 'auto' | AIProviderId =
    selectedModelOverride && selectedModelOverride !== 'auto'
      ? getProviderForModel(selectedModelOverride)
      : 'auto';

  const handleExecuteMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || executingMaster || masterRequest.trim().length < 4) return;
    setExecutingMaster(true);
    setError(null);
    try {
      const run = await executeMasterRequest({
        request: masterRequest,
        preferredProvider: resolvedHeaderProvider,
        preferredModel: selectedModelOverride !== 'auto' ? selectedModelOverride : undefined,
        agentIds: selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
        documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined,
        externalActionRequested: externalRequested,
        approvalGranted,
      });
      setActiveRun(run);
      setMasterRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      if (run.status === 'completed') {
        setMasterRequest('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master Intelligence execution failed.');
    } finally {
      setExecutingMaster(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!selectedAgent || !agentDraft || !canEdit) return;
    setSavingAgent(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateSpecialistAgent(selectedAgent.id, agentDraft);
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setNotice(`Saved configuration for ${updated.name}.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update specialist agent.');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleDispatchTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !canEdit || dispatchingTask || directPrompt.trim().length < 4) return;
    setDispatchingTask(true);
    setError(null);
    try {
      const task = await dispatchAgentTask(selectedAgent.id, {
        inputPrompt: directPrompt,
        preferredProvider: resolvedHeaderProvider,
        preferredModel: selectedModelOverride !== 'auto' ? selectedModelOverride : undefined,
        externalActionRequested: directExternal,
        approvalGranted: directApproved,
      });
      setAgentTasks((prev) => [task, ...prev]);
      if (task.status === 'completed') {
        setDirectPrompt('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute specialist task.');
    } finally {
      setDispatchingTask(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            NEXUS Master Intelligence &amp; Specialist Agents
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Intelligent single-path task classification, dynamic model selection, approval-gated
            delegation, and configurable per-user specialist agents.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-1.5 font-mono text-xs text-slate-300 shrink-0">
          Routing:{' '}
          <span className="text-blue-300">
            {selectedModelOverride === 'auto' ? 'Auto (Master AI)' : selectedModelOverride}
          </span>
        </div>
      </div>

      {/* Segmented Navigation */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800/80 bg-[#0B1120] p-1">
        <button
          type="button"
          onClick={() => setTab('master')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            tab === 'master' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>Master Intelligence Console</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('agents')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            tab === 'agents' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bot className="h-3.5 w-3.5" />
          <span>Specialist Agents ({agents.length})</span>
        </button>
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

      {loading ? (
        <div className="h-72 animate-pulse rounded-xl border border-slate-800 bg-[#0B1120]" />
      ) : tab === 'master' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Master Request Composer + Recent Runs */}
          <div className="space-y-5 lg:col-span-5">
            <form
              onSubmit={handleExecuteMaster}
              className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5"
            >
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Submit Master Request
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Simple requests execute directly on the single best model. Multi-domain objectives
                  plan &amp; delegate across Specialist Agents automatically.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="master-req" className="text-xs font-medium text-slate-300">
                  Objective or Question
                </label>
                <textarea
                  id="master-req"
                  rows={4}
                  required
                  value={masterRequest}
                  onChange={(e) => setMasterRequest(e.target.value)}
                  placeholder="Describe your task (e.g., Audit a rate-limiter architecture, write TypeScript tests, and summarize security risks)..."
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {agents.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">
                    Optional Agent Scope ({selectedAgentIds.length === 0 ? 'Auto-Select' : `${selectedAgentIds.length} pinned`})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {agents.map((ag) => {
                      const active = selectedAgentIds.includes(ag.id);
                      return (
                        <button
                          key={ag.id}
                          type="button"
                          onClick={() =>
                            setSelectedAgentIds((prev) =>
                              prev.includes(ag.id)
                                ? prev.filter((id) => id !== ag.id)
                                : [...prev, ag.id],
                            )
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                            active
                              ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                              : 'border-slate-800 bg-[#060913] text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {ag.name.replace(' Agent', '')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {documents.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">
                    Attach Knowledge Docs ({selectedDocIds.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {documents.slice(0, 6).map((d) => {
                      const active = selectedDocIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() =>
                            setSelectedDocIds((prev) =>
                              prev.includes(d.id)
                                ? prev.filter((id) => id !== d.id)
                                : [...prev, d.id],
                            )
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
                            active
                              ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                              : 'border-slate-800 bg-[#060913] text-slate-400'
                          }`}
                        >
                          {d.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs">
                <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                  <span>Request involves external / sensitive actions</span>
                  <input
                    type="checkbox"
                    checked={externalRequested}
                    onChange={(e) => setExternalRequested(e.target.checked)}
                  />
                </label>
                {externalRequested && (
                  <label className="flex items-center justify-between text-emerald-300 cursor-pointer">
                    <span>Grant explicit operator approval</span>
                    <input
                      type="checkbox"
                      checked={approvalGranted}
                      onChange={(e) => setApprovalGranted(e.target.checked)}
                    />
                  </label>
                )}
              </div>

              <button
                type="submit"
                disabled={!canEdit || executingMaster || masterRequest.trim().length < 4}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
              >
                {executingMaster ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Routing &amp; Executing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Execute with Master AI</span>
                  </>
                )}
              </button>
            </form>

            {/* Recent Master Runs */}
            <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <History className="h-3.5 w-3.5 text-blue-400" />
                <span>Recent Master Runs ({masterRuns.length})</span>
              </div>
              {masterRuns.length === 0 ? (
                <p className="text-xs text-slate-500">No Master Intelligence runs yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {masterRuns.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setActiveRun(run)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                        activeRun?.id === run.id
                          ? 'border-blue-500/50 bg-blue-950/25'
                          : 'border-slate-800 bg-[#060913] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono text-blue-300">
                          {run.classification} · {run.routing.selectedModel}
                        </span>
                        <span
                          className={`font-mono ${
                            run.status === 'completed'
                              ? 'text-emerald-400'
                              : run.status === 'awaiting_approval'
                                ? 'text-amber-300'
                                : 'text-rose-400'
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-200">{run.request}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Active Master Execution Result */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-7 space-y-5">
            {!activeRun ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#060913]/60 p-8 text-center">
                <Cpu className="h-9 w-9 text-slate-600" />
                <h2 className="mt-3 font-display text-base font-semibold text-white">
                  No Master Run Selected
                </h2>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  Submit a request on the left to watch NEXUS Master AI classify the task, pick the
                  single optimal provider/model, delegate across specialists, and synthesize results.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md border border-blue-500/40 bg-blue-950/30 px-2 py-0.5 font-mono text-blue-300">
                        {activeRun.routing.taskType} ({activeRun.routing.complexity})
                      </span>
                      <span className="rounded-md border border-violet-500/40 bg-violet-950/30 px-2 py-0.5 font-mono text-violet-300">
                        {activeRun.routing.selectedProvider} / {activeRun.routing.selectedModel}
                      </span>
                      {activeRun.routing.avoidedUnnecessaryMultiModel && (
                        <span className="rounded-md border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 font-mono text-emerald-300">
                          Single-Path Optimized
                        </span>
                      )}
                    </div>
                    <h2 className="mt-2 font-display text-base font-semibold text-white">
                      {activeRun.request}
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">{activeRun.routing.rationale}</p>
                  </div>

                  <div className="text-right font-mono text-xs text-slate-400 tabular-nums">
                    <p>{activeRun.totalTokens.toLocaleString()} tokens</p>
                    <p>{activeRun.totalLatencyMs}ms</p>
                  </div>
                </div>

                {activeRun.status === 'awaiting_approval' && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/25 p-4 text-xs text-amber-200">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div>
                      <p className="font-semibold">Approval Gate Triggered</p>
                      <p className="mt-1">
                        This request flagged external action requirements on a guarded specialist.
                        Check &ldquo;Grant explicit operator approval&rdquo; and re-run to execute.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-300">
                    Task Plan ({activeRun.steps.length} step{activeRun.steps.length === 1 ? '' : 's'})
                  </p>
                  <p className="text-xs text-slate-400">{activeRun.planSummary}</p>
                  <div className="space-y-2">
                    {activeRun.steps.map((step) => (
                      <div
                        key={step.taskId}
                        className="rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-white">
                            {step.stepNumber}. {step.agentName}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {step.providerUsed ? `${step.providerUsed}/${step.modelUsed}` : 'gated'} ·{' '}
                            <span
                              className={
                                step.status === 'completed'
                                  ? 'text-emerald-400'
                                  : step.status === 'awaiting_approval'
                                    ? 'text-amber-300'
                                    : 'text-rose-400'
                              }
                            >
                              {step.status}
                            </span>
                          </span>
                        </div>
                        <p className="text-slate-400">{step.objective}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-300">Combined Master Output</p>
                  <div className="rounded-xl border border-slate-800 bg-[#060913] p-4">
                    <MarkdownRenderer content={activeRun.combinedResponse} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* TAB 2: SPECIALIST AGENTS MANAGER & TASK HISTORY */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Agent Directory Sidebar */}
          <div className="space-y-2 lg:col-span-4">
            {agents.map((ag) => (
              <button
                key={ag.id}
                type="button"
                onClick={() => setSelectedAgentId(ag.id)}
                className={`w-full rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                  selectedAgent?.id === ag.id
                    ? 'border-blue-500/60 bg-blue-950/25'
                    : 'border-slate-800/80 bg-[#0B1120] hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-white">{ag.name}</span>
                  <span
                    className={`font-mono text-[11px] ${
                      ag.enabled ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {ag.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{ag.description}</p>
                <p className="mt-2 font-mono text-[11px] text-blue-300">
                  {ag.preferredProvider} / {ag.preferredModel}
                </p>
              </button>
            ))}
          </div>

          {/* Selected Agent Config + Direct Dispatch + Task History */}
          {selectedAgent && agentDraft && (
            <div className="space-y-6 lg:col-span-8">
              {/* Configuration Card */}
              <section className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-white">
                      {selectedAgent.name} Settings
                    </h2>
                    <p className="font-mono text-[11px] text-slate-500">
                      Role Key: {selectedAgent.roleKey}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={agentDraft.enabled}
                      onChange={(e) =>
                        setAgentDraft({ ...agentDraft, enabled: e.target.checked })
                      }
                    />
                    <span>Enabled</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Display Name</label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={agentDraft.name}
                      onChange={(e) => setAgentDraft({ ...agentDraft, name: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Preferred Model</label>
                    <select
                      disabled={!canEdit}
                      value={agentDraft.preferredModel}
                      onChange={(e) => {
                        const model = e.target.value;
                        const provider =
                          model === 'auto' ? 'auto' : getProviderForModel(model);
                        setAgentDraft({
                          ...agentDraft,
                          preferredModel: model,
                          preferredProvider: provider,
                        });
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                    >
                      <option value="auto">Auto (Master AI Chooses)</option>
                      {AI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.provider})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">System Instructions</label>
                  <textarea
                    rows={3}
                    disabled={!canEdit}
                    value={agentDraft.instructions}
                    onChange={(e) =>
                      setAgentDraft({ ...agentDraft, instructions: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { key: 'canWebSearch', label: 'Allow Web Search Grounding' },
                    { key: 'canReadKnowledge', label: 'Allow Knowledge Centre Context' },
                    { key: 'canExecuteCode', label: 'Allow Sandboxed Code Tasks' },
                    { key: 'requiresApprovalForExternal', label: 'Require External Action Approval' },
                  ].map((perm) => {
                    const k = perm.key as keyof SpecialistAgentUpdateInput['permissions'];
                    return (
                      <label
                        key={perm.key}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-slate-300 cursor-pointer"
                      >
                        <span>{perm.label}</span>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={agentDraft.permissions[k]}
                          onChange={(e) =>
                            setAgentDraft({
                              ...agentDraft,
                              permissions: {
                                ...agentDraft.permissions,
                                [k]: e.target.checked,
                              },
                            })
                          }
                        />
                      </label>
                    );
                  })}
                </div>

                {canEdit && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={savingAgent}
                      onClick={() => void handleSaveAgent()}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                    >
                      {savingAgent ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      <span>{savingAgent ? 'Saving...' : 'Save Agent Configuration'}</span>
                    </button>
                  </div>
                )}
              </section>

              {/* Direct Task Dispatch */}
              {canEdit && (
                <form
                  onSubmit={handleDispatchTask}
                  className="space-y-3 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5"
                >
                  <h3 className="font-display text-sm font-semibold text-white">
                    Assign Direct Task to {selectedAgent.name}
                  </h3>
                  <textarea
                    rows={3}
                    required
                    value={directPrompt}
                    onChange={(e) => setDirectPrompt(e.target.value)}
                    placeholder={`Enter a task for ${selectedAgent.name}...`}
                    className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directExternal}
                          onChange={(e) => setDirectExternal(e.target.checked)}
                        />
                        <span>External action</span>
                      </label>
                      {directExternal && (
                        <label className="flex items-center gap-1.5 text-emerald-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={directApproved}
                            onChange={(e) => setDirectApproved(e.target.checked)}
                          />
                          <span>Approve external action</span>
                        </label>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={dispatchingTask || directPrompt.trim().length < 4}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-45 cursor-pointer"
                    >
                      {dispatchingTask ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      <span>Run Agent Task</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Task History */}
              <section className="space-y-3 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-400" />
                  <h3 className="font-display text-sm font-semibold text-white">
                    Agent Task History ({agentTasks.length})
                  </h3>
                </div>
                {agentTasks.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No tasks executed by {selectedAgent.name} yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {agentTasks.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-xl border border-slate-800 bg-[#060913] p-4 space-y-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-white">{t.title}</span>
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span
                              className={
                                t.status === 'completed'
                                  ? 'text-emerald-400'
                                  : t.status === 'awaiting_approval'
                                    ? 'text-amber-300'
                                    : 'text-rose-400'
                              }
                            >
                              {t.status}
                            </span>
                            {t.modelUsed && <span className="text-blue-300">{t.modelUsed}</span>}
                            <span className="text-slate-500 tabular-nums">
                              {t.tokensUsed} tok · {t.latencyMs}ms · {formatRelativeTime(t.createdAt)}
                            </span>
                          </div>
                        </div>
                        {t.output && (
                          <div className="border-t border-slate-800/80 pt-2">
                            <MarkdownRenderer content={t.output} />
                          </div>
                        )}
                        {t.errorMessage && (
                          <p className="text-rose-300">Error: {t.errorMessage}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
