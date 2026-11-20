import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Code2,
  FolderGit2,
  Loader2,
  Play,
  Save,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { LabExecutionResult } from '../../shared/schema.ts';
import {
  browseGithubRepo,
  executeLabCode,
  fetchLabWorkspace,
  runLabAiAssist,
  saveLabWorkspace,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface DevelopmentLabViewProps {
  canEdit: boolean;
  githubTokenConfigured: boolean;
}

export function DevelopmentLabView({
  canEdit,
  githubTokenConfigured,
}: DevelopmentLabViewProps) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('Sandbox Workspace');
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [execResult, setExecResult] = useState<LabExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AI Coding Assistant
  const [aiMode, setAiMode] = useState<'generate' | 'debug' | 'write_tests'>('generate');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [extractedCode, setExtractedCode] = useState<string | null>(null);

  // GitHub Browser
  const [repoSlug, setRepoSlug] = useState('expressjs/express');
  const [repoPath, setRepoPath] = useState('');
  const [ghEntries, setGhEntries] = useState<
    Array<{ name: string; path: string; type: string; size: number }>
  >([]);
  const [ghLoading, setGhLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const ws = await fetchLabWorkspace();
        setWorkspaceId(ws.id);
        setName(ws.name);
        setCode(ws.code);
        setTestCode(ws.testCode);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Development Lab.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!canEdit || !workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      await saveLabWorkspace({ id: workspaceId, name, code, testCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace.');
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    if (!canEdit) return;
    setRunning(true);
    setError(null);
    try {
      if (workspaceId) {
        await saveLabWorkspace({ id: workspaceId, name, code, testCode });
      }
      const result = await executeLabCode({ code, testCode, timeoutMs: 1000 });
      setExecResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleAiAssist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await runLabAiAssist({
        mode: aiMode,
        prompt: aiPrompt,
        code,
        errorOutput: execResult?.error ?? '',
      });
      setAiReply(res.reply);
      setExtractedCode(res.extractedCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI coding assist failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleBrowseGithub = async (targetPath = '') => {
    setGhLoading(true);
    setError(null);
    try {
      const res = await browseGithubRepo(repoSlug, targetPath);
      if (res.type === 'dir') {
        setGhEntries(res.entries);
        setRepoPath(targetPath);
      } else {
        setCode(res.content);
        setName(`GitHub: ${res.name}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub request failed.');
    } finally {
      setGhLoading(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl h-96 animate-pulse rounded-xl bg-[#0B1120]" />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            AI Development Lab
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Sandboxed JavaScript VM (1,000ms CPU timeout, no network/fs/process access), unit test
            runner, AI code assistant, and GitHub file inspector.
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExecute()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>Run Sandbox & Tests</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Editors & Execution Console */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-blue-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Workspace name"
                  className="bg-transparent font-display text-sm font-semibold text-white focus:outline-none"
                />
              </div>
              <span className="font-mono text-[11px] text-slate-500">Node VM · Strict Mode</span>
            </div>

            <textarea
              rows={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              aria-label="Code editor"
              className="w-full rounded-lg border border-slate-800 bg-[#050811] p-3.5 font-mono text-[13px] leading-relaxed text-slate-100 focus:border-blue-500 focus:outline-none"
            />

            <div className="space-y-1.5">
              <label htmlFor="lab-tests" className="text-xs font-medium text-slate-300">
                Unit Test Assertions (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.throws`)
              </label>
              <textarea
                id="lab-tests"
                rows={4}
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-800 bg-[#050811] p-3 font-mono text-[13px] leading-relaxed text-emerald-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Sandbox Output */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Terminal className="h-4 w-4 text-violet-400" />
                <span>Sandbox Output</span>
              </div>
              {execResult && (
                <span className="font-mono text-xs tabular-nums text-slate-400">
                  {execResult.durationMs}ms ·{' '}
                  <span className={execResult.passed ? 'text-emerald-400' : 'text-rose-400'}>
                    {execResult.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </span>
              )}
            </div>

            {!execResult ? (
              <p className="text-xs text-slate-500">
                Click &ldquo;Run Sandbox &amp; Tests&rdquo; to execute code in the isolated VM.
              </p>
            ) : (
              <div className="space-y-3 font-mono text-xs">
                {execResult.error && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-950/35 p-3 text-rose-200">
                    Runtime Error: {execResult.error}
                  </div>
                )}

                {execResult.stdout.length > 0 && (
                  <div className="rounded-lg border border-slate-800 bg-[#050811] p-3 text-slate-300">
                    {execResult.stdout.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}

                {execResult.testResults.length > 0 && (
                  <div className="space-y-1.5">
                    {execResult.testResults.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-lg border border-slate-800 bg-[#060913] px-3 py-2"
                      >
                        {t.passed ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                        )}
                        <div className="min-w-0">
                          <p className="text-slate-200">{t.name}</p>
                          {t.error && <p className="text-rose-300">{t.error}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: AI Coding Assistant & GitHub Inspector */}
        <div className="space-y-4 lg:col-span-5">
          <form
            onSubmit={handleAiAssist}
            className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                AI Coding & Debugging Assistant
              </h2>
            </div>

            <div className="flex gap-1 rounded-lg border border-slate-800 bg-[#060913] p-1">
              {[
                { id: 'generate', label: 'Generate' },
                { id: 'debug', label: 'Debug' },
                { id: 'write_tests', label: 'Write Tests' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAiMode(m.id as 'generate' | 'debug' | 'write_tests')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium cursor-pointer ${
                    aiMode === m.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <textarea
              rows={2}
              required
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={
                aiMode === 'debug'
                  ? 'Describe the unexpected behavior...'
                  : aiMode === 'write_tests'
                    ? 'What edge cases should unit tests verify?'
                    : 'Describe the function or algorithm to generate...'
              }
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={!canEdit || aiLoading || aiPrompt.trim().length < 4}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-45 transition-colors cursor-pointer"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
              <span>{aiLoading ? 'Analyzing...' : 'Run AI Assistant'}</span>
            </button>

            {aiReply && (
              <div className="space-y-3 border-t border-slate-800 pt-3">
                {extractedCode && (
                  <button
                    type="button"
                    onClick={() => {
                      if (aiMode === 'write_tests') {
                        setTestCode(extractedCode);
                      } else {
                        setCode(extractedCode);
                      }
                    }}
                    className="w-full rounded-lg border border-blue-500/40 bg-blue-600/15 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25 cursor-pointer"
                  >
                    Apply Extracted Code to {aiMode === 'write_tests' ? 'Tests' : 'Editor'}
                  </button>
                )}
                <div className="max-h-60 overflow-y-auto text-xs">
                  <MarkdownRenderer content={aiReply} />
                </div>
              </div>
            )}
          </form>

          {/* GitHub Repository Explorer */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-4 w-4 text-slate-300" />
                <h2 className="font-display text-sm font-semibold text-white">GitHub Inspector</h2>
              </div>
              <span className="font-mono text-[11px] text-slate-500">
                {githubTokenConfigured ? 'Token active' : 'Public repos only'}
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={repoSlug}
                onChange={(e) => setRepoSlug(e.target.value)}
                placeholder="owner/repo"
                className="flex-1 rounded-lg border border-slate-800 bg-[#060913] px-3 py-1.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleBrowseGithub('')}
                disabled={ghLoading}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {ghLoading ? 'Loading...' : 'Browse'}
              </button>
            </div>

            {ghEntries.length > 0 && (
              <div className="space-y-1">
                {repoPath && (
                  <button
                    type="button"
                    onClick={() => {
                      const parent = repoPath.split('/').slice(0, -1).join('/');
                      void handleBrowseGithub(parent);
                    }}
                    className="text-xs text-blue-400 hover:underline cursor-pointer"
                  >
                    .. (up one directory)
                  </button>
                )}
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {ghEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => void handleBrowseGithub(entry.path)}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left font-mono text-xs text-slate-300 hover:bg-slate-800/60 cursor-pointer"
                    >
                      <span className="truncate">
                        {entry.type === 'dir' ? `${entry.name}/` : entry.name}
                      </span>
                      <span className="text-[11px] text-slate-500">{entry.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
