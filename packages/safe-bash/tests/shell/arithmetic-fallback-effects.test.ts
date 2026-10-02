import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { prepareArithmetic, type ArithmeticReferences } from "../../src/shell/arithmetic.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { evaluateArithmeticSync, evaluateArithmeticSyncNonZero, evaluateArithmeticSyncString } from "../../src/shell/sync-extra-evaluators.js";
import { bashExecutable } from "../helpers/bash-oracle.js";
import { setup } from "./helpers.js";

for (const [name, initialization, expression, expected] of [
  ["intermediate overflow", "z=1000; x=0", "x += 1, (z * 100000) + 1", "1:0:10 20 30 40"],
  ["array assignment overflow", "big=100000000", "i++, arr[i] += big", "0:1:10 100000020 30 40"],
  ["negative index", "i=-1", "x += 1, arr[i]", "1:-1:10 20 30 40"],
  ["index becomes negative", "i=0", "i--, arr[i] += 5", "0:-1:10 20 30 45"],
  ["earlier array mutation", "i=-1", "arr[0]++, x++, arr[i]", "1:-1:11 20 30 40"],
  ["nested comma", "i=-1; z=1000", "x += 1, (x += 2, (z * 100000) + arr[i])", "3:-1:10 20 30 40"],
  ["recursive subscript value", "i='j+1'; j=0", "x++, arr[i]", "1:j+1:10 20 30 40"],
  ["zero divisor", "z=0", "x++, 1 / z", "1:0:10 20 30 40"],
] as const) {
  for (const [route, body] of [
    ["command", `(( ${expression} ))`],
    ["expansion", `value=$(( ${expression} ))`],
    ["loop initializer", `for (( ${expression}; 0; )); do :; done`],
    ["loop condition", `for (( ; ${expression}; )); do break; done`],
    ["loop update", `for ((turn=0; turn<1; ${expression}, turn++)); do :; done`],
    ["expanded command", `(( $expression ))`],
  ] as const) {
    // An expansion error exits the shell; EXIT observes already committed effects.
    const source = `arr=(10 20 30 40); x=0; i=0; ${initialization}; expression='${expression}'; trap 'echo "$x:$i:\${arr[*]}"' EXIT; ${body}`;
    for (const limits of [{}, { maxExpansionBytes: 65536 }]) {
      test(`arithmetic fallback commits effects once: ${name}, ${route}, ${JSON.stringify(limits)}`, async context => {
        const { shell, commands } = setup({ limits });
        for (const command of basicCommands()) commands.register(command);
        context.after(() => shell.dispose());
        const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], {
          encoding: "utf8", env: { LC_ALL: "C", BASH_ENV: "/dev/null" }, timeout: 2000,
        });
        assert.ifError(native.error);
        assert.equal(native.signal, null);
        assert.equal(native.stdout, `${expected}\n`);
        const result = await shell.exec(source);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.exitCode, native.status);
        if (name === "zero divisor") assert.match(result.stderr, /division by 0/);
        else assert.equal(result.stderr, "");
      });
    }
  }
}

for (const index of [-5, 2147483648]) {
  test(`invalid array index ${index} preserves earlier effects exactly once`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`arr=(10 20); i=${index}; x=0; (( x++, arr[i] )); say "$?:$x"`);
    assert.equal(result.stdout, "1:1\n");
    assert.match(result.stderr, /index outside 0\.\.2147483647/);
    assert.equal(result.exitCode, 0);
  });
}

for (const [name, evaluate, expected] of [
  ["bigint", evaluateArithmeticSync, 100000001n],
  ["status", evaluateArithmeticSyncNonZero, true],
  ["string", evaluateArithmeticSyncString, "100000001"],
] as const) {
  test(`arithmetic ${name} falls back once after small-integer overflow`, () => {
    const variables: Record<string, string> = { x: "0", z: "1000" };
    const writes: Array<[string, string]> = [];
    let reads = 0;
    const references: ArithmeticReferences = {
      resolve: name => name,
      read: name => { reads++; return variables[name]; },
      write(name, value) { writes.push([name, value]); variables[name] = value; },
    };
    const value = evaluate(prepareArithmetic("x += 1, (z * 100000) + 1"), references, new ParseBudget());
    assert.equal(value, expected);
    assert.deepEqual(writes, [["x", "1"]]);
    assert.equal(reads, 4, "one speculative read and one fallback read per operand");
  });
}
