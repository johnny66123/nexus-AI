import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../shared/schema.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

function resolveSessionSecret(): string {
  if (process.env.NEXUS_SESSION_SECRET && process.env.NEXUS_SESSION_SECRET.length >= 16) {
    return process.env.NEXUS_SESSION_SECRET;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (existing.length >= 32) return existing;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = resolveSessionSecret();
export const SESSION_COOKIE_NAME = 'nexus_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
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
