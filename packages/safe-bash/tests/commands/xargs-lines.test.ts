import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { agentCommands } from "../../src/plugins/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

for (const option of ["--arg-file=input", "--arg-file input", "-a input", "-ainput"]) test(`xargs argument file ${option}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("a b\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec(`xargs ${option} printf '<%s>\\n'`, { stdin: "ignored" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<a>\n<b>\n");
  } finally { await shell.dispose(); }
});

for (const fixture of [
  { option: "--max-lines=1", stdin: "a b\nc d\n", stdout: "[a][b]\n[c][d]\n" },
  { option: "-L 1", stdin: "\na b\n\nc d\n", stdout: "[a][b]\n[c][d]\n" },
  { option: "-L1", stdin: "a \nb\nc d\n", stdout: "[a][b]\n[c][d]\n" },
  { option: "-L1", stdin: "'a b' c\nd e\n", stdout: "[a b][c]\n[d][e]\n" },
  { option: "-L1", stdin: "a\t\nb\nc d\n", stdout: "[a][b]\n[c][d]\n" },
  { option: "-L2", stdin: "a\nb\nc\nd", stdout: "[a][b]\n[c][d]\n" },
  { option: "-0 -L2", stdin: "a\0b\0c\0d\0", stdout: "[a][b]\n[c][d]\n" },
]) test(`xargs line batches ${JSON.stringify(fixture)}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`xargs ${fixture.option} printf '[%s][%s]\\n'`, { stdin: fixture.stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, fixture.stdout);
  } finally { await shell.dispose(); }
});

for (const args of ["-L0", "-L-1", "--max-lines=", "--max-lines=1.5", "--max-lines=9007199254740992", "--arg-file"]) test(`xargs rejects invalid option ${args}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try { assert.equal((await shell.exec(`xargs ${args}`)).exitCode, 2); }
  finally { await shell.dispose(); }
});

test("xargs argument file leaves stdin available to the child", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array());
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("xargs -ainput cat", { stdin: "child input" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "child input");
  } finally { await shell.dispose(); }
});

test("xargs missing argument file reports a read failure", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("xargs -amissing");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("missing"));
  } finally { await shell.dispose(); }
});

test("xargs refuses to split a line that exceeds its command size bound", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("xargs -L1 -s12 echo", { stdin: "aaaa bbbb\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});
