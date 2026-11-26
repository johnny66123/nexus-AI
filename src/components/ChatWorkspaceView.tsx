import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  FileText,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  PanelLeft,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  compileSystemPrompt,
  getModelLabel,
  getProviderForModel,
  sendMessageSchema,
} from '../../shared/schema.ts';
import type {
  AIModelId,
  Assistant,
  Conversation,
  KnowledgeDocument,
  UserProfile,
} from '../../shared/schema.ts';
import {
  extractMemoriesFromConversation,
  fetchDocuments,
  formatRelativeTime,
  generateVoiceProject,
  streamChatMessage,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface BrowserSpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface ChatWorkspaceViewProps {
  assistants: Assistant[];
  conversations: Conversation[];
  profile: UserProfile;
  canEdit: boolean;
  selectedModelOverride?: string;
  activeAssistantId: string | null;
  activeConversationId: string | null;
  onSelectAssistant: (assistantId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: (assistantId: string) => Promise<Conversation>;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onConversationUpdated: (conversation: Conversation) => void;
  onEditAssistant: (assistant: Assistant) => void;
  onCreateAssistant: () => void;
  onOpenMemory: (assistantId: string) => void;
}

function getStarterPrompts(assistant: Assistant): string[] {
  const lower = assistant.purpose.toLowerCase();
  if (lower.includes('engineering') || lower.includes('code')) {
    return [
      'Review an API endpoint design for idempotency and error resilience.',
      'Explain trade-offs between optimistic locking and distributed locks.',
      'Help me structure clean TypeScript validation for incoming webhooks.',
    ];
  }
  if (lower.includes('editorial') || lower.includes('writing')) {
    return [
      'Draft concise release notes for a major v2.0 platform launch.',
      'Tighten an executive summary so it leads with measurable outcomes.',
      'Create a structured outline for a technical product announcement.',
    ];
  }
  return [
    `Analyze a complex problem using your "${assistant.purpose}" methodology.`,
    'Outline key assumptions, trade-offs, and recommended next steps.',
    'Summarize the critical questions I should investigate before deciding.',
  ];
}

export function ChatWorkspaceView({
  assistants,
  conversations,
  profile,
  canEdit,
  selectedModelOverride = 'auto',
  activeAssistantId,
  activeConversationId,
  onSelectAssistant,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onConversationUpdated,
  onEditAssistant,
  onCreateAssistant,
  onOpenMemory,
}: ChatWorkspaceViewProps) {
  const [composerText, setComposerText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [showDocsPicker, setShowDocsPicker] = useState(false);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [extractingMemories, setExtractingMemories] = useState(false);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [confirmDeleteThreadId, setConfirmDeleteThreadId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceName, setVoiceName] = useState<'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr'>('Kore');
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [synthesizingMsgId, setSynthesizingMsgId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeAssistant =
    assistants.find((a) => a.id === activeAssistantId) ?? assistants[0] ?? null;

  const assistantThreads = activeAssistant
    ? [...conversations]
        .filter((c) => c.assistantId === activeAssistant.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];

  const activeConversation =
    assistantThreads.find((c) => c.id === activeConversationId) ?? assistantThreads[0] ?? null;

  useEffect(() => {
    void fetchDocuments()
      .then(setDocuments)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.id, activeConversation?.messages.length, streamingReply, pendingUserText]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
      audioRef.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleToggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setChatError(
        'Voice input via Web Speech API is not supported in this browser. Type your message or use Media Studio audio transcription.',
      );
      return;
    }

    setChatError(null);
    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i]?.[0]?.transcript;
        if (transcript) parts.push(transcript);
      }
      const spoken = parts.join(' ').trim();
      if (spoken) {
        setComposerText((prev) => (prev ? `${prev.trim()} ${spoken}` : spoken));
      }
    };
    recognition.onerror = (ev) => {
      setIsListening(false);
      if (ev.error && ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setChatError(`Voice recognition error: ${ev.error}`);
      }
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const handleStopVoicePlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMsgId(null);
  };

  const handleSpeakMessage = async (msgId: string, content: string) => {
    if (speakingMsgId === msgId) {
      handleStopVoicePlayback();
      return;
    }
    handleStopVoicePlayback();
    setChatError(null);
    const cleanText = content.replace(/[#`*>\[\]]/g, '').trim().slice(0, 1500);
    if (!cleanText) return;

    setSynthesizingMsgId(msgId);
    try {
      const project = await generateVoiceProject({
        title: `NEVUS Voice Reply`,
        text: cleanText,
        voiceName,
        askAssistantFirst: false,
      });
      if (project.audioDataUrl) {
        const audio = new Audio(project.audioDataUrl);
        audioRef.current = audio;
        setSpeakingMsgId(msgId);
        audio.onended = () => setSpeakingMsgId(null);
        audio.onerror = () => setSpeakingMsgId(null);
        await audio.play();
        return;
      }
    } catch {
      // Fallback to browser SpeechSynthesis if Gemini TTS API is unavailable
    } finally {
      setSynthesizingMsgId(null);
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.onend = () => setSpeakingMsgId(null);
      utterance.onerror = () => setSpeakingMsgId(null);
      setSpeakingMsgId(msgId);
      window.speechSynthesis.speak(utterance);
    } else {
      setChatError('Voice playback requires GEMINI_API_KEY TTS or browser SpeechSynthesis support.');
    }
  };

  const handleStopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setPendingUserText(null);
    setStreamingReply('');
  };

  const handleNewThread = async () => {
    if (!activeAssistant || isStreaming || !canEdit) return;
    setChatError(null);
    setValidationError(null);
    const created = await onCreateConversation(activeAssistant.id);
    onSelectConversation(created.id);
    setMobileThreadsOpen(false);
    textareaRef.current?.focus();
  };

  const handleExtractMemories = async () => {
    if (!activeConversation || !canEdit || extractingMemories) return;
    setExtractingMemories(true);
    setStatusNotice(null);
    setChatError(null);
    try {
      const proposed = await extractMemoriesFromConversation(activeConversation.id);
      setStatusNotice(
        proposed.length > 0
          ? `Proposed ${proposed.length} memory item(s) for review. Open Memory to approve them.`
          : 'No new durable facts or preferences detected in this thread.',
      );
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Memory extraction failed.');
    } finally {
      setExtractingMemories(false);
    }
  };

  const sendMessage = async (rawText: string) => {
    if (!activeAssistant || isStreaming || !canEdit) return;
    const parsed = sendMessageSchema.safeParse({ message: rawText });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Please enter a valid message.');
      return;
    }

    const cleanPrompt = parsed.data.message;
    setValidationError(null);
    setChatError(null);
    setStatusNotice(null);
    setLastFailedPrompt(null);
    setComposerText('');
    setPendingUserText(cleanPrompt);
    setStreamingReply('');
    setIsStreaming(true);

    let targetConversation = activeConversation;
    try {
      if (!targetConversation) {
        targetConversation = await onCreateConversation(activeAssistant.id);
        onSelectConversation(targetConversation.id);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const useHeaderOverride = Boolean(selectedModelOverride && selectedModelOverride !== 'auto');
      await streamChatMessage(
        targetConversation.id,
        cleanPrompt,
        {
          signal: controller.signal,
          onDelta: (chunk) => {
            setStreamingReply((prev) => prev + chunk);
          },
          onDone: ({ conversation }) => {
            onConversationUpdated(conversation);
            setPendingUserText(null);
            setStreamingReply('');
            setIsStreaming(false);
            abortRef.current = null;
          },
          onError: (errMsg) => {
            setChatError(errMsg);
            setLastFailedPrompt(cleanPrompt);
            setPendingUserText(null);
            setStreamingReply('');
            setIsStreaming(false);
            abortRef.current = null;
          },
        },
        selectedDocIds.length > 0 ? selectedDocIds : undefined,
        useHeaderOverride
          ? {
              preferredModel: selectedModelOverride,
              preferredProvider: getProviderForModel(selectedModelOverride),
            }
          : undefined,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setChatError(err instanceof Error ? err.message : 'Failed to send message.');
      setLastFailedPrompt(cleanPrompt);
      setPendingUserText(null);
      setStreamingReply('');
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(composerText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(composerText);
    }
  };

  if (!activeAssistant) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/70 px-6 py-16 text-center">
        <Bot className="h-10 w-10 text-slate-500" />
        <h1 className="mt-4 font-display text-xl font-semibold text-white">
          No assistants available for chat
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Create your first specialized AI assistant to start a conversation powered by Gemini.
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={onCreateAssistant}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors cursor-pointer"
          >
            Create AI Assistant
          </button>
        )}
      </div>
    );
  }

  const starterPrompts = getStarterPrompts(activeAssistant);

  const threadSidebarContent = (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-800/80 p-4">
        <label htmlFor="chat-assistant-select" className="block text-xs font-medium text-slate-400">
          Active Assistant
        </label>
        <div className="relative">
          <select
            id="chat-assistant-select"
            value={activeAssistant.id}
            disabled={isStreaming}
            onChange={(e) => {
              setChatError(null);
              setValidationError(null);
              onSelectAssistant(e.target.value);
            }}
            className="w-full appearance-none rounded-lg border border-slate-800 bg-[#060913] py-2 pl-3 pr-8 text-sm font-medium text-white focus:border-blue-500 focus:outline-none disabled:opacity-60"
          >
            {assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={handleNewThread}
            disabled={isStreaming}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600/15 px-3 py-2 text-xs font-medium text-blue-300 hover:bg-blue-600/25 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span>New Conversation</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <p className="px-2 pb-1 text-xs font-medium text-slate-500">
          Thread History ({assistantThreads.length})
        </p>

        {assistantThreads.length === 0 ? (
          <p className="px-2 py-4 text-xs text-slate-500">
            No saved threads for this assistant yet. Send a message to begin.
          </p>
        ) : (
          assistantThreads.map((conv) => {
            const isActive = activeConversation?.id === conv.id;
            const isConfirming = confirmDeleteThreadId === conv.id;
            return (
              <div
                key={conv.id}
                className={`group rounded-lg border transition-colors ${
                  isActive
                    ? 'border-blue-500/40 bg-blue-950/25'
                    : 'border-transparent hover:bg-slate-800/40'
                }`}
              >
                {isConfirming ? (
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
                    <span className="text-rose-300">Delete thread?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteThreadId(null)}
                        className="rounded px-2 py-0.5 text-slate-300 hover:bg-slate-800 cursor-pointer"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteConversation(conv.id);
                          setConfirmDeleteThreadId(null);
                        }}
                        className="rounded bg-rose-600 px-2 py-0.5 text-white hover:bg-rose-500 cursor-pointer"
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1 px-2.5 py-2">
                    <button
                      type="button"
                      disabled={isStreaming}
                      onClick={() => {
                        setChatError(null);
                        onSelectConversation(conv.id);
                        setMobileThreadsOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer disabled:opacity-60"
                    >
                      <p
                        className={`truncate text-xs font-medium ${
                          isActive ? 'text-white' : 'text-slate-300'
                        }`}
                      >
                        {conv.title}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                        {conv.messages.length} msgs · {formatRelativeTime(conv.updatedAt)}
                      </p>
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={isStreaming}
                        onClick={() => setConfirmDeleteThreadId(conv.id)}
                        aria-label={`Delete conversation ${conv.title}`}
                        className="rounded p-1 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-400 focus:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] min-h-[540px] max-w-6xl overflow-hidden rounded-xl border border-slate-800/80 bg-[#0B1120]">
      <aside className="hidden w-72 shrink-0 border-r border-slate-800/80 bg-[#080D1A] md:block">
        {threadSidebarContent}
      </aside>

      {mobileThreadsOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileThreadsOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] border-r border-slate-800 bg-[#080D1A]">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <span className="font-display text-sm font-semibold text-white">Conversations</span>
              <button
                type="button"
                onClick={() => setMobileThreadsOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-white cursor-pointer"
                aria-label="Close thread drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(100%-3rem)]">{threadSidebarContent}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-[#060913]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0B1120] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileThreadsOpen(true)}
              aria-label="Open conversations list"
              className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800 md:hidden cursor-pointer"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-base font-semibold text-white">
                {activeAssistant.name}
              </h1>
              <p className="truncate font-mono text-xs text-slate-400">
                {selectedModelOverride !== 'auto'
                  ? `${getModelLabel(selectedModelOverride as AIModelId)} (Header Override)`
                  : getModelLabel(activeAssistant.model)}
                {(selectedModelOverride !== 'auto'
                  ? selectedModelOverride
                  : activeAssistant.model) === 'gemini-4-hydrogen'
                  ? ` · Thinking: ${activeAssistant.thinkingLevel.toLowerCase()}`
                  : ''}{' '}
                · {activeAssistant.purpose}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              aria-label="Voice Assistant TTS Voice"
              value={voiceName}
              onChange={(e) =>
                setVoiceName(e.target.value as 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr')
              }
              title="Voice Assistant Playback Voice"
              className="hidden sm:block rounded-lg border border-slate-800 bg-[#060913] px-2 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500 focus:outline-none cursor-pointer"
            >
              <option value="Kore">Voice: Kore</option>
              <option value="Puck">Voice: Puck</option>
              <option value="Charon">Voice: Charon</option>
              <option value="Fenrir">Voice: Fenrir</option>
              <option value="Zephyr">Voice: Zephyr</option>
            </select>
            <button
              type="button"
              onClick={() => setShowDocsPicker((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedDocIds.length > 0 || showDocsPicker
                  ? 'border-blue-500/60 bg-blue-600/15 text-blue-200'
                  : 'border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Docs ({selectedDocIds.length})</span>
            </button>
            {canEdit && activeConversation && activeConversation.messages.length > 0 && (
              <button
                type="button"
                disabled={extractingMemories}
                onClick={() => void handleExtractMemories()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {extractingMemories ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Brain className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span className="hidden sm:inline">Extract Memory</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowInstructions((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showInstructions
                  ? 'border-violet-500/60 bg-violet-600/15 text-violet-200'
                  : 'border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Instructions</span>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => onEditAssistant(activeAssistant)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>

        {showDocsPicker && (
          <div className="border-b border-slate-800 bg-[#0B1120] px-4 py-3 sm:px-6 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-blue-300">
                Ground Chat with Knowledge Centre Documents
              </span>
              <button
                type="button"
                onClick={() => setShowDocsPicker(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                Done
              </button>
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-slate-400">
                No documents uploaded yet. Visit Knowledge Centre to upload PDF, DOCX, CSV, or
                XLSX files.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {documents.map((doc) => {
                  const active = selectedDocIds.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() =>
                        setSelectedDocIds((prev) =>
                          prev.includes(doc.id)
                            ? prev.filter((id) => id !== doc.id)
                            : [...prev, doc.id].slice(0, 5),
                        )
                      }
                      className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer ${
                        active
                          ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                          : 'border-slate-800 bg-[#060913] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {doc.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showInstructions && (
          <div className="border-b border-slate-800 bg-[#0B1120]/95 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="text-xs font-semibold text-violet-300">
                Active System Instructions (with Approved Memory)
              </span>
              <button
                type="button"
                onClick={() => onOpenMemory(activeAssistant.id)}
                className="text-xs text-blue-400 hover:underline cursor-pointer"
              >
                Manage Memories
              </button>
            </div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#060913] p-3 font-mono text-xs leading-relaxed text-slate-300">
              {compileSystemPrompt(activeAssistant, profile.responseFormatPreference)}
            </pre>
          </div>
        )}

        {statusNotice && (
          <div className="flex items-center justify-between border-b border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-200 sm:px-6">
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => onOpenMemory(activeAssistant.id)}
              className="font-medium text-emerald-300 underline cursor-pointer"
            >
              Review Memories
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {(!activeConversation || activeConversation.messages.length === 0) && !pendingUserText ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-[#0B1120]">
                <Bot className="h-6 w-6 text-blue-400" />
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold text-white">
                Start a conversation with {activeAssistant.name}
              </h2>
              <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-400">
                {activeAssistant.description}
              </p>

              {canEdit && (
                <div className="mt-6 grid w-full grid-cols-1 gap-2.5 text-left">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-xl border border-slate-800/80 bg-[#0B1120] px-4 py-3 text-sm text-slate-300 hover:border-blue-500/50 hover:text-white transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {activeConversation?.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-300">
                      {msg.role === 'user' ? profile.displayName : activeAssistant.name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatRelativeTime(msg.createdAt)}
                    </span>
                  </div>

                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-xl border border-blue-500/30 bg-blue-600/15 px-4 py-3 text-[15px] leading-relaxed text-slate-100 whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="w-full rounded-xl border border-slate-800/80 bg-[#0B1120] px-5 py-4 space-y-3">
                      <MarkdownRenderer content={msg.content} />
                      <div className="flex items-center justify-end border-t border-slate-800/60 pt-2">
                        <button
                          type="button"
                          disabled={synthesizingMsgId === msg.id}
                          onClick={() => void handleSpeakMessage(msg.id, msg.content)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#060913] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-blue-500/50 hover:text-white cursor-pointer"
                        >
                          {synthesizingMsgId === msg.id ? (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                          ) : speakingMsgId === msg.id ? (
                            <Square className="h-3 w-3 fill-current text-rose-400" />
                          ) : (
                            <Volume2 className="h-3 w-3 text-blue-400" />
                          )}
                          <span>
                            {synthesizingMsgId === msg.id
                              ? 'Generating Audio...'
                              : speakingMsgId === msg.id
                                ? 'Stop Voice'
                                : 'Speak Reply'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {pendingUserText && (
                <>
                  <div className="flex flex-col items-end">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-300">{profile.displayName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Sending</span>
                    </div>
                    <div className="max-w-[85%] rounded-xl border border-blue-500/30 bg-blue-600/15 px-4 py-3 text-[15px] leading-relaxed text-slate-100 whitespace-pre-wrap">
                      {pendingUserText}
                    </div>
                  </div>

                  <div className="flex flex-col items-start">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-slate-200">{activeAssistant.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5 font-mono text-blue-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{streamingReply ? 'Streaming response' : 'Thinking'}</span>
                      </span>
                    </div>
                    <div className="w-full rounded-xl border border-slate-800/80 bg-[#0B1120] px-5 py-4">
                      {streamingReply ? (
                        <MarkdownRenderer content={streamingReply} />
                      ) : (
                        <div className="flex items-center gap-2.5 text-sm text-slate-400">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                          <span>
                            Generating response with {getModelLabel(activeAssistant.model)}...
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {chatError && (
          <div className="border-t border-rose-500/30 bg-rose-950/35 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-sm text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <span>{chatError}</span>
              </div>
              {lastFailedPrompt && !isStreaming && (
                <button
                  type="button"
                  onClick={() => void sendMessage(lastFailedPrompt)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/30 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-800/80 bg-[#0B1120] px-4 py-3.5 sm:px-6"
        >
          <div className="mx-auto max-w-3xl space-y-2">
            {validationError && <p className="text-xs text-rose-400">{validationError}</p>}
            {!canEdit ? (
              <p className="text-xs text-slate-400">
                Read-only viewer role: sign in as a developer or admin to send chat messages.
              </p>
            ) : (
              <>
                <div className="flex items-end gap-3 rounded-xl border border-slate-800 bg-[#060913] p-2.5 focus-within:border-blue-500/70 transition-colors">
                  <textarea
                    ref={textareaRef}
                    rows={2}
                    value={composerText}
                    onChange={(e) => {
                      setComposerText(e.target.value);
                      if (validationError) setValidationError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isStreaming}
                    placeholder={`Message ${activeAssistant.name}...`}
                    aria-label="Chat message input"
                    maxLength={8000}
                    className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
                  />

                  <button
                    type="button"
                    disabled={isStreaming}
                    onClick={handleToggleVoiceInput}
                    title={isListening ? 'Stop voice capture' : 'Speak prompt (Voice Assistant)'}
                    aria-label={isListening ? 'Stop voice capture' : 'Start voice capture'}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isListening
                        ? 'border-rose-500/60 bg-rose-600/20 text-rose-200'
                        : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-blue-500/50 hover:text-white'
                    }`}
                  >
                    {isListening ? (
                      <MicOff className="h-3.5 w-3.5 animate-pulse" />
                    ) : (
                      <Mic className="h-3.5 w-3.5 text-blue-400" />
                    )}
                    <span className="hidden sm:inline">{isListening ? 'Listening...' : 'Voice'}</span>
                  </button>

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStopStreaming}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!composerText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Send</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Enter to send · Shift+Enter for newline</span>
                  <span className="font-mono tabular-nums">{composerText.length}/8000</span>
                </div>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
