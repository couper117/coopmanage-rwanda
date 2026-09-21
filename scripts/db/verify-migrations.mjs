import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Proves that the migrations build the schema from nothing.
 *
 * The development database has had every migration applied in order, one phase at a time, and a
 * database that has been migrated forward for seventeen phases is not proof that a fresh one can
 * be. Production starts empty. So this creates a throwaway database beside the development one,
 * runs `prisma migrate deploy` into it exactly as a deployment would, checks that what the
 * migrations built is what `schema.prisma` describes, runs the seed into it, and drops it.
 *
 * It never touches the database in `DATABASE_URL`. `prisma migrate reset` would prove the same
 * thing by destroying a developer's data, which is why this exists instead: the check can run on
 * every developer's machine and in CI without anyone consenting to lose anything.
 *
 * Exit codes: 0 when the migrations build the schema and the seed runs; 1 otherwise, with the
 * reason on stderr.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND = resolve(HERE, '../../apps/backend')

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = readFileSync(resolve(BACKEND, '.env'), 'utf8')
  const line = env.split('\n').find((row) => row.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL is not set and apps/backend/.env does not define it')
  return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '')
}

const source = new URL(readDatabaseUrl())
const sourceName = source.pathname.slice(1)
const checkName = `${sourceName}_migrate_check`

const maintenance = new URL(source)
maintenance.pathname = '/postgres'
const check = new URL(source)
check.pathname = `/${checkName}`

function run(args, extraEnv = {}) {
  const result = spawnSync('npx', ['prisma', ...args], {
    cwd: BACKEND,
    env: {
      ...process.env,
      DATABASE_URL: check.toString(),
      DIRECT_URL: check.toString(),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  return result
}

const client = new pg.Client({ connectionString: maintenance.toString() })
await client.connect()

async function drop() {
  await client.query(`DROP DATABASE IF EXISTS "${checkName}" WITH (FORCE)`)
}

let failed = false
try {
  await drop()
  await client.query(`CREATE DATABASE "${checkName}"`)

  // The extensions the schema depends on are created by the container's init script for the
  // development database, and by the hosting provider's setup for production; here they are what
  // `scripts/db-init/01-extensions.sql` creates, applied the same way.
  const fresh = new pg.Client({ connectionString: check.toString() })
  await fresh.connect()
  try {
    await fresh.query(readFileSync(resolve(HERE, '../db-init/01-extensions.sql'), 'utf8'))
  } finally {
    await fresh.end()
  }

  process.stdout.write(`Migrating an empty database (${checkName})…\n`)
  const deploy = run(['migrate', 'deploy'])
  if (deploy.status !== 0) {
    process.stderr.write(deploy.stdout + deploy.stderr)
    throw new Error('prisma migrate deploy failed against an empty database')
  }
  const applied = (deploy.stdout.match(/\d{14}_\w+\//g) ?? []).length
  const found = Number(/(\d+) migrations? found/.exec(deploy.stdout)?.[1] ?? 0)
  if (applied === 0 || applied !== found) {
    process.stderr.write(deploy.stdout)
    throw new Error(`expected every one of the ${found} migrations to be applied; ${applied} were`)
  }
  process.stdout.write(`  ${applied} migrations applied.\n`)

  process.stdout.write('Comparing what they built with schema.prisma…\n')
  const diff = run([
    'migrate',
    'diff',
    // The config file's datasource is the check database: `run` points DATABASE_URL at it.
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ])
  if (diff.status === 2) {
    process.stderr.write('The migrations do not build what schema.prisma describes:\n')
    process.stderr.write(diff.stdout + diff.stderr)
    throw new Error('schema drift')
  }
  if (diff.status !== 0) {
    process.stderr.write(diff.stdout + diff.stderr)
    throw new Error('prisma migrate diff failed')
  }
  process.stdout.write('  No drift.\n')

  process.stdout.write('Seeding it, the way a first deployment is seeded…\n')
  const seed = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: check.toString(), SEED_DEMO: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  if (seed.status !== 0) {
    process.stderr.write(seed.stdout + seed.stderr)
    throw new Error('the seed failed against a freshly migrated database')
  }
  process.stdout.write('  Seeded.\n')
  process.stdout.write('Migrations verified from empty.\n')
} catch (error) {
  failed = true
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  await drop()
  await client.end()
}

process.exit(failed ? 1 : 0)
