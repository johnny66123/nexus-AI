import type { NexusDatabaseService, WorkspaceCloudSnapshot } from './db.ts';
import { getAdminDbInstance, hasFirebaseServiceAccount } from './firestore.ts';

export type CloudDatabaseBackend = 'supabase' | 'firestore' | 'sqlite-local' | 'sqlite-ephemeral';

const SNAPSHOT_ROW_ID = 'nevus_primary_workspace';

let hydrationPromise: Promise<void> | null = null;
let hydratedOnce = false;
let lastFlushedJson = '';

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key && url.startsWith('https://'));
}

export function getActiveDatabaseBackend(db: NexusDatabaseService): CloudDatabaseBackend {
  if (isSupabaseConfigured()) return 'supabase';
  if (hasFirebaseServiceAccount()) return 'firestore';
  return db.storageMode === 'ephemeral-sqlite' ? 'sqlite-ephemeral' : 'sqlite-local';
}

async function fetchSnapshotFromSupabase(): Promise<WorkspaceCloudSnapshot | null> {
  const url = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(
    `${url}/rest/v1/nevus_workspace_snapshots?id=eq.${encodeURIComponent(SNAPSHOT_ROW_ID)}&select=payload&limit=1`,
    {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Supabase snapshot read returned HTTP ${res.status}`);
  }
  const rows = (await res.json()) as Array<{ payload?: WorkspaceCloudSnapshot }>;
  return rows[0]?.payload ?? null;
}

async function saveSnapshotToSupabase(snapshot: WorkspaceCloudSnapshot): Promise<void> {
  const url = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${url}/rest/v1/nevus_workspace_snapshots?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase snapshot upsert returned HTTP ${res.status}: ${errText}`);
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
        } else if (hasFirebaseServiceAccount()) {
          await saveSnapshotToFirestore(initial);
        }
        lastFlushedJson = JSON.stringify(initial.tables);
      }
      hydratedOnce = true;
    } catch (err) {
      console.warn(
        '[NEVUS Cloud Persistence] Hydration warning:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      hydrationPromise = null;
    }
  })();

  await hydrationPromise;
}

export async function flushCloudPersistence(db: NexusDatabaseService): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.NEXUS_DB_PATH?.includes('nexus-test-')) {
    return;
  }
  if (!isSupabaseConfigured() && !hasFirebaseServiceAccount()) {
    return;
  }
  try {
    const snapshot = db.exportCloudSnapshot();
    const serialized = JSON.stringify(snapshot.tables);
    if (serialized === lastFlushedJson) return;

    if (isSupabaseConfigured()) {
      await saveSnapshotToSupabase(snapshot);
    } else if (hasFirebaseServiceAccount()) {
      await saveSnapshotToFirestore(snapshot);
    }
    lastFlushedJson = serialized;
  } catch (err) {
    console.warn(
      '[NEVUS Cloud Persistence] Sync warning:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
