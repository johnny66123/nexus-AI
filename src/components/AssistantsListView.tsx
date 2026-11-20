import { useRef, useState } from 'react';
import {
  Bot,
  Brain,
  CopyPlus,
  Download,
  MessageSquare,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { AI_MODELS, WORKSPACE_LIMITS, getModelLabel } from '../../shared/schema.ts';
import type { AIModelId, Assistant, Conversation } from '../../shared/schema.ts';
import { formatRelativeTime } from '../lib/api.ts';

interface AssistantsListViewProps {
  assistants: Assistant[];
  conversations: Conversation[];
  canEdit: boolean;
  onCreateAssistant: () => void;
  onEditAssistant: (assistant: Assistant) => void;
  onDuplicateAssistant: (id: string) => Promise<void>;
  onExportAssistant: (id: string) => Promise<void>;
  onImportAssistant: (jsonPayload: unknown) => Promise<void>;
  onDeleteAssistant: (id: string) => Promise<void>;
  onPublishAssistant: (assistantId: string, category: string) => Promise<void>;
  onOpenChat: (assistantId: string) => void;
  onOpenMemory: (assistantId: string) => void;
}

export function AssistantsListView({
  assistants,
  conversations,
  canEdit,
  onCreateAssistant,
  onEditAssistant,
  onDuplicateAssistant,
  onExportAssistant,
  onImportAssistant,
  onDeleteAssistant,
  onPublishAssistant,
  onOpenChat,
  onOpenMemory,
}: AssistantsListViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState<'all' | AIModelId>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<Assistant | null>(null);
  const [publishConsent, setPublishConsent] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emblemError, setEmblemError] = useState(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = assistants.filter((a) => {
    const matchesModel = modelFilter === 'all' || a.model === modelFilter;
    const matchesSearch =
      !normalizedQuery ||
      a.name.toLowerCase().includes(normalizedQuery) ||
      a.purpose.toLowerCase().includes(normalizedQuery) ||
      a.description.toLowerCase().includes(normalizedQuery);
    return matchesModel && matchesSearch;
  });

  const handleConfirmDelete = async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await onDeleteAssistant(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await onImportAssistant(parsed);
      setStatusMessage(`Imported assistant configuration from ${file.name}.`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Invalid assistant JSON configuration file.',
      );
    }
  };

  const handleConfirmPublish = async () => {
    if (!publishTarget || !publishConsent) return;
    setPublishBusy(true);
    setErrorMessage(null);
    try {
      await onPublishAssistant(publishTarget.id, publishTarget.category || publishTarget.purpose);
      setStatusMessage(`Published "${publishTarget.name}" to the AI Marketplace.`);
      setPublishTarget(null);
      setPublishConsent(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to publish assistant.');
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            AI Agent Factory
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Create, duplicate, export, import, and manage specialized AI assistants (
            <span className="font-mono tabular-nums text-slate-300">
              {assistants.length}/{WORKSPACE_LIMITS.maxAssistants}
            </span>{' '}
            active).
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import JSON</span>
            </button>
            <button
              type="button"
              onClick={onCreateAssistant}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create AI Assistant</span>
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or purpose..."
            aria-label="Search AI assistants"
            className="w-full rounded-lg border border-slate-800 bg-[#0B1120] py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-[#0B1120] p-1">
          <button
            type="button"
            onClick={() => setModelFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              modelFilter === 'all'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Models
          </button>
          {AI_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => setModelFilter(model.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                modelFilter === model.id
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {model.label}
            </button>
          ))}
        </div>
      </div>

      {/* Publish Consent Modal */}
      {publishTarget && (
        <div className="rounded-xl border border-blue-500/40 bg-[#0B1120] p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Publish "{publishTarget.name}" to AI Marketplace
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Publishing shares this assistant&apos;s name, description, purpose, personality, and
              system instructions publicly in the marketplace. Private conversations and memories
              are never shared.
            </p>
          </div>
          <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={publishConsent}
              onChange={(e) => setPublishConsent(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-[#060913]"
            />
            <span>
              I confirm this configuration contains no sensitive secrets and consent to making it
              publicly discoverable.
            </span>
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPublishTarget(null);
                setPublishConsent(false);
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!publishConsent || publishBusy}
              onClick={() => void handleConfirmPublish()}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 cursor-pointer"
            >
              {publishBusy ? 'Publishing...' : 'Publish Assistant'}
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 px-6 py-14 text-center">
          <Bot className="h-10 w-10 text-slate-500" />
          <h2 className="mt-3 font-display text-base font-semibold text-white">
            {assistants.length === 0 ? 'No AI assistants yet' : 'No assistants match your filter'}
          </h2>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            {assistants.length === 0
              ? 'Build your first specialized assistant with custom system instructions and personality.'
              : 'Try clearing your search term or switching the model filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((assistant) => {
            const assistantThreads = conversations.filter((c) => c.assistantId === assistant.id);
            const messageCount = assistantThreads.reduce((sum, c) => sum + c.messages.length, 0);
            const isConfirmingDelete = confirmDeleteId === assistant.id;

            return (
              <article
                key={assistant.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 hover:border-slate-700 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3.5">
                    {!emblemError ? (
                      <img
                        src="/src/assets/images/assistant_emblem_core_1794856492584.jpg"
                        alt={`${assistant.name} emblem`}
                        referrerPolicy="no-referrer"
                        onError={() => setEmblemError(true)}
                        className="h-11 w-11 rounded-lg border border-slate-800 object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 shrink-0">
                        <Bot className="h-5 w-5 text-blue-400" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-display text-base font-semibold text-white">
                        {assistant.name}
                      </h2>
                      <p className="mt-0.5 truncate text-xs font-mono text-slate-400">
                        {getModelLabel(assistant.model)} · {assistant.purpose} ·{' '}
                        {assistant.isPublic ? 'Public' : 'Private'}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-300">{assistant.description}</p>

                  <p className="font-mono text-xs tabular-nums text-slate-500">
                    {assistantThreads.length} threads · {messageCount} messages · Updated{' '}
                    {formatRelativeTime(assistant.updatedAt)}
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-4">
                  {isConfirmingDelete ? (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs text-rose-300">
                        Delete assistant and {assistantThreads.length} thread(s)?
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deletingId === assistant.id}
                          className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmDelete(assistant.id)}
                          disabled={deletingId === assistant.id}
                          className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 cursor-pointer"
                        >
                          {deletingId === assistant.id ? 'Deleting...' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenMemory(assistant.id)}
                          title="Manage assistant memory"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Brain className="h-3.5 w-3.5 text-violet-400" />
                          <span>Memory</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onExportAssistant(assistant.id)}
                          title="Export configuration JSON"
                          className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => void onDuplicateAssistant(assistant.id)}
                              title="Duplicate assistant"
                              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
                            >
                              <CopyPlus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPublishTarget(assistant);
                                setPublishConsent(false);
                              }}
                              title="Publish to AI Marketplace"
                              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-slate-700 hover:text-blue-300 transition-colors cursor-pointer"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditAssistant(assistant)}
                              title="Edit assistant"
                              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(assistant.id)}
                              title="Delete assistant"
                              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenChat(assistant.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>Chat</span>
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
