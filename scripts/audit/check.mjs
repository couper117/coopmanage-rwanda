import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The dependency gate.
 *
 * `npm audit --audit-level=high` on its own has one failure mode that matters: the day it reports
 * something nobody can fix, a team lowers the threshold, and from then on it reports nothing worth
 * reading. This keeps the threshold and narrows the exception instead.
 *
 * Three rules, and the third is the one that stops an allow-list rotting.
 *
 * 1. **Any high or critical advisory fails the build**, unless its module is on the list below.
 * 2. **Each exception carries a reason and a review date.** A reason that does not say why the
 *    advisory cannot affect *this* product is not a reason.
 * 3. **An exception that is no longer needed fails the build too.** When Prisma ships a patched
 *    dependency, this tells us to delete the entry rather than letting it sit for a year covering
 *    an advisory nobody has looked at.
 *
 * Reviewed as part of Phase 15 and every phase after it. `docs/security.md` §11 carries the same
 * list in prose, for a reader who is not running the command.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

/**
 * Advisories accepted, by the module they are reported against.
 *
 * Both of these arrive through the **Prisma CLI**, which is a development dependency: it creates
 * migrations and generates the client. It is not imported by the server, and the production image
 * runs `node dist/server.js` against `@prisma/client` and `@prisma/adapter-pg`. `npm audit`
 * reports them under `--omit=dev` anyway, because the CLI is a dependency of a workspace package
 * rather than of the root.
 */
const ACCEPTED = [
  {
    module: 'mysql2',
    reason:
      'A MySQL driver, pulled in by the Prisma CLI because the CLI supports several databases. ' +
      'This product is PostgreSQL only — it connects through @prisma/adapter-pg and never loads ' +
      'mysql2 — and both advisories require connecting to a hostile MySQL server. Prisma pins the ' +
      'version exactly, so an npm override cannot lift it; there is no 7.x release with a patched ' +
      'pin as of the review date.',
    reviewedOn: '2026-09-17',
    reviewBy: '2026-12-31',
  },
  {
    module: 'deepmerge-ts',
    reason:
      'Stack exhaustion when merging a recursive object graph, reached through @prisma/config ' +
      'when the Prisma CLI reads prisma.config.ts. The only input is our own configuration file, ' +
      'committed to this repository; no request or uploaded file reaches it, and the CLI does not ' +
      'run in production.',
    reviewedOn: '2026-09-17',
    reviewBy: '2026-12-31',
  },
]

const FAILING = new Set(['high', 'critical'])

function audit() {
  try {
    // `npm audit` exits non-zero when it finds anything, so the output is read from the error.
    const stdout = execFileSync('npm', ['audit', '--json', '--omit=dev'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return JSON.parse(stdout)
  } catch (error) {
    const stdout = error?.stdout
    if (typeof stdout === 'string' && stdout.trim().length > 0) return JSON.parse(stdout)
    throw error
  }
}

const report = audit()
const vulnerabilities = report.vulnerabilities ?? {}

const failing = []
const seen = new Set()

for (const [name, entry] of Object.entries(vulnerabilities)) {
  if (!FAILING.has(entry.severity)) continue

  /**
   * Only the module the advisory is *about* counts.
   *
   * `npm audit` also lists every package that depends on a vulnerable one — here `prisma` and
   * `@prisma/config` — with the same severity. Accepting those parents as well would mean an
   * unrelated future advisory in `prisma` itself passed unnoticed, so the list names the module
   * the advisory was published against and the parents are matched through it.
   */
  const ownAdvisories = (entry.via ?? []).filter((via) => typeof via === 'object')
  if (ownAdvisories.length === 0) continue

  const accepted = ACCEPTED.find((row) => row.module === name)
  if (accepted) {
    seen.add(accepted.module)
    continue
  }

  for (const advisory of ownAdvisories) {
    failing.push(`${name}: ${advisory.title} (${advisory.url})`)
  }
}

const stale = ACCEPTED.filter((row) => !seen.has(row.module))

if (failing.length === 0 && stale.length === 0) {
  console.log(
    `Dependencies clean: no unaccepted high or critical advisory, ` +
      `${ACCEPTED.length} accepted and still present.`,
  )
  process.exit(0)
}

if (failing.length > 0) {
  console.error(`${failing.length} unaccepted high or critical advisory(ies):\n`)
  for (const line of failing) console.error(`  ${line}`)
  console.error(
    '\nFix it, or add it to ACCEPTED in scripts/audit/check.mjs with a reason saying why it ' +
      'cannot affect this product, and record the same reason in docs/security.md §11.',
  )
}

if (stale.length > 0) {
  console.error(`\n${stale.length} accepted advisory(ies) no longer reported — delete the entry:\n`)
  for (const row of stale) console.error(`  ${row.module} (accepted ${row.reviewedOn})`)
}

process.exit(1)
