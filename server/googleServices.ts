import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { db } from './db.ts';
import type { GoogleConnectionRecord } from './db.ts';
import { runGroundedResearch } from './gemini.ts';
import { getAppUrlDiagnostics, signOAuthState, verifyOAuthState } from './security.ts';

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

export interface GoogleServiceDefinition {
  id: GoogleServiceId;
  name: string;
  category: 'Productivity' | 'Intelligence & Search' | 'Location & Media' | 'Cloud & Platform';
  authType: 'oauth2' | 'gemini_key' | 'api_key_or_gemini' | 'api_key';
  requiredScopes: string[];
  requiredEnvVars: string[];
  description: string;
  supportedActions: string[];
}

export const GOOGLE_ECOSYSTEM_CATALOG: GoogleServiceDefinition[] = [
  {
    id: 'search',
    name: 'Google Search',
    category: 'Intelligence & Search',
    authType: 'gemini_key',
    requiredScopes: [],
    requiredEnvVars: ['GEMINI_API_KEY'],
    description: 'Live web search & citation grounding powered by Google Search.',
    supportedActions: ['search_web'],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Read, search, draft, and send emails with confirmation protection.',
    supportedActions: ['gmail_list', 'gmail_send'],
  },
  {
    id: 'drive',
    name: 'Google Drive',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Search, list, organize, and manage files and folders in Google Drive.',
    supportedActions: ['drive_list', 'drive_create_folder', 'drive_delete'],
  },
  {
    id: 'docs',
    name: 'Google Docs',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/documents'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Create and inspect Google Docs documents.',
    supportedActions: ['docs_create'],
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Create spreadsheets, read cell ranges, and analyze tabular data.',
    supportedActions: ['sheets_create', 'sheets_read'],
  },
  {
    id: 'slides',
    name: 'Google Slides',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Create presentations and slide decks in Google Slides.',
    supportedActions: ['slides_create'],
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/calendar.events'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Read upcoming meetings, prepare briefings, and schedule events.',
    supportedActions: ['calendar_list', 'calendar_create_event'],
  },
  {
    id: 'maps',
    name: 'Google Maps',
    category: 'Location & Media',
    authType: 'api_key',
    requiredScopes: [],
    requiredEnvVars: ['GOOGLE_MAPS_API_KEY'],
    description: 'Places API (New) search and Routes API directions.',
    supportedActions: ['maps_places', 'maps_directions'],
  },
  {
    id: 'contacts',
    name: 'Google Contacts',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/contacts'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Search and create contacts via Google People API.',
    supportedActions: ['contacts_list', 'contacts_create'],
  },
  {
    id: 'tasks',
    name: 'Google Tasks',
    category: 'Productivity',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/tasks'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'List task lists and create tasks with confirmation.',
    supportedActions: ['tasks_list', 'tasks_create'],
  },
  {
    id: 'photos',
    name: 'Google Photos',
    category: 'Location & Media',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'List authorized Google Photos albums and media metadata.',
    supportedActions: ['photos_albums'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'Location & Media',
    authType: 'api_key_or_gemini',
    requiredScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    requiredEnvVars: ['YOUTUBE_API_KEY'],
    description: 'Search YouTube videos and retrieve authorized channel info.',
    supportedActions: ['youtube_search'],
  },
  {
    id: 'translate',
    name: 'Google Translate',
    category: 'Intelligence & Search',
    authType: 'api_key_or_gemini',
    requiredScopes: [],
    requiredEnvVars: ['GOOGLE_TRANSLATE_API_KEY'],
    description: 'Translate text across languages via Cloud Translation API or Gemini.',
    supportedActions: ['translate_text'],
  },
  {
    id: 'cloud',
    name: 'Google Cloud',
    category: 'Cloud & Platform',
    authType: 'oauth2',
    requiredScopes: ['https://www.googleapis.com/auth/cloud-platform.read-only'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description: 'Inspect accessible Google Cloud projects via Resource Manager API.',
    supportedActions: ['cloud_projects'],
  },
];

export const MUTATING_GOOGLE_ACTIONS = new Set([
  'gmail_send',
  'drive_create_folder',
  'drive_delete',
  'docs_create',
  'sheets_create',
  'slides_create',
  'calendar_create_event',
  'contacts_create',
  'tasks_create',
]);

export interface GoogleServiceStatusItem extends GoogleServiceDefinition {
  status: 'connected' | 'needs_oauth' | 'needs_api_key';
  detail: string;
}

export function isGoogleOAuthClientConfigured(): boolean {
  const cid = process.env.GOOGLE_CLIENT_ID?.trim();
  const csec = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(cid && csec);
}

export function resolveGoogleOAuthRedirectUri(requestOrigin?: string): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI.trim();
  }
  const appDiag = getAppUrlDiagnostics(requestOrigin);
  if (appDiag.appUrl) {
    return `${appDiag.appUrl}/api/google/oauth/callback`;
  }
  return 'http://localhost:3000/api/google/oauth/callback';
}

