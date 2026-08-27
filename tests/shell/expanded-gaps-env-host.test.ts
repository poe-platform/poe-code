import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
for (const header of ["/usr/bin/env bash -e", "/usr/bin/env -S bash -e", "/usr/bin/env python", "/usr/bin/env", "/usr/bin/env bash\r"]) test(`explicit unsupported env interpreter ${JSON.stringify(header)}`, async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from(`#!${header}\nprintf forbidden`), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  try { const result = await shell.exec("/script"); assert.equal(result.exitCode, 126); assert.equal(result.stdout, ""); assert.match(result.stderr, /unsupported interpreter/u); }
  finally { await shell.dispose(); }
});
test("env shebang refuses a registry override rather than silently bypassing it", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\nprintf forbidden"), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  shell.register({ name: "bash", execute() { return { exitCode: 37 }; } });
  try { assert.equal((await shell.exec("bash")).exitCode, 37); const result = await shell.exec("/script"); assert.equal(result.exitCode, 126); assert.match(result.stderr, /unsupported interpreter override/u); }
  finally { await shell.dispose(); }
});
