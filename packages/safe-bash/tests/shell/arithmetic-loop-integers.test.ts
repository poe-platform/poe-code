import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { compilePureSmiProgram, prepareArithmetic, runIntArithForLoop, runIntForLoop, sharedLoopIntRegs } from "../../src/shell/arithmetic.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError } from "../../src/shell/types.js";

for (const header of ["for ((i=0;i<100;i++))", "for i in {1..100}"]) {
  for (const [initial, expression, expected] of [
    ["0", "60000 * 60000", "3600000000"],
    ["0", "s + 50000000", "5000000000"],
    ["1", "s * 2", "0"],
    ["0", "(60000 * 60000) * (60000 * 60000)", "-5486744073709551616"],
    ["0", "-(60000 * 60000)", "-3600000000"],
    ["0", "(60000 * 60000) / 2", "1800000000"],
    ["0", "(60000 * 60000) % 7", "2"],
  ]) test(`integer loop parity: ${header}: ${expression}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`s=${initial}; ${header}; do s=$(( ${expression} )); done; say "$s"`);
      assert.equal(result.stdout, `${expected}\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("word-loop fallback preserves registers and parse allowance", () => {
  const compiled = compilePureSmiProgram(prepareArithmetic("i + s"), new Set())!;
  const budget = new ParseBudget(1000);
  sharedLoopIntRegs.fill(0);
  sharedLoopIntRegs[1] = 7;
  const saved = sharedLoopIntRegs.slice();
  const allowance = budget.snapshot();
  const result = runIntForLoop(["1", "100000000"], 1, [{ name: "s", compiled, varRegMap: [0, 1], targetReg: 1, isSub: false, extraNewlineByte: 0 }], budget);
  assert.equal(result.ok, false);
  assert.deepEqual(sharedLoopIntRegs, saved);
  assert.equal(budget.snapshot(), allowance);
});

for (const header of ["for ((i=0;i<32;i++))", "for i in {1..32}"]) test(`power accumulation: ${header}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`p=1; ${header}; do p=$((p * 2)); done; say "$p"`);
    assert.equal(result.stdout, "4294967296\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const route of ["arithmetic", "words"]) test(`${route} numeric bailout restores every register and parse allowance`, () => {
  const compiled = compilePureSmiProgram(prepareArithmetic("s * 2"), new Set())!;
  const budget = new ParseBudget(1000);
  sharedLoopIntRegs.fill(0);
  sharedLoopIntRegs[1] = 1;
  const saved = sharedLoopIntRegs.slice();
  const steps = [{ name: "s", compiled, varRegMap: [1], targetReg: 1, isSub: false, extraNewlineByte: 0 }];
  const result = route === "arithmetic"
    ? runIntArithForLoop(0, 60, false, 1, 0, steps, budget)
    : runIntForLoop(Array.from({ length: 60 }, (_, i) => String(i)), 1, steps, budget);
  assert.equal(result.ok, false);
  assert.deepEqual(sharedLoopIntRegs, saved);
  budget.admit(1000);
  assert.equal(budget.snapshot(), 0);
});

for (const route of ["arithmetic", "words"]) for (const wide of [false, true]) test(`${route} substitution accounting or exact bailout: wide=${wide}`, () => {
  const compiled = compilePureSmiProgram(prepareArithmetic(wide ? "60000 * 60000" : "60000 * 6000"), new Set())!;
  const budget = new ParseBudget(1000);
  const saved = sharedLoopIntRegs.slice();
  const allowance = budget.snapshot();
  const steps = [{ name: "s", compiled, varRegMap: [], targetReg: 1, isSub: true, extraNewlineByte: 1 }];
  const result = route === "arithmetic"
    ? runIntArithForLoop(0, 2, false, 1, 0, steps, budget)
    : runIntForLoop(["1", "2"], 1, steps, budget);
  assert.equal(result.ok, !wide);
  if (wide) {
    assert.deepEqual(sharedLoopIntRegs, saved);
    assert.equal(budget.snapshot(), allowance);
  } else {
    assert.equal(result.subBytes, 20);
    assert.equal(result.subCount, 2);
  }
});

for (const header of ["for ((i=0;i<2;i++))", "for i in 1 2"]) {
  for (const maxOutputBytes of [32, 33]) test(`wide substitution output budget: ${header}, bytes=${maxOutputBytes}`, async () => {
    const { shell } = setup({ limits: { maxOutputBytes } });
    try {
      const execution = shell.exec(`${header}; do s=$(say $((60000 * 60000))); done; say "$s"`);
      if (maxOutputBytes === 32) await assert.rejects(execution, ShellLimitError);
      else {
        const result = await execution;
        assert.equal(result.stdout, "3600000000\n");
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      }
    } finally { await shell.dispose(); }
  });
}
