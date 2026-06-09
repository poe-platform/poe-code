export function hasOwnErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
