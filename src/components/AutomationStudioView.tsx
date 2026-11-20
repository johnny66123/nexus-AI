import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Loader2,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type {
  Assistant,
  AutomationWorkflow,
  WorkflowActionType,
  WorkflowRun,
} from '../../shared/schema.ts';
import {
  approveWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  fetchAutomationData,
  formatRelativeTime,
  rejectWorkflowRun,
  toggleWorkflow,
  triggerWorkflow,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface AutomationStudioViewProps {
  assistants: Assistant[];
  canEdit: boolean;
}

export function AutomationStudioView({ assistants, canEdit }: AutomationStudioViewProps) {
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Builder State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<'manual' | 'schedule'>('manual');
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(60);
  const [conditionKeyword, setConditionKeyword] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [actionType, setActionType] = useState<WorkflowActionType>('run_assistant');
  const [targetAssistantId, setTargetAssistantId] = useState(assistants[0]?.id ?? '');
  const [actionPrompt, setActionPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAutomationData();
        setWorkflows(data.workflows);
        setRuns(data.runs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflows.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setCreating(true);
    try {
      const wf = await createWorkflow({
        name,
        description,
        enabled: true,
        triggerType,
        scheduleIntervalMinutes: triggerType === 'schedule' ? scheduleIntervalMinutes : undefined,
        conditionKeyword: conditionKeyword.trim() || undefined,
        requiresApproval,
        actionType,
        targetAssistantId: actionType === 'run_assistant' ? targetAssistantId : undefined,
        actionPrompt,
      });
      setWorkflows((prev) => [wf, ...prev]);
      setName('');
      setDescription('');
      setActionPrompt('');
      setConditionKeyword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow.');
    } finally {
      setCreating(false);
    }
  };

  const handleTrigger = async (id: string) => {
    setError(null);
    setBusyRunId(id);
    try {
      const run = await triggerWorkflow(id);
      setRuns((prev) => [run, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger failed.');
    } finally {
      setBusyRunId(null);
    }
  };

  const handleApprove = async (runId: string) => {
    setError(null);
    setBusyRunId(runId);
    try {
      const updated = await approveWorkflowRun(runId);
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval execution failed.');
    } finally {
      setBusyRunId(null);
    }
  };

  const handleReject = async (runId: string) => {
    setBusyRunId(runId);
    try {
      const updated = await rejectWorkflowRun(runId);
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } finally {
      setBusyRunId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Automation Studio
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Build trigger-condition-action pipelines, configure schedules, and enforce operator
          approval gates before executing sensitive actions.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Visual Workflow Pipeline Builder */}
      {canEdit && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-blue-400" />
              <h2 className="font-display text-base font-semibold text-white">
                Visual Pipeline Builder
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workflow name (e.g., Weekly Security Digest)"
              className="rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this pipeline automates..."
              className="rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* 3-Node Visual Flow */}
          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-11">
            {/* Node 1: Trigger */}
            <div className="rounded-xl border border-slate-800 bg-[#060913] p-4 space-y-3 lg:col-span-3">
              <p className="font-mono text-xs font-semibold text-blue-400">1. Trigger</p>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as 'manual' | 'schedule')}
                className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-2 text-xs text-white"
              >
                <option value="manual">Manual Trigger</option>
                <option value="schedule">Scheduled Interval</option>
              </select>
              {triggerType === 'schedule' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Every (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={scheduleIntervalMinutes}
                    onChange={(e) => setScheduleIntervalMinutes(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </div>
              )}
            </div>

            <div className="hidden items-center justify-center lg:flex lg:col-span-1">
              <ArrowRight className="h-4 w-4 text-slate-600" />
            </div>

            {/* Node 2: Condition & Security Gate */}
            <div className="rounded-xl border border-slate-800 bg-[#060913] p-4 space-y-3 lg:col-span-3">
              <p className="font-mono text-xs font-semibold text-violet-400">
                2. Condition &amp; Gate
              </p>
              <input
                type="text"
                value={conditionKeyword}
                onChange={(e) => setConditionKeyword(e.target.value)}
                placeholder="Optional keyword condition..."
                className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-2 text-xs text-white placeholder:text-slate-500"
              />
              <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Require human approval before execution</span>
              </label>
            </div>

            <div className="hidden items-center justify-center lg:flex lg:col-span-1">
              <ArrowRight className="h-4 w-4 text-slate-600" />
            </div>

            {/* Node 3: Action */}
            <div className="rounded-xl border border-slate-800 bg-[#060913] p-4 space-y-3 lg:col-span-3">
              <p className="font-mono text-xs font-semibold text-emerald-400">3. Action</p>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as WorkflowActionType)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-2 text-xs text-white"
              >
                <option value="run_assistant">Run AI Assistant</option>
                <option value="run_research">Run Web Research</option>
                <option value="webhook_notify">Format Operational Digest</option>
              </select>
              {actionType === 'run_assistant' && (
                <select
                  value={targetAssistantId}
                  onChange={(e) => setTargetAssistantId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-2 text-xs text-white"
                >
                  {assistants.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="wf-prompt" className="text-xs font-medium text-slate-300">
                Action Prompt / Payload
              </label>
              <input
                id="wf-prompt"
                type="text"
                required
                value={actionPrompt}
                onChange={(e) => setActionPrompt(e.target.value)}
                placeholder="Instruction or research query executed when this workflow triggers..."
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>{creating ? 'Creating...' : 'Save Workflow'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Active Workflows & Execution History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-5">
          <h2 className="font-display text-base font-semibold text-white">
            Configured Workflows ({workflows.length})
          </h2>
          {loading ? (
            <div className="h-40 animate-pulse rounded-xl bg-[#0B1120]" />
          ) : workflows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-6 text-center text-sm text-slate-400">
              No workflows configured yet.
            </div>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-sm font-semibold text-white">
                        {wf.name}
                      </h3>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {wf.triggerType === 'schedule'
                          ? `Every ${wf.scheduleIntervalMinutes}m`
                          : 'Manual'}{' '}
                        · {wf.actionType.replace('_', ' ')} ·{' '}
                        {wf.requiresApproval ? 'Approval gated' : 'Direct'}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={async () => {
                          const updated = await toggleWorkflow(wf.id, !wf.enabled);
                          setWorkflows((prev) =>
                            prev.map((w) => (w.id === updated.id ? updated : w)),
                          );
                        }}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                          wf.enabled
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                            : 'border-slate-700 text-slate-400'
                        }`}
                      >
                        {wf.enabled ? 'Enabled' : 'Paused'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-300">{wf.description}</p>
                  {canEdit && (
                    <div className="flex items-center justify-between border-t border-slate-800/70 pt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteWorkflow(wf.id);
                          setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
                        }}
                        className="text-xs text-slate-400 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="inline h-3.5 w-3.5 mr-1" />
                        Delete
                      </button>
                      <button
                        type="button"
                        disabled={busyRunId === wf.id}
                        onClick={() => void handleTrigger(wf.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/30 cursor-pointer"
                      >
                        {busyRunId === wf.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        <span>Run Now</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 lg:col-span-7">
          <h2 className="font-display text-base font-semibold text-white">
            Execution History &amp; Approvals ({runs.length})
          </h2>
          {runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400">
              Trigger a workflow to inspect execution logs and pending approval gates.
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        {run.workflowName}
                      </h3>
                      <p className="font-mono text-[11px] text-slate-400">
                        {run.triggerSource} · {formatRelativeTime(run.createdAt)} ·{' '}
                        <span
                          className={
                            run.status === 'completed'
                              ? 'text-emerald-400'
                              : run.status === 'awaiting_approval'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }
                        >
                          {run.status.replace('_', ' ')}
                        </span>
                      </p>
                    </div>

                    {canEdit && run.status === 'awaiting_approval' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyRunId === run.id}
                          onClick={() => void handleReject(run.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyRunId === run.id}
                          onClick={() => void handleApprove(run.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 cursor-pointer"
                        >
                          {busyRunId === run.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span>Approve &amp; Run</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {run.status === 'awaiting_approval' && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                      <span>Waiting for operator approval before executing AI/external action.</span>
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3 font-mono text-[11px] text-slate-400 space-y-1">
                    {run.stepLogs.map((log, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <Clock className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>

                  {run.output && (
                    <div className="rounded-lg border border-slate-800 bg-[#060913] p-3.5 text-xs">
                      <MarkdownRenderer content={run.output} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
