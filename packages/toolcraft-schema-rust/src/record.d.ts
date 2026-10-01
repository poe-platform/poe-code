import { type Standardized } from "./standard.js";
import type { AnySchema, SchemaBase, Static } from "./index.js";
export interface RecordSchema<TValue extends AnySchema> extends SchemaBase<
  "record",
  Record<string, Static<TValue>>
> {
  readonly value: TValue;
}
export declare function Record<TValue extends AnySchema>(
  value: TValue
): Standardized<RecordSchema<TValue>>;
