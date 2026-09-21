import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * A deployment, rehearsed: the production image, a production environment, an empty database.
 *
 * This is Phase 18's exit criterion — "a clean deployment from an empty production database
 * succeeds" — run on a developer's machine with the same artefact and the same steps the hosting
 * platform runs, so the first deployment is the second time it has been done.
 *
 * What it does, in the order Railway does it:
 *
 * 1. Builds the backend image from `apps/backend/Dockerfile` (unless `--image` names one).
 * 2. Creates an empty database beside the development one, an empty object store (MinIO, in a
 *    container) and a mail server that requires credentials (Mailpit, likewise), which stand in
 *    for Supabase's database and storage and for the SMTP provider.
 * 3. Runs the pre-deploy command from `railway.json` in the image: `prisma migrate deploy`.
 * 4. Runs the seed, the way the runbook's first deployment does: reference data and one platform
 *    administrator, whose bootstrap password comes from the environment.
 * 5. Starts the image with `NODE_ENV=production` and a production-shaped environment, and waits
 *    for the health check `railway.json` names.
 * 6. Signs in as the administrator, reads the session back, and checks the security headers
 *    `docs/security.md` promises are on the response.
 * 7. Creates the first cooperative through the platform API and checks that its manager's
 *    password link arrived by e-mail (a mail catcher stands in for the SMTP provider) and that
 *    nothing of it reached the log.
 * 8. Stops everything and drops the database. Nothing it made survives.
 *
 * It never touches the database in `DATABASE_URL`, and nothing it prints is a secret.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const BACKEND = resolve(ROOT, 'apps/backend')

const args = process.argv.slice(2)
const imageArg = args.includes('--image') ? args[args.indexOf('--image') + 1] : null
const image = imageArg ?? 'coopmanage-api:rehearsal'

function sh(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stdout + result.stderr)
    throw new Error(`${command} ${commandArgs.slice(0, 3).join(' ')}… exited with ${result.status}`)
  }
  return result
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = readFileSync(resolve(BACKEND, '.env'), 'utf8')
  const line = env.split('\n').find((row) => row.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL is not set and apps/backend/.env does not define it')
  return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '')
}

const source = new URL(readDatabaseUrl())
const dbName = `${source.pathname.slice(1)}_deploy_check`
const maintenance = new URL(source)
maintenance.pathname = '/postgres'
const hostDb = new URL(source)
hostDb.pathname = `/${dbName}`
// Containers reach the developer's machine through Docker's host alias.
const containerDb = new URL(hostDb)
containerDb.hostname = 'host.docker.internal'

const MINIO = 'coopmanage-rehearsal-minio'
const MAILPIT = 'coopmanage-rehearsal-mail'
const API = 'coopmanage-rehearsal-api'
const MINIO_PORT = 9101
const SMTP_PORT = 1026
const MAIL_API_PORT = 8026
const API_PORT = 4100
const BUCKET = 'documents'
const adminEmail = 'admin@rehearsal.example'
const adminPassword = randomBytes(18).toString('base64url')

const productionEnv = {
  NODE_ENV: 'production',
  PORT: String(API_PORT),
  LOG_LEVEL: 'info',
  DATABASE_URL: containerDb.toString(),
  DIRECT_URL: containerDb.toString(),
  CORS_ORIGINS: 'https://app.rehearsal.example',
  APP_BASE_URL: 'https://app.rehearsal.example',
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  COOKIE_SAMESITE: 'lax',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: `http://host.docker.internal:${MINIO_PORT}`,
  S3_BUCKET: BUCKET,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'rehearsal',
  S3_SECRET_ACCESS_KEY: randomBytes(18).toString('base64url'),
  SMS_PROVIDER: 'mock',
  MAIL_DRIVER: 'smtp',
  SMTP_URL: `smtp://rehearsal:${randomBytes(12).toString('base64url')}@host.docker.internal:${SMTP_PORT}`,
  SMTP_FROM: 'CoopManage <no-reply@rehearsal.example>',
  ASSISTANT_PLANNER: 'rules',
  SEED_DEMO: 'false',
  SEED_ADMIN_EMAIL: adminEmail,
  SEED_ADMIN_PASSWORD: adminPassword,
}
const envFlags = Object.entries(productionEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`])
// Docker Desktop resolves `host.docker.internal` by itself; a Linux engine needs to be told.
const HOST_ALIAS = ['--add-host', 'host.docker.internal:host-gateway']

const admin = new pg.Client({ connectionString: maintenance.toString() })

async function cleanUp() {
  sh('docker', ['rm', '-f', API], { allowFailure: true })
  sh('docker', ['rm', '-f', MINIO], { allowFailure: true })
  sh('docker', ['rm', '-f', MAILPIT], { allowFailure: true })
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  } catch {
    // The connection may already be gone.
  }
}

async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${url} did not become healthy`)
}

