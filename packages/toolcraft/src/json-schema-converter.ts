import { S } from "toolcraft-schema";
import type { AnySchema, ObjectSchema } from "toolcraft-schema";

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
type PrimitiveEnumValue = string | number | boolean;
type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface JsonSchema {
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: readonly JsonSchema[];
  const?: unknown;
  default?: unknown;
  description?: string;
  enum?: readonly unknown[];
  items?: JsonSchema;
  nullable?: boolean;
  oneOf?: readonly JsonSchema[];
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  type?: JsonSchemaType | readonly JsonSchemaType[];
}

interface NormalizedJsonSchema {
  schema: JsonSchema;
  nullable: boolean;
}

export function convertJsonSchema(schema: JsonSchema): AnySchema {
  if (hasSelfReferencingRef(schema, schema)) {
    return applyMetadata(S.Json(), schema, {
      nullable: schema.nullable === true,
    });
  }

  return convertSchema(schema, schema);
}

function convertSchema(schema: JsonSchema, root: JsonSchema): AnySchema {
  const resolvedSchema = resolveReferencedSchema(schema, root);
  const normalizedSchema = normalizeNullability(resolvedSchema);
  const composition = normalizedSchema.schema.oneOf ?? normalizedSchema.schema.anyOf;

  if (Array.isArray(normalizedSchema.schema.type)) {
    throw new Error(
      `Unsupported JSON Schema type array: ${JSON.stringify(normalizedSchema.schema.type)}.`
    );
  }

  if (resolvedSchema.const !== undefined) {
    return convertConstSchema(resolvedSchema, normalizedSchema.nullable);
  }

  if (resolvedSchema.enum !== undefined) {
    return convertEnumSchema(resolvedSchema, normalizedSchema.nullable);
  }

  if (composition !== undefined) {
    return convertCompositionSchema(normalizedSchema.schema, root, normalizedSchema.nullable);
  }

  if (isRecordSchema(normalizedSchema.schema)) {
    return applyMetadata(
      S.Record(convertSchema(normalizedSchema.schema.additionalProperties as JsonSchema, root)),
      normalizedSchema.schema,
      {
        nullable: normalizedSchema.nullable,
      }
    );
  }

  switch (normalizedSchema.schema.type) {
    case "string":
      return S.String({
        ...createCommonOptions(
          normalizedSchema.schema,
          normalizedSchema.nullable,
          getStringDefault(normalizedSchema.schema.default)
        ),
        ...(normalizedSchema.schema.pattern === undefined
          ? {}
          : { pattern: normalizedSchema.schema.pattern }),
      });

    case "number":
      return S.Number(
        createCommonOptions(
          normalizedSchema.schema,
          normalizedSchema.nullable,
          getNumberDefault(normalizedSchema.schema.default)
        )
      );

    case "integer":
      return S.Number({
        ...createCommonOptions(
          normalizedSchema.schema,
          normalizedSchema.nullable,
          getIntegerDefault(normalizedSchema.schema.default)
        ),
        jsonType: "integer",
      });

    case "boolean":
      return S.Boolean(
        createCommonOptions(
          normalizedSchema.schema,
          normalizedSchema.nullable,
          getBooleanDefault(normalizedSchema.schema.default)
        )
      );

    case "array":
      if (normalizedSchema.schema.items === undefined) {
        throw new Error('JSON Schema arrays must define "items".');
      }

      return S.Array(
        convertSchema(normalizedSchema.schema.items, root),
        createCommonOptions(
          normalizedSchema.schema,
          normalizedSchema.nullable,
          getArrayDefault(normalizedSchema.schema.default)
        )
      );

    case "object":
      return convertObjectSchema(normalizedSchema.schema, root, {
        nullable: normalizedSchema.nullable,
      });

    case "null":
      return applyMetadata(S.Json(), normalizedSchema.schema, {
        default: getJsonDefault(normalizedSchema.schema.default) ?? null,
        nullable: true,
      });

    case undefined:
      if (normalizedSchema.nullable) {
        return applyMetadata(S.Json(), normalizedSchema.schema, {
          nullable: true,
        });
      }

      throw new Error("Unsupported JSON Schema: missing type, enum, const, or composition.");
  }

  throw new Error(`Unsupported JSON Schema type: ${JSON.stringify(normalizedSchema.schema.type)}.`);
}

