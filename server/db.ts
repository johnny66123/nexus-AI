import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { WORKSPACE_LIMITS } from '../shared/schema.ts';
import type {
  AgentTask,
  AIModelId,
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
  GatewayTaskType,
  KnowledgeDocument,
  KnowledgeSearchHit,
  MarketplaceListing,
  MarketplaceReview,
  MasterExecutionResult,
  MediaProject,
  MemoryInput,
  ModelPerformanceMetric,
  OrchestrationRun,
  ProviderSetting,
  ProviderSettingUpdateInput,
  ResearchAgentContribution,
  ResearchAgentId,
  ResearchClaimCitation,
  ResearchConflict,
  ResearchPipelineStage,
  ResearchProject,
  ResearchProjectStatus,
  ResearchReport,
  ResearchSourceRecord,
  ResearchType,
  ResearchVisibility,
  ResponseFormatPreference,
  SearchHealthStatus,
  SourceReliabilityTier,
  SourceVerificationStatus,
  SpecialistAgent,
  SpecialistAgentUpdateInput,
  SpecialistRoleKey,
  StructuredResearchReport,
  ThinkingLevelOption,
  UsageRecord,
  UserProfile,
  UserProfileInput,
  UserRole,
  WorkflowInput,
  WorkflowRun,
} from '../shared/schema.ts';
import {
  syncAgentTaskToFirestore,
  syncAssistantToFirestore,
  syncConversationAndMessagesToFirestore,
  syncProviderSettingToFirestore,
  syncResearchProjectToFirestore,
  syncResearchSourceToFirestore,
  syncSpecialistAgentToFirestore,
  syncUsageRecordToFirestore,
  syncUserToFirestore,
} from './firestore.ts';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from './security.ts';

export interface GoogleConnectionRecord {
  userId: string;
  googleEmail: string;
  grantedScopes: string[];
  connectedServices: string[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  authSource: 'oauth2' | 'firebase_popup';
  updatedAt: string;
}

export interface WorkspaceCloudSnapshot {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface LabWorkspaceRecord {
  id: string;
  userId: string;
  name: string;
  code: string;
  testCode: string;
  updatedAt: string;
}

interface LegacyJsonStore {
  assistants?: Array<{
    id: string;
    name: string;
    description: string;
    purpose: string;
    personality: string;
    instructions: string;
    model: AIModelId;
    thinkingLevel?: ThinkingLevelOption;
    createdAt: string;
    updatedAt: string;
  }>;
  conversations?: Array<{
    id: string;
    assistantId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
  }>;
  profile?: {
    displayName?: string;
    roleTitle?: string;
    email?: string;
    defaultModel?: AIModelId;
    defaultThinkingLevel?: ThinkingLevelOption;
    responseFormatPreference?: ResponseFormatPreference;
  };
}

function loadDatabaseSyncConstructor(): typeof NodeDatabaseSync {
  try {
    const req = createRequire(import.meta.url);
    const sqliteMod = req('node:sqlite') as { DatabaseSync?: typeof NodeDatabaseSync };
    if (!sqliteMod?.DatabaseSync) {
      throw new Error('DatabaseSync export is missing from node:sqlite.');
    }
    return sqliteMod.DatabaseSync;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `NEVUS AI requires Node.js >= 22.13 (found ${process.version}) with built-in node:sqlite support. Underlying error: ${detail}`,
    );
  }
}

export class NexusDatabaseService {
  private db: NodeDatabaseSync;
  public readonly storageMode: 'local-sqlite' | 'ephemeral-sqlite' | 'memory';
  public readonly resolvedDbPath: string;

  constructor(dbPath?: string) {
    const DatabaseSyncCtor = loadDatabaseSyncConstructor();
    let resolvedPath =
      dbPath ??
      process.env.NEXUS_DB_PATH ??
      (process.env.VERCEL === '1'
        ? path.join(os.tmpdir(), 'nevus.db')
        : path.resolve(process.cwd(), 'data', 'nexus.db'));

    let mode: 'local-sqlite' | 'ephemeral-sqlite' | 'memory' =
      resolvedPath === ':memory:'
        ? 'memory'
        : process.env.VERCEL === '1'
          ? 'ephemeral-sqlite'
          : 'local-sqlite';

    if (resolvedPath !== ':memory:') {
      try {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      } catch {
        // Fallback to OS temp directory if cwd/data is read-only (e.g., Vercel serverless)
        resolvedPath = path.join(os.tmpdir(), 'nevus.db');
        mode = 'ephemeral-sqlite';
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      }
    }

    try {
      this.db = new DatabaseSyncCtor(resolvedPath);
      if (resolvedPath !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      } else {
        this.db.exec('PRAGMA foreign_keys = ON;');
      }
    } catch (openErr) {
      console.warn(
        '[NEVUS DB] Primary SQLite open failed, recovering with clean ephemeral store:',
        openErr instanceof Error ? openErr.message : String(openErr),
      );
      if (resolvedPath !== ':memory:') {
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            if (fs.existsSync(`${resolvedPath}${suffix}`)) {
              fs.unlinkSync(`${resolvedPath}${suffix}`);
            }
          } catch {
            // Ignore cleanup failure
          }
        }
      }
      try {
        resolvedPath = ':memory:';
        mode = 'memory';
        this.db = new DatabaseSyncCtor(':memory:');
        this.db.exec('PRAGMA foreign_keys = ON;');
      } catch (memErr) {
        throw memErr;
      }
    }

    this.resolvedDbPath = resolvedPath;
    this.storageMode = mode;
    this.initSchema();
    this.seedIfEmpty();
    this.seedIntelligenceStarterOnce();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role_title TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'developer',
        status TEXT NOT NULL DEFAULT 'active',
        default_provider TEXT NOT NULL DEFAULT 'auto',
        default_model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
        default_thinking_level TEXT NOT NULL DEFAULT 'MEDIUM',
        response_format_preference TEXT NOT NULL DEFAULT 'balanced',
        default_research_visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        purpose TEXT NOT NULL,
        personality TEXT NOT NULL,
        instructions TEXT NOT NULL,
        model TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'MEDIUM',
        is_public INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'General',
        cloned_from_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_used TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assistant_memories (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS orchestration_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        agent_ids_json TEXT NOT NULL,
        shared_context TEXT NOT NULL,
        status TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        final_synthesis TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS research_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        query TEXT NOT NULL,
        mode TEXT NOT NULL,
        summary TEXT NOT NULL,
        report_markdown TEXT NOT NULL,
        citations_json TEXT NOT NULL,
        document_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lab_workspaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        test_code TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_workflows (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_type TEXT NOT NULL,
        schedule_interval_minutes INTEGER,
        condition_keyword TEXT,
        requires_approval INTEGER NOT NULL DEFAULT 1,
        action_type TEXT NOT NULL,
        target_assistant_id TEXT,
        action_prompt TEXT NOT NULL,
        last_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        step_logs_json TEXT NOT NULL,
        output TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (workflow_id) REFERENCES automation_workflows(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS media_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result_text TEXT NOT NULL,
        svg_content TEXT,
        audio_data_url TEXT,
        mime_type TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        publisher_user_id TEXT NOT NULL,
        publisher_name TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        purpose TEXT NOT NULL,
        personality TEXT NOT NULL,
        instructions TEXT NOT NULL,
        model TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        category TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 1,
        downloads INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketplace_reviews (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS error_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        research_type TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        status TEXT NOT NULL,
        search_health TEXT NOT NULL,
        custom_instructions TEXT NOT NULL DEFAULT '',
        document_ids_json TEXT NOT NULL,
        agent_ids_json TEXT NOT NULL,
        understanding_summary TEXT NOT NULL DEFAULT '',
        sub_tasks_json TEXT NOT NULL,
        search_queries_json TEXT NOT NULL,
        pipeline_stages_json TEXT NOT NULL,
        conflicts_json TEXT NOT NULL,
        claim_citations_json TEXT NOT NULL,
        agent_contributions_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        report_markdown TEXT NOT NULL,
        missing_info_json TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS research_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        citation_key TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        domain TEXT NOT NULL,
        publication_date TEXT,
        snippet TEXT NOT NULL,
        reliability_tier TEXT NOT NULL,
        reliability_criteria TEXT NOT NULL,
        is_duplicate INTEGER NOT NULL DEFAULT 0,
        duplicate_of_id TEXT,
        verification_status TEXT NOT NULL,
        saved_to_library INTEGER NOT NULL DEFAULT 0,
        source_origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        default_model TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 1,
        timeout_ms INTEGER NOT NULL DEFAULT 25000,
        max_retries INTEGER NOT NULL DEFAULT 2,
        fallback_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS specialist_agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        preferred_provider TEXT NOT NULL DEFAULT 'auto',
        preferred_model TEXT NOT NULL DEFAULT 'auto',
        permissions_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, role_key)
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        role_key TEXT NOT NULL,
        master_run_id TEXT,
        title TEXT NOT NULL,
        input_prompt TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        provider_used TEXT,
        model_used TEXT,
        status TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        task_type TEXT NOT NULL,
        agent_id TEXT,
        source_endpoint TEXT NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS master_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        request TEXT NOT NULL,
        classification TEXT NOT NULL,
        routing_json TEXT NOT NULL,
        plan_summary TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        combined_response TEXT NOT NULL,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        total_latency_ms INTEGER NOT NULL DEFAULT 0,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        approved INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS google_connections (
        user_id TEXT PRIMARY KEY,
        google_email TEXT NOT NULL,
        granted_scopes_json TEXT NOT NULL DEFAULT '[]',
        connected_services_json TEXT NOT NULL DEFAULT '[]',
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        expires_at TEXT,
        auth_source TEXT NOT NULL DEFAULT 'oauth2',
        updated_at TEXT NOT NULL
      );
    `);

    // Safe forward migrations for existing DBs
    const userCols = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!userCols.some((c) => c.name === 'default_research_visibility')) {
      this.db.exec(
        `ALTER TABLE users ADD COLUMN default_research_visibility TEXT NOT NULL DEFAULT 'private';`,
      );
    }
    if (!userCols.some((c) => c.name === 'default_provider')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN default_provider TEXT NOT NULL DEFAULT 'auto';`);
    }
  }

