import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import * as registry from "./registry.js";

it("shares cached namespaces between static and dynamic resolution", () => {
  const budget = new Budget();
  const modules = {fixture:{value:7}};
  const environment = registry.createModuleEnvironment(modules,{budget});
  const fixed = registry.resolveModuleImports(parseModule("import * as fixed from 'fixture'"),modules,{budget,environment});
  const dynamic = registry.resolveModuleNamespace(environment,"fixture");
  expect(dynamic).toBe(fixed.fixed);
  expect(registry.resolveModuleNamespace(environment,"fixture")).toBe(dynamic);
});

it("keeps unloaded namespaces out of captured environment data", () => {
  const environment = registry.createModuleEnvironment({first:{value:1},second:{value:2}},{budget:new Budget()});
  registry.resolveModuleNamespace(environment,"first");
  expect(Object.keys(environment.namespaces)).toEqual(["first"]);
  expect(environment.available).toEqual(["first","second"]);
});

it("rejects unregistered modules rather than invoking the host module loader", () => {
  const environment = registry.createModuleEnvironment({}, {budget:new Budget()});
  expect(()=>registry.resolveModuleNamespace(environment,"node:fs")).toThrow("Unknown module");
});
