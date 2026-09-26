import { test } from "vitest";
import assert from "node:assert/strict";
import type { OwnedArguments } from "./argv.js";
import type { CsvkitContext } from "./contracts.js";
import { utf8Codec } from "./codecs/utf8.js";
import { defaultLimits, execute } from "./engine.js";

const limits = { ...defaultLimits, maxArguments: 2, maxArgumentBytes: 2 };

for (const [length, byteLength, diagnostic] of [
  [limits.maxArguments + 1, 0, "argv count limit exceeded"],
  [1, limits.maxArgumentBytes + 1, "argv byte limit exceeded"]
] as const) test(`custom argv metadata ${diagnostic} is denied before payload access`, async () => {
  const argv = {
    length, byteLength,
    bytes() { assert.fail("denied argument bytes must never be copied or accessed"); }
  } as unknown as OwnedArguments;
  let stdout = "", stderr = "";
  const context: CsvkitContext = {
    argv, cwd: "/", limits, signal: new AbortController().signal,
    fs: {
      async readFile() { assert.fail("denied argv must not acquire input"); },
      async writeFile() { assert.fail("denied argv must not produce file effects"); }
    },
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("denied argv must not acquire stdin"); yield new Uint8Array(); } },
    stdinIsDefault: false,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber() { assert.fail("denied argv must not use locale"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    registerCleanup() {}
  };
  assert.deepEqual({ status: await execute("csvcut", context), stdout, stderr }, {
    status: 78, stdout: "", stderr: `csvkit: unsupported or unqualified: ${diagnostic}\n`
  });
});
