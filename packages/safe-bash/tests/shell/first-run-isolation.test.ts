import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

import { searchCommands } from "../../src/commands/search/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("first mkdir -p preserves existing descendants", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/app/nested", { recursive: true });
  await fs.writeFile("/app/nested/secret", encoder.encode("keep me"));
  const shell = new Shell({ fs }).use(standardCommands()).use(searchCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mkdir -p /app");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(decoder.decode(await fs.readFile("/app/nested/secret")), "keep me");
});

test("first rm -rf neither creates parents nor repeats filesystem charges", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxFileSystemOperations: 1 } }).use(standardCommands()).use(searchCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("rm -rf /ghost_parent/sub/target");
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(fs.stat("/ghost_parent"), { code: "ENOENT" });
});

for (const destination of ["/dev/stderr", "/out.txt"]) {
  test(`first AWK redirects exactly once to ${destination}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.txt", encoder.encode("a:b:c\n"));
    const shell = new Shell({ fs }).use(standardCommands()).use(textProgramCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk -F: '{ print $2 >> "${destination}" }' /data.txt`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(destination === "/dev/stderr" ? result.stderr : decoder.decode(await fs.readFile(destination)), "b\n");
  });
}

test("AWK ARGV mutations and retained accounting stay within each invocation", async context => {
  const first = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  const second = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  context.after(async () => { await first.dispose(); await second.dispose(); });
  const dirty = await first.exec(`awk 'BEGIN { ARGV[0]="tenant secret"; ARGV["leaked"]="private"; delete ARGV[1] }' argument`);
  assert.equal(dirty.exitCode, 0, dirty.stderr);
  for (const shell of [second, first, second]) {
    const result = await shell.exec(`awk 'BEGIN { print ARGV[0], ARGV["leaked"]; delete ARGV["leaked"]; delete ARGV[1] }' argument`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "awk \n");
  }
});

test("first substitution loop has the same output budget as subsequent runs", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 50 } }).use(standardCommands()).use(searchCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 2; run++) {
    const result = await shell.exec("for i in {1..10}; do x=$(echo $((i + 1))); done; echo $x");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "11\n");
  }
});

test("equal output results own their bytes across shells and runs", async context => {
  const first = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(searchCommands());
  const second = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(searchCommands());
  context.after(async () => { await first.dispose(); await second.dispose(); });
  const original = await first.exec("echo HELLO");
  original.stdoutBytes[0] = 88;
  for (const shell of [second, first]) {
    const result = await shell.exec("echo HELLO");
    assert.notEqual(result, original);
    assert.equal(decoder.decode(result.stdoutBytes), "HELLO\n");
  }
});

test("RG fallback preserves capture bytes beyond 64 KiB", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/files");
  // Enough filenames to overflow speculative output and force a slow retry.
  const names = Array.from({ length: 400 }, (_, index) => `${String(index).padStart(3, "0")}-${"a".repeat(180)}`);
  for (const name of names) await fs.writeFile(`/files/${name}`, encoder.encode("hit\n"));
  const prefix = "prefix".repeat(12000);
  await fs.writeFile("/prefix", encoder.encode(prefix));
  const shell = new Shell({ fs }).use(standardCommands()).use(searchCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("cat /prefix; rg --files /files");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, prefix + names.map(name => `/files/${name}\n`).join(""));
  assert.deepEqual(result.stdoutBytes, encoder.encode(result.stdout));
});

test("RG pattern admission works without global Buffer", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data", encoder.encode("hello\n"));
  const shell = new Shell({ fs }).use(standardCommands()).use(searchCommands());
  context.after(() => shell.dispose());
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const result = await shell.exec("rg -l hello /data");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/data\n");
  } finally { globalThis.Buffer = original; }
});
