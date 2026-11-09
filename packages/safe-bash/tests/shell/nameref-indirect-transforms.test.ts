import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [label, declaration, target] of [
  ["dense indexed element", "a=(abc); declare -n p='a[0]'", "a[0]"],
  ["sparse indexed element", "a=([2]=abc); declare -n p='a[2]'", "a[2]"],
  ["associative element", "declare -A a=([key]=abc); declare -n p='a[key]'", "a[key]"],
  ["chained element reference", "a=([2]=abc); declare -n ref='a[2]'; declare -n p=ref", "a[2]"],
  ["scalar reference", "x=abc; declare -n p=x", "x"],
] as const) {
  for (const nounset of [false, true]) {
    for (const bounded of [false, true]) {
      test(`indirect nameref transformations: ${label}, nounset=${nounset}, bounded=${bounded}`, async context => {
        const { shell, commands } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
        for (const command of basicCommands()) commands.register(command);
        context.after(() => shell.dispose());
        const print = 'printf "<%s>\\n" "${!p}" "${!p:1}" "${!p#?}" "${!p@Q}" "${!p^^}" "${!p/a/Z}" "${!p:-fallback}"';
        const result = await shell.exec(`${nounset ? "set -u; " : ""}${declaration}; ${print}; for i in 1 2; do ${print}; done`);
        const expected = target === "x"
          ? ["x", "", "", "'x'", "X", "x", "x"]
          : [target, "bc", "bc", "'abc'", "ABC", "Zbc", target];
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected.map(value => `<${value}>\n`).join("").repeat(3));
      });
    }
  }
}
