import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, Shell } from "../../src/index.js";

for (const route of ["factory", "plugin"] as const) {
  test(`numfmt default ${route} supports direct, nested, pipeline and VFS workflows`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/numbers", new TextEncoder().encode("1024\n1048576\n"));
    await fs.writeFile("/table", new TextEncoder().encode("name,bytes\nalpha,1000\nbeta,2500000\n"));
    await fs.writeFile("/convert.sh", new TextEncoder().encode("numfmt --header --delimiter=, --field=2 --to=si < /table > /formatted\ncat /formatted\n"));
    const shell = new Shell({ fs, env: { LC_ALL: "C" }, commands: new CommandRegistry(route === "factory" ? createAgentCommands() : []) });
    if (route === "plugin") shell.use(agentCommands());
    try {
      for (const [script, stdout] of [
        ["numfmt --to=si 1000 2500000", "1.0K\n2.5M\n"],
        ["cat /numbers | numfmt --to=iec", "1.0K\n1.0M\n"],
        ["env numfmt --from=iec-i 1Ki 2Mi", "1024\n2097152\n"],
        ["printf '1000 2000' | xargs numfmt --to=si", "1.0K\n2.0K\n"],
        ["sh /convert.sh", "name,bytes\nalpha,1.0K\nbeta,2.5M\n"],
      ] as const) {
        const result = await shell.exec(script);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, stdout, ""], script);
      }
      assert.equal(shell.commands.list().filter(command => command.name === "numfmt").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("numfmt public registration preserves rounding, raw field bytes and partial failures", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const rounded = await shell.exec("numfmt --round=nearest --format=%.1f -- 1.25 -1.25");
    assert.deepEqual([rounded.exitCode, rounded.stdout, rounded.stderr], [0, "1.3\n-1.3\n", ""]);
    const raw = await shell.exec("numfmt --delimiter=, --field=2 --to=si", { stdin: Uint8Array.of(255, 44, 49, 48, 48, 48, 10) });
    assert.deepEqual([raw.exitCode, Buffer.from(raw.stdoutBytes), raw.stderr], [0, Buffer.from([255, 44, 49, 46, 48, 75, 10]), ""]);
    const invalid = await shell.exec("numfmt --from=iec-i 1Ki invalid 2Mi");
    assert.deepEqual([invalid.exitCode, invalid.stdout, invalid.stderr], [2, "1024\n", "numfmt: invalid number: 'invalid'\n"]);
  } finally { await shell.dispose(); }
});
