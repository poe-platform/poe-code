import assert from "node:assert/strict";
import test from "node:test";
import { shell, type NativeCase } from "./helpers.js";

export const seqCases: readonly NativeCase[] = [
  { args: ["4"] }, { args: ["0"] }, { args: ["3", "1"] }, { args: ["-2", "2"] },
  { args: ["5", "-2", "-1"] }, { args: ["0.1", "0.1", "0.4"] },
  { args: ["1.00", "0.1", "1.3"] }, { args: ["1e-2", "1e-2", "0.04"] },
  { args: ["-s", ":", "1", "3"] }, { args: ["--separator=", "3"] },
  { args: ["-w", "-2", "2"] }, { args: ["-w", "-0.1", "0.1", "0.2"] },
  { args: ["-w", "1.0", "0.5", "2.000"] },
  { args: ["-f", "%08.2f", "-1", "1"] }, { args: ["-f", "%.0f", "0.5", "1", "3.5"] },
  { args: ["-f", "[%+8.2e]%%", "1", "2"] }, { args: ["-f", "%.3g", "999", "1", "1001"] },
  { args: ["--format=%#.3G", "1", "3"] }, { args: ["-f", "%-8.1f", "1", "2"] },
  { args: ["9007199254740992", "9007199254740995"] },
  { args: ["1", "0", "3"], failure: true }, { args: [], failure: true },
  { args: ["-w", "-f", "%g", "3"], failure: true }, { args: ["-f", "%s", "3"], failure: true },
  { args: ["-f", "%g %g", "3"], failure: true }, { args: ["NaN"], failure: true },
  { args: ["1", "2", "3", "4"], failure: true }, { args: ["--bad"], failure: true },
];

test("seq exact bounded decimal extension does not accumulate floating drift", async () => {
  const instance = shell();
  const result = await instance.exec("seq 1 0.0000000000000000001 1.0000000000000000003");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1.0000000000000000000\n1.0000000000000000001\n1.0000000000000000002\n1.0000000000000000003\n");
  await instance.dispose();
});

test("seq output, digit, step and argument budgets fail boundedly", async () => {
  for (const [limits, command] of [
    [{ maxOutputBytes: 4 }, "seq 100"], [{ maxNumericDigits: 5 }, "seq 1e10"],
    [{ maxNumericDigits: 5 }, "seq 0x1p100"],
    [{ maxNumericDigits: 5 }, "seq 0x123456"],
    [{ maxNumericDigits: 5 }, "seq -f %.100a 1"],
    [{ maxSteps: 4 }, "seq 100"], [{ maxArgumentBytes: 2 }, "seq 100"],
  ] as const) {
    const instance = shell({ limits });
    const result = await instance.exec(command);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/);
    await instance.dispose();
  }
});

test("seq rejects short operands with excessive exponents by default", async () => {
  const instance = shell();
  try {
    for (const script of ["seq 1e-2000000", "seq 0x1p-2000000", "seq 1e2000000", "seq 0x1p2000000", "seq -f %.2000000f 1", "seq 1e-1025", "seq 0.1e-1024"]) {
      const result = await instance.exec(script);
      assert.equal(result.exitCode, 1, script);
      assert.equal(result.stdout, "", script);
      assert.match(result.stderr, /limit exceeded/, script);
    }
  } finally { await instance.dispose(); }
});

test("seq admits the default exponent boundary and explicit larger numeric budgets", async () => {
  for (const [limits, script] of [
    [undefined, "seq 1e-1024"],
    [{ maxNumericDigits: 2048 }, "seq 1e-2048"],
  ] as const) {
    const instance = shell(limits ? { limits } : {});
    try {
      const result = await instance.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
    } finally { await instance.dispose(); }
  }
});

test("seq preserves operand width and accepts hexadecimal numbers and conversions", async () => {
  const instance = shell();
  try {
    for (const [script, stdout] of [
      ["seq -w 001 5", "001\n002\n003\n004\n005\n"],
      ["seq -w 1 005", "001\n002\n003\n004\n005\n"],
      ["seq -w -001 2", "-001\n0000\n0001\n0002\n"],
      ["seq -w 001.5 0.5 2.5", "001.5\n002.0\n002.5\n"],
      ["seq 0x4", "1\n2\n3\n4\n"],
      ["seq 0x1p2", "1\n2\n3\n4\n"],
      ["seq 0x1.8p0 0x.8 0x2.8", "1.5\n2.0\n2.5\n"],
      ["seq -f '%a' 1 2", "0x1p+0\n0x1p+1\n"],
      ["seq -f '%a' -0 -0", "-0x0p+0\n"],
      ["seq -f '%#a' -0x1 -0x1", "-0x1.p+0\n"],
      ["seq -f '%A' 1 2", "0X1P+0\n0X1P+1\n"],
      ["seq -f '%.2a' 0x1.8 0x1.8", "0x1.80p+0\n"],
      ["seq -f '%.0a' 1.5 1.5", "0x2p+0\n"],
      ["seq -f '%020a' 1 1", "0x000000000000001p+0\n"],
    ] as const) {
      const result = await instance.exec(script);
      assert.equal(result.exitCode, 0, script + result.stderr);
      assert.equal(result.stdout, stdout, script);
    }
  } finally { await instance.dispose(); }
});

test("seq equal width truncates LAST at display precision instead of rounding up", async () => {
  const instance = shell();
  try {
    for (const [script, stdout] of [
      ["seq -w 7 1 9.5", "7\n8\n9\n"],
      ["seq -w 97 1 99.5", "97\n98\n99\n"],
      ["seq -w 9.7 0.1 9.95", "9.7\n9.8\n9.9\n"],
      ["seq -w -7 -1 -9.5", "-7\n-8\n-9\n"],
      ["seq -w 7 1 009.5", "007\n008\n009\n"],
      ["seq -w 7 1 0x9.8", "7\n8\n9\n"],
      ["seq -w 8 1 10", "08\n09\n10\n"],
      ["seq 0x1 0x3", "1\n2\n3\n"],
      ["seq -w 10e-1 2", "01.0\n02.0\n"],
      ["seq -w 100e-2 2", "001.00\n002.00\n"],
      ["seq -w 0 -1 -0", "00\n"],
      ["seq -w 1 -1 -0", "01\n00\n"],
    ] as const) {
      const result = await instance.exec(script);
      assert.equal(result.exitCode, 0, script + result.stderr);
      assert.equal(result.stdout, stdout, script);
    }
  } finally { await instance.dispose(); }
});
