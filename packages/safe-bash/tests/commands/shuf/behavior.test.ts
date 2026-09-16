import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { CommandRegistry, createCommandArguments, FsError, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { Shell } from "../../../src/shell/shell.js";
import { createShufCommand, createShufCommands, shufCommands } from "../../../src/commands/shuf/index.js";
import { entropy, native, nativeOptions, randomPath, run } from "./helpers.js";

test("opt-in definitions, plugin collision preflight and explicit replacement", async () => {
  const commands = createShufCommands();
  assert.deepEqual(commands.map(command => command.name), ["shuf"]);
  assert.ok(Object.isFrozen(commands));
  const shell = new Shell({ fs: createMemoryFileSystem() });
  assert.equal(shell.commands.has("shuf"), false);
  shell.use(shufCommands());
  await shell.exec("shuf -e only");
  assert.throws(() => shufCommands().setup(shell), { message: "Command already registered: shuf" });
  shell.use(shufCommands({ replace: true }));
  const result = await shell.exec("shuf -e only");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "only\n");
  assert.equal(result.stderr, "");
  const registry = new CommandRegistry(commands);
  assert.equal(registry.get("shuf")?.name, "shuf");
});

test("Shell pipeline, virtual redirection, stdin and output file", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(shufCommands());
  assert.equal((await shell.exec("shuf -e a a a | shuf -n2 > /result")).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/result")).toString(), "a\na\n");
  assert.equal((await shell.exec("shuf -o /result /result")).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/result")).toString(), "a\na\n");
});

test("VFS input and in-place output preserve bytes and use regular-file sampling", async context => {
  const fs = createMemoryFileSystem();
  const bytes = Buffer.from([255, 0, 10, 128, 10, 10, 254]);
  await fs.writeFile("/input", bytes);
  await fs.writeFile("/entropy", entropy);
  const actual = await run(["--random-source=/entropy", "-n2", "-o/input", "/input"], undefined, undefined, { fs });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.length, 0);
  await context.test("GNU record selection", nativeOptions, async () => {
    const oracle = await native([`--random-source=${randomPath}`, "-en2", "first", "second", "third", "fourth"]);
    const records = [Buffer.from([255, 0, 10]), Buffer.from([128, 10]), Buffer.from([10]), Buffer.from([254, 10])];
    const names = ["first", "second", "third", "fourth"];
    assert.deepEqual(Buffer.from(await fs.readFile("/input")), Buffer.concat(oracle.stdout.toString().trim().split("\n").map(name => records[names.indexOf(name)]!)));
  });
});

for (const args of [["-e", "a", "b", "c"], ["-ern10", "a", "b"], ["-n0"], ["-er"]]) {
  test(`GNU output stream ${args}`, async context => {
    const seeded = [`--random-source=${randomPath}`, "-o/dev/fd/4", ...args];
    const actual = await run(seeded);
    await context.test("GNU output file bytes", nativeOptions, async () => {
      let expectedFile: Buffer = Buffer.alloc(0);
      const expected = await native(seeded, undefined, undefined, undefined, bytes => { expectedFile = bytes; });
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, expected);
      assert.deepEqual(Buffer.from(await actual.fs.readFile("/dev/fd/4")), expectedFile);
    });
  });
}

test("output errors and random-source exhaustion do not truncate input before permutation", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a\nb\nc\n"));
  await fs.writeFile("/empty", new Uint8Array());
  assert.equal((await run(["--random-source=/empty", "-o/input", "/input"], undefined, undefined, { fs })).exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a\nb\nc\n");
  assert.equal((await run(["-n0", "-o/input", "/missing"], undefined, undefined, { fs })).exitCode, 0);
  assert.equal((await fs.readFile("/input")).length, 0);
});

test("readFile-only VFS works for both records and entropy", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", Buffer.from("a\nb\nc\n"));
  await fs.writeFile("/random", entropy);
  Object.defineProperty(fs, "readStream", { value: undefined });
  const actual = await run(["--random-source=/random", "/in"], undefined, undefined, { fs });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.length, 6);
});

test("owned byte argv preserve distinct invalid UTF-8 and embedded delimiters", async () => {
  const carrier = createCommandArguments(["-e", shellValueFromBytes(Uint8Array.of(255)), shellValueFromBytes(Uint8Array.of(254)), "x\ny", ""]);
  const actual = await run(carrier.args, undefined, undefined, { argumentValues: carrier });
  assert.equal(actual.exitCode, 0);
  assert.deepEqual([...actual.stdout].sort((left, right) => left - right), [10, 10, 10, 10, 10, 120, 121, 254, 255]);
});

