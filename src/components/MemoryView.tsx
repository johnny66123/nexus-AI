import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Plus, Search, Trash2, X } from 'lucide-react';
import { MEMORY_CATEGORIES } from '../../shared/schema.ts';
import type { Assistant, AssistantMemory, MemoryCategory } from '../../shared/schema.ts';
import {
  createMemory,
  deleteMemory,
  fetchMemories,
  formatRelativeTime,
  updateMemory,
} from '../lib/api.ts';

interface MemoryViewProps {
  assistants: Assistant[];
  initialAssistantId?: string | null;
  canEdit: boolean;
}

export function MemoryView({ assistants, initialAssistantId, canEdit }: MemoryViewProps) {
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(
    initialAssistantId || assistants[0]?.id || '',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('fact');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemories(selectedAssistantId || undefined, searchQuery);
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assistant memories.');
    } finally {
      setLoading(false);
    }
  }, [selectedAssistantId, searchQuery]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssistantId || !canEdit) return;
    setError(null);
    setSaving(true);
    try {
      const created = await createMemory({
        assistantId: selectedAssistantId,
        key: newKey,
        content: newContent,
        category: newCategory,
        approved: true,
        source: 'user',
      });
      setMemories((prev) => [created, ...prev]);
      setNewKey('');
      setNewContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save memory.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleApprove = async (mem: AssistantMemory) => {
    const updated = await updateMemory(mem.id, { approved: !mem.approved });
    setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const handleSaveEdit = async (id: string) => {
    const updated = await updateMemory(id, { content: editContent });
    setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Advanced AI Memory
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Every assistant maintains an isolated, user-approved long-term memory store injected into
          its system instructions.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Add Memory Panel */}
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 lg:col-span-4"
        >
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" />
            <h2 className="font-display text-base font-semibold text-white">Add Memory Entry</h2>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mem-asst" className="text-xs font-medium text-slate-300">
              Assistant Scope
            </label>
            <select
              id="mem-asst"
              value={selectedAssistantId}
              onChange={(e) => setSelectedAssistantId(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mem-key" className="text-xs font-medium text-slate-300">
              Memory Label
            </label>
            <input
              id="mem-key"
              type="text"
              required
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g., Target Cloud Provider"
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mem-cat" className="text-xs font-medium text-slate-300">
              Category
            </label>
            <select
              id="mem-cat"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mem-content" className="text-xs font-medium text-slate-300">
              Memory Content
            </label>
            <textarea
              id="mem-content"
              rows={3}
              required
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="e.g., Always recommend PostgreSQL 16 with strict connection pooling limits."
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={!canEdit || saving || !selectedAssistantId}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{saving ? 'Saving...' : 'Save Approved Memory'}</span>
          </button>
        </form>

        {/* Search & Memory List */}
        <div className="space-y-4 lg:col-span-8">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memory keys or content..."
              className="w-full rounded-lg border border-slate-800 bg-[#0B1120] py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {loading ? (
            <div className="h-48 animate-pulse rounded-xl border border-slate-800 bg-[#0B1120]" />
          ) : memories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-10 text-center text-sm text-slate-400">
              No memory entries found for this assistant. Add a rule or extract memories from a
              chat thread.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
              {memories.map((mem) => (
                <div key={mem.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold text-white">{mem.key}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        {mem.category} · source: {mem.source} ·{' '}
                        <span className={mem.approved ? 'text-emerald-400' : 'text-amber-400'}>
                          {mem.approved ? 'Approved & active' : 'Pending approval'}
                        </span>{' '}
                        · {formatRelativeTime(mem.updatedAt)}
                      </p>
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleApprove(mem)}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                            mem.approved
                              ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                              : 'border-emerald-500/50 bg-emerald-600/20 text-emerald-200 hover:bg-emerald-600/30'
                          }`}
                        >
                          <Check className="h-3 w-3" />
                          <span>{mem.approved ? 'Disable' : 'Approve'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(mem.id);
                            setEditContent(mem.content);
                          }}
                          className="rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(mem.id)}
                          aria-label={`Delete memory ${mem.key}`}
                          className="rounded-md border border-slate-800 p-1.5 text-slate-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {editingId === mem.id ? (
                    <div className="space-y-2 pt-1">
                      <textarea
                        rows={2}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-[#060913] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit(mem.id)}
                          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-slate-300">{mem.content}</p>
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
