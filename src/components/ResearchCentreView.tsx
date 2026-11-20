import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Bot,
  CheckCircle2,
  Clock,
  FileSearch,
  Globe,
  History,
  Loader2,
  Lock,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  getProviderForModel,
  RESEARCH_AGENTS,
  RESEARCH_TYPE_CATALOG,
} from '../../shared/schema.ts';
import type {
  KnowledgeDocument,
  ResearchAgentContribution,
  ResearchAgentId,
  ResearchPipelineStage,
  ResearchProject,
  ResearchSourceRecord,
  ResearchType,
  ResearchVisibility,
} from '../../shared/schema.ts';
import {
  deleteResearchProject,
  fetchDocuments,
  fetchResearchDashboard,
  formatRelativeTime,
  streamResearchInvestigation,
  toggleSourceSavedToLibrary,
  updateResearchProjectPrivacy,
} from '../lib/api.ts';
import type { ResearchDashboardData } from '../lib/api.ts';
import { ResearchReportPanel } from './ResearchReportPanel.tsx';
import { ResearchSourcesPanel } from './ResearchSourcesPanel.tsx';

interface ResearchCentreViewProps {
  canEdit: boolean;
  currentUserId: string;
  isAdmin: boolean;
  defaultVisibility?: ResearchVisibility;
  selectedModelOverride?: string;
}

