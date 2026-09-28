import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { registerInternalYieldCheckpoint } from "safe-bash-contracts/yield";
import { createShufCommand } from "./index.js";

test("public shuf coalesces output and preserves every record", async () => {
  const input = Array.from({ length: 1000 }, (_, index) => `${index + 1}\n`).join("");
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createShufCommand().execute({
    command: "shuf", args: [], cwd: "/", env: { LC_ALL: "C" },
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { yield Buffer.from(input); })(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(chunks.length <= 8, `shuf made ${chunks.length} sink writes`);
  assert.deepEqual(Buffer.concat(chunks).toString().trimEnd().split("\n").sort(), input.trimEnd().split("\n").sort());
});

test("public shuf yields at repeated work quanta with a frozen clock", async t => {
  let turns = 0;
  const immediate = globalThis.setImmediate;
  t.mock.method(performance, "now", () => 0);
  t.mock.method(globalThis, "setImmediate", (callback: () => void) => { turns++; return immediate(callback); });
  const result = await createShufCommand().execute({
    command: "shuf", args: ["-i", "1-1000"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.ok(turns >= 2, `shuf scheduled ${turns} turns`);
});


test("public shuf preserves internal checkpoint cancellation without a scheduler turn", async t => {
  t.mock.method(performance, "now", () => 0);
  const controller = new AbortController();
  const reason = new Error("checkpoint cancelled shuf");
  registerInternalYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await assert.rejects(async () => createShufCommand().execute({
    command: "shuf", args: ["-i", "1-1000"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: controller.signal,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
  }), (error: unknown) => error === reason);
});
