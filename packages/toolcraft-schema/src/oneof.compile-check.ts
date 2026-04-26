import { S } from "./index.js";
import type { NumberSchema, ObjectSchema, OneOfSchema, Static, StringSchema } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredSchema = S.OneOf({
  discriminator: "kind",
  branches: {
    text: S.Object({
      value: S.String(),
    }),
    count: S.Object({
      value: S.Number(),
    }),
  },
});

type ignoredSchemaMatches = AssertAssignable<
  OneOfSchema<
    {
      text: ObjectSchema<{ value: StringSchema }>;
      count: ObjectSchema<{ value: NumberSchema }>;
    },
    "kind"
  >,
  typeof ignoredSchema
>;

type ignoredStaticMatches = AssertAssignable<
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "count";
      value: number;
    },
  Static<typeof ignoredSchema>
>;
