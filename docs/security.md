# CoopManage Rwanda — Security Baseline

Written in **Phase 0** as the standard every phase is built against. Formally audited in
**Phase 15**. A control is listed here only if it is planned as a real implementation, never as an
aspiration.

---

## 1. Threat model

| Asset                         | Threat                                              | Primary control                                                                   |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Another cooperative's records | A staff user guessing or replaying identifiers      | Tenant resolution plus tenant-scoped repositories, `404` on mismatch              |
| Financial records             | Silent alteration or deletion to hide a discrepancy | Void-and-reverse only, append-only audit log, no delete endpoint                  |
| Member personal data          | Bulk extraction                                     | Permission-gated export, rate limits, export written to the audit log             |
| Private documents             | Direct object access without a session              | Random storage keys, no public bucket, streamed through an authorised endpoint    |
| Accounts                      | Credential stuffing and brute force                 | Argon2id, per-IP and per-account rate limits, progressive lockout                 |
| Sessions                      | Refresh token theft                                 | Hashed rotating refresh tokens with family revocation on reuse                    |
| The database                  | Injection                                           | Prisma parameterisation, no string-built SQL, allow-listed sort and filter fields |

The realistic adversary is not a nation state. It is a curious or disgruntled staff member of one
cooperative, an attacker with a stolen laptop, and an automated credential-stuffing bot.

## 2. Authentication

Argon2id with tuned memory and time cost, one hash per password, never a shared salt. Access tokens
are JWTs valid for 15 minutes, held in memory by the SPA and never in `localStorage`. Refresh
tokens are opaque, random, stored only as a hash, delivered as `HttpOnly` `Secure` `SameSite=Lax`
cookies scoped to the refresh path, rotated on every use, and revoked as a family when a rotated
token is presented again. Password reset tokens are single use, expire in 60 minutes, and the
request endpoint answers identically for known and unknown addresses.

The environment schema refuses to start production on a placeholder secret, including the exact
value shipped in `.env.example`, on any loopback CORS origin, or on a secret shorter than 32
characters. API documentation defaults to closed in production and must be switched on deliberately.

Password rules: minimum 10 characters, checked against a list of the most common passwords, no
composition rules that push people towards `Password1!`. An account whose password somebody else
chose — the seeded administrator's bootstrap password, or one an operator handed over — carries
`mustChangePassword`, and **the API refuses every request but its own session's** (`/auth/me`,
`/auth/change-password`, `/auth/sessions`, `/auth/logout`) with `PASSWORD_CHANGE_REQUIRED` until it
has set its own; the interface holds it at a change-password screen with no navigation. The flag
had been recorded since Phase 2 and enforced nowhere, which the Phase 18 walk-through found when
the rehearsed administrator could administer the platform on the bootstrap password. Invited staff
and new managers never have a usable password at all: they receive a single-use link.

The Argon2id parameters are 19 MiB of memory and three passes, which is what RFC 9106 recommends
for a memory-constrained server. **Under `NODE_ENV=test` only, the cost drops to the library
minimum.** The suite signs several hundred sessions in across thirteen parallel worker processes,
and at production cost that contention was enough to push unrelated tests past their timeouts.
`apps/backend/test/password.test.ts` asserts the parameter set used everywhere else, so the
reduction cannot reach a deployment without that test failing. Nothing else about hashing differs:
the cost is encoded in each stored hash, so raising the parameters later leaves old hashes
verifying and replaces them at their owner's next sign-in.

## 3. Authorization and tenancy

Covered in full by `permissions.md`. The two invariants: every non-public route declares a
permission, and every tenant-scoped query includes `cooperative_id`. Both are enforced by tests that
enumerate the router, not by review alone.

## 4. Input validation

Zod at the boundary for body, query and path parameters, with unknown keys rejected rather than
stripped, so a typo in a filter cannot silently widen a result set. Decimal fields are parsed as
decimals and rejected when the scale exceeds the column. Sort fields, include relations and filter
names are allow-listed. Request bodies are capped at 1 MB, uploads handled separately.

### Files the application produces

