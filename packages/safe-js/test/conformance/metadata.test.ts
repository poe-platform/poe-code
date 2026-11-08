import { expect, it } from "vitest";
import { prepareTest262 } from "./metadata.js";

it("runs ordinary source in both modes without rewriting the non-strict input", () => {
  const source = "/* copyright */\nvar value=1;";
  expect(prepareTest262("language/example.js", source)).toMatchObject({
    kind: "test", variants: [
      { mode: "sloppy", source, harness: ["assert.js", "sta.js"] },
      { mode: "strict", source: '"use strict";\n' + source, harness: ["assert.js", "sta.js"] }
    ]
  });
});

it.each([
  ["onlyStrict", "strict"], ["noStrict", "sloppy"], ["module", "module"], ["raw", "raw"]
])("honors the %s execution mode", (flag, mode) => {
  const source = `/*---\nflags: [${flag}]\n---*/\n0;`;
  const prepared = prepareTest262("example.js", source);
  if (prepared.kind !== "test") throw new Error("Missing test");
  expect(prepared.variants).toEqual([{
    mode, source: mode === "strict" ? '"use strict";\n' + source : source,
    harness: mode === "raw" ? [] : ["assert.js", "sta.js"]
  }]);
});

it("preserves async harness order and parses YAML metadata", () => {
  const source = `/*---
flags: [async, onlyStrict]
includes:
  - propertyHelper.js
  - compareArray.js
features: [Promise]
locale: [en-US]
negative:
  phase: runtime
  type: TypeError
---*/
throw new TypeError();`;
  expect(prepareTest262("example.js", source)).toMatchObject({
    kind: "test", flags: ["async", "onlyStrict"], features: ["Promise"], locales: ["en-US"],
    negative: { phase: "runtime", type: "TypeError" },
    variants: [{ harness: ["assert.js", "sta.js", "doneprintHandle.js", "propertyHelper.js", "compareArray.js"] }]
  });
});

it("does not inject includes or async harness into raw source", () => {
  const source = "/*---\nflags: [raw, async]\nincludes: [propertyHelper.js]\n---*/\n'use strict'\n[0]";
  expect(prepareTest262("example.js", source)).toMatchObject({
    kind: "test", variants: [{ mode: "raw", source, harness: [] }]
  });
});

it("classifies module fixtures separately, not as passing tests", () => {
  expect(prepareTest262("language/module/dep_FIXTURE.js", "export {}"))
    .toEqual({ kind: "fixture" });
});

it.each([
  "flags: async", "flags: [futureUnknownFlag]", "includes: [1]",
  "negative: {phase: compilation, type: SyntaxError}",
  "negative: {phase: parse}", "flags: [onlyStrict, noStrict]", "flags: ["
])("rejects malformed or uninterpretable metadata: %s", metadata => {
  expect(() => prepareTest262("example.js", `/*---\n${metadata}\n---*/\n0`)).toThrow();
});

it("rejects an unterminated metadata block", () => {
  expect(() => prepareTest262("example.js", "/*---\nflags: [raw]")).toThrow();
});

it.each(["\r", "\r\n", "\n"])("parses metadata line endings without normalizing test source: %j", ending => {
  const source = ["/*---", "flags: [noStrict]", "includes: [compareArray.js]", "---*/", "function f(){return 1}"].join(ending);
  expect(prepareTest262("line-endings.js", source)).toMatchObject({
    kind: "test", variants: [{ mode: "sloppy", source, harness: ["assert.js", "sta.js", "compareArray.js"] }]
  });
});
