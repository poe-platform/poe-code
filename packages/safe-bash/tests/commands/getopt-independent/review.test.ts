import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createGetoptCommand, createGetoptCommands, getoptCommands } from "../../../src/commands/getopt/index.js";
import { createCommandArguments, toByteSource, type ByteSink, type CommandContext } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { deferred, run } from "./support.js";

for (const raw of [false, true]) {
  test(`aggregate UTF-8 byte admission is exact, raw=${raw}`, async () => {
    const args = ["-o", "", "--", "é😀"];
    const owned = createCommandArguments(args.map(value => raw ? shellValueFromBytes(Buffer.from(value)) : value));
    const admitted = await run(owned.args, { limits: { maxInputBytes: 10, maxArgumentBytes: 6 } }, { argumentValues: owned });
    assert.equal(admitted.exitCode, 0);
    assert.equal(admitted.stdout.toString(), " -- 'é😀'\n");
    for (const limits of [{ maxInputBytes: 9 }, { maxArgumentBytes: 5 }]) {
      const refused = await run(owned.args, { limits }, { argumentValues: owned });
      assert.equal(refused.exitCode, 3);
      assert.equal(refused.stdout.length, 0);
    }
  });
}

test("buffer and byte caps refuse string arguments before UTF-8 copying", async () => {
  const context: CommandContext = {
    command: "getopt", args: ["-o", "", "--", "éé"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() { assert.fail("normal output before refusal"); } }, stderr: { async write() {} },
  };
  const original = TextEncoder.prototype.encode;
  let encodes = 0;
  TextEncoder.prototype.encode = function(value) { encodes++; return Reflect.apply(original, this, [value]); };
  try {
    for (const limits of [{ maxBufferedBytes: 1 }, { maxArgumentBytes: 3 }, { maxInputBytes: 6 }]) {
      const result = await createGetoptCommand({ limits }).execute(context);
      assert.equal(result.exitCode, 3);
    }
    assert.equal(encodes, 0);
  } finally { TextEncoder.prototype.encode = original; }
});

test("raw values retain distinct malformed bytes after caller storage changes", async () => {
  const caller = Uint8Array.of(128);
  const first = shellValueFromBytes(caller);
  caller[0] = 255;
  const second = shellValueFromBytes(caller);
  const owned = createCommandArguments(["-o", "", "--", first, second]);
  caller.fill(0);
  const result = await run(owned.args, {}, { argumentValues: owned });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("hex"), "202d2d202780272027ff270a");
});

test("raw byte cap does not charge replacement-character UTF-8 display size", async () => {
  const owned = createCommandArguments(["-o", "", "--", shellValueFromBytes(Uint8Array.of(128, 255))]);
  const result = await run(owned.args, { limits: { maxArgumentBytes: 2, maxInputBytes: 6 } }, { argumentValues: owned });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("hex"), "202d2d202780ff270a");
});

for (const value of ["\ud800", "\udfff", "a\ud800b", "\u0000"]) {
  test(`invalid string ${JSON.stringify(value)} is refused before any normal output`, async () => {
    const result = await run(["-o", "", "--", value]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
  });
}

test("NUL in raw schema is not C-string truncated into a successful schema", async () => {
  const owned = createCommandArguments(["-o", shellValueFromBytes(Uint8Array.of(97, 0, 98)), "--", "-a"]);
  const result = await run(owned.args, {}, { argumentValues: owned });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.toString(), "getopt: NUL is not supported in arguments\n");
});

test("quote output cap is byte-exact and retains only previously published fragments", async () => {
  const args = ["-o", "a:", "--", "-a", "'", "tail"];
  const complete = await run(args);
  assert.equal(complete.stdout.toString(), " -a ''\\''' -- 'tail'\n");
  assert.equal((await run(args, { limits: { maxOutputBytes: complete.stdout.length } })).exitCode, 0);
  const refused = await run(args, { limits: { maxOutputBytes: 9 } });
  assert.equal(refused.exitCode, 3);
  assert.equal(refused.stdout.toString(), " -a");
  assert.equal(refused.stderr.toString(), "getopt: output bytes limit exceeded\n");
});

test("work exhaustion in a long quoted value preserves the earlier option fragment", async () => {
  const args = ["-o", "a:", "--", "-a", "'".repeat(400)];
  const result = await run(args, { limits: { maxWork: 1250 } });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout.toString(), " -a");
  assert.equal(result.stderr.toString(), "getopt: work limit exceeded\n");
});