export function buildGoogleOAuthConsentUrl(params: {
  userId: string;
  serviceIds?: GoogleServiceId[];
  requestOrigin?: string;
}): { configured: boolean; authUrl: string | null; redirectUri: string; scopes: string[]; message?: string } {
  const redirectUri = resolveGoogleOAuthRedirectUri(params.requestOrigin);
  const selectedIds =
    params.serviceIds && params.serviceIds.length > 0
      ? params.serviceIds
      : GOOGLE_ECOSYSTEM_CATALOG.filter((s) => s.authType === 'oauth2').map((s) => s.id);

  const scopes = Array.from(
    new Set([
      'openid',
      'email',
      'profile',
      ...selectedIds.flatMap(
        (id) => GOOGLE_ECOSYSTEM_CATALOG.find((s) => s.id === id)?.requiredScopes ?? [],
      ),
    ]),
  );

  if (!isGoogleOAuthClientConfigured()) {
    return {
      configured: false,
      authUrl: null,
      redirectUri,
      scopes,
      message:
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured yet. Add them in Vercel Environment Variables and register the Redirect URI above in Google Cloud Console.',
    };
  }

  const state = signOAuthState(params.userId, redirectUri);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  return {
    configured: true,
    authUrl: url.toString(),
    redirectUri,
    scopes,
  };
}

export async function exchangeGoogleOAuthCode(params: {
  code: string;
  state: string;
}): Promise<{ userId: string; connection: GoogleConnectionRecord }> {
  const parsedState = verifyOAuthState(params.state);
  if (!parsedState) {
    throw new Error('Invalid or expired OAuth state parameter.');
  }
  if (!isGoogleOAuthClientConfigured()) {
    throw new Error('Google OAuth client credentials are not configured on the server.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: parsedState.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description || tokenJson.error || `Google OAuth token exchange failed (${tokenRes.status}).`,
    );
  }

  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const userInfo = (await userInfoRes.json().catch(() => ({}))) as { email?: string };
  const grantedScopes = (tokenJson.scope || '').split(/\s+/).filter(Boolean);
  const connectedServices = GOOGLE_ECOSYSTEM_CATALOG.filter(
    (s) =>
      s.requiredScopes.length > 0 &&
      s.requiredScopes.some((scope) => grantedScopes.includes(scope)),
  ).map((s) => s.id);

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  const connection = db.upsertGoogleConnection({
    userId: parsedState.userId,
    googleEmail: userInfo.email || 'connected@google.com',
    grantedScopes,
    connectedServices,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt,
    authSource: 'oauth2',
  });

  return { userId: parsedState.userId, connection };
}

export async function getValidGoogleAccessToken(userId: string): Promise<string | null> {
  const conn = db.getGoogleConnectionForUser(userId);
  if (!conn) return null;

  const expMs = conn.expiresAt ? new Date(conn.expiresAt).getTime() : null;
  const isExpiredOrSoon = expMs !== null && Date.now() > expMs - 60_000;
  if (!isExpiredOrSoon) {
    return conn.accessToken;
  }

  if (conn.refreshToken && isGoogleOAuthClientConfigured()) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        refresh_token: conn.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const refreshJson = (await refreshRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (refreshRes.ok && refreshJson.access_token) {
      const updated = db.upsertGoogleConnection({
        userId,
        googleEmail: conn.googleEmail,
        grantedScopes: conn.grantedScopes,
        connectedServices: conn.connectedServices,
        accessToken: refreshJson.access_token,
        expiresAt: refreshJson.expires_in
          ? new Date(Date.now() + refreshJson.expires_in * 1000).toISOString()
          : null,
      });
      return updated.accessToken;
    }
  }

  return null;
}

