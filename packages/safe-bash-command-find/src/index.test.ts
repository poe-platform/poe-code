import assert from "node:assert/strict";
import test from "node:test";
import { registerRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
import { createDirectoryReader } from "safe-bash-io-engine/commands/directory-admission";
import { FindFormatBudget } from "./find-format.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, shellValueFromBytes, shellValueBytes, type CommandDefinition } from "safe-bash-contracts";
import { createFindCommand, createFindCommands, findCommands } from "./index.js";

for (const route of ["recursive", "name", "count"] as const) {
test(`find accounts for direct memory directory reads through ${route}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tree/child", { recursive: true });
  await fs.writeFile("/tree/child/file", new Uint8Array());
  let operations = 0;
  registerRuntimeBackingFileSystem(fs, fs, () => { operations++; });
  let stdout = "";
  const result = await createFindCommand().execute({
    ...{ _hasInfiniteFsOpsLimit: true },
    command: "find", args: route === "recursive" ? ["/tree"] : ["/tree/child", "-name", "*"], cwd: "/", env: {}, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      ...(route === "count" ? { lineCountOnly: 0, writeLineCountSync(count: number) { assert.equal(count, 2); return true; } } : {}),
      async write(bytes) { stdout += new TextDecoder().decode(bytes); },
    },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stdout, route === "recursive" ? "/tree\n/tree/child\n/tree/child/file\n" : route === "name" ? "/tree/child\n/tree/child/file\n" : "");
  assert.equal(operations, route === "recursive" ? 2 : 1);
});
}

test("find formatting has no implicit work or output quota", async () => {
  let bytes = 0;
  const result = await run({ name: "find", async execute(context) {
    const budget = new FindFormatBudget({ ...context, stdout: { async write(chunk) { bytes += chunk.length; } } });
    await budget.step(32 * 1024 * 1024 + 1);
    await budget.write(new Uint8Array(8 * 1024 * 1024 + 1));
    await budget.flush();
    return { exitCode: 0 };
  } }, []);
  assert.equal(result.exitCode, 0);
  assert.equal(bytes, 8 * 1024 * 1024 + 1);
});

test("directory admission omits unlimited bounds and retains finite enforcement", async () => {
  await run({ name: "find", async execute(context) {
    const entries = Array.from({ length: 10001 }, (_, index) => ({ name: String(index), type: "file" as const }));
    const bounds: unknown[] = [];
    context.fs.readdir = async (_path, options) => { bounds.push(options?.maxEntries); return entries; };
    assert.equal((await createDirectoryReader()(context, "/")).length, 10001);
    assert.equal((await createDirectoryReader(Infinity)(context, "/")).length, 10001);
    await assert.rejects(createDirectoryReader(10000)(context, "/"), /directory entry limit/);
    assert.deepEqual(bounds, [undefined, undefined, 10000]);
    return { exitCode: 0 };
  } }, []);
});

test("find walks beyond depth 1024 by default", async () => {
  await run({ name: "find", async execute(context) {
    const directory = await context.fs.lstat("/");
    let deepest = 0;
    context.fs.lstat = async () => directory;
    context.fs.realpath = async path => path;
    context.fs.readdir = async path => {
      const depth = path.split("/").length - 2;
      deepest = Math.max(deepest, depth);
      return depth >= 1025 ? [] : [{ name: "d", type: "directory" }];
    };
    const values = createCommandArguments(["/tree", "-type", "f"]);
    const result = await createFindCommand().execute({ ...context, args: values.args, argumentValues: values });
    assert.equal(result.exitCode, 0);
    assert.equal(deepest, 1025);
    return result;
  } }, []);
});

async function run(command: CommandDefinition, args: string[], input = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

for (const option of ["-name", "-iname"]) {
  test(`find ${option} counts astral characters as one wildcard character`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    for (const name of ["😀.txt", "ab.txt", "x.txt"]) {
      await fs.writeFile(`/dir/${name}`, new Uint8Array());
    }
    for (const extra of [[], ["-type", "f"]]) {
      for (const pattern of ["?.txt", "??.txt"]) {
        let stdout = "", stderr = "";
        const result = await createFindCommand().execute({
          ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() {} },
          command: "find", args: ["/dir", ...extra, option, pattern], cwd: "/", env: {}, fs,
          stdin: toByteSource(""), signal: new AbortController().signal,
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(stdout.trimEnd().split("\n").sort(),
          pattern === "?.txt" ? ["/dir/\\360\\237\\230\\200.txt", "/dir/x.txt"] : ["/dir/ab.txt"]);
      }
    }
  });
}

test("standalone find works with only portable filesystem and command contracts", async () => {
  assert.equal(createFindCommand().name, "find");
  assert.ok(createFindCommands().some(command => command.name === "find"));
  assert.equal(findCommands().name, "find-commands");
  const result = await run(createFindCommand(), [".", "-maxdepth", "0"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, ".\n");
});

for (const mutation of ["unlink", "rename", "replace"] as const) {
  for (const nested of [false, true]) {
    test(`find omits tombstones after ${mutation} with nested=${nested} in traversal, matching and count-only output`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/d");
      await fs.writeFile("/d/a", new Uint8Array());
      await fs.writeFile("/d/b", new Uint8Array());
      if (mutation === "unlink") await fs.unlink("/d/a");
      else if (mutation === "rename") await fs.rename("/d/a", "/moved");
      else await fs.rename("/d/a", "/d/b");
      if (nested) {
        await fs.mkdir("/d/child");
        await fs.writeFile("/d/child/kept", new Uint8Array());
        await fs.writeFile("/d/child/deleted", new Uint8Array());
        await fs.unlink("/d/child/deleted");
      }
      for (const args of [["/d"], ["/d", "-type", "f"], ["/d", "-name", "*"], ["/d", "-iname", "*"]]) {
        for (const countOnly of [false, true]) {
          let stdout = "", stderr = "", count: number | undefined;
          const result = await createFindCommand().execute({
            ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() {} },
            command: "find", args, cwd: "/", env: {}, fs, stdin: toByteSource(""),
            stdout: {
              ...(countOnly ? { lineCountOnly: 0, writeLineCountSync(value: number, bytes: number) {
                assert.equal(nested, false, "directories must fall back to recursive traversal");
                assert.equal(bytes, new TextEncoder().encode("/d\n/d/b\n").length);
                count = value; return true;
              } } : {}),
              async write(bytes) { stdout += new TextDecoder().decode(bytes); },
            },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
          });
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const expected = args[1] === "-type"
            ? "/d/b\n" + (nested ? "/d/child/kept\n" : "")
            : "/d\n/d/b\n" + (nested ? "/d/child\n/d/child/kept\n" : "");
          if (count !== undefined) assert.equal(count, 2);
          else assert.equal(stdout, expected);
        }
      }
    });

  }
}

test("find -exec preserves raw argument bytes through host invocation", async () => {
  const raw = new Uint8Array([0xff]);
  const values = createCommandArguments([".", "-maxdepth", "0", "-exec", "echo", shellValueFromBytes(raw), ";"]);
  let received: Uint8Array | undefined;
  const result = await createFindCommand().execute({
    command: "find", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
    async invoke(_command, args, options) {
      received = shellValueBytes(options?.argumentValues?.values[0] ?? args[0]!);
      return { exitCode: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(received, raw);
});

for (const rejectCount of [false, true]) {
  test(`count-only find preserves escaped byte accounting with fallback=${rejectCount}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir('/é');
    await fs.writeFile('/é/é\n\\', new Uint8Array());
    let charges = 0;
    let offeredBytes = 0;
    let stdout = '';
    const result = await createFindCommand().execute({
      ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() { charges++; } },
      command: 'find', args: ['/é', '-name', '*'], cwd: '/', env: {}, fs,
      stdin: toByteSource(''), signal: new AbortController().signal,
      stdout: {
        ...{ lineCountOnly: 0,
        writeLineCountSync(count: number, bytes: number) {
          assert.equal(count, 2);
          offeredBytes = bytes;
          return !rejectCount;
        } },
        async write(bytes) { stdout += new TextDecoder().decode(bytes); },
      },
      stderr: { async write() {} },
    });
    assert.equal(result.exitCode, 0);
    const expected = '/\\303\\251\n/\\303\\251/\\303\\251\\n\\\\\n';
    assert.equal(offeredBytes, new TextEncoder().encode(expected).length);
    assert.equal(charges, 1);
    if (rejectCount) assert.equal(stdout, expected);
  });
}

