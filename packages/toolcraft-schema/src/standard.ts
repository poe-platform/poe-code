import { toJsonSchema, type AnySchema, type Static } from "./index.js";
import { validate } from "./validate.js";
import { nativeJsonSchema } from "./native-json-schema.js";

/** Structural Standard Schema / Standard JSON Schema v1 contracts. No runtime dependency. */
export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[]; readonly value?: undefined };

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: Input; readonly output: Output };
    readonly validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> }) =>
      StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly jsonSchema: {
      readonly input: (options: StandardJsonSchemaOptions) => Record<string, unknown>;
      readonly output: (options: StandardJsonSchemaOptions) => Record<string, unknown>;
    };
  };
}

export interface StandardJsonSchemaOptions {
  readonly target: string;
  readonly libraryOptions?: Record<string, unknown>;
}

export type Input<T extends AnySchema> = Static<T>;

type HasDefault<T> = AnySchema extends T ? false : T extends { readonly inner: infer Inner }
  ? HasDefault<Inner>
  : T extends { readonly default: infer Value } ? undefined extends Value ? false : true : false;

type OptionalOutputKeys<Shape> = {
  [K in keyof Shape]: Shape[K] extends { readonly kind: "optional" }
    ? HasDefault<Shape[K]> extends true ? never : K
    : never;
}[keyof Shape];

type ObjectOutput<Shape extends Record<string, AnySchema>> = {
  [K in Exclude<keyof Shape, OptionalOutputKeys<Shape>>]: Output<Shape[K]>;
} & {
  [K in OptionalOutputKeys<Shape>]?: Output<Shape[K]>;
};

type OutputValue<T extends AnySchema> =
  T extends { readonly [nativeJsonSchema]: unknown } ? Static<T> :
  T extends { readonly kind: "object"; readonly shape: infer Shape extends Record<string, AnySchema> } ? ObjectOutput<Shape> :
  T extends { readonly kind: "array"; readonly item: infer Item extends AnySchema } ? Output<Item>[] :
  T extends { readonly kind: "record"; readonly value: infer Value extends AnySchema } ? Record<string, Output<Value>> :
  T extends { readonly kind: "optional"; readonly inner: infer Inner extends AnySchema }
    ? Output<Inner> | (HasDefault<Inner> extends true ? never : undefined) :
  T extends { readonly kind: "union"; readonly branches: infer Branches extends readonly AnySchema[] } ? Output<Branches[number]> :
  T extends { readonly kind: "oneOf"; readonly branches: infer Branches extends Record<string, AnySchema>; readonly discriminator: infer Key extends string }
    ? { [Name in keyof Branches & string]: Output<Branches[Name]> & Record<Key, Name> }[keyof Branches & string] :
  Static<T>;

export type Output<T extends AnySchema> = 0 extends (1 & T) ? any
  : AnySchema extends T ? Static<T>
  : T extends { readonly "~standard": { readonly types?: { readonly output: infer Value } } } ? Value
  : OutputValue<T> | (T extends { readonly nullable: true } ? null : never);
export type Standardized<T extends AnySchema> = T extends unknown
  ? (T extends StandardSchema ? Omit<T, "~standard"> : T) & StandardSchema<Input<T>, OutputValue<T> | (T extends { readonly nullable: true } ? null : never)>
  : never;

function standardDocument(schema: AnySchema, io: "input" | "output", options: StandardJsonSchemaOptions): Record<string, unknown> {
  const uri = options.target === "draft-2020-12" ? "https://json-schema.org/draft/2020-12/schema"
    : options.target === "draft-07" ? "http://json-schema.org/draft-07/schema#" : undefined;
  if (uri === undefined) throw new Error(`Unsupported JSON Schema target: ${options.target}`);
  const document = toJsonSchema(schema, { io, target: options.target as "draft-07" | "draft-2020-12" }) as Record<string, unknown>;
  if (document.$schema !== undefined && document.$schema !== uri && document.$schema !== (uri.endsWith("#") ? uri.slice(0, -1) : uri)) {
    throw new Error(`Native JSON Schema dialect does not match target: ${options.target}`);
  }
  if ((schema.kind === "oneOf" || schema.kind === "union") && schema.nullable !== true) document.type = "object";
  return { $schema: uri, ...document };
}

/** Attach interoperable methods without changing the enumerable descriptor or its JSON form. */
export function withStandardSchema<T extends AnySchema>(schema: T): Standardized<T> {
  Object.defineProperty(schema, "~standard", {
    configurable: true,
    get() {
      const descriptor = this as T;
      return {
        version: 1 as const,
        vendor: "toolcraft-schema",
        validate(value: unknown) {
          const result = validate(descriptor, value);
          return result.ok ? { value: result.value } : { issues: result.issues };
        },
        jsonSchema: {
          input: (options: StandardJsonSchemaOptions) => standardDocument(descriptor, "input", options),
          output: (options: StandardJsonSchemaOptions) => standardDocument(descriptor, "output", options)
        }
      };
    }
  });
  return schema as unknown as Standardized<T>;
}
