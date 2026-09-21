# CoopManage Rwanda

A cooperative management platform for Rwandan cooperatives. Staff run their cooperative's office
work from one place: members, money, stock, sales, meetings, documents and reports, in English and
Kinyarwanda.

Members and farmers need no accounts, no smartphones and no internet. Cooperative staff operate the
system on their behalf.

## Status

**All eighteen phases complete.** The product is built, tested, reviewed and rehearsed for
deployment; `docs/roadmap.md` records each phase's exit criterion and how it was met.

What exists:

- **Members, finance, inventory, sales, reports, documents, meetings, announcements, dashboard,
  search and an assistant** — the common core every cooperative shares, adapted by configuration,
  never forked by type. Members and farmers need no account, no smartphone and no telephone number.
- **English and Kinyarwanda** as equals: every string in both, every report and every message in
  the reader's language, checked by a script that fails the build on a key present in one and not
  the other.
- **Money as decimal strings, never floats; void and reverse, never delete; an append-only audit
  trail** enforced by the database.
- **Four-layer tenancy**, with a route sweep that fails the build if any parameterised route lets
  one cooperative reach another's row.
- **Offline resilience**: cached screens, saved drafts, an honest connection indicator, and
  idempotent writes so a retried submission cannot double-post.
- **1,384 tests** across the three packages, including an end-to-end run of the nine critical
  flows, an accessibility gate (axe), a keyboard walkthrough, and a gate that fails the run if any
  of the 144 endpoints has no passing test. Coverage is measured on business logic only and
  enforced as a floor.
- **A rehearsed deployment**: `npm run deploy:rehearse` builds the production image and deploys it
  from an empty database against an object store and a mail server, then signs in and creates the
  first cooperative. CI does it on every push. Backup and restore have been executed for real.

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

Five modules carry enough of their own reasoning to be written down separately:

| Document                                                         | What it settles                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/reports.md](docs/reports.md)                               | One report structure, four renderers: screen, PDF, CSV and XLSX           |
| [docs/documents-and-meetings.md](docs/documents-and-meetings.md) | File validation, storage keys, minutes, attendance and quorum             |
| [docs/dashboard-and-search.md](docs/dashboard-and-search.md)     | The one-request dashboard, cooperative health, and permission-safe search |
| [docs/announcements-and-sms.md](docs/announcements-and-sms.md)   | Notifications, announcements, and the SMS provider and message log        |
| [docs/assistant.md](docs/assistant.md)                           | Ask CoopManage: the tool catalogue, the planner, and the adversarial set  |

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

Password-setting links go out by e-mail (`MAIL_DRIVER=smtp`). Outside production the default
console driver writes the whole message to the API log instead, which is where to find the link
while developing.

Ports are 5435 for the database, 4000 for the API and 5175 for the web application. They avoid the
ports other projects on this machine already use, and Vite runs with `strictPort` so a clash fails
loudly rather than moving the application somewhere unexpected.

Quality gate. All of it must pass before a change is merged, and CI runs the same:

```bash
npm run lint && npm run typecheck && npm run check:translations && npm run test && npm run build
npm run check:audit        # dependency advisories, with a reviewed exception list
npm run check:migrations   # the migrations build the schema from an empty database
npm run deploy:rehearse    # the production image, deployed from empty (needs Docker)
```

Two of the backend suites run against real services when they are present and skip themselves
otherwise: the S3 storage driver against MinIO (`S3_TEST_ENDPOINT`) and the SMTP driver against
Mailpit (`SMTP_TEST_URL`). `docs/testing.md` §6 has the two `docker run` lines.

## Conventions

Strict TypeScript with `any` disallowed by lint. No user-facing string is hard-coded; translation
keys only, and a key present in one language but not the other fails the test suite. Money is
`numeric(14,2)` in the database, `Decimal` in code and a string on the wire, never a JavaScript
number. Financial and stock records are voided and reversed, never deleted. Every tenant-scoped
query filters by cooperative.
