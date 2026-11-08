import { createRequire } from "node:module";
import { S, withJsonSchema, normalizeLegacyNullability } from "toolcraft-schema-rust";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.jsonSchemaConversion, operation, args, host); }
  finally { depth--; }
}
const pointer = value => value.split("~").join("~0").split("/").join("~1");
const schemaPath = path => path.length === 0 ? "#" : `#/${path.map(pointer).join("/")}`;
const operations = {
  undefined: () => undefined,
  true: () => true,
  false: () => false,
  null: () => null,
  record: () => ({}),
  list: () => [],
  set: value => new Set(value),
  clone: value => ({ ...value }),
  boolean: value => typeof value === "boolean",
  string: value => typeof value === "string",
  number: value => typeof value === "number",
  object: value => typeof value === "object" && value !== null && !Array.isArray(value),
  objectType: value => typeof value === "object",
  array: Array.isArray,
  integer: Number.isInteger,
  truthy: value => !!value,
  nullValue: value => value === null,
  empty: value => value.length === 0,
  single: value => value.length === 1,
  multiple: value => value.length > 1,
  sameLength: (left, right) => left.length === right.length,
  allUnique: values => new Set(values).size === values.length,
  includes: (values, value) => values.includes(value),
  has: (values, value) => values.has(value),
  add: (values, value) => values.add(value),
  push: (values, value) => values.push(value),
  own: (value, key) => Object.prototype.hasOwnProperty.call(value, key),
  hasDefault: value => Object.prototype.hasOwnProperty.call(value, "default"),
  property: (value, key) => value[key],
  keys: Object.keys,
  values: Object.values,
  entries: Object.entries,
  fromEntries: Object.fromEntries,
  iterator: value => value[Symbol.iterator](),
  next: iterator => iterator.next(),
  first(value) { const [first] = value; return first; },
  nonNull: values => values.filter(value => value !== null),
  nonNullTypes: types => types.filter(type => type !== "null"),
  containsNullType: types => types.includes("null"),
  singleton: value => [value],
  pair: (key, value) => [key, value],
  pathItems: path => [...path, "items"],
  pathAdditional: path => [...path, "additionalProperties"],
  pathProperty: (path, key) => [...path, "properties", key],
  pathBranch: (path, keyword, index) => [...path, keyword, String(index)],
  literalDescription: value => `Constant JSON value: ${JSON.stringify(value)}.`,
  enumDescription: values => `Allowed JSON values: ${values.map(value => JSON.stringify(value)).join(", ")}.`,
  joinDescription: (description, addition) => `${description} ${addition}`,
  define: (shape, key, value) => Object.defineProperty(shape, key, { configurable: true, enumerable: true, writable: true, value }),
  withoutRef(schema) { const { $ref, ...siblings } = schema; void $ref; return siblings; },
  mergeObjects: (base, overlay) => ({ ...base, ...overlay }),
  mergeRequired: (base, overlay) => [...new Set([...(base ?? []), ...(overlay ?? [])])],
  refPrefix: ref => ref.startsWith("#/"),
  refSegments: ref => ref.slice(2).split("/").map(value => value.split("~1").join("/").split("~0").join("~")),
  parseIndex: value => Number.parseInt(value, 10),
  validIndex: value => native.jsonSchemaArrayIndex(Array.from(value, char => char.charCodeAt(0))),
  selfState: (path, active) => new Set([...active, path]),
  selfChildren(schema, root, path, active) {
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (invoke("selfRef", [child, root, `${path}/properties/${pointer(key)}`, active])) return true;
    for (const [key, child] of Object.entries(schema.$defs ?? {}))
      if (invoke("selfRef", [child, root, `${path}/$defs/${pointer(key)}`, active])) return true;
    for (const [index, child] of (schema.oneOf ?? []).entries())
      if (invoke("selfRef", [child, root, `${path}/oneOf/${index}`, active])) return true;
    for (const [index, child] of (schema.anyOf ?? []).entries())
      if (invoke("selfRef", [child, root, `${path}/anyOf/${index}`, active])) return true;
    for (const [index, child] of (schema.allOf ?? []).entries())
      if (invoke("selfRef", [child, root, `${path}/allOf/${index}`, active])) return true;
    return false;
  },
  selfItems: (items, root, path, active) => items.some((item, index) => invoke("selfRef", [item, root, `${path}/items/${index}`, active])),
  selfItemPath: path => `${path}/items`,
  selfAdditionalPath: path => `${path}/additionalProperties`,
  rootPath: () => "#",
  nativeChildren: schema => [...Object.values(schema.properties ?? {}), ...Object.values(schema.$defs ?? {}),
    ...(schema.items === undefined ? [] : Array.isArray(schema.items) ? schema.items : [schema.items]),
    ...(typeof schema.additionalProperties === "object" ? [schema.additionalProperties] : [])],
  projectionState: () => ({ properties: Object.create(null), required: new Set(), unconditional: Object.create(null), conditional: new Map(), visited: new Set() }),
  collectProperties(resolved, state, includeRequired) {
    Object.assign(state.properties, resolved.properties ?? {});
    if (includeRequired) Object.assign(state.unconditional, resolved.properties ?? {});
    else for (const [key, property] of Object.entries(resolved.properties ?? {})) {
      const candidates = state.conditional.get(key) ?? [];
      candidates.push(property); state.conditional.set(key, candidates);
    }
    if (includeRequired) for (const key of resolved.required ?? []) state.required.add(key);
  },
  collectBranches(resolved, root, state, required) {
    for (const branch of resolved.allOf ?? []) invoke("collect", [branch, root, state, required]);
    for (const branch of [...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])]) invoke("collect", [branch, root, state, false]);
  },
  conditionalCandidates: (state, key, property) => state.conditional.get(key) ?? [property],
  enumValues: projected => [...new Set(projected.flatMap(field => field.kind === "enum" ? field.values : []))],
  fingerprints: branches => branches.map(branch => JSON.stringify([...(branch.required ?? [])].sort())),
  matchBranches(branches, candidate, root, values) {
    for (const branch of branches) if (!invoke("matchBranch", [branch, candidate, root, values])) return false;
    return true;
  },
  withoutDefault: projected => ({ ...projected, default: undefined }),
  invalidType(path, type) { throw new Error(`JSON Schema "${schemaPath(path)}" has an unsupported type "${Array.isArray(type) ? JSON.stringify(type) : String(type)}". Supported: string, number, integer, boolean, array, object.`); },
  missingItems(path) { throw new Error(`JSON Schema "${schemaPath(path)}" is an array but is missing the "items" field. Add "items": { ... } to declare the element type.`); },
  missingType(path) { throw new Error(`JSON Schema "${schemaPath(path)}" must declare one of: "type", "enum", "const", "oneOf", "anyOf", or "allOf".`); },
  notObject(path, schema) { const type = schema.type; throw new Error(`Expected "${schemaPath(path)}" to be an object schema (got "${typeof type === "string" ? type : type === undefined ? "unknown" : JSON.stringify(type)}").`); },
  emptyBranches(path) { throw new Error(`JSON Schema "${schemaPath(path)}" uses oneOf/anyOf/allOf but has no branches.`); },
  withNative: (projection, schema) => withJsonSchema(projection, normalizeLegacyNullability(schema)),
  String: S.String, Number: S.Number, Boolean: S.Boolean, Array: S.Array, Object: S.Object,
  Record: S.Record, Json: S.Json, Enum: S.Enum, OneOf: S.OneOf, Union: S.Union, Optional: S.Optional,
  invalidOperation() { throw new TypeError("Invalid JSON schema conversion operation"); }
};
const host = {
  get: protect((value, key) => value[key]),
  operate: protect((name, args) => {
    if (name.startsWith("set:")) { args[0][name.slice(4)] = args[1]; return args[0]; }
    if (name.startsWith("literal:")) return name.slice(8);
    if (name.startsWith("map:")) return args[0].map((value, index) => invoke(name.slice(4), [value, index, ...args.slice(1)]));
    if (name.startsWith("some:")) return args[0].some((value, index) => invoke(name.slice(5), [value, index, ...args.slice(1)]));
    if (name.startsWith("every:")) return args[0].every((value, index) => invoke(name.slice(6), [value, index, ...args.slice(1)]));
    return Object.hasOwn(operations, name) ? operations[name](...args) : invoke(name, args);
  })
};

export function convertJsonSchema(schema) {
  return invoke("root", [schema]);
}
