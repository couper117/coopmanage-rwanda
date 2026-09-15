# CoopManage Rwanda — Feature Map and Development Roadmap

Status: **Phase 7 complete.** Phase 8 is next.

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
`glossary.md`, `security.md`, `deployment.md`, `roadmap.md`. Repository initialised, toolchain
versions pinned, and PostgreSQL 16 verified running with the three required extensions.

---

### Phase 1 — Project foundation ✅

Monorepo, both applications running, empty but real.

- npm workspaces; `apps/backend`, `apps/frontend`, `packages/shared`
- Strict TypeScript, ESLint, Prettier, pre-commit hook, shared `tsconfig.base.json`
- Zod-validated environment configuration; `.env.example`; the process refuses to boot on a bad value
- Docker Postgres on port 5435; Prisma initialised; migration **M1** creating the reference tables
  (`Permission`, `Role`, `RolePermission`, `CooperativeType`) and seeding them. Units of measure
  follow in Phase 2, because they reference the cooperative table. Table-to-phase mapping is fixed
  by `database.md` §15
- Express application: helmet, CORS allow-list, compression, request id, Pino logging, rate limiter,
  the response envelope, the error handler, `/health` and `/health/ready`
- React application: Vite, Tailwind with the full token set from `ui-system.md`, the router, the
  query client, the API client with the envelope and error mapping, the application shell with
  sidebar, top bar and page header, and the first ten design-system primitives
- i18next wired with English and Kinyarwanda namespace files, the language switcher, persistence,
  and the CI key-parity check

**Exit:** met. `npm run dev` starts both applications; the shell renders in English and
Kinyarwanda; readiness reports the database reachable with its latency; migrations apply to an
empty database and the seed is idempotent; the compiled server runs from `dist`; and lint,
typecheck, 109 tests and the production build are all green.

Two deviations from the plan, both recorded where they matter. The frontend runs on port 5175
because 5173 and 5174 belong to other projects on this machine. Prisma 7 requires a driver adapter
and a `prisma.config.ts`, which changed how the database URL reaches the client; this is written up
in `architecture.md` section 16.

---

### Phase 2 — Authentication, users, authorization ✅

- Argon2id hashing, login, refresh rotation with family revocation, logout, session list
- Forgot and reset password, single-use tokens, uniform responses, rate limits, progressive lockout
- `GET /auth/me` returning the effective permission set
- `authenticate`, `resolveCooperative`, `requirePermission` middleware; `req.ctx`
- Audit logging service and the first entries; append-only enforcement
- Login screen, protected routes, `PermissionGate`, `usePermission`, profile screen, session expiry
  handling with silent refresh

Migration **M2** creates `User`, `RefreshSession`, `PasswordResetToken`, `Cooperative`,
`CooperativeStaff`, `StaffPermissionOverride`, `AuditLog` and `UnitOfMeasure`, and the seed gains
the twelve system units, a platform administrator and the demonstration cooperative — _Umurenge
Farmers Cooperative_ in Musanze, with a member of staff in each of the five cooperative roles.

**Exit:** met. The five permission suites in `permissions.md` §7 pass, along with 253 tests in
total; a viewer is refused every endpoint their role does not cover; lint, typecheck and the
production build are green; the migrations apply to an empty database and the seed is idempotent
across two consecutive runs; and the login, profile and audit screens were reviewed in both
languages at 1440px and 390px, driven by keyboard alone, with no horizontal overflow and a visible
focus ring on every control.

Four things are worth recording, because each changed a decision.

**The audit trail is append-only in the database, not only in the application.** A trigger refuses
`UPDATE` and `DELETE` on `audit_log`, so there is no code path — and no mistake — that can rewrite
history. It raises on the default `P0001`: the first version used `restrict_violation`, which
Prisma maps to "foreign key constraint violated" and which therefore said nothing about what had
been refused.

**Refresh rotation claims the presented token with a conditional update.** Reading the row, checking
`replaced_by_id` and then acting on it is a check followed by an act: two requests carrying the same
token both passed the check and both minted a replacement, leaving several live tokens in one
family with the reuse undetected. This was found by looking at the running application, not by a
test. The claim is now `UPDATE ... WHERE replaced_by_id IS NULL AND revoked_at IS NULL`, which takes
a row lock, and a concurrency test asserts that exactly one of five simultaneous refreshes wins.

