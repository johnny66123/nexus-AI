import { useState } from 'react';
import { ArrowRight, MessageSquare, Search, Trash2 } from 'lucide-react';
import type { Assistant, Conversation } from '../../shared/schema.ts';
import { formatRelativeTime } from '../lib/api.ts';

interface ConversationsViewProps {
  assistants: Assistant[];
  conversations: Conversation[];
  canEdit?: boolean;
  onOpenChat: (assistantId: string, conversationId: string) => void;
  onDeleteConversation: (id: string) => Promise<void>;
}

export function ConversationsView({
  assistants,
  conversations,
  canEdit = true,
  onOpenChat,
  onDeleteConversation,
}: ConversationsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [assistantFilter, setAssistantFilter] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const assistantMap = new Map(assistants.map((a) => [a.id, a]));
  const query = searchQuery.trim().toLowerCase();

  const filtered = [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((conv) => {
      const matchesAssistant =
        assistantFilter === 'all' || conv.assistantId === assistantFilter;
      const assistantName = assistantMap.get(conv.assistantId)?.name.toLowerCase() ?? '';
      const matchesQuery =
        !query ||
        conv.title.toLowerCase().includes(query) ||
        assistantName.includes(query) ||
        conv.messages.some((m) => m.content.toLowerCase().includes(query));
      return matchesAssistant && matchesQuery;
    });

  const handleConfirmDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteConversation(id);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Recent Conversations
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Browse and resume persistent conversation threads across all specialized assistants.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles, assistants, or messages..."
            aria-label="Search conversations"
            className="w-full rounded-lg border border-slate-800 bg-[#0B1120] py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <select
          value={assistantFilter}
          onChange={(e) => setAssistantFilter(e.target.value)}
          aria-label="Filter by assistant"
          className="rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">All Assistants</option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 px-6 py-14 text-center">
          <MessageSquare className="h-9 w-9 text-slate-500" />
          <h2 className="mt-3 font-display text-base font-semibold text-white">
            {conversations.length === 0 ? 'No saved conversations' : 'No matching conversations'}
          </h2>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            {conversations.length === 0
              ? 'Open any assistant in the Chat Workspace to begin a conversation.'
              : 'Adjust your search query or assistant filter to view other threads.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
          {filtered.map((conv) => {
            const assistant = assistantMap.get(conv.assistantId);
            const lastMsg = conv.messages[conv.messages.length - 1];
            const isConfirming = confirmDeleteId === conv.id;

            return (
              <div
                key={conv.id}
                className="flex flex-col gap-3 px-5 py-4 hover:bg-slate-800/25 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-medium text-violet-300">
                      {assistant?.name ?? 'Removed Assistant'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {conv.messages.length} {conv.messages.length === 1 ? 'message' : 'messages'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </div>
                  <p className="truncate font-medium text-white">{conv.title}</p>
                  {lastMsg ? (
                    <p className="truncate text-xs text-slate-400">
                      {lastMsg.role === 'user' ? 'You: ' : ''}
                      {lastMsg.content}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">Empty thread — no messages yet</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isConfirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingId === conv.id}
                        className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmDelete(conv.id)}
                        disabled={deletingId === conv.id}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 cursor-pointer"
                      >
                        {deletingId === conv.id ? 'Deleting...' : 'Confirm'}
                      </button>
                    </>
                  ) : (
                    <>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(conv.id)}
                          aria-label={`Delete ${conv.title}`}
                          className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {assistant && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(assistant.id, conv.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>Resume</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
