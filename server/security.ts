import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../shared/schema.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

let sessionSecretIsPersistent = false;
let sessionSecretSource: 'env:NEXUS_SESSION_SECRET' | 'env:SESSION_SECRET' | 'local-file' | 'ephemeral' =
  'ephemeral';
let sessionSecretRawLength = 0;

function resolveSessionSecret(): string {
  const nexusSecret = normalizeEnvValue(process.env.NEXUS_SESSION_SECRET);
  const legacySecret = normalizeEnvValue(process.env.SESSION_SECRET);
  const envSecret = nexusSecret || legacySecret;
  if (envSecret && envSecret.length >= 16) {
    sessionSecretIsPersistent = true;
    sessionSecretSource = nexusSecret ? 'env:NEXUS_SESSION_SECRET' : 'env:SESSION_SECRET';
    sessionSecretRawLength = envSecret.length;
    if (envSecret.length < 32 && process.env.NODE_ENV !== 'test') {
      console.warn(
        '[NEVUS Security] Session secret is shorter than 32 characters. Recommend generating a 64-char hex secret.',
      );
    }
    return envSecret;
  }

  if (envSecret && envSecret.length > 0 && envSecret.length < 16) {
    console.warn(
      '[NEVUS Security] Configured NEXUS_SESSION_SECRET is shorter than 16 characters and cannot be used safely.',
    );
  }

  // On Vercel or read-only serverless filesystems, never write to process.cwd()/data
  if (process.env.VERCEL === '1') {
    sessionSecretIsPersistent = false;
    sessionSecretSource = 'ephemeral';
    sessionSecretRawLength = 0;
    console.warn(
      '[NEVUS Security] NEXUS_SESSION_SECRET is not configured. Using ephemeral per-instance session key; set NEXUS_SESSION_SECRET (32+ chars) in Vercel Environment Variables for persistent sessions.',
    );
    return crypto.randomBytes(32).toString('hex');
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (existing.length >= 32) {
        sessionSecretIsPersistent = true;
        sessionSecretSource = 'local-file';
        sessionSecretRawLength = existing.length;
        return existing;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    sessionSecretIsPersistent = true;
    sessionSecretSource = 'local-file';
    sessionSecretRawLength = generated.length;
    return generated;
  } catch {
    sessionSecretIsPersistent = false;
    sessionSecretSource = 'ephemeral';
    sessionSecretRawLength = 0;
    return crypto.randomBytes(32).toString('hex');
  }
}

const SESSION_SECRET = resolveSessionSecret();
const ENCRYPTION_KEY = crypto.createHash('sha256').update(SESSION_SECRET).digest();
export const SESSION_COOKIE_NAME = 'nexus_session';

export function hasPersistentSessionSecret(): boolean {
  return sessionSecretIsPersistent;
}

export function getSessionSecretDiagnostics(): {
  configured: boolean;
  source: string;
  meetsRecommendedLength: boolean;
} {
  return {
    configured: sessionSecretIsPersistent,
    source: sessionSecretSource,
    meetsRecommendedLength: sessionSecretRawLength >= 32,
  };
}

export function getAppUrlDiagnostics(requestOrigin?: string): {
  configured: boolean;
  valid: boolean;
  appUrl: string | null;
  isHttps: boolean;
  warning?: string;
} {
  const raw = normalizeEnvValue(process.env.APP_URL);
  if (raw && raw !== 'MY_APP_URL') {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      const normalized = `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`;
      return {
        configured: true,
        valid: true,
        appUrl: normalized,
        isHttps: parsed.protocol === 'https:',
      };
    } catch {
      return {
        configured: true,
        valid: false,
        appUrl: null,
        isHttps: false,
        warning: 'APP_URL is malformed; set a full https:// URL without quotes.',
      };
    }
  }

  const vercelProdUrl = normalizeEnvValue(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelProdUrl) {
    return {
      configured: false,
      valid: true,
      appUrl: `https://${vercelProdUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')}`,
      isHttps: true,
      warning: 'APP_URL is not explicitly set; falling back to VERCEL_PROJECT_PRODUCTION_URL.',
    };
  }

  const vercelUrl = normalizeEnvValue(process.env.VERCEL_URL);
  if (vercelUrl) {
    return {
      configured: false,
      valid: true,
      appUrl: `https://${vercelUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')}`,
      isHttps: true,
      warning: 'APP_URL is not explicitly set; falling back to VERCEL_URL.',
    };
  }

  if (requestOrigin) {
    const clean = requestOrigin.replace(/\/$/, '');
    return {
      configured: false,
      valid: true,
      appUrl: clean,
      isHttps: clean.startsWith('https://'),
    };
  }

  return {
    configured: false,
    valid: process.env.VERCEL !== '1',
    appUrl: 'http://localhost:3000',
    isHttps: false,
    warning:
      process.env.VERCEL === '1'
        ? 'APP_URL is not configured in Vercel Environment Variables.'
        : undefined,
  };
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  const parts = ciphertext.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const data = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash || hexHash.length % 2 !== 0) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface SessionPayload {
  userId: string;
  role: UserRole;
  exp: number;
}

