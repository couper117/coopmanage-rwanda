# CoopManage Rwanda — Environments, Deployment and Backup

Written in **Phase 0** as the target. Executed and verified in **Phase 18**. Nothing here is
claimed to be configured until that phase records it as verified.

---

## 1. Environments

|          | Development                              | Production                       |
| -------- | ---------------------------------------- | -------------------------------- |
| Frontend | Vite dev server, `http://localhost:5175` | Vercel static build              |
| Backend  | `tsx watch`, `http://localhost:4000`     | Railway Node service             |
| Database | Docker `postgres:16`, host port **5435** | Supabase PostgreSQL              |
| Storage  | Local `./storage` directory              | Supabase Storage, private bucket |
| SMS      | Mock provider, logs to the database      | Configured provider adapter      |
| Email    | Console transport                        | SMTP from the environment        |

Host port 5435 avoids the PostgreSQL ports already occupied on this machine by other projects
(5432, 5433, 5434), and web port 5175 avoids their Vite servers on 5173 and 5174. Vite runs with
`strictPort`, so a clash fails loudly instead of silently moving to another port.

## 2. Environment variables

Validated by Zod at boot; the process exits with a clear message rather than starting in a broken
state. `.env.example` lists every variable with a safe placeholder.

**Backend:** `NODE_ENV`, `PORT`, `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET`,
`JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `CORS_ORIGINS`, `LOG_LEVEL`, `STORAGE_DRIVER`,
`STORAGE_LOCAL_PATH`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`MAX_UPLOAD_BYTES`, `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMTP_URL`, `SMTP_FROM`,
`ASSISTANT_PROVIDER`, `ANTHROPIC_API_KEY`, `ENABLE_API_DOCS`, `SEED_DEMO`.

**Frontend:** `VITE_API_BASE_URL`, `VITE_APP_ENV`, `VITE_SENTRY_DSN` (optional).

`DIRECT_URL` is the unpooled Supabase connection used by `prisma migrate`; `DATABASE_URL` is the
pooled connection used at runtime.

## 3. Release procedure

1. Merge to `main` with the quality gate green.
2. `prisma migrate deploy` runs against production before the new backend instance starts.
3. Backend deploys; `/health/ready` must return healthy before traffic is shifted.
4. Frontend builds and deploys.
5. Smoke test: log in, open the dashboard, record a test expense in a staging cooperative, void it.

Migrations are additive first. A destructive migration requires a written rollback note and a fresh
backup taken immediately before the release.

## 4. Backup and restore

**Production.** Supabase automated daily backups with 7-day point-in-time recovery, plus a weekly
`pg_dump` to separate object storage with 90-day retention, run from `scripts/backup-db.mjs`, which
is delivered in Phase 18.

**On demand.** `npm run db:backup` writes a compressed custom-format dump named with a UTC
timestamp.

**Restore.** `pg_restore --clean --if-exists` into an empty database, then `prisma migrate status`
to confirm the schema matches the code, then a smoke test. The full procedure with commands is kept
in this file and is **executed for real once per release** against a scratch database. A backup that
has never been restored is not a backup.

**Data export.** Independently of database backups, every cooperative can export its members,
transactions, inventory and sales to CSV or Excel. This is the tenant's own copy of its data and
does not depend on platform access.

## 5. Monitoring

Structured Pino logs shipped to the platform's log service with 30-day retention. `/api/v1/health`
for liveness and `/api/v1/health/ready` for database reachability, both polled by the host. Error
tracking is optional and, if enabled, is configured to scrub request bodies and personal data before
transmission.
