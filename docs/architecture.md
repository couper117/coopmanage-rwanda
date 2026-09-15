# CoopManage Rwanda — Architecture

Status: **Phase 0 (Discovery & Architecture)** — approved baseline for implementation.
Last updated: 2026-09-09

---

## 1. Purpose and constraints

CoopManage Rwanda is a multi-tenant web platform that digitises the **office and management
operations** of Rwandan cooperatives. It is operated by cooperative _staff_, not by members.

Three constraints shape every architectural decision:

1. **Members are offline.** Farmers and ordinary members have no accounts, no smartphones and no
   internet. Every member record is created and maintained _on their behalf_ by staff. Phone
   numbers are optional everywhere, including in the database schema.
2. **Money and stock must be correct.** All monetary and quantity mutations are written inside
   database transactions, use `numeric` types, and are reversible rather than deletable.
3. **Tenant isolation is a security boundary, not a filter.** A user of Cooperative A must never
   be able to read or write Cooperative B's data, including by guessing an identifier.

Non-goals for V1: mobile apps, member self-service portals, payroll, loans, procurement,
government reporting integrations, true offline-first write synchronisation.

---

## 2. High-level shape

```
                      Browser (React SPA)
                            |
                 HTTPS  JSON  Bearer access token
                            |
                    Express API (Node, TS)
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   HTTP layer          Domain layer        Infrastructure
   routes              services            Prisma client
   controllers         policies            object storage
   validators (Zod)    calculations        SMS provider
   middleware          invariants          mailer
        └───────────────────┼───────────────────┘
                            |
                      PostgreSQL 16
```

A **monorepo with npm workspaces**, matching the layout already used elsewhere on this machine:

```
coopmanage-rwanda/
  apps/
    backend/          Express + Prisma API
    frontend/         React + Vite SPA
  packages/
    shared/           Types, enums, permission keys, money helpers shared by both apps
  docs/
  scripts/
```

`packages/shared` holds only things that are genuinely contract-level: permission keys, role keys,
enum unions, API envelope types, currency formatting rules. It must never import Prisma or React.
This keeps the frontend from coupling to backend implementation details while still preventing the
permission strings from drifting apart in two places.

---

## 3. Backend layering

Requests flow in exactly one direction. A layer may call the layer below it and never the one above.

| Layer      | Directory                       | Responsibility                                                   | Forbidden              |
| ---------- | ------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| Route      | `modules/<m>/<m>.routes.ts`     | Path, HTTP verb, middleware chain                                | Business logic, Prisma |
| Middleware | `middleware/`                   | Auth, tenant resolution, permission checks, rate limits, uploads | Domain rules           |
| Validator  | `modules/<m>/<m>.schema.ts`     | Zod schemas for params, query, body                              | Database access        |
| Controller | `modules/<m>/<m>.controller.ts` | Read validated input, call service, shape response               | Calculations, Prisma   |
| Service    | `modules/<m>/<m>.service.ts`    | Business rules, transactions, invariants, audit events           | `req` / `res` objects  |
| Repository | `modules/<m>/<m>.repository.ts` | Prisma queries, always tenant-scoped                             | Business rules         |

Repositories exist only where query logic is non-trivial or reused. For simple modules the service
may call Prisma directly; what is _not_ negotiable is that controllers never do.

### Module list

```
auth  users  roles  cooperatives  staff  members  shares  contributions
finance  categories  products  inventory  warehouses  units
buyers  sales  reports  documents  meetings  announcements
dashboard  search  notifications  sms  audit  assistant  admin  health
```

Each module is a self-contained folder under `apps/backend/src/modules/`. Adding a cooperative-type
module later means adding a folder and registering one router — no changes to existing modules.

### Cross-cutting infrastructure

```
apps/backend/src/
  config/        env.ts (Zod-validated), constants, logger config
  lib/           prisma.ts, logger.ts, errors.ts, money.ts, pagination.ts, ids.ts
  middleware/    requestContext, authenticate, requireCooperative, requirePermission,
                 validate, rateLimit, errorHandler, notFound, auditContext, idempotency
  services/      storage/ (local + S3-compatible drivers), sms/ (mock + provider),
                 mail/, pdf/, csv/
  jobs/          low-stock scan, meeting reminders, session cleanup
```

