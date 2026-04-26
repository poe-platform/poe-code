import type { SchemaBase } from "./index.js";

type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export interface JsonValueSchema extends SchemaBase<"json", JsonValue> {
  readonly kind: "json";
}

export function Json(): JsonValueSchema {
  return {
    kind: "json",
  };
}
