import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, type ByteSource } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

for (const count of [8159, 8160, 8161, 16383, 16384, 16385, 32768]) {
  for (const [name, inputHex, to, stdoutHex, exitCode] of [
    ["utf16-output-invalid", "41".repeat(count) + "ff", "UTF-16", "fffe" + "4100".repeat(count), 0],
    ["suppressed-target-tail", "41" + "c3a9".repeat(count), "ASCII", "41", count >= 8160 ? 1 : 0],
    ["suppressed-source-tail", "41" + "ff".repeat(count), "UTF-8", "41", 0],
    ["suppressed-target-head", "c3a9".repeat(count) + "41", "ASCII", "41", 0],
    ["three-byte-output-tail", "e282ac".repeat(count) + "ff", "UTF-8", "e282ac".repeat(count), 0],
    ["four-byte-output-tail", "f09f9880".repeat(count) + "ff", "UTF-16LE", "3dd800de".repeat(count), 0],
  ] as const) test(`pinned gconv boundaries: ${name}:${count}`, async () => {
    assert.deepEqual(await run(["-c", "-f", "UTF-8", "-t", to], Buffer.from(inputHex, "hex")), { exitCode, stdoutHex, stderrHex: "" });
  });
}

test("owned argument carrier works without re-materializing context getters", async () => {
  const argumentValues = createCommandArguments(["-f", "UTF-8", "-t", "UTF-8"]);
  let cwdReads = 0;
  const overrides = { args: argumentValues.args, argumentValues, get cwd() { cwdReads++; return "/"; } };
  assert.deepEqual(await run([], Uint8Array.of(65), {}, overrides), { exitCode: 0, stdoutHex: "41", stderrHex: "" });
  assert.equal(cwdReads, 0);
});

test("caller abort in cwd getter never selects fs afterward", async () => {
  const controller = new AbortController();
  let fsReads = 0;
  const overrides = { signal: controller.signal, get cwd() { controller.abort(false); return "/"; }, get fs(): never { fsReads++; throw new Error("forbidden fs getter"); } };
  await assert.rejects(run(["-f", "UTF-8", "-t", "UTF-8", "input"], undefined, {}, overrides), reason => reason === false);
  assert.equal(fsReads, 0);
});

test("unpaired Unicode arguments reject before input", async () => {
  let acquired = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { acquired++; yield* []; } };
  const result = await run(["\ud800"], undefined, {}, { stdin });
  assert.equal(result.exitCode, 1); assert.equal(acquired, 0);
});

for (const reason of [false, 0, "", null]) test(`locale getter abort stops lower-priority lookup: ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController();
  let lowerReads = 0;
  const env = { get LC_ALL() { caller.abort(reason); return ""; }, get LC_CTYPE() { lowerReads++; return "C"; } };
  await assert.rejects(run([], undefined, {}, { env, signal: caller.signal }), error => error === reason);
  assert.equal(lowerReads, 0);
});
