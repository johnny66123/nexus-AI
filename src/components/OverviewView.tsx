import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Code2,
  Cpu,
  Globe,
  MessageSquare,
  Network,
  Plus,
  Sliders,
  SlidersHorizontal,
  Store,
  Volume2,
  Workflow,
} from 'lucide-react';
import { getModelLabel } from '../../shared/schema.ts';
import type { Assistant, Conversation, UserProfile } from '../../shared/schema.ts';
import { formatRelativeTime } from '../lib/api.ts';

interface OverviewViewProps {
  assistants: Assistant[];
  conversations: Conversation[];
  profile: UserProfile;
  stats: {
    assistantCount: number;
    conversationCount: number;
    totalMessages: number;
    documentCount: number;
    workflowCount: number;
    memoryCount: number;
  };
  canEdit: boolean;
  onCreateAssistant: () => void;
  onOpenChat: (assistantId: string, conversationId?: string) => void;
  onEditAssistant: (assistant: Assistant) => void;
  onNavigateView: (
    view:
      | 'assistants'
      | 'conversations'
      | 'master'
      | 'gateway'
      | 'orchestration'
      | 'research'
      | 'lab'
      | 'automation'
      | 'media'
      | 'knowledge'
      | 'marketplace',
  ) => void;
}

export function OverviewView({
  assistants,
  conversations,
  profile,
  stats,
  canEdit,
  onCreateAssistant,
  onOpenChat,
  onEditAssistant,
  onNavigateView,
}: OverviewViewProps) {
  const [bannerError, setBannerError] = useState(false);

  const assistantMap = new Map(assistants.map((a) => [a.id, a]));
  const recentConversations = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const featuredAssistants = assistants.slice(0, 6);

  const modules = [
    {
      id: 'master' as const,
      title: 'Master AI & Agents',
      desc: 'Single-path routing, task planning, and 6 configurable specialists.',
      icon: Cpu,
    },
    {
      id: 'gateway' as const,
      title: 'Multi-Model Gateway',
      desc: 'Configure Gemini, Claude, OpenAI adapters, fallbacks & latency metrics.',
      icon: Sliders,
    },
    {
      id: 'orchestration' as const,
      title: 'Multi-Agent Orchestration',
      desc: 'Coordinate specialist agents via Master AI with failure recovery.',
      icon: Network,
    },
    {
      id: 'research' as const,
      title: 'AI Research Centre',
      desc: 'Google Search grounding with citations and Markdown briefs.',
      icon: Globe,
    },
    {
      id: 'lab' as const,
      title: 'AI Development Lab',
      desc: 'Sandboxed VM code runner, unit tests, AI debugger, and GitHub.',
      icon: Code2,
    },
    {
      id: 'automation' as const,
      title: 'Automation Studio',
      desc: 'Scheduled & conditional pipelines with human approval gates.',
      icon: Workflow,
    },
    {
      id: 'media' as const,
      title: 'AI Media Studio',
      desc: 'Voice TTS, audio transcription, canvas editor, and SVG studio.',
      icon: Volume2,
    },
    {
      id: 'knowledge' as const,
      title: 'Knowledge Centre',
      desc: 'Index PDF, DOCX, CSV, and XLSX documents for grounded Q&A.',
      icon: BookOpen,
    },
    {
      id: 'marketplace' as const,
      title: 'AI Marketplace',
      desc: 'Discover, import, publish, and review specialist agents.',
      icon: Store,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
        {!bannerError ? (
          <img
            src="/src/assets/images/nexus_banner_abstract_1794856491385.jpg"
            alt="NEXUS AI architectural backdrop"
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-blue-950/60 via-[#0B1120] to-violet-950/50" />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-r from-[#060913]/95 via-[#060913]/85 to-[#060913]/55"
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col justify-between gap-6 p-6 sm:p-8 lg:flex-row lg:items-end">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-medium tracking-wide text-blue-400">
              NEXUS AI Operating Platform · {profile.displayName} ({profile.role})
            </p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
              Build, orchestrate, and govern specialized AI systems
            </h1>
            <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
              Coordinate multi-agent workflows, ground answers in uploaded documents and web search,
              execute code in a sandboxed lab, and manage workspace security in one platform.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {canEdit && (
              <button
                type="button"
                onClick={onCreateAssistant}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Create AI Assistant</span>
              </button>
            )}
            {assistants.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenChat(assistants[0].id)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B1120]/90 px-4 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquare className="h-4 w-4 text-violet-400" />
                <span>Open Chat</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Metrics Strip */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Assistants', value: stats.assistantCount },
          { label: 'Threads', value: stats.conversationCount },
          { label: 'Messages', value: stats.totalMessages },
          { label: 'Memories', value: stats.memoryCount },
          { label: 'Documents', value: stats.documentCount },
          { label: 'Workflows', value: stats.workflowCount },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4">
            <p className="text-xs font-medium text-slate-400">{metric.label}</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-white">
              {metric.value}
            </p>
          </div>
        ))}
      </section>

      {/* Platform Modules Launcher */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Platform Modules</h2>
          <p className="text-sm text-slate-400">
            Jump directly into any operational workspace across NEXUS AI.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => onNavigateView(mod.id)}
                className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 text-left hover:border-blue-500/50 transition-colors cursor-pointer"
              >
                <div>
                  <Icon className="h-5 w-5 text-blue-400" />
                  <h3 className="mt-3 font-display text-sm font-semibold text-white">
                    {mod.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{mod.desc}</p>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-400">
                  <span>Open</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* My AI Assistants Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">My AI Assistants</h2>
            <p className="text-sm text-slate-400">
              Launch a conversation or refine system instructions for any assistant.
            </p>
          </div>
          {assistants.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigateView('assistants')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Agent Factory</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featuredAssistants.map((assistant) => {
            const threadCount = conversations.filter((c) => c.assistantId === assistant.id).length;
            return (
              <article
                key={assistant.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 hover:border-slate-700 transition-colors"
              >
                <div>
                  <h3 className="font-display text-base font-semibold text-white">
                    {assistant.name}
                  </h3>
                  <p className="mt-1 text-xs font-mono text-slate-400">
                    {getModelLabel(assistant.model)} · {assistant.purpose}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-300">
                    {assistant.description}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-800/70 pt-4">
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    {threadCount} {threadCount === 1 ? 'thread' : 'threads'}
                  </span>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onEditAssistant(assistant)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenChat(assistant.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25 hover:text-blue-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>Chat</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Recent Conversations Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-white">Recent Conversations</h2>
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigateView('conversations')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>All conversations</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {recentConversations.length === 0 ? (
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 text-center text-sm text-slate-400">
            No conversations yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
            {recentConversations.map((conv) => {
              const assistant = assistantMap.get(conv.assistantId);
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onOpenChat(conv.assistantId, conv.id)}
                  className="flex w-full flex-col gap-2 px-5 py-4 text-left hover:bg-slate-800/35 transition-colors sm:flex-row sm:items-center sm:justify-between cursor-pointer"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-violet-300">
                        {assistant?.name ?? 'Assistant'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {conv.messages.length} msgs
                      </span>
                    </div>
                    <p className="truncate font-medium text-slate-100">{conv.title}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-xs tabular-nums text-slate-500">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-500" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
