import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { parsePatch } from "./patch-formats.js";
import { equalPatchText } from "./patch-text.js";
import { StoredPatchInput } from "./stored-input.js";
import { filesystem, run } from "./helpers.test.js";

for (const format of ["unified", "normal", "context"]) for (const transport of ["lf", "crlf", "incomplete"]) {
  test(`${format} ${transport} body lines replay without full-line decoding`, async t => {
    const fs = await filesystem(), encode = (text: string) => new TextEncoder().encode(text);
    const block = new Uint8Array(16384).fill(97);
    await fs.writeStream("/work/target", { async *[Symbol.asyncIterator]() {
      for (let index = 0; index < 8; index++) yield block;
      if (transport !== "incomplete") yield encode("\n");
    } });
    const read = StoredPatchInput.prototype.read;
    t.mock.method(StoredPatchInput.prototype, "read", async function(this: StoredPatchInput, index: number, prefix?: number) {
      if (index >= 0 && index < this.length) {
        const line = await this.document.line(this.start + index);
        if (line.end - line.start > 16384) assert.ok(prefix !== undefined && prefix <= 128, "decoded a full patch body line");
      }
      return Reflect.apply(read, this, [index, prefix]);
    });
    const result = await run("patch", ["--quiet", "target"], { fs, input: { async *[Symbol.asyncIterator]() {
      const line = (text: string) => encode(transport === "crlf" ? text.replaceAll("\n", "\r\n") : text);
      yield line(format === "normal" ? "1c1\n< " : format === "context"
        ? "*** target\n--- target\n***************\n*** 1 ****\n! " : "--- target\n+++ target\n@@ -1 +1 @@\n-");
      for (let index = 0; index < 8; index++) yield block;
      yield line("\n" + (transport === "incomplete" ? "\\ No newline at end of file\n" : ""));
      yield line(format === "normal" ? "---\n> " : format === "context" ? "--- 1 ----\n! " : "+");
      block.fill(98);
      for (let index = 0; index < 8; index++) yield block;
      yield line("\n" + (transport === "incomplete" ? "\\ No newline at end of file\n" : ""));
      block.fill(0);
    } } });
    assert.equal(result.exitCode, 0, result.stderr);
    let size = 0;
    for await (const bytes of fs.readStream("/work/target")) for (const byte of bytes) assert.equal(byte, size++ < 8 * 16384 ? 98 : 10);
    assert.equal(size, 8 * 16384 + (transport === "incomplete" ? 0 : 1));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
  });
}

for (const mode of ["change", "omitted", "mismatch"]) test(`long Unicode context common lines: ${mode}`, async t => {
  const fs = await filesystem(), encode = (text: string) => new TextEncoder().encode(text);
  const common = encode("😀".repeat(4096));
  await fs.writeStream("/work/target", { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 4; index++) yield common;
    yield encode("\nold\n");
  } });
  const read = StoredPatchInput.prototype.read;
  t.mock.method(StoredPatchInput.prototype, "read", async function(this: StoredPatchInput, index: number, prefix?: number) {
    if (index >= 0 && index < this.length && (await this.document.line(this.start + index)).end - (await this.document.line(this.start + index)).start > 16384)
      assert.ok(prefix !== undefined && prefix <= 128, "decoded common context line");
    return Reflect.apply(read, this, [index, prefix]);
  });
  const result = await run("patch", ["--quiet"], { fs, input: { async *[Symbol.asyncIterator]() {
    yield encode("*** target\n--- target\n***************\n*** 1,2 ****\n  ");
    for (let index = 0; index < 4; index++) yield common;
    if (mode === "omitted") { yield encode("\n- old\n--- 1 ----\n"); return; }
    yield encode("\n! old\n--- 1,2 ----\n  ");
    for (let index = 0; index < 4; index++) yield common;
    if (mode === "mismatch") yield encode("x");
    yield encode("\n! new\n");
  } } });
  if (mode === "mismatch") assert.notEqual(result.exitCode, 0); else assert.equal(result.exitCode, 0, result.stderr);
  const ending = encode(mode === "omitted" ? "\n" : mode === "mismatch" ? "\nold\n" : "\nnew\n");
  let size = 0;
  for await (const bytes of fs.readStream("/work/target")) for (const byte of bytes) {
    assert.equal(byte, size < common.length * 4 ? common[size % common.length] : ending[size - common.length * 4]); size++;
  }
  assert.equal(size, common.length * 4 + ending.length);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

test("buffered context parser reconstructs an omitted old side", async () => {
  const fs = await filesystem();
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const parsed = await parsePatch("*** target\n--- target\n***************\n*** 1 ****\n--- 1,2 ----\n  keep\n+ new\n",
    new Budget(context, {}), undefined, undefined);
  assert.deepEqual(parsed[0]!.hunks[0]!.lines, [{ kind: " ", text: "keep\n" }, { kind: "+", text: "new\n" }]);
});

for (const failure of ["source", "cancel"]) test(`context span comparison closes both producers after ${failure}`, async () => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("comparison stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  let closed = 0, yielded = 0;
  const source = (right: boolean) => ({ size: 8192 * 64, terminated: false, bytes: { async *[Symbol.asyncIterator]() {
    const block = new Uint8Array(8192).fill(97);
    try {
      for (let index = 0; index < 64; index++) {
        if (right && index === 3) {
          if (failure === "source") throw reason;
          controller.abort(reason);
        }
        yielded++; yield block;
      }
    } finally { closed++; }
  } } });
  await assert.rejects(equalPatchText(source(false), source(true), new Budget(context, {})), error => error === reason);
  assert.equal(closed, 2); assert.ok(yielded < 128);
});

test("long discarded mail headers and signatures use bounded prefix scans", async t => {
  const fs = await filesystem({ target: "old\n" }), encode = (text: string) => new TextEncoder().encode(text);
  const read = StoredPatchInput.prototype.read;
  t.mock.method(StoredPatchInput.prototype, "read", async function(this: StoredPatchInput, index: number, prefix?: number) {
    if (index >= 0 && index < this.length) {
      const line = await this.document.line(this.start + index);
      if (line.end - line.start > 16384) assert.ok(prefix !== undefined && prefix <= 128, "decoded discarded mail text");
    }
    return Reflect.apply(read, this, [index, prefix]);
  });
  const result = await run("patch", ["--quiet"], { fs, input: { async *[Symbol.asyncIterator]() {
    const prose = new Uint8Array(16384).fill(120);
    yield encode("From: ");
    for (let index = 0; index < 4; index++) yield prose;
    yield encode("\n\n--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n-- \n");
    for (let index = 0; index < 4; index++) yield prose;
    yield encode("\n");
  } } });
  assert.equal(result.exitCode, 0, result.stderr);
});
