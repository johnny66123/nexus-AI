import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  AI_PROVIDERS,
  assistantExportSchema,
  assistantInputSchema,
  createConversationSchema,
  dispatchAgentTaskSchema,
  gatewayExecuteSchema,
  labAiAssistSchema,
  labExecuteSchema,
  loginSchema,
  marketplaceReviewSchema,
  masterExecuteSchema,
  memoryInputSchema,
  orchestrationRequestSchema,
  providerSettingUpdateSchema,
  registerSchema,
  RESEARCH_AGENTS,
  RESEARCH_TYPE_CATALOG,
  researchInvestigationSchema,
  researchPrivacyUpdateSchema,
  researchRequestSchema,
  sendMessageSchema,
  specialistAgentUpdateSchema,
  USER_ROLES,
  userProfileSchema,
  WORKSPACE_LIMITS,
  workflowInputSchema,
} from './shared/schema.ts';
import type { AIProviderId, AuthUser, ResearchProject, UserRole } from './shared/schema.ts';
import { runAutomationWorkflow, startAutomationScheduler } from './server/automation.ts';
import {
  ensureCloudHydrated,
  flushCloudPersistence,
  getActiveDatabaseBackend,
} from './server/cloudPersistence.ts';
import { db } from './server/db.ts';
import { generateResearchDocxBuffer, generateResearchPdfBuffer } from './server/exporters.ts';
import { getFirebaseProjectInfo, verifyFirebaseIdToken } from './server/firestore.ts';
import {
  GatewayProviderError,
  modelGateway,
  streamGatewayChatReply,
} from './server/gateway.ts';
import {
  analyzeImageBase64,
  executeMultiAgentOrchestration,
  extractCandidateMemories,
  formatGeminiError,
  generateText,
  runGroundedResearch,
  synthesizeSpeechWav,
  transcribeAudioBase64,
} from './server/gemini.ts';
import {
  buildGoogleOAuthConsentUrl,
  exchangeGoogleOAuthCode,
  executeGoogleAction,
  getGoogleEcosystemStatus,
  GoogleIntegrationError,
  isGoogleOAuthClientConfigured,
  routeNaturalLanguageGoogleCommand,
} from './server/googleServices.ts';
import type { GoogleServiceId } from './server/googleServices.ts';
import { createInitialPipelineStages, runIntelligenceInvestigation } from './server/intelligence.ts';
import { chunkText, extractDocumentText } from './server/knowledge.ts';
import { masterIntelligence } from './server/master.ts';
import { executeSandboxedJavaScript } from './server/sandbox.ts';
import {
  createRateLimiter,
  hasPersistentSessionSecret,
  inspectPromptInjection,
  parseCookies,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
} from './server/security.ts';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function isHttpsRequest(req: express.Request): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  return Boolean(
    req.secure ||
      (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') ||
      process.env.NODE_ENV === 'production',
  );
}

function setSessionCookie(req: express.Request, res: express.Response, user: AuthUser): string {
  const token = signSessionToken(user.id, user.role);
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (https) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
  return token;
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    https ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=0',
  ];
  if (https) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function resolveAuthenticatedUser(req: express.Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      const sessionPayload = verifySessionToken(bearerToken);
      if (sessionPayload) {
        const user = db.getUserById(sessionPayload.userId);
        if (user && user.status === 'active') {
          db.ensureUserDefaults(user.id);
          return user;
        }
      }
      try {
        const decoded = await verifyFirebaseIdToken(bearerToken);
        if (decoded.uid && decoded.email) {
          const user = db.upsertFirebaseUser({
            uid: decoded.uid,
            email: decoded.email,
            displayName: decoded.name || decoded.email.split('@')[0],
          });
          if (user.status === 'active') return user;
        }
      } catch {
        // Fall through to cookie check
      }
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (payload) {
    const user = db.getUserById(payload.userId);
    if (user && user.status === 'active') {
      db.ensureUserDefaults(user.id);
      return user;
    }
  }
  return null;
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    clearSessionCookie(req, res);
    res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'AUTH_REQUIRED',
    });
    return;
  }
  req.authUser = user;
  next();
}

