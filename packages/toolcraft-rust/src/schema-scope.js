import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const unfilteredSchemas = new WeakMap();
let depth = 0;

function invoke(operation, ...args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(operation, ...args, host); }
  finally { depth--; }
}

const operations = {
  undefined: () => undefined,
  includes: (values, scope) => !!values.includes(scope),
  copy: (schema) => ({ ...schema }),
  copyInner: (schema, inner) => ({ ...schema, inner }),
  copyItem: (schema, item) => ({ ...schema, item }),
  copyValue: (schema, value) => ({ ...schema, value }),
  copyBranches: (schema, branches) => ({ ...schema, branches }),
  setShape: (schema, shape) => ({ ...schema, shape }),
  mapShape: (shape, scope) => Object.fromEntries(Object.entries(shape).flatMap(([key, child]) =>
    invoke(native.filterScopeBranch, child, scope, key, true, false))),
  mapNamedBranches: (branches, scope) => Object.fromEntries(Object.entries(branches).flatMap(([key, child]) =>
    invoke(native.filterScopeBranch, child, scope, key, true, true))),
  mapBranches: (branches, scope) => branches.flatMap(child =>
    invoke(native.filterScopeBranch, child, scope, undefined, false, true)),
  noKeys: (value) => Object.keys(value).length === 0,
  zeroLength: (value) => value.length === 0,
  emptyArray: () => [],
  entryArray: (key, value) => [[key, value]],
  valueArray: (_key, value) => [value],
  remember: (filtered, schema) => unfilteredSchemas.set(filtered, unfilteredSchemas.get(schema) ?? schema),
  stackError: () => { throw new RangeError("Maximum call stack size exceeded"); }
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};

export function filterSchemaForScope(schema, scope) {
  return invoke(native.filterSchemaForScope, schema, scope);
}

export function getUnfilteredSchema(schema) {
  return unfilteredSchemas.get(schema) ?? schema;
}
