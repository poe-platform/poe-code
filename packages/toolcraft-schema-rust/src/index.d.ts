import { type Standardized } from "./standard.js";
import { Json } from "./json.js";
import { OneOf } from "./oneof.js";
import { Record as RecordBuilder } from "./record.js";
import { Union } from "./union.js";
import { isPlainRecord, validate } from "./validate.js";
import type { JsonValue, JsonValueSchema } from "./json.js";
import type { JsonSchemaDocument, JsonSchemaDocumentOptions } from "./json-schema-document.js";
import type { OneOfSchema } from "./oneof.js";
import type { RecordSchema } from "./record.js";
import type { UnionSchema } from "./union.js";
import type { ValidationIssue, ValidationOptions, ValidationResult } from "./validate.js";
type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
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
type EnumValue = string | number | boolean | null;
type NumberJsonType = "number" | "integer";
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
type ObjectShape = Record<string, AnySchema>;
type EmptyOptions = Record<never, never>;
type SchemaScope = "cli" | "mcp" | "sdk";
export type CliOutputMode = "rich" | "md" | "json";
export interface CliMissingParameterChoice<TValue> {
  label: string;
  value: TValue;
}
export interface CliMissingParameterContext {
  commandPath: string;
  params: Readonly<Record<string, unknown>>;
  output: CliOutputMode;
  stdinTTY: boolean;
  stdoutTTY: boolean;
}
export interface CliMissingParameterResolution<TValue> {
  choices: readonly CliMissingParameterChoice<TValue>[];
  message?: string;
}
export interface CliSchemaOptions<TValue> {
  resolveMissing?: (
    context: CliMissingParameterContext
  ) =>
    | CliMissingParameterResolution<TValue>
    | undefined
    | Promise<CliMissingParameterResolution<TValue> | undefined>;
}
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
  cli?: CliSchemaOptions<TDefault>;
  description?: string;
  cliDescription?: string;
  cliAliases?: readonly string[];
  default?: TDefault;
  nullable?: boolean;
  requiredScopes?: readonly SchemaScope[];
  short?: string;
  scope?: readonly SchemaScope[];
  global?: boolean;
};
type WithNullable<
  TSchema extends AnySchema,
  TOptions extends {
    nullable?: boolean;
  }
> = (TOptions extends {
  readonly nullable: true;
}
  ? TSchema & {
      readonly nullable: true;
    }
  : TSchema) &
  (TOptions extends {
    readonly default: infer Value;
  }
    ? undefined extends Value
      ? unknown
      : {
          readonly default: Exclude<TSchema["default"], undefined>;
        }
    : unknown);
