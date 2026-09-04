import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname } from "node:path";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { shufCommands } from "../../../src/commands/shuf/index.js";

const workflows = [
  "shuf --random-source=/dev/zero -e alpha beta gamma",
  "printf 'alpha\\nbeta\\ngamma\\ndelta\\n' | shuf --random-source=/dev/zero -n 3",
  "printf 'alpha\\0beta\\0gamma\\0' | shuf --random-source=/dev/zero -z -n 2",
  "shuf --random-source=/dev/zero -i 9007199254740993-9007199254741000 -n 4",
  "shuf --random-source=/dev/zero -r -n 7 -e '' alpha beta",
  "set -o pipefail; shuf --random-source=/dev/zero -r -e alpha beta | head -n 3; printf 'status:%s\\n' \"${PIPESTATUS[@]}\"",
  "shuf --random-source=/dev/zero -n 0 /missing; printf 'status:%s\\n' \"$?\"",
  "shuf --random-source=/dev/zero --unknown; printf 'status:%s\\n' \"$?\"",
];

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/zero", new Uint8Array(32768));
  return new Shell({ fs }).use(agentCommands()).use(shufCommands());
}

test("shuf is opt-in and a VFS script safely replaces its input file", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    assert.equal((await shell.exec("command -v shuf")).exitCode, 1);
    shell.use(shufCommands());
    await fs.mkdir("/dev");
    await fs.writeFile("/dev/zero", new Uint8Array(32768));
    await fs.writeFile("/records", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
    await fs.writeFile("/job.sh", new TextEncoder().encode("shuf --random-source=/dev/zero -n 2 -o /records /records\ncat /records\n"));
    const result = await shell.exec("sh /job.sh");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "alpha\nbeta\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/records")), result.stdout);
  } finally {
    await shell.dispose();
  }
});

test("independent seeded GNU shuf shell workflows match bytes, diagnostics and statuses", async context => {
  const binary = process.env.SAFE_BASH_TEST_SHUF;
  if (binary === undefined) {
    context.skip("Requires SAFE_BASH_TEST_SHUF pointing to GNU coreutils 9.7 shuf");
    return;
  }
  assert.notEqual(binary, "", "SAFE_BASH_TEST_SHUF must name an oracle executable");
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 2000 });
  assert.ifError(version.error);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.split("\n")[0], "shuf (GNU coreutils) 9.7");
  for (const source of workflows) {
    const native: SpawnSyncReturns<Buffer> = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], {
      env: { PATH: `${dirname(binary)}:/usr/bin:/bin`, LC_ALL: "C", TZ: "UTC" },
      timeout: 2000,
      maxBuffer: 128 * 1024,
    });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    const shell = await fixture();
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
