import type {
  AgentTask,
  AIProviderId,
  ApiUsageEntry,
  Assistant,
  AssistantInput,
  AssistantMemory,
  AuditLogEntry,
  AuthUser,
  AutomationWorkflow,
  ChatMessage,
  Conversation,
  ErrorLogEntry,
  GatewayResponse,
  GatewayTaskType,
  KnowledgeDocument,
  KnowledgeSearchHit,
  LabExecutionResult,
  MarketplaceListing,
  MarketplaceReview,
  MasterExecutionResult,
  MediaProject,
  MemoryInput,
  ModelPerformanceMetric,
  OrchestrationRun,
  ProviderAvailabilityStatus,
  ProviderSettingUpdateInput,
  ResearchAgentContribution,
  ResearchAgentSpec,
  ResearchInvestigationInput,
  ResearchPipelineStage,
  ResearchProject,
  ResearchReport,
  ResearchSourceRecord,
  ResearchTypeMeta,
  ResearchVisibility,
  SpecialistAgent,
  SpecialistAgentUpdateInput,
  UsageRecord,
  UserProfile,
  UserProfileInput,
  UserRole,
  WorkflowInput,
  WorkflowRun,
} from '../../shared/schema.ts';
import type { LabWorkspaceRecord } from '../../server/db.ts';
import { getCurrentFirebaseIdToken, signOutFirebase } from './firebase.ts';

export interface OverviewData {
  stats: {
    assistantCount: number;
    conversationCount: number;
    totalMessages: number;
    documentCount: number;
    workflowCount: number;
    memoryCount: number;
  };
  assistants: Assistant[];
  recentConversations: Conversation[];
  profile: UserProfile;
}

export interface HealthStatus {
  ok: boolean;
  version: string;
  platform?: string;
  runtime?: string;
  databaseBackend?: string;
  sessionSecretConfigured?: boolean;
  googleOAuthConfigured?: boolean;
  googleMapsConfigured?: boolean;
  apiKeyConfigured: boolean;
  providers?: {
    google: boolean;
    anthropic: boolean;
    openai: boolean;
  };
  firebase?: {
    configured: boolean;
    projectId: string;
  };
  githubTokenConfigured: boolean;
  paidImageModelAvailable: boolean;
}

export interface AdminDashboardData {
  users: AuthUser[];
  auditLogs: AuditLogEntry[];
  apiUsage: ApiUsageEntry[];
  errorLogs: ErrorLogEntry[];
  analytics: {
    totalApiCalls: number;
    totalEstimatedTokens: number;
    avgLatencyMs: number;
    counts: {
      assistants: number;
      conversations: number;
      memories: number;
      documents: number;
      workflows: number;
      researchProjects?: number;
      errors: number;
    };
  };
}

const SESSION_STORAGE_KEY = 'nexus_session_token';
let memorySessionToken: string | null = null;
const unauthorizedListeners = new Set<(message: string) => void>();

export class UnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor(message = 'Authentication required. Please sign in.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export function onUnauthorized(listener: (message: string) => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function getClientSessionToken(): string | null {
  if (memorySessionToken) return memorySessionToken;
  try {
    const fromSession = window.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (fromSession) {
      memorySessionToken = fromSession;
      return fromSession;
    }
    const fromLocal = window.localStorage?.getItem(SESSION_STORAGE_KEY);
    if (fromLocal) {
      memorySessionToken = fromLocal;
      return fromLocal;
    }
  } catch {
    // Sandboxed iframe storage may be unavailable; in-memory token remains active
  }
  return null;
}

export function setClientSessionToken(token: string | null | undefined): void {
  if (!token) return;
  memorySessionToken = token;
  try {
    window.sessionStorage?.setItem(SESSION_STORAGE_KEY, token);
    window.localStorage?.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Ignore storage access restriction
  }
}

export function clearClientSessionToken(): void {
  memorySessionToken = null;
  try {
    window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    window.localStorage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage access restriction
  }
}

