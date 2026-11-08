import assert from "node:assert/strict";
import test from "node:test";
import { settings as archive } from "../../src/commands/archive/internal.js";
import { settings as split } from "safe-bash-command-split/options";
import { settings as hexdump } from "safe-bash-command-hexdump/internal";
import { settings as lineEndings } from "safe-bash-line-ending-engine/internal";
import { settings as iconv } from "safe-bash-command-iconv/internal";
import { settings as applyPatch } from "safe-bash-command-apply-patch/options";
import { limitsFor as cmp } from "safe-bash-command-cmp/options";
import { settings as shuf } from "safe-bash-command-shuf/options";

for (const [family, resolve] of [
  ["archive", archive], ["split", split], ["hexdump", hexdump],
  ["line-endings", lineEndings], ["iconv", iconv], ["apply-patch", applyPatch], ["cmp", cmp],
] as const) {
  test(`${family}: quotas retain documented defaults and explicit quotas are independent`, () => {
    const omitted = resolve({});
    for (const [name, value] of Object.entries(omitted)) {
      if (name === "chunkSize" || name === "maxChunkBytes") continue;
      assert.equal(value, Infinity, name);
      for (const maximum of [64, Number.MAX_SAFE_INTEGER]) {
        const limited = resolve({ limits: { [name]: maximum } });
        assert.equal(Reflect.get(limited, name), maximum);
        for (const [other, budget] of Object.entries(limited)) {
          if (other !== name) assert.equal(budget, Reflect.get(omitted, other), other);
        }
      }
      assert.equal(Reflect.get(resolve({ limits: { [name]: Infinity } }), name), Infinity);
      for (const invalid of [0, -1, NaN, -Infinity, 1.5]) {
        assert.throws(() => resolve({ limits: { [name]: invalid } }));
      }
    }
  });
}

test("shuf: sample and input quotas are independent", () => {
  assert.deepEqual(shuf({}), { maxInputBytes: Infinity, maxSampleSize: Infinity });
  assert.deepEqual(shuf({ maxSampleSize: 2 }), { maxInputBytes: Infinity, maxSampleSize: 2 });
  assert.deepEqual(shuf({ maxInputBytes: Number.MAX_SAFE_INTEGER }), { maxInputBytes: Number.MAX_SAFE_INTEGER, maxSampleSize: Infinity });
  assert.deepEqual(shuf({ maxInputBytes: Infinity }), { maxInputBytes: Infinity, maxSampleSize: Infinity });
});

import { createArchiveCommands } from "../../src/commands/archive/index.js";
import { createSplitCommands } from "../../src/commands/split/index.js";
import { createIconvCommand } from "../../src/commands/iconv/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandDefinition } from "../../src/contracts/index.js";

