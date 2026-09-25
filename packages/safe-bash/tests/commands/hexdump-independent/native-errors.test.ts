import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../hexdump/helpers.js";
import { nativeErrors } from "./native-errors.js";

for (const fixture of nativeErrors) test(`independent native missing argument: ${fixture.name}`, async () => {
  const result = await run([...fixture.args], Buffer.from(fixture.input, "hex"));
  assert.deepEqual(result, { exitCode: fixture.status, stdout: fixture.stdout, stderr: fixture.stderr });
});

test("hexdump exits 1 on unreadable file during streaming read", async () => {
  const { MemoryFileSystem } = await import("../../../src/fs/memory/index.js");
  const { Shell } = await import("../../../src/shell/index.js");
  const { agentCommands } = await import("../../../src/plugins/index.js");
  const vfs = new MemoryFileSystem();
  await vfs.writeFile("/secret", new TextEncoder().encode("hello"));
  await vfs.chmod("/secret", 0);
  const sh = new Shell({ fs: vfs, cwd: "/" }).use(agentCommands());
  try {
    const res = await sh.exec("hexdump -C /secret");
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /Permission denied/u);
  } finally { await sh.dispose(); }
});
