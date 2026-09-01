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
    [{ maxSteps: 4 }, "seq 100"], [{ maxArgumentBytes: 2 }, "seq 100"],
  ] as const) {
    const instance = shell({ limits });
    const result = await instance.exec(command);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/);
    await instance.dispose();
  }
});
