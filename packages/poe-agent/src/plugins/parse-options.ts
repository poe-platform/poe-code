export function toOptionsObject(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("expected an object");
  }

  return input as Record<string, unknown>;
}

export function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[]
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${key}: unknown option`);
    }
  }
}

export function readOptionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${key}: expected a string`);
  }

  return value;
}

export function readOptionalStringArray(
  input: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key}: expected an array of strings`);
  }

  return value as string[];
}

export function readOptionalNonNegativeInteger(
  input: Record<string, unknown>,
  key: string
): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key}: expected a non-negative integer`);
  }

  return value;
}

export function readRequiredEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[]
): T {
  const value = input[key];
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(`${key}: expected one of ${allowedValues.join(", ")}`);
  }

  return value as T;
}