test("find charges one filesystem operation when a full count-only pipe declines", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/d');
  for (let i = 0; i < 280; i++) await fs.writeFile(`/d/${i}${'x'.repeat(240)}`, new Uint8Array());
  let charges = 0;
  let offered = 0;
  let written = 0;
  const result = await createFindCommand().execute({
    ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() { charges++; } },
    command: 'find', args: ['/d', '-name', '*'], cwd: '/', env: {}, fs,
    stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: {
      ...{ lineCountOnly: 0,
      writeLineCountSync(_count: number, bytes: number) { offered = bytes; return bytes <= 65536; } },
      async write(bytes) { written += bytes.length; },
    },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.ok(offered > 65536);
  assert.equal(written, offered);
  assert.equal(charges, 1);
});

for (const failure of [new Error("broken output"), new DOMException("cancelled", "AbortError")]) {
  test(`find releases its shared print buffer after ${failure.name}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile('/file', new Uint8Array());
    const command = createFindCommand();
    let charges = 0;
    const context = {
      _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() { charges++; },
      command: 'find', args: ['/', '-name', '*'], cwd: '/', env: {}, fs,
      stdin: toByteSource(''), signal: new AbortController().signal,
      stdout: { async write() { throw failure; } }, stderr: { async write() {} },
    };
    assert.equal((await command.execute(context)).exitCode, 1);
    assert.equal(charges, 1);
    let stdout = '';
    const result = await command.execute({ ...context, stdout: {
      async write(bytes) { stdout += new TextDecoder().decode(bytes); },
    } });
    assert.equal(result.exitCode, 0);
    assert.equal(stdout, '/\n/file\n');
    assert.equal(charges, 2, 'the next invocation must reacquire the fast print buffer');
  });
}

for (const countOnly of [false, true]) {
  test(`find finite filesystem budgets bypass speculative output with countOnly=${countOnly}`, async () => {
    const fs = createMemoryFileSystem();
    const names = Array.from({ length: 100 }, (_, i) => `/file-${String(i).padStart(3, '0')}-${'x'.repeat(90)}`);
    for (const name of names) await fs.writeFile(name, new Uint8Array());
    let stdout = '';
    const result = await createFindCommand().execute({
      ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: false,
        _chargeFastFsOp() { assert.fail('finite budgets must use the accounted filesystem'); } },
      command: 'find', args: ['/', '-name', '*'], cwd: '/', env: {}, fs,
      stdin: toByteSource(''), signal: new AbortController().signal,
      stdout: {
        ...(countOnly ? { lineCountOnly: 0, writeLineCountSync() { assert.fail('speculative count bypassed'); } } : {}),
        async write(bytes) { stdout += new TextDecoder().decode(bytes); },
      },
      stderr: { async write() {} },
    });
    assert.equal(result.exitCode, 0);
    const expected = ['/', ...names].join('\n') + '\n';
    assert.ok(expected.length > 8192);
    assert.equal(stdout, expected);
  });
}

test("find printf coalesces directives and literals into one entry write", async () => {
  const writes: Uint8Array[] = [];
  const result = await createFindCommand().execute({
    command: "find", args: [".", "-maxdepth", "0", "-printf", "%d %y %p\\n"],
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
    signal: new AbortController().signal,
    stdout: { async write(bytes) { writes.push(bytes.slice()); } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(writes).toString(), "0 d .\n");
  assert.equal(writes.length, 1);
});

test("find printf batches large raw formats without altering bytes or retaining mutable chunks", async () => {
  const writes: Uint8Array[] = [];
  const literal = Buffer.concat([Buffer.alloc(65537, 120), Buffer.from([255])]);
  const format = shellValueFromBytes(Buffer.concat([literal, Buffer.from("%p\\000%d\\n")]));
  const values = createCommandArguments([".", ".", "-maxdepth", "0", "-printf", format]);
  const result = await createFindCommand().execute({
    command: "find", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
    signal: new AbortController().signal,
    stdout: { async write(bytes) { writes.push(bytes); } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  const entry = Buffer.concat([literal, Buffer.from(".\0" + "0\n")]);
  assert.deepEqual(Buffer.concat(writes), Buffer.concat([entry, entry]));
  assert.ok(writes.every(bytes => bytes.length <= 4096));
});

for (const deletedType of ["file", "directory"] as const) {
  for (const predicate of ["-name", "-iname"]) {
  test(`find ${predicate} count shortcut skips multiple deleted ${deletedType} slots`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/a.txt", new Uint8Array());
    for (const path of ["/dir/deleted", "/dir/also-deleted"]) {
      if (deletedType === "file") await fs.writeFile(path, new Uint8Array());
      else await fs.mkdir(path);
    }
    await fs.writeFile("/dir/c.txt", new Uint8Array());
    for (const path of ["/dir/deleted", "/dir/also-deleted"]) {
      if (deletedType === "file") await fs.unlink(path);
      else await fs.rmdir(path);
    }
    registerRuntimeBackingFileSystem(fs, fs, () => {});
    let counted = false;
    const result = await createFindCommand().execute({
      ...{ _hasInfiniteFsOpsLimit: true },
      command: "find", args: ["/dir", predicate, "*"], cwd: "/", env: {}, fs,
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: {
        lineCountOnly: 0,
        writeLineCountSync(count: number, totalBytes: number) {
          assert.equal(count, 3);
          assert.equal(totalBytes, new TextEncoder().encode("/dir\n/dir/a.txt\n/dir/c.txt\n").length);
          counted = true;
          return true;
        },
        async write() { assert.fail("expected count shortcut"); },
      },
      stderr: { async write() { assert.fail("unexpected stderr"); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(counted, true);
  });
  }
}
