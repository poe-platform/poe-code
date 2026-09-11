import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, Shell } from "../../src/index.js";

for (const route of ["factory", "plugin"] as const) {
  test(`shuf default ${route} supports seeded direct, nested, pipeline and VFS workflows`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/random", new Uint8Array(64));
    await fs.writeFile("/lines", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
    const shell = new Shell({ fs, env: { LC_ALL: "C" }, commands: new CommandRegistry(route === "factory" ? createAgentCommands() : []) });
    if (route === "plugin") shell.use(agentCommands());
    try {
      for (const script of [
        "shuf --random-source=/random /lines",
        "cat /lines | shuf --random-source=/random",
        "env shuf --random-source=/random /lines",
        "printf /lines | xargs shuf --random-source=/random",
        "shuf --random-source=/random -o /lines /lines; cat /lines",
      ]) {
        const result = await shell.exec(script);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "alpha\nbeta\ngamma\n", ""], script);
      }
      assert.equal(shell.commands.list().filter(command => command.name === "shuf").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("shuf public registration preserves binary delimiters, range selection and zero-entropy paths", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", new Uint8Array(64));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const range = await shell.exec("shuf --random-source=/random -i7-10 -n3");
    assert.deepEqual([range.exitCode, range.stdout, range.stderr], [0, "7\n8\n9\n", ""]);
    const bytes = Uint8Array.of(255, 0, 0, 65, 0);
    const binary = await shell.exec("shuf --random-source=/random -z", { stdin: bytes });
    assert.deepEqual([binary.exitCode, Buffer.from(binary.stdoutBytes), binary.stderr], [0, Buffer.from(bytes), ""]);
    const empty = await shell.exec("shuf --random-source=/missing -n0 -e alpha beta");
    assert.deepEqual([empty.exitCode, empty.stdout, empty.stderr], [0, "", ""]);
    const missing = await shell.exec("shuf -- \"'?\"");
    assert.deepEqual([missing.exitCode, missing.stdout, missing.stderr], [1, "", "shuf: ''\\''?': No such file or directory\n"]);
  } finally { await shell.dispose(); }
});
