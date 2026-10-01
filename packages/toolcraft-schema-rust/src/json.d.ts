import { type Standardized } from "./standard.js";
import type { SchemaBase } from "./index.js";
type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | {
      [key: string]: JsonValue;
    }
  | JsonValue[];
export interface JsonValueSchema extends SchemaBase<"json", JsonValue> {
  readonly kind: "json";
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
}
type ConfiguredJson<TOptions> = JsonValueSchema &
  (TOptions extends {
    readonly default: infer Value;
  }
    ? undefined extends Value
      ? unknown
      : {
          readonly default: JsonValue;
        }
    : unknown);
export declare function Json<
  const TOptions extends Omit<JsonValueSchema, "kind"> = Record<never, never>
>(options?: TOptions): Standardized<ConfiguredJson<TOptions>>;
export interface JsonValueValidationOptions {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}
export declare function isJsonValue(value: unknown, options?: JsonValueValidationOptions): boolean;
export {};