for (const create of [createGetoptCommand, () => createGetoptCommands()[0]!]) {
  for (const phase of ["first capability", "opaque write", "stderr accessor"] as const) {
    for (const reason of [false, 0, "", null]) {
      test(`factory ${create.name} ${phase} cancellation rejects exactly ${JSON.stringify(reason)}`, async () => {
        const caller = new AbortController();
        let writes = 0;
        let registered = 0;
        const sink: ByteSink = {
          get write() {
            if (phase === "opaque write") caller.abort(reason);
            return async () => { writes++; };
          },
        };
        if (phase === "first capability") Object.defineProperty(sink, "ownedOutput", { get() {
          caller.abort(reason);
          return { consumerClosed: new AbortController().signal, async write() { writes++; } };
        } });
        const context: CommandContext = {
          command: "getopt", args: phase === "stderr accessor" ? ["--bad"] : ["-o", ""],
          cwd: "/", env: {}, fs: new MemoryFileSystem(), stdin: toByteSource(""), signal: caller.signal,
          registerCleanup() { registered++; }, stdout: sink,
          get stderr() {
            if (phase === "stderr accessor") caller.abort(reason);
            return sink;
          },
        };
        await assert.rejects(async () => create().execute(context), error => Object.is(error, reason));
        assert.equal(writes, 0);
        assert.equal(registered, 1);
      });
    }
  }
}

for (const reason of [false, 0, "", null]) {
  test(`registered cleanup drains held write and preserves caller reason ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    const entered = deferred();
    const gate = deferred();
    let cleanup: (() => void | Promise<void>) | undefined;
    let drained = false;
    let writes = 0;
    const execution = run(["-o", "", "--", "tail"], {}, {
      signal: caller.signal,
      registerCleanup(callback) { assert.equal(cleanup, undefined); cleanup = callback; },
      stdout: { async write() {
        assert.ok(cleanup);
        writes++;
        entered.resolve();
        await gate.promise;
        drained = true;
        throw new Error("late failure");
      } },
    });
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      assert.ok(cleanup);
      const first = cleanup();
      assert.equal(cleanup(), first);
      let closed = false;
      void Promise.resolve(first).then(() => { closed = true; });
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ settled, closed, drained, writes }, { settled: false, closed: false, drained: false, writes: 1 });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      await first;
      assert.equal(drained, true);
      assert.equal(writes, 1);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });
}

test("saved VFS eval roundtrip preserves raw bytes, empty values and inert metacharacters", async () => {
  const fs = new MemoryFileSystem();
  const raw = Buffer.from([128, 255, 39, 92, 10, 88]);
  const argumentsBytes = [Buffer.from("-a"), raw, Buffer.from("-b"), Buffer.from("--alpha="), Buffer.from(""), Buffer.from("$(missing-command); `missing-command`")];
  const quoted = argumentsBytes.map((value, index) => index === 1 ? Buffer.from('"$raw"') : Buffer.concat([
    Buffer.from("'"), Buffer.from(value.toString("latin1").split("'").join("'\\''"), "latin1"), Buffer.from("'"),
  ]));
  const script = Buffer.concat([
    Buffer.from("raw=$(printf '%b' '\\0200\\0377\\0047\\0134\\0012X')\n"),
    Buffer.from("parsed=$(getopt -o a:b:: --long alpha: -- "),
    ...quoted.flatMap(value => [value, Buffer.from(" ")]),
    Buffer.from(")\neval \"set -- $parsed\"\nprintf '%s\\000' \"$@\"\n"),
  ]);
  await fs.writeFile("/review.sh", script);
  const shell = new Shell({ fs }).use(getoptCommands());
  shell.commands.register(printfCommand);
  try {
    const result = await shell.exec("sh /review.sh");
    const expected = [Buffer.from("-a"), raw, Buffer.from("-b"), Buffer.from(""), Buffer.from("--alpha"), Buffer.from(""), Buffer.from("--"), ...argumentsBytes.slice(4)];
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat(expected.flatMap(value => [value, Buffer.from([0])])));
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["review.sh"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/review.sh")), script);
  } finally { await shell.dispose(); }
});

test("non-UTF-8 saved source is refused rather than mistaken for a getopt failure", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/raw-source.sh", Buffer.concat([Buffer.from("getopt -o '' -- '"), Uint8Array.of(255), Buffer.from("'\n")]));
  const shell = new Shell({ fs }).use(getoptCommands());
  try {
    const result = await shell.exec("sh /raw-source.sh");
    assert.equal(result.exitCode, 126);
    assert.equal(result.stdoutBytes.length, 0);
    assert.ok(result.stderr.includes("cannot execute binary or non-UTF-8 script"));
  } finally { await shell.dispose(); }
});

for (const [name, script, expectedHex] of [
  ["before eval retains getopt bytes", "raw=$(printf '%b' '\\0200\\0377X')\nparsed=$(getopt -o '' -- \"$raw\")\nprintf '%s' \"$parsed\"\n", "202d2d202780ff5827"],
  ["eval without getopt retains raw bytes", "raw=$(printf '%b' '\\0200\\0377X')\neval \"set -- '$raw'\"\nprintf '%s' \"$1\"\n", "80ff58"],
] as const) {
  test(`native saved-script control: ${name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/control.sh", Buffer.from(script));
    const shell = new Shell({ fs }).use(getoptCommands());
    shell.commands.register(printfCommand);
    try {
      const result = await shell.exec("sh /control.sh");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderrBytes.length, 0);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expectedHex);
    } finally { await shell.dispose(); }
  });
}
