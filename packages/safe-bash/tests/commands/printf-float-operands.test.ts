import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { parsePrintfFloat } from "../../src/commands/printf-float.js";

// GNU Bash 5.3, Linux x86-64/glibc, LC_ALL=C, TZ=UTC.
for (const [format, operand, expected] of [
  ["%.0f", "9007199254740993", "9007199254740993"],
  ["%.0f", "9223372036854775807", "9223372036854775807"],
  ["%.0f", "0x20000000000001", "9007199254740993"],
  ["%.18g", "1.00000000000000001", "1.00000000000000001"],
  ["(%a)", "0xffffffffffffffff", "(0xf.fffffffffffffffp+60)"],
  ["%.0f", "9007199254740992", "9007199254740992"],
  ["%a", "0x1p50", "0x8p+47"],
  ["%.0f", "-9007199254740993", "-9007199254740993"],
  ["%.0f", "18446744073709551617", "18446744073709551616"],
  ["%.0f", "18446744073709551619", "18446744073709551620"],
  ["%.0f", "0x10000000000000001", "18446744073709551616"],
  ["%.18e", "1.00000000000000001", "1.000000000000000010e+00"],
  ["%.0f", "9007199254740992.5", "9007199254740992"],
  ["%.0f", "9007199254740993.5", "9007199254740994"],
] as const) {
  test(`printf retains long-double digits: ${format} ${operand}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(`printf '${format}' '${operand}'`, { env: { LC_ALL: "C", TZ: "UTC" } });
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const operand of ["   ", "\t", "0b101", "0o77", "+0b101", "-0o77"]) {
  test(`printf diagnoses non-C floating operand ${JSON.stringify(operand)}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(`printf '[%f]:%s' '${operand}' done`);
      assert.equal(result.stdout, operand === "-0o77" ? "[-0.000000]:done" : "[0.000000]:done");
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(operand));
      const parsed = parsePrintfFloat(operand);
      if (operand.trim() === "") assert.equal(parsed, undefined);
      else {
        assert.equal(parsed!.value, operand === "-0o77" ? -0 : 0);
        assert.equal(parsed!.error, "invalid number");
      }
    } finally { await shell.dispose(); }
  });
}

test("printf accepts decimal C floating syntax and preserves signed zero", () => {
  for (const [operand, expected] of [["  +1.25", 1.25], [".5", .5], ["1.", 1], ["1e-2", .01], ["-0.0", -0], ["010", 10]] as const) {
    assert.equal(parsePrintfFloat(operand)?.value, expected);
  }
  for (const operand of ["", ".", "+"]) assert.equal(parsePrintfFloat(operand), undefined);
  for (const [operand, value] of [["1e", 1], ["1e+", 1], ["1.2.3", 1.2], ["1junk", 1]] as const) {
    const parsed = parsePrintfFloat(operand);
    assert.equal(parsed?.value, value);
    assert.equal(parsed?.error, "invalid number");
  }
});
