import { describe, expect, it } from "vitest";
import { AS_UNUSED_IMPORT, fixASUnusedImports } from "./rules/AS-unused-import.js";
import { run } from "../run.js";

describe("imports read through direct eval", () => {
  it.each([
    'import { value } from "api"; return eval("value");',
    'import { value } from "api"; return (() => eval("value"))();',
    'import * as api from "api"; return eval("api.value");'
  ])("preserves runtime dependencies when fixing %s", async source => {
    const options = { modules: { api: { value: 7 } } };
    expect(await run(source, options)).toMatchObject({ ok: true, returnValue: 7 });
    expect(AS_UNUSED_IMPORT(source)).toEqual([]);
    const fixed = fixASUnusedImports(source);
    expect(fixed).toBe(source);
    expect(await run(fixed, options)).toMatchObject({ ok: true, returnValue: 7 });
  });

  it.each([
    'import { value } from "api"; return (0, eval)("value");',
    'import { value } from "api"; return eval?.("value");',
    'import { value } from "api"; return eval();',
    'import { value } from "api"; { const value = 3; eval("value"); }'
  ])("retains unused-import detection for %s", source => {
    expect(AS_UNUSED_IMPORT(source)).toEqual([
      expect.objectContaining({ code: "AS-UNUSED-IMPORT", message: "Import 'value' is never referenced." })
    ]);
    expect(fixASUnusedImports(source)).not.toBe(source);
  });
});