**Strict rotation has a consequence worth naming before Phase 15.** Two browser tabs waking at the
same moment both hold the same cookie; one rotation wins and the other is treated as a replay, which
by design revokes the family and signs the user out. The client is single-flight per tab, so this
needs two tabs to reach. Adding a short grace window during which a just-rotated token returns its
replacement would remove the sharp edge, and is a deliberate deviation from `database.md` §3 rather
than a bug fix, so it belongs to the security review rather than here.

**Password reset has no delivery channel yet.** The token lifecycle is complete — single use, sixty
minutes, uniform responses — and delivery goes through one named port in `auth.delivery.ts`. Outside
production the link is written to the server log, which is how a developer completes the flow. In
production, with no channel configured, the attempt is recorded as a warning and the link is never
logged. Phase 12 brings SMS and with it the first real channel.

---

### Phase 3 — Cooperatives, staff, tenancy ✅

- Cooperative creation, profile, logo, settings; cooperative types
- Staff invitation, role assignment, deactivation, permission overrides
- Tenant resolution end to end; the cooperative switcher for multi-cooperative users
- Platform administration: cooperative list, create, suspend; platform user management
- The cross-tenant test harness, seeded with two cooperatives

Migration **M3** creates `CooperativeSetting` and `SystemSetting`, and the settings catalogue in
`packages/shared/src/settings.ts` declares every key either may hold, so neither table can become
an arbitrary JSON dump.

**Exit:** met. The cross-tenant sweep in `apps/backend/test/tenancy.test.ts` is driven from the
route registry, so a route added in a later phase is swept the moment it is registered; a route
carrying a path parameter must be accounted for in one of its two tables or the build fails. It
proves that Cooperative A's manager gets `403 NO_COOPERATIVE_ACCESS` on every tenant-scoped route
when the header names Cooperative B, `404 NOT_FOUND` for every one of B's identifiers from inside
A, and the same answer for an identifier that never existed as for one belonging to B. Every
`/admin` route answers `404` to an ordinary manager. A platform administrator reaching into a
cooperative writes `platform.tenant_access` to the audit log and still cannot write anything there.

Four things are worth recording, because each one changed a decision or fixed a real defect.

**Creating a cooperative did not let its manager in.** The transaction created the cooperative, the
account and the membership, with a random password nobody knew and no way to set one. A test caught
it, and the reset-link logic is now one function, `issuePasswordSetupLink`, shared by cooperative
creation, platform user creation and staff invitation, because all three create an account for
somebody else.

**Prisma 7 reports a unique violation somewhere new.** The constraint name moved from `meta.target`
to `meta.driverAdapterError.cause.constraint.index`, so a duplicate registration number surfaced as
an opaque 500 instead of a 409. `lib/dbErrors.ts` now walks the metadata rather than reading one
path, and pins both shapes in a unit test.

**The phone validator rejected the way people write phone numbers.** `+250 788 123 456` failed
because of where the spaces fell. Separators are now stripped before the digits are checked, and
every number is stored as `+250788123456`. This lives in `packages/shared/src/phone.ts` because
Phase 4 needs exactly the same rule for members, where a phone number is optional.

**A cooperative can never be left unadministrable.** Demoting or deactivating the only active
manager is refused, and nobody may change their own role or status. The platform has the same rule
for its own administrators. Each one is a 409 with a message that says what to do instead.

---

### Phase 4 — Members ✅

- `lib/money.ts` with full unit-test coverage, and migration **M4** including the finance tables,
  because a contribution posts a linked income row. Nothing writes a monetary value before the
  money module is proven
- Member CRUD with code allocation inside the insert transaction
- Search, filters, sorting, pagination, CSV export
- Status transitions with reason and audit
- Shares ledger and contributions, each posting its linked finance entry
- Member profile: summary figures and timeline. The blocks whose tables arrive later appear when
  they do: quantity supplied in Phase 6, attached documents in Phase 9. Until then the profile
  names them as not yet available rather than showing a zero
- The members table, the member form, and the "Add member" quick action
- The cooperative-wide contributions ledger, with the filtered total and the cancellation path

**Exit:** met, and verified against the running system rather than only in tests. A member
registered with nothing but two names came back as `UMU-00122` with a null phone, national identity
number and email, today's joining date and `ACTIVE` status, and the profile rendered. Against 121
demonstration members every query is between 44 ms and 58 ms measured end to end, including
authentication, against a 300 ms budget: the unfiltered list, a name search, a search on phone
digits, the no-phone filter, the statistics tiles, a sort by member code and the contributions
ledger. A contribution of 7,500.50 took the cooperative's total from 1,792,500.00 to 1,800,000.50,
and voiding it wrote reversal `EX-2026-000001` and returned the total to exactly 1,792,500.00. An
amount of `100.005` is refused with 422 rather than rounded. `DELETE /members/:id` answers 404
because the route does not exist.

