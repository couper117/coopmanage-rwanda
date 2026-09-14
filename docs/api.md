# CoopManage Rwanda — API Design

Base URL: `/api/v1`. JSON in, JSON out, UTF-8.
Status: **Phase 0 baseline.** Each endpoint is delivered in the phase noted in the tables.

---

## 1. Conventions

### Headers

| Header                                | Required                                        | Purpose                                    |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| `Authorization: Bearer <accessToken>` | all but public routes                           | Identifies the user                        |
| `X-Cooperative-Id: <uuid>`            | all tenant-scoped routes                        | Selects the active cooperative             |
| `Accept-Language: en \| rw`           | optional                                        | Language for server-rendered text and PDFs |
| `Idempotency-Key: <uuid>`             | optional, honoured on money and stock mutations | Safe retries                               |
| `X-Request-Id`                        | optional                                        | Echoed back and written to every log line  |

The refresh token travels only as an `HttpOnly` cookie on `/api/v1/auth/refresh` and
`/api/v1/auth/logout`.

### Response envelope

Success:

```json
{ "data": {}, "meta": {} }
```

Collection:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 25, "total": 342, "totalPages": 14, "sort": "-createdAt" }
}
```

Error:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "messageKey": "errors.inventory.insufficientStock",
    "messageParams": { "product": "Ibirayi", "available": "120.000", "requested": "500.000" },
    "message": "Not enough stock for Ibirayi. Available: 120 kg, requested: 500 kg.",
    "details": [{ "field": "items.0.quantity", "messageKey": "validation.max" }],
    "requestId": "01J9..."
  }
}
```

`message` is a fallback rendered in the request language. Clients display the translation of
`messageKey` with `messageParams` and fall back to `message` only for keys they do not know.

### Money and quantities on the wire

Always **strings**, never JSON numbers: `"amount": "250000.00"`, `"quantity": "1240.500"`. Inputs
accept a string or a number and are parsed with `Decimal`; a value with more decimal places than the
column allows is a validation error rather than a silent rounding.

Dates are ISO: `"2026-09-09"` for accounting dates, RFC 3339 with offset for timestamps.

### Collection parameters

| Parameter          | Example                                                       | Notes                                               |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| `page`, `pageSize` | `?page=2&pageSize=50`                                         | Default 25, maximum 100. Offset paging for tables   |
| `cursor`           | `?cursor=eyJ...`                                              | Cursor paging on audit log and activity feeds       |
| `sort`             | `?sort=-occurredAt,reference`                                 | Leading `-` is descending. Allow-listed fields only |
| `q`                | `?q=Jean`                                                     | Free-text search, trigram matched                   |
| filters            | `?status=ACTIVE&from=2026-01-01&to=2026-03-31&categoryId=...` | Per-resource, all validated                         |
| `include`          | `?include=member,category`                                    | Allow-listed relations only                         |

Unknown query parameters are rejected rather than ignored, so a typo in a filter never silently
returns unfiltered data.

### Status codes

`200` read or update, `201` create, `204` delete or archive with no body, `400` malformed request
(code `MALFORMED_REQUEST`, distinct from the field-level `422 VALIDATION_FAILED`),
`401` unauthenticated, `403` authenticated but not permitted, `404` not found **or wrong tenant**,
`409` conflict (duplicate code, idempotency reuse, state transition not allowed),
`422` validation failed, `429` rate limited, `500` internal.

### Error codes

