import { createRequire } from "node:module";
import { cloneDefaultValue, validate } from "toolcraft-schema-rust";
import { getUnfilteredSchema } from "./schema-scope.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const operations = {
  clone: cloneDefaultValue,
  unfiltered: getUnfilteredSchema,
  validate: (schema, value) => validate(schema, value, { defaults: "none" }),
  firstMessage: issues => issues[0]?.message,
  fallback: () => "Default does not satisfy schema.",
  invalid: (errors, label, message) => errors.push({ path: label, message: `Invalid default for "${label}". ${message}` })
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};
let depth = 0;

export function validateAppliedDefault(schema, label, errors) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.validateAppliedDefault, schema, label, errors, host); }
  finally { depth--; }
}