export function getGoogleEcosystemStatus(userId: string, requestOrigin?: string) {
  const conn = db.getGoogleConnectionForUser(userId);
  const geminiReady = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
  );
  const mapsReady = Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
  const translateApiReady = Boolean(process.env.GOOGLE_TRANSLATE_API_KEY?.trim());
  const youtubeApiReady = Boolean(process.env.YOUTUBE_API_KEY?.trim());
  const granted = new Set(conn?.grantedScopes ?? []);
  const tokenExpired =
    Boolean(conn?.expiresAt) &&
    Date.now() > new Date(conn!.expiresAt!).getTime() &&
    !(conn?.refreshToken && isGoogleOAuthClientConfigured());

  const services: GoogleServiceStatusItem[] = GOOGLE_ECOSYSTEM_CATALOG.map((svc) => {
    if (svc.id === 'search') {
      return {
        ...svc,
        status: geminiReady ? 'connected' : 'needs_api_key',
        detail: geminiReady
          ? 'Active via Gemini Google Search Grounding.'
          : 'Requires GEMINI_API_KEY in server environment variables.',
      };
    }
    if (svc.id === 'maps') {
      return {
        ...svc,
        status: mapsReady ? 'connected' : 'needs_api_key',
        detail: mapsReady
          ? 'Active via Google Maps Platform server proxy.'
          : 'Add GOOGLE_MAPS_API_KEY (Places API New & Routes API) in Vercel Environment Variables.',
      };
    }
    if (svc.id === 'translate') {
      if (translateApiReady) {
        return { ...svc, status: 'connected', detail: 'Active via Google Cloud Translation API.' };
      }
      if (geminiReady) {
        return {
          ...svc,
          status: 'connected',
          detail: 'Active via Gemini multilingual translation (set GOOGLE_TRANSLATE_API_KEY for dedicated Cloud Translation v2).',
        };
      }
      return {
        ...svc,
        status: 'needs_api_key',
        detail: 'Requires GOOGLE_TRANSLATE_API_KEY or GEMINI_API_KEY.',
      };
    }
    if (svc.id === 'youtube') {
      const hasOAuth = conn && !tokenExpired && svc.requiredScopes.some((s) => granted.has(s));
      if (youtubeApiReady || hasOAuth) {
        return {
          ...svc,
          status: 'connected',
          detail: hasOAuth ? 'Connected via OAuth 2.0.' : 'Active via YOUTUBE_API_KEY.',
        };
      }
      return {
        ...svc,
        status: 'needs_api_key',
        detail: 'Requires YOUTUBE_API_KEY or Google OAuth YouTube authorization.',
      };
    }

    const hasScope =
      Boolean(conn) &&
      !tokenExpired &&
      svc.requiredScopes.some((scope) => granted.has(scope));

    if (hasScope) {
      return {
        ...svc,
        status: 'connected',
        detail: `Authorized (${conn!.googleEmail}).`,
      };
    }
    if (tokenExpired) {
      return {
        ...svc,
        status: 'needs_oauth',
        detail: 'OAuth token expired — reconnect Google Account to refresh permissions.',
      };
    }
    return {
      ...svc,
      status: 'needs_oauth',
      detail: isGoogleOAuthClientConfigured()
        ? 'Not authorized yet — connect Google Account and grant scope.'
        : 'Configure GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET, then authorize.',
    };
  });

  return {
    oauthConfigured: isGoogleOAuthClientConfigured(),
    redirectUri: resolveGoogleOAuthRedirectUri(requestOrigin),
    connection: conn
      ? {
          connected: !tokenExpired,
          googleEmail: conn.googleEmail,
          grantedScopes: conn.grantedScopes,
          connectedServices: conn.connectedServices,
          expiresAt: conn.expiresAt,
          hasRefreshToken: Boolean(conn.refreshToken),
          authSource: conn.authSource,
          updatedAt: conn.updatedAt,
        }
      : null,
    services,
  };
}

