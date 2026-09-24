import assert from "node:assert/strict";
import test from "node:test";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture, run } from "./helpers.js";

const cases: readonly (readonly [readonly string[], number])[] = [
  [["(", "-n", ")"], 0],
  [["(", "!", ")"], 0],
  [["(", "", ")"], 1],
  [["!", "Alpha", "-a", ""], 0],
  [["!", "", "-o", "Alpha"], 1],
  [["-n", "-a", "value"], 0],
  [["", "-o", "!"], 0],
  [["!", "-n", "value"], 1],
  [["!", "=", "!"], 0],
  [["(", "=", ")"], 1],
  [["(", "-n", "value", ")"], 0],
  [["(", "!", "", ")"], 0],
  [["Alpha", "-a", ""], 1],
  [["", "-o", "Alpha"], 0],
  [["!", "value", "-eq", "bad"], 2],
  [["(", "=", ")", "-a", "yes"], 0],
  [["(", "-eq", ")", "-a", "yes"], 0],
  [["(", "!", "=", ")", "-o", "yes"], 0],
  [["(", "!", "-eq", ")", "-o", "yes"], 0],
  [["(", "=", ")", "-a", ""], 1],
];

for (const command of ["test", "["]) {
  test(`${command} preserves argc semantics through shell quoting and status expansion`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      const suffix = command === "[" ? " ]" : "";
      const result = await shell.exec([
        "'(' '-n' ')'", "'(' '!' ')'", "'!' Alpha -a ''", "'!' '' -o Alpha",
      ].map(expression => `${command} ${expression}${suffix}; echo $?`).join("; "));
      assert.equal(result.stdout, "0\n0\n0\n1\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
  for (const [args, exitCode] of cases) {
    test(`${command} dispatches ${JSON.stringify(args)} by argument count`, async () => {
      const result = await run(command, command === "[" ? [...args, "]"] : args, { commands: predicateCommands() });
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stdout, "");
      if (exitCode !== 2) assert.equal(result.stderr, "");
      else assert.match(result.stderr, /integer expression expected/u);
    });
  }
}
