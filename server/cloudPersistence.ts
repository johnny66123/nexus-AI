import type { AuthUser } from '../shared/schema.ts';
import type { NexusDatabaseService, WorkspaceCloudSnapshot } from './db.ts';
import { getAdminDbInstance, hasFirebaseServiceAccount } from './firestore.ts';
import { logServerError, redactSensitiveText } from './security.ts';

export type CloudDatabaseBackend = 'supabase' | 'firestore' | 'sqlite-local' | 'sqlite-ephemeral';

export interface SupabaseDiagnostics {
  configured: boolean;
  validUrl: boolean;
  connected: boolean;
  tables: {
    nevus_workspace_snapshots: boolean;
    nevus_users: boolean;
  };
  error?: string;
  checkedAt?: string;
}

const SNAPSHOT_ROW_ID = 'nevus_primary_workspace';

let hydrationPromise: Promise<void> | null = null;
let hydratedOnce = false;
let lastHydrationError: string | null = null;
let lastFlushedJson = '';
let cachedSupabaseDiag: { expiresAt: number; value: SupabaseDiagnostics } | null = null;

function cleanEnv(raw: string | undefined): string {
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

function getSupabaseCredentials(): { url: string; key: string } | null {
  const url = cleanEnv(process.env.SUPABASE_URL).replace(/\/$/, '');
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  if (!url.startsWith('https://')) return null;
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseCredentials());
}

export function getLastCloudHydrationError(): string | null {
  return lastHydrationError;
}

export function getActiveDatabaseBackend(db: NexusDatabaseService): CloudDatabaseBackend {
  if (isSupabaseConfigured()) return 'supabase';
  if (hasFirebaseServiceAccount()) return 'firestore';
  return db.storageMode === 'ephemeral-sqlite' ? 'sqlite-ephemeral' : 'sqlite-local';
}

async function checkSupabaseTable(
  creds: { url: string; key: string },
  tableName: string,
): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    const res = await fetch(`${creds.url}/rest/v1/${tableName}?select=*&limit=0`, {
      method: 'GET',
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    const bodyText = redactSensitiveText((await res.text().catch(() => '')).slice(0, 200));
    return { ok: false, status: res.status, detail: bodyText };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? redactSensitiveText(err.message) : 'Network failure',
    };
  }
}

export async function verifySupabaseConnectivity(forceRefresh = false): Promise<SupabaseDiagnostics> {
  const rawUrl = cleanEnv(process.env.SUPABASE_URL);
  const rawKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !rawKey) {
    return {
      configured: false,
      validUrl: false,
      connected: false,
      tables: {
        nevus_workspace_snapshots: false,
        nevus_users: false,
      },
    };
  }

  if (!rawUrl.startsWith('https://')) {
    return {
      configured: true,
      validUrl: false,
      connected: false,
      tables: {
        nevus_workspace_snapshots: false,
        nevus_users: false,
      },
      error: 'SUPABASE_URL must start with https://',
      checkedAt: new Date().toISOString(),
    };
  }

  if (!forceRefresh && cachedSupabaseDiag && Date.now() < cachedSupabaseDiag.expiresAt) {
    return cachedSupabaseDiag.value;
  }

  const creds = { url: rawUrl.replace(/\/$/, ''), key: rawKey };
  const [snapshotsCheck, usersCheck] = await Promise.all([
    checkSupabaseTable(creds, 'nevus_workspace_snapshots'),
    checkSupabaseTable(creds, 'nevus_users'),
  ]);

  const connected = snapshotsCheck.ok || usersCheck.ok;
  let error: string | undefined;
  if (!snapshotsCheck.ok || !usersCheck.ok) {
    const failed: string[] = [];
    if (!snapshotsCheck.ok) {
      failed.push(
        `nevus_workspace_snapshots (HTTP ${snapshotsCheck.status || 'ERR'})`,
      );
    }
    if (!usersCheck.ok) {
      failed.push(`nevus_users (HTTP ${usersCheck.status || 'ERR'})`);
    }
    if (snapshotsCheck.status === 401 || snapshotsCheck.status === 403 || usersCheck.status === 401 || usersCheck.status === 403) {
      error = 'Supabase rejected credentials (HTTP 401/403). Verify SUPABASE_SERVICE_ROLE_KEY in Vercel.';
    } else if (snapshotsCheck.status === 404 || usersCheck.status === 404) {
      error = `Missing required Supabase table(s): ${failed.join(', ')}. Run supabase/schema.sql in Supabase SQL Editor.`;
    } else {
      error = `Supabase check failed for ${failed.join(', ')}${snapshotsCheck.detail ? `: ${snapshotsCheck.detail}` : ''}`;
    }
  }

  const result: SupabaseDiagnostics = {
    configured: true,
    validUrl: true,
    connected,
    tables: {
      nevus_workspace_snapshots: snapshotsCheck.ok,
      nevus_users: usersCheck.ok,
    },
    ...(error ? { error } : {}),
    checkedAt: new Date().toISOString(),
  };

  cachedSupabaseDiag = {
    expiresAt: Date.now() + 30_000,
    value: result,
  };
  return result;
}

