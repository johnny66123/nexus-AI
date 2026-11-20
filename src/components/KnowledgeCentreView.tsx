import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import type { KnowledgeDocument, KnowledgeSearchHit } from '../../shared/schema.ts';
import {
  askKnowledgeQuestion,
  deleteDocument,
  fetchDocuments,
  formatRelativeTime,
  searchKnowledge,
  uploadDocument,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface KnowledgeCentreViewProps {
  canEdit: boolean;
}

export function KnowledgeCentreView({ canEdit }: KnowledgeCentreViewProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<KnowledgeSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [question, setQuestion] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [qaResult, setQaResult] = useState<{
    answer: string;
    sources: KnowledgeSearchHit[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const docs = await fetchDocuments();
        setDocuments(docs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load knowledge documents.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canEdit) return;
    setError(null);
    setUploading(true);
    try {
      const doc = await uploadDocument(file);
      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const hits = await searchKnowledge(searchQuery);
      setSearchHits(hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const res = await askKnowledgeQuestion(
        question,
        selectedDocIds.length > 0 ? selectedDocIds : undefined,
      );
      setQaResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Knowledge Q&A failed.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Knowledge Centre
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Upload PDF, DOCX, CSV, XLSX, or TXT files for automatic text extraction, chunked
            search, AI summaries, and document-grounded Q&amp;A.
          </p>
        </div>

        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.csv,.xlsx,.xls,.txt,.md"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{uploading ? 'Indexing Document...' : 'Upload Document'}</span>
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Document Library */}
        <div className="space-y-4 lg:col-span-5">
          <h2 className="font-display text-base font-semibold text-white">
            Indexed Documents ({documents.length})
          </h2>

          {loading ? (
            <div className="h-48 animate-pulse rounded-xl bg-[#0B1120]" />
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-8 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-slate-500" />
              <p className="mt-3 text-sm font-medium text-white">No documents uploaded</p>
              <p className="mt-1 text-xs text-slate-400">
                Upload PDF, DOCX, CSV, or XLSX files to query them here or inside AI Chat.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => {
                const selected = selectedDocIds.includes(doc.id);
                const Icon =
                  doc.fileType === 'csv' || doc.fileType === 'xlsx' ? FileSpreadsheet : FileText;
                return (
                  <div
                    key={doc.id}
                    className={`rounded-xl border p-4 space-y-2 transition-colors ${
                      selected
                        ? 'border-blue-500/60 bg-blue-950/20'
                        : 'border-slate-800/80 bg-[#0B1120]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex min-w-0 flex-1 items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setSelectedDocIds((prev) =>
                              prev.includes(doc.id)
                                ? prev.filter((id) => id !== doc.id)
                                : [...prev, doc.id],
                            )
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-4 w-4 shrink-0 text-blue-400" />
                            <h3 className="truncate font-display text-sm font-semibold text-white">
                              {doc.title}
                            </h3>
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                            {doc.fileType.toUpperCase()} · {doc.chunkCount} chunks ·{' '}
                            {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB ·{' '}
                            {formatRelativeTime(doc.createdAt)}
                          </p>
                        </div>
                      </label>

                      {canEdit && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDocument(doc.id);
                            setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                            setSelectedDocIds((prev) => prev.filter((id) => id !== doc.id));
                          }}
                          aria-label={`Delete ${doc.title}`}
                          className="rounded p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-300">{doc.summary}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Search & Grounded Q&A */}
        <div className="space-y-6 lg:col-span-7">
          {/* Grounded Q&A */}
          <form
            onSubmit={handleAsk}
            className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Ask Uploaded Knowledge
              </h2>
              <p className="text-xs text-slate-400">
                {selectedDocIds.length > 0
                  ? `Scoping answers to ${selectedDocIds.length} selected document(s).`
                  : 'Searching across all uploaded documents.'}
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question grounded in your uploaded files..."
                className="flex-1 rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!canEdit || asking || documents.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span>Ask</span>
              </button>
            </div>

            {qaResult && (
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <div className="rounded-lg border border-slate-800 bg-[#060913] p-4">
                  <MarkdownRenderer content={qaResult.answer} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-400">Cited Excerpts</p>
                  {qaResult.sources.map((s, idx) => (
                    <div
                      key={`${s.documentId}-${s.chunkIndex}-${idx}`}
                      className="rounded-lg border border-slate-800/70 bg-[#060913] p-3 text-xs text-slate-300"
                    >
                      <p className="font-mono text-[11px] text-blue-300">
                        {s.documentTitle} · Chunk #{s.chunkIndex + 1}
                      </p>
                      <p className="mt-1 line-clamp-3 text-slate-400">{s.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>

          {/* Direct Chunk Search */}
          <form
            onSubmit={handleSearch}
            className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4"
          >
            <h2 className="font-display text-base font-semibold text-white">Document Search</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search exact terms inside spreadsheets, PDFs, and DOCX..."
                  className="w-full rounded-lg border border-slate-800 bg-[#060913] py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {searchHits.length > 0 && (
              <div className="space-y-2">
                {searchHits.map((hit, idx) => (
                  <div
                    key={`${hit.documentId}-${hit.chunkIndex}-${idx}`}
                    className="rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs"
                  >
                    <p className="font-mono text-[11px] text-violet-300">
                      {hit.documentTitle} · Chunk #{hit.chunkIndex + 1} · score {hit.score}
                    </p>
                    <p className="mt-1 text-slate-300">{hit.content}</p>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
