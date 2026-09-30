import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { createEnvCommands } from "../../src/commands/env/index.js";
import { CommandRegistry, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture } from "./helpers.js";

for (const external of [false, true]) for (const posix of [undefined, "", "1"]) {
  for (const flag of ["--help", "--version"]) {
    test(`echo information ${flag} external=${external} POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const context: CommandContext & { externalInvocation: boolean } = {
        command: "echo", args: [flag], cwd: "/work", env: posix === undefined ? {} : { POSIXLY_CORRECT: posix },
        externalInvocation: external, fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
      };
      const result = await basicCommands().find(command => command.name === "echo")!.execute(context);
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(stderr).length, 0);
      const output = Buffer.concat(stdout).toString();
      if (external && posix === undefined) assert.ok(output.includes(flag === "--help" ? "Usage: echo" : "echo ("));
      else assert.equal(output, flag + "\n");
    });
  }
}

for (const middleware of [false, true]) for (const posix of ["", "1"]) for (const flag of ["--help", "--version"]) {
  test(`Shell external echo ${flag} POSIXLY_CORRECT=${JSON.stringify(posix)} middleware=${middleware}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...createEnvCommands()]) });
    const intercepted: string[] = [];
    if (middleware) shell.use(async (context, next) => { intercepted.push(context.command); return next(); });
    try {
      const result = await shell.exec(`env POSIXLY_CORRECT=${posix} echo ${flag}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, flag + "\n");
      assert.equal(result.stderr, "");
      if (middleware) assert.ok(intercepted.includes("echo"));
    } finally { await shell.dispose(); }
  });
}
