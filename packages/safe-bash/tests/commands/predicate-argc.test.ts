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
  [["(", "!", "=", "!", ")"], 0],
  [["(", "!", "==", "!", ")"], 0],
  [["(", "!", "!=", "x", ")"], 0],
  [["(", "!", "=", "x", ")"], 1],
  [["!", "(", "!", "=", "!", ")"], 1],
  [["!", "(", "!", "=", "x", ")"], 0],
  [["(", "!", "!", "=", "!", ")"], 1],
  [["(", "!", "!", "=", "x", ")"], 0],
  [["(", "!", "=", "!", ")", "-a", "x"], 0],
  [["(", "!", "=", "x", ")", "-o", "x"], 0],
  [["x", "-a", "(", "!", "=", "!", ")"], 0],
  [["(", "(", "!", "=", "!", ")", ")"], 0],
  [["(", "=", ")"], 1],
  [[")", "=", ")"], 0],
  [["!", ")", "=", ")"], 1],
  [["(", "x", "=", "x", ")"], 0],
  [["(", ")", "!=", "x", ")"], 0],
  [["(", ")", ")"], 0],
  [["(", "-n", ")", ")"], 0],
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
  test(`${command} rejects invalid two-argument groups before binary comparison`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      for (const left of [")", "x", ""]) {
        for (const operator of ["=", "==", "!=", "-eq"]) {
          const args = ["(", left, operator, ")", ")"];
          const result = await run(command, command === "[" ? [...args, "]"] : args, { commands: predicateCommands() });
          assert.equal(result.exitCode, 2, JSON.stringify(args));
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, `${command}: ${left}: unary operator expected\n`);
          const source = `${command} '(' "$v" '${operator}' ')' ')'${command === "[" ? " ]" : ""}`;
          for (const invocation of [source, `for i in 1 2; do ${source}; done`]) {
            const invoked = await shell.exec(`v='${left}'; ${invocation}`);
            assert.equal(invoked.exitCode, 2, invocation);
            assert.equal(invoked.stdout, "");
            assert.ok(invoked.stderr.includes(`${left}: unary operator expected\n`), invoked.stderr);
          }
        }
      }
      const suffix = command === "[" ? " ]" : "";
      const result = await shell.exec(`v=')'; ${command} '(' "$v" = "$v" ')'${suffix} && echo success`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("): unary operator expected\n"), result.stderr);
    } finally { await shell.dispose(); }
  });

  test(`${command} treats a trailing negated unary-looking word as a string`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      for (const value of ["-n", "-z", "-f", "-a", "-o", "-v", "x", ""]) {
        for (const [prefix, expected] of [
          [["x", "-a", "!"], value ? 1 : 0],
          [["", "-o", "!"], value ? 1 : 0],
          [["x", "-a", "!", "!"], value ? 0 : 1],
          [["!"], value ? 1 : 0],
        ] as const) {
          const args = [...prefix, value, ...(command === "[" ? ["]"] : [])];
          const result = await run(command, args, { commands: predicateCommands() });
          assert.equal(result.exitCode, expected, JSON.stringify(args));
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, "");
          const source = `v='${value}'; ${command} ${prefix.map(arg => `'${arg}'`).join(" ")} "$v"${command === "[" ? " ]" : ""}`;
          const invoked = await shell.exec(source);
          assert.equal(invoked.exitCode, expected, source);
          assert.equal(invoked.stdout, "");
          assert.equal(invoked.stderr, "");
        }
      }
    } finally { await shell.dispose(); }
  });

  test(`${command} preserves recursive negation outside small grouped comparisons`, async () => {
    const expressions = [
      ["x", "-a", "!", "!=", "x"],
      ["y", "=", "y", "-o", "!", "=", "!"],
      ["(", "!", "=", "!", "-a", "x", ")"],
      ["(", "!", "!", "!", "=", "!", ")"],
      ["(", "!", "=", "(", ")"],
      ["(", "!", "=", ")", ")"],
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

  test(`${command} compares expanded literal negation operands inside groups`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      for (const value of ["!", "x"]) {
        for (const [prefix, exitCode] of [["", 0], ["! ", 1]] as const) {
          const result = await shell.exec(`v='${value}'; ${command} ${prefix}'(' "$v" = "$v" ')'${command === "[" ? " ]" : ""}`);
          assert.equal(result.exitCode, exitCode);
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, "");
        }
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
