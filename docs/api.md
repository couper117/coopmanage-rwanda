# CoopManage Rwanda — API Design

Base URL: `/api/v1`. JSON in, JSON out, UTF-8.
Status: **Phase 0 baseline.** Each endpoint is delivered in the phase noted in the tables.

---

## 1. Conventions

### Headers

| Header | Required | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <accessToken>` | all but public routes | Identifies the user |
| `X-Cooperative-Id: <uuid>` | all tenant-scoped routes | Selects the active cooperative |
| `Accept-Language: en \| rw` | optional | Language for server-rendered text and PDFs |
| `Idempotency-Key: <uuid>` | optional, honoured on money and stock mutations | Safe retries |
| `X-Request-Id` | optional | Echoed back and written to every log line |

The refresh token travels only as an `HttpOnly` cookie on `/api/v1/auth/refresh` and
`/api/v1/auth/logout`.

### Response envelope

Success:

```json
{ "data": { }, "meta": { } }
```

Collection:

```json
{
  "data": [ ],
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
    "details": [ { "field": "items.0.quantity", "messageKey": "validation.max" } ],
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

| Parameter | Example | Notes |
| --- | --- | --- |
| `page`, `pageSize` | `?page=2&pageSize=50` | Default 25, maximum 100. Offset paging for tables |
| `cursor` | `?cursor=eyJ...` | Cursor paging on audit log and activity feeds |
| `sort` | `?sort=-occurredAt,reference` | Leading `-` is descending. Allow-listed fields only |
| `q` | `?q=Jean` | Free-text search, trigram matched |
| filters | `?status=ACTIVE&from=2026-01-01&to=2026-03-31&categoryId=...` | Per-resource, all validated |
| `include` | `?include=member,category` | Allow-listed relations only |

Unknown query parameters are rejected rather than ignored, so a typo in a filter never silently
returns unfiltered data.

### Status codes

`200` read or update, `201` create, `204` delete or archive with no body, `400` malformed request,
`401` unauthenticated, `403` authenticated but not permitted, `404` not found **or wrong tenant**,
`409` conflict (duplicate code, idempotency reuse, state transition not allowed),
`422` validation failed, `429` rate limited, `500` internal.

### Error codes

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`,
`FORBIDDEN`, `NO_COOPERATIVE_ACCESS`, `NOT_FOUND`, `DUPLICATE_RESOURCE`, `CONFLICT`,
`INSUFFICIENT_STOCK`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`, `FILE_TOO_LARGE`,
`UNSUPPORTED_FILE_TYPE`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

### Rate limits

| Scope | Limit |
| --- | --- |
| `POST /auth/login` | 5 per 15 min per IP **and** per email |
| `POST /auth/forgot-password` | 3 per hour per IP and per email |
| Mutating endpoints | 60 per minute per user |
| Read endpoints | 300 per minute per user |
| File upload | 20 per hour per user |
| `POST /assistant/ask` | 20 per hour per user and 200 per day per cooperative |
| `POST /sms/send` | 10 per hour per cooperative |

---

## 2. Endpoint map

Every row lists the permission the backend enforces. `—` means public or self-scoped.

### Authentication and session — Phase 2

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | Returns access token, user, memberships |
| POST | `/auth/refresh` | — | Rotates refresh cookie |
| POST | `/auth/logout` | — | Revokes the session family |
| GET | `/auth/me` | — | User, active cooperative, effective permissions |
| PATCH | `/auth/me` | — | Own name, phone, locale |
| POST | `/auth/change-password` | — | Requires current password |
| POST | `/auth/forgot-password` | — | Always `204`, never reveals existence |
| POST | `/auth/reset-password` | — | Single-use token |
| GET | `/auth/sessions` | — | Own active sessions |
| DELETE | `/auth/sessions/:id` | — | Sign out one device |

### Cooperative and staff — Phase 3

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/cooperatives/mine` | — (memberships of the caller) |
| GET | `/cooperatives/current` | `cooperative:view` |
| PATCH | `/cooperatives/current` | `cooperative:update` |
| POST | `/cooperatives/current/logo` | `cooperative:update` |
| GET | `/cooperative-types` | — |
| GET | `/settings` | `cooperative:view` |
| PUT | `/settings/:key` | `settings:manage` |
| GET | `/staff` | `staff:view` |
| POST | `/staff/invite` | `staff:invite` |
| PATCH | `/staff/:id` | `staff:manage` |
| POST | `/staff/:id/deactivate` | `staff:manage` |
| GET | `/roles` | `staff:view` |
| GET | `/permissions` | `staff:view` |
| PUT | `/staff/:id/overrides` | `staff:manage` |

### Members — Phase 4

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/members` | `members:view` |
| POST | `/members` | `members:create` |
| GET | `/members/:id` | `members:view` |
| PATCH | `/members/:id` | `members:update` |
| POST | `/members/:id/status` | `members:deactivate` |
| GET | `/members/:id/summary` | `members:view`, sections composed (see below) |
| GET | `/members/:id/timeline` | `members:view`, entries filtered by permission |
| GET | `/members/stats` | `members:view` |
| GET | `/members/export` | `members:export` |
| GET | `/members/:id/shares` | `shares:view` |
| POST | `/members/:id/shares` | `shares:manage` |
| POST | `/members/:id/shares/:shareId/void` | `shares:manage` |
| GET | `/members/:id/contributions` | `contributions:view` |
| POST | `/members/:id/contributions` | `contributions:create` |

`GET /members` filters: `q`, `status`, `position`, `gender`, `district`, `sector`, `joinedFrom`,
`joinedTo`, `hasPhone`. `/members/:id/summary` returns the figures behind the member profile, and each
block is gated separately by the rule in `permissions.md` §4: shares need `shares:view`,
contributions need `contributions:view`, payments received need `finance:view`, and quantity
supplied needs `inventory:view`. Blocks the caller may not see are omitted, and the payload names
which ones were withheld so the interface can say so rather than display a misleading zero. The
timeline filters its entries by the same rule.

There is no `DELETE /members/:id`. Deactivation is the only exit path.

### Finance — Phase 5

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/finance/transactions` | `finance:view` |
| POST | `/finance/transactions` | `finance:create` |
| GET | `/finance/transactions/:id` | `finance:view` |
| PATCH | `/finance/transactions/:id` | `finance:create` (description and category only, while POSTED) |
| POST | `/finance/transactions/:id/void` | `finance:void` |
| GET | `/finance/summary` | `finance:view` |
| GET | `/finance/trends` | `finance:view` |
| GET | `/finance/export` | `finance:export` |
| GET | `/finance/categories` | `finance:view` |
| POST | `/finance/categories` | `finance:categories:manage` |
| PATCH | `/finance/categories/:id` | `finance:categories:manage` |
| GET | `/contributions` | `contributions:view` |
| POST | `/contributions/:id/void` | `contributions:void` |

`/finance/summary?from=&to=&groupBy=day|week|month` returns income, expense, net and opening and
closing balance, plus a per-category breakdown. Amount and date range are validated together; a
range wider than 5 years is rejected.

Once posted, the amount, kind and date of a transaction can never be edited. Corrections go through
void and re-entry, which leaves both rows in the history.

### Products, units, warehouses, inventory — Phase 6

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/products` | `products:view` |
| POST | `/products` | `products:manage` |
| GET | `/products/:id` | `products:view` |
| PATCH | `/products/:id` | `products:manage` |
| GET | `/product-categories` | `products:view` |
| POST | `/product-categories` | `products:manage` |
| PATCH | `/product-categories/:id` | `products:manage` |
| GET | `/units` | `products:view` |
| POST | `/units` | `units:manage` |
| PATCH | `/units/:id` | `units:manage` |
| GET | `/warehouses` | `inventory:view` |
| POST | `/warehouses` | `warehouses:manage` |
| PATCH | `/warehouses/:id` | `warehouses:manage` |
| GET | `/inventory/stock` | `inventory:view` |
| GET | `/inventory/low-stock` | `inventory:view` |
| GET | `/inventory/transactions` | `inventory:view` |
| POST | `/inventory/receive` | `inventory:receive` |
| POST | `/inventory/issue` | `inventory:issue` |
| POST | `/inventory/adjust` | `inventory:adjust` |
| POST | `/inventory/transfer` | `inventory:transfer` |
| POST | `/inventory/transactions/:id/reverse` | `inventory:adjust` |
| GET | `/inventory/valuation` | `inventory:view` + `finance:view` |

`POST /inventory/receive` accepts `sourceMemberId`, which is how member deliveries are captured, and
optionally creates the matching expense when the cooperative pays on receipt.

### Buyers and sales — Phase 7

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/buyers` | `buyers:view` |
| POST | `/buyers` | `buyers:manage` |
| GET | `/buyers/:id` | `buyers:view` |
| PATCH | `/buyers/:id` | `buyers:manage` |
| GET | `/buyers/:id/summary` | `buyers:view` + `sales:view` |
| GET | `/sales` | `sales:view` |
| POST | `/sales` | `sales:create` |
| GET | `/sales/:id` | `sales:view` |
| PATCH | `/sales/:id` | `sales:create` (DRAFT only) |
| POST | `/sales/:id/confirm` | `sales:confirm` |
| POST | `/sales/:id/cancel` | `sales:cancel` |
| POST | `/sales/:id/payments` | `finance:create` |
| GET | `/sales/:id/receipt` | `sales:view` |
| GET | `/sales/summary` | `sales:view` |

`confirm` and `payments` honour `Idempotency-Key`. A confirmed sale can never return to draft.

### Reports — Phase 8

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/reports` | `reports:view` |
| POST | `/reports/:type/preview` | `reports:view` + the report's data permission |
| POST | `/reports/:type/export` | `reports:export` + the report's data permission |
| GET | `/reports/runs` | `reports:view` |
| GET | `/reports/runs/:id/download` | `reports:export` |

Types: `monthly-cooperative`, `financial`, `member`, `inventory`, `sales`, `activity`, `meeting`.
Formats: `pdf`, `csv`, `xlsx`.

### Documents and meetings — Phase 9

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/documents` | `documents:view` |
| POST | `/documents` | `documents:upload` (multipart) |
| GET | `/documents/:id` | `documents:view` |
| GET | `/documents/:id/download` | `documents:view` (streamed, never a public URL) |
| PATCH | `/documents/:id` | `documents:upload` |
| POST | `/documents/:id/archive` | `documents:archive` |
| GET | `/meetings` | `meetings:view` |
| POST | `/meetings` | `meetings:manage` |
| GET | `/meetings/:id` | `meetings:view` |
| PATCH | `/meetings/:id` | `meetings:manage` |
| PUT | `/meetings/:id/agenda` | `meetings:manage` |
| PUT | `/meetings/:id/attendance` | `meetings:manage` |
| POST | `/meetings/:id/decisions` | `meetings:manage` |
| PATCH | `/meetings/:id/decisions/:decisionId` | `meetings:manage` |

### Dashboard, search, notifications — Phases 10 and 12

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/dashboard/summary` | `dashboard:view` (cards filtered per permission) |
| GET | `/dashboard/activity` | `dashboard:view` |
| GET | `/dashboard/attention` | `dashboard:view` |
| GET | `/dashboard/health` | `dashboard:view` |
| GET | `/search?q=` | `search:use` |
| GET | `/notifications` | `notifications:view` |
| POST | `/notifications/:id/read` | `notifications:view` |
| POST | `/notifications/read-all` | `notifications:view` |
| POST | `/notifications/:id/dismiss` | `notifications:view` |
| GET | `/announcements` | `announcements:view` |
| POST | `/announcements` | `announcements:manage` |
| POST | `/announcements/:id/publish` | `announcements:manage` |
| POST | `/announcements/:id/archive` | `announcements:manage` |
| POST | `/sms/send` | `sms:send` |
| GET | `/sms/messages` | `sms:send` |

### Audit, assistant, platform administration — Phases 2, 14, 3

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/audit` | `audit:view` |
| POST | `/assistant/ask` | `assistant:use` |
| GET | `/assistant/conversations` | `assistant:use` |
| GET | `/admin/cooperatives` | `platform:cooperatives:view` |
| POST | `/admin/cooperatives` | `platform:cooperatives:manage` |
| PATCH | `/admin/cooperatives/:id` | `platform:cooperatives:manage` |
| GET | `/admin/users` | `platform:users:view` |
| POST | `/admin/users` | `platform:users:manage` |
| PATCH | `/admin/users/:id` | `platform:users:manage` |
| GET | `/admin/settings` | `platform:settings:manage` |
| PUT | `/admin/settings/:key` | `platform:settings:manage` |
| GET | `/admin/audit` | `platform:audit:view` |
| GET | `/admin/health` | `platform:health:view` |
| GET | `/health` | — |
| GET | `/health/ready` | — |

---

## 3. Frontend route map

| Route | Screen | Guard |
| --- | --- | --- |
| `/login`, `/forgot-password`, `/reset-password/:token` | Authentication | public |
| `/` | Dashboard | `dashboard:view` |
| `/members`, `/members/new`, `/members/:id`, `/members/:id/edit` | Members | `members:view` / `members:create` / `members:update` |
| `/finance` | Money in, money out, balance | `finance:view` |
| `/finance/transactions`, `/finance/transactions/new` | Ledger and entry | `finance:view` / `finance:create` |
| `/finance/categories` | Categories | `finance:view`, editing needs `finance:categories:manage` |
| `/contributions` | Member contributions | `contributions:view` |
| `/inventory` | Stock overview | `inventory:view` |
| `/inventory/products`, `/inventory/products/:id` | Catalogue | `products:view` |
| `/inventory/movements` | Movement history | `inventory:view` |
| `/inventory/receive`, `/inventory/issue`, `/inventory/adjust`, `/inventory/transfer` | Stock actions | matching permission |
| `/inventory/warehouses` | Locations | `inventory:view`, editing needs `warehouses:manage` |
| `/inventory/units` | Units of measure | `products:view`, editing needs `units:manage` |
| `/sales`, `/sales/new`, `/sales/:id` | Sales | `sales:view` / `sales:create` |
| `/buyers`, `/buyers/:id` | Buyers | `buyers:view` |
| `/reports`, `/reports/:type` | Reports | `reports:view` |
| `/documents` | Document centre | `documents:view` |
| `/meetings`, `/meetings/new`, `/meetings/:id` | Meetings | `meetings:view` |
| `/announcements` | Announcements | `announcements:view` |
| `/notifications` | Notification centre | `notifications:view` |
| `/assistant` | Ask CoopManage | `assistant:use` |
| `/search` | Global search results | `search:use` |
| `/settings/cooperative` | Cooperative profile | `cooperative:view` |
| `/settings/staff` | Staff and roles | `staff:view` |
| `/settings/preferences` | Cooperative-wide settings and thresholds | `settings:manage` |
| `/settings/audit` | Audit log | `audit:view` |
| `/profile` | Own account and language | authenticated |
| `/admin/*` | Platform administration, including platform settings | `platform:*` |

---

## 4. Documentation and versioning

The API is described by an OpenAPI 3.1 document assembled from the Zod schemas, so the
specification cannot drift from the validators. It is served at `/api/v1/docs` (Swagger UI, disabled
in production unless `ENABLE_API_DOCS=true`) and written to `docs/openapi.json` in the build.

Every documented endpoint carries: summary, required permission, parameters, request body schema,
success response schema, and the error codes it can return.

The version lives in the path. A breaking change means `/api/v2`; additive fields do not. Response
fields are never removed within a version, and clients must tolerate unknown fields.
