# CoopManage Rwanda — Feature Map and Development Roadmap

Status: **Phase 0 complete.** Phase 1 is next.

---

## 1. Feature map

The **common core** is shared by every cooperative regardless of type. **Configuration** adapts the
core to a cooperative without forking it. Nothing in the core branches on cooperative type.

```
CoopManage Rwanda
│
├── Access
│   ├── Authentication          login, logout, password reset, sessions, lockout
│   ├── Users & profile         own details, language, password change
│   ├── Roles & permissions     5 cooperative roles + platform admin, per-staff overrides
│   └── Staff                   invite, assign role, deactivate
│
├── Cooperative
│   ├── Profile                 identity, registration, location, logo, contacts
│   ├── Type                    agriculture, dairy, coffee, livestock, handicrafts,
│   │                           trading, transport, manufacturing, services, other
│   ├── Settings                units, categories, thresholds, fiscal year, SMS sender
│   └── Multi-tenancy           isolated data, cooperative switcher, platform administration
│
├── Members
│   ├── Register / edit / view / search / filter / activate / deactivate
│   ├── Member code             COOP-00452, allocated per cooperative
│   ├── Shares                  purchase, transfer, redemption, current holding
│   ├── Contributions           membership fee, savings, share capital, levies
│   ├── Deliveries              produce supplied, derived from stock receipts
│   └── Profile summary         shares, contributions, quantity supplied, payments, timeline
│
├── Money
│   ├── Income / Expenses       one ledger, categories, methods, attachments
│   ├── Balance                 money in − money out
│   ├── Summaries               day, week, month, custom range, category breakdown
│   ├── Void & reversal         corrections that keep the history
│   └── Export                  CSV and Excel
│
├── Stock
│   ├── Products & categories   SKU, unit, minimum level, prices
│   ├── Units of measure        kg, tonnes, litres, units, pieces, boxes, bags, custom
│   ├── Warehouses              multiple storage locations
│   ├── Movements               receive, issue, adjust, transfer, sale-out, reversal
│   ├── Stock levels            per product per warehouse, rebuildable from movements
│   └── Low-stock alerts        threshold per product, notification with dedupe
│
├── Trade
│   ├── Buyers                  organisation, contact, location, history
│   ├── Sales                   draft, confirm, cancel, line items, discount, tax
│   ├── Stock integration       confirmation moves stock in the same transaction
│   ├── Payments                full or partial, links to the money ledger
│   └── Receipts                printable, PDF
│
├── Governance
│   ├── Meetings                type, date, location, agenda, attendance, decisions, minutes
│   ├── Documents               eight categories, secure storage, preview, search, archive
│   └── Announcements           draft, publish, audience, history
│
├── Insight
│   ├── Dashboard               KPIs, recent activity, needs attention, quick actions
│   ├── Health overview         GOOD / WATCH / ATTENTION with the reason, from real data
│   ├── Reports                 monthly cooperative, financial, member, inventory, sales,
│   │                           activity, meeting — preview, PDF, CSV, Excel
│   ├── Global search           members, products, buyers, sales, documents, meetings
│   └── Ask CoopManage          questions answered from database queries only
│
└── Platform
    ├── Notifications           centre, categories, dedupe, actionable links
    ├── SMS                     provider abstraction, mock provider, message log
    ├── Audit log               who, what, when, which cooperative, before and after
    ├── Offline resilience      connection state, cached reads, form drafts, idempotency
    └── Internationalisation    English and Kinyarwanda throughout, persisted preference
```

### Configuration, not forks

A dairy cooperative and a handicraft cooperative run the same code. They differ only in seeded
units (litres versus pieces), seeded product categories, and the label shown for a stock receipt
("Milk collection" versus "Goods received"), which is a per-type translation key. Adding a
cooperative type is a seed row plus two translation keys — never a new module.

---

## 2. Phase plan

Each phase ends with the same gate. A phase is **not** complete until all seven pass:

1. `npm run lint` clean
2. `npm run typecheck` clean, no `any`, no suppressions without a written reason
3. `npm run test` green, including the tests the phase added
4. `npm run build` succeeds for both applications
5. Migrations apply from an empty database and the seed runs
6. The phase's screens reviewed in **both English and Kinyarwanda**, at desktop and mobile widths,
   by keyboard
7. Cross-tenant and permission tests extended to cover every route the phase added

---

### Phase 0 — Discovery and architecture ✅

Inspect the environment, decide the architecture, write it down before writing application code.

