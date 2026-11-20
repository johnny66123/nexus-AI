import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  Globe,
  Lock,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { RESEARCH_TYPE_CATALOG } from '../../shared/schema.ts';
import type { ResearchProject, ResearchVisibility } from '../../shared/schema.ts';
import { downloadResearchExport, formatRelativeTime } from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';
import { ResearchSourcesPanel } from './ResearchSourcesPanel.tsx';

interface ResearchReportPanelProps {
  project: ResearchProject;
  currentUserId: string;
  isAdmin: boolean;
  canEdit: boolean;
  onUpdatePrivacy: (projectId: string, visibility: ResearchVisibility) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onToggleSourceSaved: (sourceId: string, saved: boolean) => Promise<void>;
}

const REPORT_SECTIONS: Array<{
  key: keyof ResearchProject['report'];
  number: string;
  label: string;
}> = [
  { key: 'executiveSummary', number: '01', label: 'Executive Summary' },
  { key: 'researchObjectives', number: '02', label: 'Research Objectives' },
  { key: 'methodology', number: '03', label: 'Methodology' },
  { key: 'mainFindings', number: '04', label: 'Main Findings' },
  { key: 'evidenceAndCitations', number: '05', label: 'Evidence & Citations' },
  { key: 'limitations', number: '06', label: 'Limitations' },
  { key: 'recommendations', number: '07', label: 'Recommendations' },
  { key: 'conclusion', number: '08', label: 'Conclusion' },
  { key: 'references', number: '09', label: 'References' },
];

