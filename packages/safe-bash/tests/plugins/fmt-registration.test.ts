import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, Shell } from "../../src/index.js";

for (const route of ["factory", "plugin"] as const) {
  test(`fmt default ${route} supports direct, nested, pipeline and VFS workflows`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/paragraph", new TextEncoder().encode("alpha beta gamma delta epsilon zeta eta theta\n"));
    const shell = new Shell({ fs, env: { LC_ALL: "C" }, commands: new CommandRegistry(route === "factory" ? createAgentCommands() : []) });
    if (route === "plugin") shell.use(agentCommands());
    try {
      for (const script of ["fmt -w20 /paragraph", "cat /paragraph | fmt -w20", "env fmt -w20 /paragraph", "printf /paragraph | xargs fmt -w20", "fmt -w20 </paragraph >/formatted; cat /formatted"]) {
        const result = await shell.exec(script);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n", ""], script);
      }
      assert.equal(shell.commands.list().filter(command => command.name === "fmt").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("fmt public registration retains binary input and explicit formatting options", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const binary = await shell.exec("fmt -u -w10", { stdin: Uint8Array.of(255, 32, 32, 97, 10) });
    assert.deepEqual([binary.exitCode, Buffer.from(binary.stdoutBytes), binary.stderr], [0, Buffer.from([255, 32, 97, 10]), ""]);
    const prefixed = await shell.exec("fmt -p '> ' -w16", { stdin: "> alpha beta gamma delta epsilon\nuntouched text here\n" });
    assert.deepEqual([prefixed.exitCode, prefixed.stdout, prefixed.stderr], [0, "> alpha beta\n> gamma delta\n> epsilon\nuntouched text here\n", ""]);
    const invalid = await shell.exec("fmt -w2501", { stdin: "unchanged\n" });
    assert.deepEqual([invalid.exitCode, invalid.stdout, invalid.stderr], [1, "", "fmt: invalid width: '2501': Numerical result out of range\n"]);
    const missing = await shell.exec("fmt \"'?\"");
    assert.deepEqual([missing.exitCode, missing.stdout, missing.stderr], [1, "", "fmt: cannot open ''\\''?' for reading: No such file or directory\n"]);
  } finally { await shell.dispose(); }
});