test("input producer buffer reuse and finalization cannot corrupt records", async () => {
  const buffer = Buffer.alloc(2);
  const stdin: ByteSource = (async function* () {
    try {
      for (const text of ["a\n", "b\n", "c\n"]) { buffer.write(text); yield buffer; }
    } finally { buffer.fill(0); }
  })();
  const actual = await run([`--random-source=${randomPath}`], undefined, undefined, { stdin });
  assert.deepEqual(actual.stdout.toString().trim().split("\n").sort(), ["a", "b", "c"]);
});

for (const args of [["-re", "x"], ["-re", "x", "-n1000000000000000"], ["-ri0-18446744073709551614"], ["-i0-18446744073709551614", "-n500000"]]) {
  test(`cooperative timer cancellation ${args}`, { timeout: 1500 }, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel shuf");
    const timer = setTimeout(() => controller.abort(reason), 5);
    try {
      await assert.rejects(run(args, undefined, undefined, { signal: controller.signal, stdout: { async write() {} } }), error => error === reason);
    } finally { clearTimeout(timer); }
  });
}

test("cancellation survives errno-shaped reasons and blocked writes", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  await assert.rejects(run(["-re", "x"], undefined, undefined, {
    signal: controller.signal,
    stdout: { async write() { controller.abort(reason); return new Promise(() => {}); } },
  }), error => error === reason);
});

test("Math.random is never used", async () => {
  const original = Math.random;
  Math.random = () => { throw new Error("insecure randomness"); };
  try {
    const actual = await run(["-i0-99", "-n20"]);
    assert.equal(actual.exitCode, 0);
    assert.equal(new Set(actual.stdout.toString().trim().split("\n")).size, 20);
  } finally { Math.random = original; }
});

test("resource limits are validated, bounded and configurable", async () => {
  assert.throws(() => createShufCommand({ maxSampleSize: 0 }), RangeError);
  assert.throws(() => createShufCommand({ maxInputBytes: Infinity }), RangeError);
  const capture: Uint8Array[] = [];
  const context: CommandContext = {
    command: "shuf", args: ["-i0-18446744073709551614"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected output"); } },
    stderr: { async write(bytes) { capture.push(new Uint8Array(bytes)); } },
  };
  assert.equal((await createShufCommand({ maxSampleSize: 3 }).execute(context)).exitCode, 1);
  assert.equal(Buffer.concat(capture).toString(), "shuf: maxSampleSize limit exceeded\n");
});

test("GNU unknown-size reservoir read errors retain read-error diagnostics", async () => {
  const stdin: ByteSource = (async function* () { yield Buffer.from("a\n"); throw new FsError("EIO"); })();
  const result = await run(["-n1", `--random-source=${randomPath}`], undefined, undefined, { stdin });
  assert.equal(result.stderr, "shuf: read error: Input/output error\n");
});

test("cancellation waits for cooperative source cleanup", async () => {
  const controller = new AbortController();
  const reason = new Error("source cancelled");
  let closed = false;
  const stdin: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        async next() { controller.abort(reason); return { done: false, value: Buffer.from("a\n") }; },
        async return() { await new Promise<void>(resolve => setImmediate(resolve)); closed = true; return { done: true, value: undefined }; },
      };
    },
  };
  await assert.rejects(run([], undefined, undefined, { stdin, signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
});

test("entropy failures are not replaced by insecure fallback", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", entropy);
  fs.readStream = () => (async function* () { yield await Promise.reject<Uint8Array>(new FsError("EIO")); })();
  const actual = await run(["-e", "a", "b", "--random-source=/random"], undefined, undefined, { fs });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stderr, "shuf: '/random': read error: Input/output error\n");
});

test("retained entropy is copied before the producer advances", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", entropy);
  fs.readStream = () => (async function* () {
    const chunk = Buffer.alloc(1);
    try { for (const value of entropy) { chunk[0] = value; yield chunk; } }
    finally { chunk.fill(0); }
  })();
  const args = ["-i0-9999999999999", "-n20"];
  const actual = await run(["--random-source=/random", ...args], undefined, undefined, { fs });
  await context.test("GNU retained entropy selection", nativeOptions, async () => {
    assert.deepEqual(actual.stdout, (await native([`--random-source=${randomPath}`, ...args])).stdout);
  });
});

test("all 255 accepted one-byte values produce exactly uniform three-way choices", async () => {
  const counts = [0, 0, 0];
  for (let value = 0; value < 255; value++) {
    const actual = await run([`--random-source=${randomPath}`, "-i0-2", "-n1"], undefined, Uint8Array.of(value));
    const chosen = Number(actual.stdout.toString().trim());
    assert.equal(actual.exitCode, 0);
    counts[chosen] = counts[chosen]! + 1;
  }
  assert.deepEqual(counts, [85, 85, 85]);
  const rejected = await run([`--random-source=${randomPath}`, "-i0-2", "-n1"], undefined, Uint8Array.of(255, 2));
  assert.equal(rejected.stdout.toString(), "2\n");
});

