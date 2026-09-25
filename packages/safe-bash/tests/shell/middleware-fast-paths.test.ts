import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { setup } from "./helpers.js";

for (const source of [":", "true", "false", "test value", "[ value ]", "echo value > /output", "printf value > /output"]) {
  for (const pipeline of [false, true]) {
    const script = pipeline ? `${source} | pass` : source;
    test(`middleware intercepts optimized commands: ${script}`, async context => {
      const { shell, commands, fs } = setup();
      context.after(() => shell.dispose());
      for (const command of [...basicCommands(), ...predicateCommands()]) commands.register(command);
      const observed: string[] = [], cleaned: string[] = [];
      shell.use((invocation, next) => {
        if (invocation.command === "pass") return next();
        observed.push(invocation.command);
        invocation.registerCleanup!(() => { cleaned.push(invocation.command); });
        return { exitCode: 7 };
      });
      const result = await shell.exec(script);
      assert.equal(result.exitCode, pipeline ? 0 : 7);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(observed, [source.split(" ")[0]]);
      assert.deepEqual(cleaned, observed);
      if (source.includes(">")) assert.equal((await fs.readFile("/output")).byteLength, 0);
    });
  }
}

for (const command of ["echo", "printf"]) {
  test(`middleware intercepts optimized command substitutions: ${command}`, async context => {
    const { shell, commands } = setup();
    context.after(() => shell.dispose());
    for (const definition of basicCommands()) commands.register(definition);
    const observed: string[] = [];
    shell.use((invocation, next) => {
      observed.push(invocation.command);
      return invocation.command === command ? { exitCode: 7 } : next();
    });
    const result = await shell.exec(`args "$(${command} value)"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '[""]');
    assert.equal(result.stderr, "");
    assert.deepEqual(observed, [command, "args"]);
  });
}