async function fetchSnapshotFromSupabase(): Promise<WorkspaceCloudSnapshot | null> {
  const creds = getSupabaseCredentials();
  if (!creds) return null;
  const res = await fetch(
    `${creds.url}/rest/v1/nevus_workspace_snapshots?id=eq.${encodeURIComponent(SNAPSHOT_ROW_ID)}&select=payload&limit=1`,
    {
      method: 'GET',
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    const errText = redactSensitiveText((await res.text().catch(() => '')).slice(0, 200));
    throw new Error(`Supabase snapshot read returned HTTP ${res.status}${errText ? `: ${errText}` : ''}`);
  }
  const rows = (await res.json()) as Array<{ payload?: WorkspaceCloudSnapshot }>;
  return rows[0]?.payload ?? null;
}

async function saveSnapshotToSupabase(snapshot: WorkspaceCloudSnapshot): Promise<void> {
  const creds = getSupabaseCredentials();
  if (!creds) return;
  const res = await fetch(`${creds.url}/rest/v1/nevus_workspace_snapshots?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        id: SNAPSHOT_ROW_ID,
        payload: snapshot,
        schema_version: snapshot.schemaVersion,
        updated_at: new Date().toISOString(),
      },
    ]),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const errText = redactSensitiveText((await res.text().catch(() => '')).slice(0, 240));
    throw new Error(`Supabase snapshot upsert returned HTTP ${res.status}: ${errText}`);
  }
}

export async function syncUserToSupabase(user: AuthUser): Promise<{ synced: boolean; error?: string }> {
  if (process.env.NODE_ENV === 'test' || process.env.NEXUS_DB_PATH?.includes('nexus-test-')) {
    return { synced: false };
  }
  const creds = getSupabaseCredentials();
  if (!creds) return { synced: false };

  try {
    const res = await fetch(`${creds.url}/rest/v1/nevus_users?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        {
          id: user.id,
          email: user.email,
          display_name: user.displayName,
          role_title: user.roleTitle,
          role: user.role,
          status: user.status,
          default_provider: user.defaultProvider,
          default_model: user.defaultModel,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
        },
      ]),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const detail = redactSensitiveText((await res.text().catch(() => '')).slice(0, 200));
      const msg = `Supabase nevus_users upsert returned HTTP ${res.status}: ${detail}`;
      logServerError('supabase.sync_user', new Error(msg), {
        extra: { userId: user.id, status: res.status },
      });
      return { synced: false, error: msg };
    }
    return { synced: true };
  } catch (err) {
    const msg = err instanceof Error ? redactSensitiveText(err.message) : String(err);
    logServerError('supabase.sync_user', err, { extra: { userId: user.id } });
    return { synced: false, error: msg };
  }
}

async function fetchSnapshotFromFirestore(): Promise<WorkspaceCloudSnapshot | null> {
  const fsDb = getAdminDbInstance();
  const snap = await fsDb.doc(`nevus_system/${SNAPSHOT_ROW_ID}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { payloadJson?: string } | undefined;
  if (!data?.payloadJson) return null;
  return JSON.parse(data.payloadJson) as WorkspaceCloudSnapshot;
}

async function saveSnapshotToFirestore(snapshot: WorkspaceCloudSnapshot): Promise<void> {
  const fsDb = getAdminDbInstance();
  await fsDb.doc(`nevus_system/${SNAPSHOT_ROW_ID}`).set(
    {
      schemaVersion: snapshot.schemaVersion,
      updatedAt: new Date().toISOString(),
      payloadJson: JSON.stringify(snapshot),
    },
    { merge: true },
  );
}

export async function ensureCloudHydrated(db: NexusDatabaseService): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.NEXUS_DB_PATH?.includes('nexus-test-')) {
    return;
  }
  if (!isSupabaseConfigured() && !hasFirebaseServiceAccount()) {
    return;
  }
  if (hydratedOnce) return;
  if (hydrationPromise) {
    await hydrationPromise;
    return;
  }

  hydrationPromise = (async () => {
    try {
      const snapshot = isSupabaseConfigured()
        ? await fetchSnapshotFromSupabase()
        : await fetchSnapshotFromFirestore();
      if (snapshot && snapshot.tables && Object.keys(snapshot.tables).length > 0) {
        db.importCloudSnapshot(snapshot);
        lastFlushedJson = JSON.stringify(snapshot.tables);
      } else {
        // Seed initial state to cloud store on first run
        const initial = db.exportCloudSnapshot();
        if (isSupabaseConfigured()) {
          await saveSnapshotToSupabase(initial);
          for (const u of db.listUsers()) {
            await syncUserToSupabase(u);
          }
        } else if (hasFirebaseServiceAccount()) {
          await saveSnapshotToFirestore(initial);
        }
        lastFlushedJson = JSON.stringify(initial.tables);
      }
      lastHydrationError = null;
      hydratedOnce = true;
    } catch (err) {
      lastHydrationError = err instanceof Error ? redactSensitiveText(err.message) : String(err);
      logServerError('cloud.hydration', err, {
        extra: { backend: isSupabaseConfigured() ? 'supabase' : 'firestore' },
      });
    } finally {
      hydrationPromise = null;
    }
  })();

  await hydrationPromise;
}

export async function flushCloudPersistence(
  db: NexusDatabaseService,
  options: { throwOnError?: boolean } = {},
): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' || process.env.NEXUS_DB_PATH?.includes('nexus-test-')) {
    return false;
  }
  if (!isSupabaseConfigured() && !hasFirebaseServiceAccount()) {
    return false;
  }
  try {
    const snapshot = db.exportCloudSnapshot();
    const serialized = JSON.stringify(snapshot.tables);
    if (serialized === lastFlushedJson) return true;

    if (isSupabaseConfigured()) {
      await saveSnapshotToSupabase(snapshot);
    } else if (hasFirebaseServiceAccount()) {
      await saveSnapshotToFirestore(snapshot);
    }
    lastFlushedJson = serialized;
    return true;
  } catch (err) {
    logServerError('cloud.flush', err, {
      extra: { backend: isSupabaseConfigured() ? 'supabase' : 'firestore' },
    });
    if (options.throwOnError) {
      throw err;
    }
    return false;
  }
}
