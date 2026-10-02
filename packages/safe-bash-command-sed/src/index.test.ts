import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand, createSedCommands, sedCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env,
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone sed works with only portable filesystem and command contracts", async () => {
  assert.equal(createSedCommand().name, "sed");
  assert.ok(createSedCommands().some(command => command.name === "sed"));
  assert.equal(sedCommands().name, "sed-commands");
  const result = await run(createSedCommand(), ["s/old/new/g"], "old old\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "new new\n");
});


test("sed bounds retained program caches across distinct scripts", async (t) => {
  const caches = new Set<Map<unknown, unknown>>();
  const originalSet = Map.prototype.set;
  t.mock.method(Map.prototype, "set", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof value === "object" && value !== null && "program" in value && "steps" in value) caches.add(this);
    return originalSet.call(this, key, value);
  });
  const command = createSedCommand();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("x\n"));
  for (let i = 0; i < 80; i++) {
    const pair = await run(command, [`s/cache${i}/x/;s/x/y/`, "/input"], "", fs);
    assert.equal(pair.exitCode, 0, pair.stderr);
    assert.equal(pair.stdout, "y\n");
    const result = await run(command, [`s/general${i}/z/`], `general${i}\n`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "z\n");
  }
  assert.ok(caches.size > 0, "program caching was exercised");
  for (const cache of caches) assert.ok(cache.size <= 64, `retained ${cache.size} programs`);
  const replay = await run(command, ["s/general0/z/"], "general0\n");
  assert.equal(replay.stdout, "z\n");
  assert.equal(replay.exitCode, 0, replay.stderr);
});


test("sed shares byte-oriented programs between file and stdin execution", async () => {
  const command = createSedCommand();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("café\n"));
  for (const args of [["s/café/tea/;s/tea/done/", "/input"], ["s/café/tea/;s/tea/done/"]]) {
    const result = await run(command, args, "café\n", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "done\n");
  }
});