`VALIDATION_FAILED`, `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`,
`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`,
`FORBIDDEN`, `NO_COOPERATIVE_ACCESS`, `NOT_FOUND`, `DUPLICATE_RESOURCE`, `CONFLICT`,
`INSUFFICIENT_STOCK`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`, `FILE_TOO_LARGE`,
`UNSUPPORTED_FILE_TYPE`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

### Rate limits

The two authentication limits are deliberately asymmetric. The per-email limit is what protects an
account, and it is tight. The per-IP limit is loose, because a cooperative office is one internet
connection shared by all its staff: a tight per-IP limit means the fourth person to sign in that
morning cannot, and neither can anyone else until the window passes. A limit that locks a
cooperative out of its own records is not security, it is an outage.

Limits apply to the whole API rather than being opted into per route, so an endpoint added later is
covered without anyone remembering to enable it. The limit follows the request method; an endpoint
needing something tighter adds its own on top. Liveness is exempt, because a hosting platform polls
it continuously and it touches nothing. Readiness is **not** exempt, because it opens a database
connection and an anonymous caller must not be able to drive unbounded queries against the pool.

| Scope                        | Limit                                                |
| ---------------------------- | ---------------------------------------------------- |
| `POST /auth/login`           | 5 per 15 min per email, 60 per 15 min per IP         |
| `POST /auth/forgot-password` | 3 per hour per email, 30 per hour per IP             |
| Mutating endpoints           | 60 per minute per user                               |
| Read endpoints               | 300 per minute per user                              |
| File upload                  | 20 per hour per user                                 |
| `POST /assistant/ask`        | 20 per hour per user and 200 per day per cooperative |
| `POST /sms/send`             | 10 per hour per cooperative                          |

### Safe retries

A treasurer on a slow connection presses "Record", the page hangs, and they press it again. Without
help from the server the cooperative's books now hold the same 50,000 francs twice and somebody has
to work out which of two identical entries is real.

The client sends `Idempotency-Key` with a value it holds for the life of one attempt. The first
request through claims the key and does the work; a repeat of the **same** request gets the first
one's response back, with the same status, without doing the work again. A **different** request
reusing the key is a client bug that would otherwise be answered with somebody else's receipt, so it
is refused with `409 IDEMPOTENCY_KEY_REUSED`. A repeat that arrives while the first is still running
is `409`, because answering would mean guessing what the first will return. A key is honoured for
24 hours and is scoped to the cooperative, so two cooperatives cannot collide.

Sending **no** key is not the same as sending one. Without a key a second identical request records
a second entry, and that is deliberate: two members paying the same amount for the same thing on the
same day is ordinary, and swallowing the second would lose real money.

Honoured on `POST /finance/transactions` and `POST /finance/transactions/:id/void` from Phase 5, and
on the stock and sales mutations as those phases land.

---

## 2. Endpoint map

Every row lists the permission the backend enforces. `—` means public or self-scoped.

### Authentication and session — Phase 2

| Method | Path                    | Permission | Notes                                           |
| ------ | ----------------------- | ---------- | ----------------------------------------------- |
| POST   | `/auth/login`           | —          | Returns access token, user, memberships         |
| POST   | `/auth/refresh`         | —          | Rotates refresh cookie                          |
| POST   | `/auth/logout`          | —          | Revokes the session family                      |
| GET    | `/auth/me`              | —          | User, active cooperative, effective permissions |
| PATCH  | `/auth/me`              | —          | Own name, phone, locale                         |
| POST   | `/auth/change-password` | —          | Requires current password                       |
| POST   | `/auth/forgot-password` | —          | Always `204`, never reveals existence           |
| POST   | `/auth/reset-password`  | —          | Single-use token                                |
| GET    | `/auth/sessions`        | —          | Own active sessions                             |
| DELETE | `/auth/sessions/:id`    | —          | Sign out one device                             |

### Cooperative and staff — Phase 3

| Method | Path                         | Permission                    |
| ------ | ---------------------------- | ----------------------------- |
| GET    | `/cooperatives/mine`         | — (memberships of the caller) |
| GET    | `/cooperatives/current`      | `cooperative:view`            |
| PATCH  | `/cooperatives/current`      | `cooperative:update`          |
| POST   | `/cooperatives/current/logo` | `cooperative:update`          |
| GET    | `/cooperative-types`         | —                             |
| GET    | `/settings`                  | `cooperative:view`            |
| PUT    | `/settings/:key`             | `settings:manage`             |

`:key` is not free text. Both settings endpoints validate against the catalogue in
`packages/shared/src/settings.ts`, which declares every key a cooperative may set, the shape of its
value and its default. An unknown key is a `422`, and `GET /settings` always returns the complete
object with defaults filled in, so a screen reading a setting never has to know whether anyone has
saved it. The same holds for `/admin/settings/:key`.

Cooperative keys today: `enabledModules`, the optional modules this cooperative uses. Platform keys
today: `defaultCooperativeLocale`. The catalogue grows when a phase needs a key; a setting is added
only once something reads it.

| GET | `/staff` | `staff:view` |
| POST | `/staff/invite` | `staff:invite` |
| PATCH | `/staff/:id` | `staff:manage` |
| POST | `/staff/:id/deactivate` | `staff:manage` |
| GET | `/roles` | `staff:view` |
| GET | `/permissions` | `staff:view` |
| GET | `/staff/:id/overrides` | `staff:view` |
| PUT | `/staff/:id/overrides` | `staff:manage` |

### Members — Phase 4

| Method | Path                                | Permission                                     |
| ------ | ----------------------------------- | ---------------------------------------------- |
| GET    | `/members`                          | `members:view`                                 |
| POST   | `/members`                          | `members:create`                               |
| GET    | `/members/:id`                      | `members:view`                                 |
| PATCH  | `/members/:id`                      | `members:update`                               |
| POST   | `/members/:id/status`               | `members:deactivate`                           |
| GET    | `/members/:id/summary`              | `members:view`, sections composed (see below)  |
| GET    | `/members/:id/timeline`             | `members:view`, entries filtered by permission |
| GET    | `/members/stats`                    | `members:view`                                 |
| GET    | `/members/export`                   | `members:export`                               |
| GET    | `/members/:id/shares`               | `shares:view`                                  |
| POST   | `/members/:id/shares`               | `shares:manage`                                |
| POST   | `/members/:id/shares/:shareId/void` | `shares:manage`                                |
| GET    | `/members/:id/contributions`        | `contributions:view`                           |
| POST   | `/members/:id/contributions`        | `contributions:create`                         |
| GET    | `/members/form-options`             | `members:view`                                 |
| GET    | `/contributions`                    | `contributions:view`                           |
| POST   | `/contributions/:id/void`           | `contributions:void`                           |

`GET /members` filters: `q`, `status`, `position`, `gender`, `district`, `sector`, `joinedFrom`,
`joinedTo`, `hasPhone`. `/members/:id/summary` returns the figures behind the member profile, and each
block is gated separately by the rule in `permissions.md` §4: shares need `shares:view`,
contributions need `contributions:view`, payments received need `finance:view`, quantity supplied
needs `inventory:view` and attached documents need `documents:view`. Blocks the caller may not
see are omitted, and the payload names which ones were withheld so the interface can say so
rather than display a misleading zero. Blocks whose tables arrive in a later phase are reported
the same way until then. The timeline filters its entries by the same rule.

`GET /contributions` is the cooperative-wide ledger, filtered by `memberId`, `type`, `status`,
`from` and `to`. Its `meta.totalAmount` covers the whole filtered set rather than the page
returned, because that is the figure a treasurer is asked for. `GET /members/form-options` returns
the active income categories a contribution or a share purchase can be posted against, so the form
needs one request rather than two.

Voiding is the only correction. `POST /contributions/:id/void` and
`POST /members/:id/shares/:shareId/void` mark the record `VOID` with a reason and write a reversal
of the opposite kind into the ledger, carrying the original's accounting date so a correction never
moves money between periods already reported on. Both rows stay visible. Voiding something already
void is a `409`. A member's share holding and contribution totals are recomputed from the `POSTED`
rows every time, so there is no stored balance to drift.

There is no `DELETE /members/:id`. Deactivation is the only exit path.

### Finance — Phase 5

| Method | Path                             | Permission                                                     |
| ------ | -------------------------------- | -------------------------------------------------------------- |
| GET    | `/finance/transactions`          | `finance:view`                                                 |
| POST   | `/finance/transactions`          | `finance:create`                                               |
| GET    | `/finance/transactions/:id`      | `finance:view`                                                 |
| PATCH  | `/finance/transactions/:id`      | `finance:create` (description and category only, while POSTED) |
| POST   | `/finance/transactions/:id/void` | `finance:void`                                                 |
| GET    | `/finance/summary`               | `finance:view`                                                 |
| GET    | `/finance/trends`                | `finance:view`                                                 |
| GET    | `/finance/export`                | `finance:export`                                               |
| GET    | `/finance/categories`            | `finance:view`                                                 |
| POST   | `/finance/categories`            | `finance:categories:manage`                                    |
| PATCH  | `/finance/categories/:id`        | `finance:categories:manage`                                    |
| GET    | `/contributions`                 | `contributions:view`                                           |
| POST   | `/contributions/:id/void`        | `contributions:void`                                           |

`/finance/summary?from=&to=&groupBy=day|week|month` returns income, expenses, net, and the opening
and closing balance, plus a per-category breakdown. Both ends of the range are required: a summary
with no range would quietly report a different period than the reader has in mind. A range that
runs backwards or covers more than five years is rejected, on the list and the export as well.

Buckets with no entries are returned as zero rather than omitted, because a chart that skips an
empty month draws a line between two points that are not adjacent. A week begins on Monday.
`share` in the breakdown is a percentage of that category's own kind, to one decimal place: 40 % of
what the cooperative spent is a useful sentence, 40 % of everything that moved is not.
`/finance/trends` returns the same buckets with the balance carried forward.

Once posted, the amount, kind and date of a transaction can never be edited. `PATCH` accepts only
the category and the description, and only while the entry is `POSTED`. Corrections go through void
and re-entry, which leaves both rows in the history.

**What counts towards a total.** A voided entry and the reversal written to correct it are two rows
that cancel each other, so every figure the API reports excludes both: `status = 'POSTED' AND
reversal_of_id IS NULL`. Taking the reversal while excluding the void applies the correction twice.
Both rows remain in the listing with their status, which is what makes the correction visible.

An entry whose `sourceType` is `CONTRIBUTION` or `SHARE_PURCHASE` cannot be voided here. It answers
`409 errors.finance.voidFromSource`, because the ledger row and the member's record are two views
of the same money and the correction has to be made from the member's record so both stay in step.

`/finance/export?format=csv|xlsx` sends the ledger under the same filters as the list. The CSV
carries a byte order mark and quotes every value, with a leading `=`, `+`, `-` or `@` prefixed by an
apostrophe so a spreadsheet treats it as text. The `xlsx` is a real workbook with a frozen header
and the amount as a formatted number, so the first thing anybody does with it — select the column
and read the sum — works.

A category is never deleted, only deactivated: entries already posted against it still have to say
where the money went. Its kind can never change, because that would flip the sign of every entry
already posted against it. A new cooperative is seeded with categories chosen for its type, each
with a Kinyarwanda name.

### Products, units, warehouses, inventory — Phase 6

| Method | Path                                  | Permission                        |
| ------ | ------------------------------------- | --------------------------------- |
| GET    | `/products`                           | `products:view`                   |
| POST   | `/products`                           | `products:manage`                 |
| GET    | `/products/:id`                       | `products:view`                   |
| PATCH  | `/products/:id`                       | `products:manage`                 |
| GET    | `/product-categories`                 | `products:view`                   |
| POST   | `/product-categories`                 | `products:manage`                 |
| PATCH  | `/product-categories/:id`             | `products:manage`                 |
| GET    | `/units`                              | `products:view`                   |
| POST   | `/units`                              | `units:manage`                    |
| PATCH  | `/units/:id`                          | `units:manage`                    |
| GET    | `/warehouses`                         | `inventory:view`                  |
| POST   | `/warehouses`                         | `warehouses:manage`               |
| PATCH  | `/warehouses/:id`                     | `warehouses:manage`               |
| GET    | `/inventory/stock`                    | `inventory:view`                  |
| GET    | `/inventory/low-stock`                | `inventory:view`                  |
| GET    | `/inventory/transactions`             | `inventory:view`                  |
| POST   | `/inventory/receive`                  | `inventory:receive`               |
| POST   | `/inventory/issue`                    | `inventory:issue`                 |
| POST   | `/inventory/adjust`                   | `inventory:adjust`                |
| POST   | `/inventory/transfer`                 | `inventory:transfer`              |
| POST   | `/inventory/transactions/:id/reverse` | `inventory:adjust`                |
| GET    | `/inventory/valuation`                | `inventory:view` + `finance:view` |

`POST /inventory/receive` accepts `sourceMemberId`, which is how member deliveries are captured, and
optionally creates the matching expense when the cooperative pays on receipt. Giving
`expenseCategoryId` requires `unitCost`, because an expense with no amount is not an expense.

**The one statement this module turns on.** Every outward movement decrements through a single
conditional `UPDATE ... WHERE quantity >= :qty`, and an affected-row count of zero is
`409 INSUFFICIENT_STOCK`. There is no moment between checking that there are ten sacks and taking
ten sacks in which somebody else can take them, which is why twenty simultaneous issues against a
stock of ten produce ten movements and ten refusals rather than a negative balance. The refusal
deliberately does not say how much there is: the figure the caller read a moment ago may already be
stale, and quoting a number back would invite a retry with exactly that number.

**`POST /inventory/adjust` takes what was counted, not the difference.** A storekeeper counts eight
sacks and types eight; working out that the record said ten and the correction is therefore two out
is the software's job, and asking a person to decide the sign is how the wrong one gets recorded. A
count matching the record is `409 errors.inventory.countAgrees` rather than a movement of nothing.
`reason` is required, and a database check constraint enforces that too, because an unexplained
correction is what makes a shortfall unauditable.

**A transfer is two rows in one transaction**, each naming the other through
`counterparty_transaction_id`. Reversing either half reverses both: undoing one would leave stock in
a store it never reached. A reversal takes a type that reads correctly on its own — a receipt
reverses to an issue — rather than the original type with the direction flipped, and
`reversal_of_id` is what records that the two are a pair. Where the movement posted an expense, that
entry is voided by the same reversal the finance module uses.

**Whether a product is low is a question about the cooperative, not about one store.** The minimum
means "we want at least this much of it", so `isLow` and `meta.lowCount` compare the total across
every store, and each stock row carries both its own `quantity` and `quantityInAllStores`. That is
the same definition the low-stock watch uses, so the figure on the overview and the number of
warnings raised can never disagree.

`GET /inventory/valuation` needs `inventory:view` **and** `finance:view`: a storekeeper entitled to
count sacks is not thereby entitled to know what the cooperative paid for them. The unit cost is
the weighted average of every costed receipt, excluding any that were reversed. Where nothing costed
has ever been received the product's default purchase price is used and the row says
`costIsEstimated`, because a cooperative taking this figure to a lender needs to know which part of
it is an estimate.

There is no `DELETE` anywhere in this module. A movement recorded in error is reversed, a product is
retired, a store is closed, a unit is deactivated. A product's unit and whether it is counted are
frozen once movements exist against it: changing the unit would silently rewrite every quantity
already recorded, and switching a counted product to an uncounted one would abandon its stock level
with no movement to explain where the stock went.

### Buyers and sales — Phase 7

| Method | Path                  | Permission                   |
| ------ | --------------------- | ---------------------------- |
| GET    | `/buyers`             | `buyers:view`                |
| POST   | `/buyers`             | `buyers:manage`              |
| GET    | `/buyers/:id`         | `buyers:view`                |
| PATCH  | `/buyers/:id`         | `buyers:manage`              |
| GET    | `/buyers/:id/summary` | `buyers:view` + `sales:view` |
| GET    | `/sales`              | `sales:view`                 |
| POST   | `/sales`              | `sales:create`               |
| GET    | `/sales/:id`          | `sales:view`                 |
| PATCH  | `/sales/:id`          | `sales:create` (DRAFT only)  |
| POST   | `/sales/:id/confirm`  | `sales:confirm`              |
| POST   | `/sales/:id/cancel`   | `sales:cancel`               |
| POST   | `/sales/:id/payments` | `finance:create`             |
| GET    | `/sales/:id/receipt`  | `sales:view`                 |
| GET    | `/sales/summary`      | `sales:view`                 |

`confirm` and `payments` honour `Idempotency-Key`. A confirmed sale can never return to draft.

### Reports — Phase 8

| Method | Path                         | Permission                                      |
| ------ | ---------------------------- | ----------------------------------------------- |
| GET    | `/reports`                   | `reports:view`                                  |
| POST   | `/reports/:type/preview`     | `reports:view` + the report's data permission   |
| POST   | `/reports/:type/export`      | `reports:export` + the report's data permission |
| GET    | `/reports/runs`              | `reports:view`                                  |
| GET    | `/reports/runs/:id/download` | `reports:export`                                |

Types: `monthly-cooperative`, `financial`, `member`, `inventory`, `sales`, `activity`, `meeting`.
Formats: `pdf`, `csv`, `xlsx`.

### Documents and meetings — Phase 9

| Method | Path                                  | Permission                                      |
| ------ | ------------------------------------- | ----------------------------------------------- |
| GET    | `/documents`                          | `documents:view`                                |
| POST   | `/documents`                          | `documents:upload` (multipart)                  |
| GET    | `/documents/:id`                      | `documents:view`                                |
| GET    | `/documents/:id/download`             | `documents:view` (streamed, never a public URL) |
| PATCH  | `/documents/:id`                      | `documents:upload`                              |
| POST   | `/documents/:id/archive`              | `documents:archive`                             |
| GET    | `/meetings`                           | `meetings:view`                                 |
| POST   | `/meetings`                           | `meetings:manage`                               |
| GET    | `/meetings/:id`                       | `meetings:view`                                 |
| PATCH  | `/meetings/:id`                       | `meetings:manage`                               |
| PUT    | `/meetings/:id/agenda`                | `meetings:manage`                               |
| PUT    | `/meetings/:id/attendance`            | `meetings:manage`                               |
| POST   | `/meetings/:id/decisions`             | `meetings:manage`                               |
| PATCH  | `/meetings/:id/decisions/:decisionId` | `meetings:manage`                               |

### Dashboard, search, notifications — Phases 10 and 12

| Method | Path                         | Permission                                       |
| ------ | ---------------------------- | ------------------------------------------------ |
| GET    | `/dashboard/summary`         | `dashboard:view` (cards filtered per permission) |
| GET    | `/dashboard/activity`        | `dashboard:view`                                 |
| GET    | `/dashboard/attention`       | `dashboard:view`                                 |
| GET    | `/dashboard/health`          | `dashboard:view`                                 |
| GET    | `/search?q=`                 | `search:use`                                     |
| GET    | `/notifications`             | `notifications:view`                             |
| POST   | `/notifications/:id/read`    | `notifications:view`                             |
| POST   | `/notifications/read-all`    | `notifications:view`                             |
| POST   | `/notifications/:id/dismiss` | `notifications:view`                             |
| GET    | `/announcements`             | `announcements:view`                             |
| POST   | `/announcements`             | `announcements:manage`                           |
| POST   | `/announcements/:id/publish` | `announcements:manage`                           |
| POST   | `/announcements/:id/archive` | `announcements:manage`                           |
| POST   | `/sms/send`                  | `sms:send`                                       |
| GET    | `/sms/messages`              | `sms:send`                                       |

### Audit, assistant, platform administration — Phases 2, 14, 3

| Method | Path                       | Permission                     |
| ------ | -------------------------- | ------------------------------ |
| GET    | `/audit`                   | `audit:view`                   |
| POST   | `/assistant/ask`           | `assistant:use`                |
| GET    | `/assistant/conversations` | `assistant:use`                |
| GET    | `/admin/cooperatives`      | `platform:cooperatives:view`   |
| POST   | `/admin/cooperatives`      | `platform:cooperatives:manage` |
| PATCH  | `/admin/cooperatives/:id`  | `platform:cooperatives:manage` |
| GET    | `/admin/users`             | `platform:users:view`          |
| POST   | `/admin/users`             | `platform:users:manage`        |
| PATCH  | `/admin/users/:id`         | `platform:users:manage`        |
| GET    | `/admin/settings`          | `platform:settings:manage`     |
| PUT    | `/admin/settings/:key`     | `platform:settings:manage`     |
| GET    | `/admin/audit`             | `platform:audit:view`          |
| GET    | `/admin/health`            | `platform:health:view`         |
| GET    | `/health`                  | —                              |
| GET    | `/health/ready`            | —                              |

The whole `/admin` namespace answers **404, not 403**, to a caller who is not a platform
administrator, so an ordinary user cannot discover that it exists or which parts of it are there.
This is the same reasoning that makes a wrong-tenant record report "not found" rather than
"forbidden".

---

## 3. Frontend route map

| Route                                                  | Screen                                               | Guard                                                     |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| `/login`, `/forgot-password`, `/reset-password/:token` | Authentication                                       | public                                                    |
| `/`                                                    | Dashboard                                            | `dashboard:view`                                          |
| `/members`, `/members/:id`                             | Members (adding and editing are dialogs, see below)  | `members:view`                                            |
| `/finance`                                             | Money in, money out, balance                         | `finance:view`                                            |
| `/finance/transactions`                                | Ledger; recording is a dialog, as for members        | `finance:view` / `finance:create`                         |
| `/finance/categories`                                  | Categories                                           | `finance:view`, editing needs `finance:categories:manage` |
| `/contributions`                                       | Member contributions                                 | `contributions:view`                                      |
| `/inventory`                                           | Stock overview                                       | `inventory:view`                                          |
| `/inventory/products`, `/inventory/products/:id`       | Catalogue                                            | `products:view`                                           |
| `/inventory/movements`                                 | Movement history                                     | `inventory:view`                                          |
| (the four stock actions)                               | Dialogs over the overview, not routes                | matching permission                                       |
| `/inventory/warehouses`                                | Locations                                            | `inventory:view`, editing needs `warehouses:manage`       |
| `/inventory/units`                                     | Units of measure                                     | `products:view`, editing needs `units:manage`             |
| `/sales`, `/sales/new`, `/sales/:id`                   | Sales                                                | `sales:view` / `sales:create`                             |
| `/buyers`, `/buyers/:id`                               | Buyers                                               | `buyers:view`                                             |
| `/reports`, `/reports/:type`                           | Reports                                              | `reports:view`                                            |
| `/documents`                                           | Document centre                                      | `documents:view`                                          |
| `/meetings`, `/meetings/new`, `/meetings/:id`          | Meetings                                             | `meetings:view`                                           |
| `/announcements`                                       | Announcements                                        | `announcements:view`                                      |
| `/notifications`                                       | Notification centre                                  | `notifications:view`                                      |
| `/assistant`                                           | Ask CoopManage                                       | `assistant:use`                                           |
| `/search`                                              | Global search results                                | `search:use`                                              |
| `/settings/cooperative`                                | Cooperative profile                                  | `cooperative:view`                                        |
| `/settings/staff`                                      | Staff and roles                                      | `staff:view`                                              |
| `/settings/preferences`                                | Which modules the cooperative uses                   | `cooperative:view`, editing needs `settings:manage`       |
| `/settings/audit`                                      | Audit log                                            | `audit:view`                                              |
| `/profile`                                             | Own account and language                             | authenticated                                             |
| `/admin/*`                                             | Platform administration, including platform settings | `platform:*`                                              |

Adding and editing a member are dialogs over the register rather than the `/members/new` and
`/members/:id/edit` routes planned here. A secretary registering people at a meeting adds several
in a row, and a dialog keeps the list, the filters and the place in it; a route would throw that
away and come back to page one each time. The form is the same component in both cases and both
are still guarded by `members:create` and `members:update` on the control and on every request.

---

## 4. Documentation and versioning

The API is described by an OpenAPI 3.1 document assembled from the Zod schemas, so the
specification cannot drift from the validators. It is served at `/api/v1/docs` (Swagger UI, disabled
in production unless `ENABLE_API_DOCS=true`) and written to `docs/openapi.json` in the build.

Every documented endpoint carries: summary, required permission, parameters, request body schema,
success response schema, and the error codes it can return.

The version lives in the path. A breaking change means `/api/v2`; additive fields do not. Response
fields are never removed within a version, and clients must tolerate unknown fields.
