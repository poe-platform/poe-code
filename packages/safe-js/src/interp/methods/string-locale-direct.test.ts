import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { setSandboxPrototype } from "../object-model.js";
import { callStringMethod } from "./string.js";

it("rejects Symbol comparison without context", async () => {
  await expect(async () => await callStringMethod("2", "localeCompare", [Symbol()], new Budget())).rejects.toThrow(TypeError);
});

it("converts guest comparison without context", async () => {
  const comparison = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "10" }) };
  expect(await callStringMethod("2", "localeCompare", [comparison, "en", { numeric: true }], new Budget())).toBe(-1);
});

it("propagates comparison failures before locale conversion", async () => {
  const comparison = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => { throw "comparison"; } }) };
  await expect(async () => await callStringMethod("2", "localeCompare", [comparison, null], new Budget())).rejects.toBe("comparison");
});

it("reads inherited collation options without context", async () => {
  const options = {};
  setSandboxPrototype(options, { numeric: true });
  expect(await callStringMethod("2", "localeCompare", ["10", "en", options], new Budget())).toBe(-1);
});

it("converts guest option values without context", async () => {
  const sensitivity = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "base" }) };
  expect(await callStringMethod("a", "localeCompare", ["A", "en", { sensitivity }], new Budget())).toBe(0);
});

it("converts locale-list entries without context", async () => {
  const locale = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "en" }) };
  expect(await callStringMethod("2", "localeCompare", ["10", [locale], { numeric: true }], new Budget())).toBe(-1);
});