function convertConstSchema(schema: JsonSchema, nullable: boolean): AnySchema {
  if (isPrimitiveEnumValue(schema.const)) {
    return S.Enum([schema.const] as [PrimitiveEnumValue], {
      ...createCommonOptions(schema, nullable, schema.const),
      default: schema.const,
      ...(schema.type === "integer" && typeof schema.const === "number"
        ? { jsonType: "integer" as const }
        : {}),
    });
  }

  return applyMetadata(S.Json(), schema, {
    default: schema.const as JsonValue,
    nullable: nullable || schema.const === null,
    description: appendDescription(
      schema.description,
      `Constant JSON value: ${JSON.stringify(schema.const)}.`
    ),
  });
}

function convertEnumSchema(schema: JsonSchema, nullable: boolean): AnySchema {
  const values = schema.enum ?? [];
  const nonNullValues = values.filter((value) => value !== null);
  const hasNull = nonNullValues.length !== values.length;

  if (nonNullValues.every(isPrimitiveEnumValue) && nonNullValues.length > 0) {
    return S.Enum(nonNullValues as [PrimitiveEnumValue, ...PrimitiveEnumValue[]], {
      ...createCommonOptions(
        schema,
        nullable || hasNull,
        getPrimitiveEnumDefault(schema.default, nonNullValues)
      ),
      ...(schema.type === "integer" && nonNullValues.every((value) => Number.isInteger(value))
        ? { jsonType: "integer" as const }
        : {}),
    });
  }

  return applyMetadata(S.Json(), schema, {
    nullable: nullable || hasNull,
    description: appendDescription(
      schema.description,
      `Allowed JSON values: ${values.map((value) => JSON.stringify(value)).join(", ")}.`
    ),
  });
}

function convertCompositionSchema(
  schema: JsonSchema,
  root: JsonSchema,
  nullable: boolean
): AnySchema {
  const branches = [...(schema.oneOf ?? schema.anyOf ?? [])].map((branch) =>
    resolveReferencedSchema(branch, root)
  );
  const discriminator = findDiscriminator(branches, root);

  if (discriminator !== undefined) {
    const convertedBranches = Object.fromEntries(
      branches.map((branch) => [
        getDiscriminatorLiteral(branch, discriminator, root),
        convertObjectSchema(branch, root, {
          omitProperty: discriminator,
        }),
      ])
    );

    return applyMetadata(
      S.OneOf({
        discriminator,
        branches: convertedBranches,
      }),
      schema,
      {
        nullable,
      }
    );
  }

  return applyMetadata(
    S.Union(branches.map((branch) => convertObjectSchema(branch, root, {}))),
    schema,
    {
      nullable,
    }
  );
}

function convertObjectSchema(
  schema: JsonSchema,
  root: JsonSchema,
  options: {
    nullable?: boolean;
    omitProperty?: string;
  }
): ObjectSchema<any> {
  const resolvedSchema = resolveReferencedSchema(schema, root);
  const normalizedSchema = normalizeNullability(resolvedSchema);
  const properties = normalizedSchema.schema.properties ?? {};
  const requiredKeys = new Set(normalizedSchema.schema.required ?? []);
  const shape: Record<string, AnySchema> = {};

  if (normalizedSchema.schema.type !== "object" && normalizedSchema.schema.properties === undefined) {
    throw new Error("Expected an object schema branch.");
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key === options.omitProperty) {
      continue;
    }

    const convertedProperty = convertSchema(propertySchema, root);
    shape[key] = requiredKeys.has(key) ? convertedProperty : S.Optional(convertedProperty);
  }

  return applyMetadata(
    S.Object(shape, {
      ...(typeof normalizedSchema.schema.additionalProperties === "boolean"
        ? { additionalProperties: normalizedSchema.schema.additionalProperties }
        : {}),
    }),
    normalizedSchema.schema,
    {
      nullable: options.nullable ?? normalizedSchema.nullable,
    }
  );
}

