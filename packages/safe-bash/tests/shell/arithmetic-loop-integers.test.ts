import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { setup } from "./helpers.js";
import { compilePureSmiProgram, intToStr, prepareArithmetic, runIntArithForLoop, runIntForLoop, sharedLoopIntRegs } from "../../src/shell/arithmetic.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { Runtime } from "../../src/shell/runtime.js";

for (const header of ["for ((i=0;i<3;i++))", "for i in {1..3}"]) {
  for (const expression of ["i + k", "i + k++", "i + --k", "i + (k = 7)", "i + (k += 2)"]) {
    test(`integer loops publish only assigned operands: ${header}: ${expression}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const source = `unset k; set -a; ${header}; do y=$(( ${expression} )); done; set +a`;
      const report = 'printf "k=%s y=%s i=%s\\n" "${k-UNSET}" "$y" "$i"';
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${source}; ${report}`], { encoding: "utf8" });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, "");
      // Repeated function calls exercise both initial and cached loop plans.
      const result = await shell.exec(`f() { ${source}; say "k=\${k-UNSET} y=$y i=$i"; }; f; f`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, native.stdout.repeat(2));
      const exported = await shell.exec(`f() { ${source}; }; f; f; envget k y i`);
      const nativeEnv = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${source}; /bin/bash -c 'printf "%s|%s|%s" "\${k-<unset>}" "$y" "$i"'`], { encoding: "utf8" });
      assert.equal(nativeEnv.status, 0, nativeEnv.stderr);
      assert.equal(nativeEnv.stderr, "");
      assert.equal(exported.exitCode, 0, exported.stderr);
      assert.equal(exported.stderr, "");
      assert.equal(exported.stdout, nativeEnv.stdout);
    });
  }
}

for (const initial of ["999", "text", ""]) test(`empty arithmetic loop preserves body variables: ${initial}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`x='${initial}'; : seed; for ((i=0;i<0;i++)); do x=$((i+1)); missing=$((i+2)); done; args "$x" "${'${missing-unset}'}" "$i" "$_"`);
  assert.equal(result.stdout, JSON.stringify([initial, "unset", "0", "seed"]));
  assert.equal(result.stderr, "");
});

for (const [initial, guard] of [["100000000", "none"], ["99999999", "none"], ["0", "watch"], ["0", "overlay"], ["0", "none"]] as const) test(`cached loop admission budgets: ${initial}, ${guard}`, async context => {
  const parsing = new ParseBudget(10000);
  const budget = {
    parsing, commands: 0, iterations: 0, hasCpuLimit: false,
    maxExpansionFieldsSmi: 1000, maxExpansionBytesSmi: 10000,
    maxCommandsSmi: 10000, maxLoopIterationsSmi: 10000,
    tick() { this.commands++; },
  };
  let charges = 0;
  const published = new Map<string, string>();
  const monitor = {
    hasOverlay: (name: string) => guard === "overlay" && name === "s",
    chargeInternal() { return { epoch: ++charges }; },
    publishStringVariable(name: string, value: string) { published.set(name, value); },
  };
  const store = { get: () => undefined, watches: new Set(guard === "watch" ? ["s"] : []) };
  const compiled = compilePureSmiProgram(prepareArithmetic("t+s*2+i"), new Set())!;
  const plan = {
    regNames: ["i", "t", "s"], fastLoopWords: Array.from({ length: 20 }, (_, i) => String(i + 1)),
    bodyStepCount: 1, touchedIntNamesList: ["i", "s"],
    intSteps: [{ name: "s", compiled, varRegMap: compiled.varNames.map(name => ["i", "t", "s"].indexOf(name)), targetReg: 2, isSub: false, extraNewlineByte: 0 }],
  };
  const variables = { t: "1", s: initial };
  const resultCode = Reflect.apply(Reflect.get(Runtime.prototype, "tryFastCachedForLoop"), { budget }, [
    {}, plan, { variables }, monitor, store, undefined, undefined, {},
  ]);
  if (initial === "0" && guard === "none") {
    assert.equal(resultCode, 0);
    assert.equal(budget.commands, 21);
    assert.equal(budget.iterations, 20);
    assert.ok(parsing.snapshot() < 10000);
    assert.equal(charges, 2);
    assert.deepEqual([...published], [["i", "20"], ["s", "3145705"]]);
  } else {
    assert.equal(resultCode, undefined);
    assert.deepEqual([budget.commands, parsing.snapshot(), charges], [0, 10000, 0]);
    assert.deepEqual(variables, { t: "1", s: initial });
    assert.equal(published.size, 0);
  }
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`f(){ for i in {1..20}; do s=$((t+s*2+i)); done; say "$s"; }; t=1; s=0; f; s=${initial}; f`);
  assert.equal(result.stdout, `3145705\n${Number(initial) * 1048576 + 3145705}\n`);
  assert.equal(result.stderr, "");
});

test("integer string cache converts negative one on its first lookup", () => {
  assert.equal(intToStr(-1), "-1");
  assert.equal(intToStr(-1), "-1");
});

for (const [condition, expected] of [
  ["$(say 0)", ""],
  ["$(say $((i < 2)))", "0\n1\n"],
] as const) test(`arithmetic loop awaits substituted condition: ${condition}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`for ((i=0; ${condition}; i++)); do say "$i"; if ((i == 3)); then break; fi; done`);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

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
