import { useState } from 'react';
import { AlertCircle, CheckCircle2, LogOut, Save, User } from 'lucide-react';
import {
  AI_MODELS,
  RESEARCH_VISIBILITIES,
  RESPONSE_FORMAT_PREFERENCES,
  THINKING_LEVELS,
  userProfileSchema,
} from '../../shared/schema.ts';
import type {
  AIModelId,
  AIProviderId,
  ResearchVisibility,
  ResponseFormatPreference,
  ThinkingLevelOption,
  UserProfile,
  UserProfileInput,
} from '../../shared/schema.ts';

interface SettingsProfileViewProps {
  profile: UserProfile;
  onSaveProfile: (input: UserProfileInput) => Promise<void>;
  onLogout: () => Promise<void>;
}

export function SettingsProfileView({
  profile,
  onSaveProfile,
  onLogout,
}: SettingsProfileViewProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [roleTitle, setRoleTitle] = useState(profile.roleTitle);
  const [email, setEmail] = useState(profile.email);
  const [defaultProvider, setDefaultProvider] = useState<'auto' | AIProviderId>(
    profile.defaultProvider ?? 'auto',
  );
  const [defaultModel, setDefaultModel] = useState<AIModelId>(profile.defaultModel);
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<ThinkingLevelOption>(
    profile.defaultThinkingLevel,
  );
  const [responseFormatPreference, setResponseFormatPreference] =
    useState<ResponseFormatPreference>(profile.responseFormatPreference);
  const [defaultResearchVisibility, setDefaultResearchVisibility] = useState<ResearchVisibility>(
    profile.defaultResearchVisibility ?? 'private',
  );

  const [avatarError, setAvatarError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSavedSuccess(false);

    const payload: UserProfileInput = {
      displayName,
      roleTitle,
      email,
      defaultProvider,
      defaultModel,
      defaultThinkingLevel,
      responseFormatPreference,
      defaultResearchVisibility,
    };

    const parsed = userProfileSchema.safeParse(payload);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      await onSaveProfile(parsed.data);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Settings &amp; Profile
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage your workspace identity, default AI model parameters, and active session.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{serverError}</span>
        </div>
      )}

      {savedSuccess && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>Profile and workspace preferences saved.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <section className="space-y-6 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {!avatarError ? (
              <img
                src="/src/assets/images/avatar_workspace_owner_1794856492097.jpg"
                alt={displayName || 'Workspace owner avatar'}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="h-16 w-16 rounded-xl border border-slate-700 object-cover shrink-0"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 shrink-0">
                <User className="h-7 w-7 text-blue-400" />
              </div>
            )}
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Workspace Profile
              </h2>
              <p className="mt-0.5 font-mono text-xs text-slate-400">
                Access Role: <span className="text-blue-300">{profile.role}</span> · Displayed in
                chat and audit records.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="profile-name" className="text-sm font-medium text-slate-200">
                Display Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              {fieldErrors.displayName && (
                <p className="text-xs text-rose-400">{fieldErrors.displayName}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-role" className="text-sm font-medium text-slate-200">
                Role / Title
              </label>
              <input
                id="profile-role"
                type="text"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                maxLength={80}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              {fieldErrors.roleTitle && (
                <p className="text-xs text-rose-400">{fieldErrors.roleTitle}</p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="profile-email" className="text-sm font-medium text-slate-200">
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={120}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              {fieldErrors.email && <p className="text-xs text-rose-400">{fieldErrors.email}</p>}
            </div>
          </div>
        </section>

        <section className="space-y-5 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              AI Workspace Defaults
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Default Gemini model configuration for newly created assistants and response style.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="default-provider" className="text-sm font-medium text-slate-200">
                Default Provider
              </label>
              <select
                id="default-provider"
                value={defaultProvider}
                onChange={(e) => setDefaultProvider(e.target.value as 'auto' | AIProviderId)}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="auto">Auto (Master AI Routing)</option>
                <option value="google">Google Gemini</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="default-model" className="text-sm font-medium text-slate-200">
                Default Model
              </label>
              <select
                id="default-model"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value as AIModelId)}
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.provider})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">
                Default Reasoning Depth
              </label>
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#060913] p-1">
                {THINKING_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDefaultThinkingLevel(level)}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      defaultThinkingLevel === level
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {level.charAt(0) + level.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200">
              Global Response Style Preference
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {RESPONSE_FORMAT_PREFERENCES.map((pref) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => setResponseFormatPreference(pref)}
                  className={`rounded-lg border px-4 py-2.5 text-left transition-colors cursor-pointer ${
                    responseFormatPreference === pref
                      ? 'border-violet-500 bg-violet-950/25 text-white'
                      : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-semibold capitalize">{pref}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {pref === 'concise'
                      ? 'Tight, direct answers'
                      : pref === 'balanced'
                        ? 'Clear depth & brevity'
                        : 'Thorough explanations'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-200">
              Default Research Privacy
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {RESEARCH_VISIBILITIES.map((vis) => (
                <button
                  key={vis}
                  type="button"
                  onClick={() => setDefaultResearchVisibility(vis)}
                  className={`rounded-lg border px-4 py-2.5 text-left transition-colors cursor-pointer ${
                    defaultResearchVisibility === vis
                      ? 'border-blue-500 bg-blue-950/25 text-white'
                      : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-semibold capitalize">
                    {vis === 'private' ? 'Private (Only Me)' : 'Workspace Shared'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {vis === 'private'
                      ? 'Research projects and sources remain isolated to your account.'
                      : 'Collaborators in this workspace can inspect reports and saved sources.'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
