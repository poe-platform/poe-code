import { describe, expect, it } from "vitest";
import { integerModularPower } from "./modular-power.js";

describe("integer modular power", () => {
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
