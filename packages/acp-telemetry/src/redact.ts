const MAX_STRING_BYTES = 65_536;
const MAX_JSON_BYTES = 262_144;
const BINARY_SCAN_BYTES = 1_024;

export function redact(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized !== undefined) {
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    if (originalBytes > MAX_JSON_BYTES) {
      return `[truncated:${originalBytes}]`;
    }
  }

  return redactLeaf(value);
}

function redactLeaf(value: unknown): unknown {
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
    return value.map((item) => redactLeaf(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactLeaf(item)]),
    );
  }

  return value;
}
