import assert from "node:assert/strict";
import { setImmediate as pause } from "node:timers/promises";
import test from "node:test";
import { createHtmlToMarkdownCommand, htmlToMarkdownCommands } from "../../../src/commands/html-to-markdown/index.js";
import { CommandRegistry, toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { byteChunks, convert } from "./helpers.js";

for (const name of ["script", "style"]) test(`${name} cannot inject through raw malformed neighbors`, async () => {
  for (const tail of ["<", "</s", `</${name}x>`, "<!--", "'\"><img src=x>", "<&amp;"]) {
    const html = `keep<${name}>${tail}</${name}>after`;
    assert.equal((await convert(byteChunks(html))).stdout, "keepafter\n");
  }
});
test("numeric and named URI obfuscation stays inactive", async () => {
  const values = ["&#106;avascript:alert(1)", "&#x6a;avascript:alert(1)", "&Tab;javascript:alert(1)", "java&NewLine;script:alert(1)", "java script:alert(1)", "data&colon;text/html,foo", "mailto:a%0d%0aBcc:other@test", "&#0;javascript:x", "javascript&amp;colon;x"];
  for (const value of values) {
    const result = await convert(`<a href='${value}'>label</a>`);
    assert.equal(result.stdout, "label\n", value); assert.equal(result.exitCode, 0);
  }
});
test("empty input chunks are bounded work and yield cancellation", async () => {
  let returned = 0, reads = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const result = await convert(source, { limits: { maxWorkUnits: 20 } });
  assert.equal(result.exitCode, 1); assert.equal(reads, 21); assert.equal(returned, 1);
});
test("large parser token and deep nesting refuse without output", async () => {
  for (const html of ['<a title="' + "x".repeat(100) + '">x</a>', "<!--" + "x".repeat(100) + "-->", "<div>".repeat(10) + "x"]) {
    const result = await convert(html, { limits: { maxTokenBytes: 64, maxDepth: 4 } });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  }
});
test("table expansion and code fences obey the output cap", async () => {
  for (const html of ["<table><tr><td>x</td><td>y</td></tr></table>", "<pre>" + "`".repeat(30) + "</pre>"]) {
    const result = await convert(html, { limits: { maxOutputBytes: 20 } });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  }
});
test("timer cancellation while rendering consumes no host resources", async () => {
  const controller = new AbortController(), reason = new Error("abort");
  let acquired = false;
  const input: ByteSource = { async *[Symbol.asyncIterator]() { acquired = true; yield Buffer.from("<b>x</b>".repeat(3000)); } };
  const task = convert(input, {}, { signal: controller.signal });
  await pause(); controller.abort(reason); await assert.rejects(task, error => error === reason); assert.equal(acquired, true);
});
test("plugin collision preflight and intentional replace", async () => {
  const commands = new CommandRegistry([{ name: "html-to-markdown", execute: () => ({ exitCode: 7 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => htmlToMarkdownCommands().setup(host), /already registered/u);
  assert.equal((await commands.get("html-to-markdown")!.execute({} as never)).exitCode, 7);
  await htmlToMarkdownCommands({ replace: true }).setup(host);
  assert.match(commands.get("html-to-markdown")!.description!, /Convert bounded/u);
});
test("limit settings copied at construction", async () => {
  const limits = { maxInputBytes: 2 };
  const command = createHtmlToMarkdownCommand({ limits }); limits.maxInputBytes = 100;
  const original = await convert("abc");
  assert.equal((await command.execute({ ...original.context, stdin: toByteSource("abc") })).exitCode, 1);
});
