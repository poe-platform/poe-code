import assert from "node:assert/strict";
import test from "node:test";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

const cases = [
  { name: "text", bytes: Buffer.from("hello world\n".repeat(100)), attr: 1 },
  { name: "newlines", bytes: Buffer.from("\n".repeat(100)), attr: 1 },
  { name: "nul", bytes: Buffer.from("abc\0".repeat(100)), attr: 0 },
  { name: "utf8", bytes: Buffer.from("café\n".repeat(100)), attr: 1 },
  { name: "empty", bytes: Buffer.alloc(0), attr: 0 },
  { name: "one-byte fallback", bytes: Buffer.from("a"), attr: 1 },
  { name: "rare binary", bytes: Buffer.concat([Buffer.alloc(1000, 65), Buffer.from([0])]), attr: 0 },
];
for (const level of ["-0", "-6"]) {
  for (const value of cases) {
    test(`zip ${level} native text attribute for ${value.name}`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/input", value.bytes);
      const result = await execute("zip", fs, ["-q", level, "out.zip", "input"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
      assert.equal(archive.entries[0]!.internalAttributes, level === "-0" ? 0 : value.attr);
    });
  }
}

test("zip text attributes cover all byte values and tolerated controls", async () => {
  const { makeZipEntry } = await import("../../src/commands/archive/zip-format.js");
  const limits = settings({});
  const signal = new AbortController().signal;
  for (let byte = 0; byte <= 255; byte++) {
    const blacklisted = byte <= 6 || byte >= 14 && byte <= 25 || byte >= 28 && byte <= 31;
    for (const printable of [false, true]) {
      const bytes = Buffer.from(printable ? [65, byte] : [byte]);
      const entry = await makeZipEntry("input", bytes, { modified: new Date(0), mode: 0o100644, directory: false, symlink: false }, limits, signal);
      const textual = printable || byte === 9 || byte === 10 || byte === 13 || byte >= 32;
      assert.equal(entry.internalAttributes, !blacklisted && textual ? 1 : 0, `byte=${byte}, printable=${printable}`);
    }
  }
});
