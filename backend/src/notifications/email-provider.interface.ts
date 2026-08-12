/**
 * Injection token for the email provider.
 *
 * A `Symbol` rather than a string so nothing can collide with it, matching
 * `PAYMENT_PROVIDER` and `STORAGE_PROVIDER`.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface Email {
  to: string;
  subject: string;
  /** The message as HTML. */
  html: string;
  /** The same message as plain text, for clients that will not render HTML. */
  text: string;
}

export interface EmailProvider {
  /** Named in the boot log so it is obvious which one is live. */
  readonly name: string;

  /**
   * Sends one message.
   *
   * Throws if delivery could not be handed off. Callers that are answering a
   * user request should catch: a password reset must not report failure just
   * because the mail server was slow, and must never reveal whether an address
   * exists.
   */
  send(email: Email): Promise<void>;
}