---

## 4. Tenant isolation

This is the single most important mechanism in the system. It is enforced in four places, and any
one of them failing must not be enough to leak data.

1. **Token.** The access token carries `userId` only. It never carries a cooperative id, so a
   forged or stale token cannot select a tenant.
2. **Tenant resolution middleware.** The active cooperative arrives as the `X-Cooperative-Id`
   header (or `:cooperativeId` path segment for admin routes). The middleware loads the caller's
   `CooperativeStaff` row for that cooperative and rejects the request with `403` if there is no
   `ACTIVE` membership. The resolved `{ cooperativeId, staffId, roleKey, permissions }` is attached
   to `req.ctx`. Platform administrators bypass the membership requirement but their access is
   written to the audit log on every request.
3. **Repository contract.** Every repository function takes `cooperativeId` as its first argument
   and includes it in the `where` clause — including on `findUnique`-style lookups by id, which are
   written as `findFirst({ where: { id, cooperativeId } })`. A record that belongs to another tenant
   returns "not found", never "forbidden", so ids cannot be probed.
4. **Automated test.** A cross-tenant test suite runs a fixed list of every tenant-scoped endpoint
   with Cooperative A's credentials against Cooperative B's record ids and asserts `404`. New
   endpoints are added to that list; the suite fails the build if a route is missing from it.

Postgres row-level security is deliberately _not_ used in V1. With a single application-level
connection pool it would require per-request `SET LOCAL`, which interacts badly with Prisma's
transaction handling. The four layers above are enforceable and testable; RLS remains available as
a later hardening step and the schema is designed so that adding it needs no data migration.

---

## 5. Authentication and authorization

**Authentication.** Email plus password. Passwords are hashed with Argon2id (bcrypt as fallback if
the native build is unavailable). Login returns a short-lived JWT access token (15 minutes, kept in
memory by the SPA) and a rotating refresh token delivered as an `HttpOnly`, `Secure`, `SameSite=Lax`
cookie scoped to the refresh endpoint. Refresh tokens are stored hashed in `RefreshSession`;
presenting an already-rotated token revokes the whole session family, which detects theft. Repeated
failed logins lock the account for an increasing interval and are rate limited by IP and by account.

**Authorization.** Role-based, with permissions as the unit of checking. A permission is a
`resource:action` string such as `finance:create`. Roles are named bundles of permissions seeded at
install time. `requirePermission('finance:create')` reads the permission set already resolved onto
`req.ctx` and returns `403` when it is absent.

The frontend receives the same permission list and uses it to hide navigation and disable buttons.
That is a usability affordance only. **Every protected endpoint re-checks server-side.** No frontend
signal is ever trusted.

**Rotation is claimed, not checked.** Reading the session row, testing `replaced_by_id` and then
writing is a check followed by an act: two requests carrying the same token both pass the test and
both mint a replacement, which leaves several live tokens in one family and the reuse undetected.
The rotation therefore claims the presented token with
`UPDATE ... WHERE replaced_by_id IS NULL AND revoked_at IS NULL`, which takes a row lock, so exactly
one caller can win whatever else is in flight. The losers are treated as a replay.

That strictness has a consequence worth stating. Two browser tabs waking at the same moment hold the
same cookie; one rotation wins and the other is read as a replay, so the family is revoked and the
user is signed out. The client refreshes single-flight within a tab, so reaching this needs two
tabs. A short grace window, during which a just-rotated token returns its existing replacement
rather than revoking, would remove the sharp edge without giving a real thief a useful window. It is
a deliberate change to the rule in `database.md` section 3 rather than a defect, and belongs to the
Phase 15 security review.

A per-staff override table (`StaffPermissionOverride`) allows a single grant or deny on top of the
role. It exists so that real cooperatives with unusual staffing do not force the creation of new
roles, and it is evaluated as: `role permissions + GRANT overrides − DENY overrides`.

---

## 6. Money and quantity handling

- RWF amounts: PostgreSQL `numeric(14,2)`, mapped by Prisma to `Decimal`.
- Quantities: `numeric(14,3)`, so litres and kilograms with fractions are exact.
- No arithmetic on money is ever performed with JavaScript `number`. `lib/money.ts` wraps
  `Prisma.Decimal` and exposes `add`, `sub`, `mul`, `sum`, `compare` and a formatter. Its unit tests
  are part of the definition of done for Phase 4, which is the first phase that writes a monetary
  value.