function notifyUnauthorized(message: string): void {
  clearClientSessionToken();
  for (const listener of unauthorizedListeners) {
    listener(message);
  }
}

function isPublicAuthEndpoint(url: string): boolean {
  return (
    url.startsWith('/api/auth/login') ||
    url.startsWith('/api/auth/register') ||
    url.startsWith('/api/auth/firebase') ||
    url.startsWith('/api/auth/logout') ||
    url.startsWith('/api/auth/session') ||
    url.startsWith('/api/health')
  );
}

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getClientSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await globalThis.fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 401 && !isPublicAuthEndpoint(input)) {
    const cloned = res.clone();
    const body = await cloned.json().catch(() => ({}));
    const msg =
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Your session has expired. Please sign in again.';
    notifyUnauthorized(msg);
  }

  return res;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    if (res.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }
  return data as T;
}

// Health & Auth
export async function fetchHealth(): Promise<HealthStatus> {
  const res = await apiFetch('/api/health');
  return parseJsonResponse<HealthStatus>(res);
}

export async function fetchSession(): Promise<{
  authenticated: boolean;
  user: AuthUser | null;
}> {
  const res = await apiFetch('/api/auth/session');
  const data = await parseJsonResponse<{
    authenticated: boolean;
    user: AuthUser | null;
    sessionToken?: string;
  }>(res);
  if (data.authenticated && data.user) {
    if (data.sessionToken) setClientSessionToken(data.sessionToken);
    return { authenticated: true, user: data.user };
  }

  // Fallback: if Firebase client still holds an authenticated user, restore backend session cleanly
  const fbToken = await getCurrentFirebaseIdToken();
  if (fbToken) {
    try {
      const user = await loginWithFirebaseIdToken(fbToken);
      return { authenticated: true, user };
    } catch {
      clearClientSessionToken();
    }
  } else {
    clearClientSessionToken();
  }

  return { authenticated: false, user: null };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonResponse<{ user: AuthUser; sessionToken?: string }>(res);
  if (data.sessionToken) setClientSessionToken(data.sessionToken);
  return data.user;
}

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
  roleTitle: string;
}): Promise<AuthUser> {
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ user: AuthUser; sessionToken?: string }>(res);
  if (data.sessionToken) setClientSessionToken(data.sessionToken);
  return data.user;
}

export async function loginWithFirebaseIdToken(idToken: string): Promise<AuthUser> {
  const res = await apiFetch('/api/auth/firebase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await parseJsonResponse<{ user: AuthUser; sessionToken?: string }>(res);
  if (data.sessionToken) setClientSessionToken(data.sessionToken);
  return data.user;
}

export async function logout(): Promise<void> {
  clearClientSessionToken();
  await Promise.allSettled([
    apiFetch('/api/auth/logout', { method: 'POST' }),
    signOutFirebase(),
  ]);
}

// Overview & Profile
export async function fetchOverview(): Promise<OverviewData> {
  const res = await apiFetch('/api/overview');
  return parseJsonResponse<OverviewData>(res);
}

export async function updateProfile(input: UserProfileInput): Promise<UserProfile> {
  const res = await apiFetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ profile: UserProfile }>(res);
  return data.profile;
}

// Module 1: Agent Factory
export async function fetchAssistants(): Promise<Assistant[]> {
  const res = await apiFetch('/api/assistants');
  const data = await parseJsonResponse<{ assistants: Assistant[] }>(res);
  return data.assistants;
}

