import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "../shell/helpers.js";
import { printfCommand } from "../../src/commands/basic.js";
import { executionCommands } from "../../src/commands/execution.js";
import { toByteSource, type CommandHandler } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

async function run(command: string, args: string[], options: { execute?: CommandHandler } = {}) {
  let stderr = "";
  const definition = executionCommands(options.execute ?? (() => ({ exitCode: 0 }))).find(entry => entry.name === command)!;
  const result = await definition.execute({ command, args, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, stderr };
}

const forms = ["-a 'Changed β arg0'", "'-aChanged:arg0'", "--argv0 'Changed β arg0'", "--argv0=Changed:arg0", "--argv0=''"];
for (const [index, form] of forms.entries()) test(`env argv0 form ${form}`, async () => {
  const { shell, fs, commands } = setup();
  commands.register(printfCommand);
  for (const command of executionCommands(() => ({ exitCode: 127 }))) commands.register(command);
  commands.register({ name: "cat", async execute(context) {
    await context.stdout.write(await context.fs.readFile(context.args[0]!));
    return { exitCode: 0 };
  } });
  const expected = index === 4 ? "" : index === 1 || index === 3 ? "Changed:arg0" : "Changed β arg0";
  commands.register({ name: "identity", execute(context) {
    assert.equal(context.command, "identity");
    assert.equal(context.argv0, expected);
    assert.deepEqual(context.args, ["operand"]);
    return { exitCode: 17 };
  } });
  try {
    const result = await shell.exec(`env --ignore-environment ${form} sh -c 'printf "<%s>\\n" "$0"; exit 17'`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `<${expected}>\n`);
    assert.equal(result.exitCode, 17);
    assert.equal((await shell.exec(`env ${form} identity operand`)).exitCode, 17);
    const explicit = await shell.exec(`env ${form} sh -c 'printf "%s" "$0"' explicit`);
    assert.equal(explicit.stdout, "explicit");
    await fs.writeFile("/binary", Uint8Array.of(254, 0, 13, 10));
    const bytes = await shell.exec(`env ${form} cat /binary`);
    assert.deepEqual(Array.from(bytes.stdoutBytes), [254, 0, 13, 10]);
  } finally { await shell.dispose(); }
});

test("env argv0 direct executor preserves lookup and status", async () => {
  const result = await run("env", ["-a", "alias", "child", "argument"], { execute(context) {
    assert.equal(context.command, "child");
    assert.equal(context.argv0, "alias");
    assert.deepEqual(context.args, ["argument"]);
    return { exitCode: 17 };
  } });
  assert.equal(result.exitCode, 17);
});

for (const option of ["-a", "--argv0"]) test(`env ${option} requires an argument`, async () => {
  const result = await run("env", [option]);
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes("requires an argument"));
});

test("env argv0 is scoped to the invoked command", async () => {
  const { shell, commands } = setup();
  for (const command of executionCommands(() => ({ exitCode: 127 }))) commands.register(command);
  commands.register({ name: "scope", execute(context) {
    assert.equal(context.argv0, undefined);
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("env -a alias sh -c 'scope; sh -c scope'; scope")).exitCode, 0);
  } finally { await shell.dispose(); }
});
