import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { createEnvCommands } from "../../src/commands/env/index.js";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";
import { fixture } from "./helpers.js";

// GNU coreutils 9.7 echo.c accepts bare octal; Bash's builtin requires a leading 0.
const cases = [
  { octal: "1", bytes: [1] }, { octal: "177", bytes: [127] },
  { octal: "377", bytes: [255] }, { octal: "400", bytes: [0] },
  { octal: "777", bytes: [255] }, { octal: "1234", bytes: [83, 52] },
];

for (const entry of cases) for (const external of [false, true]) {
  for (const posix of [undefined, "", "1"]) for (const raw of [false, true]) {
    test(`echo bare octal ${entry.octal} external=${external} POSIXLY_CORRECT=${JSON.stringify(posix)} raw=${raw}`, async () => {
      const value = `A\\${entry.octal}Z`;
      const values = createCommandArguments(["-e", raw ? shellValueFromBytes(Buffer.from(value)) : value]);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const context: CommandContext & { externalInvocation: boolean } = {
        command: "echo", args: values.args, argumentValues: values, cwd: "/work",
        env: posix === undefined ? {} : { POSIXLY_CORRECT: posix }, externalInvocation: external,
        fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
      };
      const result = await basicCommands().find(command => command.name === "echo")!.execute(context);
      const expected = external ? Buffer.concat([
        posix === undefined ? Buffer.alloc(0) : Buffer.from("-e "), Buffer.from([65, ...entry.bytes, 90, 10]),
      ]) : Buffer.from(value + "\n");
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(stderr).length, 0);
      assert.deepEqual(Buffer.concat(stdout), expected);
    });
  }
}

for (const entry of cases) for (const middleware of [false, true]) for (const external of [false, true]) {
  test(`Shell echo bare octal ${entry.octal} external=${external} middleware=${middleware}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...createEnvCommands()]) });
    const intercepted: string[] = [];
    if (middleware) shell.use(async (context, next) => { intercepted.push(context.command); return next(); });
    try {
      const result = await shell.exec(`${external ? "env " : ""}echo -e 'A\\${entry.octal}Z'`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      const expected = external ? Buffer.from([65, ...entry.bytes, 90, 10]) : Buffer.from(`A\\${entry.octal}Z\n`);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(expected));
      if (middleware) assert.ok(intercepted.includes("echo"));
    } finally { await shell.dispose(); }
  });
}
