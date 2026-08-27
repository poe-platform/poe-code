import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem } from "../../src/index.js";
for (const [name, bytes, mode, status] of [
  ["nonexecutable", Buffer.from("printf bad"), 0o644, 126],
  ["binary", Buffer.from([0, 255]), 0o755, 126],
  ["invalid-utf8", Buffer.from([255]), 0o755, 126],
] as const) test(`fallback safety ${name}`, async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", bytes, { mode });
  const shell = new Shell({ fs }).use(agentCommands());
  try { const result = await shell.exec("/script"); assert.equal(result.exitCode, status); assert.equal(result.stdout, ""); }
  finally { await shell.dispose(); }
});
test("fallback prevalidates syntax before file effects", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from("printf bad > /effect\nif"), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  try { assert.equal((await shell.exec("/script")).exitCode, 2); await assert.rejects(fs.stat("/effect"), { code: "ENOENT" }); }
  finally { await shell.dispose(); }
});
test("fallback symlinks preserve argv and parent cursor", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from("cat"), { mode: 0o755 }); await fs.symlink("/script", "/link");
  const shell = new Shell({ fs }).use(agentCommands());
  try { const result = await shell.exec("read -r prefix; /link", { stdin: Uint8Array.from([97, 10, 0, 255]) }); assert.deepEqual(result.stdoutBytes, Uint8Array.from([0, 255])); }
  finally { await shell.dispose(); }
});
test("fallback shares recursive depth budget", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from("/script"), { mode: 0o755 });
  const shell = new Shell({ fs });
  try { await assert.rejects(shell.exec("/script", { limits: { maxSubstitutionDepth: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth"); }
  finally { await shell.dispose(); }
});
