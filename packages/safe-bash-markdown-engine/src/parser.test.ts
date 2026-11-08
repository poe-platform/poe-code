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
