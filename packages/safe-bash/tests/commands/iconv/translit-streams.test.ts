import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import type { ByteSource } from "../../../src/contracts/index.js";
import { iconvCommands } from "../../../src/commands/iconv/index.js";
import { run } from "./helpers.js";

for (const fixture of [
  { from: "UTF-8", input: Buffer.from("éß€😀"), expected: "3f73734555523f" },
  { from: "UTF-16LE", input: Buffer.from("A😀é", "utf16le"), expected: "413f3f" },
]) for (let cut = 0; cut <= fixture.input.length; cut++) test(`transliteration survives ${fixture.from} chunk boundary ${cut}`, async () => {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield fixture.input.subarray(0, cut); yield fixture.input.subarray(cut); } };
  assert.deepEqual(await run(["-f", fixture.from, "-t", "ASCII//TRANSLIT"], undefined, {}, { stdin }), { exitCode: 0, stdoutHex: fixture.expected, stderrHex: "" });
});

test("actual Shell redirection preserves native transliteration and input bytes", async () => {
  const fs = new MemoryFileSystem();
  const input = Buffer.from("éß€😀");
  await fs.writeFile("/input", input);
  const shell = new Shell({ fs, env: { LC_ALL: "POSIX" } }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv -f UTF-8 -t ASCII//TRANSLIT < input > output");
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/output")).toString("hex"), "3f73734555523f");
    assert.equal(Buffer.from(await fs.readFile("/input")).toString("hex"), input.toString("hex"));
  } finally { await shell.dispose(); }
});

test("actual Shell pipeline uses independent conversion state", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv -f latin1 -t UTF-8 | iconv -f UTF-8 -t ASCII//TRANSLIT", { stdin: Uint8Array.of(0xe9, 0xdf) });
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "?ss"); assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("default replacement cannot inherit a numeric prototype property", async () => {
  const property = "128512";
  const before = Object.getOwnPropertyDescriptor(Object.prototype, property);
  Object.defineProperty(Object.prototype, property, { configurable: true, value: "inherited" });
  try {
    assert.equal((await run(["-f", "UTF-8", "-t", "ASCII//TRANSLIT"], Buffer.from("😀"))).stdoutHex, "3f");
  } finally {
    if (before) Object.defineProperty(Object.prototype, property, before);
    else Reflect.deleteProperty(Object.prototype, property);
  }
});