export async function createAssistant(input: AssistantInput): Promise<Assistant> {
  const res = await apiFetch('/api/assistants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ assistant: Assistant }>(res);
  return data.assistant;
}

export async function updateAssistant(id: string, input: AssistantInput): Promise<Assistant> {
  const res = await apiFetch(`/api/assistants/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ assistant: Assistant }>(res);
  return data.assistant;
}

export async function duplicateAssistant(id: string): Promise<Assistant> {
  const res = await apiFetch(`/api/assistants/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
  const data = await parseJsonResponse<{ assistant: Assistant }>(res);
  return data.assistant;
}

export async function exportAssistantConfig(id: string): Promise<unknown> {
  const res = await apiFetch(`/api/assistants/${encodeURIComponent(id)}/export`);
  return parseJsonResponse<unknown>(res);
}

export async function importAssistantConfig(payload: unknown): Promise<Assistant> {
  const res = await apiFetch('/api/assistants/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ assistant: Assistant }>(res);
  return data.assistant;
}

export async function deleteAssistant(id: string): Promise<void> {
  const res = await apiFetch(`/api/assistants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

// Conversations & Chat
export async function fetchConversations(assistantId?: string): Promise<Conversation[]> {
  const url = assistantId
    ? `/api/conversations?assistantId=${encodeURIComponent(assistantId)}`
    : '/api/conversations';
  const res = await apiFetch(url);
  const data = await parseJsonResponse<{ conversations: Conversation[] }>(res);
  return data.conversations;
}

export async function createConversation(assistantId: string, title?: string): Promise<Conversation> {
  const res = await apiFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assistantId, title }),
  });
  const data = await parseJsonResponse<{ conversation: Conversation }>(res);
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

export interface StreamCallbacks {
  onDelta: (chunk: string) => void;
  onDone: (payload: {
    userMessage: ChatMessage;
    modelMessage: ChatMessage;
    conversation: Conversation;
  }) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamChatMessage(
  conversationId: string,
  message: string,
  callbacks: StreamCallbacks,
  documentIds?: string[],
  options?: {
    preferredProvider?: 'auto' | AIProviderId;
    preferredModel?: string;
  },
): Promise<void> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      documentIds,
      preferredProvider: options?.preferredProvider,
      preferredModel: options?.preferredModel,
    }),
    signal: callbacks.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const errMsg =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Chat request failed (${res.status})`;
    callbacks.onError(errMsg);
    return;
  }

  if (!res.body) {
    callbacks.onError('Streaming response body was empty.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const rawEvent of events) {
        const lines = rawEvent.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonText = line.slice(6).trim();
          if (!jsonText) continue;
          try {
            const payload = JSON.parse(jsonText) as
              | { type: 'delta'; text: string }
              | {
                  type: 'done';
                  userMessage: ChatMessage;
                  modelMessage: ChatMessage;
                  conversation: Conversation;
                }
              | { type: 'error'; error: string };

            if (payload.type === 'delta') {
              callbacks.onDelta(payload.text);
            } else if (payload.type === 'done') {
              completed = true;
              callbacks.onDone(payload);
            } else if (payload.type === 'error') {
              completed = true;
              callbacks.onError(payload.error);
            }
          } catch {
            // Ignore partial JSON fragment
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) {
    callbacks.onError('The response stream ended unexpectedly before saving.');
  }
}

// Module 3: Memory
export async function fetchMemories(assistantId?: string, q?: string): Promise<AssistantMemory[]> {
  const params = new URLSearchParams();
  if (assistantId) params.set('assistantId', assistantId);
  if (q) params.set('q', q);
  const res = await apiFetch(`/api/memories?${params.toString()}`);
  const data = await parseJsonResponse<{ memories: AssistantMemory[] }>(res);
  return data.memories;
}

export async function createMemory(input: MemoryInput): Promise<AssistantMemory> {
  const res = await apiFetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ memory: AssistantMemory }>(res);
  return data.memory;
}

export async function extractMemoriesFromConversation(
  conversationId: string,
): Promise<AssistantMemory[]> {
  const res = await apiFetch('/api/memories/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
  const data = await parseJsonResponse<{ proposedMemories: AssistantMemory[] }>(res);
  return data.proposedMemories;
}

export async function updateMemory(
  id: string,
  updates: Partial<Pick<AssistantMemory, 'key' | 'content' | 'category' | 'approved'>>,
): Promise<AssistantMemory> {
  const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await parseJsonResponse<{ memory: AssistantMemory }>(res);
  return data.memory;
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

// Module 2: Orchestration
export async function fetchOrchestrationRuns(): Promise<OrchestrationRun[]> {
  const res = await apiFetch('/api/orchestration');
  const data = await parseJsonResponse<{ runs: OrchestrationRun[] }>(res);
  return data.runs;
}

export async function runOrchestration(payload: {
  objective: string;
  agentIds: string[];
  sharedContext: string;
  contextApproved: boolean;
}): Promise<OrchestrationRun> {
  const res = await apiFetch('/api/orchestration/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ run: OrchestrationRun }>(res);
  return data.run;
}

// Module 4: Research Centre
export async function fetchResearchReports(): Promise<ResearchReport[]> {
  const res = await apiFetch('/api/research/reports');
  const data = await parseJsonResponse<{ reports: ResearchReport[] }>(res);
  return data.reports;
}

export async function runResearch(payload: {
  query: string;
  mode: 'web_search' | 'document_analysis' | 'combined';
  documentIds: string[];
}): Promise<ResearchReport> {
  const res = await apiFetch('/api/research/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ report: ResearchReport }>(res);
  return data.report;
}

// Module 4B: NEXUS Intelligence Engine
export interface ResearchDashboardData {
  projects: ResearchProject[];
  savedSources: ResearchSourceRecord[];
  allSources: ResearchSourceRecord[];
  agents: ResearchAgentSpec[];
  researchTypes: ResearchTypeMeta[];
  stats: {
    totalProjects: number;
    activeCount: number;
    completedCount: number;
    incompleteCount: number;
    savedSourcesCount: number;
    totalSourcesCount: number;
    dailyRunsUsed: number;
    dailyRunLimit: number;
    ownedProjectCount: number;
    maxProjectsPerUser: number;
  };
}

export async function fetchResearchDashboard(): Promise<ResearchDashboardData> {
  const res = await apiFetch('/api/research/dashboard');
  return parseJsonResponse<ResearchDashboardData>(res);
}

export async function streamResearchInvestigation(
  payload: ResearchInvestigationInput,
  callbacks: {
    onStarted?: (project: ResearchProject) => void;
    onStage?: (stage: ResearchPipelineStage) => void;
    onAgent?: (agent: ResearchAgentContribution) => void;
    onComplete: (project: ResearchProject) => void;
    onError: (message: string, project?: ResearchProject) => void;
  },
): Promise<void> {
  const res = await apiFetch('/api/research/investigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const msg =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Investigation failed with status ${res.status}`;
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  const dispatchBlock = (block: string) => {
    const lines = block.split('\n');
    let evName = currentEvent;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        evName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) return;
    try {
      const parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      if (evName === 'started' && parsed.project) {
        callbacks.onStarted?.(parsed.project as ResearchProject);
      } else if (evName === 'stage' && parsed.stage) {
        callbacks.onStage?.(parsed.stage as ResearchPipelineStage);
      } else if (evName === 'agent' && parsed.agent) {
        callbacks.onAgent?.(parsed.agent as ResearchAgentContribution);
      } else if (evName === 'complete' && parsed.project) {
        callbacks.onComplete(parsed.project as ResearchProject);
      } else if (evName === 'error') {
        callbacks.onError(
          typeof parsed.error === 'string' ? parsed.error : 'Investigation failed.',
          parsed.project as ResearchProject | undefined,
        );
      }
    } catch {
      // ignore malformed SSE chunk
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (block) dispatchBlock(block);
    }
  }
  if (buffer.trim()) {
    dispatchBlock(buffer.trim());
  }
}

export async function updateResearchProjectPrivacy(
  projectId: string,
  visibility: ResearchVisibility,
): Promise<ResearchProject> {
  const res = await apiFetch(`/api/research/projects/${projectId}/privacy`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility }),
  });
  const data = await parseJsonResponse<{ project: ResearchProject }>(res);
  return data.project;
}

export async function deleteResearchProject(projectId: string): Promise<void> {
  const res = await apiFetch(`/api/research/projects/${projectId}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

export async function toggleSourceSavedToLibrary(
  sourceId: string,
  saved: boolean,
): Promise<ResearchSourceRecord> {
  const res = await apiFetch(`/api/research/sources/${sourceId}/library`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ saved }),
  });
  const data = await parseJsonResponse<{ source: ResearchSourceRecord }>(res);
  return data.source;
}

export async function downloadResearchExport(
  projectId: string,
  title: string,
  format: 'pdf' | 'docx' | 'md',
): Promise<void> {
  const res = await apiFetch(`/api/research/projects/${projectId}/export?format=${format}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Export failed with status ${res.status}`,
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || projectId.slice(0, 12);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexus-${slug}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// Module 5: Development Lab
export async function fetchLabWorkspace(): Promise<LabWorkspaceRecord> {
  const res = await apiFetch('/api/lab/workspace');
  const data = await parseJsonResponse<{ workspace: LabWorkspaceRecord }>(res);
  return data.workspace;
}

export async function saveLabWorkspace(payload: {
  id: string;
  name: string;
  code: string;
  testCode: string;
}): Promise<LabWorkspaceRecord> {
  const res = await apiFetch('/api/lab/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ workspace: LabWorkspaceRecord }>(res);
  return data.workspace;
}

export async function executeLabCode(payload: {
  code: string;
  testCode: string;
  timeoutMs?: number;
}): Promise<LabExecutionResult> {
  const res = await apiFetch('/api/lab/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ result: LabExecutionResult }>(res);
  return data.result;
}

export async function runLabAiAssist(payload: {
  mode: 'generate' | 'debug' | 'write_tests';
  prompt: string;
  code: string;
  errorOutput?: string;
}): Promise<{ reply: string; extractedCode: string | null }> {
  const res = await apiFetch('/api/lab/ai-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ reply: string; extractedCode: string | null }>(res);
}

export async function browseGithubRepo(
  repo: string,
  filePath = '',
): Promise<
  | { type: 'dir'; entries: Array<{ name: string; path: string; type: string; size: number }> }
  | { type: 'file'; name: string; path: string; content: string }
> {
  const params = new URLSearchParams({ repo, path: filePath });
  const res = await apiFetch(`/api/lab/github?${params.toString()}`);
  return parseJsonResponse(res);
}

// Module 6: Automation Studio
export async function fetchAutomationData(): Promise<{
  workflows: AutomationWorkflow[];
  runs: WorkflowRun[];
}> {
  const res = await apiFetch('/api/automation/workflows');
  return parseJsonResponse<{ workflows: AutomationWorkflow[]; runs: WorkflowRun[] }>(res);
}

export async function createWorkflow(input: WorkflowInput): Promise<AutomationWorkflow> {
  const res = await apiFetch('/api/automation/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ workflow: AutomationWorkflow }>(res);
  return data.workflow;
}

export async function toggleWorkflow(id: string, enabled: boolean): Promise<AutomationWorkflow> {
  const res = await apiFetch(`/api/automation/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const data = await parseJsonResponse<{ workflow: AutomationWorkflow }>(res);
  return data.workflow;
}

export async function triggerWorkflow(id: string): Promise<WorkflowRun> {
  const res = await apiFetch(`/api/automation/workflows/${encodeURIComponent(id)}/trigger`, {
    method: 'POST',
  });
  const data = await parseJsonResponse<{ run: WorkflowRun }>(res);
  return data.run;
}

export async function approveWorkflowRun(runId: string): Promise<WorkflowRun> {
  const res = await apiFetch(`/api/automation/runs/${encodeURIComponent(runId)}/approve`, {
    method: 'POST',
  });
  const data = await parseJsonResponse<{ run: WorkflowRun }>(res);
  return data.run;
}

export async function rejectWorkflowRun(runId: string): Promise<WorkflowRun> {
  const res = await apiFetch(`/api/automation/runs/${encodeURIComponent(runId)}/reject`, {
    method: 'POST',
  });
  const data = await parseJsonResponse<{ run: WorkflowRun }>(res);
  return data.run;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await apiFetch(`/api/automation/workflows/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

// Module 7: Media Studio
export async function fetchMediaProjects(): Promise<MediaProject[]> {
  const res = await apiFetch('/api/media/projects');
  const data = await parseJsonResponse<{ projects: MediaProject[] }>(res);
  return data.projects;
}

export async function generateVoiceProject(payload: {
  title: string;
  text: string;
  voiceName: string;
  askAssistantFirst: boolean;
}): Promise<MediaProject> {
  const res = await apiFetch('/api/media/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ project: MediaProject }>(res);
  return data.project;
}

export async function transcribeMediaFile(file: Blob, title: string, filename: string): Promise<MediaProject> {
  const form = new FormData();
  form.append('title', title);
  form.append('audio', file, filename);
  const res = await apiFetch('/api/media/transcribe', {
    method: 'POST',
    body: form,
  });
  const data = await parseJsonResponse<{ project: MediaProject }>(res);
  return data.project;
}

export async function generateSvgProject(title: string, prompt: string): Promise<MediaProject> {
  const res = await apiFetch('/api/media/svg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, prompt }),
  });
  const data = await parseJsonResponse<{ project: MediaProject }>(res);
  return data.project;
}

export async function analyzeImageProject(file: File, prompt: string): Promise<MediaProject> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('image', file);
  const res = await apiFetch('/api/media/analyze-image', {
    method: 'POST',
    body: form,
  });
  const data = await parseJsonResponse<{ project: MediaProject }>(res);
  return data.project;
}

export async function deleteMediaProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/media/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

// Module 8: Knowledge Centre
export async function fetchDocuments(): Promise<KnowledgeDocument[]> {
  const res = await apiFetch('/api/knowledge/documents');
  const data = await parseJsonResponse<{ documents: KnowledgeDocument[] }>(res);
  return data.documents;
}

export async function uploadDocument(file: File, title?: string): Promise<KnowledgeDocument> {
  const form = new FormData();
  if (title?.trim()) form.append('title', title.trim());
  form.append('file', file);
  const res = await apiFetch('/api/knowledge/upload', {
    method: 'POST',
    body: form,
  });
  const data = await parseJsonResponse<{ document: KnowledgeDocument }>(res);
  return data.document;
}

export async function searchKnowledge(q: string): Promise<KnowledgeSearchHit[]> {
  const res = await apiFetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`);
  const data = await parseJsonResponse<{ hits: KnowledgeSearchHit[] }>(res);
  return data.hits;
}

export async function askKnowledgeQuestion(
  question: string,
  documentIds?: string[],
): Promise<{ answer: string; sources: KnowledgeSearchHit[] }> {
  const res = await apiFetch('/api/knowledge/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, documentIds }),
  });
  return parseJsonResponse<{ answer: string; sources: KnowledgeSearchHit[] }>(res);
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await apiFetch(`/api/knowledge/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

// Module 9: AI Marketplace
export async function fetchMarketplace(): Promise<{
  listings: MarketplaceListing[];
  reviews: MarketplaceReview[];
}> {
  const res = await apiFetch('/api/marketplace');
  return parseJsonResponse<{ listings: MarketplaceListing[]; reviews: MarketplaceReview[] }>(res);
}

export async function publishToMarketplace(payload: {
  assistantId: string;
  category?: string;
  userConsent: boolean;
}): Promise<MarketplaceListing> {
  const res = await apiFetch('/api/marketplace/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ listing: MarketplaceListing }>(res);
  return data.listing;
}

export async function installMarketplaceListing(id: string): Promise<Assistant> {
  const res = await apiFetch(`/api/marketplace/${encodeURIComponent(id)}/install`, {
    method: 'POST',
  });
  const data = await parseJsonResponse<{ assistant: Assistant }>(res);
  return data.assistant;
}

export async function submitMarketplaceReview(
  id: string,
  rating: number,
  comment: string,
): Promise<MarketplaceReview> {
  const res = await apiFetch(`/api/marketplace/${encodeURIComponent(id)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment }),
  });
  const data = await parseJsonResponse<{ review: MarketplaceReview }>(res);
  return data.review;
}

// Module 10: Administration
export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  const res = await apiFetch('/api/admin/dashboard');
  return parseJsonResponse<AdminDashboardData>(res);
}

export async function updateAdminUser(
  userId: string,
  updates: { role?: UserRole; status?: 'active' | 'suspended' },
): Promise<AuthUser> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await parseJsonResponse<{ user: AuthUser }>(res);
  return data.user;
}

export async function exportAdminBackup(): Promise<unknown> {
  const res = await apiFetch('/api/admin/backup');
  return parseJsonResponse<unknown>(res);
}

export async function restoreAdminBackup(payload: unknown): Promise<{ restoredCount: number }> {
  const res = await apiFetch('/api/admin/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ restoredCount: number }>(res);
}

// Module 11: NEXUS AI v3.0 — Model Gateway, Specialist Agents & Master Intelligence
export async function fetchGatewayProviders(): Promise<ProviderAvailabilityStatus[]> {
  const res = await apiFetch('/api/gateway/providers');
  const data = await parseJsonResponse<{ providers: ProviderAvailabilityStatus[] }>(res);
  return data.providers;
}

export async function updateGatewayProvider(
  provider: AIProviderId,
  input: ProviderSettingUpdateInput,
): Promise<ProviderAvailabilityStatus> {
  const res = await apiFetch(`/api/gateway/providers/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ provider: ProviderAvailabilityStatus }>(res);
  return data.provider;
}

export async function testGateway(payload: {
  prompt: string;
  systemInstruction?: string;
  provider?: 'auto' | AIProviderId;
  model?: string;
  taskType?: GatewayTaskType;
  allowFallback?: boolean;
  timeoutMs?: number;
}): Promise<GatewayResponse> {
  const res = await apiFetch('/api/gateway/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ response: GatewayResponse }>(res);
  return data.response;
}

export interface GatewayAnalyticsData {
  metrics: ModelPerformanceMetric[];
  records: UsageRecord[];
  totals: {
    totalCalls: number;
    totalTokens: number;
    fallbackCalls: number;
    errorCalls: number;
    avgLatencyMs: number;
  };
}

export async function fetchGatewayAnalytics(): Promise<GatewayAnalyticsData> {
  const res = await apiFetch('/api/gateway/analytics');
  return parseJsonResponse<GatewayAnalyticsData>(res);
}

export async function fetchSpecialistAgents(): Promise<{
  agents: SpecialistAgent[];
  recentTasks: AgentTask[];
}> {
  const res = await apiFetch('/api/agents');
  return parseJsonResponse<{ agents: SpecialistAgent[]; recentTasks: AgentTask[] }>(res);
}

export async function updateSpecialistAgent(
  id: string,
  input: SpecialistAgentUpdateInput,
): Promise<SpecialistAgent> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ agent: SpecialistAgent }>(res);
  return data.agent;
}

export async function fetchAgentTasks(agentId: string): Promise<{
  agent: SpecialistAgent;
  tasks: AgentTask[];
}> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/tasks`);
  return parseJsonResponse<{ agent: SpecialistAgent; tasks: AgentTask[] }>(res);
}

export async function dispatchAgentTask(
  agentId: string,
  payload: {
    title?: string;
    inputPrompt: string;
    preferredProvider?: 'auto' | AIProviderId;
    preferredModel?: string;
    externalActionRequested?: boolean;
    approvalGranted?: boolean;
  },
): Promise<AgentTask> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ task: AgentTask }>(res);
  return data.task;
}