Delivered: `architecture.md`, `database.md`, `permissions.md`, `api.md`, `ui-system.md`,
`roadmap.md`, `glossary.md`, repository initialised, toolchain and database availability confirmed.

---

### Phase 1 — Project foundation

Monorepo, both applications running, empty but real.

- npm workspaces; `apps/backend`, `apps/frontend`, `packages/shared`
- Strict TypeScript, ESLint, Prettier, pre-commit hook, shared `tsconfig.base.json`
- Zod-validated environment configuration; `.env.example`; the process refuses to boot on a bad value
- Docker Postgres on port 5435; Prisma initialised; the first migration creating the identity,
  cooperative and reference tables; seed of permissions, roles, types and units
- Express application: helmet, CORS allow-list, compression, request id, Pino logging, rate limiter,
  the response envelope, the error handler, `/health` and `/health/ready`
- React application: Vite, Tailwind with the full token set from `ui-system.md`, the router, the
  query client, the API client with the envelope and error mapping, the application shell with
  sidebar, top bar and page header, and the first ten design-system primitives
- i18next wired with English and Kinyarwanda namespace files, the language switcher, persistence,
  and the CI key-parity check

**Exit:** `npm run dev` starts both applications, the shell renders in both languages, the health
endpoint reports the database as reachable, and the quality gate is green.

---

### Phase 2 — Authentication, users, authorization

- Argon2id hashing, login, refresh rotation with family revocation, logout, session list
- Forgot and reset password, single-use tokens, uniform responses, rate limits, progressive lockout
- `GET /auth/me` returning the effective permission set
- `authenticate`, `resolveCooperative`, `requirePermission` middleware; `req.ctx`
- Audit logging service and the first entries; append-only enforcement
- Login screen, protected routes, `PermissionGate`, `usePermission`, profile screen, session expiry
  handling with silent refresh

**Exit:** the five permission test suites in `permissions.md` §7 pass; a viewer token is rejected by
every mutating endpoint; nothing user-facing is untranslated.

---

### Phase 3 — Cooperatives, staff, tenancy

- Cooperative creation, profile, logo, settings; cooperative types
- Staff invitation, role assignment, deactivation, permission overrides
- Tenant resolution end to end; the cooperative switcher for multi-cooperative users
- Platform administration: cooperative list, create, suspend; platform user management
- The cross-tenant test harness, seeded with two cooperatives

**Exit:** a user of Cooperative A receives `404` on every one of Cooperative B's identifiers, proven
by the automated route sweep, and platform access is written to the audit log.

---

### Phase 4 — Members

- Member CRUD with code allocation inside the insert transaction
- Search, filters, sorting, pagination, CSV export
- Status transitions with reason and audit
- Shares ledger and contributions, each posting its linked finance entry
- Member profile: summary figures, timeline, documents
- The members table, the member form, and the "Add member" quick action

**Exit:** a member can be registered with a name and a joining date and nothing else — no phone, no
national identity number, no email — and the profile renders correctly. 120 demonstration members
list, filter and search in under 300 ms.

---

### Phase 5 — Finance

- `lib/money.ts` with full unit-test coverage before anything uses it
- Categories, transactions, void and reversal, idempotency
- Summaries by day, week, month and custom range; category breakdown; trends
- CSV and Excel export
- Finance overview screen: money in, money out, balance; the ledger table; the record dialogs

**Exit:** a property test over a thousand random transactions shows the reported balance equals the
independently computed decimal sum; a voided transaction and its reversal both appear in history and
the balance returns to its prior value; a repeated `Idempotency-Key` creates exactly one row.

---

### Phase 6 — Products and inventory

- Products, categories, units, warehouses
- Receive, issue, adjust, transfer; reversal; movement history
- Conditional-update stock decrement; `StockLevel` rebuild command
- Low-stock scan job and de-duplicated notifications
- Stock overview, movement table, and the receive and issue quick actions

**Exit:** a concurrency test firing twenty simultaneous issues against a stock of ten leaves the
level at zero with ten successes and ten `INSUFFICIENT_STOCK` errors; rebuilding levels from the
movement history reproduces the stored levels exactly.

---

### Phase 7 — Buyers and sales

- Buyers with history and totals
- Sale draft, confirm, cancel; line items; discount and tax; payment recording
- Confirmation transaction: stock out, finance in, audit, all or nothing
- Printable receipt
- Sales list, sale form with product picker and live line totals, buyer profile

**Exit:** a forced failure injected at the last step of confirmation leaves no sale, no stock
movement and no finance row; cancelling a confirmed sale restores stock through compensating
movements rather than deletions.

