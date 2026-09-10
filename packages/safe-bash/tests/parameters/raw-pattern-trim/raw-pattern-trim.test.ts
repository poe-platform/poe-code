import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { cases } from "./cases.js";

for (const fixture of cases) test(`${["indexed", "members", "associative"].includes(fixture.name) ? "existing unsupported array trim profile" : "native raw trim"} ${fixture.locale} ${fixture.name}`, async () => {
  const filesystem = new MemoryFileSystem();
  const shell = new Shell({ fs: filesystem, env: { LC_ALL: fixture.locale } }).use(agentCommands());
  try {
    await filesystem.writeFile("/trim.sh", new TextEncoder().encode(fixture.script));
    const result = await shell.exec("sh /trim.sh");
    if (["indexed", "members", "associative"].includes(fixture.name)) {
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, /Unsupported indexed-array operator/u);
      return;
    }
    assert.equal(result.exitCode, fixture.status, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
    assert.equal(Buffer.from(result.stderrBytes).toString("hex"), fixture.stderrHex);
  } finally { await shell.dispose(); }
});

test("saved command-substitution suffix trim preserves the original getopt operand bytes", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/raw-second", Uint8Array.of(97, 39, 255, 92, 10));
  await filesystem.writeFile("/trim.sh", new TextEncoder().encode('raw=$(cat raw-second; printf .)\nraw=${raw%.}\nprintf "%s" "$raw"\n'));
  const shell = new Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("sh /trim.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(97, 39, 255, 92, 10));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("raw pattern fragments form one UTF-8 pattern after expansion", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C.UTF-8" } }).use(agentCommands());
  try {
    const result = await shell.exec('first=$\'\\303\'; second=$\'\\251\'; value=é; printf "<%s>" "${value#"$first$second"}"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<>");
  } finally { await shell.dispose(); }
});
