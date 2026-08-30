import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

import { Budget } from "../interp/budget.js";
import { createMathGlobals } from "../interp/globals/math.js";
import { lint } from "./index.js";
import { AS003 } from "./rules/AS003.js";
import { AS_SHADOW_GLOBAL } from "./rules/AS-shadow-global.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runHarness } = await import("../runner/run-harness.js");

afterEach(() => {
  vol.reset();
});

describe("MC-001 runtime global lint parity", () => {
  it.each(Object.keys(createMathGlobals()))("recognizes runtime math global %s", (name) => {
    expect(AS003(`${name};`)).toEqual([]);
    expect(lint(`${name};`)).toEqual([]);
  });

  it("accepts named nonfinite constants in expressions and Number properties", () => {
    expect(
      lint(
        "[Infinity, -Infinity, NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN];"
      )
    ).toEqual([]);
  });

  it.each(["Infinity", "NaN"])("preserves local and parameter shadowing for %s", (name) => {
    for (const source of [`const ${name} = 1; ${name};`, `(${name}) => ${name};`]) {
      expect(AS003(source)).toEqual([]);
      expect(AS_SHADOW_GLOBAL(source)).toEqual([
        expect.objectContaining({
          code: "AS-SHADOW-GLOBAL",
          severity: "warning",
          message: `Local binding '${name}' shadows a runtime global.`
        })
      ]);
    }
  });

  it.each(["Infinity", "NaN"])("preserves imported bindings named %s", (name) => {
    const source = `import { ${name} } from "custom"; ${name};`;
    expect(AS003(source)).toEqual([]);
    expect(AS_SHADOW_GLOBAL(source)).toEqual([]);
  });

  it.each(["Infinty", "Nan", "missing"])("still rejects unknown identifier %s", (name) => {
    expect(lint(`${name};`)).toEqual([
      expect.objectContaining({ code: "AS003", severity: "error" })
    ]);
  });

  it("continues to require explicit caller-provided globals", () => {
    expect(AS003("Custom;")).toHaveLength(1);
    expect(lint("Custom;", { allowedGlobals: ["Custom"] })).toEqual([]);
    expect(AS_SHADOW_GLOBAL("const Custom = 1;", { allowedGlobals: ["Custom"] })).toEqual([
      expect.objectContaining({ code: "AS-SHADOW-GLOBAL" })
    ]);
  });

  it("passes the default harness gate and evaluates nonfinite globals", async () => {
    const filename = "/mc-001.safejs";
    vol.fromJSON({
      [filename]: "return [Infinity, -Infinity, NaN, Number.isNaN(NaN), isFinite(Infinity)];"
    });

    await expect(
      runHarness(filename, {
        modulesFor: () => ({}),
        budget: new Budget({ maxSteps: 1_000 })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [Infinity, -Infinity, NaN, true, false]
    });
  });

  it("keeps unknown identifiers blocked by the default harness gate", async () => {
    const filename = "/mc-001-unknown.safejs";
    vol.fromJSON({ [filename]: "return missing;" });

    await expect(runHarness(filename, { modulesFor: () => ({}) })).rejects.toMatchObject({
      name: "LintError",
      diagnostics: [expect.objectContaining({ code: "AS003", severity: "error" })]
    });
  });
});
