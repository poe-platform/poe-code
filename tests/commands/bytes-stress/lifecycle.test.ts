import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { FsError, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createByteCommands } from "../../../src/commands/bytes/index.js";
import { bytes, chunks, run } from "./helpers.js";

for (const name of createByteCommands().map(command => command.name)) {
  test(`${name}: quota-rejecting byte sink fails without draining further output`, { timeout: 3000 }, async () => {
    const payload = bytes(65537);
    const input = name === "gunzip" || name === "zcat" ? gzipSync(payload) : payload;
    let closed = false;
    const source = (async function* () { try { yield* chunks(input, 1024); } finally { closed = true; } })();
    let attempted = 0;
    const result = await run(name, [], source, {}, {
      stdout: { async write(data) { attempted++; assert(data.length > 8); throw new FsError("EFBIG", { message: "independent stdout quota" }); } },
    });
    assert.equal(result.exitCode, 1, name); assert.match(result.stderr.toString(), /quota/u);
    assert.equal(attempted, 1); assert.equal(closed, true);
  });

  for (const waiting of ["source", "sink"] as const) test(`${name}: independent ${waiting} cancellation and late rejection`, { timeout: 3000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("independent byte cancellation");
    let reject!: (reason: unknown) => void;
    const blocked = new Promise<never>((_, failure) => { reject = failure; });
    const source: ByteSource = { [Symbol.asyncIterator]() { return { next: () => blocked, return: async () => ({ done: true as const, value: undefined }) }; } };
    const payload = name === "gunzip" || name === "zcat" ? gzipSync("payload") : Buffer.from("payload");
    const overrides: Partial<CommandContext> = { signal: controller.signal, ...(waiting === "sink" ? { stdout: { write: () => blocked } } : {}) };
    const task = run(name, [], waiting === "source" ? source : payload, {}, overrides);
    const timer = setTimeout(() => controller.abort(reason), 15);
    try {
      await assert.rejects(task, error => error === reason);
      reject(new Error("late uncooperative failure"));
      await new Promise<void>(resolve => setImmediate(resolve));
    } finally { clearTimeout(timer); reject(new Error("cleanup")); }
  });
}

for (const [name, args] of [["gzip", ["-c"]], ["gzip", ["-dfc"]], ["gunzip", ["-c"]], ["zcat", []]] as const) test(`${name} ${args.join(" ")}: long empty-only source remains timer-cancellable`, { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("empty chunks should not starve cancellation");
  const source = (async function* () { for (let count = 0; count < 100000; count++) yield new Uint8Array(); throw new Error("input limit reached before timer"); })();
  const timer = setTimeout(() => controller.abort(reason), 10);
  try { await assert.rejects(run(name, args, source, {}, { signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
});
