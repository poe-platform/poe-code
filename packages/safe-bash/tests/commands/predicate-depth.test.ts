import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture, run } from "./helpers.js";

function parentheses(depth: number, operands: readonly string[] = ["value"]): string[] {
  return [...Array<string>(depth).fill("("), ...operands, ...Array<string>(depth).fill(")")];
}

const expressions = {
  parentheses,
  negation: (depth: number) => [...Array<string>(depth).fill("!"), "value"],
  mixed: (depth: number) => [...Array<string>(128).fill("!"), ...parentheses(depth - 128)],
};

for (const command of ["test", "["]) {
  const suffix = command === "[" ? ["]"] : [];
  for (const [kind, expression] of Object.entries(expressions)) {
    test(`${command} accepts exactly 256 levels of ${kind}`, async () => {
      const result = await run(command, [...expression(256), ...suffix]);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    });

    test(`${command} refuses level 257 of ${kind} as a usage error`, async () => {
      const result = await run(command, [...expression(257), ...suffix]);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${command}: expression nesting exceeds 256\n`);
    });
  }

  test(`${command} keeps sibling nesting independent and operator operands literal`, async () => {
    for (const operands of [["!", "=", "!"], ["(", "=", "("]]) {
      const result = await run(command, [...parentheses(256, operands), ...suffix]);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
    }
    const result = await run(command, [...parentheses(256, [""]), "-o", ...parentheses(256), ...suffix]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  });

  test(`${command} preserves bounded filesystem predicates, negation and short circuiting`, async () => {
    const fs = await fixture({ file: "data" });
    let probes = 0;
    const stat = fs.stat.bind(fs);
    fs.stat = async (...args) => { probes++; return stat(...args); };
    for (const [operands, expected] of [
      [parentheses(256, ["-f", "file"]), 0],
      [parentheses(256, ["-f", "missing"]), 1],
      [["!", ...parentheses(255, ["-f", "file"])], 1],
    ] as const) {
      const result = await run(command, [...operands, ...suffix], { fs });
      assert.equal(result.exitCode, expected);
      assert.equal(result.stderr, "");
    }
    assert.equal(probes, 3);
    const skipped = await run(command, ["value", "-o", ...parentheses(256, ["-f", "file"]), ...suffix], { fs });
    assert.equal(skipped.exitCode, 0);
    assert.equal(skipped.stderr, "");
    const refused = await run(command, [...parentheses(257, ["-f", "file"]), ...suffix], { fs });
    assert.equal(refused.exitCode, 2);
    assert.equal(refused.stderr, `${command}: expression nesting exceeds 256\n`);
    assert.equal(probes, 3);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/file")), "data");
  });

  test(`${command} reports 3000 parentheses through Shell without a host stack diagnostic`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      const result = await shell.exec(`${command} ${"\\( ".repeat(3000)}value${" \\)".repeat(3000)}${suffix.length ? " ]" : ""}; echo rc=$?`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "rc=2\n");
      assert.equal(result.stderr, `${command}: expression nesting exceeds 256\n`);
    } finally { await shell.dispose(); }
  });
}

test("predicate depth checks preserve missing parentheses and bracket diagnostics", async () => {
  const parenthesis = await run("test", ["(", "value"]);
  assert.equal(parenthesis.exitCode, 2);
  assert.equal(parenthesis.stderr, "test: missing ')'\n");
  const bracket = await run("[", ["value"]);
  assert.equal(bracket.exitCode, 2);
  assert.equal(bracket.stderr, "[: missing ']'\n");
});
