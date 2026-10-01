// Use the reference module's private symbol only in the reference harness.
// The native public entry has its own bundle-local symbol, just like the JS API.
import { nativeJsonSchema } from "../../toolcraft-schema/src/native-json-schema.ts";
import { createValidator } from "../dist/host-values.js";
export { isPlainRecord } from "../dist/host-values.js";
export const validate = createValidator(nativeJsonSchema);
