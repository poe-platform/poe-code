import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { exiftoolCommands } from "@poe-platform/safe-bash/commands/exiftool";
import { wkhtmltopdfCommands, wkhtmltopdfLimits } from "@poe-platform/safe-bash/commands/wkhtmltopdf";
import { verification } from "./safe-packages-private-command.mjs";

await verification;
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(agentCommands());
const seen = [];
shell.use(async (context, next) => { seen.push(context.command); return next(); });
try {
  await shell.exec("true"); // Shell installs queued plugins before dispatch.
  for (const [name, plugin] of [
    ["exiftool", exiftoolCommands],
    ["wkhtmltopdf", options => wkhtmltopdfCommands({ limits: wkhtmltopdfLimits, ...options })],
  ]) {
    assert.equal(shell.commands.has(name), false);
    shell.register({ name, execute: () => ({ exitCode: 23 }) });
    const before = shell.commands.list();
    const host = { commands: shell.commands, use() { throw new Error("Unexpected middleware"); }, registerFileSystem() { throw new Error("Unexpected filesystem"); } };
    assert.throws(() => plugin().setup(host), { message: `Command already registered: ${name}` });
    assert.deepEqual(shell.commands.list(), before);
    shell.use(plugin({ replace: true }));
    await shell.exec("true");
    assert.notEqual(shell.commands.get(name), before.find(command => command.name === name));
    for (const command of before.filter(command => command.name !== name)) assert.equal(shell.commands.get(command.name), command);
  }
  await fs.writeFile("/registered.sh", new TextEncoder().encode("wkhtmltopdf --help | cat\n"));
  seen.length = 0;
  const result = await shell.exec("sh /registered.sh");
  const expected = "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nStatic first-party renderer requires an explicit binding. Input/output '-' use stdin/stdout.\n";
  assert.deepEqual(result, { exitCode: 0, stdout: expected, stderr: "", stdoutBytes: new TextEncoder().encode(expected), stderrBytes: new Uint8Array() });
  for (const name of ["sh", "wkhtmltopdf", "cat"]) assert.ok(seen.includes(name));
} finally { await shell.dispose(); }
