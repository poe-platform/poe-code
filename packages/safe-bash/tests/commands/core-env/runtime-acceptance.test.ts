import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, CommandRegistry, createMemoryFileSystem, Shell, type CommandInvokeOptions } from "../../../src/index.js";

for (const vector of [
  { script: "env -i A=1 B=2 C=3 env", expected: "A=1\nB=2\nC=3\n" },
  { script: "env -i A=1 env N1=a N2=b env", expected: "A=1\nN1=a\nN2=b\n" },
  { script: "env -i A=1 B=2 printenv", expected: "A=1\nB=2\n" },
  { script: "env -i A=1 B=2 env | head -1", expected: "A=1\n" },
]) test(`env preserves insertion order through the shell: ${vector.script}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec(vector.script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, vector.expected);
  } finally { await shell.dispose(); }
});

for (const vector of [
  { name: "omitted legacy merge", options: { env: { KEEP: "child" } }, expected: { PUBLIC: "parent", PWD: "/", SHLVL: "1", KEEP: "child" } },
  { name: "false legacy merge", options: { replaceEnv: false, env: { KEEP: "child" } }, expected: { PUBLIC: "parent", PWD: "/", SHLVL: "1", KEEP: "child" } },
  { name: "true exact map", options: { replaceEnv: true, env: { KEEP: "child" } }, expected: { KEEP: "child" } },
  { name: "true omitted map", options: { replaceEnv: true }, expected: {} },
  { name: "true empty map", options: { replaceEnv: true, env: {} }, expected: {} },
  { name: "true explicit PWD independent of cwd", options: { replaceEnv: true, env: { PWD: "literal" } }, expected: { PWD: "literal" } },
] satisfies { name: string; options: CommandInvokeOptions; expected: Record<string, string> }[]) {
  test(`actual shell replacement acceptance: ${vector.name}`, async () => {
    const observed: Record<string, string>[] = [];
    const commands = new CommandRegistry([
      { name: "invoke-probe", execute(context) { return context.invoke!("capture-env", [], vector.options); } },
      { name: "capture-env", execute(context) { observed.push({ ...context.env }); assert.equal(context.cwd, "/"); return { exitCode: 0 }; } },
    ]);
    const shell = new Shell({ fs: createMemoryFileSystem(), commands, env: { PUBLIC: "parent" } });
    try {
      assert.equal((await shell.exec("invoke-probe")).exitCode, 0);
      assert.deepEqual(observed, [vector.expected]);
    } finally { await shell.dispose(); }
  });
}

for (const vector of [
  { script: "env -i A=1 B=2 env -u A", expected: "B=2\n" },
  { script: "env -u PUBLIC env", expected: "PWD=/\nSHLVL=1\n" },
  { script: "PREFIX=temporary env -i env", expected: "" },
]) test(`actual env registry chain acceptance: ${vector.script}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { PUBLIC: "parent" } }).use(agentCommands());
  try {
    const result = await shell.exec(vector.script);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, vector.expected);
  } finally { await shell.dispose(); }
});

test("actual env child cannot inherit locals or alter parent export/local values", async () => {
  const observed: Record<string, string>[] = [];
  const commands = new CommandRegistry([{ name: "capture-env", execute(context) { observed.push({ ...context.env }); context.env.PUBLIC = "child-change"; return { exitCode: 0 }; } }]);
  const shell = new Shell({ fs: createMemoryFileSystem(), commands, env: { PUBLIC: "parent" } }).use(agentCommands());
  try {
    const result = await shell.exec("SECRET=private; env -i KEEP=value capture-env; printf '<%s><%s>\\n' \"$SECRET\" \"$PUBLIC\"");
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, "<private><parent>\n");
    assert.deepEqual(observed, [{ KEEP: "value" }]);
  } finally { await shell.dispose(); }
});
