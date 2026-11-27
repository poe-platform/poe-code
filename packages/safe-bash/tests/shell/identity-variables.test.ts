import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

const preamble = '[ "$EUID" -ne 0 ] && echo notroot; echo "st=$?"; case "$OSTYPE" in linux*) echo linux;; *) echo "other[$OSTYPE]";; esac; echo "[$UID][$PPID][$SHLVL]" | tr 0-9 N; [ "$UID" = "$(id -u)" ] && echo same';

for (const uid of [undefined, "0"]) {
  test(`identity preamble with ${uid === undefined ? "default" : "root"} user`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work", ...(uid === undefined ? {} : { env: { UID: uid } }) }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(preamble);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, uid === undefined ? "notroot\nst=0\nlinux\n[NNNN][N][N]\nsame\n" : "st=1\nlinux\n[N][N][N]\nsame\n");
  });
}

test("shell identity matches the virtual commands", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('printf "%s\\n" "$UID:$EUID:$PPID:$OSTYPE:$HOSTTYPE:$MACHTYPE:$HOSTNAME:$SHLVL"; [ "$UID" = "$(id -ru)" ] && [ "$EUID" = "$(id -u)" ] && [ "$HOSTTYPE" = "$(uname -m)" ] && [ "$HOSTNAME" = "$(hostname)" ]');
  assert.equal(result.stdout, "1000:1000:0:linux-gnu:x86_64:x86_64-pc-linux-gnu:sandbox:1\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("shell level increments in child shells but not subshells", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { SHLVL: "3", UID: "42", HOSTNAME: "tenant" } }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('echo "$SHLVL"; (echo "$SHLVL"); echo "$(echo "$SHLVL")"; bash -c \'echo "$SHLVL:$UID:$EUID:$HOSTNAME:$PPID"\'');
  assert.equal(result.stdout, "4\n4\n4\n5:42:42:tenant:1\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("reused shell execution restores identity defaults", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 3; run++) {
    const result = await shell.exec('echo "$UID:$EUID:$PPID:$OSTYPE:$HOSTTYPE:$MACHTYPE:$HOSTNAME:$SHLVL"; HOSTNAME=changed; SHLVL=99');
    assert.equal(result.stdout, "1000:1000:0:linux-gnu:x86_64:x86_64-pc-linux-gnu:sandbox:1\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  }
});
