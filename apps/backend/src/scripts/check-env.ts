import { readFileSync } from 'node:fs'
import { parse as parseDotenv } from 'dotenv'
import { parseEnv } from '../config/env.js'

/**
 * Checks a production environment file before it is pasted into a hosting dashboard.
 *
 *   npm run check:env -- path/to/production.env
 *
 * Runs the same validation the server runs at boot, with `NODE_ENV` forced to `production`, and
 * prints every problem at once rather than the first — so a deployment is not a cycle of deploy,
 * read one error, fix it, deploy again. Nothing is loaded into this process's environment and
 * nothing is printed but the names of variables and what is wrong with them; a value is never
 * echoed.
 *
 * It also says what the boot check cannot: which values look like they were copied from
 * `.env.example` and which secrets are shorter than they should be, before they reach a server.
 */
const [file] = process.argv.slice(2)
if (!file) {
  process.stderr.write('usage: check-env <env file>\n')
  process.exit(2)
}

const raw = readFileSync(file, 'utf8')
const values: NodeJS.ProcessEnv = { ...parseDotenv(raw), NODE_ENV: 'production' }

const warnings: string[] = []
const secretLike = /SECRET|PASSWORD|KEY/i
for (const [name, value] of Object.entries(values)) {
  if (!value) continue
  if (
    /replace-me|example|changeme|change-me/i.test(value) &&
    !name.startsWith('SEED_ADMIN_EMAIL')
  ) {
    warnings.push(`${name} looks like a placeholder`)
  }
  if (
    secretLike.test(name) &&
    value.length < 24 &&
    !/^(local|s3|mock|rules|lax|none)$/.test(value)
  ) {
    warnings.push(`${name} is shorter than a generated secret would be`)
  }
}
if (values.SEED_DEMO === 'true' || values.SEED_DEMO === '1') {
  warnings.push('SEED_DEMO is on: the seed refuses this in production, and it should stay off')
}
if (values.ENABLE_API_DOCS === 'true') {
  warnings.push('ENABLE_API_DOCS is on: the API documentation will be public')
}
if (!values.DIRECT_URL) {
  warnings.push('DIRECT_URL is unset: migrations and backups will use the pooled DATABASE_URL')
}

try {
  parseEnv(values)
  process.stdout.write(`${file}: valid for production.\n`)
} catch (error) {
  process.stderr.write(`${file}: ${error instanceof Error ? error.message : String(error)}\n`)
  for (const warning of warnings) process.stderr.write(`  warning: ${warning}\n`)
  process.exit(1)
}
for (const warning of warnings) process.stdout.write(`  warning: ${warning}\n`)
process.exit(warnings.length > 0 ? 1 : 0)