export interface SchemaBase<TKind extends SchemaKind, TStatic> {
  readonly kind: TKind;
  readonly cli?: CliSchemaOptions<TStatic>;
  readonly description?: string;
  readonly cliDescription?: string;
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
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  default?: unknown;
  enum?: ReadonlyArray<JsonValue>;
  const?: JsonValue;
  format?: string;
  items?: JsonSchema;
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  not?: JsonSchema;
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
    | (() => Array<{
        label: string;
        value: string;
      }>)
    | (() => Promise<
        Array<{
          label: string;
          value: string;
        }>
      >);
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
  | (SchemaBase<"array", any> &
      ArrayMetadata & {
        readonly item: AnySchema;
      })
  | (SchemaBase<"object", any> &
      ObjectMetadata & {
        readonly shape: ObjectShape;
      })
  | (SchemaBase<"optional", any> & {
      readonly inner: AnySchema;
    })
  | (SchemaBase<"oneOf", any> & {
      readonly discriminator: string;
      readonly branches: Record<string, ObjectSchema<any>>;
    })
  | (SchemaBase<"union", any> & {
      readonly branches: readonly ObjectSchema<any>[];
    })
  | (SchemaBase<"record", any> & {
      readonly value: AnySchema;
    })
  | JsonValueSchema;
export type Static<TSchema extends AnySchema> = TSchema extends {
  readonly nullable: true;
}
  ? TSchema extends SchemaBase<any, infer TStatic>
    ? TStatic | null
    : never
  : TSchema extends SchemaBase<any, infer TStatic>
    ? TStatic
    : never;
export declare const S: {
  readonly String: <const TOptions extends SchemaOptions<string> & StringMetadata = EmptyOptions>(
    options?: TOptions
  ) => Standardized<WithNullable<StringSchema, TOptions>>;
  readonly Number: <
    const TOptions extends SchemaOptions<number> &
      NumberMetadata & {
        jsonType?: NumberJsonType;
      } = EmptyOptions
  >(
    options?: TOptions
  ) => Standardized<WithNullable<NumberSchema, TOptions>>;
  readonly Boolean: <const TOptions extends SchemaOptions<boolean> = EmptyOptions>(
    options?: TOptions
  ) => Standardized<WithNullable<BooleanSchema, TOptions>>;
  readonly Enum: <
    const TValues extends NonEmptyReadonlyArray<EnumValue>,
    const TOptions extends SchemaOptions<TValues[number]> & {
      jsonType?: "integer";
      labels?: Partial<Record<string, string>>;
      loadOptions?:
        | (() => Array<{
            label: string;
            value: string;
          }>)
        | (() => Promise<
            Array<{
              label: string;
              value: string;
            }>
          >);
    } = EmptyOptions
  >(
    values: TValues,
    options?: TOptions
  ) => Standardized<WithNullable<EnumSchema<TValues>, TOptions>>;
  readonly Array: <
    TItem extends AnySchema,
    const TOptions extends SchemaOptions<Array<Static<TItem>>> & ArrayMetadata = EmptyOptions
  >(
    item: TItem,
    options?: TOptions
  ) => Standardized<WithNullable<ArraySchema<TItem>, TOptions>>;
  readonly Object: <
    const TShape extends ObjectShape,
    const TOptions extends SchemaOptions<InferObject<TShape>> & ObjectMetadata = EmptyOptions
  >(
    shape: TShape,
    options?: TOptions
  ) => Standardized<WithNullable<ObjectSchema<TShape>, TOptions>>;
  readonly Optional: <TInner extends AnySchema>(
    inner: TInner
  ) => Standardized<OptionalSchema<TInner>>;
  readonly OneOf: typeof OneOf;
  readonly Union: typeof Union;
  readonly Record: typeof RecordBuilder;
  readonly Json: typeof Json;
};
export interface JsonSchemaOptions {
  io?: "input" | "output";
  target?: "draft-07" | "draft-2020-12";
}
export declare function toJsonSchema(schema: AnySchema, options?: JsonSchemaOptions): JsonSchema;
export declare function toJsonSchemaDocument(
  schema: AnySchema,
  options?: JsonSchemaDocumentOptions
): JsonSchemaDocument;
export { Json, OneOf, RecordBuilder as Record, Union, isPlainRecord, validate };
export { isJsonValue } from "./json.js";
export type { JsonValueValidationOptions } from "./json.js";
export { cloneDefaultValue } from "./clone-default.js";
export declare function unicodeLength(value: string): number;
export { compileJsonSchema, formatIssues } from "./compiler.js";
export { projectJsonSchemaProperties } from "./compiler.js";
export type { JsonSchemaProperty } from "./compiler.js";
export { normalizeLegacyNullability } from "./compiler.js";
export { withJsonSchema, nativeJsonSchema } from "./native-json-schema.js";
export type { NativeSchema } from "./native-json-schema.js";
export type { CompileJsonSchemaOptions, CompiledJsonSchema } from "./compiler.js";
export type { JsonSchemaDocument, JsonSchemaDocumentOptions } from "./json-schema-document.js";
export type {
  JsonValue,
  JsonValueSchema,
  OneOfSchema,
  RecordSchema,
  UnionSchema,
  ValidationIssue,
  ValidationOptions,
  ValidationResult
};
export { withStandardSchema } from "./standard.js";
export type {
  Input,
  Output,
  StandardSchema,
  Standardized,
  StandardIssue,
  StandardResult,
  StandardJsonSchemaOptions
} from "./standard.js";
