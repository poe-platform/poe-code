import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run } from "./helpers.js";

test("GNU stat precision and UTF-8 byte width: 45 bounded format comparisons", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/éfile"), "data");
  await host.writeFile(join(root, "work/empty"), "");
  await host.symlink("éfile", join(root, "work/link"));
  const fs = await createRealFileSystem({ root });
  const formats = ["[%.s][%.0s][%#.0a]", "[%.6s][%.6a][%.6f]", "[%08.6s][%-8.6s][%#08.6a]", "[%#12.6f][%012.6f]", "[%.n][%.0n][%.1n][%.2n][%.3n]", "[%8n][%-8n][%8.1n]", "[%.2A][%.2F]", "[%8.2N]", "[%+08.3Y][%-20.3Y]"];
  const failures: unknown[] = [];
  for (const name of ["éfile", "empty", "link", ".", "./éfile"]) for (const format of formats) {
    const native = oracle("stat", [`--printf=${format}`, name], join(root, "work"), 0o022, { QUOTING_STYLE: "literal" });
    const actual = await run("stat", [`--printf=${format}`, name], fs, {}, { env: { QUOTING_STYLE: "literal" } });
    if (native.exitCode !== actual.exitCode || !native.stdout.equals(actual.stdout)) failures.push({ name, format, native: native.stdout.toString("hex"), actual: actual.stdout.toString("hex"), error: actual.stderr });
  }
  assert.deepEqual(failures, []);
});

test("GNU invalid percent modifiers fail; virtual rendering buffers the current operand", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const fs = await createRealFileSystem({ root });
  for (const format of ["[%5%]", "[%.0%]"]) {
    const native = oracle("stat", [`--printf=${format}`, "file"], join(root, "work"));
    const actual = await run("stat", [`--printf=${format}`, "file"], fs);
    assert.equal(native.exitCode, 1);
    assert.equal(native.stdout.toString(), "[");
    assert.match(native.stderr, /invalid directive/u);
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stdout.length, 0);
    assert.match(actual.stderr, /invalid.*directive/u);
  }
});

test("stat precision allocation is bounded before writing bytes", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const fs = await createRealFileSystem({ root });
  for (const format of ["%.9999999999999999999999s", "%.100000n", "%100000.1n"]) {
    const result = await run("stat", [`--printf=${format}`, "file"], fs, { limits: { maxOutputBytes: 16 } });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit/u);
    assert.equal(result.stdout.length, 0);
  }
});