---

### Phase 8 — Reports

- Seven report types with date filters and permission-composed sections
- Server-rendered PDF matching the print stylesheet; CSV and Excel export
- Report runs recorded, downloadable again, raising a notification when ready

**Exit:** the monthly cooperative report for the demonstration cooperative is generated, printed to
A4 and read on paper without a layout defect, in both languages.

---

### Phase 9 — Documents and meetings

- Upload with extension, MIME and magic-byte validation, size cap, checksum, random storage key
- Authenticated streaming download, preview for images and PDFs, categories, search, archive
- Meetings with agenda, attendance from the member list, decisions and minutes attachment

**Exit:** a document URL is unreachable without a session, unreachable from another cooperative, and
a disguised executable is rejected on upload.

---

### Phase 10 — Dashboard and insights

- KPI tiles, recent activity, needs attention, quick actions, all permission-filtered
- The four charts from `ui-system.md` §10 and nothing else
- Cooperative health: GOOD, WATCH or ATTENTION with a sentence naming the figures behind it

**Exit:** every dashboard figure is traceable to a query; a manager can state the cooperative's
position within ten seconds of the page loading; the dashboard is one API round trip.

---

### Phase 11 — Kinyarwanda completion

- Every namespace complete, reviewed by hand against the glossary, not machine-translated
- Terminology consistent across screens, reports and notifications
- Layout re-checked at every breakpoint with the longer strings
- Key-parity check enforced in CI

**Exit:** a full pass through every screen in Kinyarwanda finds no English string, no truncated
label and no awkward phrasing.

---

### Phase 12 — Notifications, announcements, SMS

- Notification centre with categories, dedupe, actions, read state
- Announcements: draft, publish, audience, history
- SMS abstraction with a mock provider that requires no credentials, a message log, and a
  production adapter interface

**Exit:** development runs with no SMS credentials; sending to fifty members produces fifty logged
messages and no duplicates; provider replacement touches exactly one file.

---

### Phase 13 — Offline resilience

- Connection indicator; persisted query cache; form drafts
- Retry only for `GET` and for mutations carrying an idempotency key
- The `IdempotencyKey` table honoured across finance, inventory and sales

**Exit:** with the network disabled mid-form, no input is lost and no duplicate financial record is
created when the connection returns.

---

### Phase 14 — Ask CoopManage

- A fixed catalogue of read-only query tools, each declaring its permission
- The tool set built per request from the caller's permissions
- Answers cite the figures and link to the screen; refusal when no tool fits
- No write tools

**Exit:** an adversarial prompt set cannot make the assistant produce a number absent from the
database or reach another cooperative's data.

---

### Phase 15 — Security hardening

Full review against `docs/security.md`: authentication, authorization, tenancy, uploads, validation,
rate limiting, CORS, headers, secrets, logging, injection, XSS, CSRF, access control, audit
coverage, dependency audit.

**Exit:** every finding is fixed or has a written, accepted risk note. No secret in the repository
history.

---

### Phase 16 — UX polish

Page-by-page review for consistency, spacing, typography, empty, loading and error states, mobile
layout, accessibility and form usability. Remove anything that looks generated. Optional dark theme
only if it can be done completely.

**Exit:** axe reports no violations; a full keyboard walkthrough of every critical flow succeeds;
the interface is internally consistent screen to screen.

---

### Phase 17 — Testing and quality assurance

Unit tests for money, stock, permissions, code allocation and report arithmetic. Integration tests
for every endpoint. End-to-end tests for the nine critical flows: login, create cooperative, add
member, record income, record expense, add product, receive stock, create sale, generate report.

**Exit:** all suites green, coverage meaningful on business logic rather than on generated code,
migrations verified from empty, and no known broken functionality.

---

### Phase 18 — Production preparation

Production environment variables, Supabase database and storage, migration deployment, seed
strategy, Vercel and Railway configuration, backup and restore procedure verified once, monitoring
and log retention, and the deployment runbook.

**Exit:** a clean deployment from an empty production database succeeds, the restore procedure has
actually been executed, and no secret is exposed.

---

## 3. Definition of done

The product is finished when core workflows work end to end, authentication and permissions hold,
tenant data is provably isolated, money and stock arithmetic is correct under concurrency, reports
generate and print, both languages are complete, the interface is responsive and accessible, errors
are handled in plain language, tests pass, the production build succeeds, documentation exists, the
security review is closed, and no placeholder remains in the interface.

Not when `npm run dev` works.
