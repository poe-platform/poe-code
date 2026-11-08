import { createRequire } from "node:module";
import { UserError } from "./index.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;

function invoke(operation, ...args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(operation, ...args, host); }
  finally { depth--; }
}

const operations = {
  undefined: () => undefined,
  map: () => new Map(),
  format: (formatter, key) => formatter(key),
  getMember: (members, key) => members.get(key),
  set: (members, key, value) => members.set(key, value),
  values: value => Object.values(value),
  entries: value => Object.entries(value),
  eachBranch(branches, formatter, surface) {
    for (const branch of branches) validateCasedSchemaMembers(branch, formatter, surface);
  },
  eachNamedBranch(branches, schema, formatter, surface) {
    for (const branch of branches) validateCasedSchemaMembers(branch, formatter, surface, schema.discriminator);
  },
  eachMember(entries, members, formatter, surface) {
    for (const [key, child] of entries) invoke(native.validateCasedSchemaMember, [members, key, child, formatter, surface]);
  },
  collision(existing, key, surface, member) {
    throw new UserError(`Parameters "${existing}" and "${key}" use conflicting ${surface} "${member}".`);
  },
  stackError: () => { throw new RangeError("Maximum call stack size exceeded"); }
};
const host = {
  operate: protect((name, args) => operations[name](...args)),
  get: protect((value, key) => value[key])
};

export function validateCasedSchemaMembers(schema, formatMember, surface, discriminator) {
  invoke(native.validateCasedSchemaMembers, schema, formatMember, surface, discriminator);
}
