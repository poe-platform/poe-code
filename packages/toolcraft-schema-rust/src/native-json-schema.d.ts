import { type Standardized } from "./standard.js";
import type { AnySchema, JsonSchema } from "./index.js";
import type { CompiledJsonSchema } from "./compiler.js";
export declare const nativeJsonSchema: unique symbol;
export type NativeSchema = AnySchema & {
  [nativeJsonSchema]?: {
    document: JsonSchema;
    validator: CompiledJsonSchema;
  };
};
export declare function withJsonSchema<T extends AnySchema>(
  projection: T,
  document: object
): Standardized<
  T & {
    [nativeJsonSchema]: NonNullable<NativeSchema[typeof nativeJsonSchema]>;
  }
>;
