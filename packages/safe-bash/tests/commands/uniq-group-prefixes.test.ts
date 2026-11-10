import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { chunks, fixture, run } from "./helpers.js";

const commands = textCommands();

for (const [option, method, expected] of [
  ["group", "separate", "A\nA\n\nB\n\nC\nC\n"],
  ["group", "prepend", "\nA\nA\n\nB\n\nC\nC\n"],
  ["group", "append", "A\nA\n\nB\n\nC\nC\n\n"],
  ["group", "both", "\nA\nA\n\nB\n\nC\nC\n\n"],
  ["all-repeated", "none", "A\nA\nC\nC\n"],
  ["all-repeated", "prepend", "\nA\nA\n\nC\nC\n"],
  ["all-repeated", "separate", "A\nA\n\nC\nC\n"],
] as const) {
  test(`uniq accepts every unambiguous prefix of --${option}=${method}`, async () => {
    for (let length = 1; length <= method.length; length++) {
      for (const delimiter of ["\n", "\0"]) {
        const argument = `--${option}=${method.slice(0, length)}`;
        const result = await run("uniq", [argument, ...(delimiter === "\0" ? ["-z"] : [])], {
          commands, env: { LC_ALL: "C" }, stdin: chunks(["A", "A", "B", "C", "C"].join(delimiter)),
        });
        assert.equal(result.exitCode, 0, `${argument}: ${result.stderr}`);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, Buffer.from(expected.split("\n").join(delimiter)), argument);
      }
    }
  });
}

test("uniq grouping abbreviations preserve singleton separators", async () => {
  const result = await run("uniq", ["--group=s"], { commands, stdin: "A x\nB x\nC y", env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "A x\n\nB x\n\nC y\n");
  assert.equal(result.stderr, "");
});

for (const option of ["group", "all-repeated"]) {
  test(`uniq rejects invalid --${option} values before reading input or opening output`, async () => {
    for (const method of ["", "unknown", "P", "prepending", option === "group" ? "n" : "a"]) {
      const fs = await fixture({ in: "A\nA\nB", out: "KEEP" });
      for (const operands of [[], ["in", "out"]]) {
        const result = await run("uniq", [`--${option}=${method}`, `--${option}=p`, ...operands], {
          commands, fs,
          stdin: { async *[Symbol.asyncIterator]() { assert.fail("invalid method must not read stdin"); yield new Uint8Array(); } },
        });
        assert.notEqual(result.exitCode, 0, method);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, `uniq: invalid argument '${method}' for '${option}'\n`);
        assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), "KEEP");
        assert.equal(Buffer.from(await fs.readFile("/work/in")).toString(), "A\nA\nB");
      }
    }
  });
}
