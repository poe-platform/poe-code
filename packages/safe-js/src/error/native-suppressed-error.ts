interface SuppressedErrorValue extends Error {
  error: unknown;
  suppressed: unknown;
}

interface SuppressedErrorConstructor {
  (error?: unknown, suppressed?: unknown, message?: string): SuppressedErrorValue;
  new(error?: unknown, suppressed?: unknown, message?: string): SuppressedErrorValue;
  readonly prototype: SuppressedErrorValue;
}

function SuppressedError(error: unknown, suppressed: unknown, message?: string): SuppressedErrorValue {
  const prototype = new.target?.prototype;
  const result = new Error(message) as SuppressedErrorValue;
  Object.setPrototypeOf(result, prototype !== null && (typeof prototype === "object" || typeof prototype === "function")
    ? prototype : SuppressedError.prototype);
  Object.defineProperties(result, {
    error: { value: error, writable: true, configurable: true },
    suppressed: { value: suppressed, writable: true, configurable: true }
  });
  return result;
}

Object.setPrototypeOf(SuppressedError, Error);
Object.setPrototypeOf(SuppressedError.prototype, Error.prototype);
Object.defineProperties(SuppressedError.prototype, {
  name: { value: "SuppressedError", writable: true, configurable: true },
  message: { value: "", writable: true, configurable: true }
});
Object.defineProperty(SuppressedError, "prototype", { writable: false });

export const NativeSuppressedError: SuppressedErrorConstructor =
  (globalThis as typeof globalThis & { SuppressedError?: SuppressedErrorConstructor }).SuppressedError ??
  SuppressedError as SuppressedErrorConstructor;
