const MAX_STRING_BYTES = 65_536;
const MAX_JSON_BYTES = 262_144;
const BINARY_SCAN_BYTES = 1_024;

export function redact(value: unknown): unknown {
  const serialized = safelySerialize(value);
  if (serialized !== undefined) {
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    if (originalBytes > MAX_JSON_BYTES) {
      return `[truncated:${originalBytes}]`;
    }
  }

  return redactLeaf(value, new WeakSet());
}

function redactLeaf(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    return bytes > MAX_STRING_BYTES ? `[truncated:${bytes}]` : value;
  }

  if (value instanceof Uint8Array) {
    const scanLength = Math.min(value.byteLength, BINARY_SCAN_BYTES);
    for (let index = 0; index < scanLength; index += 1) {
      if (value[index] === 0x00) {
        return `[binary:${value.byteLength}]`;
      }
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted = value.map((item) => redactLeaf(item, ancestors));
    ancestors.delete(value);
    return redacted;
  }

  if (value !== null && typeof value === "object") {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(redacted, key, {
        configurable: true,
        enumerable: true,
        value: redactLeaf(item, ancestors),
        writable: true,
      });
    }
    ancestors.delete(value);
    return redacted;
  }

  return value;
}

function safelySerialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