- Amounts cross the API boundary as **strings** (`"250000.00"`), not JSON numbers, so that no value
  passes through an IEEE-754 double. The frontend formats them with `Intl.NumberFormat` and never
  computes totals it could ask the server for.
- Rounding, where unavoidable, is half-up at 2 decimal places and applied once at the end of a
  calculation, never per line.

---

## 7. Transactional integrity

Any operation touching more than one row runs inside `prisma.$transaction` with an explicit
timeout. The canonical case is confirming a sale. A sale is created as a draft first, so
confirmation operates on rows that already exist and any failure rolls back to a still-valid draft:

```
BEGIN
  lock Sale FOR UPDATE, assert status = DRAFT
  for each SaleItem: decrement StockLevel conditionally, insert InventoryTransaction (SALE_OUT)
  insert FinanceTransaction (income) when payment is taken at the point of sale
  update Sale set status = CONFIRMED, confirmed_at = now()
  insert AuditLog
COMMIT   -- any failure leaves the untouched draft: no stock moved, no money posted
```

Stock is protected against concurrent oversell by decrementing with a conditional update
(`UPDATE ... SET quantity = quantity - $1 WHERE product_id = $2 AND warehouse_id = $3 AND quantity >= $1`)
and treating a zero row count as an insufficient-stock error, rather than by read-then-write.

**Reversal, not deletion.** Financial and inventory records are never hard-deleted. A mistake is
corrected by posting a reversal row that references the original and by marking the original
`VOID`. Members are deactivated, not removed. Documents are archived. This keeps the audit trail
truthful, which is the whole point of the system for a cooperative.

**Idempotency.** Mutating endpoints in finance, inventory and sales accept an `Idempotency-Key`
header. The key, the request hash and the stored response live in an `IdempotencyKey` table with a
24-hour expiry. A repeat of the same key returns the original response instead of creating a second
transaction. This is what makes the Phase 13 retry-on-flaky-connection behaviour safe.

---

## 8. Frontend architecture

```
apps/frontend/src/
  app/           router, providers, error boundary, query client
  components/ui/ design-system primitives (Button, Input, Table, Dialog, ...)
  components/    composed shared widgets (PageHeader, DataTable, EmptyState, Money, ...)
  features/<f>/  api.ts, hooks.ts, schemas.ts, components/, pages/
  layouts/       AppShell, AuthLayout, PrintLayout
  hooks/         useDebounce, usePermission, useOnlineStatus, useFormDraft
  lib/           apiClient, formatters, cn, permissions, dates
  i18n/          index.ts, locales/en/*.json, locales/rw/*.json
  stores/        uiStore (sidebar, density), sessionStore (active cooperative), draftStore
  types/
```

**Server state lives in TanStack Query. Client state lives in Zustand.** Zustand holds the sidebar
state, table density, the active cooperative id and unsaved form drafts. It never caches a list of
members. Query keys are namespaced by tenant — `['members', cooperativeId, filters]` — so switching
cooperative cannot show the previous tenant's cached rows.

**Forms** use React Hook Form with Zod resolvers. The Zod object for a create/update form is
defined once in the feature's `schemas.ts` and mirrors the backend schema's shape, but the backend
schema remains the authority; the frontend copy exists for instant feedback, not for trust.

**Business logic does not live in components.** Derived values, eligibility rules and formatting
live in feature hooks or `lib/`. Components render.

Route-level code splitting via `React.lazy` keeps the initial bundle small; report and assistant
routes, which pull in charting and PDF code, are always lazy.

---

## 9. Internationalization

i18next with `react-i18next`, resources split into namespaces per feature
(`common`, `nav`, `dashboard`, `members`, `finance`, `inventory`, `sales`, `reports`, `documents`,
`meetings`, `settings`, `errors`, `validation`). English and Kinyarwanda ship from Phase 1.

Rules that hold from the first commit:

