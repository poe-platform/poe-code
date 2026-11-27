import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const [declaration, name, value] of [
  ["readonly -a ra=(1 2)", "ra", "1 2"],
  ["readonly r=1", "r", "1"],
] as const) {
  for (const operator of ["=", "+="]) {
    for (const scriptFile of [false, true]) {
      test(`readonly element assignment stops the input line: ${name}[0]${operator}x, file=${scriptFile}`, async context => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work");
        const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
        context.after(() => shell.dispose());
        const script = `${declaration}; ${name}[0]${operator}x; echo "continued $?"`;
        if (scriptFile) await fs.writeFile("/work/script.sh", new TextEncoder().encode(script));
        const result = await shell.exec(scriptFile ? "bash /work/script.sh" : script);
        assert.equal(result.stdout, "");
        assert.equal(result.exitCode, 1);
        assert.equal(result.stderr, `${scriptFile ? "/work/script.sh" : "shell"}: line 1: ${name}: readonly variable\n`);
      });
    }
  }

  test(`readonly element assignment preserves the value on the next input line: ${name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`${declaration}; ${name}[0]=x; echo WRONG\necho "continued $?"; echo "\${${name}[*]}"`);
    assert.equal(result.stdout, `continued 1\n${value}\n`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, `shell: line 1: ${name}: readonly variable\n`);
  });
}