const MAIL_API_URL = () => `http://127.0.0.1:${MAIL_API_PORT}`

let failed = false
await admin.connect()
try {
  await cleanUp()

  if (!imageArg) {
    process.stdout.write(`1. Building ${image} from apps/backend/Dockerfile…\n`)
    sh('docker', ['build', '-f', 'apps/backend/Dockerfile', '-t', image, '.'], { cwd: ROOT })
  } else {
    process.stdout.write(`1. Using image ${image}.\n`)
  }

  process.stdout.write(`2. Creating an empty database (${dbName}) and an empty object store…\n`)
  await admin.query(`CREATE DATABASE "${dbName}"`)
  const fresh = new pg.Client({ connectionString: hostDb.toString() })
  await fresh.connect()
  try {
    // What the hosting provider's database comes with; scripts/db-init has the same three lines.
    await fresh.query(readFileSync(resolve(ROOT, 'scripts/db-init/01-extensions.sql'), 'utf8'))
  } finally {
    await fresh.end()
  }
  sh('docker', [
    'run',
    '-d',
    '--name',
    MINIO,
    '-p',
    `${MINIO_PORT}:9000`,
    '-e',
    `MINIO_ROOT_USER=${productionEnv.S3_ACCESS_KEY_ID}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${productionEnv.S3_SECRET_ACCESS_KEY}`,
    'quay.io/minio/minio:latest',
    'server',
    '/data',
  ])
  await waitFor(`http://127.0.0.1:${MINIO_PORT}/minio/health/live`)
  // A mail server that requires the credentials in SMTP_URL, standing in for the provider's.
  const smtp = new URL(productionEnv.SMTP_URL)
  sh('docker', [
    'run',
    '-d',
    '--name',
    MAILPIT,
    '-p',
    `${SMTP_PORT}:1025`,
    '-p',
    `${MAIL_API_PORT}:8025`,
    '-e',
    `MP_SMTP_AUTH=${smtp.username}:${smtp.password}`,
    '-e',
    'MP_SMTP_AUTH_ALLOW_INSECURE=1',
    'axllent/mailpit:latest',
  ])
  await waitFor(`http://127.0.0.1:${MAIL_API_PORT}/api/v1/info`)
  // The bucket, created with the application's own signer, run inside the image.
  sh('docker', [
    'run',
    '--rm',
    ...HOST_ALIAS,
    ...envFlags,
    image,
    'node',
    '-e',
    `import('./dist/src/lib/storage/sigv4.js').then(async ({ signRequest }) => {
      const url = new URL('${BUCKET}', process.env.S3_ENDPOINT + '/');
      const signed = signRequest({ accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, region: 'us-east-1' }, 'PUT', url, null);
      const res = await fetch(signed.url, { method: 'PUT', headers: signed.headers });
      if (!res.ok && res.status !== 409) { console.error('bucket: HTTP ' + res.status); process.exit(1) }
    })`,
  ])

  process.stdout.write('3. Pre-deploy: prisma migrate deploy, in the image…\n')
  const migrate = sh('docker', [
    'run',
    '--rm',
    ...envFlags,
    image,
    'npx',
    'prisma',
    'migrate',
    'deploy',
  ])
  const applied = (migrate.stdout.match(/\d{14}_\w+\//g) ?? []).length
  process.stdout.write(`   ${applied} migrations applied.\n`)

  process.stdout.write('4. Seeding reference data and the platform administrator…\n')
  const seed = sh('docker', [
    'run',
    '--rm',
    ...HOST_ALIAS,
    ...envFlags,
    image,
    'node',
    'dist/prisma/seed.js',
  ])
  if (!seed.stdout.includes(`platform administrator: ${adminEmail}`)) {
    process.stderr.write(seed.stdout)
    throw new Error('the seed did not create the administrator')
  }

  process.stdout.write('5. Starting the image in production mode…\n')
  sh('docker', [
    'run',
    '-d',
    '--name',
    API,
    '-p',
    `${API_PORT}:${API_PORT}`,
    ...HOST_ALIAS,
    ...envFlags,
    image,
  ])
  const base = `http://127.0.0.1:${API_PORT}/api/v1`
  const ready = await waitFor(`${base}/health/ready`)
  process.stdout.write(`   ${base}/health/ready → ${ready.status}\n`)

  process.stdout.write('6. Signing in as the administrator and checking the response…\n')
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: productionEnv.CORS_ORIGINS },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  if (login.status !== 200) throw new Error(`login answered ${login.status}`)
  const session = await login.json()
  if (session.data.user.mustChangePassword !== true) {
    throw new Error('the bootstrap password should be single-use in production')
  }
  const me = await fetch(`${base}/auth/me`, {
    headers: { authorization: `Bearer ${session.data.accessToken}` },
  })
  if (me.status !== 200) throw new Error(`/auth/me answered ${me.status}`)
  const meBody = await me.json()
  if (meBody.data.user.isPlatformAdmin !== true) throw new Error('not a platform administrator')

  const expectedHeaders = {
    'content-security-policy': /default-src 'self'/,
    'strict-transport-security': /max-age=/,
    'x-content-type-options': /nosniff/,
    'x-frame-options': /DENY/,
    'permissions-policy': /camera=\(\)/,
    'referrer-policy': /./,
  }
  for (const [name, pattern] of Object.entries(expectedHeaders)) {
    const value = me.headers.get(name)
    if (!value || !pattern.test(value)) throw new Error(`missing or wrong header ${name}: ${value}`)
  }
  if (me.headers.get('x-powered-by')) throw new Error('x-powered-by is exposed')
  const docs = await fetch(`${base}/docs`)
  if (docs.status !== 404) throw new Error(`API docs are reachable in production (${docs.status})`)
  const cookie = login.headers.get('set-cookie') ?? ''
  if (!/Secure/.test(cookie) || !/HttpOnly/.test(cookie) || !/SameSite=Lax/i.test(cookie)) {
    throw new Error(
      `the refresh cookie is not Secure, HttpOnly and SameSite=Lax: ${cookie.replace(/=[^;]+/, '=…')}`,
    )
  }
  // The log line every operator reads first: which storage driver is live.
  const logs = sh('docker', ['logs', API]).stdout + sh('docker', ['logs', API]).stderr
  if (!/file storage ready/.test(logs) || !/s3\(/.test(logs)) {
    throw new Error('the object-store driver was not the one that started')
  }
  if (!/e-mail channel ready/.test(logs) || !/smtp\(/.test(logs)) {
    throw new Error('the SMTP channel was not the one that started')
  }
  process.stdout.write('   Signed in; headers, cookie, storage and mail drivers as promised.\n')

  process.stdout.write(
    '7. Creating the first cooperative; its manager’s link goes out by e-mail…\n',
  )
  const managerEmail = 'manager@rehearsal.example'
  const created = await fetch(`${base}/admin/cooperatives`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.data.accessToken}`,
    },
    body: JSON.stringify({
      name: 'Koperative y’Icyitegererezo',
      code: 'REHEARSAL',
      typeKey: 'AGRICULTURE',
      province: 'NORTHERN',
      district: 'Musanze',
      sector: 'Muhoza',
      cell: 'Cyabararika',
      village: 'Nyabisindu',
      manager: { email: managerEmail, fullName: 'Bizimana Joseph' },
    }),
  })
  if (created.status !== 201) throw new Error(`cooperative creation answered ${created.status}`)
  const inbox = await fetch(`${MAIL_API_URL()}/api/v1/search?query=${managerEmail}`)
  const found = await inbox.json()
  if (found.messages?.length !== 1) throw new Error('the manager did not receive a password link')
  const message = await (
    await fetch(`${MAIL_API_URL()}/api/v1/message/${found.messages[0].ID}`)
  ).json()
  const link = /https:\/\/app\.rehearsal\.example\/reset-password\/[A-Za-z0-9_-]+/.exec(
    message.Text,
  )
  if (!link) throw new Error('the message carries no link to the application')
  // And the link is not in the log: the message went to the person, not to the operators.
  const laterLogs = sh('docker', ['logs', API]).stdout + sh('docker', ['logs', API]).stderr
  if (laterLogs.includes(link[0].split('/').pop())) throw new Error('the reset token was logged')
  process.stdout.write('   Received, with a link to the application; nothing of it in the log.\n')

  process.stdout.write('\nDeployment rehearsal passed.\n')
} catch (error) {
  failed = true
  process.stderr.write(
    `\nRehearsal failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  const logs = sh('docker', ['logs', API], { allowFailure: true })
  process.stderr.write((logs.stdout + logs.stderr).split('\n').slice(-20).join('\n') + '\n')
} finally {
  process.stdout.write('8. Cleaning up…\n')
  await cleanUp()
  await admin.end()
}
process.exit(failed ? 1 : 0)
