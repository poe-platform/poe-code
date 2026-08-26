import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SafeJsBudgetOptions, SafeJsRuntime } from "../../../src/commands/safejs/index.js";

export const localRoot = process.env.SAFEJS_LOCAL_ROOT;
export const localSkip = localRoot === undefined ? "Set SAFEJS_LOCAL_ROOT to the existing poe-code/packages/safejs checkout; contract fixtures are not interpreter proof" : false;

export async function localRuntime(): Promise<SafeJsRuntime<object>> {
  assert(localRoot, "SAFEJS_LOCAL_ROOT is required");
  const [runner, budget, filesystem, bridge] = await Promise.all([
    "run.ts", "interp/budget.ts", "modules/fs.ts", "interp/host-bridge.ts",
  ].map(path => import(pathToFileURL(join(localRoot, "src", path)).href) as Promise<Record<string, unknown>>));
  assert(runner && budget && filesystem && bridge);
  for (const [value, name] of [[runner.run, "run"], [budget.Budget, "Budget"], [filesystem.makeFsModule, "makeFsModule"], [bridge.declareHostOperation, "declareHostOperation"]]) assert.equal(typeof value, "function", name as string);
  const Budget = budget.Budget as new (options: SafeJsBudgetOptions) => object;
  return {
    run: runner.run as SafeJsRuntime<object>["run"],
    createBudget: options => new Budget(options),
    makeFsModule: filesystem.makeFsModule as SafeJsRuntime<object>["makeFsModule"],
    declareHostOperation: bridge.declareHostOperation as SafeJsRuntime<object>["declareHostOperation"],
  };
}
