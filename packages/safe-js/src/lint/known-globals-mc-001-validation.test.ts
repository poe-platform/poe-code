import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
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

describe("MC-001 independent validation", () => {
  it("accepts globals through nested closures without custom allowed globals", async () => {
    const source =
      "const read = () => [Infinity, -Infinity, Number.isNaN(NaN), NaN === NaN]; return read();";

    expect(lint(source)).toEqual([]);
    await expect(run(source, { budget: new Budget({ maxSteps: 1_000 }) })).resolves.toMatchObject({
      ok: true,
      returnValue: [Infinity, -Infinity, true, false]
    });
  });

  describe.each(["Infinity", "NaN"])("lexical binding %s", (name) => {
    it.each([
      "const NAME = 43; return NAME;",
      "let NAME = 42; NAME += 1; return NAME;",
      "function read(NAME) { return NAME; } return read(43);",
      "const {value: NAME} = {value: 43}; return NAME;",
      "{ const NAME = 43; return NAME; }"
    ])("keeps local resolution and warnings: %s", async (template) => {
      const source = template.replaceAll("NAME", name);
      const diagnostics = lint(source);

      expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(AS003(source)).toEqual([]);
      expect(AS_SHADOW_GLOBAL(source)).toEqual([
        expect.objectContaining({
          code: "AS-SHADOW-GLOBAL",
          severity: "warning",
          message: `Local binding '${name}' shadows a runtime global.`
        })
      ]);
      await expect(run(source, { budget: new Budget({ maxSteps: 1_000 }) })).resolves.toMatchObject(
        {
          ok: true,
          returnValue: 43
        }
      );
    });

    it("preserves imported local bindings without shadow warnings", () => {
      const source = `import { value as ${name} } from "custom"; ${name};`;

      expect(lint(source, { modules: { custom: ["value"] } })).toEqual([]);
      expect(AS_SHADOW_GLOBAL(source)).toEqual([]);
    });
  });

  it.each([
    ["Infinty", "Infinity"],
    ["Infinityy", "Infinity"],
    ["NAN", "NaN"],
    ["nan", "NaN"]
  ])("rejects %s while suggesting %s", (misspelled, expected) => {
    const diagnostics = AS003(`${misspelled};`, { filename: "control.safejs" });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "AS003",
        severity: "error",
        filename: "control.safejs",
        line: 1,
        column: 1
      })
    ]);
    expect(diagnostics[0].message).toContain(`Unknown identifier '${misspelled}'.`);
    expect(diagnostics[0].message).toContain(`'${expected}'`);
    expect(diagnostics[0].span.end.offset).toBe(misspelled.length);
  });

  it("does not let recognized globals conceal unknown names", () => {
    const source = "[Infinity, NaN, unknownValue];";

    expect(lint(source)).toEqual([
      expect.objectContaining({ code: "AS003", severity: "error", column: 17 })
    ]);
    expect(lint(source, { allowedGlobals: ["unknownValue"] })).toEqual([]);
    expect(lint(source)).toHaveLength(1);
  });

  it("distinguishes plain property names from computed references", () => {
    expect(lint("const value = {Infinity: 1, NaN: 2, missing: 3}; value.missing;")).toEqual([]);
    expect(AS003("const value = {[Infinity]: 1, [NaN]: 2, [missing]: 3}; value;")).toEqual([
      expect.objectContaining({
        code: "AS003",
        message: expect.stringContaining("Unknown identifier 'missing'.")
      })
    ]);
  });

  it("retains existing global shadow diagnostics", () => {
    expect(AS_SHADOW_GLOBAL("const Math = 43; Math;")).toEqual([
      expect.objectContaining({
        code: "AS-SHADOW-GLOBAL",
        severity: "warning",
        message: "Local binding 'Math' shadows a runtime global."
      })
    ]);
  });

  it("allows warning-only shadowing through the actual harness", async () => {
    const filename = "/mc-001-independent.safejs";
    vol.fromJSON({ [filename]: "const Infinity = 43; return Infinity;" });

    await expect(
      runHarness(filename, { modulesFor: () => ({}), budget: new Budget({ maxSteps: 1_000 }) })
    ).resolves.toMatchObject({ ok: true, returnValue: 43 });
  });

  it("rejects a mixed known/unknown harness before any host callback", async () => {
    const filename = "/mc-001-independent-unknown.safejs";
    const observe = vi.fn();
    vol.fromJSON({
      [filename]:
        'import { observe } from "custom"; observe(); return [Infinity, NaN, missingValue];'
    });

    await expect(
      runHarness(filename, {
        modulesFor: () => ({ custom: { observe } }),
        budget: new Budget({ maxSteps: 1_000 })
      })
    ).rejects.toMatchObject({
      name: "LintError",
      diagnostics: [expect.objectContaining({ code: "AS003", severity: "error" })]
    });
    expect(observe).not.toHaveBeenCalled();
  });
});
