import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Code2,
  Cpu,
  Globe,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Plus,
  Settings,
  Shield,
  Sliders,
  Store,
  User,
  Volume2,
  Workflow,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AI_MODELS } from '../shared/schema.ts';
import type {
  Assistant,
  AssistantInput,
  AuthUser,
  Conversation,
  UserProfile,
  UserProfileInput,
} from '../shared/schema.ts';
import { AdminView } from './components/AdminView.tsx';
import { AgentsMasterView } from './components/AgentsMasterView.tsx';
import { AssistantStudioView } from './components/AssistantStudioView.tsx';
import { AssistantsListView } from './components/AssistantsListView.tsx';
import { AuthGateView } from './components/AuthGateView.tsx';
import { AutomationStudioView } from './components/AutomationStudioView.tsx';
import { ChatWorkspaceView } from './components/ChatWorkspaceView.tsx';
import { ConversationsView } from './components/ConversationsView.tsx';
import { DevelopmentLabView } from './components/DevelopmentLabView.tsx';
import { KnowledgeCentreView } from './components/KnowledgeCentreView.tsx';
import { MarketplaceView } from './components/MarketplaceView.tsx';
import { MediaStudioView } from './components/MediaStudioView.tsx';
import { MemoryView } from './components/MemoryView.tsx';
import { ModelGatewayView } from './components/ModelGatewayView.tsx';
import { NexusLogo } from './components/NexusLogo.tsx';
import { OrchestrationView } from './components/OrchestrationView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { ResearchCentreView } from './components/ResearchCentreView.tsx';
import { SettingsProfileView } from './components/SettingsProfileView.tsx';
import {
  createAssistant,
  createConversation,
  deleteAssistant,
  deleteConversation,
  duplicateAssistant,
  exportAssistantConfig,
  fetchConversations,
  fetchHealth,
  fetchOverview,
  fetchSession,
  importAssistantConfig,
  logout,
  onUnauthorized,
  publishToMarketplace,
  UnauthorizedError,
  updateAssistant,
  updateProfile,
} from './lib/api.ts';
import type { HealthStatus, OverviewData } from './lib/api.ts';

