export declare function toOptionsObject(input: unknown): Record<string, unknown>;
export declare function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[]
): void;
export declare function readOptionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined;
export declare function readOptionalStringArray(
  input: Record<string, unknown>,
  key: string
): string[] | undefined;
export declare function readOptionalNonNegativeInteger(
  input: Record<string, unknown>,
  key: string
): number | undefined;
export declare function readRequiredEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[]
): T;
