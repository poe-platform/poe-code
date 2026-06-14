import { S, toJsonSchemaDocument } from "./index.js";
import type {
  AnySchema,
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  JsonSchemaDocument,
  JsonSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  Static,
  StringSchema
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredStringSchema = S.String({ description: "Name", default: "guest" });
const ignoredNumberSchema = S.Number({ description: "Count", default: 1 });
const ignoredBooleanSchema = S.Boolean({ description: "Enabled", default: false });
const ignoredEnumSchema = S.Enum(["admin", "user"] as const, { default: "admin" });
const ignoredIntegerEnumSchema = S.Enum([1, 2] as const, { jsonType: "integer" });
const ignoredArraySchema = S.Array(S.String(), { default: ["a"] });
const ignoredObjectSchema = S.Object({
  name: S.String(),
  retries: S.Optional(S.Number())
});
const ignoredOptionalSchema = S.Optional(S.Boolean());

type ignoredStringMatches = AssertAssignable<StringSchema, typeof ignoredStringSchema>;
type ignoredNumberMatches = AssertAssignable<NumberSchema, typeof ignoredNumberSchema>;
type ignoredBooleanMatches = AssertAssignable<BooleanSchema, typeof ignoredBooleanSchema>;
type ignoredEnumMatches = AssertAssignable<
  EnumSchema<readonly ["admin", "user"]>,
  typeof ignoredEnumSchema
>;
type ignoredIntegerEnumMatches = AssertAssignable<
  EnumSchema<readonly [1, 2]>,
  typeof ignoredIntegerEnumSchema
>;
type ignoredArrayMatches = AssertAssignable<ArraySchema<StringSchema>, typeof ignoredArraySchema>;
type ignoredObjectMatches = AssertAssignable<
  ObjectSchema<{ name: StringSchema; retries: OptionalSchema<NumberSchema> }>,
  typeof ignoredObjectSchema
>;
type ignoredOptionalMatches = AssertAssignable<
  OptionalSchema<BooleanSchema>,
  typeof ignoredOptionalSchema
>;

type ignoredAnySchemaExported = AssertAssignable<AnySchema, typeof ignoredStringSchema>;
type ignoredJsonSchemaShape = AssertAssignable<
  JsonSchema,
  {
    type?: "string" | "number" | "boolean" | "array" | "object";
    description?: string;
    default?: unknown;
    enum?: ReadonlyArray<string | number | boolean>;
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
  }
>;

type ignoredStaticString = AssertAssignable<string, Static<typeof ignoredStringSchema>>;
type ignoredStaticNumber = AssertAssignable<number, Static<typeof ignoredNumberSchema>>;
type ignoredStaticBoolean = AssertAssignable<boolean, Static<typeof ignoredBooleanSchema>>;
type ignoredStaticEnum = AssertAssignable<"admin" | "user", Static<typeof ignoredEnumSchema>>;
type ignoredStaticIntegerEnum = AssertAssignable<1 | 2, Static<typeof ignoredIntegerEnumSchema>>;
type ignoredStaticArray = AssertAssignable<string[], Static<typeof ignoredArraySchema>>;
type ignoredStaticObject = AssertAssignable<
  { name: string; retries?: number },
  Static<typeof ignoredObjectSchema>
>;
type ignoredStaticOptional = AssertAssignable<
  boolean | undefined,
  Static<typeof ignoredOptionalSchema>
>;

const ignoredJsonSchemaDocument = toJsonSchemaDocument(ignoredObjectSchema, {
  id: "https://example.test/schema.json",
  title: "Example schema",
  description: "Example schema document"
});

type ignoredJsonSchemaDocumentShape = AssertAssignable<
  JsonSchemaDocument,
  typeof ignoredJsonSchemaDocument
>;
