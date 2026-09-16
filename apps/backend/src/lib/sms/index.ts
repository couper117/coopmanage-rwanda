import { env } from '../../config/env.js'
import { logger } from '../logger.js'
import { MockSmsProvider } from './mock.js'
import type { SmsProvider } from './types.js'

export type { SmsOutcome, SmsProvider, SmsRequest } from './types.js'
// The cost rule lives in the shared package, because the interface quotes a price as a cooperative
// types and the server bills by it: two implementations would eventually disagree, and the one the
// cooperative saw would be the wrong one.
export { SMS_SINGLE_SEGMENT, smsIsUnicode, smsSegments } from '@coopmanage/shared'

/**
 * The one place an SMS provider is chosen.
 *
 * **Replacing the provider is this file and a sibling.** Write a class implementing `SmsProvider`
 * next to `mock.ts`, add the branch below, and nothing else in the application changes: no module
 * outside this directory knows a provider exists, and the service that sends knows only the
 * interface. That is the phase's exit criterion, and it is a property of the layering rather than a
 * promise.
 *
 * Until a gateway is chosen there is one driver and it needs no credentials. `SMS_PROVIDER=mock` is
 * the default and the only accepted value; the environment schema refuses anything else at startup
 * rather than letting a cooperative believe its members were told. A gateway that silently dropped
 * a meeting reminder would be worse than no SMS at all, because the cooperative would stop calling
 * people.
 */
function build(): SmsProvider {
  const provider = new MockSmsProvider()
  logger.info(
    { provider: provider.name, delivers: provider.delivers },
    provider.delivers ? 'sms provider ready' : 'sms provider ready — recording, not delivering',
  )
  return provider
}

let instance: SmsProvider | null = null

export function sms(): SmsProvider {
  instance ??= build()
  return instance
}

/** Replaces the provider. Tests only — nothing in the application calls it. */
export function setSmsProvider(provider: SmsProvider | null): void {
  instance = provider
}

/** What the environment asked for, so a startup line and a screen can both name it. */
export const SMS_PROVIDER_NAME = env.SMS_PROVIDER
