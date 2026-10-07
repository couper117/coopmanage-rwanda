# CoopManage Rwanda — Where things stand

Last updated: **7 October 2026**, at the end of the session that finished Phase 18.

This file is the one to read first when picking the project up again. `docs/roadmap.md` says what
was built and why; this says what state it is in today, what is still open, and how to get
running in five minutes.

---

## 1. State

**All eighteen phases are complete.** The product is built, tested, reviewed, and its deployment
has been rehearsed with the real production image. Nothing is half-finished in the working tree.

|               |                                                                                |
| ------------- | ------------------------------------------------------------------------------ |
| Branch        | `main`, clean, nothing uncommitted                                             |
| Latest commit | `21aaf1c` — build the shared package on install, so a fresh clone runs         |
| Remote        | `git@github.com:couper117/coopmanage-rwanda.git` — pushed, nothing outstanding |
| Tests         | shared 81 · backend 787 · frontend 517 — all green locally                     |
| Build         | both applications build; first load 263 kB gzipped                             |

The last five commits, newest first:

| Commit    | What it did                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------- |
| `21aaf1c` | The shared package now compiles on `npm install`, so a fresh clone runs without a manual build |
| `3adc8e8` | The Prisma client is generated on install — Prisma 7 stopped doing it by itself                |
| `f542ae8` | Enforced the password-change hold; gave the production image a writable backup directory       |
| `8a2b9e1` | Phase 18 — image, deployment rehearsal, S3 and SMTP drivers, backup and restore                |
| `8b0486b` | Phase 17 — endpoint-coverage gate, nine-flow end-to-end test, coverage floors                  |

---

## 2. Open, and the first thing to pick up

**CI has never passed on GitHub.** Three runs, three failures, always at the same step:
`Lint, typecheck, test, build → Seed reference data`. The other three jobs — dependency audit,
secret scan, and the deployment rehearsal's prerequisites — are fine.

Two causes were found and fixed by reproducing the runner locally under Node 20 on Linux: the
Prisma client was not generated on a clean `npm ci` (`3adc8e8`), and the shared package was not
built (`21aaf1c`). After both fixes the same sequence passes locally in a Node 20 container and
from a fresh clone, and CI still fails in about one second.

**It needs the runner's log, which nobody has read yet.** GitHub does not serve job logs to an
unauthenticated reader, and the `gh` CLI on this machine is not logged in. So:

```bash
gh auth login          # then the log is readable, and the cause findable
```

Or open the run and copy the last twenty lines of that step:
<https://github.com/couper117/coopmanage-rwanda/actions>

A one-second failure after `migrate deploy` succeeded points at something failing on import,
before the seed does any work — a missing generated artefact or an environment variable the
runner does not have. Both candidates we could think of are now fixed, so the log is the only way
forward; guessing further just burns runs.

---

## 3. Running it

Needs Node 20+, npm and Docker.

```bash
cd ~/Desktop/projects/coopmanage-rwanda
npm install                  # builds the shared package and the Prisma client
cp apps/backend/.env.example apps/backend/.env
npm run db:up                # PostgreSQL 16 in Docker, port 5435
npm run db:migrate
SEED_DEMO=true SEED_ADMIN_PASSWORD='choose-something-long' \
  SEED_DEMO_PASSWORD='choose-something-long' npm run db:seed
npm run dev                  # web on 5175, API on 4000
```

Then open **<http://localhost:5175>**.

`apps/backend/.env` already exists on this machine and is git-ignored; the seed passwords in it
are the ones the demonstration accounts use. The seed never resets a password it did not set, so
re-running it is safe.

Ports are 5435, 4000 and 5175 to avoid other projects on this machine. Vite uses `strictPort`, so
a clash fails loudly — if the web server refuses to start, something else is on 5175.

### The demonstration cooperative

`SEED_DEMO=true` creates _Umurenge Farmers Cooperative_ with a member of staff in each of the five
roles, so every screen can be seen as each role sees it. It is flagged as demonstration data and
labelled as such wherever its name appears.

| Role                   | Email                                 |
| ---------------------- | ------------------------------------- |
| Platform administrator | `admin@coopmanage.rw`                 |
| Manager                | `uwimana.claudine@umurenge-coop.rw`   |
| Accountant             | `habimana.eric@umurenge-coop.rw`      |
| Secretary              | `mukamana.solange@umurenge-coop.rw`   |
| Inventory officer      | `nsengimana.patrick@umurenge-coop.rw` |

