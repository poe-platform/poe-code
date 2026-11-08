import { S } from "./index.js";
import type { ObjectSchema, Static, StringSchema, UnionSchema } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredSchema = S.Union([
  S.Object({
    email: S.String(),
  }),
  S.Object({
    phone: S.String(),
  }),
] as const);

type ignoredSchemaMatches = AssertAssignable<
  UnionSchema<
    readonly [ObjectSchema<{ email: StringSchema }>, ObjectSchema<{ phone: StringSchema }>]
  >,
  typeof ignoredSchema
>;

type ignoredStaticMatches = AssertAssignable<
  | {
      email: string;
    }
  | {
      phone: string;
    },
  Static<typeof ignoredSchema>
>;
