# CoopManage Rwanda — Environments, Deployment and Backup

Status: **Phase 18 complete.** Written in Phase 0 as the target; executed in Phase 18. Every step
below marked **executed** was run for real on the reference machine, with the production image and
a production-shaped environment, and is run again by CI on every push. What needs an account that
does not exist yet — the Supabase project, the Railway and Vercel services — is marked **at first
deployment**, with exactly what to do and what to check.

---

## 1. Environments

|          | Development                              | Production                                       |
| -------- | ---------------------------------------- | ------------------------------------------------ |
| Frontend | Vite dev server, `http://localhost:5175` | Vercel static build, `apps/frontend/vercel.json` |
| Backend  | `tsx watch`, `http://localhost:4000`     | Railway, from `apps/backend/Dockerfile`          |
| Database | Docker `postgres:16`, host port **5435** | Supabase PostgreSQL                              |
| Storage  | Local `./storage` directory              | Supabase Storage, private bucket, S3 driver      |
| E-mail   | Console driver, message in the log       | SMTP, `MAIL_DRIVER=smtp` (§7)                    |
| SMS      | Mock provider, logs to the database      | Mock until a gateway account exists (§7)         |
| Backups  | —                                        | Railway cron service, `railway.backup.json`      |

Host port 5435 avoids the PostgreSQL ports already occupied on this machine by other projects
(5432, 5433, 5434), and web port 5175 avoids their Vite servers on 5173 and 5174. Vite runs with
`strictPort`, so a clash fails loudly instead of silently moving to another port.

**One site, not two.** The browser application and the API are served from the same origin:
`vercel.json` rewrites `/api/*` to the Railway service, so the browser only ever talks to the
Vercel host. That is what makes the refresh cookie's `SameSite=Lax` work, keeps the content
security policy at `connect-src 'self'`, and means CORS never has to name a second origin. The
Phase 15 review found that a default Vercel domain beside a default Railway domain silently breaks
sign-in; the rewrite is the fix that needs no custom domain.

## 2. Environment variables

Validated by Zod at boot; the process exits with every problem listed rather than starting in a
broken state. `apps/backend/.env.example` is the authority on each variable's meaning and default.

**Before pasting anything into a hosting dashboard, run the same validation offline:**

```
npm run check:env -- path/to/production.env
```

It runs the boot check with `NODE_ENV=production`, prints every problem at once, echoes no value,
and warns about what the boot check cannot see: placeholders copied from `.env.example`, secrets
shorter than a generated one, `SEED_DEMO` or `ENABLE_API_DOCS` switched on. **Executed** against a
deliberately bad file: it named all three refusals and four warnings.

### Backend, production

| Variable                                                                                                               | Value                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                                                                             | `production`. Refuses placeholder secrets, loopback origins, local storage, demo seed.                                                                                               |
| `PORT`                                                                                                                 | Railway sets it; the schema reads it.                                                                                                                                                |
| `DATABASE_URL`                                                                                                         | Supabase **pooled** connection (transaction mode, port 6543), for the running server.                                                                                                |
| `DIRECT_URL`                                                                                                           | Supabase **direct** connection (port 5432), for `prisma migrate deploy` and `db:backup`.                                                                                             |
| `JWT_ACCESS_SECRET`                                                                                                    | `openssl rand -base64 48`. Never reused between environments.                                                                                                                        |
| `CORS_ORIGINS`                                                                                                         | The Vercel origin, `https://app.example.rw`. Same-origin requests carry no `Origin`; this is for the cookie endpoints' check.                                                        |
| `APP_BASE_URL`                                                                                                         | The same Vercel origin. Password-reset links are built against it.                                                                                                                   |
| `COOKIE_SAMESITE`                                                                                                      | `lax` (default). `none` only for a deliberate cross-site deployment, and only over HTTPS.                                                                                            |
| `STORAGE_DRIVER`                                                                                                       | `s3`. Production refuses `local`.                                                                                                                                                    |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                    | Supabase → Project settings → Storage → S3 connection. The bucket is **private**; the application signs every request and never hands out a URL.                                     |
| `MAIL_DRIVER`, `SMTP_URL`, `SMTP_FROM`                                                                                 | `smtp`, `smtps://user:pass@host:465`, `CoopManage <no-reply@example.rw>`. The server authenticates at startup. Without it no new account can be activated (§7).                      |
| `SMS_PROVIDER`                                                                                                         | `mock` until a gateway account exists (§7).                                                                                                                                          |
| `ASSISTANT_PLANNER`                                                                                                    | `rules`.                                                                                                                                                                             |
| `ENABLE_API_DOCS`                                                                                                      | Unset (off in production). **Executed:** `/api/v1/docs` answers 404 in the rehearsal.                                                                                                |
| `SEED_DEMO`                                                                                                            | Unset. The seed refuses `true` in production.                                                                                                                                        |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`                                                                              | For the first deployment only; removed afterwards (§3).                                                                                                                              |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION` | On the backup service only. A **separate bucket with separate credentials** from the documents bucket: a key that can read a land title need not be able to read the whole database. |
| `LOG_LEVEL`                                                                                                            | `info`.                                                                                                                                                                              |

