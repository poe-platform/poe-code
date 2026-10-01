import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
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