Six things are worth recording, because each one changed a decision or fixed a real defect.

**The whole test suite was failing about a third of the time, and the cause was not in the
product.** Failures were scattered and never reproduced: a 403 where a 401 belonged, a 400 in place
of a 409, an occasional socket hang up, each in a different file on each run. Supertest binds a
fresh ephemeral port for every single request and closes it once the response arrives, and with
thirteen files in parallel worker processes that is thousands of bind and close cycles a second
against the same port range. A probe of six workers each making 1,500 requests to the public
`/health` route returned a **401**, a status that route cannot produce — the connection had been
delivered to a different worker's server. `apps/backend/test/server.ts` now holds one listener open
for the lifetime of each file. Twelve consecutive full runs are clean and the suite is twice as
fast.

**Argon2 at production cost starved the suite of CPU.** Nineteen mebibytes and three passes per
hash, several hundred sessions, thirteen worker processes, eight cores: enough contention to push
unrelated tests past a five-second timeout. The cost drops to the library minimum under
`NODE_ENV=test` only, and `password.test.ts` pins the parameters used everywhere else so the
reduction cannot reach a deployment unnoticed. Recorded in `security.md` §2.

**Emptying the audit trail cannot be done per test file.** The append-only trigger is what makes
the trail append-only, and `audit.test.ts` asserts it is active; removing rows means switching the
trigger off, which changes the table for every connection. Doing it outside a transaction left a
window in which another file's append-only assertion passed straight through; doing it inside one
made the access-exclusive lock block every other worker's audit write, which turned into
sixty-second hook timeouts elsewhere. Destructive cleanup now runs once after the whole suite, in
`apps/backend/test/purge.ts`, which is also what `npm run db:purge-test-data` calls, so there is one
definition of what counts as test data.

**An exit date could be omitted by writing it as null.** `status: EXITED` with no `exitedOn` was
refused, but `exitedOn: null` passed the check and the service filled in today. The register would
then say a member left today when they left in March, which is exactly the figure a dispute over an
old contribution turns on. The rule now requires an actual date.

**An audit sentence in Kinyarwanda contained English.** The trail stores a message key and its
parameters, but an enum among those parameters is a value, so `SAVINGS` landed in the middle of a
Kinyarwanda sentence. The backend now sends enum parameters as keys — `members.contributions.type.SAVINGS`
— and the interface resolves any parameter that names a namespace, leaving names, amounts and
references untouched.

**Adding and editing a member are dialogs, not routes.** A secretary registering people at a
meeting adds several in a row, and a dialog keeps the list, the filters and the place in it. The
deviation from the planned `/members/new` route is recorded in `api.md` §3.

Two things are deliberately left for later. Recording and voiding a share movement has no interface
yet: the endpoints exist and are tested, and the controls belong with the member profile's shares
panel rather than with the finance screens, so they are listed against Phase 16's pass over the
member profile. And the built frontend bundle is now 699 kB, 210 kB gzipped, in a single chunk; on
the connections this product is used over that wants route-level code splitting, which is listed
against Phase 16.

---

### Phase 5 — Finance ✅

- Categories, transactions, void and reversal, idempotency, all on the M4 tables
- Summaries by day, week, month and custom range; category breakdown; trends
- CSV and Excel export
- Finance overview screen: money in, money out, balance; the ledger table; the record dialogs
- Categories seeded per cooperative type when a cooperative is created, each with its Kinyarwanda
  name, so a treasurer can record the first morning's takings without inventing a filing system
- Demonstration ledger entries, because an overview with no expenses reads as broken rather than
  as empty

**Exit:** a property test over a thousand random transactions shows the reported balance equals the
independently computed decimal sum; a voided transaction and its reversal both appear in history and
the balance returns to its prior value; a repeated `Idempotency-Key` creates exactly one row.

All three are met and were checked against the running system as well as in tests. The property
test sums a thousand entries with awkward centimes in integer centimes, deliberately not with the
same decimal library the implementation uses, and compares that against the summary endpoint, the
twelve monthly buckets and the ledger footer. Live: one retry key sent twice returned
`EX-2026-000037` both times and left one row; voiding 99,999.99 francs took the balance from
1,582,999.75 to 1,482,999.76 and back to 1,582,999.75 exactly.

