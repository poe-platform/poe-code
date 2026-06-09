export function hasOwnErrorCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, 'code') &&
    (error as { code?: unknown }).code === code
  );
}
