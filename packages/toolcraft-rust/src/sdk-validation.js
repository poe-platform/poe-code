import { createRequire } from "node:module";
import { cloneDefaultValue, formatIssues, isJsonValue, isPlainRecord, nativeJsonSchema, unicodeLength, validate } from "toolcraft-schema-rust";
import { suggest, UserError } from "./index.js";
import { validateAppliedDefault } from "./applied-default.js";
import { resolveDiscriminatedBranch, validateUnionSchema } from "./branch-validation.js";
import { callNative, protect } from "./host-errors.js";
import { getExpectedNumberDescription, isValidNumberSchemaValue } from "./number-schema.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const lower = protect(value => value.toLowerCase());
const upper = protect(value => value.toUpperCase());
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.sdkValidate, operation, args, host); }
  finally { depth--; }
}

export function formatSegment(value) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.sdkFormatSegment, value, lower, upper); }
  finally { depth--; }
}

function describeReceived(value) {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return isPlainRecord(value) ? "object" : "non-plain object";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (["bigint", "symbol", "function"].includes(typeof value)) return typeof value;
  return String(value);
}

function enumError(value, schema, label) {
  let suggestionLine = " ";
  if (typeof value === "string") {
    const suggestions = suggest(value, schema.values.map(candidate => String(candidate)));
    if (suggestions.length > 0) suggestionLine = ` Did you mean: ${suggestions.join(", ")}?\n`;
  }
  return `Invalid value for "${label}".${suggestionLine}Expected one of: ${schema.values.map(candidate => String(candidate)).join(", ")}, got ${describeReceived(value)}.`;
}

