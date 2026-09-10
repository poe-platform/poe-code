import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { getIntrinsicIdentity, getIntrinsicRealmIdentity, registerBuiltinIdentities, releaseIntrinsicIdentities } from "./intrinsics.js";

it("identifies all installation paths in one realm without exposing its table", () => {
  const budget = new Budget();
  const child = {};
  const root = { child };
  registerBuiltinIdentities(budget, { root });
  const identity = getIntrinsicRealmIdentity(root);
  expect(identity).toBeDefined();
  expect(getIntrinsicRealmIdentity(child)).toBe(identity);
  expect(Reflect.ownKeys(identity!)).toEqual([]);
  expect(Object.isFrozen(identity)).toBe(true);
});

it("distinguishes identical installation paths in independent realms", () => {
  const first = {}, second = {};
  registerBuiltinIdentities(new Budget(), { root: first });
  registerBuiltinIdentities(new Budget(), { root: second });
  expect(getIntrinsicIdentity(first)).toBe(getIntrinsicIdentity(second));
  expect(getIntrinsicRealmIdentity(first) === getIntrinsicRealmIdentity(second)).toBe(false);
});

it("preserves originating identities after release and reuse of a budget", () => {
  const budget = new Budget();
  const first = {}, second = {};
  registerBuiltinIdentities(budget, { root: first });
  const original = getIntrinsicRealmIdentity(first);
  releaseIntrinsicIdentities(budget);
  registerBuiltinIdentities(budget, { root: second });
  expect(getIntrinsicRealmIdentity(first)).toBe(original);
  expect(getIntrinsicRealmIdentity(second) === original).toBe(false);
  expect(getIntrinsicIdentity(first)).toBe('["root"]');
});

it("does not reassign an intrinsic's origin when another realm imports an alias", () => {
  const first = {}, second = { first };
  registerBuiltinIdentities(new Budget(), { root: first });
  const original = getIntrinsicRealmIdentity(first);
  registerBuiltinIdentities(new Budget(), { other: second });
  expect(getIntrinsicRealmIdentity(first)).toBe(original);
  expect(getIntrinsicRealmIdentity(second) === original).toBe(false);
  expect(getIntrinsicIdentity(first)).toBe('["root"]');
});

it("does not assign realm identities to unregistered objects", () => {
  expect(getIntrinsicRealmIdentity({})).toBeUndefined();
});
