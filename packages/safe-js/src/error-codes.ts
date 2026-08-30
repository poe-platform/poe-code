export function getOwnErrorCode(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !Object.prototype.hasOwnProperty.call(error, "code")
  ) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function hasOwnErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return getOwnErrorCode(error) === code;
}
