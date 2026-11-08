const authorizationErrorBrand = Symbol.for("poe-platform.mcp-oauth.OAuthAuthorizationError");

export class OAuthAuthorizationError extends Error {
  /** Recognize errors from separately bundled copies of this package. */
  static is(value: unknown): value is OAuthAuthorizationError {
    return value instanceof Error && Object.getOwnPropertyDescriptor(value, authorizationErrorBrand)?.value === true;
  }
  constructor(readonly error: string, readonly errorDescription: string) {
    super(`OAuth authorization failed: ${error} — ${errorDescription}`);
    this.name = "OAuthAuthorizationError";
    Object.defineProperty(this, authorizationErrorBrand, { value: true });
  }
}

