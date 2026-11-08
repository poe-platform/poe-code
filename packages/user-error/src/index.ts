/**
 * An expected user mistake: bad input, a missing file, an unknown id, absent
 * credentials. Thrown where the condition is detected so the CLI can render the
 * message as guidance instead of dressing it in system-failure chrome.
 */
export class UserError extends Error {
  public readonly hint?: string;

  constructor(message: string, options?: ErrorOptions & { hint?: string }) {
    super(message, options);
    this.name = "UserError";
    this.hint = options?.hint;
  }
}

/**
 * Detects user errors by name as well as identity, so an instance created in
 * another bundle (toolcraft publishes its own `UserError`) is still recognised
 * where `instanceof` would fail.
 */
export function isUserError(error: unknown): boolean {
  return error instanceof Error && error.name === "UserError";
}
