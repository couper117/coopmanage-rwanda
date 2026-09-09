# CoopManage Rwanda — Permission Model

Status: **Phase 0 baseline.** Implemented in Phase 2, extended by each later phase.

---

## 1. Principles

1. **Deny by default.** A route with no `requirePermission` guard is a bug. A lint rule and a route
   inventory test assert that every non-public route declares exactly one permission.
2. **Permissions, not roles, are checked in code.** Nothing in the backend reads
   `if (role === 'MANAGER')`. Roles are only bundles of permissions, so adding a role later needs no
   code change.
3. **The backend is the only authority.** The frontend receives the caller's effective permission
   list to hide menus and disable buttons. That is presentation. Every endpoint re-checks.
4. **Permission plus tenancy are separate gates.** Holding `finance:view` says *what* you may do.
   Your `CooperativeStaff` row says *where*. Both are required, and tenancy is checked first, so a
   valid permission never leaks the existence of another cooperative's records.
5. **One source of truth.** The permission catalogue lives in
   `packages/shared/src/permissions.ts` and is seeded into the `Permission` table. Code, database
   and documentation cannot drift because the seed is generated from the same constant.

---

## 2. Permission catalogue

Keys are `resource:action`, lower case, colon separated.

### Cooperative scope

| Key | Grants |
| --- | --- |
| `dashboard:view` | Open the dashboard and its summary cards |
| `search:use` | Global search across permitted resources |
| `assistant:use` | Ask CoopManage |
| `notifications:view` | Read and dismiss own notifications |
| `cooperative:view` | See cooperative profile |
| `cooperative:update` | Edit cooperative profile and branding |
| `settings:manage` | Change cooperative settings, units, thresholds, modules |
| `staff:view` | List staff and their roles |
| `staff:invite` | Invite a new staff user |
| `staff:manage` | Change staff role, deactivate staff, set overrides |
| `audit:view` | Read the cooperative audit log |
| `members:view` | List and open member records |
| `members:create` | Register a member |
| `members:update` | Edit member details |
| `members:deactivate` | Deactivate, suspend or mark a member as exited |
| `members:export` | Export member lists to CSV |
| `shares:view` | See share holdings and history |
| `shares:manage` | Record share purchase, transfer or redemption |
| `contributions:view` | See contributions |
| `contributions:create` | Record a contribution |
| `contributions:void` | Void a contribution and its finance entry |
| `finance:view` | See transactions, balances and financial summaries |
| `finance:create` | Record income and expenses |
| `finance:void` | Void and reverse a posted transaction |
| `finance:export` | Export financial data |
| `finance:categories:manage` | Create and edit income/expense categories |
| `products:view` | See the product catalogue |
| `products:manage` | Create and edit products and categories |
| `units:manage` | Create and edit units of measure |
| `warehouses:manage` | Create and edit storage locations |
| `inventory:view` | See stock levels and movement history |
| `inventory:receive` | Record stock received, including from members |
| `inventory:issue` | Record stock issued |
| `inventory:adjust` | Record a stock adjustment with a reason |
| `inventory:transfer` | Move stock between warehouses |
| `buyers:view` | See buyers and their history |
| `buyers:manage` | Create and edit buyers |
| `sales:view` | See sales and receipts |
| `sales:create` | Create and edit a draft sale |
| `sales:confirm` | Confirm a sale, moving stock and money |
| `sales:cancel` | Cancel a confirmed sale with compensating entries |
| `reports:view` | Open the report catalogue and preview reports |
| `reports:export` | Download reports as PDF, CSV or Excel |
| `documents:view` | List, preview and download documents |
| `documents:upload` | Upload documents |
| `documents:archive` | Archive a document |
| `meetings:view` | See meetings, agendas, attendance and decisions |
| `meetings:manage` | Create and edit meetings, attendance and decisions |
| `announcements:view` | Read announcements |
| `announcements:manage` | Create, publish and archive announcements |
| `sms:send` | Send SMS to selected members |

### Platform scope

