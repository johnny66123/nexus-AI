import { useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  ExternalLink,
  Search,
} from 'lucide-react';
import type {
  ResearchConflict,
  ResearchSourceRecord,
  SourceReliabilityTier,
} from '../../shared/schema.ts';

interface ResearchSourcesPanelProps {
  sources: ResearchSourceRecord[];
  conflicts?: ResearchConflict[];
  canEdit: boolean;
  isLibraryMode?: boolean;
  onToggleSaved: (sourceId: string, saved: boolean) => Promise<void>;
}

function formatCitationText(
  source: ResearchSourceRecord,
  style: 'apa' | 'ieee' | 'md',
): string {
  const dateLabel = source.publicationDate ?? 'n.d.';
  if (style === 'md') {
    return `[${source.citationKey}] [${source.title}](${source.url}) (${source.domain}, ${dateLabel})`;
  }
  if (style === 'ieee') {
    return `[${source.citationKey}] "${source.title}," ${source.domain}, ${dateLabel}. [Online]. Available: ${source.url}`;
  }
  return `${source.domain} (${dateLabel}). ${source.title}. Retrieved from ${source.url}`;
}

export function ResearchSourcesPanel({
  sources,
  conflicts = [],
  canEdit,
  isLibraryMode = false,
  onToggleSaved,
}: ResearchSourcesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | SourceReliabilityTier>('all');
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [citationStyle, setCitationStyle] = useState<'apa' | 'ieee' | 'md'>('apa');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const uniqueCount = sources.filter((s) => !s.isDuplicate).length;
  const duplicateCount = sources.filter((s) => s.isDuplicate).length;

  const filtered = sources.filter((s) => {
    if (!showDuplicates && s.isDuplicate) return false;
    if (tierFilter !== 'all' && s.reliabilityTier !== tierFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.domain.toLowerCase().includes(q) ||
        s.snippet.toLowerCase().includes(q) ||
        s.citationKey.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCopyCitation = async (source: ResearchSourceRecord) => {
    const text = formatCitationText(source, citationStyle);
    await navigator.clipboard.writeText(text);
    setCopiedId(source.id);
    setTimeout(() => setCopiedId((prev) => (prev === source.id ? null : prev)), 1800);
  };

  const handleToggle = async (source: ResearchSourceRecord) => {
    if (!canEdit) return;
    setTogglingId(source.id);
    try {
      await onToggleSaved(source.id, !source.savedToLibrary);
    } finally {
      setTogglingId(null);
    }
  };

  const tierTextColor = (tier: SourceReliabilityTier) => {
    if (tier === 'high') return 'text-emerald-400';
    if (tier === 'moderate') return 'text-blue-300';
    if (tier === 'low') return 'text-amber-400';
    return 'text-slate-400';
  };

  return (
    <div className="space-y-6">
      {/* Conflicting Evidence Audit */}
      {conflicts.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>Conflicting Evidence Detected ({conflicts.length})</span>
          </div>
          <div className="divide-y divide-amber-500/20">
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="py-3 first:pt-1 last:pb-0 space-y-2 text-xs">
                <p className="font-semibold text-white">{conflict.topic}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="font-mono text-[11px] text-slate-400">
                      Position A · {conflict.sourceKeysA.join(', ') || 'Source unspecified'}
                    </p>
                    <p className="mt-1 text-slate-200">{conflict.claimA}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3">
                    <p className="font-mono text-[11px] text-slate-400">
                      Position B · {conflict.sourceKeysB.join(', ') || 'Source unspecified'}
                    </p>
                    <p className="mt-1 text-slate-200">{conflict.claimB}</p>
                  </div>
                </div>
                <p className="text-amber-200/90">Uncertainty Assessment: {conflict.uncertaintyNote}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter & Citation Format Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative min-w-[210px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter sources by title, domain, snippet..."
              aria-label="Filter sources"
              className="w-full rounded-lg border border-slate-800 bg-[#060913] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as 'all' | SourceReliabilityTier)}
            aria-label="Filter by reliability tier"
            className="rounded-lg border border-slate-800 bg-[#060913] px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Reliability Tiers</option>
            <option value="high">High Authority</option>
            <option value="moderate">Moderate / Web</option>
            <option value="low">Low / Community</option>
            <option value="unknown">Snippet / Unverified</option>
          </select>

          {!isLibraryMode && duplicateCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDuplicates((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDuplicates
                  ? 'border-blue-500/60 bg-blue-600/15 text-blue-200'
                  : 'border-slate-800 bg-[#060913] text-slate-400 hover:text-slate-200'
              }`}
            >
              {showDuplicates
                ? `Hiding ${duplicateCount} Duplicate(s)`
                : `Show ${duplicateCount} Duplicate(s)`}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-slate-400">Citation format</span>
          <div className="flex items-center rounded-lg border border-slate-800 bg-[#060913] p-0.5">
            {(['apa', 'ieee', 'md'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setCitationStyle(style)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase transition-colors cursor-pointer ${
                  citationStyle === style
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-1">
        <span className="font-mono tabular-nums">
          {filtered.length} shown · {uniqueCount} unique source{uniqueCount === 1 ? '' : 's'}
          {!isLibraryMode && duplicateCount > 0 ? ` · ${duplicateCount} duplicate merged` : ''}
        </span>
        <span>Reliability ratings reflect domain origin &amp; verification criteria—not automated truth.</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 px-6 py-12 text-center text-sm text-slate-400">
          {sources.length === 0
            ? isLibraryMode
              ? 'No sources saved to your library yet. Pin verified sources from any investigation report.'
              : 'No external sources were retrieved for this investigation.'
            : 'No sources match the active search or reliability filter.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
          {filtered.map((source) => {
            const isWebUrl =
              source.url.startsWith('http://') || source.url.startsWith('https://');
            return (
              <article key={source.id} className="p-5 space-y-2.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span className="font-mono font-semibold text-blue-300 tabular-nums">
                        [{source.citationKey}]
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{source.domain}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {source.publicationDate ?? 'Date unavailable'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-medium capitalize ${tierTextColor(source.reliabilityTier)}`}>
                        {source.reliabilityTier} reliability
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize text-slate-300">
                        {source.verificationStatus.replace('_', ' ')}
                      </span>
                      {source.isDuplicate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300">Duplicate URL/Title</span>
                        </>
                      )}
                    </div>

                    {isWebUrl ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-white hover:text-blue-300 transition-colors"
                      >
                        <span>{source.title}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </a>
                    ) : (
                      <h3 className="font-display text-sm font-semibold text-white">
                        {source.title}
                      </h3>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyCitation(source)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === source.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy Cite</span>
                        </>
                      )}
                    </button>

                    {canEdit && !source.isDuplicate && (
                      <button
                        type="button"
                        disabled={togglingId === source.id}
                        onClick={() => void handleToggle(source)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          source.savedToLibrary
                            ? 'border-blue-500/50 bg-blue-600/15 text-blue-200 hover:bg-blue-600/25'
                            : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {source.savedToLibrary ? (
                          <>
                            <BookmarkCheck className="h-3.5 w-3.5 text-blue-400" />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Bookmark className="h-3.5 w-3.5" />
                            <span>Save Source</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-300">{source.snippet}</p>

                <p className="text-[11px] text-slate-500">
                  Criteria: {source.reliabilityCriteria}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