for (const [args, input, expected] of [
  [["s/a.b/MATCH/"], "a😀b\n", "MATCH\n"],
  [["s/a[^x]b/MATCH/"], "a😀b\n", "MATCH\n"],
  [["-E", "s/a.{2,}b/MATCH/"], "a😀b\n", "a😀b\n"],
  [["-E", "s/(😀+)/[\\1]/g"], "😀x😀😀\n", "[😀]x[😀😀]\n"],
] as const) test(`sed matches UTF-8 characters: ${args.join(" ")}`, async () => {
  const command = createSedCommand();
  for (const env of [{}, { LC_ALL: "C.UTF-8" }]) {
    const result = await run(command, [...args], input, createMemoryFileSystem(), env);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test("sed cached patterns retain explicit C locale byte matching", async () => {
  const command = createSedCommand();
  for (const [env, expected] of [[{}, "MATCH\n"], [{LC_ALL:"C"}, "a😀b\n"], [{LC_CTYPE:"POSIX"}, "a😀b\n"], [{LANG:"en_US.UTF-8"}, "MATCH\n"]] as const) {
    const result = await run(command, ["s/a.b/MATCH/"], "a😀b\n", createMemoryFileSystem(), env);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

for (const prefix of ["", "^"]) {
  for (const [address, expected] of [
    ["1", "BAR QUX\nfoo QUX\nfoo QUX\n"],
    ["1,2", "BAR QUX\nBAR QUX\nfoo QUX\n"],
    ["2!", "BAR QUX\nfoo QUX\nBAR QUX\n"],
  ]) test(`paired sed respects ${address} with prefix ${prefix}`, async () => {
    const fs = createMemoryFileSystem();
    const input = "foo baz\n".repeat(3);
    await fs.writeFile("/input", new TextEncoder().encode(input));
    for (const files of [[], ["/input"]]) {
      const result = await run(createSedCommand(), [`${address}s/${prefix}foo/BAR/;s/baz/QUX/`, ...files], input, fs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  });
}

for (const [program, expected] of [
  ["s/^foo/qux/;s/baz/&-&/", "qux baz-baz\n"],
  ["s/^foo/qux/;s/b\\(a\\)\\(z\\)/\\2/", "qux z\n"],
  ["s/^f\\(o\\+\\)/\\1-\\1/;s/baz/qux/", "oo-oo qux\n"],
]) test(`paired sed expands ${program}`, async () => {
  const fs = createMemoryFileSystem();
  const input = "foo baz\n".repeat(40);
  await fs.writeFile("/input", new TextEncoder().encode(input));
  for (const files of [[], ["/input"]]) {
    const result = await run(createSedCommand(), [program!, ...files], input, fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected!.repeat(40));
  }
});

for (const sink of ["writeSync", "writeRangeSync", "writeImmutableSync"] as const) {
  test(`sed output survives later invocations with ${sink}`, async () => {
    const command = createSedCommand();
    const fs = createMemoryFileSystem();
    const input = "hello world\n".repeat(100);
    await fs.writeFile("/input", new TextEncoder().encode(input));
    async function capture(program: string) {
      const chunks: Uint8Array[] = [];
      const values = createCommandArguments([program, "/input"]);
      const retain = (bytes: Uint8Array) => { chunks.push(bytes); return true; };
      const context = {
        command: "sed", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: {
          async write(bytes: Uint8Array) { retain(bytes); },
          writeSync: retain,
          ...(sink === "writeRangeSync" ? { writeRangeSync: (bytes: Uint8Array, length: number) => retain(bytes.subarray(0, length)) } : {}),
          ...(sink === "writeImmutableSync" ? { writeImmutableSync: retain } : {}),
        },
        stderr: { async write() {} },
        _fastMemoryBackingFs: fs,
      };
      assert.equal((await command.execute(context)).exitCode, 0);
      return chunks;
    }
    const pair = "s/^hello/HELLO/;s/world/WORLD/";
    const first = await capture(pair);
    await fs.writeFile("/output", first[0]!);
    await capture("s/hello/other/");
    const replay = await capture(pair);
    await capture("s/^hello/xxxxx/;s/world/yyyyy/");
    const decode = (chunks: Uint8Array[]) => chunks.map(bytes => new TextDecoder().decode(bytes)).join("");
    assert.equal(decode(first), "HELLO WORLD\n".repeat(100));
    assert.equal(decode(replay), "HELLO WORLD\n".repeat(100));
    assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "HELLO WORLD\n".repeat(100));
  });
}

test("sed transforms batched memory input without a global Buffer", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("foo baz\n".repeat(40)));
  const originalBuffer = globalThis.Buffer;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true, writable: true });
  try {
    for (let invocation = 0; invocation < 2; invocation++) {
      const result = await run(createSedCommand(), ["s/^foo/qux/;s/baz/zip/", "/input"], "", fs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "qux zip\n".repeat(40));
    }
  } finally {
    Object.defineProperty(globalThis, "Buffer", { value: originalBuffer, configurable: true, writable: true });
  }
});

test("sed preserves retained synchronous chunks across multiple flushes", async () => {
  const chunks: Uint8Array[] = [];
  const stdout = { async write(bytes: Uint8Array) { chunks.push(bytes); }, writeSync(bytes: Uint8Array) { chunks.push(bytes); return true; } };
  const input = "first row\n".repeat(7000) + "last row\n".repeat(7000);
  const values = createCommandArguments(["s/row/ROW/"]);
  const result = await createSedCommand().execute({
    command: "sed", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    signal: new AbortController().signal,
    stdout,
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  });
  assert.equal(result.exitCode, 0);
  assert.ok(chunks.length > 1);
  assert.equal(Buffer.concat(chunks).toString(), "first ROW\n".repeat(7000) + "last ROW\n".repeat(7000));
});

for (const [script, input, expected] of [
  ["s/(hello) (world)/\\U\\1 \\E\\2/", "hello world\n", "HELLO world\n"],
  ["s/(HELLO) (WORLD)/\\L\\1 \\E\\2/", "HELLO WORLD\n", "hello WORLD\n"],
  ["s/(hello) (world)/\\u\\1 \\u\\2/", "hello world\n", "Hello World\n"],
  ["s/(HELLO) (WORLD)/\\l\\1 \\l\\2/", "HELLO WORLD\n", "hELLO wORLD\n"],
  ["s/.*/\\U&/", "café\n", "CAFÉ\n"],
  ["s/a/\\uécole/", "a\n", "École\n"],
  ["s/a/\\u🦊abc/", "a\n", "🦊abc\n"],
  ["s/^foo/\\U&/;s/bar/\\u&/", "foo bar\nfoo bar\n", "FOO Bar\nFOO Bar\n"],
] as const) test(`sed converts replacement case: ${script}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode(input));
  for (const args of [["-E", script], ["-E", script, "/input"]]) {
    const result = await run(createSedCommand(), args, input, fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test("sed reuses cached non-ASCII programs across file and stdin execution", async (t) => {
  const originalGet = Map.prototype.get;
  let hits = 0;
  t.mock.method(Map.prototype, "get", function (this: Map<unknown, unknown>, key: unknown) {
    const value = originalGet.call(this, key);
    if (typeof value === "object" && value !== null && "program" in value && "steps" in value) hits++;
    return value;
  });
  const command = createSedCommand();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("crème brûlée\n"));
  const script = "s/crème brûlée/dessert/;s/dessert/done/";
  const first = await run(command, [script, "/input"], "", fs);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stdout, "done\n");
  const previousHits = hits;
  const second = await run(command, [script], "crème brûlée\n", fs);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(second.stdout, "done\n");
  assert.equal(hits, previousHits + 1);
});

test("concurrent sed file writes preserve small batches with different record widths", async () => {
  const command = createSedCommand();
  await Promise.all([4, 8].map(async width => {
    const fs = createMemoryFileSystem();
    const input = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(width, "0")}\n`).join("");
    assert.ok(input.length < 256, "exercise the uncached record batch path");
    await fs.writeFile("/input", new TextEncoder().encode(input));
    const result = await run(command, ["w /output", "/input"], "", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, input);
    assert.equal(new TextDecoder().decode(await fs.readFile("/output")), input);
  }));
});
