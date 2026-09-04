import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname } from "node:path";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { yesCommands } from "../../../src/commands/yes/index.js";

const pipelines = [
  "yes | head -n 3; printf 'status:%s\\n' \"${PIPESTATUS[@]}\"",
  "set -o pipefail; yes hello world | head -c 19; printf '\\nstatus:%s\\n' \"${PIPESTATUS[@]}\"",
  "yes '' '' | head -c 7; printf '\\nstatus:%s\\n' \"${PIPESTATUS[@]}\"",
  "yes -- --help | head -n 2; printf 'status:%s\\n' \"${PIPESTATUS[@]}\"",
  "yes | head -c 0; printf 'status:%s\\n' \"${PIPESTATUS[@]}\"",
  "yes -n | cat; printf 'status:%s\\n' \"${PIPESTATUS[@]}\"",
];

test("yes remains absent until explicitly installed on the shell", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    assert.equal((await shell.exec("command -v yes")).exitCode, 1);
    shell.use(yesCommands());
    const result = await shell.exec("yes ready | head -n 2");
    assert.equal(result.stdout, "ready\nready\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("a VFS script can consume yes and continue after its producer closes", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/job.sh", new TextEncoder().encode("yes item | head -n 2 > /work/items\ncat /work/items\nprintf done\\\\n\n"));
  const shell = new Shell({ fs }).use(agentCommands()).use(yesCommands());
  try {
    const result = await shell.exec("sh /work/job.sh");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "item\nitem\ndone\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/items")), "item\nitem\n");
  } finally {
    await shell.dispose();
  }
});

test("independent GNU yes shell comparisons preserve bytes, diagnostics and pipeline statuses", async context => {
  const binary = process.env.SAFE_BASH_YES_GNU_ORACLE;
  if (!binary) {
    context.skip("Requires SAFE_BASH_YES_GNU_ORACLE pointing to GNU coreutils 9.7 yes");
    return;
  }
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 2000 });
  assert.ifError(version.error);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.split("\n")[0], "yes (GNU coreutils) 9.7");
  for (const source of pipelines) {
    const native: SpawnSyncReturns<Buffer> = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], {
      env: { PATH: `${dirname(binary)}:/usr/bin:/bin`, LC_ALL: "C", TZ: "UTC" },
      timeout: 2000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(yesCommands());
    try {
      const virtual = await shell.exec(source);
      assert.equal(virtual.exitCode, native.status, source);
      assert.deepEqual(Buffer.from(virtual.stdoutBytes), native.stdout, source);
      assert.deepEqual(Buffer.from(virtual.stderrBytes), native.stderr, source);
    } finally {
      await shell.dispose();
    }
  }
});
