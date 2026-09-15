import { describe, expect, it } from "vitest";
import { integerModularPower } from "./modular-power.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("integer modular power", () => {
  it("charges bigint payloads in exponentiation and inversion", () => {
    for (const exponent of [17n, -17n]) {
      const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 0 });
      expect(() => integerModularPower(38n, exponent, 97n, meter)).toThrow(expect.objectContaining({ reason: "allocation" }));
    }
  });
  it("reserves loop intermediates beyond the cost of inspecting inputs", () => {
    for (const exponent of [12345n, -12345n]) {
      const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 250 });
      expect(() => integerModularPower(38n, exponent, 97n, meter)).toThrow(expect.objectContaining({ reason: "allocation" }));
    }
  });
  it("keeps metered results exact and charges larger payloads more", () => {
    const usages: number[] = [];
    for (const bits of [127n, 521n]) {
      const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
      const modulus = (1n << bits) - 1n;
      expect(integerModularPower(38n, -17n, modulus, meter)).toBe(integerModularPower(38n, -17n, modulus));
      usages.push(meter.usage.allocatedBytes);
    }
    expect(usages[0]).toBeGreaterThan(0);
    expect(usages[1]).toBeGreaterThan(usages[0]);
  });
  it("checks the meter before even validating a zero modulus", () => {
    const meter = new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 });
    expect(() => integerModularPower(2n, 3n, 0n, meter)).toThrow(ExecutionLimitError);
  });
  it("interrupts exponentiation and modular inversion loops", () => {
    for (const [base, exponent, modulus] of [[2n, 1n << 100n, 7n], [55n, -1n, 89n]]) {
      const complete = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
      integerModularPower(base, exponent, modulus, complete);
      const maxSteps = complete.usage.steps - 1;
      const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
      expect(() => integerModularPower(base, exponent, modulus, meter)).toThrow(ExecutionLimitError);
      expect(meter.usage.steps).toBe(maxSteps);
    }
  });
  it("honors cancellation even on modulus-one shortcuts", () => {
    const controller = new AbortController(); controller.abort();
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0, signal: controller.signal });
    expect(() => integerModularPower(0n, -1n, 1n, meter)).toThrow(ExecutionLimitError);
  });
  it.each([
    [2n, 10n, 1000n, 24n], [-2n, 3n, 5n, 2n], [-2n, 3n, -5n, -3n],
    [2n, 0n, 5n, 1n], [2n, 0n, -5n, -4n], [0n, 0n, 7n, 1n],
    [38n, -1n, 97n, 23n], [2n, -1n, -5n, -2n],
    [2n, -3n, 5n, 2n], [-2n, -3n, 5n, 3n],
    [0n, 0n, 1n, 0n], [0n, -1n, 1n, 0n], [0n, -1n, -1n, 0n]
  ])("pow(%s, %s, %s) is %s", (base, exponent, modulus, result) => {
    expect(integerModularPower(base, exponent, modulus)).toBe(result);
  });

  it("matches directly computed powers for small signed bases and moduli", () => {
    for (let base = -8n; base <= 8n; base++) for (let exponent = 0n; exponent <= 9n; exponent++) {
      for (let modulus = -9n; modulus <= 9n; modulus++) {
        if (modulus === 0n) continue;
        const raw = base ** exponent % modulus;
        const expected = raw !== 0n && (raw < 0n) !== (modulus < 0n) ? raw + modulus : raw;
        expect(integerModularPower(base, exponent, modulus)).toBe(expected);
      }
    }
  });

  it("reduces intermediate products instead of constructing the unmodulated power", () => {
    const exponent = 1n << 4096n;
    expect(integerModularPower(2n, exponent, 7n)).toBe(2n);
    expect(integerModularPower(2n, -exponent, 7n)).toBe(4n);
    expect(integerModularPower(2n, exponent, -7n)).toBe(-5n);
  });

  it("preserves exact large-integer inverses", () => {
    const modulus = (1n << 521n) - 1n;
    const base = (1n << 200n) + 37n;
    const inverse = integerModularPower(base, -1n, modulus);
    expect(base * inverse % modulus).toBe(1n);
    expect(integerModularPower(base, -17n, modulus) * integerModularPower(base, 17n, modulus) % modulus).toBe(1n);
    expect(integerModularPower(base + modulus * 123n, -1n, modulus)).toBe(inverse);
    expect(integerModularPower(base, -1n, -modulus)).toBe(inverse - modulus);
  });

  it.each([[0n, -1n, 5n], [2n, -1n, 4n], [6n, -3n, -9n], [-12n, -2n, 18n]])("rejects a noninvertible base: %s ** %s mod %s", (base, exponent, modulus) => {
    expect(() => integerModularPower(base, exponent, modulus)).toThrow(expect.objectContaining({ name: "ValueError", message: "base is not invertible for the given modulus" }));
  });

  it.each([-1n, 0n, 1n])("rejects zero modulus before handling exponent %s", exponent => {
    expect(() => integerModularPower(0n, exponent, 0n)).toThrow(expect.objectContaining({ name: "ValueError", message: "pow() 3rd argument cannot be 0" }));
  });
});
