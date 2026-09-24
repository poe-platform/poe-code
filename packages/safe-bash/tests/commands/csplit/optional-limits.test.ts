import assert from "node:assert/strict";
import test from "node:test";
import { settings, type CsplitLimits } from "../../../src/commands/csplit/internal.js";
import { Budget } from "../../../src/commands/csplit/internal.js";
import { parseOptions, suffixFormatter } from "../../../src/commands/csplit/options.js";
import { createCsplitCommand } from "../../../src/commands/csplit/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "poe-code/safe-fs";

test("csplit omitted quotas stay unlimited with an independent explicit limit", () => {
  const limits = settings({ limits: { maxFiles: 2 } });
  for (const [name, value] of Object.entries(limits)) assert.equal(value, name === "maxFiles" ? 2 : Infinity, name);
  for (const name of Object.keys(limits) as (keyof CsplitLimits)[]) {
    assert.equal(settings({ limits: { [name]: 100_000_000 } })[name], 100_000_000);
    assert.throws(() => settings({ limits: { [name]: 0 } }), RangeError);
  }
});

test("csplit admits suffixes above the former path quota and preserves explicit quota", () => {
  const context = {
    command: "csplit", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  for (const limits of [undefined, { maxFiles: 2 }, { maxPathBytes: 4096 }]) {
    const budget = new Budget(context, settings({ ...(limits ? { limits } : {}) }));
    const format = () => suffixFormatter(parseOptions(["-n", "4097", "-", "1"], budget), budget)(1);
    if (limits?.maxPathBytes) assert.throws(format, /suffix width limit exceeded/);
    else assert.equal(format(), "0".repeat(4096) + "1");
  }
});

test("csplit output file quota remains independent and enforced", async () => {
  const fs = createMemoryFileSystem();
  const errors: Uint8Array[] = [];
  const result = await createCsplitCommand({ limits: { maxFiles: 1 } }).execute({
    command: "csplit", args: ["-", "2"], cwd: "/", env: {}, fs,
    stdin: toByteSource("a\nb\n"), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(value) { errors.push(value.slice()); } },
  });
  assert.equal(result.exitCode, 1);
  assert.match(Buffer.concat(errors).toString(), /output file count limit exceeded/);
});
