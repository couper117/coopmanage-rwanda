import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { signRequest } from '../lib/storage/sigv4.js'

/**
 * A backup of the database: one `pg_dump` in custom format, named by the UTC minute it was taken,
 * kept locally and — when a bucket is configured — copied off the machine.
 *
 * `docs/deployment.md` §4 is the procedure this implements. The points that matter:
 *
 * - **Custom format** (`-Fc`), so `pg_restore` can rebuild the schema and the data selectively,
 *   and so the dump is compressed without a second tool.
 * - **Off-site is a separate bucket with separate credentials** from the documents bucket. A key
 *   that can read a cooperative's land title need not be able to read the whole database, and the
 *   reverse. `BACKUP_S3_*` name it.
 * - **A checksum beside the dump**, written before upload and checked by the restore script, so
 *   a dump that was cut short by a full disk or a dropped connection is not the one restored.
 * - **Retention is pruned here**, by count rather than by date, so a machine whose clock is wrong
 *   still keeps the newest N. Off-site retention is the bucket's lifecycle rule (90 days).
 *
 * The connection string is read from `DATABASE_URL` — or `BACKUP_DATABASE_URL` where the pooled
 * runtime connection is not the one to dump from, which on Supabase it is not: dump from the
 * direct connection. Nothing here prints the URL; `pg_dump` receives it through the environment.
 *
 * `pg_dump`'s major version must not be newer than the server's: a dump written by a newer client
 * carries settings an older server refuses on restore. `PG_BIN` points at the client to use where
 * the one on the PATH is the wrong one.
 *
 *   npm run db:backup                     # to ./backups
 *   BACKUP_DIR=/var/backups npm run db:backup
 */
const configuredUrl =
  process.env.BACKUP_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!configuredUrl) {
  process.stderr.write('BACKUP_DATABASE_URL, DIRECT_URL or DATABASE_URL must be set\n')
  process.exit(1)
}
const databaseUrl = libpqUrl(configuredUrl)

/** Prisma's `?schema=` parameter is its own; libpq refuses a query parameter it does not know. */
function libpqUrl(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('schema')
  return parsed.toString()
}

const directory = resolve(process.env.BACKUP_DIR ?? './backups')
const keep = Number(process.env.BACKUP_KEEP ?? 14)
mkdirSync(directory, { recursive: true })

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z')
const name = `coopmanage-${stamp}.dump`
const path = join(directory, name)

const pgDump = process.env.PG_BIN ? join(process.env.PG_BIN, 'pg_dump') : 'pg_dump'

process.stdout.write(`Dumping the database to ${path}…\n`)
// Written through stdout rather than `--file`, so the client need not share this filesystem — a
// `pg_dump` run in a container beside the database works the same as one on this machine.
const out = openSync(path, 'w')
const dump = spawnSync(
  pgDump,
  ['--format=custom', '--no-owner', '--no-privileges', '--compress=6', databaseUrl],
  { stdio: ['ignore', out, 'inherit'] },
)
closeSync(out)
if (dump.status !== 0) {
  process.stderr.write(`pg_dump exited with ${dump.status ?? 'a signal'}\n`)
  try {
    unlinkSync(path)
  } catch {
    // Nothing to remove.
  }
  process.exit(1)
}

const bytes = readFileSync(path)
const checksum = createHash('sha256').update(bytes).digest('hex')
const checksumPath = `${path}.sha256`
// The same line format `sha256sum -c` reads, so the check can be done without this script.
const checksumLine = `${checksum}  ${name}\n`
writeFileSync(checksumPath, checksumLine)
process.stdout.write(
  `  ${(bytes.length / 1024 / 1024).toFixed(1)} MB, sha256 ${checksum.slice(0, 12)}…\n`,
)

// Off-site copy.
const endpoint = process.env.BACKUP_S3_ENDPOINT
const bucket = process.env.BACKUP_S3_BUCKET
const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID
const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY
if (endpoint && bucket && accessKeyId && secretAccessKey) {
  const region = process.env.BACKUP_S3_REGION ?? 'us-east-1'
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  const upload = async (objectName: string, body: Buffer, contentType: string) => {
    const url = new URL(`${bucket}/${objectName}`, base)
    const signed = signRequest({ accessKeyId, secretAccessKey, region }, 'PUT', url, body, {
      'content-type': contentType,
      'content-length': String(body.length),
    })
    const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body })
    await response.body?.cancel()
    if (!response.ok) throw new Error(`upload of ${objectName} failed: HTTP ${response.status}`)
  }
  process.stdout.write(`Copying to ${new URL(base).host}/${bucket}…\n`)
  await upload(name, bytes, 'application/octet-stream')
  await upload(`${name}.sha256`, Buffer.from(checksumLine), 'text/plain')
  process.stdout.write('  Copied.\n')
} else {
  process.stdout.write('No BACKUP_S3_* configured: the dump stays on this machine only.\n')
}

// Retention.
const dumps = readdirSync(directory)
  .filter((file) => /^coopmanage-\d{8}T\d{6}Z\.dump$/.test(file))
  .sort()
const stale = dumps.slice(0, Math.max(0, dumps.length - keep))
for (const file of stale) {
  unlinkSync(join(directory, file))
  try {
    unlinkSync(join(directory, `${file}.sha256`))
  } catch {
    // An older dump without a checksum file.
  }
}
if (stale.length > 0) process.stdout.write(`Removed ${stale.length} older dump(s); ${keep} kept.\n`)

const size = statSync(path).size
process.stdout.write(`Backup complete: ${name} (${size} bytes)\n`)
