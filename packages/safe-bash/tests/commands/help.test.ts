import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/core.js";

for (const [command, option] of [["cat", "--number"], ["grep", "--regexp"], ["rg", "--glob"], ["tar", "--files-from"]]) {
  test(`${command} --help succeeds without accessing input files`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const stdin = (async function* () {
        assert.fail("help must not consume standard input");
        yield new Uint8Array();
      })();
      for (const args of ["--help", "--help /missing"]) {
        const result = await shell.exec(`${command} ${args}`, { stdin });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.ok(result.stdout.startsWith(`Usage: ${command} `), result.stdout);
        assert.ok(result.stdout.includes(option!), result.stdout);
        assert.ok(result.stdout.includes("--help"), result.stdout);
      }
    } finally { await shell.dispose(); }
  });
}

test("help remains a literal filename or pattern when passed as an operand", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/--help", new TextEncoder().encode("--help\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const command of ["cat -- --help", "grep -e --help -- --help", "rg -F -e --help -- --help"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "--help\n");
    }
    assert.equal((await shell.exec("tar cf /archive -- --help")).exitCode, 0);
    assert.equal((await shell.exec("tar tf /archive")).stdout, "--help\n");
  } finally { await shell.dispose(); }
});

test("help rejects attached values", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    for (const command of ["cat", "grep", "rg", "tar"]) {
      const result = await shell.exec(`${command} --help=yes`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
    }
  } finally { await shell.dispose(); }
});
