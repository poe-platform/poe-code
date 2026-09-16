import assert from "node:assert/strict";
import test from "node:test";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

for (const args of [["-h"], ["--help"], ["--hel"], ["-qh"], ["-h", "--unknown"], ["missing.zip", "missing", "-h"], ["-h", "-"]]) {
  test(`zip help exits at the option without filesystem access ${args}`, async () => {
    const fs = await fixture();
    const denied = new Proxy(fs, { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? () => { throw new Error(`unexpected filesystem operation ${String(key)}`); } : value;
    } });
    const result = await execute("zip", denied, args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.toString().includes("zip [options] archive"), result.stdout.toString());
    assert.ok(result.stdout.toString().includes("bzip2"));
    assert.equal(result.stderr, "");
  });
}

for (const args of [["-h-"], ["--help-"], ["--help=value"], ["--unknown", "-h"], ["--", "-h"]]) {
  test(`zip help retains preceding argument errors ${args}`, async () => {
    const result = await execute("zip", await fixture(), args);
    assert.equal(result.exitCode, 16);
    assert.ok(!result.stdout.toString().includes("zip [options] archive"));
  });
}

test("zip help from ZIPOPT precedes explicit invalid arguments", async () => {
  const result = await execute("zip", await fixture(), ["--unknown"], {}, { env: { ZIPOPT: "-h" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.toString().includes("zip [options] archive"));
});

test("zip treats help-looking arguments after literal terminator as filenames", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/-h", new TextEncoder().encode("literal help file"));
  const result = await execute("zip", fs, ["-q", "out.zip", "--", "-h"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 0);
  const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.name, "-h");
});
