# CoopManage Rwanda

A cooperative management platform for Rwandan cooperatives. Staff run their cooperative's office
work from one place: members, money, stock, sales, meetings, documents and reports, in English and
Kinyarwanda.

Members and farmers need no accounts, no smartphones and no internet. Cooperative staff operate the
system on their behalf.

## Status

**Phase 2 complete — authentication, users and authorization.** You can sign in, and what you see
afterwards depends on your role. Phase 3 adds the cooperative and staff modules.

What exists today:

- npm workspaces monorepo with strict TypeScript, ESLint, Prettier and a pre-commit hook
- Express API with request ids, structured logging, security headers, rate limiting, a single
  response envelope and a single error path, plus liveness and readiness endpoints
- Sign in and out, Argon2id hashing, rotating refresh sessions with family revocation, progressive
  lockout, single-use password reset tokens, and a signed-in device list
- Role-based authorization enforced on every route, per-staff grant and deny overrides, and tenant
  resolution that refuses a cooperative the caller is not staff of
- An append-only audit trail, enforced by the database rather than by convention
- PostgreSQL with two migrations and an idempotent seed: 58 permissions, 6 roles, 10 cooperative
  types, 12 units, and a demonstration cooperative with staff in each role
- React application with the login, password-reset, profile and audit screens, permission-filtered
  navigation, and silent session refresh — all in English and Kinyarwanda
- 253 tests across the three packages

Navigation shows every planned module. Screens that are not built yet say so plainly and name the
phase that delivers them, rather than showing a mock-up.

## Documentation

| Document                                     | What it settles                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | System shape, layering, tenancy, money handling, transactions, toolchain |
| [docs/database.md](docs/database.md)         | Every table, column, constraint and index, and the migration plan        |
| [docs/permissions.md](docs/permissions.md)   | Permission catalogue and the role matrix                                 |
| [docs/api.md](docs/api.md)                   | Response envelope, error codes, every endpoint, the route map            |
| [docs/ui-system.md](docs/ui-system.md)       | Colour, type, spacing, components, accessibility                         |
| [docs/glossary.md](docs/glossary.md)         | Bilingual terminology, fixed before any string is written                |
| [docs/security.md](docs/security.md)         | Threat model and the controls each phase is built against                |
| [docs/deployment.md](docs/deployment.md)     | Environments, release, backup and restore                                |
| [docs/roadmap.md](docs/roadmap.md)           | Feature map and the 18 phases with exit criteria                         |

Three modules carry enough of their own reasoning to be written down separately:

| Document                                                         | What it settles                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/reports.md](docs/reports.md)                               | One report structure, four renderers: screen, PDF, CSV and XLSX           |
| [docs/documents-and-meetings.md](docs/documents-and-meetings.md) | File validation, storage keys, minutes, attendance and quorum             |
| [docs/dashboard-and-search.md](docs/dashboard-and-search.md)     | The one-request dashboard, cooperative health, and permission-safe search |

## Stack

TypeScript throughout. React, Vite, Tailwind CSS, TanStack Query, Zustand, React Hook Form and Zod
on the frontend. Node, Express, Prisma and PostgreSQL on the backend. Exact versions and the reason
for each pin are in [docs/architecture.md](docs/architecture.md) section 16.

## Layout

```
apps/backend      Express + Prisma API
apps/frontend     React + Vite single-page application
packages/shared   Permission keys, roles, API contract types, money formatting
docs              Architecture and design documentation
scripts           Database and operational scripts
```

## Development

Requires Node 20 or newer, npm and Docker.

```bash
npm install                       # also installs the pre-commit hook
cp apps/backend/.env.example apps/backend/.env
npm run db:up                     # PostgreSQL 16 in Docker on port 5435
npm run db:migrate
npm run db:seed                   # reference data
npm run dev                       # API on 4000, web on 5175
```

### Signing in

The seed creates no account with a password anybody could guess. Give it one, or let it generate
one and print it once:

```bash
SEED_DEMO=true SEED_ADMIN_PASSWORD='choose-something-long' \
  SEED_DEMO_PASSWORD='choose-something-long' npm run db:seed
```

`SEED_DEMO=true` also creates _Umurenge Farmers Cooperative_ with a member of staff in each of the
five roles — manager, accountant, secretary, inventory officer and viewer — so every screen can be
seen as each role sees it. The cooperative is flagged as demonstration data and labelled as such
wherever its name appears. Re-running the seed never resets a password it did not set.

Password reset has no delivery channel until Phase 12. Outside production the reset link is written
to the API log, which is where to find it while developing.

Ports are 5435 for the database, 4000 for the API and 5175 for the web application. They avoid the
ports other projects on this machine already use, and Vite runs with `strictPort` so a clash fails
loudly rather than moving the application somewhere unexpected.

Quality gate. All four must pass before a phase is considered complete:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

## Conventions

Strict TypeScript with `any` disallowed by lint. No user-facing string is hard-coded; translation
keys only, and a key present in one language but not the other fails the test suite. Money is
`numeric(14,2)` in the database, `Decimal` in code and a string on the wire, never a JavaScript
number. Financial and stock records are voided and reversed, never deleted. Every tenant-scoped
query filters by cooperative.
