type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";
type SchemaKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "object"
  | "optional";
type EnumValue = string | number | boolean;
type NumberJsonType = "number" | "integer";
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
type ObjectShape = Record<string, AnySchema>;
type OptionalKeys<TShape extends ObjectShape> = {
  [TKey in keyof TShape]: TShape[TKey] extends OptionalSchema<any> ? TKey : never;
}[keyof TShape];
type RequiredKeys<TShape extends ObjectShape> = Exclude<keyof TShape, OptionalKeys<TShape>>;

type PropertyStatic<TSchema extends AnySchema> = TSchema extends OptionalSchema<infer TInner>
  ? Static<TInner>
  : Static<TSchema>;

type InferObject<TShape extends ObjectShape> = {
  [TKey in RequiredKeys<TShape>]: PropertyStatic<TShape[TKey]>;
} & {
  [TKey in OptionalKeys<TShape>]?: PropertyStatic<TShape[TKey]>;
};

type SchemaOptions<TDefault> = {
  description?: string;
  default?: TDefault;
  short?: string;
};

interface SchemaBase<TKind extends SchemaKind, TStatic> {
  readonly kind: TKind;
  readonly description?: string;
  readonly default?: TStatic;
  readonly short?: string;
  readonly __static?: TStatic;
}

export interface JsonSchema {
  type?: JsonSchemaType;
  description?: string;
  default?: unknown;
  enum?: ReadonlyArray<EnumValue>;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export type StringSchema = SchemaBase<"string", string>;

export interface NumberSchema extends SchemaBase<"number", number> {
  readonly jsonType?: NumberJsonType;
}

export type BooleanSchema = SchemaBase<"boolean", boolean>;

export interface EnumSchema<TValues extends NonEmptyReadonlyArray<EnumValue>>
  extends SchemaBase<"enum", TValues[number]> {
  readonly values: TValues;
  readonly jsonType?: "integer";
  readonly labels?: Partial<Record<string, string>>;
  readonly loadOptions?: () => Array<{ label: string; value: string }> | Promise<Array<{ label: string; value: string }>>;
}

export interface ArraySchema<TItem extends AnySchema>
  extends SchemaBase<"array", Array<Static<TItem>>> {
  readonly item: TItem;
}

export interface ObjectSchema<TShape extends ObjectShape>
  extends SchemaBase<"object", InferObject<TShape>> {
  readonly shape: TShape;
}

export interface OptionalSchema<TInner extends AnySchema>
  extends SchemaBase<"optional", Static<TInner> | undefined> {
  readonly inner: TInner;
}

export type AnySchema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | EnumSchema<NonEmptyReadonlyArray<EnumValue>>
  | ArraySchema<AnySchema>
  | ObjectSchema<ObjectShape>
  | OptionalSchema<AnySchema>;

export type Static<TSchema extends AnySchema> = TSchema extends SchemaBase<any, infer TStatic>
  ? TStatic
  : never;

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

  return jsonSchema;
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
}

function unwrapOptional(schema: AnySchema): Exclude<AnySchema, OptionalSchema<AnySchema>> {
  if (isOptionalSchema(schema)) {
    return unwrapOptional(schema.inner);
  }

  return schema;
}

export const S = {
  String(options: SchemaOptions<string> = {}): StringSchema {
    return {
      kind: "string",
      ...options,
    };
  },

  Number(options: SchemaOptions<number> & { jsonType?: NumberJsonType } = {}): NumberSchema {
    return {
      kind: "number",
      ...options,
    };
  },

  Boolean(options: SchemaOptions<boolean> = {}): BooleanSchema {
    return {
      kind: "boolean",
      ...options,
    };
  },

  Enum<const TValues extends NonEmptyReadonlyArray<EnumValue>>(
    values: TValues,
    options: SchemaOptions<TValues[number]> & {
      jsonType?: "integer";
      labels?: Partial<Record<string, string>>;
      loadOptions?: () => Array<{ label: string; value: string }> | Promise<Array<{ label: string; value: string }>>;
    } = {}
  ): EnumSchema<TValues> {
    assertValidEnumValues(values);

    return {
      kind: "enum",
      values,
      ...options,
    };
  },

  Array<TItem extends AnySchema>(
    item: TItem,
    options: SchemaOptions<Array<Static<TItem>>> = {}
  ): ArraySchema<TItem> {
    return {
      kind: "array",
      item,
      ...options,
    };
  },

  Object<const TShape extends ObjectShape>(shape: TShape): ObjectSchema<TShape> {
    return {
      kind: "object",
      shape,
    };
  },

  Optional<TInner extends AnySchema>(inner: TInner): OptionalSchema<TInner> {
    return {
      kind: "optional",
      inner,
    };
  },
} as const;

export function toJsonSchema(schema: AnySchema): JsonSchema {
  const unwrappedSchema = unwrapOptional(schema);

  switch (unwrappedSchema.kind) {
    case "string":
      return withMetadata(unwrappedSchema, { type: "string" });

    case "number":
      return withMetadata(unwrappedSchema, { type: unwrappedSchema.jsonType ?? "number" });

    case "boolean":
      return withMetadata(unwrappedSchema, { type: "boolean" });

    case "enum": {
      const jsonSchema: JsonSchema = {
        enum: [...unwrappedSchema.values],
      };
      const enumType = unwrappedSchema.jsonType ?? getEnumJsonType(unwrappedSchema.values);

      if (enumType !== undefined) {
        jsonSchema.type = enumType;
      }

      return withMetadata(unwrappedSchema, jsonSchema);
    }

    case "array":
      return withMetadata(unwrappedSchema, {
        type: "array",
        items: toJsonSchema(unwrappedSchema.item),
      });

    case "object": {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, propertySchema] of Object.entries(unwrappedSchema.shape)) {
        properties[key] = toJsonSchema(propertySchema);

        if (!isOptionalSchema(propertySchema)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required,
      };
    }
  }
}
