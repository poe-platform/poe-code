import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

describe("String.match no-match parity", () => {
  it("runs the complete unchanged STR-02 audit reduction", async () => {
    const source = String.raw`const match = 'plain'.match(/\d+/g);
return { isNull: match === null, value: match };
`;
    const native = new Function(source)();

    expect(native).toEqual({ isNull: true, value: null });
    expect(await run(source, { modules: {} })).toMatchObject({
      ok: true,
      returnValue: native
    });
  });

  it.each([
    { input: "plain", pattern: "\\d+", flags: "g" },
    { input: "plain", pattern: "\\d+", flags: "gi" },
    { input: "plain\ntext", pattern: "^\\d+$", flags: "gm" },
    { input: "plain\ntext", pattern: "x.y", flags: "gs" },
    { input: "plain\ntext", pattern: "^x.y$", flags: "gims" },
    { input: "", pattern: "\\d+", flags: "g" },
    { input: "plain", pattern: "\\d+", flags: "" },
    { input: "plain\ntext", pattern: "^x.y$", flags: "ims" },
    { input: "", pattern: "\\d+", flags: "" },
    { input: "a12b3", pattern: "(\\d+)", flags: "g" },
    { input: "aA", pattern: "a", flags: "gi" },
    { input: "a\nb", pattern: "^b", flags: "gm" },
    { input: "a\nb", pattern: "a.b", flags: "gs" },
    { input: "A\nb", pattern: "^a.b$", flags: "gims" },
    { input: "", pattern: "(?:)", flags: "g" },
    { input: "ab", pattern: "(?:)", flags: "g" }
  ])("matches native for $input /$pattern/$flags", async ({ input, pattern, flags }) => {
    const native = input.match(new RegExp(pattern, flags));

    expect(
      callStringMethod(input, "match", [createSandboxRegex(pattern, flags)], new Budget())
    ).toEqual(native);
    expect(
      await run(
        `return ${JSON.stringify(input)}.match(new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)}));`,
        { modules: {} }
      )
    ).toMatchObject({ ok: true, returnValue: native });
  });

  it.each(["plain", "a12b3", ""])("preserves native branch behavior for %j", async (input) => {
    const source = `const match = ${JSON.stringify(input)}.match(/\\d+/g);
let branch = "unmatched";
if (match) branch = "matched";
return { branch, isNull: match === null, fallback: match || "fallback" };`;

    expect(await run(source, { modules: {} })).toMatchObject({
      ok: true,
      returnValue: new Function(source)()
    });
  });

  it("preserves non-global captures", async () => {
    const source = 'return [..."a12b3".match(/(\\d+)/)];';

    expect(await run(source, { modules: {} })).toMatchObject({
      ok: true,
      returnValue: new Function(source)()
    });
  });

  it("preserves neighboring no-match results", async () => {
    const source = String.raw`return {
  all: [...'plain'.matchAll(/\d+/g)],
  search: 'plain'.search(/\d+/g),
  replaced: 'plain'.replace(/\d+/g, 'X'),
  replacedAll: 'plain'.replaceAll(/\d+/g, 'X'),
  split: 'plain'.split(/\d+/g)
};`;

    expect(await run(source, { modules: {} })).toMatchObject({
      ok: true,
      returnValue: new Function(source)()
    });
  });
});