| Key | Grants |
| --- | --- |
| `platform:cooperatives:view` | List every cooperative on the platform |
| `platform:cooperatives:manage` | Create, suspend and archive cooperatives |
| `platform:users:view` | List platform users |
| `platform:users:manage` | Create, suspend and reset platform users |
| `platform:settings:manage` | Edit platform-wide settings |
| `platform:health:view` | System health and diagnostics |
| `platform:audit:view` | Read audit logs across all cooperatives |

---

## 3. Role matrix

`●` granted, `−` not granted.

| Permission | Manager | Accountant | Secretary | Inventory officer | Viewer |
| --- | :--: | :--: | :--: | :--: | :--: |
| dashboard:view | ● | ● | ● | ● | ● |
| search:use | ● | ● | ● | ● | ● |
| assistant:use | ● | ● | ● | ● | ● |
| notifications:view | ● | ● | ● | ● | ● |
| cooperative:view | ● | ● | ● | ● | ● |
| cooperative:update | ● | − | − | − | − |
| settings:manage | ● | − | − | − | − |
| staff:view | ● | − | ● | − | − |
| staff:invite | ● | − | − | − | − |
| staff:manage | ● | − | − | − | − |
| audit:view | ● | − | − | − | − |
| members:view | ● | ● | ● | ● | ● |
| members:create | ● | − | ● | − | − |
| members:update | ● | − | ● | − | − |
| members:deactivate | ● | − | ● | − | − |
| members:export | ● | ● | ● | − | − |
| shares:view | ● | ● | ● | − | ● |
| shares:manage | ● | ● | − | − | − |
| contributions:view | ● | ● | ● | − | ● |
| contributions:create | ● | ● | − | − | − |
| contributions:void | ● | ● | − | − | − |
| finance:view | ● | ● | − | − | ● |
| finance:create | ● | ● | − | − | − |
| finance:void | ● | ● | − | − | − |
| finance:export | ● | ● | − | − | − |
| finance:categories:manage | ● | ● | − | − | − |
| products:view | ● | ● | − | ● | ● |
| products:manage | ● | − | − | ● | − |
| units:manage | ● | − | − | ● | − |
| warehouses:manage | ● | − | − | ● | − |
| inventory:view | ● | ● | − | ● | ● |
| inventory:receive | ● | − | − | ● | − |
| inventory:issue | ● | − | − | ● | − |
| inventory:adjust | ● | − | − | ● | − |
| inventory:transfer | ● | − | − | ● | − |
| buyers:view | ● | ● | − | ● | ● |
| buyers:manage | ● | − | − | ● | − |
| sales:view | ● | ● | − | ● | ● |
| sales:create | ● | ● | − | − | − |
| sales:confirm | ● | ● | − | − | − |
| sales:cancel | ● | − | − | − | − |
| reports:view | ● | ● | ● | ● | ● |
| reports:export | ● | ● | ● | ● | − |
| documents:view | ● | ● | ● | ● | ● |
| documents:upload | ● | ● | ● | − | − |
| documents:archive | ● | − | ● | − | − |
| meetings:view | ● | ● | ● | ● | ● |
| meetings:manage | ● | − | ● | − | − |
| announcements:view | ● | ● | ● | ● | ● |
| announcements:manage | ● | − | ● | − | − |
| sms:send | ● | − | ● | − | − |

Design notes on specific choices:

- **The accountant may confirm a sale but not cancel one.** Cancelling reverses stock and money
  together and is the higher-risk action, so it stays with the manager.
- **The secretary cannot see finance.** Section 3 of the brief gives the secretary members,
  meetings, documents, announcements and permitted reports. Contribution *visibility* is included
  because the secretary registers members and needs to see whether fees were paid, but recording
  and voiding money stays with the accountant and manager.
- **The inventory officer holds `members:view`** because stock received from a member must be
  attributed to that member.
- **`sms:send` is deliberately narrow.** It costs money and reaches people outside the system.

### System administrator

The system administrator is a platform role, not a cooperative role. It holds every `platform:*` permission. Those keys are platform-scoped and are not evaluated inside
a cooperative at all. Within any individual cooperative it holds only `cooperative:view`,
`staff:view`, `audit:view` and `reports:view`.

