import { S } from "./index.js";
import type { JsonValue, JsonValueSchema, Static } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

const ignoredSchema = S.Json();

type ignoredSchemaMatches = AssertAssignable<JsonValueSchema, typeof ignoredSchema>;
type ignoredStaticMatches = AssertAssignable<JsonValue, Static<typeof ignoredSchema>>;