type ViewId =
  | 'overview'
  | 'master'
  | 'gateway'
  | 'assistants'
  | 'studio'
  | 'chat'
  | 'conversations'
  | 'orchestration'
  | 'memory'
  | 'research'
  | 'lab'
  | 'automation'
  | 'media'
  | 'knowledge'
  | 'marketplace'
  | 'admin'
  | 'settings';

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [view, setView] = useState<ViewId>('overview');
  const [previousView, setPreviousView] = useState<ViewId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<OverviewData['stats']>({
    assistantCount: 0,
    conversationCount: 0,
    totalMessages: 0,
    documentCount: 0,
    workflowCount: 0,
    memoryCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [memoryAssistantId, setMemoryAssistantId] = useState<string | null>(null);
  const [globalModelSelection, setGlobalModelSelection] = useState<string>('auto');
  const [avatarError, setAvatarError] = useState(false);

  const resetAuthState = useCallback((notice?: string | null) => {
    setCurrentUser(null);
    setProfile(null);
    setAssistants([]);
    setConversations([]);
    setLoadError(null);
    setMobileNavOpen(false);
    setAuthNotice(notice ?? null);
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [overviewData, allConvs, healthInfo] = await Promise.all([
        fetchOverview(),
        fetchConversations(),
        fetchHealth(),
      ]);
      setAssistants(overviewData.assistants);
      setConversations(allConvs);
      setProfile(overviewData.profile);
      setStats(overviewData.stats);
      setHealth(healthInfo);
      if (overviewData.assistants.length > 0) {
        setActiveAssistantId((prev) => prev ?? overviewData.assistants[0].id);
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        resetAuthState(err.message);
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to load NEXUS AI workspace.');
    } finally {
      setLoading(false);
    }
  }, [resetAuthState]);

  useEffect(() => {
    return onUnauthorized((message) => {
      resetAuthState(message || 'Your session has expired. Please sign in again.');
    });
  }, [resetAuthState]);

  useEffect(() => {
    void (async () => {
      try {
        const session = await fetchSession();
        if (session.authenticated && session.user) {
          setAuthNotice(null);
          setCurrentUser(session.user);
          await loadWorkspace();
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          resetAuthState(err.message);
        }
      } finally {
        setAuthChecking(false);
      }
    })();
  }, [loadWorkspace, resetAuthState]);

  const handleAuthenticated = async (user: AuthUser) => {
    setAuthNotice(null);
    setLoadError(null);
    setCurrentUser(user);
    setView('overview');
    await loadWorkspace();
  };

  const handleLogout = async () => {
    await logout();
    resetAuthState('You have signed out cleanly.');
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060913] text-sm text-slate-400">
        Verifying workspace session...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthGateView
        initialNotice={authNotice}
        onAuthenticated={(u) => void handleAuthenticated(u)}
      />
    );
  }

  const canEdit = currentUser.role === 'admin' || currentUser.role === 'developer';
  const isAdmin = currentUser.role === 'admin';

  const navigateTo = (nextView: ViewId) => {
    setPreviousView(view);
    setView(nextView);
    setMobileNavOpen(false);
  };

  const handleOpenCreate = () => {
    if (!canEdit) return;
    setEditingAssistant(null);
    navigateTo('studio');
  };

  const handleOpenEdit = (assistant: Assistant) => {
    if (!canEdit) return;
    setEditingAssistant(assistant);
    navigateTo('studio');
  };

  const handleSaveAssistant = async (input: AssistantInput, existingId?: string) => {
    if (existingId) {
      const updated = await updateAssistant(existingId, input);
      setAssistants((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setActiveAssistantId(updated.id);
      navigateTo('assistants');
    } else {
      const created = await createAssistant(input);
      setAssistants((prev) => [created, ...prev]);
      setStats((s) => ({ ...s, assistantCount: s.assistantCount + 1 }));
      setActiveAssistantId(created.id);
      setActiveConversationId(null);
      navigateTo('chat');
    }
  };

  const handleDuplicateAssistant = async (id: string) => {
    const copy = await duplicateAssistant(id);
    setAssistants((prev) => [copy, ...prev]);
    setStats((s) => ({ ...s, assistantCount: s.assistantCount + 1 }));
  };

  const handleExportAssistant = async (id: string) => {
    const exported = await exportAssistantConfig(id);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-assistant-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportAssistant = async (payload: unknown) => {
    const imported = await importAssistantConfig(payload);
    setAssistants((prev) => [imported, ...prev]);
    setStats((s) => ({ ...s, assistantCount: s.assistantCount + 1 }));
  };

  const handleDeleteAssistant = async (id: string) => {
    await deleteAssistant(id);
    const remainingAssistants = assistants.filter((a) => a.id !== id);
    setAssistants(remainingAssistants);
    setConversations((prev) => prev.filter((c) => c.assistantId !== id));
    if (activeAssistantId === id) {
      setActiveAssistantId(remainingAssistants[0]?.id ?? null);
      setActiveConversationId(null);
    }
  };

  const handleOpenChat = (assistantId: string, conversationId?: string) => {
    setActiveAssistantId(assistantId);
    if (conversationId) {
      setActiveConversationId(conversationId);
    } else {
      const matching = conversations
        .filter((c) => c.assistantId === assistantId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setActiveConversationId(matching[0]?.id ?? null);
    }
    navigateTo('chat');
  };

  const handleOpenMemory = (assistantId: string) => {
    setMemoryAssistantId(assistantId);
    navigateTo('memory');
  };

  const handleCreateConversation = async (assistantId: string): Promise<Conversation> => {
    const created = await createConversation(assistantId);
    setConversations((prev) => [created, ...prev]);
    setActiveAssistantId(assistantId);
    setActiveConversationId(created.id);
    return created;
  };

  const handleDeleteConversation = async (conversationId: string) => {
    await deleteConversation(conversationId);
    const remaining = conversations.filter((c) => c.id !== conversationId);
    setConversations(remaining);
    if (activeConversationId === conversationId) {
      const nextForAssistant = remaining.find((c) => c.assistantId === activeAssistantId);
      setActiveConversationId(nextForAssistant?.id ?? null);
    }
  };

  const handleConversationUpdated = (updated: Conversation) => {
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((c) => (c.id === updated.id ? updated : c));
    });
  };

  const handleSaveProfile = async (input: UserProfileInput) => {
    const saved = await updateProfile(input);
    setProfile(saved);
    setCurrentUser((prev) =>
      prev
        ? {
            ...prev,
            displayName: saved.displayName,
            email: saved.email,
            defaultProvider: saved.defaultProvider,
            defaultModel: saved.defaultModel,
          }
        : prev,
    );
  };

  const navGroups: Array<{
    title: string;
    items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean }>;
  }> = [
    {
      title: 'Workspace',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'assistants', label: 'Agent Factory', icon: Bot },
        { id: 'chat', label: 'Chat Workspace', icon: MessageSquare },
        { id: 'conversations', label: 'Conversations', icon: History },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { id: 'master', label: 'Master & Agents', icon: Cpu },
        { id: 'orchestration', label: 'Orchestration', icon: Network },
        { id: 'memory', label: 'AI Memory', icon: Brain },
        { id: 'research', label: 'Research Centre', icon: Globe },
        { id: 'knowledge', label: 'Knowledge Centre', icon: BookOpen },
      ],
    },
    {
      title: 'Studios & Ecosystem',
      items: [
        { id: 'lab', label: 'Dev Lab', icon: Code2 },
        { id: 'automation', label: 'Automation', icon: Workflow },
        { id: 'media', label: 'Media Studio', icon: Volume2 },
        { id: 'marketplace', label: 'Marketplace', icon: Store },
      ],
    },
    {
      title: 'System',
      items: [
        { id: 'gateway', label: 'Model Gateway', icon: Sliders },
        ...(isAdmin ? [{ id: 'admin' as ViewId, label: 'Administration', icon: Shield }] : []),
        { id: 'settings', label: 'Settings & Profile', icon: Settings },
      ],
    },
  ];

  const breadcrumbLabel = (() => {
    const labels: Record<ViewId, string> = {
      overview: 'Overview',
      master: 'Master Intelligence & Specialist Agents',
      gateway: 'Multi-Model Gateway',
      assistants: 'AI Agent Factory',
      studio: editingAssistant ? `Edit ${editingAssistant.name}` : 'Create AI Assistant',
      chat: 'Chat Workspace',
      conversations: 'Recent Conversations',
      orchestration: 'Multi-Agent Orchestration',
      memory: 'Advanced AI Memory',
      research: 'NEXUS Intelligence Engine',
      lab: 'AI Development Lab',
      automation: 'Automation Studio',
      media: 'AI Media Studio',
      knowledge: 'Knowledge Centre',
      marketplace: 'AI Marketplace',
      admin: 'Administration & Security',
      settings: 'Settings & Profile',
    };
    return labels[view];
  })();

  const renderSidebar = (collapsed: boolean) => (
    <div className="flex h-full flex-col justify-between bg-[#080D1A]">
      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between px-1.5 pt-1">
          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className="text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md cursor-pointer"
          >
            <NexusLogo compact={collapsed} />
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:inline-flex cursor-pointer"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-slate-400 hover:text-white lg:hidden cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Primary Navigation" className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <p className="px-3 text-[11px] font-medium text-slate-500">{group.title}</p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  view === item.id || (view === 'studio' && item.id === 'assistants');
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={collapsed ? item.label : undefined}
                    onClick={() => navigateTo(item.id)}
                    className={`flex w-full items-center ${
                      collapsed ? 'justify-center px-2' : 'gap-3 px-3'
                    } rounded-lg py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-blue-600/15 text-blue-300'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-500'}`}
                    />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {profile && (
        <div className="border-t border-slate-800/80 p-3">
          <button
            type="button"
            onClick={() => navigateTo('settings')}
            className={`flex w-full items-center ${
              collapsed ? 'justify-center' : 'gap-3'
            } rounded-lg p-1.5 text-left hover:bg-slate-800/50 transition-colors cursor-pointer`}
          >
            {!avatarError ? (
              <img
                src="/src/assets/images/avatar_workspace_owner_1794856492097.jpg"
                alt={profile.displayName}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="h-8 w-8 rounded-lg border border-slate-700 object-cover shrink-0"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 shrink-0">
                <User className="h-4 w-4 text-blue-400" />
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-200">
                  {profile.displayName}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-500">{profile.role}</p>
              </div>
            )}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#060913] text-slate-100">
      {/* Collapsible Desktop Sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-slate-800/80 transition-[width] duration-150 lg:block ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-screen overflow-y-auto">
          {renderSidebar(sidebarCollapsed)}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[82vw] border-r border-slate-800 overflow-y-auto">
            {renderSidebar(false)}
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-800/80 bg-[#060913]/95 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800 lg:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="font-display font-semibold text-slate-400 whitespace-nowrap shrink-0">
                NEXUS AI
              </span>
              <span className="text-slate-600" aria-hidden="true">
                /
              </span>
              <span className="truncate font-medium text-slate-100">{breadcrumbLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <label htmlFor="header-model-select" className="sr-only">
              Active AI Model Selection
            </label>
            <select
              id="header-model-select"
              value={globalModelSelection}
              onChange={(e) => setGlobalModelSelection(e.target.value)}
              title="Active Model Routing Override"
              className="hidden sm:block max-w-[210px] rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none cursor-pointer"
            >
              <option value="auto">Auto (Master AI)</option>
              <optgroup label="Google Gemini">
                {AI_MODELS.filter((m) => m.providerId === 'google').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Anthropic Claude">
                {AI_MODELS.filter((m) => m.providerId === 'anthropic').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="OpenAI">
                {AI_MODELS.filter((m) => m.providerId === 'openai').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>

            {canEdit && (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Assistant</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLogout()}
              title="Sign Out"
              aria-label="Sign Out"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800/80 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {loading ? (
            <div className="mx-auto max-w-6xl space-y-6">
              <div className="h-44 animate-pulse rounded-xl border border-slate-800/70 bg-[#0B1120]" />
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl border border-slate-800/70 bg-[#0B1120]"
                  />
                ))}
              </div>
            </div>
          ) : loadError || !profile ? (
            <div className="mx-auto max-w-lg rounded-xl border border-rose-500/40 bg-rose-950/30 p-6 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-rose-400" />
              <h1 className="mt-3 font-display text-lg font-semibold text-white">
                Unable to load NEXUS AI
              </h1>
              <p className="mt-1 text-sm text-rose-200">{loadError ?? 'Workspace unavailable.'}</p>
              <button
                type="button"
                onClick={() => void loadWorkspace()}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${view}-${editingAssistant?.id ?? 'new'}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                {view === 'overview' && (
                  <OverviewView
                    assistants={assistants}
                    conversations={conversations}
                    profile={profile}
                    stats={stats}
                    canEdit={canEdit}
                    onCreateAssistant={handleOpenCreate}
                    onOpenChat={handleOpenChat}
                    onEditAssistant={handleOpenEdit}
                    onNavigateView={(target) => navigateTo(target)}
                  />
                )}

                {view === 'assistants' && (
                  <AssistantsListView
                    assistants={assistants}
                    conversations={conversations}
                    canEdit={canEdit}
                    onCreateAssistant={handleOpenCreate}
                    onEditAssistant={handleOpenEdit}
                    onDuplicateAssistant={handleDuplicateAssistant}
                    onExportAssistant={handleExportAssistant}
                    onImportAssistant={handleImportAssistant}
                    onDeleteAssistant={handleDeleteAssistant}
                    onPublishAssistant={async (assistantId, category) => {
                      await publishToMarketplace({ assistantId, category, userConsent: true });
                      setAssistants((prev) =>
                        prev.map((a) => (a.id === assistantId ? { ...a, isPublic: true } : a)),
                      );
                    }}
                    onOpenChat={(assistantId) => handleOpenChat(assistantId)}
                    onOpenMemory={handleOpenMemory}
                  />
                )}

                {view === 'studio' && (
                  <AssistantStudioView
                    editingAssistant={editingAssistant}
                    profile={profile}
                    onCancel={() =>
                      navigateTo(previousView === 'studio' ? 'assistants' : previousView)
                    }
                    onSubmit={handleSaveAssistant}
                  />
                )}

                {view === 'master' && (
                  <AgentsMasterView
                    canEdit={canEdit}
                    selectedModelOverride={globalModelSelection}
                  />
                )}

                {view === 'gateway' && <ModelGatewayView canEdit={canEdit} />}

                {view === 'chat' && (
                  <ChatWorkspaceView
                    assistants={assistants}
                    conversations={conversations}
                    profile={profile}
                    canEdit={canEdit}
                    selectedModelOverride={globalModelSelection}
                    activeAssistantId={activeAssistantId}
                    activeConversationId={activeConversationId}
                    onSelectAssistant={(id) => {
                      setActiveAssistantId(id);
                      const firstConv = conversations
                        .filter((c) => c.assistantId === id)
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                      setActiveConversationId(firstConv?.id ?? null);
                    }}
                    onSelectConversation={(convId) => setActiveConversationId(convId)}
                    onCreateConversation={handleCreateConversation}
                    onDeleteConversation={handleDeleteConversation}
                    onConversationUpdated={handleConversationUpdated}
                    onEditAssistant={handleOpenEdit}
                    onCreateAssistant={handleOpenCreate}
                    onOpenMemory={handleOpenMemory}
                  />
                )}

                {view === 'conversations' && (
                  <ConversationsView
                    assistants={assistants}
                    conversations={conversations}
                    canEdit={canEdit}
                    onOpenChat={handleOpenChat}
                    onDeleteConversation={handleDeleteConversation}
                  />
                )}

                {view === 'orchestration' && (
                  <OrchestrationView assistants={assistants} canEdit={canEdit} />
                )}

                {view === 'memory' && (
                  <MemoryView
                    assistants={assistants}
                    initialAssistantId={memoryAssistantId}
                    canEdit={canEdit}
                  />
                )}

                {view === 'research' && (
                  <ResearchCentreView
                    canEdit={canEdit}
                    currentUserId={currentUser.id}
                    isAdmin={isAdmin}
                    defaultVisibility={profile.defaultResearchVisibility}
                    selectedModelOverride={globalModelSelection}
                  />
                )}

                {view === 'lab' && (
                  <DevelopmentLabView
                    canEdit={canEdit}
                    githubTokenConfigured={Boolean(health?.githubTokenConfigured)}
                  />
                )}

                {view === 'automation' && (
                  <AutomationStudioView assistants={assistants} canEdit={canEdit} />
                )}

                {view === 'media' && (
                  <MediaStudioView
                    canEdit={canEdit}
                    paidImageModelAvailable={Boolean(health?.paidImageModelAvailable)}
                  />
                )}

                {view === 'knowledge' && <KnowledgeCentreView canEdit={canEdit} />}

                {view === 'marketplace' && (
                  <MarketplaceView canEdit={canEdit} onAssistantInstalled={loadWorkspace} />
                )}

                {view === 'admin' && isAdmin && (
                  <AdminView currentUser={currentUser} onWorkspaceRestored={loadWorkspace} />
                )}

                {view === 'settings' && (
                  <SettingsProfileView
                    profile={profile}
                    onSaveProfile={handleSaveProfile}
                    onLogout={handleLogout}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
    </div>
  );
}
