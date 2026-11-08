import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, snapshot } from "./helpers.js";

test("stat precision and UTF-8 byte width: 45 bounded formats", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/éfile", Buffer.from("data"));
  await fs.writeFile("/work/empty", new Uint8Array());
  await fs.symlink("éfile", "/work/link");
  const before = await snapshot(fs);
  const formats = ["[%.s][%.0s][%#.0a]", "[%.6s][%.6a][%.6f]", "[%08.6s][%-8.6s][%#08.6a]", "[%#12.6f][%012.6f]", "[%.n][%.0n][%.1n][%.2n][%.3n]", "[%8n][%-8n][%8.1n]", "[%.2A][%.2F]", "[%8.2N]", "[%+08.3Y][%-20.3Y]"];
  for (const name of ["éfile", "empty", "link", ".", "./éfile"]) for (const format of formats) {
    const actual = await run("stat", [`--printf=${format}`, name], fs, {}, { env: { QUOTING_STYLE: "literal" } });
    assert.equal(actual.exitCode, 0, `${name} ${format}: ${actual.stderr}`);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout.at(0), 91);
    assert.equal(actual.stdout.at(-1), 93);
  }
  const bytes = await run("stat", ["--printf=[%.1n][%.2n][%.3n]", "éfile"], fs);
  assert.deepEqual(bytes.stdout, Buffer.from([91, 0xc3, 93, 91, 0xc3, 0xa9, 93, 91, 0xc3, 0xa9, 102, 93]));
  assert.deepEqual(await snapshot(fs), before);
});

test("invalid percent modifiers fail; virtual rendering buffers the current operand", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Buffer.from("data"));
  for (const format of ["[%5%]", "[%.0%]"]) {
    const actual = await run("stat", [`--printf=${format}`, "file"], fs);
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stdout.length, 0);
    assert.match(actual.stderr, /invalid.*directive/u);
  }
});

test("stat precision allocation is bounded before writing bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Buffer.from("data"));
  for (const format of ["%.9999999999999999999999s", "%.100000n", "%100000.1n"]) {
    const result = await run("stat", [`--printf=${format}`, "file"], fs, { limits: { maxOutputBytes: 16 } });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit/u);
    assert.equal(result.stdout.length, 0);
  }
});