All use whatever `SEED_DEMO_PASSWORD` was set to.

Worth a look: the language switch in the top bar turns the whole interface, reports included, into
Kinyarwanda; `?` lists the keyboard shortcuts; `g` then a letter jumps to a screen; and **Ask
CoopManage** answers a question in either language from the records.

---

## 4. The checks, and what each is for

```bash
npm run lint && npm run typecheck && npm run check:translations && npm run test && npm run build
npm run check:audit        # dependency advisories, against a reviewed exception list
npm run check:migrations   # the migrations build the schema from an empty database
npm run deploy:rehearse    # the production image, deployed from empty (needs Docker)
```

Two backend suites run against a real service when one is present and skip themselves otherwise —
a mock of a protocol only tests the mock:

```bash
docker run -d --name minio -p 9100:9000 -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio:latest server /data
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH=user:pass \
  -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit:latest

S3_TEST_ENDPOINT=http://127.0.0.1:9100 SMTP_TEST_URL=smtp://user:pass@127.0.0.1:1025 npm test
```

`npm run deploy:rehearse` is the one worth running before any deployment conversation: it builds
the production image, deploys it against an empty database, an object store and a mail server,
signs in, and creates the first cooperative — then drops everything it made.

---

## 5. To go live

Nothing is blocked on code. Three accounts are needed, and `docs/deployment.md` §3 is the
nine-step runbook with what to check at each step:

1. **A Supabase project** — the database and a private `documents` bucket with an S3 key.
2. **A Railway service** — it reads `apps/backend/railway.json`; a second service for the weekly
   backup reads `railway.backup.json`.
3. **A Vercel project** — root directory `apps/frontend`; `vercel.json` carries everything except
   one value: replace `REPLACE_WITH_API_HOST` in the rewrite with the Railway host.
4. **A mail account** — without `MAIL_DRIVER=smtp` no new account can be activated, because the
   password link is never written to a production log on purpose.

Run `npm run check:env -- production.env` on the variables before pasting them anywhere: it runs
the boot validation offline, prints every problem at once, and echoes no value.

---

## 6. Things worth knowing before changing anything

- **Money is decimal strings, never floats**, end to end. `COUNTS_TOWARDS_TOTALS` in the finance
  service decides what a total includes.
- **Nothing financial is deleted.** A mistake is voided or reversed and both rows stay.
- **A wrong tenant is a 404, never a 403**, and `test/tenancy.test.ts` sweeps every parameterised
  route — a new route that is not declared to it fails the build.
- **Every endpoint must have a passing test.** The route registry records what the suite reached;
  the teardown fails the run naming any of the 144 routes that no test exercised successfully.
- **Both languages or neither.** `npm run check:translations` fails on a key added in one language
  and not the other, a renamed placeholder, or a Kinyarwanda string left as a copy of the English.
- **The server sends `messageKey` and parameters, not sentences.** The interface renders them. A
  `xRw` parameter is the Kinyarwanda rendering of `x`; `docs/glossary.md` §7–8 explains.
- **`prisma migrate reset` is never the procedure.** `npm run check:migrations` proves the
  migrations from empty without destroying anybody's data.

---

## 7. Documents

| Document                           | What it settles                                                      |
| ---------------------------------- | -------------------------------------------------------------------- |
| [roadmap.md](roadmap.md)           | The feature map and all eighteen phases with what each one met       |
| [architecture.md](architecture.md) | Shape, layering, tenancy, money, transactions                        |
| [database.md](database.md)         | Every table, constraint and index, and the migration plan            |
| [api.md](api.md)                   | The envelope, the error codes, every endpoint                        |
| [permissions.md](permissions.md)   | The catalogue and the role matrix                                    |
| [ui-system.md](ui-system.md)       | Colour, type, components, accessibility, loading                     |
| [glossary.md](glossary.md)         | The bilingual terminology, fixed before any string was written       |
| [security.md](security.md)         | Threat model, controls, and the Phase 15 findings register           |
| [testing.md](testing.md)           | What the suites prove, coverage, and what is deliberately not tested |
| [deployment.md](deployment.md)     | Environments, the runbook, backup and restore                        |

Module notes: [reports.md](reports.md), [documents-and-meetings.md](documents-and-meetings.md),
[dashboard-and-search.md](dashboard-and-search.md),
[announcements-and-sms.md](announcements-and-sms.md), [assistant.md](assistant.md).
