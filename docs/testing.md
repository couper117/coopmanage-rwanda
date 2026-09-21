# CoopManage Rwanda — Testing

Status: **Phase 17 complete.** How the product is tested, what the suites prove, and what they do
not.

---

## 1. The shape of it

Three suites, one per workspace, all on Vitest, all run by `npm test` from the root and by CI on
every push.

| Suite      | Where                  | Against                           | Count at Phase 17 |
| ---------- | ---------------------- | --------------------------------- | ----------------- |
| `shared`   | `packages/shared/test` | pure functions                    | 81                |
| `backend`  | `apps/backend/test`    | the HTTP API on a real PostgreSQL | 770               |
| `frontend` | `apps/frontend/test`   | screens in jsdom, network stubbed | 516               |

**The backend suite is integration testing throughout.** Every test sends real HTTP through
Supertest to the real application, and the application talks to a real PostgreSQL. Nothing is
mocked below the network. The things worth testing on a server like this — that two people
registering a member at the same moment get different codes, that a sale's payment lands in the
ledger in the same transaction, that a row from another cooperative is not found — are properties of
transactions and constraints, and a mock of the database would test the mock. `test/server.ts`
explains the one listener per file; `test/purge.ts` explains how a run cleans up after itself
without touching anything a developer made by hand.

**The frontend suite renders the real screens with the real router and the real translations**,
and stubs only `fetch`. A test that types into the member form is running the same component,
validation and API client a browser would; only the answer from the server is scripted.

---

## 2. What is proven

### Every endpoint has a test

The route registry records every route the application exposes, and since Phase 17 it also
records every response a route sends during the suite (`observeRoutes`, installed by the tests
only). The global teardown compares the two and **fails the run naming any route no test reached
with a successful response** — a 401 from the guard or a 404 from the cross-tenant sweep proves a
route is mounted, not that it works. `test/routeCoverage.ts` is the mechanism; the number at the
end of a run reads `every one of the 144 routes was exercised by a passing test`. Filtered runs
(`vitest run test/members.test.ts`) skip the check, since they cannot have reached everything.

### Every parameterised route is swept for cross-tenant access

`test/tenancy.test.ts` calls every route with an `:id` using an identifier that belongs to another
cooperative, and expects a 404. A route added without being declared to the sweep fails the build.
This is the test behind the rule that a wrong tenant is not found rather than refused.

### The nine critical flows, end to end

`test/e2e.test.ts` tells one story through the API: the platform creates a cooperative, its manager
sets a password from the link and signs in, registers a member, records a membership fee and a
transport expense, adds a product, receives a delivery, writes up a sale, confirms it with a part
payment and settles the balance a week later, and prints the month's report — and every figure on
that report is checked against what the steps before it did. The other suites test each module
against itself; this one tests the joins.

It found two things on its first run. A cooperative created through the platform gave its members
codes beginning `COOP-`, the column's default, rather than its own code; and the categories a
cooperative starts with were not what the flow expected, which was the flow's mistake and not the
product's.

### Money, stock and allocation under concurrency

- `test/money.test.ts` — parsing, rounding and arithmetic on decimal strings; nothing is ever a
  float.
- `test/references.test.ts` — forty simultaneous member registrations get forty consecutive
  codes; thirty simultaneous postings get thirty different receipt numbers; counters restart each
  January and are per cooperative.
- `test/inventory.test.ts` "twenty people reaching for ten sacks" — twenty simultaneous issues
  against ten units resolve to ten issued and ten refused, never eleven.
- `test/sales.test.ts` "a failure part way through confirmation" — a confirmation that fails after
  the stock has moved leaves no stock moved and no money recorded.

### Permissions, on the server

`test/permissions.test.ts` and each module's own tests assert that a role without a permission is
refused by the API, whatever the interface would have shown. `packages/shared/test/roles.test.ts`
transcribes the role matrix from `docs/permissions.md` and fails when the code and the document
disagree.

### Report arithmetic

`test/reports.test.ts` compares every figure a report prints against the screen it was produced
from — the same rows, read by the same queries — and reads the PDF back to assert the figures are
on the paper, in the language asked for.

### Both languages, complete

