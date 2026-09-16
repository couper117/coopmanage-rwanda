/**
 * What the application needs of something that sends an SMS.
 *
 * Deliberately small, and deliberately not a provider's API. A cooperative in Musanze does not
 * care which gateway carries its meeting reminder, and this product must not be rewritten when a
 * cooperative changes network or a gateway changes owner — so no module outside this directory
 * imports a provider SDK, and nothing outside it knows a provider exists.
 *
 * **One message at a time, by design.** A batch endpoint would hide the case that actually matters:
 * forty-nine messages reach their members and one does not. The log carries a row per recipient
 * with its own outcome, so a cooperative can say which member was not told, which is the question
 * it will be asked. Sending fifty messages is fifty calls to `send`, and the service that makes
 * them is where ordering and failure handling belong.
 */

export interface SmsRequest {
  /** Canonical form, `+250XXXXXXXXX`. The service normalises before it gets here. */
  to: string
  body: string
  /**
   * The name the message appears to come from, where the provider supports one. A cooperative's
   * members should see who is writing to them rather than a short code nobody recognises.
   */
  sender?: string | null
}

export type SmsOutcome =
  | { status: 'SENT'; providerMessageId: string | null }
  /**
   * The provider refused or could not be reached. The reason is stored and shown, so it must be
   * something a person can act on — "the number is not in service", not a stack trace.
   */
  | { status: 'FAILED'; reason: string }

export interface SmsProvider {
  /** A name for the log and for the startup line, so an operator can see which driver is live. */
  readonly name: string

  /**
   * True when this provider actually delivers to a handset.
   *
   * The mock does not, and the interface says so rather than letting a cooperative believe its
   * members were told. Every screen that sends reads this and says plainly that messages are being
   * recorded rather than delivered.
   */
  readonly delivers: boolean

  /** Never throws. A provider that cannot be reached returns FAILED with a readable reason. */
  send(request: SmsRequest): Promise<SmsOutcome>
}
