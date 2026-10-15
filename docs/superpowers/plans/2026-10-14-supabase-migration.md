# Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the portal from Firebase to Supabase for authentication, PostgreSQL persistence, private files, and online presence while retaining Vercel hosting and the Python Mae Oba assistant.

**Architecture:** The browser uses `supabase-js` for Supabase Auth and sends the access token to FastAPI. FastAPI validates the token, authorizes against a protected profile, and uses a server-only Supabase key for Postgres and Storage; exposed tables have RLS as defense in depth. Supabase Realtime replaces Firebase RTDB presence, and Resend handles transactional messages through a durable outbox.

**Tech Stack:** HTML/CSS/JavaScript, Vite, `@supabase/supabase-js`, FastAPI/Python 3.12, Supabase PostgreSQL/Auth/Storage/Realtime/Edge Functions, Resend, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-14-supabase-migration-design.md`

## Global Constraints

- Support no more than 70 expected portal users on the Supabase Free plan, monitoring database, file, bandwidth, and inactivity limits.
- Keep the Firebase project intact; do not deploy to or mutate it during Supabase testing.
- Keep `service_role`/secret keys and Resend credentials server-only; never put them in `VITE_*` variables or committed files.
- Use Google OAuth and email/password with Supabase Auth; do not trust user-editable `user_metadata` for authorization.
- Require a protected server profile for role and approval decisions; preserve at least one approved administrator.
- Enable RLS on every table exposed through the Supabase Data API and keep file buckets private.
- Keep the local preview working independently of Supabase.
- Keep Mae Oba in Python and keep Vercel as the hosting target.

## Review Focus

- A user tampers with metadata or API payload to self-promote: verify the server reads the protected profile and rejects it.
- A pending or blocked user reuses an otherwise valid JWT: verify every privileged or content API request rejects it based on current profile state.
- A member attempts to read another member's list progress or an import file: verify ownership checks and private storage prevent access.
- An admin edit changes/deletes the last approved admin: verify the operation is rejected transactionally.
- Auth callback, upload, or email worker is retried: verify session state, file registration, and message dispatch remain idempotent.

## File Map

- `supabase/config.toml`, `supabase/migrations/*`: local Supabase configuration and versioned schema/RLS/functions.
- `src/lib/auth.js`, `src/app.js`, `src/lib/api.js`: browser Auth session, OAuth callback, public runtime config, and bearer token flow.
- `backend/auth.py`, `backend/supabase_store.py`, `backend/app.py`: JWT verification, Postgres/Storage adapter, and API wiring; `backend/store.py` keeps SQLite preview and Firebase legacy code isolated.
- `backend/service.py`, `backend/models.py`: business logic and data validation; retain existing API contract where possible.
- `supabase/functions/send-outbox/index.ts`: authenticated durable email outbox dispatcher using Resend.
- `supabase/functions/maintenance/index.ts`: scheduled import expiration and outbox retry recovery.
- `tests/backend/*`, `tests/frontend/*`, `supabase/tests/*`: behavior, security, and integration coverage.
- `.env.example`, `.gitignore`, `README.md`, `docs/reports/*`: safe configuration names and setup/deploy procedures.
- `package.json`, `package-lock.json`, Python requirements: pinned Supabase SDK dependencies.

---

### Task 1: Supabase schema, RLS, and seed foundation

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/<timestamp>_portal_schema.sql`
- Create: `tests/backend/test_supabase_schema_contract.py`
- Modify: `package.json`, `package-lock.json` only if required for local Supabase test tooling.

**Interfaces:**
- Produces tables for `profiles`, `announcements`, `events`, `lists`, `list_progress`, `orixas`, `members`, `site_settings`, `mail_campaigns`, `mail_delivery_jobs`, and `uploads`.
- `profiles.id` references `auth.users.id`; content identifiers use UUIDs; announcement Delta and list item snapshots use validated JSONB; progress is keyed by `user_id` and `list_id`.
- Profiles store email, name, photo path, protected role/status, preferences JSONB, and timestamps. Shared content tables preserve the fields validated by `backend/models.py`.
- Admin authorization reads a protected `profiles.role` and `profiles.status`, never `raw_user_meta_data`.

- [ ] **Step 1: Write failing schema contract tests** asserting required tables/columns, constraints, private buckets, RLS enabled, self-role updates denied, own progress isolated, and only approved admins can change shared content.
- [ ] **Step 2: Run the schema contract tests** and confirm they fail because the Supabase schema/migrations do not exist.
- [ ] **Step 3: Initialize the Supabase CLI project and generate a migration** using the installed CLI's `supabase init` and `supabase migration new portal_schema` commands after checking their `--help` output.
- [ ] **Step 4: Implement the schema and policies** with explicit constraints, indexes, RLS policies, private storage buckets, least-privilege grants, and an audited admin bootstrap mechanism.
- [ ] **Step 5: Run local Supabase migrations and tests** with a development-only project, then run Supabase security advisors; expected: all schema tests pass and no unrestricted RLS finding remains.

### Task 2: Supabase browser configuration and authentication

**Files:**
- Modify: `src/lib/auth.js`
- Modify: `src/app.js`
- Modify: `src/lib/api.js`
- Modify: `backend/app.py` (`/api/config` only)
- Create: `tests/frontend/auth-supabase.test.js`
- Modify: `requirements.txt`
- Modify: `.env.example`, `.gitignore`, `README.md`

**Interfaces:**
- `createAuth(config)` exposes the existing methods consumed by the app: `currentUser()`, `getToken()`, `subscribe(callback)`, `loginGoogle()`, `loginEmail(email,password)`, `register(email,password,name)`, `resetPassword(email)`, `changePassword(oldPassword,newPassword)`, and `logout()`.
- `/api/config` exposes only `mode`, `supabase.url`, and `supabase.publishableKey`.
- Project URL is known: `https://xjnkfealkybuwebfiihf.supabase.co`; publishable key remains to be configured.

- [ ] **Step 1: Write failing frontend tests** for config parsing, Google OAuth redirect initiation, callback session restoration, auth state subscription, and disabled login while public config is incomplete.
- [ ] **Step 2: Run the auth tests** and confirm they fail against the Firebase-only adapter.
- [ ] **Step 3: Install and pin `@supabase/supabase-js`** and update the lockfile.
- [ ] **Step 4: Replace the Firebase browser adapter with Supabase Auth** preserving the existing method contract and friendly Portuguese errors; set OAuth redirect targets for local and Vercel origins without embedding secrets.
- [ ] **Step 5: Update app/API config flow and safe env docs** so the browser receives only URL and publishable key; retain preview login when Supabase is absent.
- [ ] **Step 6: Run frontend tests and `npm run build`**; expected: all pass with no Firebase browser SDK in the production bundle.

### Task 3: Supabase JWT verification and protected profile lifecycle

**Files:**
- Modify: `backend/auth.py`
- Modify: `backend/app.py`
- Modify: `backend/models.py`
- Create: `tests/backend/test_supabase_auth.py`
- Create: `scripts/bootstrap_supabase_admin.py`

**Interfaces:**
- `authenticate(store, mode, authorization) -> uid` validates Supabase bearer JWT signature/issuer/audience and rejects expiry, wrong project, or missing subject.
- `GET /api/session` keeps the existing response shape while creating a pending profile for first-time Auth users.
- Admin bootstrap accepts a verified Supabase Auth UUID and project reference as explicit arguments; it refuses to replace an existing approved admin.
- JWT verification uses Supabase's asymmetric JWKS with a bounded cache; tests inject the JWKS response and clock.

- [ ] **Step 1: Write failing tests** for valid/expired/wrong-issuer JWTs, first-login pending profile creation, blocked/pending rejection, admin-only role updates, self-promotion rejection, and preserving the last admin.
- [ ] **Step 2: Run the tests** and confirm the current Firebase-token path cannot satisfy them.
- [ ] **Step 3: Add a pinned Python Supabase client dependency** and implement Supabase JWKS/JWT verification without network calls inside unit tests (inject verifier/JWKS provider).
- [ ] **Step 4: Implement profile sync and admin bootstrap** with server-side protected role/status fields and transactional last-admin checks.
- [ ] **Step 5: Run backend unit tests** and expected existing preview/auth tests remain green.

### Task 4: Postgres persistence adapter and portal API

**Files:**
- Create: `backend/supabase_store.py`
- Modify: `backend/app.py`
- Modify: `requirements.txt`
- Create: `tests/backend/test_supabase_store.py`
- Modify: `tests/backend/test_api.py`

**Interfaces:**
- `SupabaseStore` implements the existing store boundary: `atomic(operation)`, `read_collection(collection)`, `read_bytes(path)`, `image_url(path, uid)`, and `register_object(path, uid, kind, content_type)`.
- `SupabaseTransaction` implements `get(collection,key)`, `all(collection)`, `put(collection,key,value)`, and `flush()` with the same transaction semantics as `FirebaseTransaction`.
- PostgreSQL connections use the Supabase transaction pooler through `SUPABASE_DB_URL`; Storage uses a server-only Supabase secret key. Pin `psycopg[binary]` and `supabase` Python dependencies.
- Keep API routes and JSON shapes stable for announcements, events, lists, progress, Orixás, members, users, profile, site settings, and archive operations.
- Database writes run inside Postgres transactions; user-facing API inputs remain validated by `backend/models.py`.

- [ ] **Step 1: Write failing adapter/API tests** for persistent CRUD, announcement publication, list progress versioning/completion, profile preferences, archive behavior, and atomic last-admin protection.
- [ ] **Step 2: Run focused tests** and confirm `FirebaseStore` is currently the only cloud implementation.
- [ ] **Step 3: Implement `SupabaseStore`** using parameterized psycopg operations through Supabase's transaction pooler and stable mappings between normalized SQL rows and current service document shapes.
- [ ] **Step 4: Wire production configuration** to initialize SupabaseStore from server-only env while keeping `SQLiteStore` limited to explicit preview mode and failing closed when required vars are absent.
- [ ] **Step 5: Run all backend API tests**; expected output preserves status codes, validation, authorization, and response compatibility.

### Task 5: Private uploads, signed assets, and import expiration

**Files:**
- Modify: `src/lib/auth.js`
- Modify: `backend/store.py`
- Modify: `backend/app.py`
- Modify: `supabase/migrations/*` for Storage policies if needed
- Create: `tests/backend/test_supabase_storage.py`

**Interfaces:**
- `auth.upload(file, kind='image') -> {path, filename}` retains the present 5 MB image and 10 MB import bounds and accepted MIME/extensions.
- `/api/assets/{path}` returns only time-limited access for authorized images; imports remain inaccessible except through authenticated preview processing.
- Import records expire after 24 hours, with cleanup that can resume safely.

- [ ] **Step 1: Write failing tests** for accepted/rejected MIME and size, owner/admin authorization, private object retrieval, expired signatures, and cleanup retry idempotency.
- [ ] **Step 2: Run storage tests** and confirm they fail for Supabase storage paths.
- [ ] **Step 3: Replace Firebase upload paths with Supabase Storage** and implement server-side signed access and object ownership checks.
- [ ] **Step 4: Implement `supabase/functions/maintenance/index.ts`** to prune expired import objects and recover incomplete outbox jobs; protect it with a server-only shared secret and configure its schedule with Supabase Cron (`pg_cron`/`pg_net`) after verifying current supported setup.
- [ ] **Step 5: Run storage tests and local emulator/integration checks**; expected private imports cannot be downloaded directly and expired objects are rejected.

### Task 6: Realtime presence

**Files:**
- Modify: `src/lib/auth.js`
- Modify: `src/features/users.js`
- Modify: `backend/service.py` only if presence is exposed through an API snapshot
- Create: `tests/frontend/presence-supabase.test.js`
- Create: `tests/backend/test_presence_access.py` if server-mediated

**Interfaces:**
- `auth.startPresence(user)` tracks only approved sessions and exposes current online state to administrator user listing.
- `auth.stopPresence()` removes only the current browser connection; reconnects replace stale presence state.

- [ ] **Step 1: Write failing tests** for pending/blocked users not publishing presence, multiple tabs, reconnect, logout cleanup, and admin-only online member visibility.
- [ ] **Step 2: Run presence tests** and confirm the Firebase RTDB adapter is required by the current implementation.
- [ ] **Step 3: Implement presence using Supabase Realtime Presence** with a channel scoped to the house and authorization tied to the approved JWT/profile state.
- [ ] **Step 4: Run focused presence tests** and validate concurrent tabs do not clear one another's state.

### Task 7: Transactional email and durable outbox

**Files:**
- Create: `supabase/functions/send-outbox/index.ts`
- Create: `supabase/functions/send-outbox/deno.json`
- Create: `supabase/functions/send-outbox/index_test.ts`
- Modify: `supabase/migrations/*` for campaign/outbox schema
- Modify: `tests/backend/test_api.py` for durable campaign creation

**Interfaces:**
- Publishing a communication creates one durable campaign and deterministic per-recipient jobs for approved users with notifications enabled.
- Worker dispatch is idempotent, sends one recipient per request, respects provider rate limits, and records provider acceptance separately from inbox delivery.
- Password recovery jobs do not expose reset links to the browser or other users.

- [ ] **Step 1: Write failing tests** for eligible recipient snapshot, duplicate campaign trigger, retry/idempotency, blocked user removal before dispatch, provider failure, and private password-reset outbox.
- [ ] **Step 2: Run email tests** and confirm they depend on Firebase Functions/Firestore/Cloud Tasks.
- [ ] **Step 3: Implement `send-outbox`** to claim a bounded batch of durable jobs, call Resend once per recipient with deterministic idempotency keys, and persist provider acceptance/final failure without exposing reset links.
- [ ] **Step 4: Configure the scheduled recovery invocation** for `send-outbox` and configure authenticated Supabase SMTP for Auth mail; document the Google OAuth consent/callback setup.
- [ ] **Step 5: Run Deno function tests with a mocked provider and real Supabase staging schema**; expected retries never create duplicate deliveries.

### Task 8: Cutover documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/reports/firebase.md` (mark Firebase integration retained/legacy; do not delete project)
- Modify: `docs/implementation-progress.md`
- Modify: `.env.example`, `vercel.json`, `api/index.py` if Python deployment requirements change
- Create: `tests/e2e/supabase-cutover.md`

**Interfaces:**
- Production env uses `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, and `RESEND_API_KEY` names documented by `.env.example`; values are not committed.
- Vercel deploy remains static Vite output plus authenticated Python API and never enables preview mode.

- [ ] **Step 1: Add end-to-end checks** for Google login, approval, admin CRUD, member read/progress, upload authorization, presence, password reset, and communication email acceptance.
- [ ] **Step 2: Deploy schema to the user's existing Supabase project** only after project URL and local staging tests are correct; apply migrations in a reviewable order and create the first admin via verified UID.
- [ ] **Step 3: Configure Vercel env vars** through secure dashboard/CLI secret entry, authorize the deployment domain in Supabase Auth, and deploy a preview URL before production.
- [ ] **Step 4: Run `npm test`, `npm run build`, backend tests, Supabase advisors, and end-to-end checks**; expected all required flows pass and no Firebase production request occurs.
- [ ] **Step 5: Update progress docs** with actual deployment results, remaining external steps, and tested Supabase Free usage baseline.

