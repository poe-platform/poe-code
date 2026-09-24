import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { parsePrintfFloat } from "../../src/commands/printf-float.js";

for (const operand of ["   ", "\t", "0b101", "0o77", "+0b101", "-0o77"]) {
  test(`printf diagnoses non-C floating operand ${JSON.stringify(operand)}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(`printf '[%f]:%s' '${operand}' done`);
      assert.equal(result.stdout, "[0.000000]:done");
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(operand));
      assert.equal(parsePrintfFloat(operand), undefined);
    } finally { await shell.dispose(); }
  });
}

test("printf accepts decimal C floating syntax and preserves signed zero", () => {
  for (const [operand, expected] of [["  +1.25", 1.25], [".5", .5], ["1.", 1], ["1e-2", .01], ["-0.0", -0], ["010", 10]] as const) {
    assert.equal(parsePrintfFloat(operand)?.value, expected);
  }
  for (const operand of ["", ".", "+", "1e", "1e+", "1.2.3", "1junk"]) assert.equal(parsePrintfFloat(operand), undefined);
});
