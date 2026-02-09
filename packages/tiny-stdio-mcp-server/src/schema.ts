import type { JSONSchema } from "./types.js";

type SchemaPropertyType = "string" | "number" | "boolean" | "object" | "array";

interface SchemaPropertyDef {
  type: SchemaPropertyType;
  description?: string;
  optional?: boolean;
}

type SchemaDefinition = Record<string, SchemaPropertyDef>;

type InferType<T extends SchemaPropertyType> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "object"
        ? Record<string, unknown>
        : T extends "array"
          ? unknown[]
          : never;

type InferSchema<T extends SchemaDefinition> = {
  [K in keyof T as T[K]["optional"] extends true ? never : K]: InferType<
    T[K]["type"]
  >;
} & {
  [K in keyof T as T[K]["optional"] extends true ? K : never]?: InferType<
    T[K]["type"]
  >;
};

export interface TypedSchema<T> extends JSONSchema {
  __type?: T;
}

export function defineSchema<T extends SchemaDefinition>(
  definition: T
): TypedSchema<InferSchema<T>> {
  const properties: JSONSchema["properties"] = {};
  const required: string[] = [];

  for (const [key, prop] of Object.entries(definition)) {
    properties[key] = {
      type: prop.type,
      ...(prop.description !== undefined && { description: prop.description }),
    };
    if (!prop.optional) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}
