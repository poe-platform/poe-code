import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, OverlayFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { createApplyPatchCommands } from "safe-bash-command-apply-patch";
import { createSplitCommands } from "safe-bash-command-split";
import { createCsplitCommands } from "safe-bash-command-csplit";
import { createDos2unixCommands } from "safe-bash-command-dos2unix";
import { createXanCommands } from "safe-bash-command-xan";
import { docxCommands } from "../../src/commands/docx/index.js";
import { pptxCommands } from "../../src/commands/pptx/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const patchInput = "*** Begin Patch\n*** Update File: /patch.txt\n@@\n-old\n+new\n*** Add File: /added.txt\n+added\n*** End Patch\n";

test("apply_patch updates retained-staging memory files without global Buffer", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/patch.txt", encoder.encode("old\n"));
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createApplyPatchCommands()) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    const result = await shell.exec("apply_patch", { stdin: patchInput });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(decoder.decode(await fs.readFile("/patch.txt")), "new\n");
    assert.equal(decoder.decode(await fs.readFile("/added.txt")), "added\n");
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["added.txt", "patch.txt"]);
    assert.equal(globalThis.Buffer, undefined);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});

for (const keepDate of [false, true]) test(`file commands preserve lower files on an overlay without global Buffer (keepDate=${keepDate})`, async () => {
  const lower = new MemoryFileSystem();
  const originals = { "/patch.txt": "old\n", "/lines.txt": "one\n---\ntwo\n", "/dos.txt": "one\r\ntwo\r\n", "/unix.txt": "one\ntwo\n" };
  for (const [path, text] of Object.entries(originals)) await lower.writeFile(path, encoder.encode(text));
  const upper = new MemoryFileSystem();
  const fs = new OverlayFileSystem({ lower, upper });
  const originalEntries = await lower.readdir("/");
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry([
    ...createApplyPatchCommands(), ...createSplitCommands(), ...createCsplitCommands(), ...createDos2unixCommands(),
  ]) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    // Overlay publication cannot preserve existing identity through staged writes.
    const patch = await shell.exec("apply_patch", { stdin: patchInput });
    assert.equal(patch.exitCode, 1);
    assert.equal(patch.stdout, "");
    assert.equal(patch.stderr, "apply_patch: filesystem does not support atomic conditional patch mutations\n");
    assert.deepEqual(await fs.readdir("/"), originalEntries);
    assert.deepEqual(await lower.readdir("/"), originalEntries);
    assert.deepEqual(await upper.readdir("/"), []);
    for (const [path, text] of Object.entries(originals)) {
      assert.deepEqual(await fs.readFile(path), encoder.encode(text), path);
      assert.deepEqual(await lower.readFile(path), encoder.encode(text), path);
    }
    for (const [script, stdin] of [
      ["split -l 1 /lines.txt /split_", ""],
      ["csplit /lines.txt '/---/'", ""],
      [`dos2unix ${keepDate ? "-k " : ""}/dos.txt`, ""],
      [`unix2dos ${keepDate ? "-k " : ""}/unix.txt`, ""],
    ] as const) {
      const result = await shell.exec(script, { stdin });
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    }
    for (const [path, text] of Object.entries({
      "/patch.txt": "old\n", "/split_aa": "one\n", "/split_ab": "---\n", "/split_ac": "two\n",
      "/xx00": "one\n", "/xx01": "---\ntwo\n", "/dos.txt": "one\ntwo\n", "/unix.txt": "one\r\ntwo\r\n",
    })) assert.equal(decoder.decode(await fs.readFile(path)), text, path);
    for (const [path, text] of Object.entries(originals)) assert.equal(decoder.decode(await lower.readFile(path)), text, path);
    assert.ok((await fs.readdir("/")).every(entry => !entry.name.startsWith(".line-ending-")));
    assert.equal(globalThis.Buffer, undefined);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});

test("xan reports usage and missing-file diagnostics without global Buffer", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/", commands: new CommandRegistry(createXanCommands()) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    for (const [script, diagnostic] of [
      ["xan count /missing.csv", "/missing.csv"],
      ["xan --invalid", "expected a CSV subcommand (use xan --help)"],
    ] as const) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(diagnostic), result.stderr);
      assert.ok(!result.stderr.includes("internal error"), result.stderr);
    }
    assert.equal(globalThis.Buffer, undefined);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});

test("zero-argument document plugins execute their default engines", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/", commands: new CommandRegistry() })
    .use(docxCommands()).use(pptxCommands());
  try {
    for (const name of ["docx", "pptx"]) {
      const result = await shell.exec(`${name} --help`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes(name), result.stdout);
    }
  } finally { await shell.dispose(); }
});
