import { describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { resolveModuleImports, type ModuleExports, type ModuleRegistry } from "./registry.js";

describe("MC-002 module namespace identity", () => {
  it.each([
    ["object", "object"],
    ["object", "map"],
    ["map", "object"],
    ["map", "map"]
  ])("shares namespaces and aliases with %s/%s registries", async (registryKind, exportsKind) => {
    const data = { count: 3 };
    const read = vi.fn(async () => 7);
    const exports = { data, default: data, read, renamed: read, absent: undefined };
    const moduleExports: ModuleExports =
      exportsKind === "map" ? new Map(Object.entries(exports)) : exports;
    const modules: ModuleRegistry =
      registryKind === "map" ? new Map([["api", moduleExports]]) : { api: moduleExports };
    const source = [
      'import data from "api";',
      'import { read, absent } from "api";',
      'import * as first from "api";',
      'import { renamed } from "api";',
      'import * as second from "api";',
      "const saved = first;",
      "const value = await second.read();",
      "return [first === second, saved === second, first.default === data,",
      "  first.data === data, first.read === read, second.renamed === renamed,",
      "  read === renamed, absent === undefined, value];"
    ].join("\n");

    expect(await run(source, { modules, budget: new Budget({ maxSteps: 1_000 }) })).toMatchObject({
      ok: true,
      returnValue: [true, true, true, true, true, true, true, true, 7]
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it("shares an empty null-prototype namespace within one resolution", () => {
    const bindings = resolveModuleImports(
      parseModule('import * as first from "empty"; import * as second from "empty";'),
      { empty: {} },
      { budget: new Budget() }
    );

    expect(bindings.first).toBe(bindings.second);
    expect(Object.getPrototypeOf(bindings.first)).toBeNull();
    expect(Object.keys(bindings.first as object)).toEqual([]);
  });

  it("keeps different module identifiers distinct even with shared host exports", async () => {
    const exports = { data: { count: 0 } };
    const source = [
      'import * as first from "alpha";',
      'import * as second from "beta";',
      'import * as again from "alpha";',
      "return [first === again, first !== second];"
    ].join("\n");

    expect(await run(source, { modules: { alpha: exports, beta: exports } })).toMatchObject({
      ok: true,
      returnValue: [true, true]
    });
  });

  it("allocates a new namespace for each import-resolution invocation", () => {
    const module = parseModule('import * as first from "api"; import * as second from "api";');
    const modules = { api: { value: 3 } };
    const original = resolveModuleImports(module, modules, { budget: new Budget() });
    const next = resolveModuleImports(module, modules, { budget: new Budget() });

    expect(original.first).toBe(original.second);
    expect(next.first).toBe(next.second);
    expect(next.first).not.toBe(original.first);
    expect(Object.getPrototypeOf(next.first)).toBeNull();
  });

  it("keeps copied exports isolated across concurrent and subsequent executions", async () => {
    const modules = { api: { data: { count: 0 } } };
    const source = [
      'import * as first from "api";',
      'import * as second from "api";',
      "first.data.count += 1;",
      "return [first === second, second.data.count];"
    ].join("\n");
    const concurrent = await Promise.all([run(source, { modules }), run(source, { modules })]);
    const subsequent = await run(source, { modules });

    for (const result of [...concurrent, subsequent]) {
      expect(result).toMatchObject({ ok: true, returnValue: [true, 1] });
    }
    expect(modules.api.data.count).toBe(0);
  });

  it("retains shared namespace inputs through repeated completed replay", async () => {
    const read = vi.fn(async (count: number) => count + 10);
    const source = [
      'import * as first from "api";',
      'import * as second from "api";',
      'import { data, read } from "api";',
      "const saved = first;",
      "data.count += 1;",
      "const value = await read(data.count);",
      "return [first === second, saved === second, first.data === data,",
      "  first.read === read, data.count, value];"
    ].join("\n");
    const original = await run(source, { modules: { api: { data: { count: 0 }, read } } });
    const expected = { ok: true, returnValue: [true, true, true, true, 1, 11] };
    expect(original).toMatchObject(expected);
    let snapshot = restore(JSON.parse(await dump(original)), { source });
    const replacement = vi.fn(async () => 99);

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const resumed = await run(source, { snapshot, modules: { api: { read: replacement } } });
      expect(resumed).toMatchObject(expected);
      snapshot = restore(JSON.parse(await dump(resumed)), { source });
    }
    expect(read).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("preserves namespace identity when recovering a bounded execution checkpoint", async () => {
    const read = vi.fn(async () => 7);
    const modules = { api: { read } };
    const source = [
      'import * as first from "api";',
      'import * as second from "api";',
      "const saved = first;",
      "const value = await first.read();",
      "let total = 0;",
      "for (let index = 0; index < 50; index += 1) total += index;",
      "return [first === second, saved === second, value, total];"
    ].join("\n");
    const execution = run(source, { modules, budget: new Budget({ maxSteps: 100 }) });
    await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
      source
    });

    expect(
      await run(source, { modules, snapshot, budget: new Budget({ maxSteps: 5_000 }) })
    ).toMatchObject({ ok: true, returnValue: [true, true, 7, 1225] });
    expect(read).toHaveBeenCalledOnce();
  });
});
