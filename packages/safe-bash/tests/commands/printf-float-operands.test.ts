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

test("printf accepts decimal C floating syntax and preserves signed zero", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    for (const [operand, expected] of [["  +1.25", "1.25"], [".5", "0.5"], ["1.", "1"], ["1e-2", "0.01"], ["-0.0", "-0"], ["010", "10"]]) {
      const result = await shell.exec(`printf %g '${operand}'`);
      assert.equal(result.stdout, expected);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
    }
    for (const operand of ["", ".", "+"]) assert.equal(parsePrintfFloat(operand), undefined);
    for (const [operand, expected] of [["1e", "1"], ["1e+", "1"], ["1.2.3", "1.2"], ["1junk", "1"]]) {
      const result = await shell.exec(`printf %g '${operand}'`);
      assert.equal(result.stdout, expected);
      assert.equal(result.exitCode, 1);
      assert.equal(parsePrintfFloat(operand)?.error, "invalid number");
    }
  } finally { await shell.dispose(); }
});

for (const [format, operand, expected] of [
  ["%g", "1e400", "1e+400"],
  ["%g", "1e-400", "1e-400"],
  ["%a", "0x1p1024", "0x8p+1021"],
  ["%a", "0x1p-1075", "0x8p-1078"],
  ["%a", "0x1p50", "0x8p+47"],
  ["%.0f", "9007199254740992", "9007199254740992"],
  ["%.20e", "1e400", "1.00000000000000000003e+400"],
  ["%.20e", "1e-400", "9.99999999999999999979e-401"],
  ["%a", "1e400", "0xd.a763fc8cb9ff9e6p+1325"],
  ["%a", "1e-400", "0x9.5fe7e07c91efafap-1332"],
  ["%+.2E", "1e400", "+1.00E+400"],
  ["%012g", "-1e-400", "-000001e-400"],
  ["%#.3A", "-0x1p-1075", "-0X8.000P-1078"],
  ["%.0f", "0x1p1024", (1n << 1024n).toString()],
  ["%a", "0x1p16383", "0x8p+16380"],
  ["%a", "0x1p-16382", "0x8p-16385"],
  ["%a", "0x1p-16445", "0x0.000000000000001p-16385"],
  ["%g", "1e4932", "1e+4932"],
] as const) {
  test(`printf retains the Linux long-double exponent range: ${format} ${operand}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(`printf '${format}' '${operand}'`, { env: { LC_ALL: "C", TZ: "UTC" } });
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const route of ["assignment", "substitution", "loop"]) {
  test(`printf retains extended operands through ${route}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const invocation = "printf '%g|%a' 1e400 -0x1p-1075";
      const script = route === "assignment" ? "printf -v value '%g|%a' 1e400 -0x1p-1075; printf '%s' \"$value\""
        : route === "substitution" ? `value=$(${invocation}); printf '%s' "$value"`
        : `for value in once; do ${invocation}; done`;
      const result = await shell.exec(script);
      assert.equal(result.stdout, "1e+400|-0x8p-1078");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("printf retains extended numeric prefixes when diagnosing trailing input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf '%g|%a' 1e400junk -0x1p-1075junk");
    assert.equal(result.stdout, "1e+400|-0x8p-1078");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "printf: '1e400junk': invalid number\nprintf: '-0x1p-1075junk': invalid number\n");
  } finally { await shell.dispose(); }
});
