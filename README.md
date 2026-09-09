# CoopManage Rwanda

A cooperative management platform for Rwandan cooperatives. Staff run their cooperative's office
work from one place: members, money, stock, sales, meetings, documents and reports, in English and
Kinyarwanda.

Members and farmers need no accounts, no smartphones and no internet. Cooperative staff operate the
system on their behalf.

## Status

**Phase 0 complete — discovery and architecture.** No application code yet, by design. Phase 1
builds the project foundation.

Read the documentation in this order:

| Document | What it settles |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | System shape, layering, tenancy, money handling, transactions |
| [docs/database.md](docs/database.md) | Every table, column, constraint and index |
| [docs/permissions.md](docs/permissions.md) | Permission catalogue and the role matrix |
| [docs/api.md](docs/api.md) | Response envelope, error codes, every endpoint, the route map |
| [docs/ui-system.md](docs/ui-system.md) | Colour, type, spacing, components, accessibility |
| [docs/glossary.md](docs/glossary.md) | Bilingual terminology, fixed before any string is written |
| [docs/security.md](docs/security.md) | Threat model and the controls each phase is built against |
| [docs/deployment.md](docs/deployment.md) | Environments, release, backup and restore |
| [docs/roadmap.md](docs/roadmap.md) | Feature map and the 18 phases with exit criteria |

## Stack

TypeScript throughout. React, Vite, Tailwind CSS, TanStack Query, Zustand, React Hook Form and Zod
on the frontend. Node, Express, Prisma and PostgreSQL on the backend. npm workspaces monorepo.

## Layout

```
apps/backend      Express + Prisma API
apps/frontend     React + Vite single-page application
packages/shared   Permission keys, enums, API contract types
docs              Architecture and design documentation
scripts           Database and operational scripts
```

## Development

Requires Node 20 or newer, npm and Docker.

```bash
npm install
npm run db:up          # PostgreSQL 16 in Docker on port 5435
npm run db:migrate
npm run db:seed        # reference data; SEED_DEMO=true adds the demonstration cooperative
npm run dev            # backend on 4000, frontend on 5173
```

Quality gate, run before any phase is considered complete:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

## Conventions

Strict TypeScript with `any` disallowed. No user-facing string is hard-coded; translation keys only.
Money is `numeric(14,2)` in the database, `Decimal` in code and a string on the wire, never a
JavaScript number. Financial and stock records are voided and reversed, never deleted. Every
tenant-scoped query filters by cooperative.
