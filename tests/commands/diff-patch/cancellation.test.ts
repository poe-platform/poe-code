import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ByteSource } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const tool of ["diff", "patch"] as const) {
  test(`${tool} rejects pre-aborted signals without reading or writing`, async () => {
    const fs = await filesystem({ target: "old\n", other: "new\n" });
    const controller = new AbortController();
    const reason = new Error("author pre-abort");
    controller.abort(reason);
    await assert.rejects(run(tool, tool === "diff" ? ["target", "other"] : [], { fs, input: replacement, signal: controller.signal }), error => error === reason);
    assert.equal(await contents(fs, "target"), "old\n");
  });
}

test("patch aborts waiting for stdin and observes late iterator failures", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("author stdin abort");
  let rejectRead: ((error: Error) => void) | undefined;
  let returned = false;
  const input: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((_resolve, reject) => { rejectRead = reject; }),
        return: async () => { returned = true; throw new Error("late cleanup rejection"); },
      };
    },
  };
  const pending = run("patch", [], { input, signal: controller.signal });
  await delay(10);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectRead!(new Error("late read rejection"));
  await delay(10);
  assert.equal(returned, true);
});

test("diff aborts a blocked output sink and observes its late failure", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("author sink abort");
  let rejectWrite: ((error: Error) => void) | undefined;
  const pending = run("diff", ["old", "new"], {
    files: { old: "old\n", new: "new\n" }, signal: controller.signal,
    stdout: { write: () => new Promise((_resolve, reject) => { rejectWrite = reject; }) },
  });
  await delay(10);
  assert(rejectWrite);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectWrite(new Error("late sink rejection"));
  await delay(10);
});

test("filesystem waits propagate the signal and observe late rejection", { timeout: 2000 }, async () => {
  const fs = await filesystem({ target: "old\n" });
  const controller = new AbortController();
  const reason = new Error("author filesystem abort");
  let rejectStat: ((error: Error) => void) | undefined;
  fs.lstat = (_path, options) => {
    assert.equal(options?.signal, controller.signal);
    return new Promise((_resolve, reject) => { rejectStat = reject; });
  };
  const pending = run("patch", [], { fs, input: replacement, signal: controller.signal });
  await delay(10);
  assert(rejectStat);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectStat(new Error("late stat rejection"));
  await delay(10);
  assert.equal(await contents(fs, "target"), "old\n");
});

test("diff computation yields for cancellation before producing output", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("author CPU abort");
  const old = Array.from({ length: 1200 }, (_unused, index) => `old${index}\n`).join("");
  const next = Array.from({ length: 1200 }, (_unused, index) => `new${index}\n`).join("");
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(run("diff", ["old", "new"], { files: { old, new: next }, signal: controller.signal, options: { maxWork: 100_000_000 } }), error => error === reason);
  } finally { clearTimeout(timer); }
});

test("patch matching yields for cancellation and preflight leaves bytes intact", { timeout: 2000 }, async () => {
  const fs = await filesystem({ target: "repeated\n".repeat(30_000) });
  const controller = new AbortController();
  const reason = new Error("author matching abort");
  const input = "--- target\n+++ target\n@@ -1,100 +1 @@\n" + "-repeated\n".repeat(99) + "-not-present\n+new\n";
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(run("patch", [], { fs, input, signal: controller.signal, options: { maxWork: 100_000_000 } }), error => error === reason);
  } finally { clearTimeout(timer); }
  assert.equal(await contents(fs, "target"), "repeated\n".repeat(30_000));
});

test("cancellation during commit leaves only the already-committed prefix", async () => {
  const fs = await filesystem({ first: "old\n", second: "old\n" });
  const controller = new AbortController();
  const reason = new Error("author commit abort");
  const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path, data, options) => {
    assert.equal(options?.signal, controller.signal);
    if (path === "/work/second") controller.abort(reason);
    return write(path, data, options);
  };
  const input = replacement.replaceAll("target", "first") + replacement.replaceAll("target", "second");
  await assert.rejects(run("patch", [], { fs, input, signal: controller.signal }), error => error === reason);
  assert.equal(await contents(fs, "first"), "new\n");
  assert.equal(await contents(fs, "second"), "old\n");
});

test("endless empty stdin chunks yield and remain cancellable", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("author empty-chunk abort");
  const input = (async function* () { while (true) yield new Uint8Array(); })();
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(run("patch", [], { input, signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
});
