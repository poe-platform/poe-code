import { S, withJsonSchema, withStandardSchema, toJsonSchema, type AnySchema, type Input, type Output, type StandardSchema, type Static } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredSchema = S.Object({
  query: S.String(),
  limit: S.Optional(S.Number({ default: 10 })),
  note: S.Optional(S.String()),
  nested: S.Array(S.Object({ enabled: S.Optional(S.Boolean({ default: true })) })),
  nullable: S.String({ nullable: true })
});

type ExpectedInput = { query: string; limit?: number; note?: string; nested: { enabled?: boolean }[]; nullable: string | null };
type ExpectedOutput = { query: string; limit: number; note?: string; nested: { enabled: boolean }[]; nullable: string | null };
type ignoredInput = AssertAssignable<ExpectedInput, Input<typeof ignoredSchema>>;
type ignoredInputReverse = AssertAssignable<Input<typeof ignoredSchema>, ExpectedInput>;
type ignoredOutput = AssertAssignable<ExpectedOutput, Output<typeof ignoredSchema>>;
type ignoredOutputReverse = AssertAssignable<Output<typeof ignoredSchema>, ExpectedOutput>;
type ignoredLegacyStatic = AssertAssignable<Static<typeof ignoredSchema>, ExpectedInput>;
type ignoredStandard = AssertAssignable<StandardSchema<ExpectedInput, ExpectedOutput>, typeof ignoredSchema>;

// @ts-expect-error A parsed default is always present.
const ignoredMissingDefault: Output<typeof ignoredSchema> = { query: "x", nested: [], nullable: null };

const ignoredNullableDefault = S.Optional(S.String({ nullable: true, default: "x" }));
type ignoredNullable = AssertAssignable<string | null, Output<typeof ignoredNullableDefault>>;
const ignoredUnionSchema = S.Union([S.Object({ a: S.Optional(S.Number({ default: 1 })) }), S.Object({ b: S.String() })]);
type ignoredUnion = AssertAssignable<{ a: number } | { b: string }, Output<typeof ignoredUnionSchema>>;
const ignoredTaggedSchema = S.OneOf({ discriminator: "kind", branches: { text: S.Object({ text: S.Optional(S.String({ default: "x" })) }) } });
type ignoredTagged = AssertAssignable<{ kind: "text"; text: string }, Output<typeof ignoredTaggedSchema>>;

const ignoredNative = withJsonSchema(S.Object({ count: S.Optional(S.Number({ default: 1 })) }), { type: "object" });
type ignoredNativeOutput = AssertAssignable<Output<typeof ignoredNative>, { count?: number }>;

declare const descriptor: AnySchema;
toJsonSchema(withStandardSchema(descriptor));
const ignoredJsonDefault = S.Object({ data: S.Optional(S.Json({ default: null })) });
type ignoredJsonOutput = AssertAssignable<{ data: unknown }, Output<typeof ignoredJsonDefault>>;

const ignoredUndefinedDefaults = S.Object({
  count: S.Optional(S.Number({ default: undefined })),
  data: S.Optional(S.Json({ default: undefined }))
});
type ignoredAbsentDefaults = AssertAssignable<Output<typeof ignoredUndefinedDefaults>, { count?: number; data?: null }>;
