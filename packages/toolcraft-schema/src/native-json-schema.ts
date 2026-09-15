import type { AnySchema, JsonSchema } from "./index.js";
import { isJsonValue } from "./json.js";
import { compileJsonSchema } from "./json-schema/index.js";
import type { CompiledJsonSchema } from "./json-schema/types.js";

export const nativeJsonSchema = Symbol("toolcraft.nativeJsonSchema");

export type NativeSchema = AnySchema & {
  [nativeJsonSchema]?: { document: JsonSchema; validator: CompiledJsonSchema };
};

export function withJsonSchema<T extends AnySchema>(projection: T, document: object): T {
  if (!isJsonValue(document) || Array.isArray(document)) {
    throw new Error("Native JSON Schema must be a JSON object");
  }
  const snapshot = structuredClone(document) as JsonSchema;
  const validator = compileJsonSchema(snapshot);
  return { ...projection, [nativeJsonSchema]: { document: snapshot, validator } };
}