### Frontend

`VITE_API_BASE_URL` stays at its default, `/api/v1`, because of the rewrite in §1. `VITE_APP_ENV`
is `production`. There is no `VITE_SENTRY_DSN`: error tracking is not integrated (§6), and a
variable nothing reads is a variable somebody will one day set and wonder about.

## 3. First deployment

The order matters: the database and the bucket exist before the API, the API is healthy before
the frontend points at it, and the bootstrap password leaves the environment as soon as it has
been used.

1. **Supabase.** Create the project. Note the region, the pooled and direct connection strings.
   Create the extensions the schema needs — `citext`, `pg_trgm`, `pgcrypto` — from the SQL
   editor; they are what `scripts/db-init/01-extensions.sql` creates for development. Create a
   private bucket `documents` and an S3 access key for it. Enable point-in-time recovery (§5).
2. **Railway, API service.** New service from the repository, root directory `/`; Railway reads
   `apps/backend/railway.json`, which names the Dockerfile, the pre-deploy command
   `npx prisma migrate deploy`, the start command and the health check `/api/v1/health/ready`.
   Set the variables from §2, with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` for now. The
   build argument `PG_CLIENT_VERSION` in the Dockerfile must match the Supabase server's major
   version (`SELECT version()`), or backups will not restore — §5 says why.
3. **Deploy.** The pre-deploy applies every migration to the empty database; the server starts;
   the health check passes once the database answers. The startup log's `file storage ready` line
   names `s3(<host>/documents)` — if it names `local`, stop: the environment is wrong.
4. **Seed, once.** From the Railway shell: `node dist/prisma/seed.js`. Reference data — roles,
   permissions, cooperative types, units — and one platform administrator. The seed is idempotent;
   in production it never creates the demonstration cooperative, and the administrator it creates
   **must change the bootstrap password on first sign-in**.
5. **Vercel.** Import the repository with root directory `apps/frontend`; `vercel.json` carries
   the install and build commands, the rewrite, the SPA fallback and the headers. Replace
   `REPLACE_WITH_API_HOST` in the rewrite with the Railway service's host. Set `VITE_APP_ENV`.
   Deploy.
6. **Sign in** at the Vercel URL as the administrator, set a real password, then **remove
   `SEED_ADMIN_PASSWORD` from Railway's variables**. The seed will never touch that account again
   unless the variable comes back.
7. **Check the headers** the static host sends, from a terminal:
   `curl -sI https://app.example.rw | grep -iE 'content-security|permissions-policy|strict-transport|x-frame|x-content-type|referrer'` —
   six lines, matching `vercel.json`. And `curl -sI https://app.example.rw/api/v1/health` shows
   the API's own headers through the rewrite.