Four more things are worth recording.

**A member could not be named on a payment, so a Phase 4 screen was dead.** The ledger accepted a
`memberId` from the first day and nothing could ever send one: the register is hundreds of
server-searched people and no control existed for choosing one. The payments block on a member's
profile could therefore never be anything but nil, and the timeline declared a `PAYMENT` case
nothing produced. `components/ui/SearchSelect.tsx` is the picker that was missing — a combobox over
a list too long for a `<select>`, keyboard-complete, with no portal so it cannot escape a dialog on
a phone. Recording money out now names the member, the profile shows the figure, and the timeline
shows when. The demonstration cooperative pays twelve members individually so both are visible
without anybody typing an entry first.

**The demonstration books needed a correction in them.** Every finance screen says something about
a cancelled entry: the status column, the two columns naming what corrects what, the muted row, the
totals that count neither side. With nothing voided in the demonstration data none of that is
visible, and a manager judging the software cannot see that a mistake is recoverable. The seed now
writes one duplicate contribution and cancels it through `voidTransaction`, the same function the
API uses, rather than writing the two rows itself.

**The chart is drawn without a library, and without a float.** No charting package is installed and
the content-security policy does not allow one from a CDN, so the movement panel is bars in a grid
with a real table of the same figures beside it. Heights come from converting each decimal string
to an exact `bigint` of minor units and dividing by integers to a tenth of a percent, so no amount
passes through a float and no figure the reader sees comes from that arithmetic at all.

**Two React rules were worth obeying rather than silencing.** The picker held its highlight as a
list position, which needed an effect to correct whenever the options changed — so it holds the
highlighted option's value instead and looks it up in whatever the list holds now. The record
dialog cleared its member in an effect on opening; it clears on closing instead, through the one
function every close path already goes through.

**A void was applied twice, and the tests caught it before anything else did.** The balance excluded
a voided row _and_ counted the reversal written to correct it, so cancelling one receipt of 1,000
francs took 2,000 francs off the books. Every figure the module reports now excludes the pair —
`status = 'POSTED' AND reversal_of_id IS NULL` — which is also the honest answer for a period
report, because a receipt that was cancelled is not money the cooperative received that month. One
constant, `COUNTS_TOWARDS_TOTALS`, with the reasoning beside it, and the member profile's payments
figure was carrying the same defect.

---

### Phase 6 — Products and inventory ✅

- Products, categories, units, warehouses
- Receive, issue, adjust, transfer; reversal; movement history
- Conditional-update stock decrement; `StockLevel` rebuild command
- `Notification` table (M6) and the low-stock scan job writing de-duplicated notifications. The
  notification centre itself is Phase 12; this phase only writes the rows
- Stock overview, movement table, and the receive and issue quick actions
- Stock valuation at weighted average cost, behind both the stock and the money permission
- A demonstration catalogue and store: ten products across two stores, a season of member
  deliveries, sales, a count that disagreed and two transfers

**Exit:** both met. Twenty simultaneous issues against a stock of ten produce exactly ten movements
and ten `INSUFFICIENT_STOCK` refusals, and leave the level at zero — never negative, never a sack
issued twice. Rebuilding the levels from the movement history reproduces every stored level
exactly, proved both on a test database full of movements and against the seeded demonstration
store, where `npm run inventory:rebuild` reports ten levels all agreeing with their history. A
level tampered with directly in the table is found and, with `--apply`, put back.

Five things are worth recording.

**The refusal deliberately says nothing about what is there.** When an issue is refused the server
does not report the level, because the figure the caller read a moment ago may already be stale and
quoting it back would invite a retry with exactly that number. The screen that receives the refusal
therefore re-reads the level and reports what is there now, which is the one place in the interface
where a refusal triggers a fetch rather than a message.

**The overview and the warnings gave two different answers to the same question.** The stock screen
marked a row low by comparing one store's quantity against the product's minimum, while the
low-stock watch summed across stores — so the overview said three products were short and only two
warnings existed. The minimum means "we want at least this much of it", so both now compare the
total across every store, and a row carries its own quantity and the cooperative-wide figure side
by side. Holding eight tonnes of potatoes at the collection point is not being short of potatoes.

**A low-stock alert never escalated.** A product that fell below its minimum raised a warning, and
when the shelf later went empty the unique dedupe key meant nothing happened: the alert stayed at
"low" while the cooperative could no longer sell at all. The watch now escalates the severity and
resurfaces the alert as unread, but only when it has genuinely got worse — never on every movement.

