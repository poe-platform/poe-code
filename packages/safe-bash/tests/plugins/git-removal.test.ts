import assert from "node:assert/strict";
import test from "node:test";
import * as publicApi from "../../src/index.js";

test("the public source API has no Git command factories or plugin", () => {
  const removed = ["createGitCommand", "createGitCommands", "gitCommands"];
  assert.deepEqual(
    Object.keys(publicApi).filter((name) => removed.includes(name)),
    []
  );
});

test("aggregate options have no Git feature configuration", () => {
  const supportsGit: "git" extends keyof publicApi.AgentCommandsOptions ? true : false = false;
  assert.equal(supportsGit, false);
});

for (const mode of ["factory", "plugin"] as const) {
  test(`${mode} aggregate does not register Git`, async () => {
    const commands =
      mode === "factory"
        ? new publicApi.CommandRegistry(publicApi.createAgentCommands())
        : new publicApi.CommandRegistry();
    const shell = new publicApi.Shell({ fs: publicApi.createMemoryFileSystem(), commands });
    if (mode === "plugin") shell.use(publicApi.agentCommands());
    try {
      await shell.exec("");
      assert.equal(shell.commands.has("git"), false);
      assert.equal(shell.commands.get("git"), undefined);
      for (const name of ["echo", "rg", "diff", "patch", "apply_patch", "which"]) {
        assert.equal(shell.commands.has(name), true, name);
      }
    } finally {
      await shell.dispose();
    }
  });

  for (const source of ["git --version", "env git status"]) {
    test(`${mode} reports command-not-found for ${source} without filesystem effects`, async () => {
      const fs = publicApi.createMemoryFileSystem();
      const shell =
        mode === "factory"
          ? new publicApi.Shell({
              fs,
              commands: new publicApi.CommandRegistry(publicApi.createAgentCommands())
            })
          : new publicApi.Shell({ fs }).use(publicApi.agentCommands());
      const before = await fs.readdir("/");
      try {
        const result = await shell.exec(source);
        assert.equal(result.exitCode, 127);
        assert.equal(result.stdout, "");
        assert.ok(result.stderr.includes("command not found"), result.stderr);
        assert.deepEqual(await fs.readdir("/"), before);
      } finally {
        await shell.dispose();
      }
    });
  }

  test(`${mode} keeps ordinary shell pipelines available`, async () => {
    const fs = publicApi.createMemoryFileSystem();
    const shell =
      mode === "factory"
        ? new publicApi.Shell({
            fs,
            commands: new publicApi.CommandRegistry(publicApi.createAgentCommands())
          })
        : new publicApi.Shell({ fs }).use(publicApi.agentCommands());
    try {
      const result = await shell.exec("printf 'kept\\n' | cat");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "kept\n");
      assert.equal(result.stderr, "");
    } finally {
      await shell.dispose();
    }
  });
}
