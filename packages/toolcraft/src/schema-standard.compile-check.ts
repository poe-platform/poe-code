import { S, type Input, type Output, type StandardSchema } from "./index.js";
import { withStandardSchema } from "./schema.js";

const ignoredSchema = S.Object({ limit: S.Optional(S.Number({ default: 10 })) });
type AssertAssignable<To, ignoredFrom extends To> = true;
type ignoredInput = AssertAssignable<Input<typeof ignoredSchema>, { limit?: number }>;
type ignoredOutput = AssertAssignable<{ limit: number }, Output<typeof ignoredSchema>>;
type ignoredStandard = AssertAssignable<StandardSchema<{ limit?: number }, { limit: number }>, typeof ignoredSchema>;
withStandardSchema(structuredClone(ignoredSchema));
