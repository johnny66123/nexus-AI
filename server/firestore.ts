import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  AgentTask,
  Assistant,
  AuthUser,
  ChatMessage,
  Conversation,
  ProviderSetting,
  ResearchProject,
  ResearchSourceRecord,
  SpecialistAgent,
  UsageRecord,
} from '../shared/schema.ts';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as FirebaseAppletConfig;
        if (parsed && typeof parsed.projectId === 'string') {
          return parsed;
        }
      }
    } catch {
      // Try next candidate or env fallback
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || '',
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID?.trim() || '(default)',
  };
}

const firebaseConfig = loadFirebaseConfig();

let firestoreInitialized = false;

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
}

function ensureAdminApp() {
  if (!getApps().length) {
    const serviceAccount = parseServiceAccountFromEnv();
    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: firebaseConfig.projectId || undefined,
      });
    } else if (firebaseConfig.projectId) {
      initializeApp({
        projectId: firebaseConfig.projectId,
      });
    } else {
      initializeApp();
    }
  }
  firestoreInitialized = true;
}

function getAdminAuthInstance() {
  ensureAdminApp();
  return getAuth();
}

export function getAdminDbInstance() {
  ensureAdminApp();
  const dbId = firebaseConfig.firestoreDatabaseId;
  if (dbId && dbId !== '(default)') {
    return getFirestore(getApps()[0], dbId);
  }
  return getFirestore(getApps()[0]);
}

export function hasFirebaseServiceAccount(): boolean {
  return Boolean(parseServiceAccountFromEnv());
}