export function ResearchCentreView({
  canEdit,
  currentUserId,
  isAdmin,
  defaultVisibility = 'private',
  selectedModelOverride = 'auto',
}: ResearchCentreViewProps) {
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'new' | 'project' | 'library'>(
    'overview',
  );
  const [dashboard, setDashboard] = useState<ResearchDashboardData | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedProject, setSelectedProject] = useState<ResearchProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters for History
  const [historySearch, setHistorySearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ResearchType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'incomplete'>(
    'all',
  );

  // New Investigation Form State
  const [question, setQuestion] = useState('');
  const [researchType, setResearchType] = useState<ResearchType>('standard');
  const [sourceMode, setSourceMode] = useState<'web_search' | 'document_analysis' | 'combined'>(
    'web_search',
  );
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<ResearchAgentId[]>(
    RESEARCH_TYPE_CATALOG[0].defaultAgents,
  );
  const [customInstructions, setCustomInstructions] = useState('');
  const [visibility, setVisibility] = useState<ResearchVisibility>(defaultVisibility);

  // Live Pipeline Streaming State
  const [running, setRunning] = useState(false);
  const [liveStages, setLiveStages] = useState<ResearchPipelineStage[]>([]);
  const [liveAgents, setLiveAgents] = useState<ResearchAgentContribution[]>([]);
  const [liveProjectTitle, setLiveProjectTitle] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, docList] = await Promise.all([fetchResearchDashboard(), fetchDocuments()]);
      setDashboard(dash);
      setDocuments(docList);
      setSelectedProject((prev) => {
        if (prev) {
          const refreshed = dash.projects.find((p) => p.id === prev.id);
          if (refreshed) return refreshed;
        }
        return dash.projects[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load NEXUS Intelligence Engine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectResearchType = (nextType: ResearchType) => {
    setResearchType(nextType);
    const meta = RESEARCH_TYPE_CATALOG.find((t) => t.id === nextType);
    if (meta) {
      setSelectedAgentIds(meta.defaultAgents);
    }
  };

  const toggleAgent = (id: ResearchAgentId) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((a) => a !== id);
      }
      return [...prev, id];
    });
  };

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const handleLaunchInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || running) return;
    setError(null);
    setRunning(true);
    setLiveStages([]);
    setLiveAgents([]);
    setLiveProjectTitle(question.trim().slice(0, 90));

    try {
      const useOverride = Boolean(selectedModelOverride && selectedModelOverride !== 'auto');
      await streamResearchInvestigation(
        {
          question,
          researchType,
          sourceMode,
          documentIds: selectedDocIds,
          agentIds: selectedAgentIds,
          customInstructions,
          visibility,
          ...(useOverride
            ? {
                preferredModel: selectedModelOverride,
                preferredProvider: getProviderForModel(selectedModelOverride),
              }
            : {}),
        },
        {
          onStarted: (proj) => {
            setLiveStages(proj.pipelineStages);
          },
          onStage: (stage) => {
            setLiveStages((prev) =>
              prev.some((s) => s.stageNumber === stage.stageNumber)
                ? prev.map((s) => (s.stageNumber === stage.stageNumber ? stage : s))
                : [...prev, stage],
            );
          },
          onAgent: (agent) => {
            setLiveAgents((prev) => [...prev, agent]);
          },
          onComplete: (finalProj) => {
            setSelectedProject(finalProj);
            setDashboardTab('project');
            setQuestion('');
            void loadData();
          },
          onError: (msg, failedProj) => {
            setError(msg);
            if (failedProj) {
              setSelectedProject(failedProj);
            }
            void loadData();
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Investigation request failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleUpdatePrivacy = async (projectId: string, nextVis: ResearchVisibility) => {
    const updated = await updateResearchProjectPrivacy(projectId, nextVis);
    setSelectedProject(updated);
    setDashboard((prev) =>
      prev
        ? { ...prev, projects: prev.projects.map((p) => (p.id === updated.id ? updated : p)) }
        : prev,
    );
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteResearchProject(projectId);
    setDashboard((prev) => {
      if (!prev) return prev;
      const remaining = prev.projects.filter((p) => p.id !== projectId);
      setSelectedProject(remaining[0] ?? null);
      if (remaining.length === 0) setDashboardTab('overview');
      return { ...prev, projects: remaining };
    });
    void loadData();
  };

  const handleToggleSourceSaved = async (sourceId: string, saved: boolean) => {
    const updatedSource = await toggleSourceSavedToLibrary(sourceId, saved);
    setSelectedProject((prev) =>
      prev
        ? {
            ...prev,
            sources: prev.sources.map((s) => (s.id === updatedSource.id ? updatedSource : s)),
          }
        : prev,
    );
    setDashboard((prev) => {
      if (!prev) return prev;
      const updatedAll = prev.allSources.map((s) =>
        s.id === updatedSource.id ? updatedSource : s,
      );
      const updatedSaved = updatedAll.filter((s) => s.savedToLibrary);
      return {
        ...prev,
        allSources: updatedAll,
        savedSources: updatedSaved,
        stats: {
          ...prev.stats,
          savedSourcesCount: updatedSaved.length,
        },
      };
    });
  };

  const projects = dashboard?.projects ?? [];
  const filteredHistory = projects.filter((p) => {
    if (typeFilter !== 'all' && p.researchType !== typeFilter) return false;
    if (statusFilter === 'active' && p.status !== 'running') return false;
    if (
      statusFilter === 'completed' &&
      p.status !== 'completed' &&
      p.status !== 'completed_with_warnings'
    )
      return false;
    if (
      statusFilter === 'incomplete' &&
      p.status !== 'incomplete_search_failed' &&
      p.status !== 'failed'
    )
      return false;
    if (historySearch.trim()) {
      const q = historySearch.trim().toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.question.toLowerCase().includes(q) ||
        p.researchType.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeProjects = projects.filter((p) => p.status === 'running');
  const recentReports = projects
    .filter((p) => p.status === 'completed' || p.status === 'completed_with_warnings')
    .slice(0, 4);

  const stageIcon = (status: ResearchPipelineStage['status']) => {
    if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />;
    if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
    if (status === 'failed') return <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />;
    return <Clock className="h-4 w-4 text-slate-600 shrink-0" />;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            NEXUS Intelligence Engine
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            10-stage multi-agent research workspace with web grounding, source reliability grading,
            contradiction auditing, and PDF/DOCX report export.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setDashboardTab('new')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Research</span>
          </button>
        )}
      </div>

      {/* Research Usage KPI Strip */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Active Investigations</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {running ? Math.max(1, dashboard.stats.activeCount) : dashboard.stats.activeCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Completed Reports</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {dashboard.stats.completedCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">Saved Sources</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {dashboard.stats.savedSourcesCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs text-slate-400">24h Run Quota</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
              {dashboard.stats.dailyRunsUsed}
              <span className="text-sm font-normal text-slate-500">
                /{dashboard.stats.dailyRunLimit}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Workspace Segmented Navigation */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800/80 bg-[#0B1120] p-1">
        {[
          { id: 'overview', label: 'Research Dashboard', icon: History },
          { id: 'new', label: 'New Investigation', icon: Sparkles },
          {
            id: 'project',
            label: selectedProject ? 'Active Report' : 'Report Viewer',
            icon: FileSearch,
          },
          {
            id: 'library',
            label: `Source Library (${dashboard?.stats.savedSourcesCount ?? 0})`,
            icon: Bookmark,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDashboardTab(tab.id as typeof dashboardTab)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                dashboardTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
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

      {/* TAB 1: RESEARCH DASHBOARD (Active Projects, Recent Reports, History, Agents Roster) */}
      {dashboardTab === 'overview' && (
        <div className="space-y-6">
          {loading ? (
            <div className="h-72 animate-pulse rounded-xl border border-slate-800 bg-[#0B1120]" />
          ) : (
            <>
              {/* Active Projects if any */}
              {(activeProjects.length > 0 || running) && (
                <section className="rounded-xl border border-blue-500/40 bg-blue-950/20 p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-semibold text-white">
                      Active Research Projects
                    </h2>
                    {running && (
                      <button
                        type="button"
                        onClick={() => setDashboardTab('new')}
                        className="text-xs font-medium text-blue-300 hover:underline cursor-pointer"
                      >
                        View Live Pipeline
                      </button>
                    )}
                  </div>
                  {running && (
                    <div className="flex items-center gap-2 text-xs text-blue-200">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Investigating: {liveProjectTitle}</span>
                    </div>
                  )}
                  {activeProjects.map((ap) => (
                    <div
                      key={ap.id}
                      className="flex items-center justify-between text-xs text-slate-300"
                    >
                      <span className="truncate">{ap.title}</span>
                      <span className="font-mono text-slate-400">
                        {formatRelativeTime(ap.createdAt)}
                      </span>
                    </div>
                  ))}
                </section>
              )}

              {/* Recent Reports Grid */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-white">
                    Recent Reports
                  </h2>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {dashboard?.stats.ownedProjectCount ?? 0} /{' '}
                    {dashboard?.stats.maxProjectsPerUser ?? 60} projects owned
                  </span>
                </div>

                {recentReports.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400">
                    No completed reports yet. Launch a new investigation to produce a cited
                    9-section report.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {recentReports.map((proj) => {
                      const typeLabel =
                        RESEARCH_TYPE_CATALOG.find((t) => t.id === proj.researchType)?.label ??
                        proj.researchType;
                      const srcCount = proj.sources.filter((s) => !s.isDuplicate).length;
                      return (
                        <article
                          key={proj.id}
                          className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span className="font-medium text-blue-300">{typeLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {srcCount} source{srcCount === 1 ? '' : 's'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatRelativeTime(proj.createdAt)}
                              </span>
                            </div>
                            <h3 className="font-display text-sm font-semibold text-white">
                              {proj.title}
                            </h3>
                            <p className="line-clamp-2 text-xs text-slate-400">
                              {proj.report.executiveSummary || proj.question}
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/70 text-xs">
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              {proj.visibility === 'private' ? (
                                <>
                                  <Lock className="h-3 w-3" />
                                  <span>Private</span>
                                </>
                              ) : (
                                <>
                                  <Globe className="h-3 w-3" />
                                  <span>Workspace</span>
                                </>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProject(proj);
                                setDashboardTab('project');
                              }}
                              className="inline-flex items-center gap-1 font-medium text-blue-300 hover:text-blue-200 cursor-pointer"
                            >
                              <span>Open Report</span>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Full Research History Table / List */}
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-display text-base font-semibold text-white">
                    Research History
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search history..."
                        aria-label="Search research history"
                        className="rounded-lg border border-slate-800 bg-[#0B1120] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as 'all' | ResearchType)}
                      aria-label="Filter by research type"
                      className="rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="all">All Types</option>
                      {RESEARCH_TYPE_CATALOG.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(
                          e.target.value as 'all' | 'active' | 'completed' | 'incomplete',
                        )
                      }
                      aria-label="Filter by status"
                      className="rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="all">All Statuses</option>
                      <option value="completed">Completed</option>
                      <option value="incomplete">Incomplete / Failed</option>
                      <option value="active">Active</option>
                    </select>
                  </div>
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center text-sm text-slate-400">
                    No matching research projects found.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
                    {filteredHistory.map((proj) => {
                      const typeLabel =
                        RESEARCH_TYPE_CATALOG.find((t) => t.id === proj.researchType)?.label ??
                        proj.researchType;
                      const srcCount = proj.sources.filter((s) => !s.isDuplicate).length;
                      return (
                        <div
                          key={proj.id}
                          className="flex flex-col gap-3 px-5 py-4 hover:bg-slate-800/25 transition-colors sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span className="text-blue-300">{typeLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  proj.status === 'completed'
                                    ? 'text-emerald-400'
                                    : proj.status === 'completed_with_warnings'
                                      ? 'text-amber-400'
                                      : 'text-rose-400'
                                }
                              >
                                {proj.status.replace(/_/g, ' ')}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {srcCount} source{srcCount === 1 ? '' : 's'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatRelativeTime(proj.createdAt)}
                              </span>
                            </div>
                            <p className="truncate font-medium text-white">{proj.title}</p>
                            <p className="truncate text-xs text-slate-400">{proj.question}</p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProject(proj);
                              setDashboardTab('project');
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Specialised Research Agents Directory */}
              <section className="space-y-3">
                <h2 className="font-display text-base font-semibold text-white">
                  Specialised Research Agents
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {RESEARCH_AGENTS.map((ag) => (
                    <div
                      key={ag.id}
                      className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold text-white">
                          {ag.name}
                        </span>
                        <Bot className="h-4 w-4 text-violet-400 shrink-0" />
                      </div>
                      <p className="text-xs font-medium text-blue-300">{ag.roleTitle}</p>
                      <p className="text-xs text-slate-400">{ag.specialty}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* TAB 2: NEW INVESTIGATION LAUNCHER & LIVE 10-STAGE PIPELINE */}
      {dashboardTab === 'new' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleLaunchInvestigation}
            className="space-y-5 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-7"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Configure Investigation
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Select a research methodology, assign specialist agents, and configure evidence
                sources and privacy.
              </p>
            </div>

            {/* 8 Research Modes */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Research Type</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {RESEARCH_TYPE_CATALOG.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectResearchType(item.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                      researchType === item.id
                        ? 'border-blue-500 bg-blue-600/15 text-white'
                        : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-semibold truncate">{item.label.replace(' Research', '')}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                      {item.queryCount} queries
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                {RESEARCH_TYPE_CATALOG.find((t) => t.id === researchType)?.description}
              </p>
            </div>

            {/* Question Input */}
            <div className="space-y-1.5">
              <label htmlFor="intel-question" className="text-xs font-medium text-slate-300">
                Research Question
              </label>
              <textarea
                id="intel-question"
                rows={3}
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a complex question requiring multi-source verification, contradiction checking, and a cited executive report..."
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {(researchType === 'custom' || customInstructions.length > 0) && (
              <div className="space-y-1.5">
                <label htmlFor="intel-custom" className="text-xs font-medium text-slate-300">
                  Custom Scope &amp; Constraints (Optional)
                </label>
                <textarea
                  id="intel-custom"
                  rows={2}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Specify target industries, geographic regions, date cutoffs, or analytical criteria..."
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            {/* Source Mode & Privacy */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="intel-src-mode" className="text-xs font-medium text-slate-300">
                  Evidence Sources
                </label>
                <select
                  id="intel-src-mode"
                  value={sourceMode}
                  onChange={(e) =>
                    setSourceMode(
                      e.target.value as 'web_search' | 'document_analysis' | 'combined',
                    )
                  }
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="web_search">Web Search Grounding (Google Search)</option>
                  <option value="combined">Web Search + Knowledge Centre Docs</option>
                  <option value="document_analysis">Knowledge Centre Documents Only</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="intel-privacy" className="text-xs font-medium text-slate-300">
                  Project Privacy
                </label>
                <select
                  id="intel-privacy"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ResearchVisibility)}
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="private">Private (Only Me)</option>
                  <option value="workspace">Workspace Shared</option>
                </select>
              </div>
            </div>

            {(sourceMode === 'document_analysis' || sourceMode === 'combined') && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Knowledge Centre Documents ({selectedDocIds.length} selected)
                </span>
                {documents.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No documents uploaded yet in Knowledge Centre.
                  </p>
                ) : (
                  <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {documents.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1.5 text-xs text-slate-300 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(d.id)}
                          onChange={() => toggleDoc(d.id)}
                        />
                        <span className="truncate">{d.title}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Research Agent Delegation */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-300">
                Delegate Specialised Research Agents ({selectedAgentIds.length} active)
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {RESEARCH_AGENTS.map((ag) => {
                  const checked = selectedAgentIds.includes(ag.id);
                  return (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => toggleAgent(ag.id)}
                      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
                        checked
                          ? 'border-violet-500/60 bg-violet-950/25 text-white'
                          : 'border-slate-800 bg-[#060913] text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <Bot
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                          checked ? 'text-violet-400' : 'text-slate-600'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{ag.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{ag.roleTitle}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={!canEdit || running || question.trim().length < 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Executing 10-Stage Research Pipeline...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>Launch Investigation</span>
                </>
              )}
            </button>
          </form>

          {/* Right Column: Live 10-Stage Pipeline Progress */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-5 space-y-5">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                10-Stage Intelligence Pipeline
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Real-time progress, agent handoffs, and search integrity verification.
              </p>
            </div>

            {liveStages.length === 0 ? (
              <div className="space-y-2.5 text-xs text-slate-400">
                {[
                  '1. Question comprehension & entity extraction',
                  '2. Task decomposition & agent delegation',
                  '3. Focused search query generation',
                  '4. Grounded web search & knowledge lookup',
                  '5. Source deduplication & reliability grading',
                  '6. Independent cross-source comparison',
                  '7. Contradiction & gap detection (Fact Checker)',
                  '8. 9-section structured report (NEXUS Writer)',
                  '9. Verifiable claim-to-citation binding',
                  '10. Persistent save & integrity verification',
                ].map((label) => (
                  <div
                    key={label}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-800/70 bg-[#060913] px-3 py-2"
                  >
                    <Clock className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {liveStages.map((st) => (
                  <div
                    key={st.stageNumber}
                    className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-[#060913] px-3 py-2.5 text-xs"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {stageIcon(st.status)}
                      <div className="min-w-0">
                        <p className="font-medium text-white">
                          <span className="font-mono text-slate-500 mr-1 tabular-nums">
                            {String(st.stageNumber).padStart(2, '0')}.
                          </span>
                          {st.name}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">{st.detail}</p>
                      </div>
                    </div>
                    {typeof st.durationMs === 'number' && (
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {st.durationMs}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {liveAgents.length > 0 && (
              <div className="border-t border-slate-800/80 pt-4 space-y-2">
                <p className="text-xs font-semibold text-slate-300">Completed Agent Deliverables</p>
                {liveAgents.map((ag) => (
                  <div
                    key={ag.agentId}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs"
                  >
                    <span className="text-violet-300 font-medium">{ag.agentName}</span>
                    <span className="font-mono text-slate-400 tabular-nums">{ag.durationMs}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ACTIVE / SELECTED PROJECT REPORT VIEWER */}
      {dashboardTab === 'project' &&
        (selectedProject ? (
          <ResearchReportPanel
            project={selectedProject}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            canEdit={canEdit}
            onUpdatePrivacy={handleUpdatePrivacy}
            onDeleteProject={handleDeleteProject}
            onToggleSourceSaved={handleToggleSourceSaved}
          />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 px-6 py-16 text-center">
            <Globe className="h-9 w-9 text-slate-500" />
            <h2 className="mt-3 font-display text-base font-semibold text-white">
              No investigation selected
            </h2>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              Select a report from Research History or launch a new investigation.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setDashboardTab('new')}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Research</span>
              </button>
            )}
          </div>
        ))}

      {/* TAB 4: SAVED SOURCE LIBRARY */}
      {dashboardTab === 'library' && (
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Saved Source Library
            </h2>
            <p className="text-xs text-slate-400">
              Bookmarked web and knowledge sources across your accessible research investigations.
            </p>
          </div>
          <ResearchSourcesPanel
            sources={(dashboard?.savedSources ?? []) as ResearchSourceRecord[]}
            canEdit={canEdit}
            isLibraryMode
            onToggleSaved={handleToggleSourceSaved}
          />
        </div>
      )}
    </div>
  );
}
