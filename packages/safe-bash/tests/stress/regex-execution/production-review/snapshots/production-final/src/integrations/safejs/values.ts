export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${name} must contain only string-keyed data properties`);
    }
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`Unsupported option: ${key}`);
  }
}

export function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

export function booleanValue(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError("Expected a boolean option");
  return value;
}

export function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), {
    name: "AbortError",
    code: "ABORT_ERR",
  });
}

export function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export async function withSignal<Value>(
  signal: AbortSignal | undefined,
  operation: () => Promise<Value>,
): Promise<Value> {
  checkSignal(signal);
  if (signal === undefined) return operation();
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      checkSignal(signal);
      return operation();
    }), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
