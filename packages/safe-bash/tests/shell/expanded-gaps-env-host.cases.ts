import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem } from "../../src/index.js";
for (const [header, expected] of [
  ["/usr/bin/env bash -e", [127, "", "env: bash -e: command not found\n"]],
  ["/usr/bin/env -S bash -e", [0, "forbidden", ""]],
  ["/usr/bin/env python", [127, "", "env: python: command not found\n"]],
  ["/usr/bin/env", null],
  ["/usr/bin/env bash\r", [127, "", "env: bash\\r: command not found\n"]],
] as const) test(`explicit env interpreter outcome ${JSON.stringify(header)}`, async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from(`#!${header}\nprintf forbidden`), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    if (expected === null) await assert.rejects(shell.exec("/script"), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
    else { const result = await shell.exec("/script"); assert.deepEqual([result.exitCode, result.stdout, result.stderr], expected); }
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["script"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/script")), Buffer.from(`#!${header}\nprintf forbidden`));
  }
  finally { await shell.dispose(); }
});
test("env shebang refuses a registry override rather than silently bypassing it", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\nprintf forbidden"), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  shell.register({ name: "bash", execute() { return { exitCode: 37 }; } });
  try { assert.equal((await shell.exec("bash")).exitCode, 37); const result = await shell.exec("/script"); assert.equal(result.exitCode, 126); assert.match(result.stderr, /unsupported interpreter override/u); }
  finally { await shell.dispose(); }
});
