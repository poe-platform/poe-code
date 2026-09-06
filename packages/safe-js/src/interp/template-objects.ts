import type { TemplateLiteral } from "../parse.js";
import type { Budget } from "./budget.js";
import type { SandboxArray } from "./values.js";

const realms = new WeakMap<Budget, Map<TemplateLiteral, SandboxArray>>();
export const templateOrigins = new WeakMap<SandboxArray, TemplateLiteral>();
export const templateRawArrays = new WeakMap<SandboxArray, SandboxArray>();
export const templateCookedArrays = new WeakMap<SandboxArray, SandboxArray>();

export function templateObject(node: TemplateLiteral, budget: Budget): SandboxArray {
  const cached = realms.get(budget)?.get(node);
  if (cached !== undefined) return cached;
  budget.allocateArrayLength(node.quasis.length);
  const strings = node.quasis.map(quasi => quasi.value.cooked === undefined
    ? undefined : budget.allocateString(quasi.value.cooked)) as SandboxArray;
  const raw = node.quasis.map(quasi => budget.allocateString(quasi.value.raw)) as SandboxArray;
  Object.freeze(raw);
  Object.defineProperty(strings, "raw", { value: raw });
  Object.freeze(strings);
  registerTemplateObject(node, strings, budget);
  return strings;
}

export function registerTemplateObject(node: TemplateLiteral, value: SandboxArray, budget: Budget): void {
  const raw = Object.getOwnPropertyDescriptor(value, "raw")?.value;
  if (!Object.isFrozen(value) || !Array.isArray(raw) || !Object.isFrozen(raw) ||
      value.length !== node.quasis.length || raw.length !== node.quasis.length ||
      node.quasis.some((quasi, index) => Object.getOwnPropertyDescriptor(value, String(index))?.value !== quasi.value.cooked ||
        Object.getOwnPropertyDescriptor(raw, String(index))?.value !== quasi.value.raw))
    throw new TypeError("Invalid template object contents.");
  let realm = realms.get(budget);
  const existing = realm?.get(node);
  if (existing !== undefined && existing !== value) throw new TypeError("Conflicting template object identity.");
  if (realm === undefined) {
    realm = new Map();
    realms.set(budget, realm);
    const retained = realm;
    budget.setRetainedValues(realm, () => retained.values());
  }
  realm.set(node, value);
  templateOrigins.set(value, node);
  templateRawArrays.set(value, raw as SandboxArray);
  templateCookedArrays.set(raw as SandboxArray, value);
}

export function releaseTemplateObjects(budget: Budget): void {
  const realm = realms.get(budget);
  if (realm !== undefined) budget.setRetainedValues(realm, undefined);
  realms.delete(budget);
}
