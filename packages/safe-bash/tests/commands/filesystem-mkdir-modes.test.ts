import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const [mode, expected] of [["u=rwx,go=rx", 0o755], ["a=rx", 0o555], ["+t", 0o1755], ["g=u", 0o775], ["a+X", 0o755], ["700", 0o700]] as const) {
  test(`mkdir -m ${mode} creates the requested directory mode`, async () => {
    const fs = await fixture();
    const result = await run("mkdir", ["-p", "-m", mode, "parent/child"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/parent/child")).mode & 0o7777, expected);
  });
}

test("mkdir symbolic modes use the shell's current umask and preserve parent modes", async context => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("umask 077; mkdir -p -m +t parent/child; mkdir -m u+rwx user; mkdir -m a=rx readonly");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/parent")).mode & 0o7777, 0o700);
  assert.equal((await fs.stat("/work/parent/child")).mode & 0o7777, 0o1700);
  assert.equal((await fs.stat("/work/user")).mode & 0o7777, 0o700);
  assert.equal((await fs.stat("/work/readonly")).mode & 0o7777, 0o555);
});