It explicitly does **not** hold `finance:create`, `finance:void`, `inventory:*` write, `sales:*`
write or `documents:view`. A platform operator has no business posting a cooperative's transactions
or reading its private contracts, and separating this keeps the audit trail meaningful. Where
support genuinely requires deeper access, the cooperative's manager grants a normal staff role.

Every platform-administrator request that touches tenant data writes an `AuditLog` row with
`action = 'platform.tenant_access'` naming the cooperative and the route.

---

## 4. Composite rules

Some screens need more than a single key. These rules are implemented once, in the service layer,
not repeated per route.

- **Reports.** `reports:view` opens the catalogue. Each individual report additionally requires the
  permission of the data it contains: the financial report needs `finance:view`, the member report
  needs `members:view`, the inventory report needs `inventory:view`, the sales report needs
  `sales:view`. The monthly cooperative report renders only the sections the caller may see, and
  says plainly which sections were omitted rather than silently dropping them.
- **Dashboard.** Every card is permission-filtered by the same rule. An inventory officer opening
  the dashboard sees stock and activity cards and no balance figure.
- **Global search.** Results are filtered per resource against the caller's permissions before
  ranking, so a secretary searching a buyer name gets no sales rows.
- **Assistant.** Each query tool declares the permission it needs. The tool list offered to the
  model is built per request from the caller's permissions, so an unauthorised tool cannot be
  called even if the model asks for it.
- **Member profile.** The financial panels (contributions, payments) require `contributions:view`
  and `finance:view` respectively; the profile renders without them.

---

## 5. How a check runs

```
request
  → authenticate            valid access token?            401 UNAUTHENTICATED
  → resolveCooperative      ACTIVE staff row for the        403 NO_COOPERATIVE_ACCESS
                            X-Cooperative-Id header?        (404 for platform-scoped ids)
  → requirePermission(key)  key in req.ctx.permissions?     403 FORBIDDEN
  → validate(schema)        body/query/params well formed?  422 VALIDATION_FAILED
  → controller → service    tenant-scoped query             404 NOT_FOUND if wrong tenant
```

`req.ctx` is built once per request and is immutable:

```ts
type RequestContext = {
  requestId: string
  user: { id: string; email: string; fullName: string; isPlatformAdmin: boolean; locale: Locale }
  cooperative?: { id: string; name: string; code: string }
  staff?: { id: string; roleKey: RoleKey }
  permissions: ReadonlySet<PermissionKey>
}
```

Effective permissions are computed as role permissions, plus `GRANT` overrides, minus `DENY`
overrides, then cached in memory for 60 seconds per staff row and invalidated immediately on any
role or override change.

---

## 6. Frontend enforcement

`usePermission('finance:create')` reads the list returned by `GET /api/v1/auth/me`. It is used to:

- omit navigation items the user cannot reach,
- render a disabled control with an explanatory tooltip rather than a control that fails on click,
- and redirect to a clear "You do not have access to this page" screen on a guarded route.

Hiding a control is never treated as security. The Phase 15 review includes calling every mutating
endpoint with a viewer token and asserting `403`.

---

## 7. Testing obligations

The permission model is covered by tests that must pass before Phase 2 is complete and are extended
by every phase that adds a route:

1. **Matrix test.** For each seeded role and each catalogue permission, assert the effective set
   matches the table in section 3 exactly. This document and the seed cannot silently diverge.
2. **Route inventory test.** Enumerate the Express router stack and assert every route is either on
   an explicit public allow-list or declares a permission.
3. **Cross-tenant test.** For every tenant-scoped route, call it with Cooperative A's token against
   Cooperative B's identifiers and assert `404`.
4. **Negative role tests.** For each role, call a representative forbidden endpoint and assert
   `403` with code `FORBIDDEN`.
5. **Override test.** A `DENY` override removes access that the role grants; a `GRANT` override adds
   access the role lacks; both are reflected within one cache interval.
