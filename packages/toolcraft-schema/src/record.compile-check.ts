import { S } from "./index.js";
import type { RecordSchema, Static, StringSchema } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredSchema = S.Record(S.String());

type ignoredSchemaMatches = AssertAssignable<RecordSchema<StringSchema>, typeof ignoredSchema>;
type ignoredStaticMatches = AssertAssignable<Record<string, string>, Static<typeof ignoredSchema>>;
