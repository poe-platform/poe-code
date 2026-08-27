import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlToMarkdownCommand, type HtmlToMarkdownLimits } from "../../../src/commands/html-to-markdown/index.js";
import { convert } from "./helpers.js";

const cases: readonly [keyof HtmlToMarkdownLimits, number, string][] = [
  ["maxInputBytes", 3, "abcd"], ["maxOutputBytes", 3, "abcd"], ["maxTokenBytes", 5, "<strong>x</strong>"],
  ["maxTokens", 2, "<b>x</b>"], ["maxNodes", 1, "<b>x</b>"], ["maxDepth", 1, "<b><i>x</i></b>"],
  ["maxAttributes", 1, '<a href="/x" title="y">x</a>'],
  ["maxTableCells", 1, "<table><tr><td>x</td><td>y</td></tr></table>"],
  ["maxTableCellBytes", 3, "<table><tr><td>abcdef</td></tr></table>"], ["maxWorkUnits", 8, "abcdefghijklmnop"],
];
for (const [limit, maximum, input] of cases) test(`enforced ${limit}`, async () => {
  const result = await convert(input, { limits: { [limit]: maximum } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /limit exceeded/u);
});
for (const maximum of [0, -1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER]) test(`invalid configured limit ${maximum}`, () => {
  assert.throws(() => createHtmlToMarkdownCommand({ limits: { maxInputBytes: maximum } }), RangeError);
});
test("exact input/output boundary", async () => {
  assert.equal((await convert("abc", { limits: { maxInputBytes: 3, maxOutputBytes: 4 } })).stdout, "abc\n");
  assert.equal((await convert("é", { limits: { maxInputBytes: 2, maxOutputBytes: 2 } })).exitCode, 1);
});
test("diagnostics are byte bounded", async () => {
  const result = await convert("", { limits: { maxDiagnosticBytes: 17 } }, { args: ["--" + "😀".repeat(100)] });
  assert.equal(result.exitCode, 2); assert.ok(Buffer.byteLength(result.stderr) <= 17); assert.ok(!result.stderr.includes("�"));
});
test("file and argument limits reject before opening input", async () => {
  let acquired = 0;
  const source = { [Symbol.asyncIterator]() { acquired++; throw new Error("must not acquire"); } };
  const files = await convert(source, { limits: { maxFiles: 1 } }, { args: ["-", "-"] });
  const args = await convert(source, { limits: { maxArgumentBytes: 3 } }, { args: ["toolong"] });
  assert.equal(files.exitCode, 2); assert.equal(args.exitCode, 2); assert.equal(acquired, 0);
});
