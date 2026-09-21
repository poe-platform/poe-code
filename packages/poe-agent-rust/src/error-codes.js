export function hasOwnErrorCode(error, code) {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    error.code === code
  );
}