async function execute(command: CommandDefinition, args: string[], input = "", fallback = false) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from(input));
  const fs = fallback ? new Proxy(memory, { get(target, key) {
    if (key === "readStream") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) : memory;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await command.execute({ command: command.name, args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Uint8Array.from(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(), fs: memory };
}

test("archive retained reads avoid buffering with an independent member limit", async () => {
  const input = "a".repeat(1024 * 1024 + 1);
  for (const limits of [undefined, { maxMembers: 8 }]) {
    const command = createArchiveCommands(limits ? { limits } : {}).find(command => command.name === "tar")!;
    const result = await execute(command, ["-cf", "/result.tar", "input"], input, true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok((await result.fs.stat("/result.tar")).size > input.length);
  }
  const command = createArchiveCommands({ limits: { maxBufferedFileBytes: 1024 * 1024 } }).find(command => command.name === "tar")!;
  const result = await execute(command, ["-cf", "/result.tar", "input"], input, true);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok((await result.fs.stat("/result.tar")).size > input.length);
  const limited = createArchiveCommands({ limits: { maxEntryBytes: 1024 * 1024 } }).find(command => command.name === "tar")!;
  assert.equal((await execute(limited, ["-cf", "/result.tar", "input"], input, true)).exitCode, 2);
});

test("split permits suffixes beyond the old quota and honors an explicit suffix limit", async () => {
  const result = await execute(createSplitCommands()[0]!, ["-a", "129", "-b", "1", "-", "part"], "a");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await result.fs.readdir("/")).some(name => name.name.length === 133), true);
  const limited = await execute(createSplitCommands({ limits: { maxSuffixLength: 128 } })[0]!, ["-a", "129", "-b", "1"], "a");
  assert.equal(limited.exitCode, 1);
});

test("iconv fallback reads preserve omitted and explicit input limits", async () => {
  for (const limits of [undefined, { maxOutputBytes: 64 }]) {
    const result = await execute(createIconvCommand(limits ? { limits } : {}), ["-f", "UTF-8", "-t", "UTF-8", "/input"], "abc", true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "abc");
  }
  const result = await execute(createIconvCommand({ limits: { maxInputBytes: 2 } }), ["-f", "UTF-8", "-t", "UTF-8", "/input"], "abc", true);
  assert.equal(result.exitCode, 1);
});

import { createShufCommand } from "../../src/commands/shuf/index.js";
import { createHexdumpCommand } from "../../src/commands/hexdump/index.js";
import { createDos2unixCommand } from "../../src/commands/line-endings/index.js";

test("shuf range mode accepts omitted sample quota and enforces an individual sample quota", async () => {
  const result = await execute(createShufCommand(), ["-i", "1-1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n");
  const limited = await execute(createShufCommand({ maxSampleSize: 1 }), ["-i", "1-2"]);
  assert.equal(limited.exitCode, 1);
  assert.match(limited.stderr, /maxSampleSize/);
});

for (const [family, create, args, expected] of [
  ["hexdump", createHexdumpCommand, ["-C", "/input"], "00000000"],
  ["line endings", createDos2unixCommand, ["-O", "/input"], "abc\n"],
] as const) {
  test(`${family}: fallback buffer accounting supports unlimited quotas`, async () => {
    const result = await execute(create(), [...args], "abc\r\n", true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(expected));
  });
}


import { Shell } from "../../src/shell/shell.js";
import { archiveCommands } from "../../src/commands/archive/index.js";

test("shell input budget covers archive source files and cumulative creation inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array(8).fill(65));
  await fs.writeFile("/b", new Uint8Array(8).fill(66));
  const producer = new Shell({ fs, cwd: "/" }).use(archiveCommands());
  assert.equal((await producer.exec("tar -cf input.tar a")).exitCode, 0);
  assert.equal((await producer.exec("zip -q input.zip a")).exitCode, 0);
  await producer.dispose();
  const shell = new Shell({ fs, cwd: "/", limits: { maxInputBytes: 8 } }).use(archiveCommands());
  try {
    for (const command of ["tar -cf - a", "zip -q - a"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    for (const command of ["tar -cf result.tar a b", "zip -q result.zip a b", "tar -tf input.tar", "unzip -l input.zip"]) {
      await assert.rejects(shell.exec(command), { name: "ShellLimitError", limit: "maxInputBytes" });
    }
    const tar = await fs.readFile("/input.tar");
    const zip = await fs.readFile("/input.zip");
    assert.equal((await shell.exec("tar -tf input.tar", { limits: { maxInputBytes: tar.length } })).exitCode, 0);
    assert.equal((await shell.exec("tar -tf -", { stdin: tar, limits: { maxInputBytes: tar.length } })).exitCode, 0);
    await assert.rejects(shell.exec("tar -tf -", { stdin: tar, limits: { maxInputBytes: tar.length - 1 } }), { name: "ShellLimitError", limit: "maxInputBytes" });
    assert.equal((await shell.exec("unzip -l input.zip", { limits: { maxInputBytes: zip.length } })).exitCode, 0);
    const extracted = await shell.exec("unzip -p input.zip a", { limits: { maxInputBytes: zip.length } });
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.equal(extracted.stdout, "AAAAAAAA");
    assert.equal((await shell.exec("unzip -l -", { stdin: zip, limits: { maxInputBytes: zip.length } })).exitCode, 0);
    await assert.rejects(shell.exec("unzip -l -", { stdin: zip, limits: { maxInputBytes: zip.length - 1 } }), { name: "ShellLimitError", limit: "maxInputBytes" });
    assert.equal((await shell.exec("zip -q - -", { stdin: new Uint8Array(8) })).exitCode, 0);
    await assert.rejects(shell.exec("zip -q - -", { stdin: new Uint8Array(9) }), { name: "ShellLimitError", limit: "maxInputBytes" });
    assert.deepEqual(await fs.readFile("/a"), new Uint8Array(8).fill(65));
    assert.deepEqual(await fs.readFile("/b"), new Uint8Array(8).fill(66));
    await assert.rejects(fs.stat("/result.zip"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});
