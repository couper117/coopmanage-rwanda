import { randomUUID } from 'node:crypto'
import { logger } from '../logger.js'
import type { SmsOutcome, SmsProvider, SmsRequest } from './types.js'

/**
 * The provider development runs on, and it needs no credentials of any kind.
 *
 * That is the point, and it is one of this phase's exit criteria: a developer, a reviewer or a
 * cooperative trying the product should be able to send an announcement to a hundred members and
 * see exactly what happened, without an account with a gateway and without the risk of a hundred
 * real people receiving a test message.
 *
 * **It records and it does not deliver.** `delivers` is false, every screen that sends reads that
 * and says so plainly, and each message is written to the log with its body and its number exactly
 * as a real provider's would be. What a cooperative sees afterwards is therefore the real thing
 * minus the delivery.
 *
 * One deliberate exception to always succeeding: a number ending `000000` fails. A cooperative's
 * staff have to see what a partial send looks like — forty-nine delivered and one not — because
 * that is the case they will have to act on, and a mock that never fails teaches nobody anything.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'
  readonly delivers = false

  send(request: SmsRequest): Promise<SmsOutcome> {
    if (request.to.endsWith('000000')) {
      return Promise.resolve({
        status: 'FAILED',
        // Written the way a gateway writes it, because this is the text a cooperative will read.
        reason: 'The number is not in service.',
      })
    }

    logger.debug(
      { to: request.to, characters: request.body.length, sender: request.sender ?? null },
      'sms recorded, not delivered',
    )
    return Promise.resolve({ status: 'SENT', providerMessageId: `mock-${randomUUID()}` })
  }
}