test("large regular-file sampling uses the GNU reservoir threshold", async context => {
  const fs = createMemoryFileSystem();
  const large = Buffer.alloc(8 * 1024 * 1024 + 1, 120);
  large[large.length - 1] = 10;
  const input = Buffer.concat([large, Buffer.from("tail\n")]);
  await fs.writeFile("/large", input);
  const zeroEntropy = new Uint8Array(32);
  await fs.writeFile("/random", zeroEntropy);
  const actual = await run(["--random-source=/random", "-n1", "/large"], undefined, undefined, { fs });
  assert.equal(actual.exitCode, 0);
  await context.test("GNU reservoir selection", nativeOptions, async () => {
    const expected = await native([`--random-source=${randomPath}`, "-n1"], input, zeroEntropy);
    assert.deepEqual(actual.stdout, expected.stdout);
  });
});

test("VFS symlink/parent components are not lexically erased", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/a");
  await fs.mkdir("/b/sub", { recursive: true });
  await fs.symlink("/b/sub", "/a/link");
  await fs.writeFile("/a/in", Buffer.from("wrong\n"));
  await fs.writeFile("/b/in", Buffer.from("right\n"));
  const result = await run(["link/../in", "-o", "link/../out"], undefined, undefined, { fs, cwd: "/a" });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/b/out")).toString(), "right\n");
});

test("secure system entropy is used and its failure is propagated", async context => {
  const failure = new Error("secure entropy unavailable");
  const mock = context.mock.method(crypto, "randomFillSync", () => { throw failure; });
  syncBuiltinESMExports();
  try {
    await assert.rejects(run(["-i0-9", "-n1"]), error => error === failure);
    assert.equal(mock.mock.callCount(), 1);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test("GNU broken output pipe terminates repeat with status 141 and no diagnostic", async context => {
  const args = ["-re", "x"];
  const actual = await run(args, undefined, undefined, { stdout: { async write() { throw new FsError("EPIPE"); } } });
  assert.equal(actual.exitCode, 141);
  assert.equal(actual.stderr, "");
  await context.test("GNU broken pipe status", nativeOptions, async () => {
    const expected = await native(args, undefined, undefined, undefined, undefined, true);
    assert.equal(expected.exitCode, 141);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stderr, expected.stderr);
  });
});

for (const entropySource of [false, true]) {
  test(`empty-chunk source remains timer-cancellable: entropy=${entropySource}`, { timeout: 1500 }, async () => {
    const controller = new AbortController();
    const reason = new Error("stop empty chunks");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/random", new Uint8Array());
    let closed = false;
    const empty: ByteSource = (async function* () {
      try { while (true) yield new Uint8Array(); }
      finally { closed = true; }
    })();
    const overrides: Partial<CommandContext> = { fs, signal: controller.signal };
    if (entropySource) fs.readStream = () => empty;
    else Object.assign(overrides, { stdin: empty });
    const timer = setTimeout(() => controller.abort(reason), 5);
    try {
      await assert.rejects(run(entropySource ? ["--random-source=/random", "-i0-9", "-n1"] : [], undefined, undefined, overrides), error => error === reason);
      assert.equal(closed, true);
    } finally { clearTimeout(timer); }
  });
}

test("repeat cancellation preserves a completed file write", async () => {
  const controller = new AbortController();
  const reason = new Error("stop output file");
  const fs = createMemoryFileSystem();
  const append = fs.appendFile.bind(fs);
  fs.appendFile = async (path, bytes, options) => {
    await append(path, bytes, options);
    if (bytes.length) controller.abort(reason);
  };
  Object.defineProperty(fs, "writeStream", { value: undefined });
  await assert.rejects(run(["-re", "x", "-o/result"], undefined, undefined, { fs, signal: controller.signal }), error => error === reason);
  assert.equal(Buffer.from(await fs.readFile("/result")).toString(), "x\n");
});

test("Shell closes an infinite upstream repeat when the downstream consumer finishes", { timeout: 1500 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("pipeline did not close")), 1000);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(shufCommands());
  shell.register({
    name: "take",
    async execute(context) {
      for await (const chunk of context.stdin) {
        await context.stdout.write(chunk);
        break;
      }
      return { exitCode: 0 };
    },
  });
  try {
    const result = await shell.exec("shuf -re x | take", { signal: controller.signal });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "x\n");
    assert.equal(result.stderr, "");
  } finally { clearTimeout(timer); }
});

test("dash output/random-source names are VFS files rather than standard streams", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/-", entropy);
  const result = await run(["-e", "a", "b", "c", "--random-source=-", "-o-"], undefined, undefined, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 0);
  assert.equal(Buffer.from(await fs.readFile("/-")).toString(), "b\na\nc\n");
});
