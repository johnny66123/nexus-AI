# NEVUS AI — Vercel Deployment & Configuration Guide

NEVUS AI is configured for production deployment on **Vercel** using:
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Vite static CDN output (`dist/`)
- **Backend**: Express serverless entry at `api/index.ts` routed via `vercel.json` (`/api/(.*)` -> `/api/index`)
- **Cloud Persistence**: Supabase PostgreSQL (`supabase/schema.sql`) or Firebase Admin Firestore (`FIREBASE_SERVICE_ACCOUNT_JSON`) with cold-start snapshot hydration and write-through persistence
- **Automation Cron**: Vercel Cron job hitting `/api/cron/automation` daily (`0 9 * * *`), secured with `CRON_SECRET`

---

## 1. Database Setup (Choose Supabase OR Firebase Admin)

### Option A: Supabase (Recommended for Vercel)
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in Supabase and run the entire schema file `/supabase/schema.sql`.
3. Copy your **Project URL** (`SUPABASE_URL`) and **Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`) from **Project Settings -> API**.
4. Add both to Vercel Environment Variables (never expose `SUPABASE_SERVICE_ROLE_KEY` to the client).

### Option B: Firebase Admin Firestore
1. Generate a Service Account JSON key in Firebase Console -> **Project Settings -> Service Accounts**.
2. Minify the JSON onto a single line and store it in `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel Environment Variables.

---

## 2. Google OAuth 2.0 Setup (Google Ecosystem Integrations)

To enable Gmail, Google Drive, Docs, Sheets, Slides, Calendar, Contacts, Tasks, Photos, YouTube OAuth, and Google Cloud APIs:
1. Open [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services -> Library** and enable:
   - Gmail API, Google Drive API, Google Docs API, Google Sheets API, Google Slides API
   - Google Calendar API, People API (Contacts), Tasks API, Google Photos Library API
   - YouTube Data API v3, Cloud Resource Manager API, Places API (New), Routes API, Cloud Translation API
2. Configure **OAuth consent screen** (External/Internal) and add your test/production scopes.
3. Go to **Credentials -> Create Credentials -> OAuth client ID -> Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `https://<your-vercel-domain>.vercel.app`
5. Under **Authorized redirect URIs**, add:
   - `https://<your-vercel-domain>.vercel.app/api/google/oauth/callback`
6. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI` in Vercel Environment Variables.

---

## 3. Required Vercel Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Powers Gemini models, Web Search grounding, TTS Voice, Transcription |
| `NEXUS_SESSION_SECRET` | Yes (min 32 chars) | Signs session cookies/tokens, OAuth CSRF `state`, and AES-256-GCM token encryption |
| `APP_URL` | Yes | Production URL (`https://<your-project>.vercel.app`) |
| `SUPABASE_URL` | Recommended | Supabase project URL for persistent cloud storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Supabase service role key (server-side only) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Optional alt DB | Service account JSON if using Firestore instead of Supabase |
| `GOOGLE_CLIENT_ID` | For Google OAuth | OAuth 2.0 client ID for Gmail/Drive/Calendar/Docs/Sheets/Slides |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | OAuth 2.0 client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | For Google OAuth | `https://<your-project>.vercel.app/api/google/oauth/callback` |
| `GOOGLE_MAPS_API_KEY` | For Maps | Places API (New) & Routes API |
| `GOOGLE_TRANSLATE_API_KEY` | Optional | Dedicated Cloud Translation v2 (falls back to Gemini when unset) |
| `YOUTUBE_API_KEY` | Optional | Public YouTube Data v3 search without OAuth |
| `ANTHROPIC_API_KEY` | Optional | Enables Claude models in Multi-Model Gateway |
| `OPENAI_API_KEY` | Optional | Enables OpenAI models in Multi-Model Gateway |
| `GITHUB_TOKEN` | Optional | Authenticated GitHub browsing in Dev Lab |
| `CRON_SECRET` | Recommended | Secures `/api/cron/automation` Vercel Cron endpoint |

---

## 4. Deploy to Vercel

1. Push the repository to GitHub/GitLab/Bitbucket.
2. In Vercel Dashboard, click **Add New -> Project** and import the repository.
3. Framework Preset is automatically detected via `vercel.json` (**Build Command**: `npm run build`, **Output Directory**: `dist`).
4. Add the Environment Variables listed above (Production, Preview, Development).
5. Click **Deploy**.
6. Verify `/api/health` returns `ok: true`, `databaseBackend: "supabase"` (or `"firestore"`), `sessionSecretConfigured: true`, and `googleOAuthConfigured: true`.
