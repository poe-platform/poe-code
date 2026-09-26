import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const name of ["grep", "rg", "jq", "sed", "awk", "find", "tar", "gzip", "which"]) {
  test(`registered ${name} has discoverable executable paths`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    assert.equal((await shell.exec(`type -t ${name}`)).stdout, "file\n");
    assert.equal((await shell.exec(`command -v ${name}`)).stdout, `${name}\n`);
    for (const source of [`which ${name}`, `type -p ${name}`, `type -P ${name}`, `PATH=/bin:/usr/bin which ${name}`]) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, source);
      assert.equal(result.stdout, `/bin/${name}\n`, source);
      assert.equal(result.stderr, "", source);
    }
  });
}

test("registered command lookup respects PATH, all, quiet and shadowing", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tools");
  await fs.writeFile("/tools/grep", new TextEncoder().encode("echo file"), { mode: 0o755 });
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  for (const source of ["PATH=/tools:/bin which -a grep", "PATH=/tools:/bin type -aP grep"]) {
    assert.equal((await shell.exec(source)).stdout, "/tools/grep\n/bin/grep\n");
  }
  for (const source of ["PATH=/tools which jq", "PATH= which jq", "PATH=/tools type -P jq"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1, source);
    assert.equal(result.stdout, "", source);
  }
  assert.equal((await shell.exec("PATH=/usr/bin which jq")).stdout, "/usr/bin/jq\n");
  assert.equal((await shell.exec("PATH=/bin/ which jq")).stdout, "/bin//jq\n");
  assert.equal((await shell.exec("PATH=/bin/ type -P jq")).stdout, "/bin/jq\n");
  assert.equal((await shell.exec("which -s jq")).stdout, "");
  assert.equal((await shell.exec("which -s missing-command")).exitCode, 1);
  assert.equal((await shell.exec("which /bin/jq /usr/bin/jq")).stdout, "/bin/jq\n/usr/bin/jq\n");
  assert.equal((await shell.exec("(unset PATH; which jq)")).exitCode, 1);
  assert.equal((await shell.exec("sh -c 'unset PATH; which jq'")).exitCode, 1);
  assert.equal((await shell.exec("grep() { :; }; type -p grep")).stdout, "");
  assert.equal((await shell.exec("grep() { :; }; type -P grep")).stdout, "/bin/grep\n");
  assert.equal((await shell.exec("type -p echo")).stdout, "");
});

test("discovered registered paths can be invoked", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("printf 'hello\\n' | $(which grep) hello");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");
});

test("virtual interpreters have usable discovery paths", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("type -P bash sh")).stdout, "/bin/bash\n/bin/sh\n");
  assert.equal((await shell.exec("$(which sh) -c 'echo interpreter'")).stdout, "interpreter\n");
});
