import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import reference from "../../../docs/csvkit/csvformat-reference.json" with { type: "json" };

test("csvformat typed output normalizes duplicate headers using injected warning provenance", async () => {
  const capture = reference.cases.find(item => item.stderr.includes("DuplicateColumnWarning"))!;
  let stdout = "", stderr = "";
  const cleanups: (() => Promise<void>)[] = [];
  try {
    const status = await execute("csvformat", {
      argv: new OwnedArguments(capture.argv.map(value => new TextEncoder().encode(value)), defaultLimits),
      cwd: "/", env: {},
      fs: { async readFile() { assert.fail("unexpected named input"); }, async writeFile() { assert.fail("unexpected output file"); } },
      stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(capture.stdin); } },
      stdinIsDefault: false,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      codecs: [utf8Codec], compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber() { assert.fail("unexpected locale use"); } },
      clock: { now: () => 0 },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      columnWarnings: { utilsPath: capture.stderr.slice(0, capture.stderr.indexOf(":288:")) },
      signal: new AbortController().signal, limits: defaultLimits,
      registerCleanup: cleanup => { cleanups.push(cleanup); }
    });
    assert.deepEqual({ status, stdout, stderr }, { status: capture.status, stdout: capture.stdout, stderr: capture.stderr });
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
});
