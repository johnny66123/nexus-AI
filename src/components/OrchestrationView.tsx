import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { WORKSPACE_LIMITS, getModelLabel } from '../../shared/schema.ts';
import type { Assistant, OrchestrationRun } from '../../shared/schema.ts';
import { fetchOrchestrationRuns, formatRelativeTime, runOrchestration } from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface OrchestrationViewProps {
  assistants: Assistant[];
  canEdit: boolean;
}

export function OrchestrationView({ assistants, canEdit }: OrchestrationViewProps) {
  const [runs, setRuns] = useState<OrchestrationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [objective, setObjective] = useState('');
  const [sharedContext, setSharedContext] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(() =>
    assistants.slice(0, 2).map((a) => a.id),
  );
  const [contextApproved, setContextApproved] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<OrchestrationRun | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchOrchestrationRuns();
        setRuns(data);
        if (data.length > 0) setActiveRun(data[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orchestration history.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= WORKSPACE_LIMITS.maxOrchestrationAgents) return prev;
      return [...prev, id];
    });
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setRunning(true);
    try {
      const result = await runOrchestration({
        objective,
        agentIds: selectedAgentIds,
        sharedContext,
        contextApproved,
      });
      setRuns((prev) => [result, ...prev]);
      setActiveRun(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Multi-agent orchestration failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Multi-Agent Orchestration
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          NEXUS Master AI decomposes complex missions, dispatches specialist agents with approved
          context, handles failure recovery, and synthesizes one unified deliverable.
        </p>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Coordinator Form */}
        <form
          onSubmit={handleRun}
          className="space-y-5 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-5"
        >
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-blue-400" />
            <h2 className="font-display text-base font-semibold text-white">
              Master AI Mission Control
            </h2>
          </div>

          <div className="space-y-2">
            <label htmlFor="orch-objective" className="text-xs font-medium text-slate-300">
              Mission Objective
            </label>
            <textarea
              id="orch-objective"
              rows={3}
              required
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g., Evaluate moving our internal analytics API to edge workers, covering security risks, architecture trade-offs, and rollout messaging."
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">
                Select Specialist Agents ({selectedAgentIds.length}/
                {WORKSPACE_LIMITS.maxOrchestrationAgents})
              </span>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {assistants.map((a) => {
                const checked = selectedAgentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                      checked
                        ? 'border-blue-500/60 bg-blue-950/25 text-white'
                        : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{a.name}</p>
                      <p className="truncate font-mono text-[11px] text-slate-400">
                        {a.purpose} · {getModelLabel(a.model)}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-blue-400 shrink-0">
                      {checked ? 'Selected' : 'Add'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="orch-context" className="text-xs font-medium text-slate-300">
              Shared Task Context (Optional)
            </label>
            <textarea
              id="orch-context"
              rows={2}
              value={sharedContext}
              onChange={(e) => setSharedContext(e.target.value)}
              placeholder="Constraints, SLA targets, or background notes shared across agents..."
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={contextApproved}
              onChange={(e) => setContextApproved(e.target.checked)}
              className="mt-0.5 rounded border-slate-700"
            />
            <span>
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />I approve
              sharing this objective and context between the selected specialist agents.
            </span>
          </label>

          <button
            type="submit"
            disabled={!canEdit || running || selectedAgentIds.length === 0 || !contextApproved}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span>{running ? 'Coordinating Agents...' : 'Run Multi-Agent Mission'}</span>
          </button>
        </form>

        {/* Execution Trace & Synthesized Output */}
        <section className="space-y-4 lg:col-span-7">
          {loading ? (
            <div className="h-72 animate-pulse rounded-xl border border-slate-800 bg-[#0B1120]" />
          ) : !activeRun ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 px-6 py-16 text-center">
              <Network className="h-9 w-9 text-slate-500" />
              <h3 className="mt-3 font-display text-base font-semibold text-white">
                No orchestration runs yet
              </h3>
              <p className="mt-1 max-w-md text-sm text-slate-400">
                Select two or more specialist agents on the left and launch a coordinated mission.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-3">
                  <div>
                    <p className="font-mono text-xs text-slate-400">
                      Run {activeRun.id.slice(0, 12)} · {formatRelativeTime(activeRun.createdAt)} ·{' '}
                      <span
                        className={
                          activeRun.status === 'completed' ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {activeRun.status}
                      </span>
                    </p>
                    <h3 className="mt-1 font-display text-base font-semibold text-white">
                      {activeRun.objective}
                    </h3>
                  </div>
                </div>

                {/* Specialist Steps */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-300">
                    Specialist Handoffs & Recovery Trace
                  </p>
                  {activeRun.steps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="rounded-lg border border-slate-800 bg-[#060913] p-3.5 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-display text-xs font-semibold text-blue-300">
                          Step {step.stepNumber}: {step.agentName}
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-slate-400">
                          {step.status === 'recovered' && (
                            <RefreshCw className="h-3 w-3 text-amber-400" />
                          )}
                          {step.status === 'completed' && (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          )}
                          {step.status} · {step.attempts} attempt(s) · {step.durationMs}ms
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{step.assignedTask}</p>
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-slate-300 hover:text-white">
                          Inspect specialist output
                        </summary>
                        <div className="mt-2 border-t border-slate-800 pt-2">
                          <MarkdownRenderer content={step.output} />
                        </div>
                      </details>
                    </div>
                  ))}
                </div>

                {/* Final Master AI Synthesis */}
                <div className="border-t border-slate-800 pt-4 space-y-2">
                  <h4 className="font-display text-sm font-semibold text-violet-300">
                    NEXUS Master AI Final Synthesis
                  </h4>
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-4">
                    <MarkdownRenderer content={activeRun.finalSynthesis} />
                  </div>
                </div>
              </div>

              {runs.length > 1 && (
                <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-400">Previous Runs</p>
                  <div className="space-y-1">
                    {runs.slice(0, 6).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setActiveRun(r)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                          activeRun.id === r.id
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                        }`}
                      >
                        <span className="truncate">{r.objective}</span>
                        <span className="font-mono tabular-nums text-[11px] shrink-0">
                          {formatRelativeTime(r.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