`scripts/translations/check.mjs` and `test/kinyarwanda.test.tsx` fail on a key present in one
language and not the other, a placeholder renamed in one, a count without a singular form, or a
Kinyarwanda string that is a copy of the English.

### Accessibility and the keyboard

`test/axe.test.tsx` runs axe-core over 24 screens and two open dialogs; `test/keyboard.test.tsx`
walks the critical flows with Tab, Enter, Space and Escape and never a click. `docs/ui-system.md`
§9 has the detail.

### Migrations, from nothing

`npm run check:migrations` creates a throwaway database beside the development one, runs every
migration into it as a deployment would, compares what they built against `schema.prisma`, runs
the seed, and drops it. It never touches the database in `DATABASE_URL`; that is why it exists
instead of `prisma migrate reset`, which proves the same thing by destroying a developer's data.
CI runs it on every push.

---

## 3. Coverage

Measured with V8 through `npm run test:coverage`, on the business logic and nothing else. A
percentage across route wiring, generated code and JSX flatters the figure, so those are not
counted, and the thresholds are a floor under what Phase 17 measured rather than a target: a phase
that ships a service nobody tests fails the build instead of lowering the average.

| Workspace  | Measured on                                                           | Statements | Branches | Functions | Lines | Floor (S/B/F/L) |
| ---------- | --------------------------------------------------------------------- | ---------- | -------- | --------- | ----- | --------------- |
| `shared`   | everything                                                            | 100%       | 96%      | 100%      | 100%  | 90/80/90/90     |
| `backend`  | `src/lib/**`, every `*.service.ts`                                    | 90%        | 77%      | 96%       | 93%   | 85/70/90/88     |
| `frontend` | `src/lib`, `src/stores`, `src/hooks`, `src/i18n/*.ts`, `src/app/*.ts` | 84%        | 82%      | 82%       | 88%   | 80/70/80/80     |

The lowest service on the backend is the catalogue at 79% of statements; what is uncovered there
is mostly the fallback branches behind pre-checks — a unique violation the pre-check already
refused — which Phase 17 closed where it was a real path (duplicate SKUs, category names and store
codes, all now refused by name).

---

## 4. What the Phase 17 pass changed in the product

Writing a test for every endpoint is a review of every endpoint, and it found five things:

1. **A cooperative created through the platform numbered its members `COOP-00001`.** The prefix
   now defaults to the cooperative's own code, cut to fit, and can still be changed in settings.
2. **Editing a document lower-cased its tags but did not de-duplicate them**, where an upload did
   both. Both paths now share one rule.
3. **Two root product categories could share a name.** The unique index includes `parent_id`, and
   SQL treats every NULL as distinct. Migration M17 adds a partial unique index for the root.
4. **A typed product code or store code was compared case-sensitively**, so `cherry-a` slipped past
   `CHERRY-A`. Codes are upper-cased on input, as the generated ones always were.
5. **The global search's buyer, sale, document and meeting results had never been asserted on.**
   They work; they are now tested.

---

## 5. What is not tested, and how it is covered instead

- **A real browser.** The frontend suite runs in jsdom, which has no layout: nothing has a size,
  a colour or a scroll position. Contrast is measured in `docs/ui-system.md` §2; responsive
  layouts are asserted by the classes applied at each breakpoint; and a walkthrough of the critical
  flows in a browser, with a screen reader, is step 6 of the release procedure in
  `docs/deployment.md` §3.
- **A real SMS gateway or e-mail.** Both are behind driver interfaces with a credential-free
  driver the tests use; `docs/announcements-and-sms.md` describes what a live driver has to do.
- **Load.** The concurrency tests prove correctness under contention, not throughput. Phase 18
  measures the latter.

---

## 6. Running it

```
npm test                       # every suite
npm run test -w @coopmanage/backend -- test/sales.test.ts   # one file (skips the route gate)
npm run test:coverage          # with coverage, enforcing the floors
npm run check:migrations       # migrations from an empty database
npm run check:translations     # both languages complete
npm run check:audit            # dependency advisories
```

The backend suite needs the development database up (`docker compose up -d`). It creates what it
needs under `@example.test` addresses and a `test-` tag, and removes all of it at the end; a run
that is interrupted can be cleaned with `npm run purge-test-data -w @coopmanage/backend`.
