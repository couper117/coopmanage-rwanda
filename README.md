# CoopManage Rwanda

A cooperative management platform for Rwandan cooperatives. Staff run their cooperative's office
work from one place: members, money, stock, sales, meetings, documents and reports, in English and
Kinyarwanda.

Members and farmers need no accounts, no smartphones and no internet. Cooperative staff operate the
system on their behalf.

## Status

**Phase 1 complete — project foundation.** Both applications run, the database is migrated and
seeded, and the interface renders in English and Kinyarwanda. There is no authentication yet, so
there is nothing to sign in to: that is Phase 2.

What exists today:

- npm workspaces monorepo with strict TypeScript, ESLint, Prettier and a pre-commit hook
- Express API with request ids, structured logging, security headers, rate limiting, a single
  response envelope and a single error path, plus liveness and readiness endpoints
- PostgreSQL with the first migration and an idempotent reference-data seed: 58 permissions,
  6 roles, 10 cooperative types
- React application shell with the full design-token set, navigation, and both languages
- 132 tests across the three packages

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
