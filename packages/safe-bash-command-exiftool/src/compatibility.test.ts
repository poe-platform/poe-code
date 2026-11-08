import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createExiftoolCommand } from "./command.js";
import { editPng, inspectPng } from "./png.js";

// Independently constructed using Python struct/zlib CRC32, then read by pinned
// ExifTool 13.59 with -config ''. Never use the product chunk writer as an oracle.
const header = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489";
const image = "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082";
const controls = [
  { name: "duplicate", chunks: "0000000b744558745469746c65006669727374a86fa71a0000000c744558745469746c65007365636f6e64be48320d", json: '"second"', text: "second\n", binary: "second" },
  { name: "unicode", chunks: "00000017695458745469746c650000000000636166c3a920e6b0b4f09f9880b78806f1", json: '"café 水😀"', text: "café 水😀\n", binary: "café 水😀" },
  { name: "control", chunks: "0000000b744558745469746c6500610062017fca9ca20f", json: '"ab\\u0001\\u007F"', text: "ab..\n", binary: "a\0b\x01\x7f" },
  { name: "empty", chunks: "00000006744558745469746c6500a8eed227", json: '""', text: "\n", binary: "" },
  { name: "unknown", chunks: "000000147445587456656e646f7250726976617465006f70617175651c0baeec", json: undefined, text: "", binary: "" },
] as const;
const signal = new AbortController().signal;

test("independent native scalar assignment updates both existing PNG text instances", () => {
  const input = Buffer.from(header + controls[0].chunks + image, "hex");
  const output = editPng(input, [{ name: "Title", operation: "set", value: "new" }], { signal });
  // Native output: two CRC-correct Title=NUL+new tEXt chunks, 110 bytes.
  const title = "00000009744558745469746c65006e6577a25d7c6a";
  assert.deepEqual(output, new Uint8Array(Buffer.from(header + title + title + image, "hex")));
});

for (const cell of controls) {
  for (const format of ["-j", "-s3", "-b"] as const) {
    test(`independent 13.59 ${cell.name} ${format}: exact bytes/status/effects`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from(header + cell.chunks + image, "hex");
      await fs.writeFile(`/${cell.name}.png`, input);
      const argv = createCommandArguments(["-config", "", format, "-Title", `${cell.name}.png`]);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const cleanups: (() => void | Promise<void>)[] = [];
      const result = await createExiftoolCommand().execute({
        command: "exiftool", args: argv.args, argumentValues: argv, fs, cwd: "/", env: {}, signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
        stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
        registerCleanup(cleanup) { cleanups.push(cleanup); },
      });
      for (const cleanup of cleanups) await cleanup();
      const json = `[{\n  "SourceFile": "${cell.name}.png"${cell.json === undefined ? "" : `,\n  "Title": ${cell.json}`}\n}]\n`;
      assert.equal(result.exitCode, 0);
      assert.deepEqual(Buffer.concat(stderr), Buffer.alloc(0));
      assert.deepEqual(Buffer.concat(stdout), Buffer.from(format === "-j" ? json : format === "-b" ? cell.binary : cell.text));
      assert.deepEqual(await fs.readFile(`/${cell.name}.png`), new Uint8Array(input));
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [`${cell.name}.png`]);
    });
  }
}

test("independent PNG payload and unknown metadata survive repeated edits", () => {
  const unknown = controls[4].chunks;
  let bytes: Uint8Array = Buffer.from(header + unknown + controls[0].chunks + image, "hex");
  for (const value of ["new", "水😀", "", "again"]) {
    bytes = editPng(bytes, [{ name: "Title", operation: "set", value }], { signal });
    assert.deepEqual(bytes.subarray(0, 33), new Uint8Array(Buffer.from(header, "hex")));
    assert.deepEqual(bytes.subarray(33, 33 + unknown.length / 2), new Uint8Array(Buffer.from(unknown, "hex")));
    assert.deepEqual(bytes.subarray(bytes.length - image.length / 2), new Uint8Array(Buffer.from(image, "hex")));
    assert.deepEqual(inspectPng(bytes, { signal }).tags.filter(tag => tag.name === "Title").map(tag => tag.value), value ? (value === "again" ? [value] : [value, value]) : []);
  }
});

test("independent corrupt extent and CRC negative controls refuse without mutation", () => {
  for (const offset of [33, 55]) {
    const bytes = Buffer.from(header + controls[0].chunks + image, "hex");
    bytes[offset] = bytes[offset]! ^ 0xff;
    const original = new Uint8Array(bytes);
    assert.throws(() => editPng(bytes, [{ name: "Title", operation: "set", value: "new" }], { signal }), /truncated|CRC/);
    assert.deepEqual(new Uint8Array(bytes), original);
  }
});
