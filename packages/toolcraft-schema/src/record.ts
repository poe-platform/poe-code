import type { AnySchema, SchemaBase, Static } from "./index.js";

export interface RecordSchema<TValue extends AnySchema>
  extends SchemaBase<"record", Record<string, Static<TValue>>> {
  readonly value: TValue;
}

export function Record<TValue extends AnySchema>(value: TValue): RecordSchema<TValue> {
  return {
    kind: "record",
    value,
  };
}