export async function fetchMasterRuns(): Promise<MasterExecutionResult[]> {
  const res = await apiFetch('/api/master/runs');
  const data = await parseJsonResponse<{ runs: MasterExecutionResult[] }>(res);
  return data.runs;
}

export async function executeMasterRequest(payload: {
  request: string;
  preferredProvider?: 'auto' | AIProviderId;
  preferredModel?: string;
  agentIds?: string[];
  documentIds?: string[];
  externalActionRequested?: boolean;
  approvalGranted?: boolean;
}): Promise<MasterExecutionResult> {
  const res = await apiFetch('/api/master/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ run: MasterExecutionResult }>(res);
  return data.run;
}

// Module 12: NEVUS AI — Google Ecosystem Integration
export type GoogleServiceId =
  | 'search'
  | 'gmail'
  | 'drive'
  | 'docs'
  | 'sheets'
  | 'slides'
  | 'calendar'
  | 'maps'
  | 'contacts'
  | 'tasks'
  | 'photos'
  | 'youtube'
  | 'translate'
  | 'cloud';

export interface GoogleServiceStatusItem {
  id: GoogleServiceId;
  name: string;
  category: 'Productivity' | 'Intelligence & Search' | 'Location & Media' | 'Cloud & Platform';
  authType: 'oauth2' | 'gemini_key' | 'api_key_or_gemini' | 'api_key';
  requiredScopes: string[];
  requiredEnvVars: string[];
  description: string;
  supportedActions: string[];
  status: 'connected' | 'needs_oauth' | 'needs_api_key';
  detail: string;
}

export interface GoogleEcosystemStatusResponse {
  oauthConfigured: boolean;
  redirectUri: string;
  connection: {
    connected: boolean;
    googleEmail: string;
    grantedScopes: string[];
    connectedServices: string[];
    expiresAt: string | null;
    hasRefreshToken: boolean;
    authSource: 'oauth2' | 'firebase_popup';
    updatedAt: string;
  } | null;
  services: GoogleServiceStatusItem[];
}

export interface GoogleExecuteResult {
  requiresConfirmation?: boolean;
  confirmationSummary?: string;
  serviceId: GoogleServiceId;
  action: string;
  data?: unknown;
}

export async function fetchGoogleStatus(): Promise<GoogleEcosystemStatusResponse> {
  const res = await apiFetch('/api/google/status');
  return parseJsonResponse<GoogleEcosystemStatusResponse>(res);
}

export async function requestGoogleOAuthUrl(serviceIds?: GoogleServiceId[]): Promise<{
  configured: boolean;
  authUrl: string | null;
  redirectUri: string;
  scopes: string[];
  message?: string;
}> {
  const res = await apiFetch('/api/google/oauth/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceIds }),
  });
  return parseJsonResponse(res);
}

export async function connectGoogleAccessToken(
  accessToken: string,
  grantedScopes?: string[],
): Promise<GoogleEcosystemStatusResponse> {
  const res = await apiFetch('/api/google/connect-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, grantedScopes }),
  });
  return parseJsonResponse<GoogleEcosystemStatusResponse>(res);
}

export async function disconnectGoogleAccount(): Promise<{
  ok: boolean;
  status: GoogleEcosystemStatusResponse;
}> {
  const res = await apiFetch('/api/google/disconnect', { method: 'POST' });
  return parseJsonResponse(res);
}

export async function executeGoogleAction(
  action: string,
  input: Record<string, unknown> = {},
  confirmed = false,
): Promise<GoogleExecuteResult> {
  const res = await apiFetch('/api/google/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, input, confirmed }),
  });
  return parseJsonResponse<GoogleExecuteResult>(res);
}

export async function runGoogleCommand(
  command: string,
  confirmed = false,
): Promise<GoogleExecuteResult> {
  const res = await apiFetch('/api/google/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, confirmed }),
  });
  return parseJsonResponse<GoogleExecuteResult>(res);
}

export function formatRelativeTime(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return 'Just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