8. **Backup service.** A second Railway service from the same repository with
   `apps/backend/railway.backup.json` as its config: the same image, a cron schedule (Sundays
   02:00 UTC), the backup command. Its variables are `DIRECT_URL` and the `BACKUP_S3_*` set. Run
   it once by hand and confirm the object appears in the backup bucket.
9. **Create the first real cooperative** through the platform administration screen. Its manager
   receives a password link by e-mail, in the cooperative's language, valid for sixty minutes.

Everything a hosting platform runs in steps 2–4, 6–7 and 9 is **executed** by the rehearsal (§4).

## 4. Release procedure

1. Merge to `main` with the quality gate green. CI has already run the deployment rehearsal.
2. Railway builds the image, runs `prisma migrate deploy` as the pre-deploy command, starts the
   new instance and shifts traffic only once `/api/v1/health/ready` answers 200. A failed
   migration fails the pre-deploy and the old instance keeps serving.
3. Vercel builds and deploys the frontend on the same merge.
4. Smoke test: sign in, open the dashboard, record a test expense in a staging cooperative, void it.
5. Before a release that changes a screen: walk the critical flows in a browser by keyboard and
   with a screen reader — the part of `docs/ui-system.md` §9 that jsdom cannot check — and note it
   in the release notes.

Migrations are additive first. A destructive migration requires a written rollback note and a fresh
backup taken immediately before the release.

### The rehearsal

`npm run deploy:rehearse` — **executed** on the reference machine and by CI on every push — is the
first deployment, done locally with the real artefact:

1. Builds the image from `apps/backend/Dockerfile`.
2. Creates an empty database beside the development one, an empty object store (MinIO in a
   container, standing in for Supabase Storage) and a mail server that requires credentials
   (Mailpit, standing in for the SMTP provider).
3. Runs `npx prisma migrate deploy` in the image: 13 migrations, from nothing.
4. Runs `node dist/prisma/seed.js` in the image, with `SEED_ADMIN_PASSWORD` set.
5. Starts the image with `NODE_ENV=production` and a production-shaped environment; waits for
   `/api/v1/health/ready`.
6. Signs in as the administrator — `mustChangePassword` is `true` — reads `/auth/me`, and checks
   the six security headers, that `X-Powered-By` is absent, that `/docs` is 404, that the refresh
   cookie is `Secure; HttpOnly; SameSite=Lax`, and that the startup log names the S3 and SMTP
   drivers.
7. Creates the first cooperative through the platform API, reads the manager's password link
   back from the mail server, and checks that no part of it reached the log.
8. Drops everything it made.

It never touches the database in `DATABASE_URL`. The image is 812 MB, most of it Prisma's engines
and the native modules; trimming it is not a Phase 18 concern.

## 5. Backup and restore

**Automated.** Supabase point-in-time recovery (7 days) is the first line and is enabled at the
project. The weekly `pg_dump` is the second, independent of the provider: the backup service (§3
step 8) runs `db:backup`, which writes a custom-format dump with a SHA-256 checksum beside it,
copies both to the backup bucket, and prunes local copies beyond the newest fourteen. Off-site
retention is the bucket's lifecycle rule: **90 days**.

**On demand.** `npm run db:backup` from any machine with `DIRECT_URL` and a `pg_dump` whose major
version matches the server's. A newer client writes settings an older server refuses on restore;
an older client refuses to dump a newer server at all. `PG_BIN=/path/to/bin` selects the client.
**Executed:** the development database (PostgreSQL 16) dumped with a version-matched client, the
checksum written, the copy uploaded to a local MinIO bucket.

**Restore — the procedure, and it has been executed.**

```
npm run db:restore -- backups/coopmanage-20260921T140552Z.dump coopmanage_restored
```

1. The checksum beside the dump is verified. A dump cut short by a full disk restores without
   error and is missing its last tables; this is what catches it.
2. The target database is created by the script and **must not exist**, and must not be the one
   `DATABASE_URL` names. Restoring over the live database is never the procedure: restore into a
   fresh one, check it, then point the application at it.
3. `pg_restore --no-owner --no-privileges --exit-on-error`, fed through stdin so the client need
   not share the machine's filesystem.