- No user-facing string is written inline in a component. Keys only.
- Validation messages come from keys; Zod schemas carry message keys, and the renderer translates.
- Server-generated user-facing text — notifications, audit summaries, error messages — is stored
  and transmitted as a **key plus JSON parameters**, not as a rendered sentence. The client
  translates. This is why `Notification` and `AuditLog` carry `messageKey` and `messageParams`
  columns rather than only free text.
- The selected language persists in `localStorage` and, for signed-in users, on the `User` record,
  so it follows the person across devices.
- A CI check compares the English and Kinyarwanda key sets and fails on any key present in one and
  missing from the other.

---

## 10. Files and storage

Uploads go through a storage abstraction with two drivers: a local filesystem driver for
development and an S3-compatible driver (Supabase Storage) for production. Nothing in a module
imports a storage SDK directly.

As of Phase 9 the local driver is built and the S3-compatible one is not: it lands in Phase 18 with
the bucket it needs, because a signing implementation written against no real endpoint is a driver
nobody has run. Until then `STORAGE_DRIVER=s3` refuses at startup rather than falling back to the
local disk, which in production would mean a cooperative's documents were written to a container
that is replaced on the next deployment. The interface has deliberately no `url()` method:
`docs/documents-and-meetings.md` §3.

Documents are **never** publicly readable. Files are stored under an unguessable key and served
through `GET /api/v1/documents/:id/download`, which authenticates, checks tenant, checks
`documents:view`, and streams the object. Uploads validate the extension, the declared MIME type and
the actual magic bytes, cap size (10 MB default, configurable), strip the original path from the
filename, and store a SHA-256 checksum.

---

## 11. Error handling, logging, observability

A single `AppError` class carries an HTTP status, a stable machine `code`
(`VALIDATION_FAILED`, `NOT_FOUND`, `INSUFFICIENT_STOCK`, ...), an i18n `messageKey` with params, and
optional field-level details. The error middleware converts anything else into a `500` with code
`INTERNAL_ERROR`. Users see a translated, human sentence; the stack trace goes only to the log.

Logging uses Pino with a request id on every line. A redaction list keeps passwords, tokens,
cookies, national identity numbers and file contents out of the logs permanently. Health lives at
`/api/v1/health` (process) and `/api/v1/health/ready` (database reachable).

---

## 12. Offline resilience (design intent, built in Phase 13)

V1 is **offline-tolerant, not offline-first**. Concretely:

- TanStack Query persists its cache so recently viewed lists still render when the connection drops.
- A connection indicator in the shell tells the user plainly what state they are in.
- In-progress form input is written to `localStorage` per form key and restored on return, so a
  dropped connection or an accidental reload never loses typing.
- Only safe operations retry automatically: `GET` always, and mutations only when they carry an
  idempotency key.

Queued offline _writes_ are explicitly out of scope for V1. Replaying a queue of financial
transactions without a server-side deduplication contract is how systems create duplicate money,
and the idempotency table plus reversal-only accounting are the foundations that a later
offline-first phase would build on.

---

## 13. The assistant ("Ask CoopManage", Phase 14)

The assistant answers questions **from SQL, not from the model's memory**. The model is given a
fixed catalogue of read-only, parameterised query tools (`countMembers`, `sumFinance`,
`lowStockProducts`, `recentSales`, ...). It chooses a tool and arguments; the backend executes the
query under the caller's own tenant and permission context and returns rows; the model turns rows
into a sentence and the UI shows the underlying figures next to the answer.

The model never sees raw SQL from the user, never receives another cooperative's data, and has no
write tools in V1. If no tool fits the question, the assistant says so and links to the relevant
screen. This is the only way "never invent financial numbers" can be an architectural guarantee
rather than a prompt instruction.

---

## 14. Environments and deployment

| Concern  | Development                                   | Production                    |
| -------- | --------------------------------------------- | ----------------------------- |
| Database | Docker `postgres:16` on port 5435             | Supabase PostgreSQL           |
| Storage  | Local `./storage` directory                   | Supabase Storage (S3 API)     |
| SMS      | Mock provider writing to the database and log | Configurable provider adapter |
| Frontend | Vite dev server, port 5175                    | Vercel static build           |
| Backend  | `tsx watch`, port 4000                        | Railway (Node service)        |

