import assert from "node:assert/strict";
import test from "node:test";
import { createOdCommand, createOdCommands, odCommands } from "./index.js";

test("od command definition exports standard contract", () => {
  const def = createOdCommand();
  assert.equal(def.name, "od");
  assert.equal(typeof def.execute, "function");
  assert.equal(createOdCommands().length, 1);
  assert.equal(odCommands().name, "od-commands");
});

import { createMemoryFileSystem, createOverlayFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectText, createBytePipe, createCommandArguments } from "safe-bash-contracts";

async function run(args: string[], fs: FileSystem, maxInputBytes = 1024) {
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const result = await createOdCommand({ limits: { maxInputBytes } }).execute({
    command: "od", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), stdout: stdout.writable, stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  return { ...result, stdout: await collectText(stdout.readable, {}), stderr: await collectText(stderr.readable, {}) };
}

test("od accepts Infinity through nested and legacy limit options", () => {
  assert.doesNotThrow(() => createOdCommand({ limits: { maxInputBytes: Infinity } }));
  assert.doesNotThrow(() => odCommands({ maxInputBytes: Infinity }));
});

for (const streamingRead of [undefined, false]) {
  test(`od reads overlay files with streamingRead=${streamingRead} and enforces limits`, async () => {
    const lower = createMemoryFileSystem();
    await lower.writeFile("/16", new TextEncoder().encode("hello\0"));
    let fs: FileSystem = createOverlayFileSystem({ lower, upper: createMemoryFileSystem() });
    {
      const overlay = fs;
      fs = new Proxy({} as FileSystem, { get(_target, property) {
        if (property === "capabilities" && streamingRead === false) return { streamingRead: false };
        if (property === "readStream") return streamingRead === false ? () => { throw new Error("must use readFile"); } : undefined;
        const value = Reflect.get(overlay, property);
        return typeof value === "function" ? value.bind(overlay) : value;
      } });
    }
    const result = await run(["16"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
    const limited = await run(["16"], fs, 2);
    assert.notEqual(limited.exitCode, 0);
    assert.ok(limited.stderr.includes("input limit"));
  });
}

for (const flag of ["-w", "--width", "-S", "--strings"]) {
  test(`od ${flag} preserves numeric file operands`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/16", new TextEncoder().encode("hello\0"));
    const result = await run([flag, "16"], fs);
    const explicit = await run([flag, "--", "16"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, explicit.stdout);
    assert.ok(result.stdout.includes(flag.includes("S") || flag.includes("strings") ? "hello" : "0000006"));
  });
}

for (const value of [-1, NaN, -Infinity, 1.5]) {
  test(`od rejects invalid limit ${value}`, () => {
    assert.throws(() => createOdCommand({ limits: { maxInputBytes: value } }), RangeError);
  });
}

for (const [short, long] of [["-w2", "--width=2"], ["-S6", "--strings=6"]]) {
  test(`od accepts attached arguments ${short} and ${long}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/16", new TextEncoder().encode("hello\0"));
    const a = await run([short!, "16"], fs);
    const b = await run([long!, "16"], fs);
    assert.equal(a.exitCode, 0, a.stderr);
    assert.equal(b.exitCode, 0, b.stderr);
    assert.equal(a.stdout, b.stdout);
    if (short === "-S6") assert.equal(a.stdout, "");
    else assert.equal(a.stdout.split("\n").length, 5);
  });
}

test("od retains rows before a missing operand and continues later operands", async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/first", Uint8Array.from({ length: 64 }, (_, i) => i));
 await fs.writeFile("/last", Uint8Array.of(255));
 const expected = await run(["-tx1", "/first", "/last"], fs);
 const actual = await run(["-tx1", "/first", "/missing", "/last"], fs);
 assert.equal(actual.exitCode, 1);
 assert.equal(actual.stdout, expected.stdout);
 assert.ok(actual.stderr.includes("missing"));
});

for (const failure of ["stream", "limit"] as const) test(`od retains complete rows on ${failure} failure`, async () => {
 const values = createCommandArguments([]);
 let stdout = "";
 const result = await createOdCommand({ limits: { maxInputBytes: 64 } }).execute({
  command: "od", args: values.args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
  stdin: (async function* () { yield Uint8Array.from({ length: 64 }, (_, i) => i); if (failure === "limit") yield Uint8Array.of(255); else throw new Error("stream failed"); })(),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write() {} }, signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 1);
 assert.equal(stdout.trimEnd().split("\n").length, 4);
});

test("od validates file operands with a zero byte count", async () => {
  const result = await run(["-N", "0", "/nonexistent"], createMemoryFileSystem());
  assert.notEqual(result.exitCode, 0);
});
