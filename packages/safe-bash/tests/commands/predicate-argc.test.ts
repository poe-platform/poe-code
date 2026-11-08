import assert from "node:assert/strict";
import test from "node:test";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture, run } from "./helpers.js";

const cases: readonly (readonly [readonly string[], number])[] = [
  ...["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"].flatMap(operand => [
    [["-f", operand], 1],
    [["!", "-n", operand], 1],
    [["!", "-z", operand], 0],
    [["!", "-f", operand], 0],
    [["!", "!", "-n", operand], 0],
    [["-z", "", "-a", "-n", operand], 0],
    [["-n", "x", "-o", "-z", operand], 0],
  ] as const),
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
  test(`${command} applies recursive negation grammar throughout compound expressions`, async () => {
    const expressions = [
      ["x", "-a", "!", "!=", "x"],
      ["y", "=", "y", "-o", "!", "=", "!"],
      ["(", "!", "!=", "x", ")"],
      ["(", "!", "=", "!", ")", "-a", "x"],
    ];
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      for (const args of expressions) {
        const result = await run(command, command === "[" ? [...args, "]"] : args, { commands: predicateCommands() });
        assert.equal(result.exitCode, 2, JSON.stringify(args));
        assert.notEqual(result.stderr, "", JSON.stringify(args));
        const source = `${command} ${args.map(arg => `'${arg}'`).join(" ")}${command === "[" ? " ]" : ""}`;
        const invoked = await shell.exec(source);
        assert.equal(invoked.exitCode, 2, source);
        assert.notEqual(invoked.stderr, "", source);
      }
    } finally { await shell.dispose(); }
  });

  test(`${command} validates signed 64-bit operands even after decisive logical terms`, async () => {
    for (const value of ["-9223372036854775809", "9223372036854775808", "+99999999999999999999999"]) {
      for (const prefix of [["1", "-eq", "1", "-o"], ["1", "-eq", "2", "-a"]]) {
        const args = [...prefix, "2", "-eq", value, ...(command === "[" ? ["]"] : [])];
        const result = await run(command, args, { commands: predicateCommands() });
        assert.equal(result.exitCode, 2, JSON.stringify(args));
        assert.match(result.stderr, /integer expression expected/u);
      }
    }
    for (const value of ["-9223372036854775808", "9223372036854775807"]) {
      const args = [value, "-eq", value, ...(command === "[" ? ["]"] : [])];
      const result = await run(command, args, { commands: predicateCommands() });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
    }
  });

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
      const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
      try {
        const source = `${command} ${args.map(arg => `'${arg}'`).join(" ")}${command === "[" ? " ]" : ""}`;
        for (const invocation of [source, `for i in 1 2; do ${source}; done`]) {
          const invoked = await shell.exec(invocation);
          assert.equal(invoked.exitCode, exitCode, invocation);
          if (exitCode !== 2) assert.equal(invoked.stderr, "", invocation);
        }
      } finally { await shell.dispose(); }
    });
  }
}
