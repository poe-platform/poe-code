export function getOwnErrorCode(error: unknown): unknown {
  if (
    typeof error !== "object" ||
    error === null ||
    !Object.prototype.hasOwnProperty.call(error, "code")
  ) {
    return undefined;
  }

  return (error as { code?: unknown }).code;
}