function isCloudSyncEnabled(): boolean {
  if (process.env.NEXUS_DISABLE_FIRESTORE_SYNC === '1') return false;
  if (process.env.NODE_ENV === 'test' || process.env.NEXUS_DB_PATH?.includes('nexus-test-')) {
    return false;
  }
  if (!firebaseConfig.projectId || firebaseConfig.projectId === 'remixed-project-id') {
    return false;
  }
  // On Vercel or environments without service account credentials, avoid noisy PERMISSION_DENIED writes
  if (!hasFirebaseServiceAccount() && (process.env.VERCEL === '1' || !process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return false;
  }
  return true;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  const auth = getAdminAuthInstance();
  return auth.verifyIdToken(idToken);
}

export function getFirebaseProjectInfo() {
  return {
    configured: Boolean(firebaseConfig.projectId && firebaseConfig.projectId !== 'remixed-project-id'),
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId ?? '(default)',
    initialized: firestoreInitialized,
    serviceAccountConfigured: hasFirebaseServiceAccount(),
  };
}

async function safeCloudWrite(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  try {
    await fn();
  } catch (err) {
    // Non-fatal in preview containers without ADC service-account credentials
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Firestore sync skipped for ${label}]:`, err instanceof Error ? err.message : String(err));
    }
  }
}

export function syncUserToFirestore(user: AuthUser) {
  void safeCloudWrite(`users/${user.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${user.id}`).set(
      {
        uid: user.id,
        email: user.email,
        displayName: user.displayName,
        roleTitle: user.roleTitle,
        role: user.role,
        status: user.status,
        defaultProvider: user.defaultProvider,
        defaultModel: user.defaultModel,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      { merge: true },
    );
  });
}

export function syncAssistantToFirestore(assistant: Assistant) {
  void safeCloudWrite(`assistants/${assistant.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${assistant.ownerUserId}/assistants/${assistant.id}`).set(
      {
        id: assistant.id,
        ownerUserId: assistant.ownerUserId,
        name: assistant.name,
        description: assistant.description,
        purpose: assistant.purpose,
        personality: assistant.personality,
        instructions: assistant.instructions,
        model: assistant.model,
        isPublic: assistant.isPublic,
        createdAt: assistant.createdAt,
        updatedAt: assistant.updatedAt,
      },
      { merge: true },
    );
  });
}

export function syncConversationAndMessagesToFirestore(
  conversation: Conversation,
  messagesToSync?: ChatMessage[],
) {
  void safeCloudWrite(`conversations/${conversation.id}`, async () => {
    const fsDb = getAdminDbInstance();
    const convRef = fsDb.doc(`users/${conversation.userId}/conversations/${conversation.id}`);
    await convRef.set(
      {
        id: conversation.id,
        assistantId: conversation.assistantId,
        userId: conversation.userId,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      { merge: true },
    );
    const list = messagesToSync ?? conversation.messages;
    for (const msg of list) {
      await convRef.collection('messages').doc(msg.id).set(
        {
          id: msg.id,
          userId: conversation.userId,
          conversationId: conversation.id,
          role: msg.role,
          content: msg.content.slice(0, 16000),
          modelUsed: msg.modelUsed ?? 'gemini-4-hydrogen',
          createdAt: msg.createdAt,
        },
        { merge: true },
      );
    }
  });
}

export function syncResearchProjectToFirestore(project: ResearchProject) {
  void safeCloudWrite(`researchProjects/${project.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${project.userId}/researchProjects/${project.id}`).set(
      {
        id: project.id,
        userId: project.userId,
        title: project.title.slice(0, 160),
        question: project.question.slice(0, 2000),
        researchType: project.researchType,
        visibility: project.visibility,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      { merge: true },
    );
    for (const src of project.sources.filter((s) => !s.isDuplicate)) {
      await syncResearchSourceToFirestore(src);
    }
  });
}

export async function syncResearchSourceToFirestore(source: ResearchSourceRecord) {
  await safeCloudWrite(`researchSources/${source.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${source.userId}/researchSources/${source.id}`).set(
      {
        id: source.id,
        projectId: source.projectId,
        userId: source.userId,
        citationKey: source.citationKey,
        title: source.title.slice(0, 300),
        url: source.url.slice(0, 1000),
        reliabilityTier: source.reliabilityTier,
        savedToLibrary: source.savedToLibrary,
        createdAt: source.createdAt,
      },
      { merge: true },
    );
  });
}

export function syncSpecialistAgentToFirestore(agent: SpecialistAgent) {
  void safeCloudWrite(`specialistAgents/${agent.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${agent.userId}/specialistAgents/${agent.id}`).set(
      {
        id: agent.id,
        userId: agent.userId,
        roleKey: agent.roleKey,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        preferredProvider: agent.preferredProvider,
        preferredModel: agent.preferredModel,
        enabled: agent.enabled,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      },
      { merge: true },
    );
  });
}

export function syncAgentTaskToFirestore(task: AgentTask) {
  void safeCloudWrite(`agentTasks/${task.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${task.userId}/agentTasks/${task.id}`).set(
      {
        id: task.id,
        userId: task.userId,
        agentId: task.agentId,
        title: task.title.slice(0, 160),
        inputPrompt: task.inputPrompt.slice(0, 8000),
        output: task.output.slice(0, 20000),
        providerUsed: task.providerUsed ?? 'google',
        modelUsed: task.modelUsed ?? 'gemini-4-hydrogen',
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.completedAt ?? task.createdAt,
      },
      { merge: true },
    );
  });
}

export function syncProviderSettingToFirestore(setting: ProviderSetting) {
  void safeCloudWrite(`providerSettings/${setting.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${setting.userId}/providerSettings/${setting.id}`).set(
      {
        id: setting.id,
        userId: setting.userId,
        provider: setting.provider,
        enabled: setting.enabled,
        defaultModel: setting.defaultModel,
        priority: setting.priority,
        timeoutMs: setting.timeoutMs,
        maxRetries: setting.maxRetries,
        fallbackEnabled: setting.fallbackEnabled,
        createdAt: setting.createdAt,
        updatedAt: setting.updatedAt,
      },
      { merge: true },
    );
  });
}

export function syncUsageRecordToFirestore(record: UsageRecord) {
  void safeCloudWrite(`usageRecords/${record.id}`, async () => {
    const fsDb = getAdminDbInstance();
    await fsDb.doc(`users/${record.userId}/usageRecords/${record.id}`).set(
      {
        id: record.id,
        userId: record.userId,
        provider: record.provider,
        model: record.model,
        taskType: record.taskType,
        status: record.status,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        totalTokens: record.totalTokens,
        latencyMs: record.latencyMs,
        fallbackUsed: record.fallbackUsed,
        createdAt: record.createdAt,
      },
      { merge: true },
    );
  });
}
