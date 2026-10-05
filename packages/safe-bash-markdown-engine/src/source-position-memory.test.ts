import assert from "node:assert/strict";
import test from "node:test";
import { parseCommonMarkBlocks } from "./commonmark-blocks.js";
import type { AdapterContext } from "./types.js";

const context: AdapterContext = {
  checkpoint() {}, charge() {}, bound() {}, async cooperate() {},
  decodeEntity: String.fromCodePoint,
};

for (const [name, source, literal] of [
  ["long ordinary line", "a".repeat(8192), "a".repeat(8192)],
  ["tab-expanded code", "\t".repeat(2048) + "x", "\t".repeat(2047) + "x\n"],
  ["partially stripped tab", "  ```\n\t" + "a".repeat(8192) + "\n```", "  " + "a".repeat(8192) + "\n"],
]) {
  test(`${name} preserves bytes without growing per-character vectors`, async () => {
    const push = Array.prototype.push;
    Array.prototype.push = function<T>(this: T[], ...values: T[]): number {
      if (this.length + values.length > 4096 && values.some(value => typeof value === "number" || typeof value === "string" && value.length <= 4)) {
        throw new Error("Unbounded per-character vector");
      }
      return push.apply(this, values);
    };
    let result;
    try { result = await parseCommonMarkBlocks(source!, context, "input.md"); }
    finally { Array.prototype.push = push; }
    const block = result.blocks[0];
    assert.equal(result.blocks.length, 1);
    assert.equal(block?.kind === "code" ? block.literal : block?.kind === "paragraph" ? block.inline.lines[0]?.text : undefined, literal);
  });
}
