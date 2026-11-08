import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { UserError } from "./index.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.approvalPlanPolicy, operation, args, host); }
  finally { depth--; }
}
const operations = {
  undefined: () => undefined,
  primitive: value => value === null || typeof value === "string" || typeof value === "boolean",
  number: value => typeof value === "number",
  finite: Number.isFinite,
  object: value => typeof value === "object",
  array: Array.isArray,
  plain(value) { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; },
  every: value => value.every(isApprovalPlanValue),
  everyValue: value => Object.values(value).every(isApprovalPlanValue),
  set: () => new Set(),
  has: (seen, value) => seen.has(value),
  add: (seen, value) => seen.add(value),
  withSeen(value, seen) {
    try { return invoke("children", [value, seen]); }
    finally { seen.delete(value); }
  },
  map: (value, seen) => value.map(item => invoke("normalize", [item, seen])),
  members(value, seen) {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(normalized, key, {
        value: invoke("normalize", [value[key], seen]),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return normalized;
  },
  canonical: value => JSON.stringify(value),
  digest: canonical => createHash("sha256").update(canonical).digest("hex"),
  display: value => JSON.stringify(value, null, 2),
  plan: (value, canonical, display, digest) => ({ value, canonical, display, hash: `sha256:${digest}` }),
  nonFinite() { throw new UserError("Approval plan numbers must be finite."); },
  invalidValue() { throw new UserError("Approval plan must contain only JSON values."); },
  circular() { throw new UserError("Approval plan must not contain circular references."); },
  changed(expected, actual) { throw new UserError(`Approval plan changed after approval. Expected ${expected}, received ${actual}.`); },
  invalidOperation() { throw new TypeError("Invalid approval plan operation"); }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

export function isApprovalPlanValue(value) {
  return invoke("isValue", [value]);
}
export function createApprovalPlan(value) {
  return invoke("create", [value]);
}
export function formatApprovalMessage(message, plan) {
  return `${message}\n\nPlan:\n${plan.display}\n\nPlan hash: ${plan.hash}`;
}
export function assertApprovalPlanHash(expected, actual) {
  return invoke("assertHash", [expected, actual]);
}