**The adjustment takes what was counted, not the difference.** A storekeeper counts eight sacks and
types eight. Asking them to work out that the record said ten and the correction is two out is how
the wrong sign gets recorded, and a database check constraint enforces the reason as well, because
an unexplained correction is what makes a shortfall unauditable.

**A check constraint caught the seed within a minute of being written.** The demonstration store
built its levels with one upsert for both directions, inserting a negative candidate row for an
outward movement. PostgreSQL evaluates a check constraint on the candidate row before the conflict
resolves, so it was refused. The seed now uses the application's own two stock operations, which
means the demonstration store is built by exactly the code a storekeeper's receipt goes through.

---

### Phase 7 — Buyers and sales ✅

- Buyers with history and totals
- Sale draft, confirm, cancel; line items; discount and tax; payment recording
- Confirmation transaction: stock out, finance in, audit, all or nothing
- Printable receipt
- Sales list, sale form with product picker and live line totals, buyer profile
- Sales summary with the top buyers and the top products over a period

**Exit:** both met, and both with real failures rather than injected ones. A payment against a
category that does not exist fails at the last step of confirmation, after the stock has come out
and the movements have been written: the sale is still a draft, the level is untouched, no movement
and no finance row exists, and the rebuild command confirms the history still adds up to the
levels. A two-line sale whose second line is short leaves the first line's stock where it was, which
is the same property seen from inside the transaction rather than at the end of it. Cancelling a
confirmed sale writes a `SALE_RETURN` per line and reverses the income, and the demonstration data
carries one cancelled sale whose four movements — two out and two back — are all visible in the
history.

Four things are worth recording.

**The receipt is the first screen built for paper rather than for a browser.** A cooperative's
dealings with a buyer end up in a file, so the print stylesheet the documentation had specified
since Phase 0 was finally written: the shell is removed, the text is black on white, the state of
the sale is words rather than a coloured badge, the table header repeats across pages, and the
footer names the cooperative, the document, the sale and who produced it. The application chrome is
marked `data-print="hide"` rather than left for a selector to guess at, so a screen added later
inherits the behaviour without asking. Every figure on it is printed exactly as the server sent it,
which is the only reason a buyer can be handed one and told it is what the records say.

**A cancelled sale was reporting money still owed.** `outstanding` was the total less what was
paid, and cancelling resets the paid figure to nil, so a sale that had been undone showed its whole
value as outstanding. A treasurer scanning that column would have chased a buyer for business that
never happened. It reports nil now, while keeping the total, because what the sale was worth is
still a fact a period report needs.

**A sale payment could be voided from the finance ledger.** The refusal that already covered a
contribution and a share purchase did not cover a sale or a stock receipt, so the ledger side could
be reversed on its own and leave the sale claiming a payment the books no longer held. All four
sources now send the correction back to the record it came from.

**The demonstration data was taking the same stock twice.** The store seed recorded an issue "sold
to the district buyer" and the sales seed then recorded the sale, so the maize left twice. The sales
seed now runs through the application's own service functions — a confirmed sale really does take
the stock and post the income — and the issues that were really sales are gone from the store data.
Every sale state is represented on purpose: paid, part paid, cancelled and still a draft, because a
list where everything is confirmed hides three badges and the cancel reason entirely.

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
- The three charts and one low-stock list from `ui-system.md` §10, and nothing else
- Cooperative health: GOOD, WATCH or ATTENTION with a sentence naming the figures behind it
- Global search across members, products, buyers, sales, documents and meetings, with results
  filtered per resource against the caller's permissions before ranking

**Exit:** every dashboard figure is traceable to a query; a manager can state the cooperative's
position within ten seconds of the page loading; the dashboard is one API round trip; searching a
member name returns that member and their related records, and returns nothing the caller may not
see.

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

Route-level code splitting belongs here too, because on the connections this product is used over
the size of the first download is a usability problem rather than a technical one. It was 210 kB
gzipped in one chunk at the end of Phase 4, and every phase adds to it.

**Exit:** axe reports no violations; a full keyboard walkthrough of every critical flow succeeds;
the interface is internally consistent screen to screen; no route pulls down markedly more than it
needs.

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
strategy, Vercel and Railway configuration, `scripts/backup-db.mjs` with the restore procedure
executed once for real, monitoring and log retention, and the deployment runbook.

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
