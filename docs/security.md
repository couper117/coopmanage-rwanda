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
composition rules that push people towards `Password1!`. Invited staff must change the password on
first login.

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

## 5. File uploads

Extension allow-list, declared MIME check, and magic-byte sniffing of the actual content, all three
required to agree. 10 MB default cap. Filenames are discarded and replaced by a random storage key;
the original name is kept only as metadata and is escaped on display. SVG is not accepted, because
it executes script. Files are stored outside the web root, never in a public bucket, and served only
through the authorised streaming endpoint with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`. A SHA-256 checksum is recorded.

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
`nationalId` and file buffers. No request body is logged at info level. Audit `before` and `after`
snapshots pass through the same redaction. Errors log a stack trace and a request id; the user sees
a translated sentence and the request id, never a stack trace. National identity numbers are stored
only when supplied, are masked in list responses, and appear in full only on the member detail
screen to a user holding `members:update`.

## 10. Secrets

No secret is committed. `.env` is gitignored, `.env.example` carries placeholders, and a
`gitleaks` scan runs in CI and as a pre-commit hook. Secrets live in the hosting platform's
environment configuration. The environment schema fails the boot if a production secret is missing
or is still the example value.

## 11. Dependencies

`npm audit` and a lockfile-diff review in CI. Pinned major versions, no automatic upgrades on
deploy. Dependencies are added deliberately; a dependency that saves twenty lines is not worth its
supply-chain surface.

Two advisories are currently accepted rather than fixed, both inside the Prisma command-line tool,
which is a development dependency and is not part of any deployed artefact: `deepmerge-ts` reached
through `@prisma/config`, and `mysql2`, a driver this project never loads because it uses
PostgreSQL. The only remedy npm offers is a downgrade to Prisma 6, which trades a development-only
issue for an out-of-date data layer. Both are re-examined at Phase 15 and on every Prisma upgrade.

## 12. Phase 15 audit checklist

Authentication flows, authorization matrix, cross-tenant sweep, upload handling, validation
coverage, rate limits, CORS and headers, secret scanning, log redaction, injection review, XSS
review of every place HTML could be rendered, CSRF review, access-control review of every route
added since Phase 2, audit-log coverage of every sensitive action, and a dependency audit. Every
finding is fixed or carries a written, accepted risk note signed off in the pull request.
