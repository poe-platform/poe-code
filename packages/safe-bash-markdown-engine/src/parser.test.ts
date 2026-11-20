import assert from "node:assert/strict";
import test from "node:test";
import { parseCommonMarkBlocks } from "./commonmark-blocks.js";
import { parseCommonMarkInlines } from "./commonmark-inlines.js";
import type { AdapterContext } from "./types.js";

const context: AdapterContext = {
  checkpoint() {}, charge() {}, bound() {}, async cooperate() {},
  decodeEntity: String.fromCodePoint
};
test("shared parser keeps fenced headings inert and recognizes setext inside containers", async () => {
  const doc = await parseCommonMarkBlocks("```\n# inert\n```\n\n> Title\n> =====\n\n- ## Nested\n", context);
  assert.deepEqual(doc.blocks.map(b => b.kind), ["code", "quote", "list"]);
  assert.equal(doc.blocks[1]?.kind === "quote" && doc.blocks[1].blocks[0]?.kind, "heading");
  assert.equal(doc.blocks[2]?.kind === "list" && doc.blocks[2].items[0]?.blocks[0]?.kind, "heading");
});
test("shared inline parser decodes named references and emphasis structurally", async () => {
  const nodes = await parseCommonMarkInlines({ kind: "pendingInline", lines: [{ text: "**A &copy;**", start: { line: 1, column: 1 } }] }, [], context);
  assert.deepEqual(nodes, [{ t: "Strong", c: [{ t: "Str", c: "A" }, { t: "Space" }, { t: "Str", c: "©" }] }]);
});
test("empty smart quotes remain text without claiming following siblings", async () => {
  const nodes = await parseCommonMarkInlines({kind: "pendingInline", lines: [{text: "'' \"\" tail", start: {line: 1, column: 1}}]}, [], context, {smart: true});
  assert.deepEqual(nodes, [{t: "Str", c: "’’"}, {t: "Space"}, {t: "Str", c: "“”"}, {t: "Space"}, {t: "Str", c: "tail"}]);
});
test("smart quotes cannot consume unresolved emphasis or strikeout openers", async () => {
  for (const [marker, kind] of [["*", "Emph"], ["**", "Strong"], ["_", "Emph"], ["__", "Strong"], ["~~", "Strikeout"]] as const) {
    const parse = (text: string) => parseCommonMarkInlines({kind: "pendingInline", lines: [{text, start: {line: 1, column: 1}}]}, [], context, {smart: true, strikeout: true});
    assert.deepEqual(await parse(`"${marker}x"${marker}`), [{t: "Str", c: "“"}, {t: kind, c: [{t: "Str", c: "x”"}]}]);
    assert.deepEqual(await parse(`"${marker}x${marker}"`), [{t: "Quoted", c: ["DoubleQuote", [{t: kind, c: [{t: "Str", c: "x"}]}]]}]);
    assert.deepEqual(await parse(`"${marker}x"`), [{t: "Str", c: `“${marker}x”`}]);
  }
});