function createCommonOptions<TDefault>(
  schema: JsonSchema,
  nullable: boolean,
  defaultValue?: TDefault
): {
  default?: TDefault;
  description?: string;
  nullable?: boolean;
} {
  return {
    ...(schema.description === undefined ? {} : { description: schema.description }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(nullable ? { nullable: true } : {}),
  };
}

function applyMetadata<TSchema extends AnySchema>(
  schema: TSchema,
  source: JsonSchema,
  overrides: {
    default?: JsonValue;
    description?: string;
    nullable?: boolean;
  }
): TSchema {
  const result = { ...schema } as TSchema & {
    default?: unknown;
    description?: string;
    nullable?: boolean;
  };
  const description = overrides.description ?? source.description;
  const hasDefaultOverride = Object.prototype.hasOwnProperty.call(overrides, "default");
  const defaultValue = hasDefaultOverride ? overrides.default : source.default;

  if (description !== undefined) {
    result.description = description;
  }

  if (defaultValue !== undefined) {
    result.default = defaultValue;
  }

  if (overrides.nullable === true) {
    result.nullable = true;
  }

  return result;
}

function normalizeNullability(schema: JsonSchema): NormalizedJsonSchema {
  if (!Array.isArray(schema.type)) {
    return {
      schema,
      nullable: schema.nullable === true,
    };
  }

  const nextTypes = schema.type.filter((value) => value !== "null");

  if (nextTypes.length === schema.type.length) {
    return {
      schema,
      nullable: schema.nullable === true,
    };
  }

  return {
    schema: {
      ...schema,
      type:
        nextTypes.length === 0 ? undefined : nextTypes.length === 1 ? nextTypes[0] : nextTypes,
      nullable: undefined,
    },
    nullable: true,
  };
}

function isRecordSchema(schema: JsonSchema): boolean {
  const propertyKeys = Object.keys(schema.properties ?? {});

  return (
    schema.type === "object" &&
    propertyKeys.length === 0 &&
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null
  );
}

function findDiscriminator(branches: JsonSchema[], root: JsonSchema): string | undefined {
  const [firstBranch] = branches;

  if (firstBranch === undefined) {
    throw new Error("JSON Schema composition requires at least one branch.");
  }

  const candidateKeys = Object.keys(firstBranch.properties ?? {});

  for (const candidate of candidateKeys) {
    const values: string[] = [];
    let matches = true;

    for (const branch of branches) {
      const requiredKeys = new Set(branch.required ?? []);

      if (!requiredKeys.has(candidate)) {
        matches = false;
        break;
      }

      const literal = getDiscriminatorLiteral(branch, candidate, root);

      if (literal === undefined) {
        matches = false;
        break;
      }

      values.push(literal);
    }

    if (matches && new Set(values).size === values.length) {
      return candidate;
    }
  }

  return undefined;
}

function getDiscriminatorLiteral(
  branch: JsonSchema,
  key: string,
  root: JsonSchema
): string | undefined {
  const propertySchema = branch.properties?.[key];

  if (propertySchema === undefined) {
    return undefined;
  }

  const resolvedProperty = resolveReferencedSchema(propertySchema, root);

  if (typeof resolvedProperty.const === "string") {
    return resolvedProperty.const;
  }

  if (
    resolvedProperty.enum !== undefined &&
    resolvedProperty.enum.length === 1 &&
    typeof resolvedProperty.enum[0] === "string"
  ) {
    return resolvedProperty.enum[0];
  }

  return undefined;
}

function resolveReferencedSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (schema.$ref === undefined) {
    return schema;
  }

  const resolvedTarget = resolveLocalRef(root, schema.$ref);

  if (resolvedTarget === undefined) {
    throw new Error(`Unsupported JSON Schema $ref: ${JSON.stringify(schema.$ref)}.`);
  }

  const { $ref: ignoredRef, ...siblingKeywords } = schema;
  void ignoredRef;
  const resolvedSchema = resolveReferencedSchema(resolvedTarget, root);

  if (Object.keys(siblingKeywords).length === 0) {
    return resolvedSchema;
  }

  return mergeJsonSchemas(resolvedSchema, siblingKeywords);
}

function mergeJsonSchemas(base: JsonSchema, overlay: JsonSchema): JsonSchema {
  const mergedProperties =
    base.properties === undefined && overlay.properties === undefined
      ? undefined
      : {
          ...(base.properties ?? {}),
          ...(overlay.properties ?? {}),
        };
  const mergedDefs =
    base.$defs === undefined && overlay.$defs === undefined
      ? undefined
      : {
          ...(base.$defs ?? {}),
          ...(overlay.$defs ?? {}),
        };
  const mergedRequired =
    base.required === undefined && overlay.required === undefined
      ? undefined
      : [...new Set([...(base.required ?? []), ...(overlay.required ?? [])])];

  return {
    ...base,
    ...overlay,
    ...(mergedDefs === undefined ? {} : { $defs: mergedDefs }),
    ...(mergedProperties === undefined ? {} : { properties: mergedProperties }),
    ...(mergedRequired === undefined ? {} : { required: mergedRequired }),
  };
}