export function signSessionToken(userId: string, role: UserRole, ttlSeconds = 60 * 60 * 24 * 7): string {
  const payload: SessionPayload = {
    userId,
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SessionPayload;
    if (!parsed.userId || !parsed.role || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface OAuthStatePayload {
  userId: string;
  redirectUri: string;
  nonce: string;
  exp: number;
}

export function signOAuthState(userId: string, redirectUri: string): string {
  const payload: OAuthStatePayload = {
    userId,
    redirectUri,
    nonce: crypto.randomBytes(12).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string | undefined): OAuthStatePayload | null {
  if (!state) return null;
  const dotIdx = state.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as OAuthStatePayload;
    if (!parsed.userId || !parsed.redirectUri || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

// Prompt Injection Detection & Neutralization
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|system)\s+(instructions?|prompts?)/i,
  /reveal\s+(your\s+)?(system\s+prompt|api\s+key|secret|environment\s+variables?)/i,
  /override\s+system\s+policy/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /<\s*\/?\s*system\s*>/i,
];

export function inspectPromptInjection(text: string): {
  flagged: boolean;
  matchedPattern?: string;
} {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        flagged: true,
        matchedPattern: pattern.source,
      };
    }
  }
  return { flagged: false };
}

export function wrapUntrustedContext(label: string, text: string): string {
  const sanitized = text.replace(/<\/?untrusted_context[^>]*>/gi, '[filtered-tag]');
  return `<untrusted_context source="${label.replace(/"/g, '')}">\n${sanitized}\n</untrusted_context>`;
}

// Sliding Window Rate Limiter
interface Bucket {
  timestamps: number[];
}

export function createRateLimiter(options: { windowMs: number; maxRequests: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.name}:${req.ip || 'local'}`;
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);

    if (bucket.timestamps.length >= options.maxRequests) {
      res.status(429).json({
        error: `Rate limit exceeded (${options.maxRequests} requests per ${Math.round(options.windowMs / 1000)}s). Please slow down.`,
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}

// Secret-safe structured server error logging
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GOOGLE_KEY]'],
  [/sk-[0-9A-Za-z\-_]{16,}/g, '[REDACTED_API_KEY]'],
  [/Bearer\s+[0-9A-Za-z\-_.=]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/eyJ[0-9A-Za-z\-_]+\.[0-9A-Za-z\-_]+\.[0-9A-Za-z\-_]+/g, '[REDACTED_JWT]'],
  [/(password|secret|service_role|token|api[_-]?key)\s*[:=]\s*["']?[^\s"',}]+/gi, '$1=[REDACTED]'],
];

export function redactSensitiveText(input: string): string {
  let output = input;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function sanitizeClientErrorMessage(err: unknown, fallback = 'Internal server error.'): string {
  if (!(err instanceof Error)) return fallback;
  const clean = redactSensitiveText(err.message).trim();
  if (!clean) return fallback;
  // Prevent exposing file paths or SQL internals in production 500 responses
  if (/\/var\/|\/tmp\/|\/app\/|C:\\|SELECT\s+|INSERT\s+INTO|UPDATE\s+\w+\s+SET|SqliteError/i.test(clean)) {
    return fallback;
  }
  return clean.slice(0, 240);
}

export function logServerError(
  context: string,
  err: unknown,
  meta?: { method?: string; path?: string; statusCode?: number; extra?: Record<string, unknown> },
): void {
  const errObj = err instanceof Error ? err : new Error(String(err));
  const payload = {
    level: 'error',
    timestamp: new Date().toISOString(),
    context,
    method: meta?.method,
    path: meta?.path,
    statusCode: meta?.statusCode,
    errorName: errObj.name,
    message: redactSensitiveText(errObj.message),
    stackTop: errObj.stack
      ? redactSensitiveText(errObj.stack.split('\n').slice(0, 4).join(' | '))
      : undefined,
    runtime: {
      nodeVersion: process.version,
      vercel: process.env.VERCEL === '1',
      hasSessionSecret: hasPersistentSessionSecret(),
      hasAppUrl: Boolean(normalizeEnvValue(process.env.APP_URL) && normalizeEnvValue(process.env.APP_URL) !== 'MY_APP_URL'),
      hasSupabaseUrl: Boolean(normalizeEnvValue(process.env.SUPABASE_URL)),
      hasSupabaseKey: Boolean(normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    },
    ...(meta?.extra ? { extra: meta.extra } : {}),
  };
  console.error('[NEVUS Server Error]', JSON.stringify(payload));
}
