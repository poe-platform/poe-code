import { Json } from "./json.js";
import { createJsonSchemaDocument } from "./json-schema-document.js";
import { OneOf } from "./oneof.js";
import { Record as RecordBuilder } from "./record.js";
import { Union } from "./union.js";
import { validate } from "./validate.js";
import type { JsonValue, JsonValueSchema } from "./json.js";
import type { JsonSchemaDocument, JsonSchemaDocumentOptions } from "./json-schema-document.js";
import type { OneOfSchema } from "./oneof.js";
import type { RecordSchema } from "./record.js";
import type { UnionSchema } from "./union.js";
import type { ValidationIssue, ValidationResult } from "./validate.js";

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";
type SchemaKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "object"
  | "optional"
  | "oneOf"
  | "union"
  | "record"
  | "json";
type EnumValue = string | number | boolean;
type JsonSchemaEnumValue = EnumValue | null;
type NumberJsonType = "number" | "integer";
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
type ObjectShape = Record<string, AnySchema>;
type SchemaScope = "cli" | "mcp" | "sdk";
type StringMetadata = {
  format?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  secret?: boolean;
};
type NumberMetadata = {
  maximum?: number;
  minimum?: number;
  secret?: boolean;
};
type ArrayMetadata = {
  maxItems?: number;
  minItems?: number;
};
type ObjectMetadata = {
  additionalProperties?: boolean;
};
type OptionalKeys<TShape extends ObjectShape> = {
  [TKey in keyof TShape]: TShape[TKey] extends OptionalSchema<any> ? TKey : never;
}[keyof TShape];
type RequiredKeys<TShape extends ObjectShape> = Exclude<keyof TShape, OptionalKeys<TShape>>;

type PropertyStatic<TSchema extends AnySchema> =
  TSchema extends OptionalSchema<infer TInner> ? Static<TInner> : Static<TSchema>;

type InferObject<TShape extends ObjectShape> = {
  [TKey in RequiredKeys<TShape>]: PropertyStatic<TShape[TKey]>;
} & {
  [TKey in OptionalKeys<TShape>]?: PropertyStatic<TShape[TKey]>;
};

type SchemaOptions<TDefault> = {
  description?: string;
  cliAliases?: readonly string[];
  default?: TDefault;
  nullable?: boolean;
  requiredScopes?: readonly SchemaScope[];
  short?: string;
  scope?: readonly SchemaScope[];
  global?: boolean;
};

export interface SchemaBase<TKind extends SchemaKind, TStatic> {
  readonly kind: TKind;
  readonly description?: string;
  readonly cliAliases?: readonly string[];
  readonly default?: TStatic;
  readonly nullable?: boolean;
  readonly requiredScopes?: readonly SchemaScope[];
  readonly short?: string;
  readonly scope?: readonly SchemaScope[];
  readonly global?: boolean;
  readonly __static?: TStatic;
}