function hasSelfReferencingRef(
  schema: JsonSchema,
  root: JsonSchema,
  path = "#",
  activePaths = new Set<string>()
): boolean {
  const nextActivePaths = new Set(activePaths);
  nextActivePaths.add(path);
  const localRefPath = getLocalRefPath(schema.$ref);

  if (localRefPath !== undefined) {
    if (nextActivePaths.has(localRefPath)) {
      return true;
    }

    const target = resolveLocalRef(root, localRefPath);

    if (target !== undefined && hasSelfReferencingRef(target, root, localRefPath, nextActivePaths)) {
      return true;
    }
  }

  if (schema.items !== undefined && hasSelfReferencingRef(schema.items, root, `${path}/items`, nextActivePaths)) {
    return true;
  }

  if (
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null &&
    hasSelfReferencingRef(
      schema.additionalProperties,
      root,
      `${path}/additionalProperties`,
      nextActivePaths
    )
  ) {
    return true;
  }

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    if (
      hasSelfReferencingRef(
        childSchema,
        root,
        `${path}/properties/${escapeJsonPointerSegment(key)}`,
        nextActivePaths
      )
    ) {
      return true;
    }
  }

  for (const [key, childSchema] of Object.entries(schema.$defs ?? {})) {
    if (
      hasSelfReferencingRef(
        childSchema,
        root,
        `${path}/$defs/${escapeJsonPointerSegment(key)}`,
        nextActivePaths
      )
    ) {
      return true;
    }
  }

  for (const [index, childSchema] of (schema.oneOf ?? []).entries()) {
    if (hasSelfReferencingRef(childSchema, root, `${path}/oneOf/${index}`, nextActivePaths)) {
      return true;
    }
  }

  for (const [index, childSchema] of (schema.anyOf ?? []).entries()) {
    if (hasSelfReferencingRef(childSchema, root, `${path}/anyOf/${index}`, nextActivePaths)) {
      return true;
    }
  }

  return false;
}

function getLocalRefPath(ref: string | undefined): string | undefined {
  if (ref === undefined) {
    return undefined;
  }

  if (ref === "#") {
    return "#";
  }

  return ref.startsWith("#/") ? ref : undefined;
}

function resolveLocalRef(root: JsonSchema, ref: string): JsonSchema | undefined {
  const path = getLocalRefPath(ref);

  if (path === undefined) {
    return undefined;
  }

  if (path === "#") {
    return root;
  }

  const segments = path.slice(2).split("/").map(unescapeJsonPointerSegment);
  let current: unknown = root;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment);

      if (index === undefined) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return isPlainObject(current) ? (current as JsonSchema) : undefined;
}

function appendDescription(
  description: string | undefined,
  addition: string | undefined
): string | undefined {
  if (addition === undefined || addition.length === 0) {
    return description;
  }

  if (description === undefined || description.length === 0) {
    return addition;
  }

  return `${description} ${addition}`;
}

function isPrimitiveEnumValue(value: unknown): value is PrimitiveEnumValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function getStringDefault(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumberDefault(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getIntegerDefault(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function getBooleanDefault(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getArrayDefault(value: unknown): JsonValue[] | undefined {
  return Array.isArray(value) && value.every((item) => isJsonValue(item)) ? value : undefined;
}

function getPrimitiveEnumDefault(
  value: unknown,
  candidates: readonly unknown[]
): PrimitiveEnumValue | undefined {
  return isPrimitiveEnumValue(value) && candidates.includes(value) ? value : undefined;
}

function getJsonDefault(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? value : undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeJsonPointerSegment(value: string): string {
  return value.split("~").join("~0").split("/").join("~1");
}

function unescapeJsonPointerSegment(value: string): string {
  return value.split("~1").join("/").split("~0").join("~");
}

function parseArrayIndex(value: string): number | undefined {
  if (value.length === 0) {
    return undefined;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return undefined;
    }
  }

  return Number.parseInt(value, 10);
}