  private seedIfEmpty() {
    const userCountRow = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (userCountRow.cnt > 0) return;

    const now = new Date();
    const isoNow = now.toISOString();
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();
    const threeHoursAgo = new Date(now.getTime() - 3 * 3600_000).toISOString();
    const yesterday = new Date(now.getTime() - 86400_000).toISOString();

    const adminId = 'usr-admin-primary';
    const devId = 'usr-dev-member';
    const viewerId = 'usr-viewer-guest';

    // Try reading v1.0 legacy JSON store if present
    let legacy: LegacyJsonStore | null = null;
    const legacyPath = path.resolve(process.cwd(), 'data', 'nexus-store.json');
    if (fs.existsSync(legacyPath)) {
      try {
        legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as LegacyJsonStore;
      } catch {
        legacy = null;
      }
    }

    const insertUser = this.db.prepare(`
      INSERT INTO users (
        id, email, password_hash, display_name, role_title, role, status,
        default_model, default_thinking_level, response_format_preference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      adminId,
      'admin@nexus.ai',
      hashPassword('nexus-admin-2026'),
      legacy?.profile?.displayName ?? 'Elena Vance',
      legacy?.profile?.roleTitle ?? 'Principal AI Systems Architect',
      'admin',
      legacy?.profile?.defaultModel ?? 'gemini-4-hydrogen',
      legacy?.profile?.defaultThinkingLevel ?? 'MEDIUM',
      legacy?.profile?.responseFormatPreference ?? 'balanced',
      yesterday,
      isoNow,
    );

    insertUser.run(
      devId,
      'dev@nexus.ai',
      hashPassword('nexus-dev-2026'),
      'Marcus Chen',
      'Senior Platform Engineer',
      'developer',
      'gemini-4-hydrogen',
      'MEDIUM',
      'concise',
      yesterday,
      isoNow,
    );

    insertUser.run(
      viewerId,
      'viewer@nexus.ai',
      hashPassword('nexus-view-2026'),
      'Aria Patel',
      'Security Observer',
      'viewer',
      'gemini-3.1-flash-lite',
      'LOW',
      'balanced',
      yesterday,
      isoNow,
    );

    const insertAssistant = this.db.prepare(`
      INSERT INTO assistants (
        id, owner_user_id, name, description, purpose, personality, instructions,
        model, thinking_level, is_public, category, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedAssistants =
      legacy?.assistants && legacy.assistants.length > 0
        ? legacy.assistants
        : [
            {
              id: 'asst-atlas-research',
              name: 'Atlas Research Analyst',
              description:
                'Synthesizes technical papers, competitive intelligence, and complex datasets into decision-ready briefs.',
              purpose: 'Research & Synthesis',
              personality:
                'Analytical, objective, and structured with clear citations and trade-offs',
              instructions:
                'Break complex inquiries into key findings, supporting evidence, assumptions, and open questions. Distinguish verified facts from hypotheses. Use structured Markdown headings and concise bullet points.',
              model: 'gemini-4-hydrogen' as AIModelId,
              thinkingLevel: 'HIGH' as ThinkingLevelOption,
              createdAt: yesterday,
              updatedAt: oneHourAgo,
            },
            {
              id: 'asst-kestrel-engineering',
              name: 'Kestrel Code Reviewer',
              description:
                'Audits TypeScript, Node.js, and React architecture for security, performance, and maintainability.',
              purpose: 'Software Engineering',
              personality: 'Direct, technical, and pragmatic with production-ready precision',
              instructions:
                'Review code and architectural questions with an emphasis on correctness, type safety, edge cases, and minimal complexity. Provide concrete refactored code snippets and explain why each change improves reliability.',
              model: 'gemini-4-hydrogen' as AIModelId,
              thinkingLevel: 'MEDIUM' as ThinkingLevelOption,
              createdAt: yesterday,
              updatedAt: threeHoursAgo,
            },
            {
              id: 'asst-vesper-strategy',
              name: 'Vesper Editorial Strategist',
              description:
                'Drafts crisp product narratives, release notes, and executive communications.',
              purpose: 'Editorial & Writing',
              personality: 'Executive, concise, and outcome-oriented with bulleted takeaways',
              instructions:
                'Eliminate filler, buzzwords, and passive voice. Lead with the core value proposition, preserve technical accuracy, and adapt structure to the intended audience.',
              model: 'gemini-3.1-flash-lite' as AIModelId,
              thinkingLevel: 'LOW' as ThinkingLevelOption,
              createdAt: yesterday,
              updatedAt: yesterday,
            },
          ];

    for (const a of seedAssistants) {
      insertAssistant.run(
        a.id,
        adminId,
        a.name,
        a.description,
        a.purpose,
        a.personality,
        a.instructions,
        a.model,
        a.thinkingLevel ?? 'MEDIUM',
        1,
        a.purpose,
        a.createdAt,
        a.updatedAt,
      );
    }

    const insertConv = this.db.prepare(
      'INSERT INTO conversations (id, assistant_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertMsg = this.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );

    if (legacy?.conversations && legacy.conversations.length > 0) {
      for (const conv of legacy.conversations) {
        insertConv.run(conv.id, conv.assistantId, adminId, conv.title, conv.createdAt, conv.updatedAt);
        for (const msg of conv.messages) {
          insertMsg.run(msg.id, conv.id, msg.role, msg.content, msg.modelUsed ?? null, msg.createdAt);
        }
      }
    } else if (seedAssistants.length > 0) {
      const firstId = seedAssistants[0].id;
      insertConv.run(
        'conv-atlas-architecture',
        firstId,
        adminId,
        'Evaluating retrieval strategies for internal docs',
        threeHoursAgo,
        oneHourAgo,
      );
      insertMsg.run(
        'msg-seed-1',
        'conv-atlas-architecture',
        'user',
        'Compare hybrid lexical + semantic search against pure vector search for a 50k-document engineering wiki.',
        null,
        threeHoursAgo,
      );
      insertMsg.run(
        'msg-seed-2',
        'conv-atlas-architecture',
        'model',
        '### Key Recommendation\nFor a 50,000-document engineering wiki, **hybrid search** (BM25 lexical + dense vector embeddings fused via Reciprocal Rank Fusion) substantially outperforms pure vector search.\n\n### Trade-off Breakdown\n- **Exact Identifier Recall:** Engineering docs rely heavily on error codes, environment variables, and symbol names.\n- **Semantic Intent:** Vector retrieval handles paraphrased queries and architectural concepts.\n- **Operational Complexity:** At 50k documents, both indexes fit cleanly on a single node.',
        'gemini-4-hydrogen',
        oneHourAgo,
      );
    }

    // Seed starter approved memories
    if (seedAssistants[0]) {
      this.db
        .prepare(
          'INSERT INTO assistant_memories (id, assistant_id, key, content, category, approved, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        )
        .run(
          'mem-seed-1',
          seedAssistants[0].id,
          'Output Formatting Standard',
          'Always separate verified facts from hypotheses and highlight open risk questions.',
          'rule',
          'user',
          yesterday,
          yesterday,
        );
    }

    // Seed Marketplace Listings from starter assistants
    const insertListing = this.db.prepare(`
      INSERT INTO marketplace_listings (
        id, assistant_id, publisher_user_id, publisher_name, name, description,
        purpose, personality, instructions, model, thinking_level, category, is_public, downloads, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const [idx, a] of seedAssistants.entries()) {
      const listingId = `mkt-${a.id}`;
      insertListing.run(
        listingId,
        a.id,
        adminId,
        'Elena Vance',
        a.name,
        a.description,
        a.purpose,
        a.personality,
        a.instructions,
        a.model,
        a.thinkingLevel ?? 'MEDIUM',
        a.purpose,
        14 + idx * 9,
        yesterday,
      );
    }

    this.db
      .prepare(
        'INSERT INTO marketplace_reviews (id, listing_id, user_id, author_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'rev-seed-1',
        `mkt-${seedAssistants[0].id}`,
        devId,
        'Marcus Chen',
        5,
        'Consistently produces clean executive briefs with zero fluff.',
        oneHourAgo,
      );

    // Seed starter Development Lab workspace
    this.db
      .prepare(
        'INSERT INTO lab_workspaces (id, user_id, name, code, test_code, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'lab-default',
        adminId,
        'Rate Limiter & Token Estimator',
        `function estimateTokens(text) {\n  if (typeof text !== 'string' || !text.trim()) return 0;\n  return Math.ceil(text.trim().length / 4);\n}\n\nfunction summarizeUsage(prompts) {\n  return prompts.reduce((sum, p) => sum + estimateTokens(p), 0);\n}\n\nmodule.exports = { estimateTokens, summarizeUsage };`,
        `assert.strictEqual(estimateTokens(''), 0, 'Empty text yields 0 tokens');\nassert.strictEqual(estimateTokens('NEXUS AI v2'), 3, 'Short string estimates 3 tokens');\nassert.strictEqual(summarizeUsage(['hello world', 'test']), 4, 'Sums token counts accurately');`,
        isoNow,
      );

    // Seed starter Automation Workflow
    this.db
      .prepare(`
        INSERT INTO automation_workflows (
          id, user_id, name, description, enabled, trigger_type, schedule_interval_minutes,
          condition_keyword, requires_approval, action_type, target_assistant_id, action_prompt,
          last_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 'manual', 60, '', 1, 'run_assistant', ?, ?, NULL, ?, ?)
      `)
      .run(
        'wf-seed-brief',
        adminId,
        'Architecture Risk Brief',
        'Generates a structured engineering risk checklist using Atlas Research Analyst after approval.',
        seedAssistants[0].id,
        'Summarize top 3 architectural reliability risks for multi-agent orchestration pipelines and mitigation steps.',
        yesterday,
        isoNow,
      );

    this.addAuditLog({
      userId: adminId,
      userEmail: 'admin@nexus.ai',
      action: 'system.initialized',
      resourceType: 'database',
      resourceId: 'nexus.db',
      details: 'NEXUS AI v2.0 SQLite database initialized with seeded workspace.',
    });
  }

  private seedIntelligenceStarterOnce() {
    const alreadySeeded = this.db
      .prepare("SELECT 1 FROM audit_logs WHERE action = 'intelligence.seeded' LIMIT 1")
      .get();
    if (alreadySeeded) return;

    const existingProjects = (
      this.db.prepare('SELECT COUNT(*) as c FROM research_projects').get() as { c: number }
    ).c;
    if (existingProjects > 0) return;

    const adminRow = this.db
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string } | undefined;
    const ownerId = adminRow?.id ?? 'usr-admin-primary';
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();

    const starterReport: StructuredResearchReport = {
      executiveSummary:
        'Retrieval-augmented generation (RAG) systems built for high-accuracy enterprise search increasingly adopt hybrid retrieval (lexical BM25 combined with dense vector similarity) alongside explicit source attribution [S1][S2]. Pure semantic vector search struggles on exact identifiers, error codes, and SKU strings, whereas hybrid fusion improves recall without sacrificing semantic matching.',
      researchObjectives:
        '1. Compare hybrid BM25 + vector retrieval against dense-only vector search.\n2. Identify operational trade-offs at small-to-medium corpus scale (10k–100k documents).\n3. Establish verifiable citation and reliability criteria for production RAG deployments.',
      methodology:
        'Technology Research pipeline across 3 targeted queries, combining primary technical documentation from SQLite FTS5 [S1] and PostgreSQL/vector search engineering references [S2] with cross-source comparison by NEXUS Technology, NEXUS Analyst, and NEXUS Fact Checker.',
      mainFindings:
        '- **Hybrid Recall Advantage [S1][S2]:** Combining full-text inverted indexes (e.g., SQLite FTS5 BM25) with dense embeddings resolves out-of-vocabulary identifier misses.\n- **Operational Simplicity [S1]:** Embedded FTS5 indexes eliminate external cluster hop overhead for sub-100k document corpora.\n- **Reranking Trade-offs [S2]:** Reciprocal Rank Fusion (RRF) merges lexical and dense rankings deterministically without requiring calibrated score normalization.',
      evidenceAndCitations:
        '- Hybrid lexical + dense retrieval outperforms single-mode retrieval on mixed exact-match and conceptual queries [S1][S2].\n- SQLite FTS5 natively computes BM25 relevance ranking in embedded deployments [S1].',
      limitations:
        'Benchmark latency numbers vary significantly with embedding dimensionality, hardware NVMe speed, and chunk length; project-specific benchmarking on representative user queries remains required.',
      recommendations:
        '1. Deploy SQLite FTS5 BM25 lexical pre-filtering alongside semantic scoring for engineering knowledge bases.\n2. Enforce source-key binding so synthesized answers cite explicit document chunks.\n3. Track query latency and empty-result rates in admin telemetry.',
      conclusion:
        'Hybrid retrieval with deterministic citation tracking provides stronger factual grounding and operational resilience than pure vector retrieval alone.',
      references:
        '[S1] SQLite FTS5 Extension Documentation (sqlite.org, Date unavailable) — https://www.sqlite.org/fts5.html [Reliability: high — Official technical documentation domain]\n[S2] PostgreSQL Full Text Search Documentation (postgresql.org, Date unavailable) — https://www.postgresql.org/docs/current/textsearch.html [Reliability: high — Official technical documentation domain]',
    };

    const starterProject: ResearchProject = {
      id: 'proj-seed-hybrid-rag',
      userId: ownerId,
      title: 'Hybrid Lexical & Semantic Retrieval Architecture Evaluation',
      question:
        'Compare hybrid BM25 lexical + dense vector retrieval against pure vector search for production knowledge bases.',
      researchType: 'technology',
      sourceMode: 'web_search',
      visibility: 'workspace',
      status: 'completed',
      searchHealth: 'healthy',
      customInstructions: '',
      documentIds: [],
      agentIds: [
        'nexus-researcher',
        'nexus-technology',
        'nexus-fact-checker',
        'nexus-analyst',
        'nexus-writer',
      ],
      understandingSummary:
        'Evaluating retrieval recall, exact identifier matching, and operational complexity for knowledge-grounded AI systems.',
      subTasks: [
        'Examine SQLite FTS5 BM25 lexical ranking capabilities',
        'Assess dense vector vs hybrid fusion trade-offs',
        'Verify source authority and operational limitations',
      ],
      searchQueries: [
        'SQLite FTS5 BM25 documentation',
        'PostgreSQL full text search ranking documentation',
        'hybrid search BM25 vector retrieval reciprocal rank fusion',
      ],
      pipelineStages: [
        { stageNumber: 1, name: 'Understand Question', status: 'completed', detail: 'Parsed retrieval scope & constraints', durationMs: 410 },
        { stageNumber: 2, name: 'Decompose Research Tasks', status: 'completed', detail: 'Assigned 3 tasks across 5 agents', durationMs: 120 },
        { stageNumber: 3, name: 'Generate Search Queries', status: 'completed', detail: '3 targeted queries prepared', durationMs: 90 },
        { stageNumber: 4, name: 'Web & Knowledge Retrieval', status: 'completed', detail: 'Retrieved official documentation sources', durationMs: 820 },
        { stageNumber: 5, name: 'Extract & Organize Evidence', status: 'completed', detail: '2 unique sources cataloged (0 duplicates merged)', durationMs: 45 },
        { stageNumber: 6, name: 'Compare Independent Sources', status: 'completed', detail: 'Compared 2 distinct authoritative domains', durationMs: 650 },
        { stageNumber: 7, name: 'Detect Contradictions & Uncertainty', status: 'completed', detail: '0 contradictions; benchmark variance noted', durationMs: 490 },
        { stageNumber: 8, name: 'Generate Structured Report', status: 'completed', detail: '9-section report drafted by NEXUS Writer', durationMs: 740 },
        { stageNumber: 9, name: 'Attach & Verify Citations', status: 'completed', detail: 'Bound 2 verified claim citations', durationMs: 30 },
        { stageNumber: 10, name: 'Save & Integrity Audit', status: 'completed', detail: 'Persisted to workspace database', durationMs: 25 },
      ],
      sources: [
        {
          id: 'src-seed-sqlite-fts5',
          projectId: 'proj-seed-hybrid-rag',
          userId: ownerId,
          citationKey: 'S1',
          title: 'SQLite FTS5 Extension Official Documentation',
          url: 'https://www.sqlite.org/fts5.html',
          canonicalUrl: 'https://sqlite.org/fts5.html',
          domain: 'sqlite.org',
          publicationDate: null,
          snippet:
            'FTS5 is an SQLite virtual table module that provides full-text search functionality and built-in BM25 relevance ranking.',
          reliabilityTier: 'high',
          reliabilityCriteria:
            'Institutional, academic, standards-body, official technical documentation, or established news wire domain.',
          isDuplicate: false,
          duplicateOfId: null,
          verificationStatus: 'corroborated',
          savedToLibrary: true,
          sourceOrigin: 'web_search',
          createdAt: oneHourAgo,
        },
        {
          id: 'src-seed-pg-fts',
          projectId: 'proj-seed-hybrid-rag',
          userId: ownerId,
          citationKey: 'S2',
          title: 'PostgreSQL Full Text Search & Ranking',
          url: 'https://www.postgresql.org/docs/current/textsearch.html',
          canonicalUrl: 'https://postgresql.org/docs/current/textsearch.html',
          domain: 'postgresql.org',
          publicationDate: null,
          snippet:
            'Full text search provides lexical tokenization, stemming dictionaries, and ranked relevance scoring alongside structured relational queries.',
          reliabilityTier: 'high',
          reliabilityCriteria:
            'Institutional, academic, standards-body, official technical documentation, or established news wire domain.',
          isDuplicate: false,
          duplicateOfId: null,
          verificationStatus: 'corroborated',
          savedToLibrary: true,
          sourceOrigin: 'web_search',
          createdAt: oneHourAgo,
        },
      ],
      conflicts: [],
      claimCitations: [
        {
          claim: 'SQLite FTS5 provides built-in BM25 full-text ranking inside embedded databases.',
          sourceKeys: ['S1'],
          evidenceQuality: 'corroborated',
        },
        {
          claim: 'Relational full-text indexes complement semantic search for exact lexical matching.',
          sourceKeys: ['S1', 'S2'],
          evidenceQuality: 'corroborated',
        },
      ],
      agentContributions: [
        {
          agentId: 'nexus-researcher',
          agentName: 'NEXUS Researcher',
          roleTitle: 'Information Discovery',
          assignedTask: 'Examine SQLite FTS5 BM25 lexical ranking capabilities',
          status: 'completed',
          output:
            'Documented official SQLite FTS5 virtual table BM25 ranking [S1] and PostgreSQL text search indexing [S2].',
          durationMs: 420,
        },
        {
          agentId: 'nexus-technology',
          agentName: 'NEXUS Technology',
          roleTitle: 'Technical & AI Systems',
          assignedTask: 'Assess dense vector vs hybrid fusion trade-offs',
          status: 'completed',
          output:
            'Hybrid BM25 + semantic fusion mitigates missed error codes and technical identifiers common in dense-only vector search [S1][S2].',
          durationMs: 490,
        },
        {
          agentId: 'nexus-fact-checker',
          agentName: 'NEXUS Fact Checker',
          roleTitle: 'Verification & Skepticism',
          assignedTask: 'Audit factual claims and source evidence',
          status: 'completed',
          output:
            'Verified 2 primary documentation sources [S1][S2]. Noted that neither official reference page lists an explicit publication date.',
          durationMs: 360,
        },
        {
          agentId: 'nexus-analyst',
          agentName: 'NEXUS Analyst',
          roleTitle: 'Synthesis & Trends',
          assignedTask: 'Synthesize operational trade-offs',
          status: 'completed',
          output:
            'For corpora under 100k chunks, embedded FTS5 lexical indexing + deterministic citation mapping minimizes infrastructure overhead.',
          durationMs: 410,
        },
        {
          agentId: 'nexus-writer',
          agentName: 'NEXUS Writer',
          roleTitle: 'Report Composition',
          assignedTask: 'Draft 9-section structured report',
          status: 'completed',
          output: starterReport.executiveSummary,
          durationMs: 520,
        },
      ],
      report: starterReport,
      reportMarkdown: `# Hybrid Lexical & Semantic Retrieval Architecture Evaluation\n\n## 1. Executive Summary\n${starterReport.executiveSummary}\n\n## 2. Research Objectives\n${starterReport.researchObjectives}\n\n## 3. Methodology\n${starterReport.methodology}\n\n## 4. Main Findings\n${starterReport.mainFindings}\n\n## 5. Evidence and Citations\n${starterReport.evidenceAndCitations}\n\n## 6. Limitations\n${starterReport.limitations}\n\n## 7. Recommendations\n${starterReport.recommendations}\n\n## 8. Conclusion\n${starterReport.conclusion}\n\n## 9. References\n${starterReport.references}`,
      missingInfo: [
        'Official documentation pages do not publish explicit article dates; benchmark comparisons depend on workload distribution.',
      ],
      errorMessage: null,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
      completedAt: oneHourAgo,
    };

    this.saveResearchProject(starterProject);
    this.addAuditLog({
      userId: ownerId,
      userEmail: 'admin@nexus.ai',
      action: 'intelligence.seeded',
      resourceType: 'research_project',
      resourceId: starterProject.id,
      details: 'Seeded baseline NEXUS Intelligence Engine demonstration project.',
    });
  }

  // --- Auth & Users ---
  private mapUserRow(row: Record<string, unknown>): AuthUser {
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      roleTitle: String(row.role_title),
      role: row.role as UserRole,
      status: row.status as 'active' | 'suspended',
      defaultProvider: (row.default_provider as AuthUser['defaultProvider']) ?? 'auto',
      defaultModel: row.default_model as AIModelId,
      defaultThinkingLevel: row.default_thinking_level as ThinkingLevelOption,
      responseFormatPreference: row.response_format_preference as ResponseFormatPreference,
      defaultResearchVisibility:
        (row.default_research_visibility as ResearchVisibility | undefined) ?? 'private',
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  getUserById(id: string): AuthUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapUserRow(row) : null;
  }

  authenticateUser(email: string, password: string): AuthUser | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
      .get(email.trim()) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (row.status !== 'active') return null;
    if (!verifyPassword(password, String(row.password_hash))) return null;
    const user = this.mapUserRow(row);
    this.ensureUserDefaults(user.id);
    return user;
  }

  upsertFirebaseUser(input: { uid: string; email: string; displayName: string }): AuthUser {
    const cleanEmail = input.email.trim().toLowerCase();
    const byId = this.getUserById(input.uid);
    if (byId) {
      this.ensureUserDefaults(byId.id);
      return byId;
    }

    const byEmailRow = this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
      .get(cleanEmail) as Record<string, unknown> | undefined;
    if (byEmailRow) {
      const existing = this.mapUserRow(byEmailRow);
      this.ensureUserDefaults(existing.id);
      syncUserToFirestore(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const role: UserRole = cleanEmail === 'saalamax123@gmail.com' ? 'admin' : 'developer';
    this.db
      .prepare(`
        INSERT INTO users (
          id, email, password_hash, display_name, role_title, role, status,
          default_provider, default_model, default_thinking_level, response_format_preference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'auto', 'gemini-4-hydrogen', 'MEDIUM', 'balanced', ?, ?)
      `)
      .run(
        input.uid,
        cleanEmail,
        hashPassword(crypto.randomBytes(24).toString('hex')),
        input.displayName.trim() || cleanEmail.split('@')[0],
        role === 'admin' ? 'Platform Administrator' : 'AI Systems Engineer',
        role,
        now,
        now,
      );
    const created = this.getUserById(input.uid)!;
    this.ensureUserDefaults(created.id);
    syncUserToFirestore(created);
    return created;
  }

  registerUser(input: {
    email: string;
    password: string;
    displayName: string;
    roleTitle: string;
    role?: UserRole;
  }): AuthUser {
    const existing = this.db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
      .get(input.email.trim());
    if (existing) {
      throw new Error('An account with this email already exists.');
    }
    const now = new Date().toISOString();
    const id = `usr-${crypto.randomUUID()}`;
    const role: UserRole = input.role ?? 'developer';
    this.db
      .prepare(`
        INSERT INTO users (
          id, email, password_hash, display_name, role_title, role, status,
          default_provider, default_model, default_thinking_level, response_format_preference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'auto', 'gemini-4-hydrogen', 'MEDIUM', 'balanced', ?, ?)
      `)
      .run(
        id,
        input.email.trim().toLowerCase(),
        hashPassword(input.password),
        input.displayName.trim(),
        input.roleTitle.trim(),
        role,
        now,
        now,
      );
    const user = this.getUserById(id)!;
    this.ensureUserDefaults(id);
    syncUserToFirestore(user);
    return user;
  }

  listUsers(): AuthUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.mapUserRow(r));
  }

  updateUserRoleAndStatus(
    userId: string,
    updates: { role?: UserRole; status?: 'active' | 'suspended' },
  ): AuthUser | null {
    const user = this.getUserById(userId);
    if (!user) return null;
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(updates.role ?? user.role, updates.status ?? user.status, now, userId);
    const updated = this.getUserById(userId);
    if (updated) syncUserToFirestore(updated);
    return updated;
  }

  deleteUserForRollback(userId: string): void {
    try {
      this.db.prepare('DELETE FROM provider_settings WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM specialist_agents WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    } catch {
      // Ignore rollback cleanup failure
    }
  }

  getProfileForUser(userId: string): UserProfile | null {
    const user = this.getUserById(userId);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.displayName,
      roleTitle: user.roleTitle,
      email: user.email,
      role: user.role,
      defaultProvider: user.defaultProvider,
      defaultModel: user.defaultModel,
      defaultThinkingLevel: user.defaultThinkingLevel,
      responseFormatPreference: user.responseFormatPreference,
      defaultResearchVisibility: user.defaultResearchVisibility,
      updatedAt: user.updatedAt,
    };
  }

  updateProfile(userId: string, input: UserProfileInput): UserProfile | null {
    const existing = this.getUserById(userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE users SET
          display_name = ?, role_title = ?, email = ?,
          default_provider = ?, default_model = ?, default_thinking_level = ?, response_format_preference = ?,
          default_research_visibility = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.displayName,
        input.roleTitle,
        input.email.toLowerCase(),
        input.defaultProvider ?? 'auto',
        input.defaultModel,
        input.defaultThinkingLevel,
        input.responseFormatPreference,
        input.defaultResearchVisibility ?? 'private',
        now,
        userId,
      );
    const updatedUser = this.getUserById(userId);
    if (updatedUser) syncUserToFirestore(updatedUser);
    return this.getProfileForUser(userId);
  }

  // --- Assistants (Module 1) ---
  private mapAssistantRow(row: Record<string, unknown>): Assistant {
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      name: String(row.name),
      description: String(row.description),
      purpose: String(row.purpose),
      personality: String(row.personality),
      instructions: String(row.instructions),
      model: row.model as AIModelId,
      thinkingLevel: row.thinking_level as ThinkingLevelOption,
      isPublic: Boolean(row.is_public),
      category: String(row.category ?? 'General'),
      clonedFromId: row.cloned_from_id ? String(row.cloned_from_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listAssistants(): Assistant[] {
    const rows = this.db
      .prepare('SELECT * FROM assistants ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapAssistantRow(r));
  }

  listAssistantsForUser(userId: string): Assistant[] {
    const rows = this.db
      .prepare('SELECT * FROM assistants WHERE owner_user_id = ? OR is_public = 1 ORDER BY updated_at DESC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapAssistantRow(r));
  }

  getAssistant(id: string): Assistant | null {
    const row = this.db.prepare('SELECT * FROM assistants WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapAssistantRow(row) : null;
  }

  getAssistantForUser(id: string, userId: string, isAdmin = false): Assistant | null {
    const a = this.getAssistant(id);
    if (!a) return null;
    if (a.ownerUserId === userId || a.isPublic || isAdmin) return a;
    return null;
  }

  createAssistant(ownerUserId: string, input: AssistantInput, clonedFromId?: string): Assistant {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM assistants WHERE owner_user_id = ?')
      .get(ownerUserId) as { cnt: number };
    if (countRow.cnt >= WORKSPACE_LIMITS.maxAssistants) {
      throw new Error(
        `Workspace assistant limit (${WORKSPACE_LIMITS.maxAssistants}) reached. Delete an unused assistant first.`,
      );
    }

    const now = new Date().toISOString();
    const id = `asst-${crypto.randomUUID()}`;
    this.db
      .prepare(`
        INSERT INTO assistants (
          id, owner_user_id, name, description, purpose, personality, instructions,
          model, thinking_level, is_public, category, cloned_from_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        ownerUserId,
        input.name,
        input.description,
        input.purpose,
        input.personality,
        input.instructions,
        input.model,
        input.thinkingLevel,
        input.isPublic ? 1 : 0,
        input.category || input.purpose,
        clonedFromId ?? null,
        now,
        now,
      );
    const created = this.getAssistant(id)!;
    syncAssistantToFirestore(created);
    return created;
  }

  updateAssistant(id: string, input: AssistantInput): Assistant | null {
    const existing = this.getAssistant(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE assistants SET
          name = ?, description = ?, purpose = ?, personality = ?, instructions = ?,
          model = ?, thinking_level = ?, is_public = ?, category = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.name,
        input.description,
        input.purpose,
        input.personality,
        input.instructions,
        input.model,
        input.thinkingLevel,
        input.isPublic ? 1 : 0,
        input.category || input.purpose,
        now,
        id,
      );
    const updated = this.getAssistant(id);
    if (updated) syncAssistantToFirestore(updated);
    return updated;
  }

  duplicateAssistant(id: string, ownerUserId: string): Assistant | null {
    const source = this.getAssistant(id);
    if (!source) return null;
    return this.createAssistant(
      ownerUserId,
      {
        name: `${source.name} (Copy)`.slice(0, 60),
        description: source.description,
        purpose: source.purpose,
        personality: source.personality,
        instructions: source.instructions,
        model: source.model,
        thinkingLevel: source.thinkingLevel,
        isPublic: false,
        category: source.category,
      },
      source.id,
    );
  }

  deleteAssistant(id: string): boolean {
    const res = this.db.prepare('DELETE FROM assistants WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // --- Conversations & Messages ---
  listConversations(assistantId?: string, userId?: string): Conversation[] {
    let sql = 'SELECT * FROM conversations';
    const conditions: string[] = [];
    const params: string[] = [];
    if (assistantId) {
      conditions.push('assistant_id = ?');
      params.push(assistantId);
    }
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC';
    const convRows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    const msgStmt = this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    );

    return convRows.map((row) => {
      const msgRows = msgStmt.all(String(row.id)) as Record<string, unknown>[];
      return {
        id: String(row.id),
        assistantId: String(row.assistant_id),
        userId: String(row.user_id),
        title: String(row.title),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        messages: msgRows.map((m) => ({
          id: String(m.id),
          role: m.role as 'user' | 'model',
          content: String(m.content),
          createdAt: String(m.created_at),
          modelUsed: m.model_used ? (String(m.model_used) as AIModelId) : undefined,
        })),
      };
    });
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const msgRows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(id) as Record<string, unknown>[];
    return {
      id: String(row.id),
      assistantId: String(row.assistant_id),
      userId: String(row.user_id),
      title: String(row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      messages: msgRows.map((m) => ({
        id: String(m.id),
        role: m.role as 'user' | 'model',
        content: String(m.content),
        createdAt: String(m.created_at),
        modelUsed: m.model_used ? (String(m.model_used) as AIModelId) : undefined,
      })),
    };
  }

  getConversationForUser(id: string, userId: string, isAdmin = false): Conversation | null {
    const conv = this.getConversation(id);
    if (!conv) return null;
    if (conv.userId === userId || isAdmin) return conv;
    return null;
  }

  createConversation(assistantId: string, userId: string, title?: string): Conversation | null {
    const assistant = this.getAssistant(assistantId);
    if (!assistant) return null;
    const now = new Date().toISOString();
    const id = `conv-${crypto.randomUUID()}`;
    const finalTitle = title?.trim() || `New session with ${assistant.name}`;
    this.db
      .prepare(
        'INSERT INTO conversations (id, assistant_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, assistantId, userId, finalTitle, now, now);
    const created = this.getConversation(id)!;
    syncConversationAndMessagesToFirestore(created);
    return created;
  }

  deleteConversation(id: string): boolean {
    const res = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  appendMessages(
    conversationId: string,
    userText: string,
    modelText: string,
    modelUsed: AIModelId | string,
  ): { userMessage: ChatMessage; modelMessage: ChatMessage; conversation: Conversation } | null {
    const conv = this.getConversation(conversationId);
    if (!conv) return null;

    const nowUser = new Date().toISOString();
    const nowModel = new Date(Date.now() + 1).toISOString();
    const userMsgId = `msg-${crypto.randomUUID()}`;
    const modelMsgId = `msg-${crypto.randomUUID()}`;

    const insertMsg = this.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertMsg.run(userMsgId, conversationId, 'user', userText, null, nowUser);
    insertMsg.run(modelMsgId, conversationId, 'model', modelText, modelUsed, nowModel);

    const isDefaultTitle =
      conv.messages.length === 0 && conv.title.startsWith('New session with ');
    const nextTitle = isDefaultTitle
      ? userText.length > 54
        ? `${userText.slice(0, 54).trim()}...`
        : userText
      : conv.title;

    this.db
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nowModel, conversationId);

    const updated = this.getConversation(conversationId)!;
    const userMessage = updated.messages[updated.messages.length - 2];
    const modelMessage = updated.messages[updated.messages.length - 1];
    syncConversationAndMessagesToFirestore(updated, [userMessage, modelMessage]);
    return {
      userMessage,
      modelMessage,
      conversation: updated,
    };
  }

  // --- Module 3: Advanced AI Memory ---
  private mapMemoryRow(row: Record<string, unknown>): AssistantMemory {
    return {
      id: String(row.id),
      assistantId: String(row.assistant_id),
      key: String(row.key),
      content: String(row.content),
      category: row.category as AssistantMemory['category'],
      approved: Boolean(row.approved),
      source: row.source as AssistantMemory['source'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listMemories(assistantId?: string, query?: string): AssistantMemory[] {
    let sql = 'SELECT * FROM assistant_memories';
    const params: string[] = [];
    const conditions: string[] = [];
    if (assistantId) {
      conditions.push('assistant_id = ?');
      params.push(assistantId);
    }
    if (query?.trim()) {
      conditions.push('(LOWER(key) LIKE ? OR LOWER(content) LIKE ?)');
      const q = `%${query.trim().toLowerCase()}%`;
      params.push(q, q);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapMemoryRow(r));
  }

  createMemory(input: MemoryInput): AssistantMemory {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM assistant_memories WHERE assistant_id = ?')
      .get(input.assistantId) as { cnt: number };
    if (countRow.cnt >= WORKSPACE_LIMITS.maxMemoriesPerAssistant) {
      throw new Error(
        `Memory limit (${WORKSPACE_LIMITS.maxMemoriesPerAssistant}) reached for this assistant.`,
      );
    }
    const now = new Date().toISOString();
    const id = `mem-${crypto.randomUUID()}`;
    this.db
      .prepare(`
        INSERT INTO assistant_memories (
          id, assistant_id, key, content, category, approved, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.assistantId,
        input.key,
        input.content,
        input.category,
        input.approved ? 1 : 0,
        input.source,
        now,
        now,
      );
    const row = this.db.prepare('SELECT * FROM assistant_memories WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    return this.mapMemoryRow(row);
  }

  updateMemory(
    id: string,
    updates: Partial<Pick<AssistantMemory, 'key' | 'content' | 'category' | 'approved'>>,
  ): AssistantMemory | null {
    const existingRow = this.db
      .prepare('SELECT * FROM assistant_memories WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existingRow) return null;
    const existing = this.mapMemoryRow(existingRow);
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE assistant_memories SET key = ?, content = ?, category = ?, approved = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        updates.key ?? existing.key,
        updates.content ?? existing.content,
        updates.category ?? existing.category,
        (updates.approved ?? existing.approved) ? 1 : 0,
        now,
        id,
      );
    const row = this.db.prepare('SELECT * FROM assistant_memories WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    return this.mapMemoryRow(row);
  }

  deleteMemory(id: string): boolean {
    const res = this.db.prepare('DELETE FROM assistant_memories WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // --- Module 8: Knowledge Centre ---
  listDocuments(userId?: string): KnowledgeDocument[] {
    const rows = (
      userId
        ? this.db
            .prepare('SELECT * FROM knowledge_documents WHERE user_id = ? ORDER BY created_at DESC')
            .all(userId)
        : this.db.prepare('SELECT * FROM knowledge_documents ORDER BY created_at DESC').all()
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      filename: String(r.filename),
      fileType: r.file_type as KnowledgeDocument['fileType'],
      sizeBytes: Number(r.size_bytes),
      chunkCount: Number(r.chunk_count),
      summary: String(r.summary),
      createdAt: String(r.created_at),
    }));
  }

  getDocument(id: string): KnowledgeDocument | null {
    const r = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      filename: String(r.filename),
      fileType: r.file_type as KnowledgeDocument['fileType'],
      sizeBytes: Number(r.size_bytes),
      chunkCount: Number(r.chunk_count),
      summary: String(r.summary),
      createdAt: String(r.created_at),
    };
  }

  saveDocumentWithChunks(params: {
    userId: string;
    title: string;
    filename: string;
    fileType: KnowledgeDocument['fileType'];
    sizeBytes: number;
    summary: string;
    chunks: string[];
  }): KnowledgeDocument {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM knowledge_documents').get() as {
      cnt: number;
    };
    if (countRow.cnt >= WORKSPACE_LIMITS.maxDocuments) {
      throw new Error(`Document limit (${WORKSPACE_LIMITS.maxDocuments}) reached.`);
    }
    const id = `doc-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO knowledge_documents (
          id, user_id, title, filename, file_type, size_bytes, chunk_count, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.userId,
        params.title,
        params.filename,
        params.fileType,
        params.sizeBytes,
        params.chunks.length,
        params.summary,
        now,
      );

    const insertChunk = this.db.prepare(
      'INSERT INTO knowledge_chunks (id, document_id, chunk_index, content) VALUES (?, ?, ?, ?)',
    );
    params.chunks.forEach((chunk, idx) => {
      insertChunk.run(`chk-${crypto.randomUUID()}`, id, idx, chunk);
    });

    return this.getDocument(id)!;
  }

  deleteDocument(id: string): boolean {
    const res = this.db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  searchKnowledgeChunks(query: string, documentIds?: string[], limit = 6): KnowledgeSearchHit[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9_-]/g, ''))
      .filter((t) => t.length >= 2);

    let rows: Record<string, unknown>[];
    if (documentIds && documentIds.length > 0) {
      const placeholders = documentIds.map(() => '?').join(',');
      rows = this.db
        .prepare(
          `SELECT kc.*, kd.title as doc_title FROM knowledge_chunks kc
           JOIN knowledge_documents kd ON kd.id = kc.document_id
           WHERE kc.document_id IN (${placeholders})`,
        )
        .all(...documentIds) as Record<string, unknown>[];
    } else {
      rows = this.db
        .prepare(
          `SELECT kc.*, kd.title as doc_title FROM knowledge_chunks kc
           JOIN knowledge_documents kd ON kd.id = kc.document_id`,
        )
        .all() as Record<string, unknown>[];
    }

    const scored: KnowledgeSearchHit[] = rows.map((r) => {
      const content = String(r.content);
      const lower = content.toLowerCase();
      let score = 0;
      if (terms.length === 0) {
        score = 1;
      } else {
        for (const term of terms) {
          if (lower.includes(term)) score += 1;
        }
      }
      return {
        documentId: String(r.document_id),
        documentTitle: String(r.doc_title),
        chunkIndex: Number(r.chunk_index),
        content,
        score,
      };
    });

    const matches = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    if (matches.length > 0) return matches.slice(0, limit);
    return documentIds && documentIds.length > 0 ? scored.slice(0, limit) : [];
  }

  // --- Module 2: Orchestration Runs ---
  listOrchestrationRuns(userId?: string): OrchestrationRun[] {
    const rows = (
      userId
        ? this.db
            .prepare(
              'SELECT * FROM orchestration_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 25',
            )
            .all(userId)
        : this.db
            .prepare('SELECT * FROM orchestration_runs ORDER BY created_at DESC LIMIT 25')
            .all()
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      objective: String(r.objective),
      agentIds: JSON.parse(String(r.agent_ids_json)) as string[],
      sharedContext: String(r.shared_context),
      status: r.status as OrchestrationRun['status'],
      steps: JSON.parse(String(r.steps_json)) as OrchestrationRun['steps'],
      finalSynthesis: String(r.final_synthesis),
      createdAt: String(r.created_at),
      completedAt: r.completed_at ? String(r.completed_at) : undefined,
    }));
  }

  saveOrchestrationRun(run: OrchestrationRun): OrchestrationRun {
    const existing = this.db
      .prepare('SELECT id FROM orchestration_runs WHERE id = ?')
      .get(run.id);
    if (existing) {
      this.db
        .prepare(
          'UPDATE orchestration_runs SET status = ?, steps_json = ?, final_synthesis = ?, completed_at = ? WHERE id = ?',
        )
        .run(
          run.status,
          JSON.stringify(run.steps),
          run.finalSynthesis,
          run.completedAt ?? null,
          run.id,
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO orchestration_runs (
            id, user_id, objective, agent_ids_json, shared_context, status, steps_json, final_synthesis, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          run.id,
          run.userId,
          run.objective,
          JSON.stringify(run.agentIds),
          run.sharedContext,
          run.status,
          JSON.stringify(run.steps),
          run.finalSynthesis,
          run.createdAt,
          run.completedAt ?? null,
        );
    }
    return run;
  }

  // --- Module 4: Research Reports ---
  listResearchReports(): ResearchReport[] {
    const rows = this.db
      .prepare('SELECT * FROM research_reports ORDER BY created_at DESC LIMIT 30')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      query: String(r.query),
      mode: r.mode as ResearchReport['mode'],
      summary: String(r.summary),
      reportMarkdown: String(r.report_markdown),
      citations: JSON.parse(String(r.citations_json)) as ResearchReport['citations'],
      documentIds: JSON.parse(String(r.document_ids_json)) as string[],
      createdAt: String(r.created_at),
    }));
  }

  saveResearchReport(report: ResearchReport): ResearchReport {
    this.db
      .prepare(`
        INSERT INTO research_reports (
          id, user_id, query, mode, summary, report_markdown, citations_json, document_ids_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        report.id,
        report.userId,
        report.query,
        report.mode,
        report.summary,
        report.reportMarkdown,
        JSON.stringify(report.citations),
        JSON.stringify(report.documentIds),
        report.createdAt,
      );
    return report;
  }

  // --- Module 4B: NEXUS Intelligence Engine (Projects & Source Library) ---
  private mapSourceRow(row: Record<string, unknown>): ResearchSourceRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      userId: String(row.user_id),
      citationKey: String(row.citation_key),
      title: String(row.title),
      url: String(row.url),
      canonicalUrl: String(row.canonical_url),
      domain: String(row.domain),
      publicationDate: row.publication_date ? String(row.publication_date) : null,
      snippet: String(row.snippet),
      reliabilityTier: row.reliability_tier as SourceReliabilityTier,
      reliabilityCriteria: String(row.reliability_criteria),
      isDuplicate: Boolean(row.is_duplicate),
      duplicateOfId: row.duplicate_of_id ? String(row.duplicate_of_id) : null,
      verificationStatus: row.verification_status as SourceVerificationStatus,
      savedToLibrary: Boolean(row.saved_to_library),
      sourceOrigin: row.source_origin as ResearchSourceRecord['sourceOrigin'],
      createdAt: String(row.created_at),
    };
  }

  private mapProjectRow(row: Record<string, unknown>): ResearchProject {
    const projectId = String(row.id);
    const sourceRows = this.db
      .prepare('SELECT * FROM research_sources WHERE project_id = ? ORDER BY citation_key ASC, is_duplicate ASC')
      .all(projectId) as Record<string, unknown>[];
    return {
      id: projectId,
      userId: String(row.user_id),
      title: String(row.title),
      question: String(row.question),
      researchType: row.research_type as ResearchType,
      sourceMode: row.source_mode as ResearchProject['sourceMode'],
      visibility: row.visibility as ResearchVisibility,
      status: row.status as ResearchProjectStatus,
      searchHealth: row.search_health as SearchHealthStatus,
      customInstructions: String(row.custom_instructions ?? ''),
      documentIds: JSON.parse(String(row.document_ids_json)) as string[],
      agentIds: JSON.parse(String(row.agent_ids_json)) as ResearchAgentId[],
      understandingSummary: String(row.understanding_summary ?? ''),
      subTasks: JSON.parse(String(row.sub_tasks_json)) as string[],
      searchQueries: JSON.parse(String(row.search_queries_json)) as string[],
      pipelineStages: JSON.parse(String(row.pipeline_stages_json)) as ResearchPipelineStage[],
      sources: sourceRows.map((s) => this.mapSourceRow(s)),
      conflicts: JSON.parse(String(row.conflicts_json)) as ResearchConflict[],
      claimCitations: JSON.parse(String(row.claim_citations_json)) as ResearchClaimCitation[],
      agentContributions: JSON.parse(
        String(row.agent_contributions_json),
      ) as ResearchAgentContribution[],
      report: JSON.parse(String(row.report_json)) as StructuredResearchReport,
      reportMarkdown: String(row.report_markdown),
      missingInfo: JSON.parse(String(row.missing_info_json)) as string[],
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
    };
  }

  countUserResearchProjects(userId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM research_projects WHERE user_id = ?')
      .get(userId) as { c: number };
    return row.c;
  }

  countUserResearchRunsToday(userId: string): number {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM research_projects WHERE user_id = ? AND created_at >= ?')
      .get(userId, since) as { c: number };
    return row.c;
  }

  listResearchProjectsForUser(userId: string): ResearchProject[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM research_projects WHERE user_id = ? OR visibility = 'workspace' ORDER BY created_at DESC LIMIT 60`,
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapProjectRow(r));
  }

  getResearchProjectForUser(projectId: string, userId: string): ResearchProject | null {
    const row = this.db
      .prepare('SELECT * FROM research_projects WHERE id = ?')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (String(row.user_id) !== userId && String(row.visibility) !== 'workspace') {
      return null;
    }
    return this.mapProjectRow(row);
  }

  saveResearchProject(project: ResearchProject): ResearchProject {
    const upsert = this.db.prepare(`
      INSERT INTO research_projects (
        id, user_id, title, question, research_type, source_mode, visibility, status, search_health,
        custom_instructions, document_ids_json, agent_ids_json, understanding_summary,
        sub_tasks_json, search_queries_json, pipeline_stages_json, conflicts_json,
        claim_citations_json, agent_contributions_json, report_json, report_markdown,
        missing_info_json, error_message, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        visibility = excluded.visibility,
        status = excluded.status,
        search_health = excluded.search_health,
        understanding_summary = excluded.understanding_summary,
        sub_tasks_json = excluded.sub_tasks_json,
        search_queries_json = excluded.search_queries_json,
        pipeline_stages_json = excluded.pipeline_stages_json,
        conflicts_json = excluded.conflicts_json,
        claim_citations_json = excluded.claim_citations_json,
        agent_contributions_json = excluded.agent_contributions_json,
        report_json = excluded.report_json,
        report_markdown = excluded.report_markdown,
        missing_info_json = excluded.missing_info_json,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `);

    upsert.run(
      project.id,
      project.userId,
      project.title,
      project.question,
      project.researchType,
      project.sourceMode,
      project.visibility,
      project.status,
      project.searchHealth,
      project.customInstructions,
      JSON.stringify(project.documentIds),
      JSON.stringify(project.agentIds),
      project.understandingSummary,
      JSON.stringify(project.subTasks),
      JSON.stringify(project.searchQueries),
      JSON.stringify(project.pipelineStages),
      JSON.stringify(project.conflicts),
      JSON.stringify(project.claimCitations),
      JSON.stringify(project.agentContributions),
      JSON.stringify(project.report),
      project.reportMarkdown,
      JSON.stringify(project.missingInfo),
      project.errorMessage,
      project.createdAt,
      project.updatedAt,
      project.completedAt,
    );

    this.db.prepare('DELETE FROM research_sources WHERE project_id = ?').run(project.id);
    const insertSrc = this.db.prepare(`
      INSERT INTO research_sources (
        id, project_id, user_id, citation_key, title, url, canonical_url, domain,
        publication_date, snippet, reliability_tier, reliability_criteria,
        is_duplicate, duplicate_of_id, verification_status, saved_to_library,
        source_origin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of project.sources) {
      insertSrc.run(
        s.id,
        project.id,
        s.userId,
        s.citationKey,
        s.title,
        s.url,
        s.canonicalUrl,
        s.domain,
        s.publicationDate,
        s.snippet,
        s.reliabilityTier,
        s.reliabilityCriteria,
        s.isDuplicate ? 1 : 0,
        s.duplicateOfId,
        s.verificationStatus,
        s.savedToLibrary ? 1 : 0,
        s.sourceOrigin,
        s.createdAt,
      );
    }

    syncResearchProjectToFirestore(project);
    return project;
  }

  updateResearchProjectPrivacy(
    projectId: string,
    ownerUserId: string,
    visibility: ResearchVisibility,
    isAdmin = false,
  ): ResearchProject | null {
    const row = this.db
      .prepare('SELECT user_id FROM research_projects WHERE id = ?')
      .get(projectId) as { user_id: string } | undefined;
    if (!row) return null;
    if (row.user_id !== ownerUserId && !isAdmin) return null;
    this.db
      .prepare('UPDATE research_projects SET visibility = ?, updated_at = ? WHERE id = ?')
      .run(visibility, new Date().toISOString(), projectId);
    const updated = this.getResearchProjectForUser(projectId, row.user_id);
    if (updated) syncResearchProjectToFirestore(updated);
    return updated;
  }

  deleteResearchProject(projectId: string, ownerUserId: string, isAdmin = false): boolean {
    const row = this.db
      .prepare('SELECT user_id FROM research_projects WHERE id = ?')
      .get(projectId) as { user_id: string } | undefined;
    if (!row) return false;
    if (row.user_id !== ownerUserId && !isAdmin) return false;
    const res = this.db.prepare('DELETE FROM research_projects WHERE id = ?').run(projectId);
    return res.changes > 0;
  }

  listResearchSourcesForUser(
    userId: string,
    options?: { savedOnly?: boolean; query?: string; reliabilityTier?: string },
  ): ResearchSourceRecord[] {
    let sql = `
      SELECT s.* FROM research_sources s
      INNER JOIN research_projects p ON p.id = s.project_id
      WHERE (p.user_id = ? OR p.visibility = 'workspace')
        AND s.is_duplicate = 0
    `;
    const params: Array<string | number> = [userId];

    if (options?.savedOnly) {
      sql += ` AND s.saved_to_library = 1`;
    }
    if (options?.reliabilityTier && options.reliabilityTier !== 'all') {
      sql += ` AND s.reliability_tier = ?`;
      params.push(options.reliabilityTier);
    }
    sql += ` ORDER BY s.saved_to_library DESC, s.created_at DESC LIMIT 150`;

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let mapped = rows.map((r) => this.mapSourceRow(r));
    if (options?.query?.trim()) {
      const q = options.query.trim().toLowerCase();
      mapped = mapped.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q) ||
          s.snippet.toLowerCase().includes(q),
      );
    }
    return mapped;
  }

  toggleSourceSavedToLibrary(
    sourceId: string,
    userId: string,
    saved: boolean,
  ): ResearchSourceRecord | null {
    const row = this.db
      .prepare(`
        SELECT s.* FROM research_sources s
        INNER JOIN research_projects p ON p.id = s.project_id
        WHERE s.id = ? AND (p.user_id = ? OR p.visibility = 'workspace')
      `)
      .get(sourceId, userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.db
      .prepare('UPDATE research_sources SET saved_to_library = ? WHERE id = ?')
      .run(saved ? 1 : 0, sourceId);
    const updated = this.db
      .prepare('SELECT * FROM research_sources WHERE id = ?')
      .get(sourceId) as Record<string, unknown>;
    const mapped = this.mapSourceRow(updated);
    void syncResearchSourceToFirestore(mapped);
    return mapped;
  }

  // --- Module 5: Development Lab Workspaces ---
  getLabWorkspace(userId: string): LabWorkspaceRecord {
    const row = this.db
      .prepare('SELECT * FROM lab_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(userId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        userId: String(row.user_id),
        name: String(row.name),
        code: String(row.code),
        testCode: String(row.test_code),
        updatedAt: String(row.updated_at),
      };
    }
    const now = new Date().toISOString();
    const id = `lab-${crypto.randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO lab_workspaces (id, user_id, name, code, test_code, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, 'Sandbox Scratchpad', 'function add(a, b) { return a + b; }\nmodule.exports = { add };', 'assert.strictEqual(add(2, 3), 5);', now);
    return this.getLabWorkspace(userId);
  }

  saveLabWorkspace(id: string, name: string, code: string, testCode: string): LabWorkspaceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE lab_workspaces SET name = ?, code = ?, test_code = ?, updated_at = ? WHERE id = ?')
      .run(name, code, testCode, now, id);
    const row = this.db.prepare('SELECT * FROM lab_workspaces WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      name: String(row.name),
      code: String(row.code),
      testCode: String(row.test_code),
      updatedAt: String(row.updated_at),
    };
  }

  // --- Module 6: Automation Workflows & Runs ---
  private mapWorkflowRow(row: Record<string, unknown>): AutomationWorkflow {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      name: String(row.name),
      description: String(row.description),
      enabled: Boolean(row.enabled),
      triggerType: row.trigger_type as 'manual' | 'schedule',
      scheduleIntervalMinutes: row.schedule_interval_minutes
        ? Number(row.schedule_interval_minutes)
        : undefined,
      conditionKeyword: row.condition_keyword ? String(row.condition_keyword) : undefined,
      requiresApproval: Boolean(row.requires_approval),
      actionType: row.action_type as AutomationWorkflow['actionType'],
      targetAssistantId: row.target_assistant_id ? String(row.target_assistant_id) : undefined,
      actionPrompt: String(row.action_prompt),
      lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listWorkflows(userId?: string): AutomationWorkflow[] {
    const rows = (
      userId
        ? this.db
            .prepare('SELECT * FROM automation_workflows WHERE user_id = ? ORDER BY updated_at DESC')
            .all(userId)
        : this.db.prepare('SELECT * FROM automation_workflows ORDER BY updated_at DESC').all()
    ) as Record<string, unknown>[];
    return rows.map((r) => this.mapWorkflowRow(r));
  }

  getWorkflow(id: string): AutomationWorkflow | null {
    const row = this.db.prepare('SELECT * FROM automation_workflows WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapWorkflowRow(row) : null;
  }

  createWorkflow(userId: string, input: WorkflowInput): AutomationWorkflow {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM automation_workflows').get() as {
      cnt: number;
    };
    if (countRow.cnt >= WORKSPACE_LIMITS.maxWorkflows) {
      throw new Error(`Workflow limit (${WORKSPACE_LIMITS.maxWorkflows}) reached.`);
    }
    const now = new Date().toISOString();
    const id = `wf-${crypto.randomUUID()}`;
    this.db
      .prepare(`
        INSERT INTO automation_workflows (
          id, user_id, name, description, enabled, trigger_type, schedule_interval_minutes,
          condition_keyword, requires_approval, action_type, target_assistant_id, action_prompt,
          last_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `)
      .run(
        id,
        userId,
        input.name,
        input.description,
        input.enabled ? 1 : 0,
        input.triggerType,
        input.scheduleIntervalMinutes ?? null,
        input.conditionKeyword ?? null,
        input.requiresApproval ? 1 : 0,
        input.actionType,
        input.targetAssistantId ?? null,
        input.actionPrompt,
        now,
        now,
      );
    return this.getWorkflow(id)!;
  }

  toggleWorkflow(id: string, enabled: boolean): AutomationWorkflow | null {
    const now = new Date().toISOString();
    const res = this.db
      .prepare('UPDATE automation_workflows SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id);
    if (Number(res.changes) === 0) return null;
    return this.getWorkflow(id);
  }

  markWorkflowLastRun(id: string, isoTime: string) {
    this.db.prepare('UPDATE automation_workflows SET last_run_at = ? WHERE id = ?').run(isoTime, id);
  }

  deleteWorkflow(id: string): boolean {
    const res = this.db.prepare('DELETE FROM automation_workflows WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  listWorkflowRuns(userId?: string): WorkflowRun[] {
    const rows = (
      userId
        ? this.db
            .prepare(`
              SELECT wr.* FROM workflow_runs wr
              INNER JOIN automation_workflows aw ON aw.id = wr.workflow_id
              WHERE aw.user_id = ?
              ORDER BY wr.created_at DESC LIMIT 40
            `)
            .all(userId)
        : this.db.prepare('SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 40').all()
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      workflowId: String(r.workflow_id),
      workflowName: String(r.workflow_name),
      status: r.status as WorkflowRun['status'],
      triggerSource: r.trigger_source as 'manual' | 'schedule',
      stepLogs: JSON.parse(String(r.step_logs_json)) as string[],
      output: String(r.output),
      createdAt: String(r.created_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    }));
  }

  getWorkflowRun(id: string): WorkflowRun | null {
    const r = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      workflowId: String(r.workflow_id),
      workflowName: String(r.workflow_name),
      status: r.status as WorkflowRun['status'],
      triggerSource: r.trigger_source as 'manual' | 'schedule',
      stepLogs: JSON.parse(String(r.step_logs_json)) as string[],
      output: String(r.output),
      createdAt: String(r.created_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    };
  }

  saveWorkflowRun(run: WorkflowRun): WorkflowRun {
    const exists = this.db.prepare('SELECT id FROM workflow_runs WHERE id = ?').get(run.id);
    if (exists) {
      this.db
        .prepare(
          'UPDATE workflow_runs SET status = ?, step_logs_json = ?, output = ?, completed_at = ? WHERE id = ?',
        )
        .run(
          run.status,
          JSON.stringify(run.stepLogs),
          run.output,
          run.completedAt ?? null,
          run.id,
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO workflow_runs (
            id, workflow_id, workflow_name, status, trigger_source, step_logs_json, output, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          run.id,
          run.workflowId,
          run.workflowName,
          run.status,
          run.triggerSource,
          JSON.stringify(run.stepLogs),
          run.output,
          run.createdAt,
          run.completedAt ?? null,
        );
    }
    return run;
  }

  // --- Module 7: Media Projects ---
  listMediaProjects(userId?: string): MediaProject[] {
    const rows = (
      userId
        ? this.db
            .prepare('SELECT * FROM media_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
            .all(userId)
        : this.db.prepare('SELECT * FROM media_projects ORDER BY created_at DESC LIMIT 30').all()
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title),
      kind: r.kind as MediaProject['kind'],
      prompt: String(r.prompt),
      resultText: String(r.result_text),
      svgContent: r.svg_content ? String(r.svg_content) : null,
      audioDataUrl: r.audio_data_url ? String(r.audio_data_url) : null,
      mimeType: r.mime_type ? String(r.mime_type) : null,
      createdAt: String(r.created_at),
    }));
  }

  saveMediaProject(project: Omit<MediaProject, 'id' | 'createdAt'>): MediaProject {
    const id = `med-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO media_projects (
          id, user_id, title, kind, prompt, result_text, svg_content, audio_data_url, mime_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        project.userId,
        project.title,
        project.kind,
        project.prompt,
        project.resultText,
        project.svgContent ?? null,
        project.audioDataUrl ?? null,
        project.mimeType ?? null,
        now,
      );
    return {
      ...project,
      id,
      createdAt: now,
    };
  }

  deleteMediaProject(id: string): boolean {
    const res = this.db.prepare('DELETE FROM media_projects WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  // --- Module 9: AI Marketplace ---
  listMarketplaceListings(): { listings: MarketplaceListing[]; reviews: MarketplaceReview[] } {
    const rows = this.db
      .prepare(`
        SELECT ml.*,
          COALESCE(AVG(mr.rating), 0) as avg_rating,
          COUNT(mr.id) as review_count
        FROM marketplace_listings ml
        LEFT JOIN marketplace_reviews mr ON mr.listing_id = ml.id
        GROUP BY ml.id
        ORDER BY ml.downloads DESC, ml.created_at DESC
      `)
      .all() as Record<string, unknown>[];

    const listings: MarketplaceListing[] = rows.map((r) => ({
      id: String(r.id),
      assistantId: String(r.assistant_id),
      publisherUserId: String(r.publisher_user_id),
      publisherName: String(r.publisher_name),
      name: String(r.name),
      description: String(r.description),
      purpose: String(r.purpose),
      personality: String(r.personality),
      instructions: String(r.instructions),
      model: r.model as AIModelId,
      thinkingLevel: r.thinking_level as ThinkingLevelOption,
      category: String(r.category),
      isPublic: Boolean(r.is_public),
      downloads: Number(r.downloads),
      avgRating: Number(Number(r.avg_rating ?? 0).toFixed(1)),
      reviewCount: Number(r.review_count ?? 0),
      createdAt: String(r.created_at),
    }));

    const reviewRows = this.db
      .prepare('SELECT * FROM marketplace_reviews ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    const reviews: MarketplaceReview[] = reviewRows.map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      userId: String(r.user_id),
      authorName: String(r.author_name),
      rating: Number(r.rating),
      comment: String(r.comment),
      createdAt: String(r.created_at),
    }));

    return { listings, reviews };
  }

  publishAssistantToMarketplace(
    assistantId: string,
    user: AuthUser,
    category?: string,
  ): MarketplaceListing | null {
    const assistant = this.getAssistant(assistantId);
    if (!assistant) return null;
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT id FROM marketplace_listings WHERE assistant_id = ?')
      .get(assistantId) as { id: string } | undefined;

    const listingId = existing?.id ?? `mkt-${crypto.randomUUID()}`;
    if (existing) {
      this.db
        .prepare(`
          UPDATE marketplace_listings SET
            name = ?, description = ?, purpose = ?, personality = ?, instructions = ?,
            model = ?, thinking_level = ?, category = ?, is_public = 1
          WHERE id = ?
        `)
        .run(
          assistant.name,
          assistant.description,
          assistant.purpose,
          assistant.personality,
          assistant.instructions,
          assistant.model,
          assistant.thinkingLevel,
          category || assistant.category || assistant.purpose,
          listingId,
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO marketplace_listings (
            id, assistant_id, publisher_user_id, publisher_name, name, description,
            purpose, personality, instructions, model, thinking_level, category, is_public, downloads, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
        `)
        .run(
          listingId,
          assistant.id,
          user.id,
          user.displayName,
          assistant.name,
          assistant.description,
          assistant.purpose,
          assistant.personality,
          assistant.instructions,
          assistant.model,
          assistant.thinkingLevel,
          category || assistant.category || assistant.purpose,
          now,
        );
    }

    this.db.prepare('UPDATE assistants SET is_public = 1 WHERE id = ?').run(assistantId);
    return this.listMarketplaceListings().listings.find((l) => l.id === listingId) ?? null;
  }

  installMarketplaceListing(listingId: string, userId: string): Assistant | null {
    const listing = this.listMarketplaceListings().listings.find((l) => l.id === listingId);
    if (!listing) return null;
    this.db
      .prepare('UPDATE marketplace_listings SET downloads = downloads + 1 WHERE id = ?')
      .run(listingId);
    return this.createAssistant(
      userId,
      {
        name: listing.name,
        description: listing.description,
        purpose: listing.purpose,
        personality: listing.personality,
        instructions: listing.instructions,
        model: listing.model,
        thinkingLevel: listing.thinkingLevel,
        isPublic: false,
        category: listing.category,
      },
      listing.assistantId,
    );
  }

  addMarketplaceReview(
    listingId: string,
    user: AuthUser,
    rating: number,
    comment: string,
  ): MarketplaceReview | null {
    const listingExists = this.db
      .prepare('SELECT id FROM marketplace_listings WHERE id = ?')
      .get(listingId);
    if (!listingExists) return null;
    const id = `rev-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO marketplace_reviews (id, listing_id, user_id, author_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, listingId, user.id, user.displayName, rating, comment, now);
    return {
      id,
      listingId,
      userId: user.id,
      authorName: user.displayName,
      rating,
      comment,
      createdAt: now,
    };
  }

  // --- Module 10: Administration, Audit, Telemetry & Backup ---
  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>) {
    this.db
      .prepare(
        'INSERT INTO audit_logs (id, user_id, user_email, action, resource_type, resource_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `aud-${crypto.randomUUID()}`,
        entry.userId,
        entry.userEmail,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.details,
        new Date().toISOString(),
      );
  }

  addApiUsageLog(entry: Omit<ApiUsageEntry, 'id' | 'createdAt'>) {
    this.db
      .prepare(
        'INSERT INTO api_usage_logs (id, user_id, endpoint, model, status_code, latency_ms, estimated_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `use-${crypto.randomUUID()}`,
        entry.userId,
        entry.endpoint,
        entry.model,
        entry.statusCode,
        entry.latencyMs,
        entry.estimatedTokens,
        new Date().toISOString(),
      );
  }

  addErrorLog(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>) {
    this.db
      .prepare(
        'INSERT INTO error_logs (id, user_id, source, message, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        `err-${crypto.randomUUID()}`,
        entry.userId,
        entry.source,
        entry.message.slice(0, 500),
        entry.statusCode,
        new Date().toISOString(),
      );
  }

  getAdminDashboardData() {
    const users = this.listUsers();
    const auditLogs = (
      this.db
        .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60')
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: String(r.user_email),
      action: String(r.action),
      resourceType: String(r.resource_type),
      resourceId: String(r.resource_id),
      details: String(r.details),
      createdAt: String(r.created_at),
    }));

    const apiUsage = (
      this.db
        .prepare('SELECT * FROM api_usage_logs ORDER BY created_at DESC LIMIT 60')
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      endpoint: String(r.endpoint),
      model: String(r.model),
      statusCode: Number(r.status_code),
      latencyMs: Number(r.latency_ms),
      estimatedTokens: Number(r.estimated_tokens),
      createdAt: String(r.created_at),
    }));

    const errorLogs = (
      this.db
        .prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 40')
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      source: String(r.source),
      message: String(r.message),
      statusCode: Number(r.status_code),
      createdAt: String(r.created_at),
    }));

    const summary = this.db
      .prepare(`
        SELECT
          COUNT(*) as total_calls,
          COALESCE(SUM(estimated_tokens), 0) as total_tokens,
          COALESCE(AVG(latency_ms), 0) as avg_latency
        FROM api_usage_logs
      `)
      .get() as { total_calls: number; total_tokens: number; avg_latency: number };

    const counts = {
      assistants: (this.db.prepare('SELECT COUNT(*) as c FROM assistants').get() as { c: number }).c,
      conversations: (
        this.db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }
      ).c,
      memories: (
        this.db.prepare('SELECT COUNT(*) as c FROM assistant_memories').get() as { c: number }
      ).c,
      documents: (
        this.db.prepare('SELECT COUNT(*) as c FROM knowledge_documents').get() as { c: number }
      ).c,
      workflows: (
        this.db.prepare('SELECT COUNT(*) as c FROM automation_workflows').get() as { c: number }
      ).c,
      researchProjects: (
        this.db.prepare('SELECT COUNT(*) as c FROM research_projects').get() as { c: number }
      ).c,
      errors: (this.db.prepare('SELECT COUNT(*) as c FROM error_logs').get() as { c: number }).c,
    };

    return {
      users,
      auditLogs,
      apiUsage,
      errorLogs,
      analytics: {
        totalApiCalls: summary.total_calls,
        totalEstimatedTokens: summary.total_tokens,
        avgLatencyMs: Math.round(summary.avg_latency),
        counts,
      },
    };
  }

  exportBackup() {
    return {
      format: 'nexus-backup-v2',
      exportedAt: new Date().toISOString(),
      assistants: this.listAssistants(),
      conversations: this.listConversations(),
      memories: this.listMemories(),
      documents: this.listDocuments(),
      workflows: this.listWorkflows(),
      researchReports: this.listResearchReports(),
      researchProjects: (
        this.db.prepare('SELECT * FROM research_projects ORDER BY created_at DESC LIMIT 60').all() as Record<
          string,
          unknown
        >[]
      ).map((r) => this.mapProjectRow(r)),
    };
  }

  restoreAssistantsFromBackup(userId: string, assistants: AssistantInput[]): number {
    let imported = 0;
    for (const item of assistants) {
      this.createAssistant(userId, item);
      imported += 1;
    }
    return imported;
  }

  // ============================================================
  // v3.0 — PROVIDER SETTINGS, SPECIALIST AGENTS, AGENT TASKS, USAGE & MASTER RUNS
  // ============================================================

  ensureUserDefaults(userId: string) {
    const now = new Date().toISOString();

    const defaultProviders: Array<{
      provider: AIProviderId;
      defaultModel: AIModelId;
      priority: number;
      timeoutMs: number;
    }> = [
      { provider: 'google', defaultModel: 'gemini-4-hydrogen', priority: 1, timeoutMs: 30000 },
      { provider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', priority: 2, timeoutMs: 30000 },
      { provider: 'openai', defaultModel: 'gpt-4o', priority: 3, timeoutMs: 30000 },
    ];

    const checkProv = this.db.prepare(
      'SELECT id FROM provider_settings WHERE user_id = ? AND provider = ?',
    );
    const insertProv = this.db.prepare(`
      INSERT OR IGNORE INTO provider_settings (
        id, user_id, provider, enabled, default_model, priority, timeout_ms, max_retries, fallback_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, 2, 1, ?, ?)
    `);

    for (const p of defaultProviders) {
      if (!checkProv.get(userId, p.provider)) {
        const id = `prov-${userId}-${p.provider}`;
        insertProv.run(id, userId, p.provider, p.defaultModel, p.priority, p.timeoutMs, now, now);
      }
    }

    const defaultAgents: Array<{
      roleKey: SpecialistRoleKey;
      name: string;
      description: string;
      instructions: string;
      preferredModel: string;
      permissions: SpecialistAgent['permissions'];
    }> = [
      {
        roleKey: 'research',
        name: 'Research Agent',
        description:
          'Plans information discovery, gathers primary evidence, and synthesizes multi-source findings with citations.',
        instructions:
          'Break down research prompts into targeted investigative angles. Distinguish primary facts from speculation, cite verifiable sources, and highlight unresolved knowledge gaps.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: true,
          canReadKnowledge: true,
          canExecuteCode: false,
          requiresApprovalForExternal: false,
        },
      },
      {
        roleKey: 'analysis',
        name: 'Analysis Agent',
        description:
          'Interprets complex data, evaluates architectural trade-offs, and extracts strategic patterns.',
        instructions:
          'Compare competing options rigorously across cost, latency, reliability, and risk. Present structured decision matrices and actionable insights grounded in available evidence.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: false,
          canReadKnowledge: true,
          canExecuteCode: false,
          requiresApprovalForExternal: false,
        },
      },
      {
        roleKey: 'fact_check',
        name: 'Fact Checker Agent',
        description:
          'Audits factual claims, detects contradictions, and enforces strict citation and uncertainty standards.',
        instructions:
          'Verify every quantitative or historical claim against provided evidence. Explicitly flag uncorroborated assertions, conflicting claims, missing publication dates, and logical fallacies.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: true,
          canReadKnowledge: true,
          canExecuteCode: false,
          requiresApprovalForExternal: false,
        },
      },
      {
        roleKey: 'academic',
        name: 'Academic Agent',
        description:
          'Applies scholarly standards, empirical methodology critique, and literature synthesis rigor.',
        instructions:
          'Evaluate evidence through peer-reviewed methodology standards: inspect sample sizes, confounding variables, theoretical framing, consensus vs frontier uncertainty, and citation provenance.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: true,
          canReadKnowledge: true,
          canExecuteCode: false,
          requiresApprovalForExternal: false,
        },
      },
      {
        roleKey: 'writing',
        name: 'Writing Agent',
        description:
          'Composes executive briefs, technical documentation, and clear multi-section deliverables.',
        instructions:
          'Transform technical or analytical inputs into crisp, well-structured prose. Eliminate fluff, maintain strict factual fidelity to source inputs, and format cleanly with Markdown sections.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: false,
          canReadKnowledge: true,
          canExecuteCode: false,
          requiresApprovalForExternal: false,
        },
      },
      {
        roleKey: 'coding',
        name: 'Coding Agent',
        description:
          'Architects TypeScript, Node.js, React, and SQL systems with production-ready tests and security checks.',
        instructions:
          'Write clean, strongly typed, idiomatic code with explicit edge-case handling, security validation, and concrete unit tests. State assumptions and trade-offs clearly.',
        preferredModel: 'auto',
        permissions: {
          canWebSearch: false,
          canReadKnowledge: true,
          canExecuteCode: true,
          requiresApprovalForExternal: true,
        },
      },
    ];

    const checkAgent = this.db.prepare(
      'SELECT id FROM specialist_agents WHERE user_id = ? AND role_key = ?',
    );
    const insertAgent = this.db.prepare(`
      INSERT INTO specialist_agents (
        id, user_id, role_key, name, description, instructions, preferred_provider, preferred_model, permissions_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, ?, 1, ?, ?)
    `);

    for (const a of defaultAgents) {
      if (!checkAgent.get(userId, a.roleKey)) {
        const id = `agt-${a.roleKey}-${crypto.randomUUID().slice(0, 8)}`;
        insertAgent.run(
          id,
          userId,
          a.roleKey,
          a.name,
          a.description,
          a.instructions,
          a.preferredModel,
          JSON.stringify(a.permissions),
          now,
          now,
        );
      }
    }
  }

  private mapProviderRow(row: Record<string, unknown>): ProviderSetting {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      provider: row.provider as AIProviderId,
      enabled: Boolean(row.enabled),
      defaultModel: row.default_model as AIModelId,
      priority: Number(row.priority),
      timeoutMs: Number(row.timeout_ms),
      maxRetries: Number(row.max_retries),
      fallbackEnabled: Boolean(row.fallback_enabled),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listProviderSettingsForUser(userId: string): ProviderSetting[] {
    this.ensureUserDefaults(userId);
    const rows = this.db
      .prepare('SELECT * FROM provider_settings WHERE user_id = ? ORDER BY priority ASC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapProviderRow(r));
  }

  updateProviderSettingForUser(
    userId: string,
    provider: AIProviderId,
    input: ProviderSettingUpdateInput,
  ): ProviderSetting {
    this.ensureUserDefaults(userId);
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE provider_settings SET
          enabled = ?, default_model = ?, priority = ?, timeout_ms = ?, max_retries = ?, fallback_enabled = ?, updated_at = ?
        WHERE user_id = ? AND provider = ?
      `)
      .run(
        input.enabled ? 1 : 0,
        input.defaultModel,
        input.priority,
        input.timeoutMs,
        input.maxRetries,
        input.fallbackEnabled ? 1 : 0,
        now,
        userId,
        provider,
      );
    const row = this.db
      .prepare('SELECT * FROM provider_settings WHERE user_id = ? AND provider = ?')
      .get(userId, provider) as Record<string, unknown>;
    const updated = this.mapProviderRow(row);
    syncProviderSettingToFirestore(updated);
    return updated;
  }

  private mapSpecialistAgentRow(row: Record<string, unknown>): SpecialistAgent {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      roleKey: row.role_key as SpecialistRoleKey,
      name: String(row.name),
      description: String(row.description),
      instructions: String(row.instructions),
      preferredProvider: row.preferred_provider as SpecialistAgent['preferredProvider'],
      preferredModel: String(row.preferred_model),
      permissions: JSON.parse(String(row.permissions_json)) as SpecialistAgent['permissions'],
      enabled: Boolean(row.enabled),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listSpecialistAgentsForUser(userId: string): SpecialistAgent[] {
    this.ensureUserDefaults(userId);
    const rows = this.db
      .prepare('SELECT * FROM specialist_agents WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.mapSpecialistAgentRow(r));
  }

  getSpecialistAgentForUser(agentId: string, userId: string): SpecialistAgent | null {
    this.ensureUserDefaults(userId);
    const row = this.db
      .prepare('SELECT * FROM specialist_agents WHERE id = ? AND user_id = ?')
      .get(agentId, userId) as Record<string, unknown> | undefined;
    return row ? this.mapSpecialistAgentRow(row) : null;
  }

  updateSpecialistAgentForUser(
    agentId: string,
    userId: string,
    input: SpecialistAgentUpdateInput,
  ): SpecialistAgent | null {
    const existing = this.getSpecialistAgentForUser(agentId, userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE specialist_agents SET
          name = ?, description = ?, instructions = ?, preferred_provider = ?, preferred_model = ?, permissions_json = ?, enabled = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .run(
        input.name,
        input.description,
        input.instructions,
        input.preferredProvider,
        input.preferredModel,
        JSON.stringify(input.permissions),
        input.enabled ? 1 : 0,
        now,
        agentId,
        userId,
      );
    const updated = this.getSpecialistAgentForUser(agentId, userId)!;
    syncSpecialistAgentToFirestore(updated);
    return updated;
  }

  private mapAgentTaskRow(row: Record<string, unknown>): AgentTask {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      agentId: String(row.agent_id),
      agentName: String(row.agent_name),
      roleKey: row.role_key as SpecialistRoleKey,
      masterRunId: row.master_run_id ? String(row.master_run_id) : null,
      title: String(row.title),
      inputPrompt: String(row.input_prompt),
      output: String(row.output ?? ''),
      providerUsed: row.provider_used ? (String(row.provider_used) as AIProviderId) : null,
      modelUsed: row.model_used ? String(row.model_used) : null,
      status: row.status as AgentTask['status'],
      tokensUsed: Number(row.tokens_used ?? 0),
      latencyMs: Number(row.latency_ms ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
    };
  }

  listAgentTasksForUser(userId: string, agentId?: string, limit = 50): AgentTask[] {
    const rows = agentId
      ? (this.db
          .prepare(
            'SELECT * FROM agent_tasks WHERE user_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(userId, agentId, limit) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM agent_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(userId, limit) as Record<string, unknown>[]);
    return rows.map((r) => this.mapAgentTaskRow(r));
  }

  saveAgentTask(task: AgentTask): AgentTask {
    this.db
      .prepare(`
        INSERT INTO agent_tasks (
          id, user_id, agent_id, agent_name, role_key, master_run_id, title, input_prompt,
          output, provider_used, model_used, status, tokens_used, latency_ms, error_message, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          output = excluded.output,
          provider_used = excluded.provider_used,
          model_used = excluded.model_used,
          status = excluded.status,
          tokens_used = excluded.tokens_used,
          latency_ms = excluded.latency_ms,
          error_message = excluded.error_message,
          completed_at = excluded.completed_at
      `)
      .run(
        task.id,
        task.userId,
        task.agentId,
        task.agentName,
        task.roleKey,
        task.masterRunId,
        task.title,
        task.inputPrompt,
        task.output,
        task.providerUsed,
        task.modelUsed,
        task.status,
        task.tokensUsed,
        task.latencyMs,
        task.errorMessage,
        task.createdAt,
        task.completedAt,
      );
    syncAgentTaskToFirestore(task);
    return task;
  }

  recordGatewayUsage(entry: Omit<UsageRecord, 'id' | 'createdAt'>): UsageRecord {
    const record: UsageRecord = {
      ...entry,
      id: `usg-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(`
        INSERT INTO usage_records (
          id, user_id, provider, model, task_type, agent_id, source_endpoint,
          status, input_tokens, output_tokens, total_tokens, latency_ms, fallback_used, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.provider,
        record.model,
        record.taskType,
        record.agentId,
        record.sourceEndpoint,
        record.status,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
        record.latencyMs,
        record.fallbackUsed ? 1 : 0,
        record.errorMessage,
        record.createdAt,
      );
    syncUsageRecordToFirestore(record);
    return record;
  }

  listUsageRecordsForUser(userId: string, limit = 100): UsageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      provider: r.provider as AIProviderId,
      model: String(r.model),
      taskType: r.task_type as GatewayTaskType,
      agentId: r.agent_id ? String(r.agent_id) : null,
      sourceEndpoint: String(r.source_endpoint),
      status: r.status as UsageRecord['status'],
      inputTokens: Number(r.input_tokens ?? 0),
      outputTokens: Number(r.output_tokens ?? 0),
      totalTokens: Number(r.total_tokens ?? 0),
      latencyMs: Number(r.latency_ms ?? 0),
      fallbackUsed: Boolean(r.fallback_used),
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: String(r.created_at),
    }));
  }

  getModelPerformanceMetricsForUser(userId: string): ModelPerformanceMetric[] {
    const records = this.listUsageRecordsForUser(userId, 500);
    const groups = new Map<string, UsageRecord[]>();
    for (const r of records) {
      const key = `${r.provider}::${r.model}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const metrics: ModelPerformanceMetric[] = [];
    for (const [, list] of groups) {
      const first = list[0];
      const totalCalls = list.length;
      const successCalls = list.filter((r) => r.status !== 'error').length;
      const errorCalls = list.filter((r) => r.status === 'error').length;
      const fallbackCalls = list.filter((r) => r.fallbackUsed).length;
      const latencies = list.map((r) => r.latencyMs).sort((a, b) => a - b);
      const avgLatencyMs = Math.round(
        latencies.reduce((sum, l) => sum + l, 0) / Math.max(1, latencies.length),
      );
      const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
      const p95LatencyMs = latencies[p95Idx] ?? 0;
      const totalTokens = list.reduce((sum, r) => sum + r.totalTokens, 0);

      metrics.push({
        provider: first.provider,
        model: first.model,
        totalCalls,
        successCalls,
        errorCalls,
        fallbackCalls,
        successRate: Math.round((successCalls / Math.max(1, totalCalls)) * 100),
        avgLatencyMs,
        p95LatencyMs,
        totalTokens,
      });
    }

    return metrics.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  saveMasterRun(run: MasterExecutionResult): MasterExecutionResult {
    this.db
      .prepare(`
        INSERT INTO master_runs (
          id, user_id, request, classification, routing_json, plan_summary, steps_json,
          combined_response, total_tokens, total_latency_ms, requires_approval, approved, status, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          steps_json = excluded.steps_json,
          combined_response = excluded.combined_response,
          total_tokens = excluded.total_tokens,
          total_latency_ms = excluded.total_latency_ms,
          approved = excluded.approved,
          status = excluded.status,
          completed_at = excluded.completed_at
      `)
      .run(
        run.id,
        run.userId,
        run.request,
        run.classification,
        JSON.stringify(run.routing),
        run.planSummary,
        JSON.stringify(run.steps),
        run.combinedResponse,
        run.totalTokens,
        run.totalLatencyMs,
        run.requiresApproval ? 1 : 0,
        run.approved ? 1 : 0,
        run.status,
        run.createdAt,
        run.completedAt,
      );
    return run;
  }

  listMasterRunsForUser(userId: string, limit = 25): MasterExecutionResult[] {
    const rows = this.db
      .prepare('SELECT * FROM master_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      request: String(r.request),
      classification: r.classification as GatewayTaskType,
      routing: JSON.parse(String(r.routing_json)) as MasterExecutionResult['routing'],
      planSummary: String(r.plan_summary),
      steps: JSON.parse(String(r.steps_json)) as MasterExecutionResult['steps'],
      combinedResponse: String(r.combined_response),
      totalTokens: Number(r.total_tokens ?? 0),
      totalLatencyMs: Number(r.total_latency_ms ?? 0),
      requiresApproval: Boolean(r.requires_approval),
      approved: Boolean(r.approved),
      status: r.status as MasterExecutionResult['status'],
      createdAt: String(r.created_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    }));
  }

  // --- Google Ecosystem OAuth Connections (Encrypted Token Storage) ---
  getGoogleConnectionForUser(userId: string): GoogleConnectionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM google_connections WHERE user_id = ?')
      .get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const accessToken = decryptSecret(String(row.encrypted_access_token ?? ''));
    if (!accessToken) return null;

    return {
      userId: String(row.user_id),
      googleEmail: String(row.google_email),
      grantedScopes: JSON.parse(String(row.granted_scopes_json ?? '[]')) as string[],
      connectedServices: JSON.parse(String(row.connected_services_json ?? '[]')) as string[],
      accessToken,
      refreshToken: row.encrypted_refresh_token
        ? decryptSecret(String(row.encrypted_refresh_token))
        : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      authSource: (row.auth_source === 'firebase_popup' ? 'firebase_popup' : 'oauth2'),
      updatedAt: String(row.updated_at),
    };
  }

  upsertGoogleConnection(input: {
    userId: string;
    googleEmail: string;
    grantedScopes: string[];
    connectedServices: string[];
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
    authSource?: 'oauth2' | 'firebase_popup';
  }): GoogleConnectionRecord {
    const now = new Date().toISOString();
    const existing = this.getGoogleConnectionForUser(input.userId);
    const mergedScopes = Array.from(
      new Set([...(existing?.grantedScopes ?? []), ...input.grantedScopes]),
    );
    const mergedServices = Array.from(
      new Set([...(existing?.connectedServices ?? []), ...input.connectedServices]),
    );
    const refreshToStore = input.refreshToken ?? existing?.refreshToken ?? null;
    const encryptedAccess = encryptSecret(input.accessToken);
    const encryptedRefresh = refreshToStore ? encryptSecret(refreshToStore) : null;

    this.db
      .prepare(`
        INSERT INTO google_connections (
          user_id, google_email, granted_scopes_json, connected_services_json,
          encrypted_access_token, encrypted_refresh_token, expires_at, auth_source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          google_email = excluded.google_email,
          granted_scopes_json = excluded.granted_scopes_json,
          connected_services_json = excluded.connected_services_json,
          encrypted_access_token = excluded.encrypted_access_token,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          expires_at = excluded.expires_at,
          auth_source = excluded.auth_source,
          updated_at = excluded.updated_at
      `)
      .run(
        input.userId,
        input.googleEmail,
        JSON.stringify(mergedScopes),
        JSON.stringify(mergedServices),
        encryptedAccess,
        encryptedRefresh,
        input.expiresAt ?? existing?.expiresAt ?? null,
        input.authSource ?? existing?.authSource ?? 'oauth2',
        now,
      );

    return this.getGoogleConnectionForUser(input.userId)!;
  }

  deleteGoogleConnection(userId: string): boolean {
    const res = this.db.prepare('DELETE FROM google_connections WHERE user_id = ?').run(userId);
    return res.changes > 0;
  }

  // --- Cloud Snapshot Hydration & Sync Helpers (Vercel Serverless Persistence) ---
  exportCloudSnapshot(): WorkspaceCloudSnapshot {
    const tableOrder = [
      'users',
      'assistants',
      'conversations',
      'messages',
      'assistant_memories',
      'knowledge_documents',
      'knowledge_chunks',
      'orchestration_runs',
      'research_reports',
      'lab_workspaces',
      'automation_workflows',
      'workflow_runs',
      'media_projects',
      'marketplace_listings',
      'marketplace_reviews',
      'research_projects',
      'research_sources',
      'provider_settings',
      'specialist_agents',
      'agent_tasks',
      'master_runs',
      'google_connections',
    ];
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const table of tableOrder) {
      tables[table] = this.db.prepare(`SELECT * FROM ${table}`).all() as Array<
        Record<string, unknown>
      >;
    }
    return {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      tables,
    };
  }

  importCloudSnapshot(snapshot: WorkspaceCloudSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables) return;
    const tableOrder = [
      'users',
      'assistants',
      'conversations',
      'messages',
      'assistant_memories',
      'knowledge_documents',
      'knowledge_chunks',
      'orchestration_runs',
      'research_reports',
      'lab_workspaces',
      'automation_workflows',
      'workflow_runs',
      'media_projects',
      'marketplace_listings',
      'marketplace_reviews',
      'research_projects',
      'research_sources',
      'provider_settings',
      'specialist_agents',
      'agent_tasks',
      'master_runs',
      'google_connections',
    ];

    let inTransaction = false;
    this.db.exec('PRAGMA foreign_keys = OFF;');
    try {
      this.db.exec('BEGIN IMMEDIATE;');
      inTransaction = true;

      for (const table of [...tableOrder].reverse()) {
        const rows = snapshot.tables[table];
        if (!Array.isArray(rows)) continue;
        // Never wipe seeded baseline users if snapshot contains an empty users array
        if (table === 'users' && rows.length === 0) continue;
        this.db.exec(`DELETE FROM ${table}`);
      }

      for (const table of tableOrder) {
        const rows = snapshot.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const validCols = new Set(
          (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
            (c) => c.name,
          ),
        );
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const cols = Object.keys(row).filter(
            (k) => /^[a-zA-Z0-9_]+$/.test(k) && validCols.has(k),
          );
          if (cols.length === 0) continue;
          const placeholders = cols.map(() => '?').join(', ');
          const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
          const values = cols.map((c) => {
            const v = row[c];
            if (v === undefined || v === null) return null;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') {
              return v;
            }
            if (typeof v === 'boolean') return v ? 1 : 0;
            return JSON.stringify(v);
          });
          this.db.prepare(sql).run(...values);
        }
      }
      this.db.exec('COMMIT; PRAGMA foreign_keys = ON;');
      inTransaction = false;
    } catch (err) {
      if (inTransaction) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Ignore rollback errors if transaction already closed
        }
      }
      try {
        this.db.exec('PRAGMA foreign_keys = ON;');
      } catch {
        // Ignore
      }
      throw err;
    }
  }
}

export const db = new NexusDatabaseService();


