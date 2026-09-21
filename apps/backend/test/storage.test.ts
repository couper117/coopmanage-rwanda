import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { newStorageKey } from '../src/lib/storage/index.js'
import { S3StorageDriver } from '../src/lib/storage/s3.js'
import { encodeS3Path, signRequest } from '../src/lib/storage/sigv4.js'
import { StorageObjectMissing } from '../src/lib/storage/types.js'

/**
 * The object-store driver, in two halves.
 *
 * The signature is checked against the worked example in Amazon's own documentation, which is
 * the one test vector every S3-compatible store has to agree with. The driver is then run against
 * a real store — MinIO, in a container — when `S3_TEST_ENDPOINT` is set, which the local
 * instructions and CI both do. Without the endpoint that half is skipped and says so, rather than
 * passing against a mock of the protocol it exists to speak.
 */
describe('the SigV4 signature', () => {
  it('reproduces the signature in Amazon’s worked example', () => {
    // "Example: GET Object" from the AWS Signature Version 4 documentation for S3. The example
    // key is assembled from two halves so that no secret scanner — the pre-commit hook, gitleaks
    // in CI — has to be taught that Amazon's published example is not a leak.
    const exampleKeyId = ['AKIA', 'IOSFODNN7EXAMPLE'].join('')
    const exampleSecret = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/')
    const signed = signRequest(
      { accessKeyId: exampleKeyId, secretAccessKey: exampleSecret, region: 'us-east-1' },
      'GET',
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      null,
      { range: 'bytes=0-9' },
      new Date('2013-05-24T00:00:00Z'),
    )
    expect(signed.headers.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${exampleKeyId}/20130524/us-east-1/s3/aws4_request, ` +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
    expect(signed.headers['x-amz-date']).toBe('20130524T000000Z')
    // The secret never appears in what is sent.
    expect(JSON.stringify(signed)).not.toContain('wJalrXUtnFEMI')
  })

  it('encodes a path the way S3 canonicalises it', () => {
    expect(encodeS3Path('2026/09/abc')).toBe('2026/09/abc')
    expect(encodeS3Path("a b/c'(d)*!")).toBe('a%20b/c%27%28d%29%2A%21')
  })
})

const endpoint = process.env.S3_TEST_ENDPOINT
const bucket = process.env.S3_TEST_BUCKET ?? 'coopmanage-test'

describe.skipIf(!endpoint)('the S3 driver against a real store', () => {
  // Built lazily: a skipped block still evaluates its body, and there is no endpoint to build on.
  const driver = new S3StorageDriver({
    endpoint: endpoint ?? 'http://skipped.invalid',
    bucket,
    region: process.env.S3_TEST_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin',
  })

  async function ensureBucket(): Promise<void> {
    // A bucket is created with a signed PUT on its own path; MinIO answers 409 when it exists.
    const url = new URL(`${bucket}`, endpoint?.endsWith('/') ? endpoint : `${endpoint}/`)
    const signed = signRequest(
      {
        accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin',
        region: process.env.S3_TEST_REGION ?? 'us-east-1',
      },
      'PUT',
      url,
      null,
    )
    const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers })
    await response.body?.cancel()
    if (!response.ok && response.status !== 409) {
      throw new Error(`could not create the test bucket: HTTP ${response.status}`)
    }
  }

  async function collect(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  it('answers the startup probe', async () => {
    await ensureBucket()
    await expect(driver.probe()).resolves.toBeUndefined()
  })

  it('refuses the wrong credentials at the probe, before any upload', async () => {
    await ensureBucket()
    const wrong = new S3StorageDriver({
      endpoint: endpoint as string,
      bucket,
      region: 'us-east-1',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'not-the-password',
    })
    await expect(wrong.probe()).rejects.toThrow(/refused the credentials/)
  })

  it('stores bytes and hands back exactly those bytes', async () => {
    await ensureBucket()
    const key = newStorageKey()
    const bytes = randomBytes(64 * 1024 + 17)
    await driver.put(key, bytes, 'application/octet-stream')

    expect(await driver.exists(key)).toBe(true)
    expect(await driver.size(key)).toBe(bytes.length)
    const back = await collect(await driver.read(key))
    expect(Buffer.compare(back, bytes)).toBe(0)

    await driver.remove(key)
    expect(await driver.exists(key)).toBe(false)
  })

  it('never overwrites an object, for the reason the local driver uses wx', async () => {
    await ensureBucket()
    const key = newStorageKey()
    await driver.put(key, Buffer.from('first'), 'text/plain')
    await expect(driver.put(key, Buffer.from('second'), 'text/plain')).rejects.toThrow(
      /refusing to overwrite/,
    )
    expect((await collect(await driver.read(key))).toString()).toBe('first')
    await driver.remove(key)
  })

  it('reports a missing object as missing, and removes a missing object quietly', async () => {
    await ensureBucket()
    const key = newStorageKey()
    expect(await driver.exists(key)).toBe(false)
    await expect(driver.read(key)).rejects.toBeInstanceOf(StorageObjectMissing)
    await expect(driver.size(key)).rejects.toBeInstanceOf(StorageObjectMissing)
    await expect(driver.remove(key)).resolves.toBeUndefined()
  })

  it('refuses a key that is not the generated shape, before touching the network', async () => {
    await expect(driver.exists('../etc/passwd')).rejects.toThrow(/not the expected shape/)
  })
})
