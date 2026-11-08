import { createRequire } from "node:module";
import { isPlainRecord } from "toolcraft-schema-rust";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(operation, args, host); }
  finally { depth--; }
}
const operations = {
  undefined: () => undefined,
  isObject: value => typeof value === "object" && value !== null && !Array.isArray(value),
  isString: value => typeof value === "string",
  isPlain: isPlainRecord,
  zeroLength: value => value.length === 0,
  oneLength: value => value.length === 1,
  fieldLabel: (label, key) => `${label}.${key}`,
  keys: value => Object.keys(value),
  noBranches: () => "No branches are available.",
  expectedBranches: names => `Expected one of: ${names.join(", ")}.`,
  hasOwn: (value, key) => Object.hasOwn(value, key),
  property: (value, key) => value[key],
  json: value => JSON.stringify(value),
  receivedType: value => value === null ? "null" : typeof value,
  invalidObject: (errors, label) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an object.` }),
  nonPlainObject: (errors, label) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an object, got non-plain object.` }),
  missingDiscriminator: (errors, field, expected) => errors.push({ path: field, message: `Missing discriminator "${field}". ${expected}` }),
  invalidDiscriminator: (errors, field, received, expected) => errors.push({ path: field, message: `Invalid discriminator "${field}": ${received}. ${expected}` }),
  withoutDiscriminator(value, key) {
    const { [key]: ignoredDiscriminator, ...rest } = value;
    void ignoredDiscriminator;
    return rest;
  },
  selected: (discriminator, branch, value) => ({ discriminator, branch, value }),
  array: () => [],
  push: (values, value) => values.push(value),
  validateBranch: (validator, branch, errors) => validator(branch, errors),
  branchFailure: (first, index) => ({ ...first, message: `Branch ${index + 1}: ${first.message}` }),
  noMatches: (errors, label, _matches, failures) => errors.push({ path: label, message: `No union branch matched for "${label}".` }, ...failures),
  multipleMatches: (errors, label, matches) => errors.push({ path: label, message: `Invalid value for "${label}". Expected exactly one union branch, but matched ${matches.length}.` }),
  eachUnionBranch(branches, matches, failures, validator) {
    for (const [index, branch] of branches.entries()) invoke(native.validateUnionBranch, [index, branch, matches, failures, validator]);
  }
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};

export function resolveDiscriminatedBranch(schema, value, discriminatorKey, label, errors) {
  return invoke(native.resolveDiscriminatedBranch, [schema, value, discriminatorKey, label, errors]);
}

export function validateUnionSchema(schema, value, label, errors, validateBranch) {
  return invoke(native.validateUnionSchema, [schema, value, label, errors, validateBranch]);
}