const operations = {
  undefined: () => undefined,
  overflow() { throw new RangeError("Maximum call stack size exceeded"); },
  invalidOperation() { throw new TypeError("Invalid SDK validation operation"); },
  object: () => ({}),
  isPlain: isPlainRecord,
  isJson: isJsonValue,
  isNull: value => value === null,
  isString: value => typeof value === "string",
  validNumber: isValidNumberSchemaValue,
  isBoolean: value => typeof value === "boolean",
  isArray: Array.isArray,
  lt: (left, right) => left < right,
  gt: (left, right) => left > right,
  empty: value => value.length === 0,
  fieldLabel: (label, key) => `${label}.${key}`,
  hasOwn: (value, key) => Object.prototype.hasOwnProperty.call(value, key),
  property: (value, key) => value[key],
  mapGet: (map, key) => map.get(key),
  mapHas: (map, key) => map.has(key),
  includes: (values, value) => !!values.includes(value),
  define: (output, key, value) => Object.defineProperty(output, key, { value, enumerable: true, configurable: true, writable: true }),
  nativeSchema: schema => schema[nativeJsonSchema],
  format: formatSegment,
  clone: cloneDefaultValue,
  default: validateAppliedDefault,
  validate,
  unicodeLength,
  matches: (pattern, value) => !!new RegExp(pattern).test(value),
  fields(shape) {
    const fields = new Map();
    for (const [key, schema] of Object.entries(shape)) fields.set(formatSegment(key), [key, schema]);
    return fields;
  },
  extras(schema, input, label, errors, output, fields) {
    for (const key of Object.keys(input)) invoke("extra", [schema, input, label, errors, output, fields, key]);
  },
  members(input, label, errors, output, fields) {
    for (const [key, [original, schema]] of fields.entries()) invoke("field", [input, label, errors, output, key, original, schema]);
  },
  value: (...args) => invoke("value", args),
  validateObject: (...args) => invoke("object", args),
  native: (...args) => invoke("native", args),
  normalize: (...args) => invoke("normalize", args),
  omit: (schema, value) => invoke("omit", [schema, value, 0, { nodes: 10_000 }]),
  omitNext: (schema, value, depth, budget) => invoke("omit", [schema, value, depth + 1, budget]),
  arrayValues: (schema, value, label, errors) => Array.from({ length: value.length }, (_item, index) =>
    invoke("value", [schema.item, value[index], `${label}[${index}]`, errors])),
  recordValues: (schema, value, label, errors) => Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, invoke("value", [schema.value, item, `${label}.${key}`, errors])])),
  discriminator: resolveDiscriminatedBranch,
  discriminatedValue: (value, schema, resolved) => ({ ...value, [schema.discriminator]: resolved.discriminator }),
  union: (schema, value, label, errors) => validateUnionSchema(schema, value, label, errors,
    (branch, branchErrors) => invoke("object", [branch, value, label, branchErrors])),
  invalidObject: (errors, label, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.` }),
  invalidString: (errors, label, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected a string, got ${describeReceived(value)}.` }),
  invalidBoolean: (errors, label, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected a boolean, got ${describeReceived(value)}.` }),
  invalidArray: (errors, label, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an array, got ${describeReceived(value)}.` }),
  invalidJson: (errors, label) => errors.push({ path: label, message: `Invalid value for "${label}". Expected a JSON value.` }),
  invalidNumber: (errors, label, value, schema) => errors.push({ path: label, message: `Invalid value for "${label}". Expected ${getExpectedNumberDescription(schema)}, got ${describeReceived(value)}.` }),
  invalidEnum: (errors, label, value, schema) => errors.push({ path: label, message: enumError(value, schema, label) }),
  patternError: (errors, label, value, schema) => errors.push({ path: label, message: `Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".` }),
  shortString: (errors, label, schema, length) => errors.push({ path: label, message: `Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${length}.` }),
  longString: (errors, label, schema, length) => errors.push({ path: label, message: `Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${length}.` }),
  shortArray: (errors, label, schema, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).` }),
  longArray: (errors, label, schema, value) => errors.push({ path: label, message: `Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).` }),
  unexpected: (errors, field, fields, label) => errors.push({ path: field, message: `Unexpected parameter "${field}". Available: ${[...fields.keys()].map(key => label.length === 0 ? key : `${label}.${key}`).sort().join(", ")}.` }),
  missing: (errors, field) => errors.push({ path: field, message: `Missing required parameter "${field}".` }),
  alias: (errors, alias, field) => errors.push({ path: alias, message: `Unexpected parameter "${alias}". Use "${field}" for this declared parameter.` }),
  nativeIssues: (errors, label, issues) => errors.push(...issues.map(issue => ({ path: [label, ...issue.path].filter(part => part !== "").join("."), message: formatIssues([issue]) }))),
  jsonIssues(errors, label, issues) {
    for (const issue of issues) errors.push({ path: label, message: `Invalid value for "${label}". Expected a JSON value, got ${issue.received}.` });
  },
  duplicate(key) { throw new UserError(`Multiple parameters map to "${key}".`); },
  nativeFields: schema => invoke("nativeFields", [schema]),
  singleShape: shape => [shape],
  branchShapes: branches => branches.map(branch => branch.shape),
  values: Object.values,
  array: () => [],
  shapeFields: shapes => new Map(shapes.flatMap(shape => Object.entries(shape).map(([key, child]) => [formatSegment(key), [key, child]]))),
  normalizeArray: (schema, value) => value.map(item => invoke("normalize", [schema.item, item])),
  normalizeRecord: (schema, value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, invoke("normalize", [schema.value, item])])),
  normalizeMembers(output, fields, value) {
    for (const [key, item] of Object.entries(value)) invoke("normalizeField", [output, fields, key, item]);
  },
  normalizeDefaults(output, shape) {
    for (const [key, child] of Object.entries(shape)) invoke("normalizeDefault", [output, key, child]);
  },
  omitExhausted: (depth, budget) => depth > 64 || --budget.nodes < 0,
  oversizedArray: value => value.length > 10_000,
  descriptors: Object.getOwnPropertyDescriptors,
  hasValue: property => "value" in property,
  delete: (descriptors, key) => delete descriptors[key],
  descriptorValue: (property, value) => { property.value = value; },
  objectDescriptors: (value, descriptors) => Object.create(Object.getPrototypeOf(value), descriptors),
  arrayDescriptors(value, descriptors) {
    const output = Object.defineProperties([], descriptors);
    Object.setPrototypeOf(output, Object.getPrototypeOf(value));
    return output;
  },
  omitArray(schema, value, descriptors, depth, budget) {
    for (let index = 0; index < value.length; index++) {
      const property = descriptors[String(index)];
      invoke("omitDescriptor", [schema, property, depth, budget, "item"]);
    }
  },
  omitRecord(schema, descriptors, depth, budget) {
    for (const property of Object.values(descriptors)) invoke("omitDescriptor", [schema, property, depth, budget, "value"]);
  },
  omitMembers(descriptors, fields, depth, budget) {
    for (const [key, [, field]] of fields) invoke("omitField", [descriptors, key, field, depth, budget]);
  }
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};

export function validateObjectSchema(schema, value, label, errors) {
  return invoke("object", [schema, value, label, errors]);
}
