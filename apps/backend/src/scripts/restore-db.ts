import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import pg from 'pg'

/**
 * Restores a dump into a database and proves the result is usable.
 *
 *   npm run db:restore -- <dump file> <target database name>
 *
 * The procedure `docs/deployment.md` §4 describes, executed rather than described:
 *
 * 1. The dump's checksum is checked against the `.sha256` beside it. A dump cut short by a full
 *    disk restores without error and is missing its last tables; the checksum is what catches it.
 * 2. The target database is **created by this script and must not already exist**, and it must
 *    not be the database `DATABASE_URL` points at. A restore is rehearsed into a scratch
 *    database and, when it is real, into a fresh one that the application is then pointed at.
 *    Restoring over the live database is never the procedure, so the script does not offer it.
 * 3. `pg_restore --no-owner --no-privileges`, because the roles on the source and the target are
 *    not the same roles.
 * 4. `prisma migrate status` against the result, to prove the schema the dump carries is the
 *    schema this code expects — a dump from an older release is restored and then migrated, and
 *    this is where that is found out.
 * 5. Row counts from the tables a cooperative would notice first, printed, so the person doing
 *    the restore can compare them with what they expected before pointing anything at it.
 *
 * Nothing here prints a connection string.
 */
const [dumpArg, targetName] = process.argv.slice(2)
if (!dumpArg || !targetName) {
  process.stderr.write('usage: restore-db <dump file> <target database name>\n')
  process.exit(2)
}
if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetName)) {
  process.stderr.write(
    'the target database name must be lower-case letters, digits and underscores\n',
  )
  process.exit(2)
}

const dumpPath = resolve(dumpArg)
if (!existsSync(dumpPath)) {
  process.stderr.write(`no such dump: ${dumpPath}\n`)
  process.exit(2)
}

const sourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!sourceUrl) {
  process.stderr.write('DATABASE_URL must be set: the target is created on the same server\n')
  process.exit(2)
}
const source = new URL(sourceUrl)
if (source.pathname.slice(1) === targetName) {
  process.stderr.write('refusing to restore over the database the application is using\n')
  process.exit(2)
}

// 1. Checksum.
const checksumPath = `${dumpPath}.sha256`
if (existsSync(checksumPath)) {
  const expected = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
  const actual = createHash('sha256').update(readFileSync(dumpPath)).digest('hex')
  if (expected !== actual) {
    process.stderr.write(`checksum mismatch: the dump is not the file that was backed up\n`)
    process.exit(1)
  }
  process.stdout.write(`Checksum verified for ${basename(dumpPath)}.\n`)
} else {
  process.stdout.write(`No checksum file beside ${basename(dumpPath)}; restoring unverified.\n`)
}

// 2. Target.
const maintenance = new URL(source)
maintenance.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${targetName}`
// Prisma's `?schema=` parameter is its own; libpq refuses a query parameter it does not know.
const targetForLibpq = new URL(target)
targetForLibpq.searchParams.delete('schema')

const admin = new pg.Client({ connectionString: maintenance.toString() })
await admin.connect()
const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetName])
if (existing.rowCount) {
  await admin.end()
  process.stderr.write(`database ${targetName} already exists; restore into a new one\n`)
  process.exit(1)
}
await admin.query(`CREATE DATABASE "${targetName}"`)
await admin.end()
process.stdout.write(`Created ${targetName}.\n`)

// 3. Restore. The extensions the schema needs are created by the dump itself (pg_dump records
// CREATE EXTENSION), which needs a role allowed to create them — on Supabase, the postgres role.
process.stdout.write('Restoring…\n')
const pgRestore = process.env.PG_BIN ? join(process.env.PG_BIN, 'pg_restore') : 'pg_restore'
// The dump is fed through stdin, so the client need not share this filesystem.
const input = openSync(dumpPath, 'r')
const restore = spawnSync(
  pgRestore,
  ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${targetForLibpq.toString()}`],
  { stdio: [input, 'inherit', 'inherit'] },
)
closeSync(input)
if (restore.status !== 0) {
  process.stderr.write(`pg_restore exited with ${restore.status ?? 'a signal'}\n`)
  process.exit(1)
}

// 4. The schema is the one the code expects.
process.stdout.write('Checking the schema against the migrations…\n')
const status = spawnSync('npx', ['prisma', 'migrate', 'status'], {
  env: { ...process.env, DATABASE_URL: target.toString(), DIRECT_URL: target.toString() },
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
})
if (status.status !== 0 || !/Database schema is up to date/.test(status.stdout)) {
  process.stderr.write(status.stdout + status.stderr)
  process.stderr.write(
    'the restored schema is behind the code: run `prisma migrate deploy` against it before use\n',
  )
  process.exit(1)
}
process.stdout.write('  Up to date with every migration.\n')

// 5. What came back.
const client = new pg.Client({ connectionString: target.toString() })
await client.connect()
try {
  const tables = [
    'cooperatives',
    'users',
    'members',
    'finance_transactions',
    'products',
    'inventory_transactions',
    'sales',
    'documents',
    'audit_log',
  ]
  process.stdout.write('Rows restored:\n')
  for (const table of tables) {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`)
    process.stdout.write(`  ${table.padEnd(24)} ${String(rows[0]?.n ?? 0).padStart(8)}\n`)
  }
} finally {
  await client.end()
}

process.stdout.write(
  `Restore complete into ${targetName}. Point the application at it only after checking the counts above; run inventory:rebuild against it to confirm the stock levels.\n`,
)