A CSV or a spreadsheet this application writes is a file somebody opens on their own machine, so
every cell is quoted and any cell beginning `=`, `+`, `-`, `@`, a tab or a carriage return is
prefixed with an apostrophe. Without it a description typed by a member of staff — and descriptions
are free text, because that is where a paper receipt number goes — would execute as a formula the
moment the file is opened. The rule is applied in one place per exporter: `csvCell` in the finance
service and `cell` in `render.csv.ts`, both covered by a test that asserts the guard rather than
just the absence of a crash. The spreadsheet exporters write typed cells rather than text, so a
formula cannot be introduced there at all.

Reports are produced from parameters, never from a client-supplied template or filename. The
attachment name is built from the cooperative's own code, the report type and the period, with
anything outside `[a-z0-9-]` replaced, so a cooperative name cannot put a path separator or a
control character into a `Content-Disposition` header.

## 5. File uploads

Extension allow-list, declared MIME check, and magic-byte sniffing of the actual content, all three
required to agree. 10 MB default cap. Filenames are discarded and replaced by a random storage key;
the original name is kept only as metadata and is escaped on display. SVG is not accepted, because
it executes script. Files are stored outside the web root, never in a public bucket, and served only
through the authorised streaming endpoint with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`. A SHA-256 checksum is recorded.

**Built in Phase 9, with these decisions worth recording.**

The executable check runs **before** the extension is looked at, on the content, so a `.pdf` holding
a Windows binary is refused as an executable rather than as a signature mismatch — the person
uploading is told what the file actually is. Windows PE, ELF, Mach-O in both byte orders, the
universal-binary signature that Java class files share, shell scripts and Windows batch files are all
refused whatever the name says.

A ZIP renamed `.docx` is refused too: every OOXML package carries `[Content_Types].xml` and a part
prefix for its own kind, and both are checked, because the ZIP signature alone would have accepted an
executable somebody zipped and renamed. Text has no signature and is checked the other way round — no
NUL byte, valid UTF-8, and none of the executable headers.

Uploads are parsed **in memory**, not to a temporary file. A temporary file means the bytes exist on
disk before anything has looked at them, which is a window in which a disguised executable is a real
file on the server, and a path to clean up on every failure.

The storage key is `<year>/<month>/<48 hex characters>` from the system's cryptographic source and is
pinned by a database check constraint and by the driver, so a key derived from a filename cannot reach
the column. It appears in no API response.

The filename kept as metadata has control characters, quotes and semicolons stripped and any path
discarded: all three are header injection through a field the uploader controls, and
`../../etc/passwd.pdf` is stored as `passwd.pdf`.

A preview is served `inline` only for PDF and images, always with
`Content-Security-Policy: sandbox; default-src 'none'` so a PDF's own scripting is neutralised, and
`Cache-Control: private, no-store` so a cooperative's contract stays out of a shared proxy. A CSV
asked for inline is sent as a download: serving an uploaded `text/*` inline is the shape of a
stored-XSS bug.

A restricted document is unreachable rather than hidden — the visibility rule is part of the `where`
clause on every read, update, archive and download — and a caller who may not see it gets "not found",
because the existence of a member's medical letter is itself the sensitive part.

## 6. Transport and headers

A forwarded client address is trusted only where a proxy actually terminates the connection:
`trust proxy` is `1` in production and `loopback` elsewhere. Trusting it everywhere would let any
direct caller set `X-Forwarded-For` and choose the key that rate limiting counts against.

A browser origin that is not on the allow-list is refused with `403 FORBIDDEN`. The rejected origin
is logged but never echoed back in the response, so the caller learns nothing and a routine refusal
does not register as a server fault.

HTTPS everywhere in production with HSTS. Helmet supplies `X-Content-Type-Options`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a Content Security
Policy with no `unsafe-inline` for scripts. CORS is an explicit origin allow-list from the
environment, with credentials enabled and no wildcard.

## 7. CSRF

The API authenticates with a bearer token in a header, which is not sent automatically by the
browser, so ordinary endpoints are not CSRF-exposed. The one cookie-authenticated endpoint,
`/auth/refresh`, is protected by `SameSite=Lax`, an origin check, and by accepting only `POST`.

## 8. Rate limiting and abuse

Limits are listed in `api.md` §1. Login and password reset are limited per account tightly and per
IP loosely, and the asymmetry is deliberate: staff of one cooperative share a single public
address, so a tight per-IP limit locks the whole office out at once while doing nothing the
per-account limit does not already do better.
The assistant is limited per user and again per cooperative, and SMS per cooperative, because both
cost money. Limits return `429`
with a `Retry-After` header rather than failing silently.

## 9. Logging and privacy

Pino with a redaction list covering `password`, `passwordHash`, `token`, `authorization`, `cookie`,
`nationalId`, `phone` and file buffers. The request line carries the path and the **names** of the
query parameters, never their values: `GET /search?q=Mukamana` is logged as `/search` with
`queryNames: ["q"]`, because who a cooperative searched for is not something an operator or a
hosting platform needs to keep. No request body is logged at info level. Audit `before` and `after`
snapshots pass through the same redaction. Errors log a stack trace and a request id; the user sees
a translated sentence and the request id, never a stack trace. National identity numbers are stored
only when supplied, are masked in list responses, and appear in full only on the member detail
screen to a user holding `members:update`.

### What is written to the browser's storage, and what is not (Phase 13)

Three things are kept on the device, and the list is exhaustive:

| Kept                                               | Why                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The language, the sidebar state, the table density | Preferences. Nothing about the cooperative.                                                               |
| The query cache                                    | A reload during an outage comes back with the figures the reader last saw, rather than a blank afternoon. |
| Form drafts                                        | What was typed into a sale or a new member's registration, so a reload does not throw an afternoon away.  |

**The access token is not among them**, and neither is the refresh token: the first lives in memory
and the second in an `HttpOnly` cookie, for the reasons §3 gives. Persisting the cache does not
weaken that — a cache is data the reader was already looking at on that screen, not a credential
that would let somebody fetch more.

The cost is real and worth stating plainly: on a shared office computer, a cooperative's member
register and this month's figures are on the disk after the browser is closed. Four things bound it.

- **Scoped to the reader.** The storage key names the signed-in user and the cooperative they were
  working in, so one person's cache cannot hydrate into another's session and one cooperative's
  figures cannot appear on another's screens.
- **Cleared on sign-out.** Every key, not only the current one, along with every form draft. A
  cooperative that signs out has left nothing behind.
- **Expires after a day.** Older than that and showing it would mislead rather than help.
- **Busted by each build.** A deployment that changes the shape of a response cannot hydrate
  yesterday's shape into today's screens.

A cooperative that judges even that too much on a particular machine has the same answer as for any
browser storage: sign out. That is the action the guarantee is attached to.

**Nothing is queued for later.** No financial write waits for a connection. An unrecorded entry
stays unrecorded and visible, because a queue of pending writes would be a second source of truth
about a cooperative's money — and the one thing worse than an entry that has to be retyped is an
entry a cooperative believes was recorded.

---

## 10. Secrets

No secret is committed. `.env` is gitignored, `.env.example` carries placeholders, and a
`gitleaks` scan runs in CI over the whole history on every push, beside a pre-commit hook that
refuses the obvious shapes of a credential in staged files. Secrets live in the
hosting platform's environment configuration. The environment schema fails the boot if a production
secret is missing or is still the example value, and `npm run check:env` runs the same check on a
file before it is pasted anywhere. Phase 18 re-scanned the history by hand for secret-shaped
assignments and found only placeholders, test values and documentation.

The production image is built from a `.dockerignore` that excludes every `.env` but
`.env.example`, the test directories and the upload store, so an image pushed to a registry carries
no credential and no cooperative's file. The seeded administrator's bootstrap password is
single-use in production (`mustChangePassword`), and the runbook removes it from the environment
once used.

## 11. Dependencies

`npm audit` and a lockfile-diff review in CI. Pinned major versions, no automatic upgrades on
deploy. Dependencies are added deliberately; a dependency that saves twenty lines is not worth its
supply-chain surface.

`pdfkit` was added in Phase 8 for the server-rendered PDF, chosen over a headless browser — which
would have meant shipping Chromium into a Rwandan cooperative's hosting budget — and over `pdf-lib`,
unmaintained since 2022. `npm audit` reports no new advisory from it.

### Accepted advisories, and the gate that keeps the list honest

Two advisories are accepted rather than fixed, both reached only through the Prisma command-line
tool — a development dependency that creates migrations and generates the client, and is not part
of any deployed artefact:

| Module         | Advisory                                 | Why it cannot affect this product                                                                                                                                               | Review by  |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `mysql2`       | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 | A MySQL driver. This product is PostgreSQL only, connects through `@prisma/adapter-pg`, never loads `mysql2`, and both advisories require connecting to a hostile MySQL server. | 2026-12-31 |
| `deepmerge-ts` | GHSA-ggr8-5vv4-36mx                      | Stack exhaustion merging a recursive object, reached when the CLI reads `prisma.config.ts` — our own committed file. No request or upload reaches it.                           | 2026-12-31 |

Prisma pins `mysql2` exactly, so an npm override cannot lift it, and there is no 7.x release with a
patched pin as of the review date. The only remedy npm offers is a downgrade to Prisma 6, which
trades a development-only issue for an out-of-date data layer.

**The Phase 15 review found that CI's audit step was failing on these**, because `npm audit
--omit=dev` at a workspace root still counts a workspace package's development dependencies. The
tempting fix — lower the threshold — is how an audit stops being read. Instead `scripts/audit/check.mjs`
keeps the threshold at high and accepts the two modules above by name, each with the reason and
the review date, and it **fails the build the day either stops being reported**, so the exception is
deleted rather than left covering an advisory nobody has looked at. `npm run check:audit` is the CI
step; this table and that file say the same thing, and a change to one is a change to both.

## 12. The Phase 15 review

Authentication flows, authorization matrix, cross-tenant sweep, upload handling, validation
coverage, rate limits, CORS and headers, secret scanning, log redaction, injection review, XSS
review of every place HTML could be rendered, CSRF review, access-control review of every route
added since Phase 2, audit-log coverage of every sensitive action, and a dependency audit. Every
finding is fixed or carries a written, accepted risk note — this section is that record.

### What was checked, and how

| Area               | Method                                                                                                                                 | Result                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Injection          | Every `$queryRaw`/`$executeRaw` read by hand; no `Unsafe` variant exists; every interpolation is a value                               | Clean                                               |
| XSS                | No `dangerouslySetInnerHTML` or `innerHTML` anywhere; every server-provided link target reviewed                                       | Finding 6 (fenced)                                  |
| CSV injection      | All three CSV exports guard a leading `= + - @`                                                                                        | Finding 5 (three copies, two weaker — consolidated) |
| Headers            | Live response inspected: CSP with `object-src 'none'` and `frame-ancestors 'none'`, HSTS, nosniff, DENY, COOP, CORP, no `X-Powered-By` | Finding 7 (`Permissions-Policy` added)              |
| CORS               | Live: an allowed origin gets credentials and exposed headers; a hostile origin gets nothing; a hostile preflight gets 403              | Clean                                               |
| CSRF               | Only `/auth/refresh` and `/auth/logout` accept a cookie; both check `Origin` and answer 403 to a hostile one, verified live            | Finding 3 (`SameSite` made explicit)                |
| Cookies            | `HttpOnly`, `Secure` in production, scoped to the two paths that consume it                                                            | Clean                                               |
| Passwords          | Argon2id at RFC 9106's memory-constrained parameters, per-password salt, common-password list, 10-character minimum                    | Clean                                               |
| Secrets in history | No `.env` ever added; credential-shaped assignments across every commit reviewed; gitleaks in CI                                       | Clean                                               |
| Logging            | Redaction list reviewed against every field added since Phase 2; `pino-http`'s default request line reviewed                           | Findings 2 and 8                                    |
| Tenancy            | The cross-tenant sweep fails the build for any parameterised route not declared; 23 routes swept                                       | Clean                                               |
| Authorization      | The route registry fails the build for any route without an access declaration; the role matrix is tested                              | Clean                                               |
| Validation         | Every body-carrying route compared with its schema; six carry no body by design and validate none                                      | Clean (the six are listed below)                    |
| Uploads            | One file, one field, a size cap, extension + MIME + magic bytes compared, executables refused first                                    | Clean                                               |
| Rate limits        | Every documented limit compared with the code                                                                                          | Findings from Phases 12 and 14 already closed       |
| Audit coverage     | 71 mutating routes cross-checked against 76 audit actions                                                                              | Finding 4                                           |
| Dependencies       | `npm audit`, production scope                                                                                                          | Finding 1                                           |
| Seed               | What the seed does under `NODE_ENV=production`                                                                                         | Finding 9                                           |

### Findings

1. **CI's dependency audit was failing** on two advisories reached only through the Prisma CLI.
   Fixed by the gate described in §11: threshold kept, exceptions named with reasons and review
   dates, stale exceptions fail the build.
2. **Search terms were written to the log.** `pino-http` records the whole URL, so
   `GET /search?q=Mukamana` put a member's name in the log and `GET /members?q=0788123456` a
   telephone number — logs that operators read and a hosting platform retains. Fixed: the request
   line carries the path and the **names** of the query parameters, never their values. `*.phone`
   and `*.toPhone` joined the redaction list beside `*.nationalId`.
3. **`SameSite=Lax` silently breaks sign-in across two sites.** The refresh cookie was hard-coded
   `lax`, which is the stronger setting and requires the browser application and the API to be
   the same site. Deployed on a default Vercel domain and a default Railway one they are not; the
   cookie is never sent, the refresh fails, and every session ends fifteen minutes in with nothing
   in any log. Invisible in development, where both are localhost. Fixed: `COOKIE_SAMESITE` is a
   stated choice defaulting to `lax`, `none` is refused without HTTPS, and `docs/deployment.md`
   states the same-site requirement.
4. **`POST /sms/send` wrote no audit entry.** Sending a batch to members spends money and reaches
   telephones; the message log recorded what was sent, but the trail an auditor reads had no line
   saying somebody sent it. Publishing an announcement had written one since Phase 12. Fixed:
   `sms.sent`, carrying the count and never the body.
5. **Three copies of the CSV formula guard, two weaker.** The report renderer guarded six leading
   characters; the members and ledger exports guarded four, missing tab and carriage return, which
   some spreadsheets strip before deciding what a cell is. Fixed: one `csvCell` in `lib/csv.ts`,
   the strong version, used by all three and pinned by its own tests.
6. **Four screens rendered a link target that arrived from the server** — a notification's
   `actionUrl`, a dashboard tile's `href`, an assistant answer's. Every value is written by our
   own code from a constant, so nothing was exploitable. Fixed anyway: `internalPath` refuses
   anything that is not a same-origin path, so the day a module writes something
   attacker-influenced into `notifications.action_url` the link does not render rather than
   becoming a `javascript:` URL in the cooperative's own chrome.
7. **No `Permissions-Policy` header.** Helmet sets none. Added: camera, microphone, geolocation,
   payment, USB and the sensors all denied on every API response, and `docs/deployment.md` asks the
   static host to send the same.
8. **`*.phone` was not redacted.** Phase 12 gave the application a reason to hold a telephone
   number in a log line — the mock provider logs a message's destination at debug level. Fixed as
   part of finding 2.
9. **`SEED_DEMO=true` in production would create five accounts sharing one password.** Nothing
   stopped it; the guard on the platform administrator did not cover the demonstration cooperative.
   Fixed: the seed refuses, with a message saying why, verified by running it under
   `NODE_ENV=production`.

### Reviewed and accepted as they are

- **Six routes carry a body method and validate no body:** `POST /auth/refresh`, `POST /auth/logout`,
  `POST /documents/:id/restore`, `POST /notifications/read-all`, `/:id/read` and `/:id/dismiss`.
  Each genuinely takes nothing. A body sent to them is parsed and ignored, bounded by the 1 MB
  body limit and the write rate limit. Adding an empty strict schema would refuse a client that
  sends `{}` for no gain.
- **`style-src 'unsafe-inline'` in the CSP.** The hand-drawn charts set bar heights through inline
  `style` attributes, which `style-src` governs. Inline styles cannot execute script and
  `script-src` carries no such allowance; the trade is a well-understood one and is bounded to
  presentation.
- **A member's telephone number and national identity number are in the audit trail's `before`
  and `after` snapshots** for a member update, because the trail exists to show what changed.
  They are redacted from the _log_, masked in list responses, and shown in full only to a holder of
  `members:update`. That is the design.
- **The two Prisma CLI advisories**, per §11.

### Not in scope, recorded so nobody thinks it was forgotten

- `prisma migrate reset` from an empty database. Phase 17 answered it without a reset:
  `npm run check:migrations` builds a throwaway database from nothing and compares it with the
  schema, and Phase 18's rehearsal deploys the production image against one.
- A penetration test by a party who did not write the code. This review was a structured pass by
  the author against a written checklist; it is not a substitute for one.
