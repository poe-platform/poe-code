import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { timeEnvCommands } from "../../../src/commands/time-env/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run, Timers } from "./helpers.js";

test("256 signed epoch/fraction vectors preserve independent floor-seconds arithmetic", async () => {
  let seed = 0x716532;
  for (let index = 0; index < 256; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const seconds = BigInt(seed % 4102444800);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const fraction = BigInt(seed % 1000000000);
    const negative = index % 2 === 0;
    const expectedSeconds = negative ? -seconds - (fraction ? 1n : 0n) : seconds;
    const expectedFraction = negative && fraction ? 1000000000n - fraction : fraction;
    const value = `@${negative ? "-" : ""}${seconds}.${fraction.toString().padStart(9, "0")}`;
    const result = await run("date", ["-d", value, "+%s %N"]);
    assert.equal(result.exitCode, 0, value);
    assert.equal(result.stdout, `${expectedSeconds} ${expectedFraction.toString().padStart(9, "0")}\n`, value);
  }
});

test("256 finite decimal sleep sums never schedule earlier than their exact rational duration", async () => {
  for (let index = 1; index <= 256; index++) {
    const scheduler = new Timers();
    const value = (index * 37).toString().padStart(6, "0");
    const duration = Math.ceil(index * 37 / 1000 + 1);
    const execution = run("sleep", [`0.${value}`, ".001"], { scheduler });
    assert.equal(scheduler.scheduled[0], duration);
    scheduler.tick(duration);
    assert.equal((await execution).exitCode, 0);
    assert.equal(scheduler.pending.size, 0);
  }
});

test("date and printenv honor byte rather than character limits, including output chunk ownership", async () => {
  for (const [name, args, env] of [["date", ["-d@0", "+雪"], {}], ["printenv", ["A"], { A: "雪" }]] as const) {
    await assert.rejects(run(name, args, { limits: { maxOutputBytes: 3 } }, { env }), { code: "EFBIG" });
    assert.equal((await run(name, args, { limits: { maxOutputBytes: 4 } }, { env })).stdout, "雪\n");
  }
  const large = "雪".repeat(12000), chunks: Uint8Array[] = [];
  const env = { A: large, B: "after" };
  await run("printenv", ["A", "B"], {}, { env, stdout: { async write(chunk) { chunks.push(chunk); env.B = "mutated"; } } });
  assert.ok(chunks.length > 1);
  assert.equal(Buffer.concat(chunks).toString(), `${large}\nafter\n`);
  assert.notEqual(chunks[0]?.buffer, chunks[1]?.buffer);
});

test("date rejects clock setting before clock/metadata access and pre-abort wins", async () => {
  let calls = 0;
  const fs = createMemoryFileSystem();
  fs.stat = async () => { calls++; throw new Error("unexpected metadata"); };
  for (const args of [["-s", "2024-01-01"], ["--set=@0"], ["082712002026"]]) {
    assert.equal((await run("date", args, { clock: () => { calls++; return 0; } }, { fs })).exitCode, 1);
  }
  const controller = new AbortController(), reason = new FsError("ENOENT");
  controller.abort(reason);
  await assert.rejects(run("date", ["-r", "/file"], {}, { fs, signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});

test("date reference preserves authorization errors and abort during cooperative metadata work", async () => {
  const fs = createMemoryFileSystem();
  fs.stat = async () => { throw new FsError("EACCES", { path: "/file" }); };
  const denied = await run("date", ["-r", "/file"], {}, { fs });
  assert.equal(denied.exitCode, 1); assert.equal(denied.stdout, ""); assert.match(denied.stderr, /permission denied/);
  const controller = new AbortController(), reason = new FsError("ENOENT");
  fs.stat = async (_path, options) => { controller.abort(reason); options?.signal?.throwIfAborted(); throw new Error("missing cancellation"); };
  await assert.rejects(run("date", ["-r", "/file"], {}, { fs, signal: controller.signal }), error => error === reason);
});

test("sleep timer creation failure and successful completion remove abort listeners", async () => {
  const scheduler = new Timers(), error = new Error("timer unavailable");
  scheduler.setTimeout = () => { throw error; };
  await assert.rejects(run("sleep", ["1"], { scheduler }), reason => reason === error);
  assert.equal(scheduler.pending.size, 0);
});

test("actual Shell date loop, sorting pipeline, references and null-delimited environment publication", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { B: "two", A: "one" } }).use(standardCommands()).use(timeEnvCommands({ clock: () => 0 }));
  try {
    const dates = await shell.exec("for instant in 0 86400 -1; do date -ud@$instant +%F; done | sort -u > dates; cat dates");
    assert.equal(dates.exitCode, 0, dates.stderr);
    assert.equal(dates.stdout, "1969-12-31\n1970-01-01\n1970-01-02\n");
    await fs.utimes!("/dates", 125, 125);
    const stamp = await shell.exec("date -r dates +%s.%N > stamp; env -i B=two A=one printenv | sort | cut -d= -f2; cat stamp");
    assert.equal(stamp.exitCode, 0, stamp.stderr); assert.equal(stamp.stdout, "one\ntwo\n0.125000000\n");
    const values = await shell.exec("env -i A=one B=two printenv -0 A B > env.bin; sleep 0; wc -c < env.bin");
    assert.equal(values.exitCode, 0, values.stderr); assert.equal(values.stdout.trim(), "8");
    assert.equal(Buffer.from(await fs.readFile("/env.bin")).toString("hex"), "6f6e650074776f00");
  } finally { await shell.dispose(); }
});