export interface JsonSchema {
  additionalProperties?: boolean | JsonSchema;
  type?: JsonSchemaType;
  description?: string;
  default?: unknown;
  enum?: ReadonlyArray<JsonSchemaEnumValue>;
  format?: string;
  items?: JsonSchema;
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  oneOf?: JsonSchema[];
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export interface StringSchema extends SchemaBase<"string", string>, StringMetadata {}

export interface NumberSchema extends SchemaBase<"number", number>, NumberMetadata {
  readonly jsonType?: NumberJsonType;
}

export type BooleanSchema = SchemaBase<"boolean", boolean>;

export interface EnumSchema<TValues extends NonEmptyReadonlyArray<EnumValue>> extends SchemaBase<
  "enum",
  TValues[number]
> {
  readonly values: TValues;
  readonly jsonType?: "integer";
  readonly labels?: Partial<Record<string, string>>;
  readonly loadOptions?:
    | (() => Array<{ label: string; value: string }>)
    | (() => Promise<Array<{ label: string; value: string }>>);
}

export interface ArraySchema<TItem extends AnySchema>
  extends SchemaBase<"array", Array<Static<TItem>>>, ArrayMetadata {
  readonly item: TItem;
}

export interface ObjectSchema<TShape extends ObjectShape>
  extends SchemaBase<"object", InferObject<TShape>>, ObjectMetadata {
  readonly shape: TShape;
}

export interface OptionalSchema<TInner extends AnySchema> extends SchemaBase<
  "optional",
  Static<TInner> | undefined
> {
  readonly inner: TInner;
}

export type AnySchema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | EnumSchema<NonEmptyReadonlyArray<EnumValue>>
  | ArraySchema<AnySchema>
  | ObjectSchema<ObjectShape>
  | OptionalSchema<AnySchema>
  | OneOfSchema<Record<string, ObjectSchema<any>>, string>
  | UnionSchema<readonly ObjectSchema<any>[]>
  | RecordSchema<AnySchema>
  | JsonValueSchema;

export type Static<TSchema extends AnySchema> =
  TSchema extends SchemaBase<any, infer TStatic> ? TStatic : never;

function withMetadata<TSchema extends AnySchema>(
  schema: TSchema,
  jsonSchema: JsonSchema
): JsonSchema {
  if (schema.description !== undefined) {
    jsonSchema.description = schema.description;
  }

  if (schema.default !== undefined) {
    jsonSchema.default = schema.default;
  }

  if (schema.nullable === true) {
    jsonSchema.nullable = true;
  }

  return jsonSchema;
}

function withStringMetadata(schema: StringSchema, jsonSchema: JsonSchema): JsonSchema {
  if (schema.minLength !== undefined) {
    jsonSchema.minLength = schema.minLength;
  }

  if (schema.maxLength !== undefined) {
    jsonSchema.maxLength = schema.maxLength;
  }

  if (schema.pattern !== undefined) {
    jsonSchema.pattern = schema.pattern;
  }

  if (schema.format !== undefined) {
    jsonSchema.format = schema.format;
  }

  return withMetadata(schema, jsonSchema);
}

function withNumberMetadata(schema: NumberSchema, jsonSchema: JsonSchema): JsonSchema {
  if (schema.minimum !== undefined) {
    jsonSchema.minimum = schema.minimum;
  }

  if (schema.maximum !== undefined) {
    jsonSchema.maximum = schema.maximum;
  }

  return withMetadata(schema, jsonSchema);
}

function withArrayMetadata(schema: ArraySchema<any>, jsonSchema: JsonSchema): JsonSchema {
  if (schema.minItems !== undefined) {
    jsonSchema.minItems = schema.minItems;
  }

  if (schema.maxItems !== undefined) {
    jsonSchema.maxItems = schema.maxItems;
  }

  return withMetadata(schema, jsonSchema);
}

function withObjectMetadata(schema: ObjectSchema<any>, jsonSchema: JsonSchema): JsonSchema {
  if (schema.additionalProperties !== undefined) {
    jsonSchema.additionalProperties = schema.additionalProperties;
  }

  return withMetadata(schema, jsonSchema);
}

function getEnumJsonType(values: ReadonlyArray<EnumValue>): JsonSchemaType | undefined {
  const [firstValue] = values;

  if (firstValue === undefined) {
    return undefined;
  }

  const firstType = typeof firstValue;
  const isSinglePrimitiveType = values.every((value) => typeof value === firstType);

  if (!isSinglePrimitiveType) {
    return undefined;
  }

  if (firstType === "string" || firstType === "number" || firstType === "boolean") {
    return firstType;
  }

  return undefined;
}

function isOptionalSchema(schema: AnySchema): schema is OptionalSchema<AnySchema> {
  return schema.kind === "optional";
}

function assertValidEnumValues(values: ReadonlyArray<EnumValue>): void {
  if (values.length === 0) {
    throw new Error("Enum schema requires at least one value");
  }

  const uniqueValues = new Set(values);

  if (uniqueValues.size !== values.length) {
    throw new Error("Enum schema values must be unique");
  }

  if (values.some((value) => typeof value === "number" && !Number.isFinite(value))) {
    throw new Error("Enum schema numeric values must be finite");
  }
}

function assertNonNegativeInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertFiniteNumber(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPattern(pattern: string | undefined): void {
  if (pattern === undefined) {
    return;
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("pattern must be a valid regular expression");
  }
}

function unwrapOptional(schema: AnySchema): Exclude<AnySchema, OptionalSchema<AnySchema>> {
  if (isOptionalSchema(schema)) {
    return unwrapOptional(schema.inner);
  }

  return schema;
}

function withInjectedDiscriminator(
  schema: ObjectSchema<any>,
  discriminator: string,
  branchName: string
): JsonSchema {
  const branchJsonSchema = toJsonSchema(schema);
  const properties = {
    ...(branchJsonSchema.properties ?? {}),
    [discriminator]: {
      type: "string",
      enum: [branchName]
    } satisfies JsonSchema
  };
  const required = [...new Set([...(branchJsonSchema.required ?? []), discriminator])];

  return {
    ...branchJsonSchema,
    type: "object",
    properties,
    required
  };
}

export const S = {
  String(options: SchemaOptions<string> & StringMetadata = {}): StringSchema {
    assertNonNegativeInteger(options.minLength, "minLength");
    assertNonNegativeInteger(options.maxLength, "maxLength");
    assertPattern(options.pattern);
    return {
      kind: "string",
      ...options
    };
  },

  Number(
    options: SchemaOptions<number> & NumberMetadata & { jsonType?: NumberJsonType } = {}
  ): NumberSchema {
    assertFiniteNumber(options.minimum, "minimum");
    assertFiniteNumber(options.maximum, "maximum");
    assertFiniteNumber(options.default, "default");
    if (
      options.jsonType === "integer" &&
      options.default !== undefined &&
      !Number.isInteger(options.default)
    ) {
      throw new Error("default must be an integer");
    }
    return {
      kind: "number",
      ...options
    };
  },

  Boolean(options: SchemaOptions<boolean> = {}): BooleanSchema {
    return {
      kind: "boolean",
      ...options
    };
  },

  Enum<const TValues extends NonEmptyReadonlyArray<EnumValue>>(
    values: TValues,
    options: SchemaOptions<TValues[number]> & {
      jsonType?: "integer";
      labels?: Partial<Record<string, string>>;
      loadOptions?:
        | (() => Array<{ label: string; value: string }>)
        | (() => Promise<Array<{ label: string; value: string }>>);
    } = {}
  ): EnumSchema<TValues> {
    assertValidEnumValues(values);
    if (
      options.jsonType === "integer" &&
      values.some((value) => typeof value !== "number" || !Number.isInteger(value))
    ) {
      throw new Error("Integer enum values must be integers");
    }

    return {
      kind: "enum",
      values,
      ...options
    };
  },

  Array<TItem extends AnySchema>(
    item: TItem,
    options: SchemaOptions<Array<Static<TItem>>> & ArrayMetadata = {}
  ): ArraySchema<TItem> {
    assertNonNegativeInteger(options.minItems, "minItems");
    assertNonNegativeInteger(options.maxItems, "maxItems");
    return {
      kind: "array",
      item,
      ...options
    };
  },

  Object<const TShape extends ObjectShape>(
    shape: TShape,
    options: SchemaOptions<InferObject<TShape>> & ObjectMetadata = {}
  ): ObjectSchema<TShape> {
    return {
      kind: "object",
      shape,
      ...options
    };
  },

  Optional<TInner extends AnySchema>(inner: TInner): OptionalSchema<TInner> {
    return {
      kind: "optional",
      inner
    };
  },

  OneOf,

  Union,

  Record: RecordBuilder,

  Json
} as const;

export function toJsonSchema(schema: AnySchema): JsonSchema {
  const unwrappedSchema = unwrapOptional(schema);

  switch (unwrappedSchema.kind) {
    case "string":
      return withStringMetadata(unwrappedSchema, { type: "string" });

    case "number":
      return withNumberMetadata(unwrappedSchema, { type: unwrappedSchema.jsonType ?? "number" });

    case "boolean":
      return withMetadata(unwrappedSchema, { type: "boolean" });

    case "enum": {
      const jsonSchema: JsonSchema = {
        enum:
          unwrappedSchema.nullable === true
            ? [...unwrappedSchema.values, null]
            : [...unwrappedSchema.values]
      };
      const enumType = unwrappedSchema.jsonType ?? getEnumJsonType(unwrappedSchema.values);

      if (enumType !== undefined) {
        jsonSchema.type = enumType;
      }

      return withMetadata(unwrappedSchema, jsonSchema);
    }

    case "array":
      return withArrayMetadata(unwrappedSchema, {
        type: "array",
        items: toJsonSchema(unwrappedSchema.item)
      });

    case "object": {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, propertySchema] of Object.entries(unwrappedSchema.shape)) {
        Object.defineProperty(properties, key, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: toJsonSchema(propertySchema)
        });

        if (!isOptionalSchema(propertySchema)) {
          required.push(key);
        }
      }

      return withObjectMetadata(unwrappedSchema, {
        type: "object",
        properties,
        required
      });
    }

    case "oneOf":
      return withMetadata(unwrappedSchema, {
        oneOf: Object.entries(unwrappedSchema.branches).map(([branchName, branchSchema]) =>
          withInjectedDiscriminator(branchSchema, unwrappedSchema.discriminator, branchName)
        )
      });

    case "union":
      return withMetadata(unwrappedSchema, {
        oneOf: unwrappedSchema.branches.map((branchSchema) => toJsonSchema(branchSchema))
      });

    case "record":
      return withMetadata(unwrappedSchema, {
        type: "object",
        additionalProperties: toJsonSchema(unwrappedSchema.value)
      });

    case "json":
      return withMetadata(unwrappedSchema, {});
  }
}

export function toJsonSchemaDocument(
  schema: AnySchema,
  options: JsonSchemaDocumentOptions = {}
): JsonSchemaDocument {
  return createJsonSchemaDocument(toJsonSchema(schema), options);
}

export { Json, OneOf, RecordBuilder as Record, Union, validate };
export type { JsonSchemaDocument, JsonSchemaDocumentOptions } from "./json-schema-document.js";
export type {
  JsonValue,
  JsonValueSchema,
  OneOfSchema,
  RecordSchema,
  UnionSchema,
  ValidationIssue,
  ValidationResult
};
