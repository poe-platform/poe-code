import assert from "node:assert/strict";
import { test } from "vitest";
import { defaultLimits, type InvocationContext } from "./engine.js";
import { csvcut } from "./commands/csvcut.js";
import { Runtime } from "./runtime.js";
import { CsvkitOutputBudgetError } from "./errors.js";

function fixture(maxOutputBytes: number) {
  const writes: Uint8Array[] = [];
  let closes = 0;
  const context: InvocationContext = {
    cwd: "/work", fs: {
      readFile: async () => { throw new Error("unexpected read"); },
      writeFile: async () => { throw new Error("unexpected bulk write"); },
      openWriteFile: async () => ({
        write: async bytes => { writes.push(Uint8Array.from(bytes)); },
        close: async () => { closes++; }
      })
    },
    stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { write: async () => { throw new Error("unexpected stdout"); } },
    stderr: { write: async () => { throw new Error("unexpected stderr"); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: String }, clock: { now: () => 0 },
    limits: { ...defaultLimits, maxOutputBytes }, signal: new AbortController().signal,
    registerCleanup: () => {}
  };
  return { runtime: new Runtime(context, csvcut, {}), writes, closes: () => closes };
}

for (const chunks of [
  ["\ud83d", "", "\udca0"],
  ["prefix\ud83d", "", "\udca0suffix"],
  ["\ud83d", "\ud83d", "\udca0"],
  ["\ud83d", "", "x", "\udca0"],
  ["\ud83d", ""],
  ["", ""]
]) test(`streamed side-file effects match joined UTF-8 for ${JSON.stringify(chunks)}`, async () => {
  const expected = new TextEncoder().encode(chunks.join(""));
  const f = fixture(expected.length);
  try {
    await f.runtime.writeSideFile("out.csv", chunks);
    assert.deepEqual(f.writes.flatMap(bytes => [...bytes]), [...expected]);
    await assert.rejects(f.runtime.write("x"), CsvkitOutputBudgetError);
    assert.equal(f.closes(), 1);
  } finally { await f.runtime.close(); }
  assert.equal(f.closes(), 1);
});

test("streamed side-file pair denial happens before publishing either surrogate", async () => {
  const f = fixture(3);
  try {
    await assert.rejects(f.runtime.writeSideFile("out.csv", ["\ud83d", "", "\udca0"]), CsvkitOutputBudgetError);
    assert.deepEqual(f.writes, []);
    assert.equal(f.closes(), 1);
  } finally { await f.runtime.close(); }
});
