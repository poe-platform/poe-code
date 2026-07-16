export class UserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserError";
  }
}

/**
 * Detects user errors by name as well as identity, so an instance created in
 * another bundle (for example `@poe-code/user-error`, thrown by packages that do
 * not depend on toolcraft) is still rendered as guidance where `instanceof`
 * would fail - while a genuine `UserError` stays one even if its name was
 * overwritten.
 */
export function isUserError(error: unknown): error is Error {
  return error instanceof UserError || (error instanceof Error && error.name === "UserError");
}

export class ToolcraftBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolcraftBugError";
  }
}
