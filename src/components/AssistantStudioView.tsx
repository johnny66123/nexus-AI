import { useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Cpu, Sparkles } from 'lucide-react';
import {
  AI_MODELS,
  PERSONALITY_PRESETS,
  PURPOSE_PRESETS,
  THINKING_LEVELS,
  assistantInputSchema,
  compileSystemPrompt,
} from '../../shared/schema.ts';
import type {
  AIModelId,
  Assistant,
  AssistantInput,
  ThinkingLevelOption,
  UserProfile,
} from '../../shared/schema.ts';

interface AssistantStudioViewProps {
  editingAssistant: Assistant | null;
  profile: UserProfile;
  onCancel: () => void;
  onSubmit: (input: AssistantInput, existingId?: string) => Promise<void>;
}

export function AssistantStudioView({
  editingAssistant,
  profile,
  onCancel,
  onSubmit,
}: AssistantStudioViewProps) {
  const [name, setName] = useState(editingAssistant?.name ?? '');
  const [description, setDescription] = useState(editingAssistant?.description ?? '');
  const [purpose, setPurpose] = useState(editingAssistant?.purpose ?? 'Research & Synthesis');
  const [category, setCategory] = useState(editingAssistant?.category ?? 'Research & Synthesis');
  const [personality, setPersonality] = useState(
    editingAssistant?.personality ?? PERSONALITY_PRESETS[0],
  );
  const [instructions, setInstructions] = useState(editingAssistant?.instructions ?? '');
  const [model, setModel] = useState<AIModelId>(editingAssistant?.model ?? profile.defaultModel);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>(
    editingAssistant?.thinkingLevel ?? profile.defaultThinkingLevel,
  );
  const [isPublic, setIsPublic] = useState<boolean>(editingAssistant?.isPublic ?? false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedModelInfo = AI_MODELS.find((m) => m.id === model);
  const previewPrompt = compileSystemPrompt(
    {
      name: name.trim() || 'Untitled Assistant',
      purpose: purpose.trim() || 'General Assistance',
      personality: personality.trim() || 'Clear and helpful',
      instructions:
        instructions.trim() || 'Enter specialised instructions to preview the system prompt.',
    },
    profile.responseFormatPreference,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const payload: AssistantInput = {
      name,
      description,
      purpose,
      personality,
      instructions,
      model,
      thinkingLevel,
      isPublic,
      category: category.trim() || purpose.trim() || 'General',
    };

    const parsed = assistantInputSchema.safeParse(payload);
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
    setSubmitting(true);
    try {
      await onSubmit(parsed.data, editingAssistant?.id);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to save assistant.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          {editingAssistant ? `Edit ${editingAssistant.name}` : 'Create AI Assistant'}
        </h1>
        <p className="text-sm text-slate-400">
          Configure specialised instructions, visibility, and Gemini foundation model parameters.
        </p>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-6 rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-7"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="asst-name" className="text-sm font-medium text-slate-200">
                Assistant Name
              </label>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {name.trim().length}/60
              </span>
            </div>
            <input
              id="asst-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Meridian Security Auditor"
              maxLength={60}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            {fieldErrors.name && <p className="text-xs text-rose-400">{fieldErrors.name}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="asst-desc" className="text-sm font-medium text-slate-200">
                Description
              </label>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {description.trim().length}/240
              </span>
            </div>
            <textarea
              id="asst-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summarize what this assistant helps users accomplish..."
              maxLength={240}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            {fieldErrors.description && (
              <p className="text-xs text-rose-400">{fieldErrors.description}</p>
            )}
          </div>

          <div className="space-y-2.5">
            <label htmlFor="asst-purpose" className="text-sm font-medium text-slate-200">
              Purpose & Specialisation
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PURPOSE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setPurpose(preset);
                    setCategory(preset);
                  }}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    purpose === preset
                      ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                      : 'border-slate-800 bg-[#060913] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              id="asst-purpose"
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            {fieldErrors.purpose && <p className="text-xs text-rose-400">{fieldErrors.purpose}</p>}
          </div>

          <div className="space-y-2.5">
            <label htmlFor="asst-personality" className="text-sm font-medium text-slate-200">
              Personality & Tone
            </label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {PERSONALITY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPersonality(preset)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                    personality === preset
                      ? 'border-violet-500/60 bg-violet-600/15 text-violet-200'
                      : 'border-slate-800 bg-[#060913] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              id="asst-personality"
              type="text"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              maxLength={240}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            {fieldErrors.personality && (
              <p className="text-xs text-rose-400">{fieldErrors.personality}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="asst-instructions" className="text-sm font-medium text-slate-200">
                Specialised Instructions
              </label>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {instructions.trim().length}/4000
              </span>
            </div>
            <textarea
              id="asst-instructions"
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Specify reasoning guidelines, formatting expectations, and domain constraints..."
              maxLength={4000}
              className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm leading-relaxed text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            {fieldErrors.instructions && (
              <p className="text-xs text-rose-400">{fieldErrors.instructions}</p>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-200">AI Model Selection</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {AI_MODELS.map((item) => {
                const isSelected = model === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setModel(item.id)}
                    className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/25'
                        : 'border-slate-800 bg-[#060913] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-semibold text-white">
                        {item.label}
                      </span>
                      {isSelected && <Check className="h-4 w-4 text-blue-400 shrink-0" />}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{item.summary}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-500">{item.id}</p>
                  </button>
                );
              })}
            </div>

            {selectedModelInfo?.supportsThinking && (
              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs font-medium text-slate-300">
                  Reasoning Depth (Thinking Level)
                </span>
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#060913] p-1">
                  {THINKING_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setThinkingLevel(level)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        thinkingLevel === level
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {level.charAt(0) + level.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060913] px-4 py-3">
            <div>
              <p className="text-xs font-medium text-slate-200">Workspace Visibility</p>
              <p className="text-[11px] text-slate-400">
                Private assistants stay internal unless explicitly published to Marketplace.
              </p>
            </div>
            <div className="flex gap-1 rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                  !isPublic ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                Private
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                  isPublic ? 'bg-blue-600 text-white' : 'text-slate-400'
                }`}
              >
                Public
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800/80 pt-5">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              <span>
                {submitting
                  ? 'Saving...'
                  : editingAssistant
                    ? 'Save Changes'
                    : 'Create Assistant'}
              </span>
            </button>
          </div>
        </form>

        <aside className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="h-4 w-4 text-violet-400" />
              <h2>Compiled System Prompt</h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Includes security boundaries against prompt injection and automatically appends
              approved long-term memories at runtime.
            </p>
            <pre className="mt-4 max-h-[440px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#060913] p-4 font-mono text-xs leading-relaxed text-slate-300">
              {previewPrompt}
            </pre>
          </div>
        </aside>
      </div>
    </div>
  );
}
