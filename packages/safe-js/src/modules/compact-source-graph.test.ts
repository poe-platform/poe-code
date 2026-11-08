import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { Scope } from "../interp/scope.js";
import { compactAstStatistics } from "../parse/compact-module-ast.js";
import type { Module } from "../parse/parser.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

it("links and evaluates a module without expanding its cold exported function", async () => {
  const budget = new Budget();
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const scope = new Scope(createBuiltinBindings({ budget, compileOwner: lease.owner }));
  const graph = new SourceModuleGraph({
    resolver: () => undefined,
    scope,
    budget,
    compilation,
    surfaceUnhandledThrows: true,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner })
  });
  const source = `export function cold(){/*${"x".repeat(512)}*/return [${Array.from({ length: 1000 }, (_, i) => `{value:${i}}`).join(",")}];}export const ready=true;`;
  try {
    let parsed: Module | undefined;
    const namespace = await graph.evaluateSource({ id: "entry", source }, (module) => {
      parsed = module;
      expect(compactAstStatistics(module)?.materializedRecords).toBeLessThan(30);
    });
    expect(namespace.ready).toBe(true);
    expect(namespace.cold).toBeDefined();
    expect(compactAstStatistics(parsed!)!.materializedRecords).toBeLessThan(50);
  } finally {
    compilation.dispose();
    lease.release();
  }
});