export class GoogleIntegrationError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 412, code = 'GOOGLE_NOT_CONNECTED') {
    super(message);
    this.name = 'GoogleIntegrationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function requireTokenForScope(userId: string, requiredScopes: string[]): Promise<string> {
  const conn = db.getGoogleConnectionForUser(userId);
  if (!conn) {
    throw new GoogleIntegrationError(
      'Google Account is not connected yet. Open Google Ecosystem to authorize your account.',
      412,
      'GOOGLE_OAUTH_REQUIRED',
    );
  }
  const hasScope = requiredScopes.some((s) => conn.grantedScopes.includes(s));
  if (!hasScope) {
    throw new GoogleIntegrationError(
      `Missing Google permission scope (${requiredScopes.join(' or ')}). Reconnect and authorize the required service.`,
      403,
      'GOOGLE_SCOPE_MISSING',
    );
  }
  const token = await getValidGoogleAccessToken(userId);
  if (!token) {
    throw new GoogleIntegrationError(
      'Your Google OAuth access token has expired. Please reconnect your Google Account.',
      401,
      'GOOGLE_TOKEN_EXPIRED',
    );
  }
  return token;
}

export async function executeGoogleAction(params: {
  userId: string;
  action: string;
  input: Record<string, unknown>;
  confirmed?: boolean;
}): Promise<{
  requiresConfirmation?: boolean;
  confirmationSummary?: string;
  serviceId: GoogleServiceId;
  action: string;
  data?: unknown;
}> {
  const { userId, action, input, confirmed } = params;

  if (MUTATING_GOOGLE_ACTIONS.has(action) && !confirmed) {
    return {
      requiresConfirmation: true,
      confirmationSummary: `Confirm executing "${action}" on your authorized Google account with parameters: ${JSON.stringify(input).slice(0, 260)}`,
      serviceId: (action.split('_')[0] as GoogleServiceId) || 'drive',
      action,
    };
  }

  // 1. Google Search (Gemini Grounding)
  if (action === 'search_web') {
    const query = String(input.query ?? '').trim();
    if (!query) throw new GoogleIntegrationError('Search query is required.', 400, 'INVALID_INPUT');
    const result = await runGroundedResearch({ query, mode: 'web_search' });
    return { serviceId: 'search', action, data: result };
  }

  // 2. Google Translate
  if (action === 'translate_text') {
    const text = String(input.text ?? '').trim();
    const target = String(input.targetLanguage ?? 'es').trim();
    if (!text) throw new GoogleIntegrationError('Text to translate is required.', 400, 'INVALID_INPUT');

    const translateKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
    if (translateKey) {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(translateKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, target, format: 'text' }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: { translations?: Array<{ translatedText?: string; detectedSourceLanguage?: string }> };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new GoogleIntegrationError(
          json.error?.message || `Google Translate API error (${res.status}).`,
          res.status,
          'GOOGLE_API_ERROR',
        );
      }
      return {
        serviceId: 'translate',
        action,
        data: {
          provider: 'cloud_translation_v2',
          translatedText: json.data?.translations?.[0]?.translatedText ?? '',
          detectedSourceLanguage: json.data?.translations?.[0]?.detectedSourceLanguage ?? 'auto',
          targetLanguage: target,
        },
      };
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
      throw new GoogleIntegrationError(
        'Configure GOOGLE_TRANSLATE_API_KEY or GEMINI_API_KEY to use Google Translate.',
        412,
        'GOOGLE_KEY_MISSING',
      );
    }
    const ai = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const resp = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Translate the following text into language "${target}". Return ONLY the translated text without commentary.\n\n${text}`,
    });
    return {
      serviceId: 'translate',
      action,
      data: {
        provider: 'gemini_translation',
        translatedText: (resp.text ?? '').trim(),
        targetLanguage: target,
      },
    };
  }

  // 3. Google Maps (Places API New & Routes API)
  if (action === 'maps_places' || action === 'maps_directions') {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!mapsKey) {
      throw new GoogleIntegrationError(
        'GOOGLE_MAPS_API_KEY is not configured in server environment variables.',
        412,
        'GOOGLE_MAPS_KEY_MISSING',
      );
    }
    if (action === 'maps_places') {
      const textQuery = String(input.query ?? '').trim();
      if (!textQuery) throw new GoogleIntegrationError('Place query is required.', 400, 'INVALID_INPUT');
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.location',
        },
        body: JSON.stringify({ textQuery, maxResultCount: 5 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new GoogleIntegrationError(
          (json as { error?: { message?: string } }).error?.message || `Places API error (${res.status})`,
          res.status,
          'GOOGLE_API_ERROR',
        );
      }
      return { serviceId: 'maps', action, data: json };
    }

    const origin = String(input.origin ?? '').trim();
    const destination = String(input.destination ?? '').trim();
    if (!origin || !destination) {
      throw new GoogleIntegrationError('Both origin and destination are required.', 400, 'INVALID_INPUT');
    }
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.description,routes.legs.steps.navigationInstruction',
      },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: 'DRIVE',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `Routes API error (${res.status})`,
        res.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'maps', action, data: json };
  }

  // 4. YouTube Search
  if (action === 'youtube_search') {
    const q = String(input.query ?? '').trim();
    if (!q) throw new GoogleIntegrationError('YouTube search query is required.', 400, 'INVALID_INPUT');
    const ytKey = process.env.YOUTUBE_API_KEY?.trim();
    const headers: Record<string, string> = {};
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(q)}`;
    if (ytKey) {
      url += `&key=${encodeURIComponent(ytKey)}`;
    } else {
      const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/youtube.readonly']);
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `YouTube API error (${res.status})`,
        res.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'youtube', action, data: json };
  }

  // 5. Gmail
  if (action === 'gmail_list') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
    const q = String(input.query ?? '').trim();
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listJson = (await listRes.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };
    if (!listRes.ok) {
      throw new GoogleIntegrationError(listJson.error?.message || `Gmail error (${listRes.status})`, listRes.status, 'GOOGLE_API_ERROR');
    }
    const details = await Promise.all(
      (listJson.messages ?? []).slice(0, 5).map(async (m) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        return msgRes.json().catch(() => ({ id: m.id }));
      }),
    );
    return { serviceId: 'gmail', action, data: { messages: details } };
  }

  if (action === 'gmail_send') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    const to = String(input.to ?? '').trim();
    const subject = String(input.subject ?? '').trim();
    const body = String(input.body ?? '').trim();
    if (!to || !subject || !body) {
      throw new GoogleIntegrationError('Recipient (to), subject, and body are required.', 400, 'INVALID_INPUT');
    }
    const rawMime = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
    const raw = Buffer.from(rawMime, 'utf8').toString('base64url');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    const json = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `Gmail send failed (${sendRes.status})`,
        sendRes.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'gmail', action, data: json };
  }

  // 6. Google Drive
  if (action === 'drive_list') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
    ]);
    const q = String(input.query ?? '').trim();
    const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
    driveUrl.searchParams.set('pageSize', '12');
    driveUrl.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)');
    if (q) {
      driveUrl.searchParams.set('q', `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`);
    } else {
      driveUrl.searchParams.set('q', 'trashed = false');
    }
    const res = await fetch(driveUrl, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `Drive error (${res.status})`,
        res.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'drive', action, data: json };
  }

  // 7. Google Calendar
  if (action === 'calendar_list') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar',
    ]);
    const calUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    calUrl.searchParams.set('timeMin', new Date().toISOString());
    calUrl.searchParams.set('maxResults', '10');
    calUrl.searchParams.set('singleEvents', 'true');
    calUrl.searchParams.set('orderBy', 'startTime');
    const res = await fetch(calUrl, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `Calendar error (${res.status})`,
        res.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'calendar', action, data: json };
  }

  if (action === 'calendar_create_event') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar',
    ]);
    const summary = String(input.summary ?? 'NEVUS Scheduled Meeting').trim();
    const startIso = String(input.startIso ?? new Date(Date.now() + 86400_000).toISOString());
    const endIso = String(
      input.endIso ?? new Date(new Date(startIso).getTime() + 3600_000).toISOString(),
    );
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        description: String(input.description ?? ''),
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError(
        (json as { error?: { message?: string } }).error?.message || `Calendar create failed (${res.status})`,
        res.status,
        'GOOGLE_API_ERROR',
      );
    }
    return { serviceId: 'calendar', action, data: json };
  }

  // 8. Google Docs / Sheets / Slides creation
  if (action === 'docs_create') {
    const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/documents']);
    const title = String(input.title ?? 'NEVUS Document').trim();
    const res = await fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Docs error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'docs', action, data: json };
  }

  if (action === 'sheets_create') {
    const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/spreadsheets']);
    const title = String(input.title ?? 'NEVUS Spreadsheet').trim();
    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Sheets error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'sheets', action, data: json };
  }

  if (action === 'slides_create') {
    const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/presentations']);
    const title = String(input.title ?? 'NEVUS Presentation').trim();
    const res = await fetch('https://slides.googleapis.com/v1/presentations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Slides error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'slides', action, data: json };
  }

  // 9. Contacts / Tasks / Photos / Cloud
  if (action === 'contacts_list') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts',
    ]);
    const res = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=15',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Contacts error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'contacts', action, data: json };
  }

  if (action === 'tasks_list' || action === 'tasks_create') {
    const token = await requireTokenForScope(userId, [
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/tasks.readonly',
    ]);
    if (action === 'tasks_list') {
      const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=15', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Tasks error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
      }
      return { serviceId: 'tasks', action, data: json };
    }
    const title = String(input.title ?? 'NEVUS Action Item').trim();
    const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, notes: String(input.notes ?? '') }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Tasks create error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'tasks', action, data: json };
  }

  if (action === 'photos_albums') {
    const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/photoslibrary.readonly']);
    const res = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=12', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Photos error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'photos', action, data: json };
  }

  if (action === 'cloud_projects') {
    const token = await requireTokenForScope(userId, ['https://www.googleapis.com/auth/cloud-platform.read-only']);
    const res = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleIntegrationError((json as { error?: { message?: string } }).error?.message || `Cloud API error (${res.status})`, res.status, 'GOOGLE_API_ERROR');
    }
    return { serviceId: 'cloud', action, data: json };
  }

  throw new GoogleIntegrationError(`Unsupported Google action: ${action}`, 400, 'UNSUPPORTED_ACTION');
}

