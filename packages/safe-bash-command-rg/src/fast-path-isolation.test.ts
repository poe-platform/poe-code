import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { Matcher } from "./matcher.js";
import { clearRgFastRunnerPool } from "./rg-command.js";
import { createRgCommand } from "./index.js";

async function run(command: CommandDefinition, fs: ReturnType<typeof createMemoryFileSystem>, args: string[], env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", charges = 0;
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    _chargeFastFsOp() { charges++; },
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      _scratch4k: new Uint8Array(4096),
      writeSync(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); return true; },
      writeRangeSync(bytes: Uint8Array, length: number) { stdout += new TextDecoder().decode(bytes.subarray(0, length)); return true; },
      async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); },
    },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as Parameters<CommandDefinition["execute"]>[0]);
  return { ...result, stdout, stderr, charges };
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("count cache distinguishes middle bytes and filesystem tenants", async () => {
  const command = createRgCommand();
  for (const content of ["a_foo_z\n".repeat(10), "a_bar_z\n".repeat(3)]) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", bytes(content));
    for (const pattern of ["a_foo_z", "a_bar_z", "a_foo_z"]) {
      const result = await run(command, fs, ["-c", pattern, "/dir"]);
      const matches = content.includes(pattern);
      assert.equal(result.exitCode, matches ? 0 : 1, result.stderr);
      assert.equal(result.stdout, matches ? `/dir/file:${content.split("\n").length - 1}\n` : "");
    }
  }
});