All configuration comes from environment variables validated by Zod at boot; the process refuses to
start on a missing or malformed variable rather than failing later at request time. `.env` is
gitignored and `.env.example` carries placeholders only.

---

## 15. Repository conventions

- TypeScript everywhere, `strict: true`, `noUncheckedIndexedAccess: true`, `any` disallowed by lint.
- ESLint plus Prettier, enforced in CI and on a pre-commit hook.
- Conventional commits, one phase per branch, no direct commits to `main`.
- Quality gate run at the end of every phase: `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run build`. A phase is not complete while any of them fails.

---

## 16. Toolchain and pinned versions

Installed versions, verified on 2026-09-10. Majors are pinned deliberately; the project does not
float to whatever is newest at install time.

| Package                                                                      | Installed                           | Note                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Node                                                                         | 26 locally, `engines` requires ≥ 20 |                                                                                                   |
| TypeScript                                                                   | 5.9.3                               | See the note below                                                                                |
| Prisma and `@prisma/client`                                                  | 7.10.0                              | Prisma 8 is still a release candidate                                                             |
| `@prisma/adapter-pg`                                                         | 7.10.0                              | Required: see the Prisma 7 note below                                                             |
| Express                                                                      | 5.2.1                               | Version 5 forwards rejected promises to the error handler, so no `asyncHandler` wrapper is needed |
| Zod                                                                          | 4.6.0                               |                                                                                                   |
| Pino 10.3, Helmet 8.3, express-rate-limit 8.7                                | current                             |                                                                                                   |
| React and React DOM                                                          | 19.3.0                              |                                                                                                   |
| React Router                                                                 | 7.18.3                              |                                                                                                   |
| Vite                                                                         | 6.4.3                               |                                                                                                   |
| Tailwind CSS                                                                 | 4.3.3                               | CSS-first `@theme` configuration, no `tailwind.config.ts`                                         |
| TanStack Query                                                               | 5.102.8                             |                                                                                                   |
| React Hook Form 7.87, Zustand 5.0, i18next 24.2, react-i18next 15.7          | current                             |                                                                                                   |
| Radix UI primitives, lucide-react 0.460                                      | current                             | One icon library, no exceptions                                                                   |
| Vitest 5.0, Supertest 7.2, ESLint 9.39 (flat config), typescript-eslint 8.70 | current                             |                                                                                                   |

Playwright is not installed yet. End-to-end tests arrive in Phase 17, and adding the browser
download before there is a flow worth driving would only slow every install.

**TypeScript 5.9 rather than 7.0.** TypeScript 7 is available and is the native compiler rewrite. It
is deliberately not adopted in the foundation phase: the project's correctness depends on strict
type checking plus the ESLint TypeScript plugin, Vite and Prisma's generated client all agreeing,
and a compiler rewrite is the wrong thing to be debugging while building the domain. The upgrade is
revisited at Phase 17, when the test suite can prove the move changed nothing.

**Prisma 7 connects through a driver adapter.** Version 7 removed `url` and `directUrl` from the
`datasource` block. The connection string now reaches the migration and introspection commands
through `apps/backend/prisma.config.ts`, and reaches the runtime client through `@prisma/adapter-pg`
in `src/lib/prisma.ts`, where the pool size and connection timeout are set in application code. The
seed script constructs its own adapter for the same reason.

**Two accepted dependency advisories.** `npm audit` reports four high findings, all inside the
Prisma **CLI**, which is a development dependency: `deepmerge-ts` reached through `@prisma/config`,
and `mysql2`, a driver this project never loads because it uses PostgreSQL. The only offered remedy
is a downgrade to Prisma 6, which is a worse position than the advisory. Neither package is present
in the deployed runtime. This is reviewed again at Phase 15 and on every Prisma upgrade.

**PostgreSQL extensions.** `citext` for case-insensitive email, `pg_trgm` for member, product and
buyer search, and `pgcrypto` for `gen_random_uuid()`. Created by `scripts/db-init/01-extensions.sql`
on first container start and by the first Prisma migration in deployed environments.

**Ports on this machine.** PostgreSQL 5435, API 4000, web 5175. Ports 5173 and 5174 are taken by
other projects, and Vite runs with `strictPort` so a silent fallback cannot leave the browser
talking to the wrong application.