4. `prisma migrate status` against the result — a dump from an older release restores and is then
   migrated forward; this is where that is found out.
5. Row counts from the nine tables a cooperative would notice first, printed for comparison.
6. Afterwards, `npm run inventory:rebuild` against the restored database confirms every stock
   level agrees with its movement history.

**Executed** on 2026-09-21 against the development database: checksum verified, 13 migrations up
to date, 1 cooperative / 6 users / 120 members / 281 transactions / 10 products / 33 movements /
6 sales / 2 documents / 637 audit rows restored, 10 stock levels rebuilt and agreeing. The scratch
database was then dropped.

**Documents** are not in the database dump. Supabase Storage keeps its own versioning; the bucket
is included in the project's backup policy, and `documents.checksum_sha256` lets a restored row be
checked against a restored object.

**Data export.** Independently of any backup, every cooperative can export its members,
transactions, inventory and sales to CSV or Excel. This is the tenant's own copy of its data and
does not depend on platform access.

## 6. Monitoring and logs

- **Logs** are structured Pino JSON on stdout. Railway retains them for the plan's window
  (7 days on Hobby, 30 on Pro); set the project's retention to **30 days**, which is what
  `docs/security.md` promises, and forward to a log service if the plan's window is shorter.
  Every line carries the request id the client received in `X-Request-Id`, so a screenshot of an
  error can be matched to its log line. Bodies, tokens, passwords and telephone numbers are
  redacted before the line is written (`lib/logger.ts` `REDACTED_PATHS`); search terms never
  reach the request line.
- **Liveness** `GET /api/v1/health` and **readiness** `GET /api/v1/health/ready`, the latter
  answering 503 while the database is unreachable. Railway polls readiness; an external uptime
  monitor should poll it too, from outside the platform, every minute.
- **Storage** is probed at startup, not per request: a store that refuses the credentials fails
  the boot rather than the first upload.
- **Error tracking** is not integrated. What an error-tracking service would add is a stack trace
  grouped by frequency; what it costs is a third party receiving request context, and
  `docs/security.md` §12 lists it as out of scope until there is a data-processing agreement in
  place. Until then the log line with the request id is the trail.
- **The audit log** (`GET /audit`) is the application-level record and is retained for the life
  of the cooperative; it is not a substitute for platform logs and is not truncated by them.

## 7. The two message channels

- **E-mail** carries one message: the link by which a new account sets its password, sent in the
  person's language. `MAIL_DRIVER=smtp` with `SMTP_URL` sends it through any SMTP provider; the
  driver is nodemailer 10 behind a two-method interface (`lib/mail`), tested against a real SMTP
  conversation with a catcher that requires credentials, and **executed** in the rehearsal. The
  server authenticates to the host at startup, so a wrong password fails the deployment rather
  than the first invitation. Without an account, `MAIL_DRIVER=console` starts with a warning at
  boot and one per message, and never logs the link in production — which means **no new account
  can be activated until SMTP is configured**. That is deliberate: the alternative is a working
  credential in a log file. Configure SMTP before creating the first cooperative; `console` in
  production is for a staging instance nobody signs up to.
- **SMS.** `SMS_PROVIDER=mock` records every message and delivers none, and every screen that
  sends says so. `docs/announcements-and-sms.md` §3 is the contract a gateway driver implements;
  it lands with the account it needs.

## 8. Checklist

Before declaring a deployment done:

- [ ] `npm run check:env` on the production variables: valid, no warnings.
- [ ] `PG_CLIENT_VERSION` matches `SELECT version()` on the production database.
- [ ] Startup log names `s3(…/documents)` and `smtp(…)`.
- [ ] Administrator signed in, password changed, `SEED_ADMIN_PASSWORD` removed.
- [ ] Six headers on the Vercel host; `/api/v1/docs` is 404.
- [ ] Backup service has run once; the object is in the backup bucket.
- [ ] Point-in-time recovery enabled; log retention set to 30 days.
- [ ] A restore from the first backup has been executed into a scratch database (§5).