function requireRole(allowed: UserRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!allowed.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Insufficient permissions. Requires role: ${allowed.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  // Baseline security headers (compatible with Vercel & iframe previews)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=(self)');
    next();
  });

  // Cloud DB hydration & mutation flush for serverless environments (Vercel + Supabase/Firestore)
  app.use('/api', async (req, res, next) => {
    await ensureCloudHydrated(db);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          void flushCloudPersistence(db);
        }
      });
    }
    next();
  });

  const generalLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 180,
    name: 'api-general',
  });
  const authLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 25,
    name: 'api-auth',
  });
  const aiLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 40,
    name: 'api-ai',
  });

  app.use('/api', generalLimiter);

  // Health & Capability Status (never returns keys)
  app.get('/api/health', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const githubToken = process.env.GITHUB_TOKEN;
    const googleConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
    const anthropicConfigured = Boolean(anthropicKey && anthropicKey !== 'MY_ANTHROPIC_API_KEY');
    const openaiConfigured = Boolean(openaiKey && openaiKey !== 'MY_OPENAI_API_KEY');

    res.json({
      ok: true,
      version: '3.0',
      platform: 'NEVUS AI',
      runtime: process.env.VERCEL === '1' ? 'vercel-serverless' : 'node-server',
      databaseBackend: getActiveDatabaseBackend(db),
      sessionSecretConfigured: hasPersistentSessionSecret(),
      googleOAuthConfigured: isGoogleOAuthClientConfigured(),
      googleMapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim()),
      apiKeyConfigured: googleConfigured,
      providers: {
        google: googleConfigured,
        anthropic: anthropicConfigured,
        openai: openaiConfigured,
      },
      firebase: getFirebaseProjectInfo(),
      githubTokenConfigured: Boolean(githubToken),
      paidImageModelAvailable: false,
    });
  });

  // --- Authentication Routes ---
  app.get('/api/auth/session', async (req, res) => {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const sessionToken = signSessionToken(user.id, user.role);
    res.json({ authenticated: true, user, sessionToken });
  });

  app.post('/api/auth/firebase', authLimiter, async (req, res) => {
    const schema = z.object({ idToken: z.string().trim().min(10) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid Firebase ID token is required.' });
      return;
    }
    try {
      const decoded = await verifyFirebaseIdToken(parsed.data.idToken);
      if (!decoded.uid || !decoded.email) {
        res.status(400).json({ error: 'Firebase token must include verified email.' });
        return;
      }
      const user = db.upsertFirebaseUser({
        uid: decoded.uid,
        email: decoded.email,
        displayName: decoded.name || decoded.email.split('@')[0],
      });
      if (user.status !== 'active') {
        res.status(403).json({ error: 'Account is suspended.' });
        return;
      }
      const sessionToken = setSessionCookie(req, res, user);
      db.addAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'auth.firebase_login',
        resourceType: 'session',
        resourceId: user.id,
        details: `Signed in via Firebase Auth (${user.role})`,
      });
      res.json({ user, sessionToken });
    } catch (err) {
      res.status(401).json({
        error:
          err instanceof Error
            ? `Firebase authentication verification failed: ${err.message}`
            : 'Invalid Firebase token.',
      });
    }
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' });
      return;
    }
    const user = db.authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password, or account suspended.' });
      return;
    }
    const sessionToken = setSessionCookie(req, res, user);
    db.addAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: user.id,
      details: `Signed in with role ${user.role}`,
    });
    res.json({ user, sessionToken });
  });

  app.post('/api/auth/register', authLimiter, (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration data.' });
      return;
    }
    try {
      const user = db.registerUser({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.displayName,
        roleTitle: parsed.data.roleTitle,
        role: 'developer',
      });
      const sessionToken = setSessionCookie(req, res, user);
      db.addAuditLog({
        userId: user.id,
        userEmail: user.email,
        action: 'auth.register',
        resourceType: 'user',
        resourceId: user.id,
        details: 'New developer account created',
      });
      res.status(201).json({ user, sessionToken });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // --- Overview (User-isolated) ---
  app.get('/api/overview', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const assistants = db.listAssistantsForUser(userId);
    const conversations = db.listConversations(undefined, userId);
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.messages.length, 0);
    const profile = db.getProfileForUser(userId)!;
    const documents = db.listDocuments(userId);
    const workflows = db.listWorkflows(userId);
    const assistantIdsSet = new Set(assistants.map((a) => a.id));
    const memories = db.listMemories().filter((m) => assistantIdsSet.has(m.assistantId));

    res.json({
      stats: {
        assistantCount: assistants.length,
        conversationCount: conversations.length,
        totalMessages,
        documentCount: documents.length,
        workflowCount: workflows.length,
        memoryCount: memories.length,
      },
      assistants,
      recentConversations: conversations.slice(0, 8),
      profile,
    });
  });

  // --- Module 1: AI Agent Factory (User-isolated) ---
  app.get('/api/assistants', requireAuth, (req, res) => {
    res.json({ assistants: db.listAssistantsForUser(req.authUser!.id) });
  });

  app.post('/api/assistants', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = assistantInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid assistant configuration.',
        issues: parsed.error.issues,
      });
      return;
    }
    try {
      const assistant = db.createAssistant(req.authUser!.id, parsed.data);
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'assistant.create',
        resourceType: 'assistant',
        resourceId: assistant.id,
        details: `Created "${assistant.name}" (${assistant.model})`,
      });
      res.status(201).json({ assistant });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create assistant.' });
    }
  });

  app.put('/api/assistants/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const existing = db.getAssistantForUser(
      String(req.params.id),
      req.authUser!.id,
      req.authUser!.role === 'admin',
    );
    if (!existing || (existing.ownerUserId !== req.authUser!.id && req.authUser!.role !== 'admin')) {
      res.status(404).json({ error: 'Assistant not found or access denied.' });
      return;
    }
    const parsed = assistantInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid assistant configuration.',
        issues: parsed.error.issues,
      });
      return;
    }
    const updated = db.updateAssistant(String(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Assistant not found.' });
      return;
    }
    db.addAuditLog({
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'assistant.update',
      resourceType: 'assistant',
      resourceId: updated.id,
      details: `Updated "${updated.name}"`,
    });
    res.json({ assistant: updated });
  });

  app.post('/api/assistants/:id/duplicate', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const visible = db.getAssistantForUser(
      String(req.params.id),
      req.authUser!.id,
      req.authUser!.role === 'admin',
    );
    if (!visible) {
      res.status(404).json({ error: 'Source assistant not found or access denied.' });
      return;
    }
    try {
      const copy = db.duplicateAssistant(String(req.params.id), req.authUser!.id);
      if (!copy) {
        res.status(404).json({ error: 'Source assistant not found.' });
        return;
      }
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'assistant.duplicate',
        resourceType: 'assistant',
        resourceId: copy.id,
        details: `Duplicated from ${String(req.params.id)}`,
      });
      res.status(201).json({ assistant: copy });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Duplication failed.' });
    }
  });

  app.get('/api/assistants/:id/export', requireAuth, (req, res) => {
    const a = db.getAssistantForUser(
      String(req.params.id),
      req.authUser!.id,
      req.authUser!.role === 'admin',
    );
    if (!a) {
      res.status(404).json({ error: 'Assistant not found or access denied.' });
      return;
    }
    res.json({
      format: 'nexus-assistant-v2',
      assistant: {
        name: a.name,
        description: a.description,
        purpose: a.purpose,
        personality: a.personality,
        instructions: a.instructions,
        model: a.model,
        thinkingLevel: a.thinkingLevel,
        isPublic: a.isPublic,
        category: a.category,
      },
    });
  });

  app.post('/api/assistants/import', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = assistantExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid NEXUS AI assistant configuration JSON.',
        issues: parsed.error.issues,
      });
      return;
    }
    try {
      const assistant = db.createAssistant(req.authUser!.id, parsed.data.assistant);
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'assistant.import',
        resourceType: 'assistant',
        resourceId: assistant.id,
        details: `Imported "${assistant.name}"`,
      });
      res.status(201).json({ assistant });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed.' });
    }
  });

  app.delete('/api/assistants/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const id = String(req.params.id);
    const existing = db.getAssistantForUser(id, req.authUser!.id, req.authUser!.role === 'admin');
    if (!existing || (existing.ownerUserId !== req.authUser!.id && req.authUser!.role !== 'admin')) {
      res.status(404).json({ error: 'Assistant not found or access denied.' });
      return;
    }
    const deleted = db.deleteAssistant(id);
    if (!deleted) {
      res.status(404).json({ error: 'Assistant not found.' });
      return;
    }
    db.addAuditLog({
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'assistant.delete',
      resourceType: 'assistant',
      resourceId: id,
      details: 'Deleted assistant and associated conversations',
    });
    res.json({ deleted: true });
  });

  // --- Conversations & Streaming Chat (User-isolated) ---
  app.get('/api/conversations', requireAuth, (req, res) => {
    const assistantId = typeof req.query.assistantId === 'string' ? req.query.assistantId : undefined;
    res.json({ conversations: db.listConversations(assistantId, req.authUser!.id) });
  });

  app.post('/api/conversations', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid conversation.' });
      return;
    }
    const visibleAssistant = db.getAssistantForUser(
      parsed.data.assistantId,
      req.authUser!.id,
      req.authUser!.role === 'admin',
    );
    if (!visibleAssistant) {
      res.status(404).json({ error: 'Assistant not found or access denied.' });
      return;
    }
    const conversation = db.createConversation(
      parsed.data.assistantId,
      req.authUser!.id,
      parsed.data.title,
    );
    if (!conversation) {
      res.status(404).json({ error: 'Assistant not found.' });
      return;
    }
    res.status(201).json({ conversation });
  });

  app.delete('/api/conversations/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const conv = db.getConversationForUser(
      String(req.params.id),
      req.authUser!.id,
      req.authUser!.role === 'admin',
    );
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found or access denied.' });
      return;
    }
    const deleted = db.deleteConversation(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  app.post(
    '/api/conversations/:id/messages/stream',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Validation failed.' });
        return;
      }

      const injectionCheck = inspectPromptInjection(parsed.data.message);
      if (injectionCheck.flagged) {
        db.addAuditLog({
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'security.prompt_injection_blocked',
          resourceType: 'conversation',
          resourceId: String(req.params.id),
          details: 'Blocked prompt injection pattern in user input',
        });
        res.status(400).json({
          error: 'Input blocked by security policy: detected system prompt override attempt.',
        });
        return;
      }

      const conversation = db.getConversationForUser(
        String(req.params.id),
        req.authUser!.id,
        req.authUser!.role === 'admin',
      );
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found or access denied.' });
        return;
      }

      const assistant = db.getAssistant(conversation.assistantId);
      if (!assistant) {
        res.status(404).json({ error: 'Assigned assistant no longer exists.' });
        return;
      }

      const profile = db.getProfileForUser(req.authUser!.id)!;
      const approvedMemories = db.listMemories(assistant.id).filter((m) => m.approved);
      const knowledgeHits =
        parsed.data.documentIds && parsed.data.documentIds.length > 0
          ? db.searchKnowledgeChunks(parsed.data.message, parsed.data.documentIds, 4)
          : [];

      const { compileSystemPrompt } = await import('./shared/schema.ts');
      const { wrapUntrustedContext } = await import('./server/security.ts');
      const systemInstruction = compileSystemPrompt(
        assistant,
        profile.responseFormatPreference,
        approvedMemories,
      );

      let composedUserMessage = parsed.data.message;
      if (knowledgeHits.length > 0) {
        const contextText = knowledgeHits
          .map((h) => `[Document: ${h.documentTitle} | Chunk #${h.chunkIndex + 1}]\n${h.content}`)
          .join('\n\n');
        composedUserMessage = `${wrapUntrustedContext('knowledge_base', contextText)}\n\nUser Question: ${parsed.data.message}`;
      }

      const targetModel =
        parsed.data.preferredModel && parsed.data.preferredModel !== 'auto'
          ? parsed.data.preferredModel
          : assistant.model;

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const started = Date.now();
      let fullReply = '';
      let actualModelUsed = targetModel;
      try {
        for await (const chunk of streamGatewayChatReply({
          userId: req.authUser!.id,
          provider: parsed.data.preferredProvider,
          model: targetModel,
          history: conversation.messages.map((m) => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content,
          })),
          userMessage: composedUserMessage,
          systemInstruction,
          thinkingLevel: assistant.thinkingLevel,
        })) {
          if (chunk.modelUsed) actualModelUsed = chunk.modelUsed;
          if (chunk.delta) {
            fullReply += chunk.delta;
            res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk.delta })}\n\n`);
          }
        }

        const finalText = fullReply.trim();
        if (!finalText) {
          throw new Error('Model returned an empty response.');
        }

        const saved = db.appendMessages(
          conversation.id,
          parsed.data.message,
          finalText,
          actualModelUsed,
        );
        if (!saved) {
          throw new Error('Conversation was deleted before saving.');
        }

        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/conversations/:id/messages/stream',
          model: actualModelUsed,
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil((parsed.data.message.length + finalText.length) / 4),
        });

        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            userMessage: saved.userMessage,
            modelMessage: saved.modelMessage,
            conversation: saved.conversation,
          })}\n\n`,
        );
        res.end();
      } catch (err) {
        const status =
          err instanceof GatewayProviderError
            ? err.statusCode
            : formatGeminiError(err).status;
        const message =
          err instanceof GatewayProviderError
            ? err.message
            : formatGeminiError(err).message;
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'chat.stream',
          message,
          statusCode: status,
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/conversations/:id/messages/stream',
          model: actualModelUsed,
          statusCode: status,
          latencyMs: Date.now() - started,
          estimatedTokens: 0,
        });
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            status,
            error: message,
          })}\n\n`,
        );
        res.end();
      }
    },
  );

  // --- Module 3: Advanced AI Memory ---
  app.get('/api/memories', requireAuth, (req, res) => {
    const assistantId = typeof req.query.assistantId === 'string' ? req.query.assistantId : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ memories: db.listMemories(assistantId, q) });
  });

  app.post('/api/memories', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = memoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid memory payload.' });
      return;
    }
    try {
      const memory = db.createMemory(parsed.data);
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'memory.create',
        resourceType: 'memory',
        resourceId: memory.id,
        details: `Added memory "${memory.key}" for assistant ${memory.assistantId}`,
      });
      res.status(201).json({ memory });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save memory.' });
    }
  });

  app.post(
    '/api/memories/extract',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({ conversationId: z.string().trim().min(1) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'conversationId is required.' });
        return;
      }
      const conv = db.getConversation(parsed.data.conversationId);
      if (!conv || conv.messages.length === 0) {
        res.status(400).json({ error: 'Conversation has no messages to extract memories from.' });
        return;
      }
      const assistant = db.getAssistant(conv.assistantId);
      if (!assistant) {
        res.status(404).json({ error: 'Assistant not found.' });
        return;
      }

      const started = Date.now();
      try {
        const transcript = conv.messages
          .slice(-10)
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');
        const candidates = await extractCandidateMemories({
          assistantName: assistant.name,
          conversationText: transcript,
        });

        const created = candidates.map((c) =>
          db.createMemory({
            assistantId: assistant.id,
            key: c.key,
            content: c.content,
            category: c.category,
            approved: false, // Requires explicit user approval!
            source: 'extracted',
          }),
        );

        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/memories/extract',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: 350,
        });
        res.json({ proposedMemories: created });
      } catch (err) {
        const formatted = formatGeminiError(err);
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'memory.extract',
          message: formatted.message,
          statusCode: formatted.status,
        });
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.put('/api/memories/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const schema = memoryInputSchema.partial();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid memory update.' });
      return;
    }
    const updated = db.updateMemory(String(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Memory entry not found.' });
      return;
    }
    res.json({ memory: updated });
  });

  app.delete('/api/memories/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const deleted = db.deleteMemory(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Memory entry not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Module 2: Multi-Agent Orchestration ---
  app.get('/api/orchestration', requireAuth, (req, res) => {
    res.json({ runs: db.listOrchestrationRuns(req.authUser!.id) });
  });

  app.post(
    '/api/orchestration/run',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = orchestrationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid orchestration parameters.',
        });
        return;
      }

      const inj = inspectPromptInjection(
        `${parsed.data.objective}\n${parsed.data.sharedContext}`,
      );
      if (inj.flagged) {
        res.status(400).json({ error: 'Orchestration input blocked by prompt injection filter.' });
        return;
      }

      const agents = parsed.data.agentIds
        .map((id) => db.getAssistantForUser(id, req.authUser!.id, req.authUser!.role === 'admin'))
        .filter((a): a is NonNullable<typeof a> => Boolean(a));
      if (agents.length === 0) {
        res.status(404).json({ error: 'No valid specialist assistants selected.' });
        return;
      }

      const memoriesByAgent = new Map(
        agents.map((a) => [a.id, db.listMemories(a.id).filter((m) => m.approved)]),
      );
      const profile = db.getProfileForUser(req.authUser!.id)!;
      const runId = `orch-${crypto.randomUUID()}`;
      const started = Date.now();

      try {
        const result = await executeMultiAgentOrchestration({
          runId,
          userId: req.authUser!.id,
          objective: parsed.data.objective,
          agents,
          sharedContext: parsed.data.sharedContext,
          memoriesByAgent,
          profile,
        });
        db.saveOrchestrationRun(result);
        db.addAuditLog({
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'orchestration.run',
          resourceType: 'orchestration_run',
          resourceId: result.id,
          details: `Coordinated ${agents.length} agents (${result.status})`,
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/orchestration/run',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(result.finalSynthesis.length / 4) + 500,
        });
        res.status(201).json({ run: result });
      } catch (err) {
        const formatted = formatGeminiError(err);
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'orchestration.run',
          message: formatted.message,
          statusCode: formatted.status,
        });
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  // --- Module 8: Knowledge Centre (User-isolated) ---
  app.get('/api/knowledge/documents', requireAuth, (req, res) => {
    res.json({ documents: db.listDocuments(req.authUser!.id) });
  });

  app.post(
    '/api/knowledge/upload',
    requireAuth,
    requireRole(['admin', 'developer']),
    upload.single('file'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Please select a PDF, DOCX, CSV, XLSX, or TXT file.' });
        return;
      }

      try {
        const { text, fileType } = await extractDocumentText(
          req.file.buffer,
          req.file.originalname,
        );
        if (!text) {
          res.status(400).json({ error: 'No readable text could be extracted from this file.' });
          return;
        }
        const chunks = chunkText(text);
        const title =
          typeof req.body.title === 'string' && req.body.title.trim()
            ? req.body.title.trim().slice(0, 100)
            : req.file.originalname;

        let summary = `${chunks.length} indexed chunk(s) extracted from ${req.file.originalname}.`;
        if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
          try {
            summary = await generateText({
              model: 'gemini-3.1-flash-lite',
              prompt: `Summarize this document excerpt in 2 crisp sentences:\n\n${chunks.slice(0, 3).join('\n\n')}`,
            });
          } catch {
            // Keep extracted fallback summary if API is unavailable
          }
        }

        const doc = db.saveDocumentWithChunks({
          userId: req.authUser!.id,
          title,
          filename: req.file.originalname,
          fileType,
          sizeBytes: req.file.size,
          summary,
          chunks,
        });

        db.addAuditLog({
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'knowledge.upload',
          resourceType: 'document',
          resourceId: doc.id,
          details: `Uploaded ${doc.filename} (${doc.chunkCount} chunks)`,
        });
        res.status(201).json({ document: doc });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to parse uploaded document.',
        });
      }
    },
  );

  app.get('/api/knowledge/search', requireAuth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const hits = db.searchKnowledgeChunks(q, undefined, 10);
    res.json({ hits });
  });

  app.post(
    '/api/knowledge/qa',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({
        question: z.string().trim().min(3).max(1500),
        documentIds: z.array(z.string().trim()).max(10).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid question.' });
        return;
      }

      const hits = db.searchKnowledgeChunks(
        parsed.data.question,
        parsed.data.documentIds,
        6,
      );
      if (hits.length === 0) {
        res.status(404).json({
          error: 'No relevant document chunks found. Upload a document or broaden your query.',
        });
        return;
      }

      const started = Date.now();
      try {
        const context = hits
          .map((h) => `[Source: ${h.documentTitle} · Chunk ${h.chunkIndex + 1}]\n${h.content}`)
          .join('\n\n');
        const answer = await generateText({
          model: 'gemini-4-hydrogen',
          thinkingLevel: 'LOW',
          systemInstruction:
            'Answer the user question strictly based on the provided document excerpts inside <untrusted_context>. Cite the document title for each factual claim. If the answer is not present in the excerpts, state that explicitly.',
          prompt: `<untrusted_context source="knowledge_centre">\n${context}\n</untrusted_context>\n\nQuestion: ${parsed.data.question}`,
        });

        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/knowledge/qa',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil((context.length + answer.length) / 4),
        });
        res.json({ answer, sources: hits });
      } catch (err) {
        const formatted = formatGeminiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.delete('/api/knowledge/documents/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const deleted = db.deleteDocument(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Module 4: AI Research Centre ---
  app.get('/api/research/reports', requireAuth, (_req, res) => {
    res.json({ reports: db.listResearchReports() });
  });

  app.post(
    '/api/research/run',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = researchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid research request.' });
        return;
      }

      let documentContext = '';
      if (
        (parsed.data.mode === 'document_analysis' || parsed.data.mode === 'combined') &&
        parsed.data.documentIds.length > 0
      ) {
        const hits = db.searchKnowledgeChunks(parsed.data.query, parsed.data.documentIds, 8);
        documentContext = hits
          .map((h) => `[${h.documentTitle} #${h.chunkIndex + 1}]\n${h.content}`)
          .join('\n\n');
      } else if (parsed.data.mode === 'document_analysis') {
        const hits = db.searchKnowledgeChunks(parsed.data.query, undefined, 8);
        documentContext = hits
          .map((h) => `[${h.documentTitle} #${h.chunkIndex + 1}]\n${h.content}`)
          .join('\n\n');
      }

      if (parsed.data.mode === 'document_analysis' && !documentContext) {
        res.status(400).json({
          error: 'No uploaded Knowledge Centre content matched for document analysis.',
        });
        return;
      }

      const started = Date.now();
      try {
        const result = await runGroundedResearch({
          query: parsed.data.query,
          mode: parsed.data.mode,
          documentContext: documentContext || undefined,
        });

        const report = db.saveResearchReport({
          id: `res-${crypto.randomUUID()}`,
          userId: req.authUser!.id,
          query: parsed.data.query,
          mode: parsed.data.mode,
          summary: result.summary,
          reportMarkdown: result.reportMarkdown,
          citations: result.citations,
          documentIds: parsed.data.documentIds,
          createdAt: new Date().toISOString(),
        });

        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/research/run',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(result.reportMarkdown.length / 4) + 300,
        });
        res.status(201).json({ report });
      } catch (err) {
        const formatted = formatGeminiError(err);
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'research.run',
          message: formatted.message,
          statusCode: formatted.status,
        });
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  // --- Module 4B: NEXUS Intelligence Engine ---
  app.get('/api/research/dashboard', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const projects = db.listResearchProjectsForUser(userId);
    const savedSources = db.listResearchSourcesForUser(userId, { savedOnly: true });
    const allSources = db.listResearchSourcesForUser(userId, { savedOnly: false });
    const dailyRunsUsed = db.countUserResearchRunsToday(userId);
    const totalOwned = db.countUserResearchProjects(userId);

    const activeProjects = projects.filter((p) => p.status === 'running');
    const completedProjects = projects.filter(
      (p) => p.status === 'completed' || p.status === 'completed_with_warnings',
    );
    const incompleteProjects = projects.filter(
      (p) => p.status === 'incomplete_search_failed' || p.status === 'failed',
    );

    res.json({
      projects,
      savedSources,
      allSources,
      agents: RESEARCH_AGENTS,
      researchTypes: RESEARCH_TYPE_CATALOG,
      stats: {
        totalProjects: projects.length,
        activeCount: activeProjects.length,
        completedCount: completedProjects.length,
        incompleteCount: incompleteProjects.length,
        savedSourcesCount: savedSources.length,
        totalSourcesCount: allSources.length,
        dailyRunsUsed,
        dailyRunLimit: WORKSPACE_LIMITS.dailyResearchRunLimit,
        ownedProjectCount: totalOwned,
        maxProjectsPerUser: WORKSPACE_LIMITS.maxResearchProjectsPerUser,
      },
    });
  });

  app.get('/api/research/projects/:id', requireAuth, (req, res) => {
    const project = db.getResearchProjectForUser(String(req.params.id), req.authUser!.id);
    if (!project) {
      res.status(404).json({ error: 'Research project not found or access denied.' });
      return;
    }
    res.json({ project });
  });

  app.post(
    '/api/research/investigate',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = researchInvestigationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid research investigation payload.',
        });
        return;
      }

      const userId = req.authUser!.id;
      if (db.countUserResearchProjects(userId) >= WORKSPACE_LIMITS.maxResearchProjectsPerUser) {
        res.status(429).json({
          error: `Research project limit reached (${WORKSPACE_LIMITS.maxResearchProjectsPerUser}). Delete an archived project first.`,
        });
        return;
      }
      if (db.countUserResearchRunsToday(userId) >= WORKSPACE_LIMITS.dailyResearchRunLimit) {
        res.status(429).json({
          error: `Daily research run limit reached (${WORKSPACE_LIMITS.dailyResearchRunLimit} per 24 hours).`,
        });
        return;
      }

      const injection = inspectPromptInjection(
        `${parsed.data.question}\n${parsed.data.customInstructions}`,
      );
      if (injection.flagged) {
        db.addAuditLog({
          userId,
          userEmail: req.authUser!.email,
          action: 'security.prompt_injection_blocked',
          resourceType: 'research_investigation',
          resourceId: 'blocked',
          details: `Blocked suspicious research prompt pattern: ${injection.matchedPattern ?? 'policy match'}`,
        });
        res.status(400).json({
          error: 'Prompt blocked by NEXUS security policy (possible prompt-injection pattern).',
        });
        return;
      }

      const knowledgeHits =
        parsed.data.sourceMode === 'document_analysis' || parsed.data.sourceMode === 'combined'
          ? db.searchKnowledgeChunks(
              parsed.data.question,
              parsed.data.documentIds.length > 0 ? parsed.data.documentIds : undefined,
              10,
            )
          : [];

      if (parsed.data.sourceMode === 'document_analysis' && knowledgeHits.length === 0) {
        res.status(400).json({
          error: 'No uploaded Knowledge Centre content matched for document analysis.',
        });
        return;
      }

      // Initialize SSE stream
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const writeEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const projectId = `proj-${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const agentIds =
        parsed.data.agentIds && parsed.data.agentIds.length > 0
          ? parsed.data.agentIds
          : (
              RESEARCH_TYPE_CATALOG.find((t) => t.id === parsed.data.researchType) ??
              RESEARCH_TYPE_CATALOG[0]
            ).defaultAgents;

      // Persist initial active project record so active status is tracked in DB immediately
      const activeStub: ResearchProject = {
        id: projectId,
        userId,
        title: parsed.data.question.slice(0, 90),
        question: parsed.data.question,
        researchType: parsed.data.researchType,
        sourceMode: parsed.data.sourceMode,
        visibility: parsed.data.visibility,
        status: 'running',
        searchHealth: parsed.data.sourceMode === 'document_analysis' ? 'not_requested' : 'healthy',
        customInstructions: parsed.data.customInstructions,
        documentIds: parsed.data.documentIds,
        agentIds,
        understandingSummary: 'Initializing multi-stage investigation...',
        subTasks: [],
        searchQueries: [],
        pipelineStages: createInitialPipelineStages(),
        sources: [],
        conflicts: [],
        claimCitations: [],
        agentContributions: [],
        report: {
          executiveSummary: '',
          researchObjectives: '',
          methodology: '',
          mainFindings: '',
          evidenceAndCitations: '',
          limitations: '',
          recommendations: '',
          conclusion: '',
          references: '',
        },
        reportMarkdown: '',
        missingInfo: [],
        errorMessage: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
      };
      db.saveResearchProject(activeStub);
      writeEvent('started', { projectId, project: activeStub });

      const started = Date.now();
      try {
        const finalProject = await runIntelligenceInvestigation({
          projectId,
          userId,
          input: parsed.data,
          knowledgeHits,
          onProgress: (ev) => {
            if (ev.type === 'stage' && ev.stage) {
              writeEvent('stage', { stage: ev.stage });
            } else if (ev.type === 'agent' && ev.agent) {
              writeEvent('agent', { agent: ev.agent });
            }
          },
        });

        db.saveResearchProject(finalProject);
        db.addApiUsageLog({
          userId,
          endpoint: '/api/research/investigate',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(finalProject.reportMarkdown.length / 4) + 900,
        });
        db.addAuditLog({
          userId,
          userEmail: req.authUser!.email,
          action: 'research.investigate',
          resourceType: 'research_project',
          resourceId: finalProject.id,
          details: `Completed ${finalProject.researchType} investigation with status "${finalProject.status}" and ${finalProject.sources.filter((s) => !s.isDuplicate).length} source(s).`,
        });

        writeEvent('complete', { project: finalProject });
        res.end();
      } catch (err) {
        const formatted = formatGeminiError(err);
        const failedAt = new Date().toISOString();
        const failedProject: ResearchProject = {
          ...activeStub,
          status: 'failed',
          searchHealth: parsed.data.sourceMode === 'document_analysis' ? 'not_requested' : 'failed',
          missingInfo: [formatted.message],
          errorMessage: formatted.message,
          updatedAt: failedAt,
          completedAt: failedAt,
        };
        db.saveResearchProject(failedProject);
        db.addErrorLog({
          userId,
          source: 'research.investigate',
          message: formatted.message,
          statusCode: formatted.status,
        });
        writeEvent('error', { error: formatted.message, project: failedProject });
        res.end();
      }
    },
  );

  app.patch(
    '/api/research/projects/:id/privacy',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const parsed = researchPrivacyUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid privacy setting.' });
        return;
      }
      const updated = db.updateResearchProjectPrivacy(
        String(req.params.id),
        req.authUser!.id,
        parsed.data.visibility,
        req.authUser!.role === 'admin',
      );
      if (!updated) {
        res.status(404).json({ error: 'Research project not found or access denied.' });
        return;
      }
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'research.privacy_update',
        resourceType: 'research_project',
        resourceId: updated.id,
        details: `Set research project visibility to "${updated.visibility}"`,
      });
      res.json({ project: updated });
    },
  );

  app.delete(
    '/api/research/projects/:id',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const deleted = db.deleteResearchProject(
        String(req.params.id),
        req.authUser!.id,
        req.authUser!.role === 'admin',
      );
      if (!deleted) {
        res.status(404).json({ error: 'Research project not found or access denied.' });
        return;
      }
      res.json({ deleted: true });
    },
  );

  app.get('/api/research/projects/:id/export', requireAuth, async (req, res) => {
    const project = db.getResearchProjectForUser(String(req.params.id), req.authUser!.id);
    if (!project) {
      res.status(404).json({ error: 'Research project not found or access denied.' });
      return;
    }

    const format = String(req.query.format ?? 'md').toLowerCase();
    const safeSlug = project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || project.id.slice(0, 12);

    try {
      if (format === 'pdf') {
        const pdfBuf = await generateResearchPdfBuffer(project);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="nexus-${safeSlug}.pdf"`);
        res.send(pdfBuf);
        return;
      }
      if (format === 'docx') {
        const docxBuf = await generateResearchDocxBuffer(project);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
        res.setHeader('Content-Disposition', `attachment; filename="nexus-${safeSlug}.docx"`);
        res.send(docxBuf);
        return;
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="nexus-${safeSlug}.md"`);
      res.send(project.reportMarkdown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export generation failed.';
      db.addErrorLog({
        userId: req.authUser!.id,
        source: 'research.export',
        message: msg,
        statusCode: 500,
      });
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/research/sources', requireAuth, (req, res) => {
    const savedOnly = req.query.savedOnly === 'true';
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;
    const sources = db.listResearchSourcesForUser(req.authUser!.id, {
      savedOnly,
      query: q,
      reliabilityTier: tier,
    });
    res.json({ sources });
  });

  app.patch(
    '/api/research/sources/:id/library',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const schema = z.object({ saved: z.boolean() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid source save request.' });
        return;
      }
      const updated = db.toggleSourceSavedToLibrary(
        String(req.params.id),
        req.authUser!.id,
        parsed.data.saved,
      );
      if (!updated) {
        res.status(404).json({ error: 'Source not found or access denied.' });
        return;
      }
      res.json({ source: updated });
    },
  );

  // --- Module 5: AI Development Lab ---
  app.get('/api/lab/workspace', requireAuth, (req, res) => {
    res.json({ workspace: db.getLabWorkspace(req.authUser!.id) });
  });

  app.put('/api/lab/workspace', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const schema = z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1).max(80),
      code: z.string().max(25000),
      testCode: z.string().max(15000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid workspace payload.' });
      return;
    }
    const updated = db.saveLabWorkspace(
      parsed.data.id,
      parsed.data.name,
      parsed.data.code,
      parsed.data.testCode,
    );
    res.json({ workspace: updated });
  });

  app.post('/api/lab/execute', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = labExecuteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid code payload.' });
      return;
    }
    const result = executeSandboxedJavaScript(parsed.data);
    db.addAuditLog({
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'lab.execute',
      resourceType: 'sandbox',
      resourceId: 'vm',
      details: `Executed sandboxed JS (${result.durationMs}ms, passed=${result.passed})`,
    });
    res.json({ result });
  });

  app.post(
    '/api/lab/ai-assist',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = labAiAssistSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid AI lab request.' });
        return;
      }

      const instructionMap = {
        generate:
          'Generate clean, self-contained JavaScript (ES2022, CommonJS `module.exports = { ... }`) compatible with an isolated Node VM sandbox (no require/fs/fetch). Return code inside a single ```javascript block plus brief usage notes.',
        debug:
          'Diagnose the bug or error in the provided sandbox JavaScript code and return the fixed code inside a single ```javascript block along with a concise explanation.',
        write_tests:
          'Write unit test assertions using `assert.strictEqual(...)`, `assert.deepStrictEqual(...)`, or `assert.throws(...)` for the provided functions. Return test lines inside a single ```javascript block.',
      };

      const started = Date.now();
      try {
        const reply = await generateText({
          model: 'gemini-4-hydrogen',
          thinkingLevel: 'MEDIUM',
          systemInstruction: instructionMap[parsed.data.mode],
          prompt: `Task: ${parsed.data.prompt}\n\nCurrent Code:\n${parsed.data.code}\n\n${
            parsed.data.errorOutput ? `Error Output:\n${parsed.data.errorOutput}` : ''
          }`,
        });

        const codeMatch = /```(?:javascript|js|ts)?\n([\s\S]*?)```/i.exec(reply);
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/lab/ai-assist',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(reply.length / 4) + 200,
        });
        res.json({
          reply,
          extractedCode: codeMatch ? codeMatch[1].trim() : null,
        });
      } catch (err) {
        const formatted = formatGeminiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.get('/api/lab/github', requireAuth, async (req, res) => {
    const repo = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      res.status(400).json({ error: 'Enter a valid GitHub repository in owner/repo format.' });
      return;
    }
    if (filePath.includes('..')) {
      res.status(400).json({ error: 'Invalid repository path.' });
      return;
    }

    const encodedPath = filePath
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'NEXUS-AI-Lab',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    try {
      const ghRes = await fetch(url, { headers });
      const data = await ghRes.json().catch(() => ({}));
      if (!ghRes.ok) {
        res.status(ghRes.status).json({
          error:
            (data as { message?: string }).message ||
            'GitHub API request failed. Private repos require GITHUB_TOKEN in server environment.',
        });
        return;
      }

      if (Array.isArray(data)) {
        res.json({
          type: 'dir',
          entries: data.map((item: { name: string; path: string; type: string; size?: number }) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size ?? 0,
          })),
        });
        return;
      }

      const fileObj = data as { name: string; path: string; content?: string; encoding?: string };
      const content =
        fileObj.content && fileObj.encoding === 'base64'
          ? Buffer.from(fileObj.content, 'base64').toString('utf-8')
          : '';
      res.json({
        type: 'file',
        name: fileObj.name,
        path: fileObj.path,
        content,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to reach GitHub API.',
      });
    }
  });

  // --- Module 6: Automation Studio (User-isolated) ---
  app.get('/api/automation/workflows', requireAuth, (req, res) => {
    res.json({
      workflows: db.listWorkflows(req.authUser!.id),
      runs: db.listWorkflowRuns(req.authUser!.id),
    });
  });

  app.post('/api/automation/workflows', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const parsed = workflowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid workflow.' });
      return;
    }
    try {
      const workflow = db.createWorkflow(req.authUser!.id, parsed.data);
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'automation.create',
        resourceType: 'workflow',
        resourceId: workflow.id,
        details: `Created workflow "${workflow.name}"`,
      });
      res.status(201).json({ workflow });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workflow.' });
    }
  });

  app.patch('/api/automation/workflows/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'enabled boolean required.' });
      return;
    }
    const updated = db.toggleWorkflow(String(req.params.id), parsed.data.enabled);
    if (!updated) {
      res.status(404).json({ error: 'Workflow not found.' });
      return;
    }
    res.json({ workflow: updated });
  });

  app.post(
    '/api/automation/workflows/:id/trigger',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const workflow = db.getWorkflow(String(req.params.id));
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }
      const profile = db.getProfileForUser(req.authUser!.id)!;
      const run = await runAutomationWorkflow({
        workflow,
        triggerSource: 'manual',
        profile,
        bypassApproval: false,
      });
      res.status(201).json({ run });
    },
  );

  app.post(
    '/api/automation/runs/:runId/approve',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const existingRun = db.getWorkflowRun(String(req.params.runId));
      if (!existingRun || existingRun.status !== 'awaiting_approval') {
        res.status(404).json({ error: 'Pending approval run not found.' });
        return;
      }
      const workflow = db.getWorkflow(existingRun.workflowId);
      if (!workflow) {
        res.status(404).json({ error: 'Parent workflow no longer exists.' });
        return;
      }
      const profile = db.getProfileForUser(req.authUser!.id)!;
      const completedRun = await runAutomationWorkflow({
        workflow,
        triggerSource: existingRun.triggerSource,
        profile,
        bypassApproval: true,
        existingRunId: existingRun.id,
      });
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'automation.approve',
        resourceType: 'workflow_run',
        resourceId: existingRun.id,
        details: `Approved and executed "${workflow.name}"`,
      });
      res.json({ run: completedRun });
    },
  );

  app.post(
    '/api/automation/runs/:runId/reject',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const existingRun = db.getWorkflowRun(String(req.params.runId));
      if (!existingRun || existingRun.status !== 'awaiting_approval') {
        res.status(404).json({ error: 'Pending approval run not found.' });
        return;
      }
      const updated = db.saveWorkflowRun({
        ...existingRun,
        status: 'rejected',
        stepLogs: [...existingRun.stepLogs, `[${new Date().toISOString()}] Rejected by ${req.authUser!.email}.`],
        output: 'Execution rejected at security approval gate.',
        completedAt: new Date().toISOString(),
      });
      res.json({ run: updated });
    },
  );

  app.delete('/api/automation/workflows/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const deleted = db.deleteWorkflow(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Workflow not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Module 7: AI Media Studio (User-isolated) ---
  app.get('/api/media/projects', requireAuth, (req, res) => {
    res.json({ projects: db.listMediaProjects(req.authUser!.id) });
  });

  app.post(
    '/api/media/voice',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(2).max(80).default('Voice Session'),
        text: z.string().trim().min(2).max(2000),
        voiceName: z.enum(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']).default('Kore'),
        askAssistantFirst: z.boolean().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid voice payload.' });
        return;
      }

      const started = Date.now();
      try {
        let spokenText = parsed.data.text;
        if (parsed.data.askAssistantFirst) {
          spokenText = await generateText({
            model: 'gemini-4-hydrogen',
            thinkingLevel: 'LOW',
            systemInstruction:
              'You are NEXUS Voice Assistant. Respond clearly and conversationally in 2 to 4 concise sentences suitable for spoken audio.',
            prompt: parsed.data.text,
          });
        }
        const audio = await synthesizeSpeechWav({
          text: spokenText,
          voiceName: parsed.data.voiceName,
        });
        const project = db.saveMediaProject({
          userId: req.authUser!.id,
          title: parsed.data.title,
          kind: 'voice',
          prompt: parsed.data.text,
          resultText: spokenText,
          audioDataUrl: audio.audioDataUrl,
          mimeType: audio.mimeType,
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/media/voice',
          model: 'gemini-3.8-flash-lite-tts',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(spokenText.length / 4),
        });
        res.status(201).json({ project });
      } catch (err) {
        const formatted = formatGeminiError(err);
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'media.voice',
          message: formatted.message,
          statusCode: formatted.status,
        });
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.post(
    '/api/media/transcribe',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    upload.single('audio'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Please upload or record an audio clip.' });
        return;
      }
      const started = Date.now();
      try {
        const transcript = await transcribeAudioBase64({
          base64Data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype || 'audio/webm',
        });
        const project = db.saveMediaProject({
          userId: req.authUser!.id,
          title:
            typeof req.body.title === 'string' && req.body.title.trim()
              ? req.body.title.trim().slice(0, 80)
              : req.file.originalname || 'Audio Transcription',
          kind: 'transcription',
          prompt: `File: ${req.file.originalname} (${req.file.mimetype})`,
          resultText: transcript || '(No speech detected in audio clip.)',
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/media/transcribe',
          model: 'gemini-3.5-transcribe',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(transcript.length / 4),
        });
        res.status(201).json({ project });
      } catch (err) {
        const formatted = formatGeminiError(err);
        db.addErrorLog({
          userId: req.authUser!.id,
          source: 'media.transcribe',
          message: formatted.message,
          statusCode: formatted.status,
        });
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.post(
    '/api/media/svg',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(2).max(80).default('Vector Graphic'),
        prompt: z.string().trim().min(4).max(1000),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid SVG prompt.' });
        return;
      }

      const started = Date.now();
      try {
        const raw = await generateText({
          model: 'gemini-4-hydrogen',
          thinkingLevel: 'LOW',
          systemInstruction:
            'Generate a clean, valid standalone <svg viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">...</svg> illustration with dark navy/electric blue/violet vector geometry. Output ONLY valid SVG markup with no script tags, no foreignObject, and no external URLs.',
          prompt: parsed.data.prompt,
        });
        const svgMatch = /<svg[\s\S]*<\/svg>/i.exec(raw);
        if (!svgMatch) {
          throw new Error('Model did not return valid SVG markup.');
        }
        // Strip unsafe SVG elements
        const safeSvg = svgMatch[0]
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
          .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');

        const project = db.saveMediaProject({
          userId: req.authUser!.id,
          title: parsed.data.title,
          kind: 'svg_design',
          prompt: parsed.data.prompt,
          resultText: 'Vector SVG asset generated.',
          svgContent: safeSvg,
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/media/svg',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(safeSvg.length / 4),
        });
        res.status(201).json({ project });
      } catch (err) {
        const formatted = formatGeminiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.post(
    '/api/media/analyze-image',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    upload.single('image'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Please select an image to inspect.' });
        return;
      }
      const prompt =
        typeof req.body.prompt === 'string' && req.body.prompt.trim()
          ? req.body.prompt.trim().slice(0, 1000)
          : 'Analyze this image in detail: describe composition, subjects, text, and visual characteristics.';
      const started = Date.now();
      try {
        const analysis = await analyzeImageBase64({
          base64Data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype || 'image/png',
          prompt,
        });
        const project = db.saveMediaProject({
          userId: req.authUser!.id,
          title: req.file.originalname || 'Image Analysis',
          kind: 'image_analysis',
          prompt,
          resultText: analysis,
        });
        db.addApiUsageLog({
          userId: req.authUser!.id,
          endpoint: '/api/media/analyze-image',
          model: 'gemini-4-hydrogen',
          statusCode: 200,
          latencyMs: Date.now() - started,
          estimatedTokens: Math.ceil(analysis.length / 4) + 250,
        });
        res.status(201).json({ project });
      } catch (err) {
        const formatted = formatGeminiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  app.delete('/api/media/projects/:id', requireAuth, requireRole(['admin', 'developer']), (req, res) => {
    const deleted = db.deleteMediaProject(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Media project not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Module 9: AI Marketplace ---
  app.get('/api/marketplace', requireAuth, (_req, res) => {
    res.json(db.listMarketplaceListings());
  });

  app.post(
    '/api/marketplace/publish',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const schema = z.object({
        assistantId: z.string().trim().min(1),
        category: z.string().trim().min(2).max(40).optional(),
        userConsent: z.boolean().refine((v) => v === true, {
          message: 'Explicit user consent is required to publish an assistant configuration.',
        }),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid publish request.' });
        return;
      }
      const listing = db.publishAssistantToMarketplace(
        parsed.data.assistantId,
        req.authUser!,
        parsed.data.category,
      );
      if (!listing) {
        res.status(404).json({ error: 'Assistant not found.' });
        return;
      }
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'marketplace.publish',
        resourceType: 'marketplace_listing',
        resourceId: listing.id,
        details: `Published "${listing.name}" publicly`,
      });
      res.status(201).json({ listing });
    },
  );

  app.post(
    '/api/marketplace/:id/install',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      try {
        const installed = db.installMarketplaceListing(String(req.params.id), req.authUser!.id);
        if (!installed) {
          res.status(404).json({ error: 'Marketplace listing not found.' });
          return;
        }
        db.addAuditLog({
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'marketplace.install',
          resourceType: 'assistant',
          resourceId: installed.id,
          details: `Imported "${installed.name}" from marketplace`,
        });
        res.status(201).json({ assistant: installed });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Install failed.' });
      }
    },
  );

  app.post(
    '/api/marketplace/:id/reviews',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const parsed = marketplaceReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid review.' });
        return;
      }
      const review = db.addMarketplaceReview(
        String(req.params.id),
        req.authUser!,
        parsed.data.rating,
        parsed.data.comment,
      );
      if (!review) {
        res.status(404).json({ error: 'Marketplace listing not found.' });
        return;
      }
      res.status(201).json({ review });
    },
  );

  // --- Profile & Settings ---
  app.get('/api/profile', requireAuth, (req, res) => {
    res.json({ profile: db.getProfileForUser(req.authUser!.id) });
  });

  app.put('/api/profile', requireAuth, (req, res) => {
    const parsed = userProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid profile settings.',
        issues: parsed.error.issues,
      });
      return;
    }
    const profile = db.updateProfile(req.authUser!.id, parsed.data);
    res.json({ profile });
  });

  // --- Module 10: Administration (Admin role enforced) ---
  app.get('/api/admin/dashboard', requireAuth, requireRole(['admin']), (_req, res) => {
    res.json(db.getAdminDashboardData());
  });

  app.patch('/api/admin/users/:id', requireAuth, requireRole(['admin']), (req, res) => {
    const schema = z.object({
      role: z.enum(USER_ROLES).optional(),
      status: z.enum(['active', 'suspended']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid user role or status update.' });
      return;
    }
    const targetId = String(req.params.id);
    if (targetId === req.authUser!.id && parsed.data.status === 'suspended') {
      res.status(400).json({ error: 'You cannot suspend your own active admin account.' });
      return;
    }
    const updated = db.updateUserRoleAndStatus(targetId, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    db.addAuditLog({
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'admin.user_update',
      resourceType: 'user',
      resourceId: targetId,
      details: `Updated role=${updated.role}, status=${updated.status}`,
    });
    res.json({ user: updated });
  });

  app.get('/api/admin/backup', requireAuth, requireRole(['admin']), (req, res) => {
    db.addAuditLog({
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'admin.backup_export',
      resourceType: 'database',
      resourceId: 'nexus.db',
      details: 'Exported full workspace JSON backup',
    });
    res.json(db.exportBackup());
  });

  app.post('/api/admin/restore', requireAuth, requireRole(['admin']), (req, res) => {
    const schema = z.object({
      format: z.literal('nexus-backup-v2'),
      assistants: z.array(assistantInputSchema).max(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid backup payload. Expected nexus-backup-v2 JSON.' });
      return;
    }
    try {
      const restoredCount = db.restoreAssistantsFromBackup(
        req.authUser!.id,
        parsed.data.assistants,
      );
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'admin.backup_restore',
        resourceType: 'database',
        resourceId: 'nexus.db',
        details: `Restored ${restoredCount} assistant configuration(s) from backup`,
      });
      res.json({ restoredCount });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Restore failed.' });
    }
  });

  // ============================================================
  // NEXUS AI v3.0 — MODEL GATEWAY, MASTER INTELLIGENCE & SPECIALIST AGENTS
  // ============================================================

  app.get('/api/gateway/providers', requireAuth, (req, res) => {
    const providers = modelGateway.getProviderStatuses(req.authUser!.id);
    res.json({ providers });
  });

  app.put(
    '/api/gateway/providers/:provider',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const providerParam = String(req.params.provider) as AIProviderId;
      if (!AI_PROVIDERS.includes(providerParam)) {
        res.status(400).json({ error: `Unsupported AI provider: ${providerParam}` });
        return;
      }
      const parsed = providerSettingUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid provider configuration.',
        });
        return;
      }
      const updated = db.updateProviderSettingForUser(
        req.authUser!.id,
        providerParam,
        parsed.data,
      );
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'gateway.provider_update',
        resourceType: 'provider_setting',
        resourceId: updated.id,
        details: `Updated ${providerParam} (enabled=${updated.enabled}, model=${updated.defaultModel}, priority=${updated.priority})`,
      });
      const providers = modelGateway.getProviderStatuses(req.authUser!.id);
      res.json({ provider: providers.find((p) => p.provider === providerParam) ?? updated });
    },
  );

  app.post(
    '/api/gateway/test',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = gatewayExecuteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid gateway request.' });
        return;
      }
      const inj = inspectPromptInjection(
        `${parsed.data.prompt}\n${parsed.data.systemInstruction ?? ''}`,
      );
      if (inj.flagged) {
        res.status(400).json({ error: 'Input blocked by security policy.' });
        return;
      }
      try {
        const result = await modelGateway.generate({
          userId: req.authUser!.id,
          provider: parsed.data.provider,
          model: parsed.data.model,
          taskType: parsed.data.taskType,
          systemInstruction: parsed.data.systemInstruction,
          messages: [{ role: 'user', content: parsed.data.prompt }],
          allowFallback: parsed.data.allowFallback,
          timeoutMs: parsed.data.timeoutMs,
          sourceEndpoint: '/api/gateway/test',
        });
        res.json({ response: result });
      } catch (err) {
        const status = err instanceof GatewayProviderError ? err.statusCode : 502;
        const message = err instanceof Error ? err.message : 'Model Gateway test failed.';
        res.status(status).json({ error: message });
      }
    },
  );

  app.get('/api/gateway/analytics', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const metrics = db.getModelPerformanceMetricsForUser(userId);
    const records = db.listUsageRecordsForUser(userId, 60);
    const totals = {
      totalCalls: records.length,
      totalTokens: records.reduce((sum, r) => sum + r.totalTokens, 0),
      fallbackCalls: records.filter((r) => r.fallbackUsed).length,
      errorCalls: records.filter((r) => r.status === 'error').length,
      avgLatencyMs:
        records.length > 0
          ? Math.round(records.reduce((sum, r) => sum + r.latencyMs, 0) / records.length)
          : 0,
    };
    res.json({ metrics, records, totals });
  });

  // Specialist Agents (v3.0, user-isolated)
  app.get('/api/agents', requireAuth, (req, res) => {
    const agents = db.listSpecialistAgentsForUser(req.authUser!.id);
    const recentTasks = db.listAgentTasksForUser(req.authUser!.id, undefined, 40);
    res.json({ agents, recentTasks });
  });

  app.put(
    '/api/agents/:id',
    requireAuth,
    requireRole(['admin', 'developer']),
    (req, res) => {
      const parsed = specialistAgentUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid specialist agent configuration.',
        });
        return;
      }
      const updated = db.updateSpecialistAgentForUser(
        String(req.params.id),
        req.authUser!.id,
        parsed.data,
      );
      if (!updated) {
        res.status(404).json({ error: 'Specialist agent not found or access denied.' });
        return;
      }
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'agent.update',
        resourceType: 'specialist_agent',
        resourceId: updated.id,
        details: `Updated "${updated.name}" (model=${updated.preferredModel}, enabled=${updated.enabled})`,
      });
      res.json({ agent: updated });
    },
  );

  app.get('/api/agents/:id/tasks', requireAuth, (req, res) => {
    const agent = db.getSpecialistAgentForUser(String(req.params.id), req.authUser!.id);
    if (!agent) {
      res.status(404).json({ error: 'Specialist agent not found or access denied.' });
      return;
    }
    const tasks = db.listAgentTasksForUser(req.authUser!.id, agent.id, 40);
    res.json({ agent, tasks });
  });

  app.post(
    '/api/agents/:id/tasks',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const agent = db.getSpecialistAgentForUser(String(req.params.id), req.authUser!.id);
      if (!agent) {
        res.status(404).json({ error: 'Specialist agent not found or access denied.' });
        return;
      }
      const parsed = dispatchAgentTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid agent task.' });
        return;
      }
      const inj = inspectPromptInjection(parsed.data.inputPrompt);
      if (inj.flagged) {
        res.status(400).json({ error: 'Task prompt blocked by security policy.' });
        return;
      }

      try {
        const task = await masterIntelligence.dispatchSpecialistTask({
          userId: req.authUser!.id,
          agent,
          title: parsed.data.title,
          inputPrompt: parsed.data.inputPrompt,
          preferredProvider: parsed.data.preferredProvider,
          preferredModel: parsed.data.preferredModel,
          externalActionRequested: parsed.data.externalActionRequested,
          approvalGranted: parsed.data.approvalGranted,
        });
        res.status(task.status === 'awaiting_approval' ? 202 : 201).json({ task });
      } catch (err) {
        const status = err instanceof GatewayProviderError ? err.statusCode : 502;
        const message = err instanceof Error ? err.message : 'Agent execution failed.';
        res.status(status).json({ error: message });
      }
    },
  );

  // NEXUS Master Intelligence (v3.0, user-isolated)
  app.get('/api/master/runs', requireAuth, (req, res) => {
    res.json({ runs: db.listMasterRunsForUser(req.authUser!.id, 25) });
  });

  app.post(
    '/api/master/execute',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const parsed = masterExecuteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid master request.' });
        return;
      }
      const inj = inspectPromptInjection(parsed.data.request);
      if (inj.flagged) {
        res.status(400).json({ error: 'Master request blocked by security policy.' });
        return;
      }

      try {
        const run = await masterIntelligence.executeMasterRequest({
          userId: req.authUser!.id,
          request: parsed.data.request,
          preferredProvider: parsed.data.preferredProvider,
          preferredModel: parsed.data.preferredModel,
          agentIds: parsed.data.agentIds,
          documentIds: parsed.data.documentIds,
          externalActionRequested: parsed.data.externalActionRequested,
          approvalGranted: parsed.data.approvalGranted,
        });
        db.addAuditLog({
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'master.execute',
          resourceType: 'master_run',
          resourceId: run.id,
          details: `Master AI classified "${run.classification}" -> ${run.routing.selectedModel} (${run.status})`,
        });
        res.status(run.status === 'awaiting_approval' ? 202 : 201).json({ run });
      } catch (err) {
        const status = err instanceof GatewayProviderError ? err.statusCode : 502;
        const message = err instanceof Error ? err.message : 'Master Intelligence execution failed.';
        res.status(status).json({ error: message });
      }
    },
  );

  // --- NEVUS AI Google Ecosystem Integration & OAuth 2.0 Routes ---
  function getRequestOrigin(req: express.Request): string {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader)
      ? protoHeader[0]
      : protoHeader?.split(',')[0]?.trim() || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
  }

  app.get('/api/google/status', requireAuth, (req, res) => {
    res.json(getGoogleEcosystemStatus(req.authUser!.id, getRequestOrigin(req)));
  });

  app.post('/api/google/oauth/url', requireAuth, (req, res) => {
    const schema = z.object({
      serviceIds: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    const serviceIds = (parsed.success ? parsed.data.serviceIds : undefined) as
      | GoogleServiceId[]
      | undefined;
    const result = buildGoogleOAuthConsentUrl({
      userId: req.authUser!.id,
      serviceIds,
      requestOrigin: getRequestOrigin(req),
    });
    res.json(result);
  });

  app.get('/api/google/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';

    if (error) {
      res.redirect(`/?google_oauth_error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      res.redirect('/?google_oauth_error=missing_code_or_state');
      return;
    }

    try {
      const { userId, connection } = await exchangeGoogleOAuthCode({ code, state });
      db.addAuditLog({
        userId,
        userEmail: connection.googleEmail,
        action: 'google.oauth.connect',
        resourceType: 'google_connection',
        resourceId: userId,
        details: `Authorized Google OAuth for ${connection.connectedServices.length} service(s)`,
      });
      await flushCloudPersistence(db);
      res.redirect('/?google_connected=1');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google OAuth exchange failed';
      res.redirect(`/?google_oauth_error=${encodeURIComponent(msg)}`);
    }
  });

  app.post('/api/google/connect-token', requireAuth, async (req, res) => {
    const schema = z.object({
      accessToken: z.string().trim().min(10),
      grantedScopes: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid Google OAuth accessToken is required.' });
      return;
    }
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${parsed.data.accessToken}` },
      });
      if (!infoRes.ok) {
        res.status(401).json({ error: 'Google rejected the supplied access token.' });
        return;
      }
      const userInfo = (await infoRes.json().catch(() => ({}))) as { email?: string };
      const scopes = parsed.data.grantedScopes ?? ['openid', 'email', 'profile'];
      db.upsertGoogleConnection({
        userId: req.authUser!.id,
        googleEmail: userInfo.email || req.authUser!.email,
        grantedScopes: scopes,
        connectedServices: [],
        accessToken: parsed.data.accessToken,
        authSource: 'firebase_popup',
        expiresAt: new Date(Date.now() + 3500_000).toISOString(),
      });
      await flushCloudPersistence(db);
      res.json(getGoogleEcosystemStatus(req.authUser!.id, getRequestOrigin(req)));
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to verify Google access token.',
      });
    }
  });

  app.post('/api/google/disconnect', requireAuth, async (req, res) => {
    const removed = db.deleteGoogleConnection(req.authUser!.id);
    if (removed) {
      db.addAuditLog({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'google.oauth.disconnect',
        resourceType: 'google_connection',
        resourceId: req.authUser!.id,
        details: 'Disconnected Google Ecosystem OAuth tokens',
      });
      await flushCloudPersistence(db);
    }
    res.json({ ok: true, status: getGoogleEcosystemStatus(req.authUser!.id, getRequestOrigin(req)) });
  });

  app.post(
    '/api/google/execute',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({
        action: z.string().trim().min(2),
        input: z.record(z.string(), z.unknown()).default({}),
        confirmed: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid Google action request.' });
        return;
      }
      try {
        const result = await executeGoogleAction({
          userId: req.authUser!.id,
          action: parsed.data.action,
          input: parsed.data.input,
          confirmed: parsed.data.confirmed,
        });
        await flushCloudPersistence(db);
        res.json(result);
      } catch (err) {
        if (err instanceof GoogleIntegrationError) {
          res.status(err.statusCode).json({ error: err.message, code: err.code });
          return;
        }
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Google API execution failed.',
        });
      }
    },
  );

  app.post(
    '/api/google/command',
    requireAuth,
    requireRole(['admin', 'developer']),
    aiLimiter,
    async (req, res) => {
      const schema = z.object({
        command: z.string().trim().min(2).max(1500),
        confirmed: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Please enter a valid command for NEVUS AI.' });
        return;
      }
      const inj = inspectPromptInjection(parsed.data.command);
      if (inj.flagged) {
        res.status(400).json({ error: 'Command blocked by NEVUS security policy.' });
        return;
      }
      try {
        const result = await routeNaturalLanguageGoogleCommand({
          userId: req.authUser!.id,
          command: parsed.data.command,
          confirmed: parsed.data.confirmed,
        });
        await flushCloudPersistence(db);
        res.json(result);
      } catch (err) {
        if (err instanceof GoogleIntegrationError) {
          res.status(err.statusCode).json({ error: err.message, code: err.code });
          return;
        }
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Failed to route Google ecosystem command.',
        });
      }
    },
  );

  // --- Vercel Cron Automation Trigger ---
  app.get('/api/cron/automation', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) {
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${cronSecret}`) {
        res.status(401).json({ error: 'Unauthorized cron invocation.' });
        return;
      }
    }
    const workflows = db.listWorkflows();
    const nowMs = Date.now();
    let executed = 0;
    for (const wf of workflows) {
      if (!wf.enabled || wf.triggerType !== 'schedule') continue;
      const intervalMs = Math.max(1, wf.scheduleIntervalMinutes ?? 60) * 60_000;
      const lastMs = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
      if (nowMs - lastMs < intervalMs) continue;
      const ownerProfile = db.getProfileForUser(wf.userId);
      if (!ownerProfile) continue;
      await runAutomationWorkflow({
        workflow: wf,
        triggerSource: 'schedule',
        profile: ownerProfile,
        bypassApproval: false,
      });
      executed++;
    }
    await flushCloudPersistence(db);
    res.json({ ok: true, executed });
  });

  // API 404 & Error Handlers
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error.';
    res.status(500).json({ error: message });
  });

  return app;
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === 'production';
  const app = createApp();

  await ensureCloudHydrated(db);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  startAutomationScheduler();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEVUS AI v3.0 server running on http://0.0.0.0:${PORT}`);
  });
}

const currentFile = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile);
if (isDirectRun && process.env.VERCEL !== '1') {
  void startServer();
}