export function ResearchReportPanel({
  project,
  currentUserId,
  isAdmin,
  canEdit,
  onUpdatePrivacy,
  onDeleteProject,
  onToggleSourceSaved,
}: ResearchReportPanelProps) {
  const [subTab, setSubTab] = useState<'report' | 'sources' | 'agents' | 'pipeline'>('report');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | 'md' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updatingPrivacy, setUpdatingPrivacy] = useState(false);

  const canManageProject = canEdit && (project.userId === currentUserId || isAdmin);
  const typeLabel =
    RESEARCH_TYPE_CATALOG.find((t) => t.id === project.researchType)?.label ??
    project.researchType;
  const uniqueSourcesCount = project.sources.filter((s) => !s.isDuplicate).length;

  const handleExport = async (format: 'pdf' | 'docx' | 'md') => {
    setExportError(null);
    setExportingFormat(format);
    try {
      await downloadResearchExport(project.id, project.title, format);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExportingFormat(null);
    }
  };

  const handleTogglePrivacy = async () => {
    if (!canManageProject) return;
    setUpdatingPrivacy(true);
    try {
      const next: ResearchVisibility =
        project.visibility === 'private' ? 'workspace' : 'private';
      await onUpdatePrivacy(project.id, next);
    } finally {
      setUpdatingPrivacy(false);
    }
  };

  const statusText = (() => {
    if (project.status === 'completed') return { label: 'Completed', color: 'text-emerald-400' };
    if (project.status === 'completed_with_warnings')
      return { label: 'Completed with caveats', color: 'text-amber-400' };
    if (project.status === 'incomplete_search_failed')
      return { label: 'Incomplete (search failed)', color: 'text-rose-400' };
    if (project.status === 'running') return { label: 'Running', color: 'text-blue-400' };
    return { label: 'Failed', color: 'text-rose-400' };
  })();

  return (
    <div className="space-y-6">
      {/* Header Summary Card */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span className="font-medium text-blue-300">{typeLabel}</span>
              <span aria-hidden="true">·</span>
              <span className={`font-medium ${statusText.color}`}>{statusText.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {uniqueSourcesCount} unique source{uniqueSourcesCount === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatRelativeTime(project.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                {project.visibility === 'private' ? (
                  <>
                    <Lock className="h-3 w-3 text-slate-400" />
                    <span>Private</span>
                  </>
                ) : (
                  <>
                    <Globe className="h-3 w-3 text-slate-400" />
                    <span>Workspace</span>
                  </>
                )}
              </span>
            </div>

            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              {project.title}
            </h2>
            <p className="text-sm text-slate-300">{project.question}</p>
          </div>

          {/* Export & Project Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exportingFormat === 'pdf' ? 'Exporting...' : 'Export PDF'}</span>
            </button>

            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport('docx')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#060913] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{exportingFormat === 'docx' ? 'Exporting...' : 'Export DOCX'}</span>
            </button>

            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport('md')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#060913] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>MD</span>
            </button>

            {canManageProject && (
              <button
                type="button"
                disabled={updatingPrivacy}
                onClick={() => void handleTogglePrivacy()}
                title="Toggle private vs workspace visibility"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#060913] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {project.visibility === 'private' ? (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    <span>Make Shared</span>
                  </>
                ) : (
                  <>
                    <Globe className="h-3.5 w-3.5" />
                    <span>Make Private</span>
                  </>
                )}
              </button>
            )}

            {canManageProject &&
              (confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteProject(project.id)}
                    className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 cursor-pointer"
                  >
                    Confirm Delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete research project"
                  className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ))}
          </div>
        </div>

        {exportError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            {exportError}
          </div>
        )}

        {/* Integrity / Missing Info Warnings */}
        {(project.status === 'incomplete_search_failed' ||
          project.status === 'failed' ||
          project.missingInfo.length > 0 ||
          project.conflicts.length > 0) && (
          <div
            className={`rounded-lg border p-3.5 text-xs space-y-1.5 ${
              project.status === 'incomplete_search_failed' || project.status === 'failed'
                ? 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                : 'border-amber-500/35 bg-amber-950/20 text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                {project.status === 'incomplete_search_failed'
                  ? 'Search Retrieval Failed — Investigation Incomplete'
                  : 'Research Integrity & Uncertainty Notice'}
              </span>
            </div>
            {project.errorMessage && <p>Error: {project.errorMessage}</p>}
            {project.missingInfo.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5">
                {project.missingInfo.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Sub-view Navigation */}
        <div className="flex flex-wrap gap-1 border-t border-slate-800/80 pt-4">
          {[
            { id: 'report', label: 'Structured Report (9 Sections)' },
            { id: 'sources', label: `Sources & Conflicts (${uniqueSourcesCount})` },
            { id: 'agents', label: `Research Agents (${project.agentContributions.length})` },
            { id: 'pipeline', label: '10-Stage Pipeline Audit' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as typeof subTab)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#060913] text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Structured 9-Section Research Report */}
      {subTab === 'report' && (
        <div className="space-y-6">
          {/* Quick Section Jump Links */}
          <div className="flex flex-wrap gap-1.5">
            {REPORT_SECTIONS.map((sec) => (
              <a
                key={sec.key}
                href={`#report-sec-${sec.key}`}
                className="rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1 text-xs text-slate-300 hover:border-blue-500/50 hover:text-white transition-colors whitespace-nowrap"
              >
                <span className="font-mono text-slate-500 mr-1">{sec.number}.</span>
                {sec.label}
              </a>
            ))}
          </div>

          {/* 9 Sections */}
          <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-[#0B1120]">
            {REPORT_SECTIONS.map((sec) => (
              <section
                key={sec.key}
                id={`report-sec-${sec.key}`}
                className="p-6 space-y-3"
              >
                <h3 className="font-display text-base font-semibold text-white">
                  <span className="font-mono text-blue-400 mr-2">{sec.number}.</span>
                  {sec.label}
                </h3>
                <div className="text-sm text-slate-300 leading-relaxed">
                  <MarkdownRenderer
                    content={project.report[sec.key] || 'No content recorded for this section.'}
                  />
                </div>
              </section>
            ))}
          </div>

          {/* Claim-to-Citation Audit Table */}
          {project.claimCitations.length > 0 && (
            <section className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-4">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Claim-to-Citation Verification Matrix
                </h3>
                <p className="text-xs text-slate-400">
                  Every factual claim mapped strictly to verified source keys with evidence grading.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Factual Claim</th>
                      <th className="py-2 pr-4 font-medium whitespace-nowrap">Cited Sources</th>
                      <th className="py-2 font-medium whitespace-nowrap">Evidence Quality</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {project.claimCitations.map((row, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 pr-4 text-slate-200">{row.claim}</td>
                        <td className="py-2.5 pr-4 font-mono text-blue-300 whitespace-nowrap">
                          {row.sourceKeys.length > 0 ? row.sourceKeys.join(', ') : 'None'}
                        </td>
                        <td className="py-2.5 whitespace-nowrap capitalize">
                          <span
                            className={
                              row.evidenceQuality === 'corroborated'
                                ? 'text-emerald-400'
                                : row.evidenceQuality === 'unverified'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }
                          >
                            {row.evidenceQuality.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Tab 2: Source Management & Conflicts */}
      {subTab === 'sources' && (
        <ResearchSourcesPanel
          sources={project.sources}
          conflicts={project.conflicts}
          canEdit={canEdit}
          onToggleSaved={onToggleSourceSaved}
        />
      )}

      {/* Tab 3: Specialised Research Agent Contributions */}
      {subTab === 'agents' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {project.agentContributions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400 lg:col-span-2">
              No agent contributions recorded for this investigation.
            </div>
          ) : (
            project.agentContributions.map((agent) => (
              <article
                key={agent.agentId}
                className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Bot className="h-4 w-4 text-violet-400 shrink-0" />
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">
                        {agent.agentName}
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        {agent.roleTitle} ·{' '}
                        <span className="font-mono tabular-nums">{agent.durationMs}ms</span>
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium capitalize ${
                      agent.status === 'completed'
                        ? 'text-emerald-400'
                        : agent.status === 'warning'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">Task: {agent.assignedTask}</p>
                <div className="rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs text-slate-300">
                  <MarkdownRenderer content={agent.output} />
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* Tab 4: 10-Stage Pipeline Audit */}
      {subTab === 'pipeline' && (
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-5">
          {project.understandingSummary && (
            <div className="space-y-1 border-b border-slate-800/80 pb-4">
              <p className="text-xs font-semibold text-slate-300">
                Stage 1 Question Understanding
              </p>
              <p className="text-sm text-slate-200">{project.understandingSummary}</p>
            </div>
          )}

          {project.searchQueries.length > 0 && (
            <div className="space-y-1.5 border-b border-slate-800/80 pb-4">
              <p className="text-xs font-semibold text-slate-300">
                Executed Search Queries ({project.searchQueries.length})
              </p>
              <ul className="list-disc pl-5 text-xs font-mono text-slate-300 space-y-1">
                {project.searchQueries.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="divide-y divide-slate-800/60">
            {project.pipelineStages.map((st) => (
              <div
                key={st.stageNumber}
                className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  {st.status === 'completed' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" />
                  ) : st.status === 'warning' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-4 w-4 text-rose-400 shrink-0" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-white">
                      <span className="font-mono text-slate-500 mr-1.5 tabular-nums">
                        {String(st.stageNumber).padStart(2, '0')}.
                      </span>
                      {st.name}
                    </p>
                    <p className="text-xs text-slate-400">{st.detail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0 pl-7 sm:pl-0">
                  <span className="capitalize text-slate-300">{st.status}</span>
                  {typeof st.durationMs === 'number' && (
                    <span className="text-slate-500">{st.durationMs}ms</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
