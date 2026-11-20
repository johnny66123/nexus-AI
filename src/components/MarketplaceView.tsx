import { useEffect, useState } from 'react';
import { Download, MessageSquarePlus, Search, Star, Store } from 'lucide-react';
import { getModelLabel } from '../../shared/schema.ts';
import type { MarketplaceListing, MarketplaceReview } from '../../shared/schema.ts';
import {
  fetchMarketplace,
  formatRelativeTime,
  installMarketplaceListing,
  submitMarketplaceReview,
} from '../lib/api.ts';

interface MarketplaceViewProps {
  canEdit: boolean;
  onAssistantInstalled: () => Promise<void>;
}

export function MarketplaceView({ canEdit, onAssistantInstalled }: MarketplaceViewProps) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchMarketplace();
        setListings(data.listings);
        setReviews(data.reviews);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load AI Marketplace.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = listings.filter((l) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      l.name.toLowerCase().includes(q) ||
      l.description.toLowerCase().includes(q) ||
      l.category.toLowerCase().includes(q)
    );
  });

  const handleInstall = async (listing: MarketplaceListing) => {
    if (!canEdit) return;
    setError(null);
    setStatusMessage(null);
    setBusyId(listing.id);
    try {
      await installMarketplaceListing(listing.id);
      await onAssistantInstalled();
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id ? { ...item, downloads: item.downloads + 1 } : item,
        ),
      );
      setStatusMessage(`Imported "${listing.name}" into your AI Agent Factory.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListing || !canEdit) return;
    setError(null);
    try {
      const review = await submitMarketplaceReview(selectedListing.id, rating, comment);
      setReviews((prev) => [review, ...prev]);
      const data = await fetchMarketplace();
      setListings(data.listings);
      const updated = data.listings.find((l) => l.id === selectedListing.id) ?? null;
      setSelectedListing(updated);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post review.');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            AI Marketplace
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Discover specialized assistant blueprints, import configurations into your factory, and
            rate community assistants.
          </p>
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search marketplace..."
            className="w-full rounded-lg border border-slate-800 bg-[#0B1120] py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-[#0B1120]" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-12 text-center">
          <Store className="mx-auto h-9 w-9 text-slate-500" />
          <p className="mt-3 text-sm text-slate-400">No marketplace listings matched your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((listing) => (
            <article
              key={listing.id}
              className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-[#0B1120] p-5 space-y-4"
            >
              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-white">{listing.name}</h2>
                <p className="font-mono text-[11px] text-slate-400">
                  {listing.category} · {getModelLabel(listing.model)} · by {listing.publisherName}
                </p>
                <p className="text-sm leading-relaxed text-slate-300">{listing.description}</p>
              </div>

              <div className="space-y-3 border-t border-slate-800/70 pt-3">
                <div className="flex items-center justify-between font-mono text-xs tabular-nums text-slate-400">
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {listing.reviewCount > 0 ? listing.avgRating : '—'} ({listing.reviewCount})
                  </span>
                  <span>{listing.downloads} imports</span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedListing(listing)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white cursor-pointer"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    <span>Reviews</span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busyId === listing.id}
                      onClick={() => void handleInstall(listing)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>{busyId === listing.id ? 'Importing...' : 'Import'}</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Selected Listing Reviews Panel */}
      {selectedListing && (
        <section className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                {selectedListing.name} — Reviews &amp; Instructions
              </h2>
              <p className="text-xs text-slate-400">
                Average rating: {selectedListing.avgRating}/5 across {selectedListing.reviewCount}{' '}
                review(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedListing(null)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Close
            </button>
          </div>

          <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#060913] p-4 font-mono text-xs text-slate-300">
            {selectedListing.instructions}
          </pre>

          {canEdit && (
            <form onSubmit={handleAddReview} className="flex flex-col gap-3 sm:flex-row">
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white"
              >
                {[5, 4, 3, 2, 1].map((r) => (
                  <option key={r} value={r}>
                    {r} Stars
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share feedback on this assistant's real-world accuracy..."
                className="flex-1 rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Post Review
              </button>
            </form>
          )}

          <div className="space-y-2">
            {reviews
              .filter((r) => r.listingId === selectedListing.id)
              .map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-medium text-slate-200">{r.authorName}</span>
                    <span className="font-mono">
                      {r.rating}/5 · {formatRelativeTime(r.createdAt)}
                    </span>
                  </div>
                  <p className="text-slate-300">{r.comment}</p>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
