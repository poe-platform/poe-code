import { type AnySchema, type Static } from "./index.js";
import { nativeJsonSchema } from "./native-json-schema.js";
/** Structural Standard Schema / Standard JSON Schema v1 contracts. No runtime dependency. */
export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<
    | PropertyKey
    | {
        readonly key: PropertyKey;
      }
  >;
}
export type StandardResult<T> =
  | {
      readonly value: T;
      readonly issues?: undefined;
    }
  | {
      readonly issues: readonly StandardIssue[];
      readonly value?: undefined;
    };
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
    readonly validate: (
      value: unknown,
      options?: {
        readonly libraryOptions?: Record<string, unknown>;
      }
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
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
type HasDefault<T> = AnySchema extends T
  ? false
  : T extends {
        readonly inner: infer Inner;
      }
    ? HasDefault<Inner>
    : T extends {
          readonly default: infer Value;
        }
      ? undefined extends Value
        ? false
        : true
      : false;
type OptionalOutputKeys<Shape> = {
  [K in keyof Shape]: Shape[K] extends {
    readonly kind: "optional";
  }
    ? HasDefault<Shape[K]> extends true
      ? never
      : K
    : never;
}[keyof Shape];
type ObjectOutput<Shape extends Record<string, AnySchema>> = {
  [K in Exclude<keyof Shape, OptionalOutputKeys<Shape>>]: Output<Shape[K]>;
} & {
  [K in OptionalOutputKeys<Shape>]?: Output<Shape[K]>;
};
type OutputValue<T extends AnySchema> = T extends {
  readonly [nativeJsonSchema]: unknown;
}
  ? Static<T>
  : T extends {
        readonly kind: "object";
        readonly shape: infer Shape extends Record<string, AnySchema>;
      }
    ? ObjectOutput<Shape>
    : T extends {
          readonly kind: "array";
          readonly item: infer Item extends AnySchema;
        }
      ? Output<Item>[]
      : T extends {
            readonly kind: "record";
            readonly value: infer Value extends AnySchema;
          }
        ? Record<string, Output<Value>>
        : T extends {
              readonly kind: "optional";
              readonly inner: infer Inner extends AnySchema;
            }
          ? Output<Inner> | (HasDefault<Inner> extends true ? never : undefined)
          : T extends {
                readonly kind: "union";
                readonly branches: infer Branches extends readonly AnySchema[];
              }
            ? Output<Branches[number]>
            : T extends {
                  readonly kind: "oneOf";
                  readonly branches: infer Branches extends Record<string, AnySchema>;
                  readonly discriminator: infer Key extends string;
                }
              ? {
                  [Name in keyof Branches & string]: Output<Branches[Name]> & Record<Key, Name>;
                }[keyof Branches & string]
              : Static<T>;
export type Output<T extends AnySchema> = 0 extends 1 & T
  ? any
  : AnySchema extends T
    ? Static<T>
    : T extends {
          readonly "~standard": {
            readonly types?: {
              readonly output: infer Value;
            };
          };
        }
      ? Value
      :
          | OutputValue<T>
          | (T extends {
              readonly nullable: true;
            }
              ? null
              : never);
export type Standardized<T extends AnySchema> = T extends unknown
  ? (T extends StandardSchema ? Omit<T, "~standard"> : T) &
      StandardSchema<
        Input<T>,
        | OutputValue<T>
        | (T extends {
            readonly nullable: true;
          }
            ? null
            : never)
      >
  : never;
/** Attach interoperable methods without changing the enumerable descriptor or its JSON form. */
export declare function withStandardSchema<T extends AnySchema>(schema: T): Standardized<T>;
export {};