for (const [first, second] of [["FOO_1_BAR", "FOO_2_BAR"], ["alpha", "axxxa"], ["v1.0.0", "v2.0.0"], ["aXXb", "aYYb"], ["user_1_id", "user_2_id"]] as const) {
  for (const flags of [["-c"], ["-F", "-c"]]) {
    test(`repeated ${flags.join(" ")} counts distinguish ${first} and ${second}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/work");
      await fs.writeFile("/work/data.txt", bytes(`${first}\n`.repeat(3)));
      const command = createRgCommand();
      for (const pattern of [first, second, second, first]) {
        const result = await run(command, fs, [...flags, pattern, "/work"]);
        assert.equal(result.exitCode, pattern === first ? 0 : 1);
        assert.equal(result.stdout, pattern === first ? "/work/data.txt:3\n" : "");
        assert.equal(result.stderr, "");
      }
      await fs.writeFile("/work/data.txt", bytes(`${first}\n${first}\n${second}\n`));
      for (const pattern of [second, first, second]) {
        const result = await run(command, fs, [...flags, pattern, "/work"]);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `/work/data.txt:${pattern === first ? 2 : 1}\n`);
        assert.equal(result.stderr, "");
      }
    });
  }
}

test("directory counts distinguish cat and cut across repeated searches", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/a.txt", bytes("cat\ncat\n"));
  await fs.writeFile("/work/b.txt", bytes("dog\n"));
  const command = createRgCommand();
  for (const pattern of ["cat", "cut", "cut", "cat"]) {
    const result = await run(command, fs, ["-c", pattern, "/work"]);
    assert.equal(result.exitCode, pattern === "cat" ? 0 : 1);
    assert.equal(result.stdout, pattern === "cat" ? "/work/a.txt:2\n" : "");
    assert.equal(result.stderr, "");
  }

  await fs.writeFile("/work/a.txt", bytes("cat\ncat\ncut\n"));
  for (const pattern of ["cat", "cut", "cat"]) {
    const result = await run(command, fs, ["-c", pattern, "/work"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `/work/a.txt:${pattern === "cat" ? 2 : 1}\n`);
    assert.equal(result.stderr, "");
  }
});

test("repeated 64-file counts honor maxFiles and charge reads", async () => {
  const fs = createMemoryFileSystem();
  for (let d = 0; d < 8; d++) {
    await fs.mkdir(`/src/d${d}`, { recursive: true });
    for (let f = 0; f < 8; f++) await fs.writeFile(`/src/d${d}/f${f}`, bytes("needle\n"));
  }
  const command = createRgCommand();
  const first = await run(command, fs, ["-c", "needle", "/src"]);
  assert.equal(first.exitCode, 0, first.stderr);
  const limited = await run(createRgCommand({ maxFiles: 1 }), fs, ["-c", "needle", "/src"]);
  assert.notEqual(limited.exitCode, 0, "cached tree must still enforce maxFiles");
  for (let i = 0; i < 2; i++) {
    const result = await run(command, fs, ["-c", "needle", "/src"]);
    assert.equal(result.stdout, first.stdout);
    assert.ok(result.charges >= 64, `expected read charges, got ${result.charges}`);
  }
});


test("each invocation scans its input instead of replaying process-wide counts", async t => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/file", bytes("needle\n".repeat(10)));
  const command = createRgCommand();
  const indexOf = Uint8Array.prototype.indexOf;
  let scannedLines = 0;
  t.mock.method(Uint8Array.prototype, "indexOf", function (this: Uint8Array, value: number, offset?: number) {
    if (value === 10 && this.length === 70) scannedLines++;
    return indexOf.call(this, value, offset);
  });
  for (let invocation = 0; invocation < 3; invocation++) {
    scannedLines = 0;
    const result = await run(command, fs, ["-c", "needle", "/dir"]);
    assert.equal(result.stdout, "/dir/file:10\n");
    assert.ok(scannedLines >= 10, `invocation ${invocation} must scan its own records`);
  }
});

test("caller buffer reuse cannot transfer counts or binary classification between files", async () => {
  const command = createRgCommand();
  const fs = createMemoryFileSystem();
  const scratch = bytes("alpha_match\n");
  for (const directory of ["text", "other", "binary"]) await fs.mkdir(`/${directory}`);
  await fs.writeFile("/text/file", scratch);
  scratch.set(bytes("zzzzz_other\n"));
  await fs.writeFile("/other/file", scratch);
  scratch.set(bytes("alpha\0match\n"));
  await fs.writeFile("/binary/file", scratch);
  for (let repeat = 0; repeat < 3; repeat++) {
    const text = await run(command, fs, ["-c", "alpha", "/text"]);
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(text.stdout, "/text/file:1\n");
    for (const directory of ["other", "binary"]) {
      const result = await run(command, fs, ["-c", "alpha", `/${directory}`]);
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, "");
    }
    const binaryAsText = await run(command, fs, ["-a", "-c", "alpha", "/binary"]);
    assert.equal(binaryAsText.exitCode, 0, binaryAsText.stderr);
    assert.equal(binaryAsText.stdout, "/binary/file:1\n");
  }
});

for (const mode of ["sync", "async"] as const) {
  for (const code of ["EPIPE", "EIO"] as const) {
    test(`fast count flush handles ${mode} ${code} and releases its runner`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/file", bytes("needle\n"));
      const command = createRgCommand();
      const values = createCommandArguments(["-c", "needle", "/dir"]);
      const failure = Object.assign(new Error("sink failed"), { code });
      let syncWrites = 0, asyncWrites = 0, stderr = "";
      const context = {
        command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
        _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: {
          _scratch4k: new Uint8Array(4096),
          writeSync() { throw new Error("expected range write"); },
          writeRangeSync() {
            syncWrites++;
            if (mode === "sync") throw failure;
            return false;
          },
          async write() { asyncWrites++; throw failure; },
        },
        stderr: { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } },
      };
      // Repeat to verify that both exceptional flush paths release the pooled runner.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (code === "EPIPE") assert.deepEqual(await command.execute(context), { exitCode: 0 });
        else await assert.rejects(async () => command.execute(context), error => error === failure);
        assert.equal(syncWrites, attempt + 1);
        assert.equal(asyncWrites, mode === "async" ? attempt + 1 : 0);
        assert.equal(stderr, "");
        const next = await run(command, fs, ["-c", "needle", "/dir"]);
        assert.equal(next.exitCode, 0);
        assert.equal(next.stdout, "/dir/file:1\n");
      }
    });
  }
}

test("a delayed speculative match cannot resume a released pooled runner", async t => {
  clearRgFastRunnerPool();
  t.after(clearRgFastRunnerPool);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/file", bytes("needle\n"));
  const batchSync = Matcher.prototype.batchSync;
  const speculativeMatchers = new Set<Matcher>();
  let speculativeCalls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(Matcher.prototype, "batchSync", function (this: Matcher, rows: Parameters<Matcher["batchSync"]>[0]) {
    if (speculativeMatchers.size === 0) speculativeMatchers.add(this);
    if (speculativeMatchers.has(this)) {
      speculativeCalls++;
      if (speculativeCalls === 1) {
        const matches = batchSync.call(this, rows);
        return blocked.then(() => matches);
      }
    }
    return batchSync.call(this, rows);
  });
  try {
    // CRLF forces the literal matcher through the batch path in the pooled attempt.
    const result = await run(createRgCommand(), fs, ["-c", "--crlf", "needle", "/dir"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/dir/file:1\n");
    assert.equal(speculativeCalls, 1, "the suspended pooled attempt must fall back");
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(speculativeCalls, 1, "settling the discarded match must not resume its released runner");
  } finally {
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});
for (const pattern of ["secret", "sec.*ret"]) {
  test(`pooled matcher releases tenant pattern state: ${pattern}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", bytes("secret\n"));
    const matchers = new Set<Matcher>();
    const reset = Matcher.prototype.resetForRun;
    context.mock.method(Matcher.prototype, "resetForRun", function(this: Matcher, ...args: Parameters<typeof reset>) {
      if (args[4]) matchers.add(this);
      return reset.apply(this, args);
    });
    const result = await run(createRgCommand(), fs, ["-c", pattern, "/dir"]);
    assert.equal(result.stdout, "/dir/file:1\n");
    assert.ok(matchers.size > 0, "pooled matcher was exercised");
    for (const matcher of matchers) {
      const state = matcher as unknown as { vm: unknown; descriptor: { patterns: readonly string[] } };
      assert.equal(state.vm, undefined);
      assert.deepEqual(state.descriptor.patterns, []);
      assert.equal(matcher.literalAsciiBytes, undefined);
    }
  });
}