export async function routeNaturalLanguageGoogleCommand(params: {
  userId: string;
  command: string;
  confirmed?: boolean;
}) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
    throw new GoogleIntegrationError(
      'GEMINI_API_KEY is required for NEVUS natural-language command routing.',
      503,
      'GEMINI_KEY_MISSING',
    );
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  const routingResp = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Classify this user command into a concrete Google ecosystem action.
Available actions:
- search_web (input: { query })
- translate_text (input: { text, targetLanguage })
- maps_places (input: { query })
- maps_directions (input: { origin, destination })
- youtube_search (input: { query })
- gmail_list (input: { query })
- gmail_send (input: { to, subject, body })
- drive_list (input: { query })
- docs_create (input: { title })
- sheets_create (input: { title })
- slides_create (input: { title })
- calendar_list (input: {})
- calendar_create_event (input: { summary, description })
- contacts_list (input: {})
- tasks_list (input: {})
- tasks_create (input: { title, notes })
- photos_albums (input: {})
- cloud_projects (input: {})
- meeting_briefing_pipeline (multi-step Calendar + Gmail + Drive prep, input: { query })

User Command: "${params.command}"`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          query: { type: Type.STRING },
          title: { type: Type.STRING },
          text: { type: Type.STRING },
          targetLanguage: { type: Type.STRING },
          origin: { type: Type.STRING },
          destination: { type: Type.STRING },
          to: { type: Type.STRING },
          subject: { type: Type.STRING },
          body: { type: Type.STRING },
          summary: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse(routingResp.text ?? '{}') as Record<string, string>;
  const action = parsed.action || 'search_web';

  if (action === 'meeting_briefing_pipeline') {
    const calendarRes = await executeGoogleAction({ userId: params.userId, action: 'calendar_list', input: {} });
    const gmailRes = await executeGoogleAction({
      userId: params.userId,
      action: 'gmail_list',
      input: { query: parsed.query || 'meeting' },
    });
    const driveRes = await executeGoogleAction({
      userId: params.userId,
      action: 'drive_list',
      input: { query: parsed.query || '' },
    });
    return {
      action,
      serviceId: 'calendar' as GoogleServiceId,
      data: {
        calendar: calendarRes.data,
        gmail: gmailRes.data,
        drive: driveRes.data,
      },
    };
  }

  return executeGoogleAction({
    userId: params.userId,
    action,
    input: {
      ...parsed,
      query: parsed.query || params.command,
    },
    confirmed: params.confirmed,
  });
}
