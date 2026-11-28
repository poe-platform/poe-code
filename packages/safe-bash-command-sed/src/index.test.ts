import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand, createSedCommands, sedCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs: FileSystem = createMemoryFileSystem(), env: Record<string, string> = {}) {
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

for (const [program, input, expected] of [
  ["y/é/e/", "aéb\n", "aeb\n"],
  ["y/ÀÉ/ae/", "ÀÉ x\n", "ae x\n"],
  ["y/abc/αβγ/", "abc\n", "αβγ\n"],
  ["y/😀é/e🦊/", "😀é界\n", "e🦊界\n"],
] as const) {
  test(`sed transliterates UTF-8 characters: ${program}`, async () => {
    const result = await run(createSedCommand(), [program], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

test("sed translation cache respects locale and character counts", async () => {
  for (const locale of ["C.UTF-8", "C", "POSIX", "C.UTF-8"]) {
    const result = await run(createSedCommand(), ["y/é/e/"], "é\n", undefined, { LC_ALL: locale });
    assert.equal(result.exitCode, locale === "C.UTF-8" ? 0 : 2);
  }
  const result = await run(createSedCommand(), ["y/é/ab/"], "é\n");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /translation sets have different lengths/);
});

test("sed bounds expanding UTF-8 translations", async () => {
  const result = await run(createSedCommand({ maxBufferBytes: 16 }), ["y/a/😀/"], "aaaaa\n");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /buffer limit exceeded/);
});

test("sed transliteration preserves malformed bytes and reads UTF-8 program files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array([0xff, 0xc3, 0xa9, 0xc3, 0x0a]));
  await fs.writeFile("/program", new TextEncoder().encode("y/é/e/;w /output"));
  const result = await run(createSedCommand(), ["-n", "-f", "/program", "/input"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/output"), new Uint8Array([0xff, 0x65, 0xc3, 0x0a]));
});

for (const [args, input, stdout, stderr] of [
  [["-n", "s/a/X/w /dev/stdout"], "ab\ncd\n", "Xb\n", ""],
  [["w /dev/stderr"], "ab\n", "ab\n", "ab\n"],
  [["w /dev/stdout"], "ab", "abab", ""],
  [["-n", "s/a/X/w /dev/stderr"], "ab\ncd\n", "", "Xb\n"],
  [["-n", "-z", "w /dev/stdout"], "ab\0cd", "ab\0cd", ""],
  [["-n", "w /dev/stderr\nw /dev/stderr"], "ab", "", "ab\nab"],
  [["-n", "s/a/X/w /dev/stdout"], "cd\n", "", ""],
] as const) {
  test(`sed writes to process streams: ${JSON.stringify({ args, input })}`, async () => {
    const fs = createReadOnlyFileSystem(createMemoryFileSystem());
    const result = await run(createSedCommand(), [...args], input, fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, stderr);
  });
}

test("sed in-place stream writes use the process stdout", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("ab\ncd\n"));
  const result = await run(createSedCommand(), ["-i", "s/a/X/w /dev/stdout", "/input"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Xb\n");
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "Xb\ncd\n");
});

for (const [program, input, expected] of [
  ["$a\\", "a\n", "a\n"],
  ["$a\\", "a", "a\n"],
  ["c\\", "a\n", ""],
  ["1i\\", "a\n", "a\n"],
  ["a\\\n", "a\n", "a\n\n"],
  ["i\\\n", "a\n", "\na\n"],
  ["c\\\n", "a\n", "\n"],
] as const) {
  test(`sed distinguishes missing text from a blank text line: ${JSON.stringify({ program, input })}`, async () => {
    const result = await run(createSedCommand(), [program], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

test("sed replaces a symlink before a subsequent follow-symlinks edit", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", Buffer.from("a\n"), { mode: 0o640 });
  await fs.symlink!("f", "/l");
  const first = await run(createSedCommand(), ["-i", "s/a/b/", "/l"], "", fs);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stderr, "");
  assert.equal(Buffer.from(await fs.readFile("/l")).toString(), "b\n");
  assert.equal((await fs.lstat("/l")).type, "file");
  assert.equal((await fs.stat("/l")).mode & 0o777, 0o640);
  const second = await run(createSedCommand(), ["-i", "--follow-symlinks", "s/a/c/", "/l"], "", fs);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(second.stderr, "");
  assert.equal(Buffer.from(await fs.readFile("/f")).toString(), "a\n");
});

for (const follow of [false, true]) test(`sed continues after a dangling symlink: follow=${follow}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.symlink!("absent", "/dangling");
  await fs.writeFile("/f", Buffer.from("a\n"));
  const result = await run(createSedCommand(), ["-i", ...(follow ? ["--follow-symlinks"] : []), "s/a/b/", "/dangling", "/f"], "", fs);
  assert.equal(result.exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/f")).toString(), "b\n");
  assert.equal((await fs.lstat("/dangling")).type, "symlink");
});

for (const follow of [false, true]) for (const suffix of ["", ".bak"]) {
  test(`sed edits chained symlinks: follow=${follow}, backup=${suffix}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/f", Buffer.from("a\n"));
    await fs.symlink!("dir/f", "/middle");
    await fs.symlink!("middle", "/l");
    const result = await run(createSedCommand(), ["-i" + suffix, ...(follow ? ["--follow-symlinks"] : []), "s/a/c/", "/l"], "", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/l")).toString(), "c\n");
    assert.equal((await fs.lstat("/l")).type, follow ? "symlink" : "file");
    assert.equal(Buffer.from(await fs.readFile("/dir/f")).toString(), follow ? "c\n" : "a\n");
    if (suffix) {
      const backup = (follow ? "/dir/f" : "/l") + suffix;
      assert.equal((await fs.lstat(backup)).type, follow ? "file" : "symlink");
      assert.equal(Buffer.from(await fs.readFile(backup)).toString(), "a\n");
    }
  });
}

for (const input of ["a", "a\n"]) {
  test(`sed empty append makes in-place final newline idempotent: ${JSON.stringify(input)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from(input));
    for (let iteration = 0; iteration < 2; iteration++) {
      const result = await run(createSedCommand(), ["-i", "-e", "$a\\", "/input"], "", fs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a\n");
    }
  });
}

for (const suffix of ["", ".bak", ".new"]) {
  for (const fallback of [false, true]) {
    test(`standalone sed edits a nested mount with suffix '${suffix}' and fallback ${fallback}`, async () => {
      const backing = createMemoryFileSystem();
      await backing.writeFile("/file", Buffer.from("old\n"), { mode: 0o640 });
      if (!fallback) await backing.link("/file", "/peer");
      if (suffix === ".bak") await backing.writeFile("/file.bak", Buffer.from("previous\n"), { mode: 0o600 });
      const root = createMemoryFileSystem();
      await root.mkdir("/private/tmp", { recursive: true });
      const mounted = createMountFileSystem({ root, mounts: { "/private/tmp/project": backing } });
      const fs = fallback ? new Proxy(mounted, { get(target, property) {
        if (property === "publishStagedFileSet") return undefined;
        const member: unknown = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      } }) : mounted;
      const result = await run(createSedCommand(), [`-i${suffix}`, "s/old/new/", "/private/tmp/project/file"], "", fs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(await backing.readFile("/file")).toString(), "new\n");
      assert.equal((await backing.stat("/file")).mode & 0o7777, 0o640);
      if (suffix) {
        assert.equal(Buffer.from(await backing.readFile("/file" + suffix)).toString(), "old\n");
        assert.equal((await backing.stat("/file" + suffix)).mode & 0o7777, 0o640);
      }
      if (!fallback) assert.equal(Buffer.from(await backing.readFile("/peer")).toString(), "old\n");
      assert.deepEqual((await backing.readdir("/")).map(entry => entry.name).sort(), ["file", ...(suffix ? ["file" + suffix] : []), ...(!fallback ? ["peer"] : [])]);
    });
  }
}

for (const refusal of ["synthetic ancestry", "read-only", "replaced ancestor", "cancellation"] as const) {
  for (const suffix of ["", ".bak"]) test(`standalone mounted sed preserves data on ${refusal}, suffix '${suffix}'`, async () => {
    const backing = createMemoryFileSystem(), root = createMemoryFileSystem();
    await backing.writeFile("/file", Buffer.from("old\n"));
    await backing.writeFile("/file.bak", Buffer.from("previous\n"));
    if (refusal !== "synthetic ancestry") await root.mkdir("/private/tmp", { recursive: true });
    const mounted = createMountFileSystem({ root, mounts: { "/private/tmp/project": refusal === "read-only" ? createReadOnlyFileSystem(backing) : backing } });
    const controller = new AbortController();
    let staged = false;
    const fs = new Proxy(mounted, { get(target, property) {
      if (property === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
        const receipt = await target.createStagedFile(...args);
        staged = true;
        if (refusal === "replaced ancestor") {
          await root.rename("/private", "/held");
          await root.mkdir("/private/tmp", { recursive: true });
        }
        if (refusal === "cancellation") controller.abort(new Error("cancel edit"));
        return receipt;
      };
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const values = createCommandArguments([`-i${suffix}`, "s/old/new/", "/private/tmp/project/file"]);
    const invocation = createSedCommand().execute({
      command: "sed", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
      stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: controller.signal,
    });
    if (refusal === "cancellation") await assert.rejects(async () => invocation, error => error === controller.signal.reason);
    else assert.notEqual((await invocation).exitCode, 0);
    assert.equal(staged, refusal === "replaced ancestor" || refusal === "cancellation");
    assert.equal(Buffer.from(await backing.readFile("/file")).toString(), "old\n");
    assert.equal(Buffer.from(await backing.readFile("/file.bak")).toString(), "previous\n");
    assert.deepEqual((await backing.readdir("/")).map(entry => entry.name).sort(), ["file", "file.bak"]);
  });
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

for (const [args, input, expected] of [
  [["N;s/\\n/-/"], "a\nb\nc\n", "a-b\nc\n"],
  [["aX\nN"], "a\nb\nc\n", "X\na\nb\nc\nX\n"],
  [["-n", "aX\nN"], "a\nb\nc\n", "X\nX\n"],
  [["N;s/\\n/-/"], "a\nb\nc", "a-b\nc"],
  [["N;s/\\n/-/"], "a\nb\n", "a-b\n"],
  [["N;s/\\n/-/"], "", ""],
  [["N;s/c/changed/"], "c\n", "c\n"],
  [["{N;};s/c/changed/"], "c\n", "c\n"],
  [["-n", "N;s/\\n/-/p"], "a\nb\nc\n", "a-b\n"],
  [["-n", "{N;};p"], "c\n", ""],
  [["N;N;s/a/changed/"], "a\nb", "a\nb"],
  [["n;s/./changed/"], "c\n", "c\n"],
  [["-z", "N"], "a\0b\0c\0", "a\0b\0c\0"],
  [["-z", "N"], "a\0b\0c", "a\0b\0c"],
] as const) {
  test(`sed next-record EOF ${JSON.stringify({ args, input })}`, async () => {
    const result = await run(createSedCommand(), [...args], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

test("sed next-record EOF preserves the last in-place record", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a\nb\nc\n"));
  const result = await run(createSedCommand(), ["-i", "N;s/\\n/-/", "/input"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a-b\nc\n");
});
