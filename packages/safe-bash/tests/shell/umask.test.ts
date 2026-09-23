import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

test("umask masks new files, directories and redirects without changing existing modes", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec("umask 077; touch file; mkdir dir; echo hi >redirect; echo hi >>append; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n");
  for (const path of ["/file", "/redirect", "/append"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/dir")).mode & 0o777, 0o700);
  await fs.chmod("/file", 0o644);
  await shell.exec("umask 077; echo changed >file");
  assert.equal((await fs.stat("/file")).mode & 0o777, 0o644);
});

test("umask is inherited by children and isolated between executions", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; (umask; umask 022); umask; sh -c 'umask'; echo \"$(umask)\"");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n0077\n0077\n0077\n");
  assert.equal((await shell.exec("umask")).stdout, "0022\n");
});

test("umask supports symbolic modes and reusable output, and rejects invalid input", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; umask -S; umask -p; umask u=rwx,g=rx,o=; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "u=rwx,g=,o=\numask 0077\n0027\n");
  assert.equal((await shell.exec("umask 088")).exitCode, 1);
  assert.equal((await shell.exec("umask 077; umask -pS")).stdout, "umask -S u=rwx,g=,o=\n");
});

test("umask reaches sequential-only redirect adapters and respects explicit mkdir modes", async () => {
  const fs = createMemoryFileSystem();
  const sequential = new Proxy(fs, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, open: false, randomAccessWrite: false };
      if (key === "capabilitiesFor" || key === "open") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs: sequential }).use(agentCommands());
  const result = await shell.exec("umask 077; echo hi >out; echo hi >>app; mkdir -m 755 explicit");
  assert.equal(result.stderr, "");
  assert.equal((await fs.stat("/out")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/app")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/explicit")).mode & 0o777, 0o755);
});

test("literal command invocation inherits the mask without affecting concurrent executions", async () => {
  const fs = createMemoryFileSystem();
  const commands = new CommandRegistry();
  commands.register({ name: "child", async execute(context) {
    return context.invoke!("sh", ["-c", "touch child-file; umask 022"]);
  } });
  const shell = new Shell({ fs, commands }).use(agentCommands());
  const results = await Promise.all([
    shell.exec("umask 077; child; touch private-file; umask"),
    shell.exec("umask 002; touch shared-file; umask"),
  ]);
  assert.deepEqual(results.map(result => result.stderr), ["", ""]);
  assert.deepEqual(results.map(result => result.stdout), ["0077\n", "0002\n"]);
  for (const path of ["/child-file", "/private-file"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/shared-file")).mode & 0o777, 0o664);
});
