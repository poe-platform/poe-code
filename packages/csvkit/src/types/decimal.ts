import { CsvkitBlocked } from "../errors.js";
import { stripWhitespace } from "../python-text.js";
import { decimalZeroes } from "../unicode-profile.js";

export class DecimalTrap extends Error {
  constructor(readonly operation: "InvalidOperation" | "DivisionByZero" | "Overflow") { super(operation); }
}

type Special = "Infinity" | "NaN" | "sNaN";

/** Precision-28 ROUND_HALF_EVEN arithmetic. Coefficients never pass through Number. */
export class Decimal {
  private constructor(
    readonly negative: boolean,
    readonly coefficient: bigint,
    readonly exponent: number,
    readonly special?: Special,
    readonly payload = ""
  ) {}

  static parse(text: string): Decimal {
    let ascii = "";
    for (const char of stripWhitespace(text)) {
      if (char === "_") continue;
      const code = char.codePointAt(0)!;
      const zero = decimalZeroes.find(start => code >= start && code < start + 10);
      ascii += zero === undefined ? char : String(code - zero);
    }
    text = ascii;
    const special = /^([+-]?)(Infinity|Inf|sNaN|NaN)(\d*)$/i.exec(text);
    if (special) {
      if (special[3]!.length > 10000) throw new CsvkitBlocked("Decimal admission budget exceeded");
      const name = special[2]!.toLowerCase();
      if (name.startsWith("inf") && special[3]) throw new DecimalTrap("InvalidOperation");
      return new Decimal(special[1] === "-", 0n, 0, name.startsWith("inf") ? "Infinity" : name === "snan" ? "sNaN" : "NaN", special[3]!.replace(/^0+/, ""));
    }
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match) throw new DecimalTrap("InvalidOperation");
    const fraction = match[3] ?? match[4] ?? "";
    const digits = (match[2] ?? "") + fraction;
    const exponent = BigInt(match[5] ?? "0") - BigInt(fraction.length);
    if (digits.length > 10000 || exponent < -10000n || exponent > 10000n) throw new CsvkitBlocked("Decimal admission budget exceeded");
    return new Decimal(match[1] === "-", BigInt(digits), Number(exponent));
  }

  private static finite(negative: boolean, coefficient: bigint, exponent: number, precision = 28): Decimal {
    let digits = coefficient.toString().length;
    if (digits > precision) {
      const cut = digits - precision;
      const divisor = 10n ** BigInt(cut);
      const rest = coefficient % divisor;
      coefficient /= divisor;
      if (rest * 2n > divisor || rest * 2n === divisor && coefficient % 2n !== 0n) coefficient++;
      exponent += cut;
      digits = coefficient.toString().length;
      if (digits > precision) { coefficient /= 10n; exponent++; }
    }
    if (exponent + coefficient.toString().length - 1 > 999999) throw new DecimalTrap("Overflow");
    if (Math.abs(exponent) > 20000) throw new CsvkitBlocked("Decimal arithmetic exponent budget exceeded");
    return new Decimal(negative, coefficient, exponent);
  }

  private nan(other: Decimal): Decimal | undefined {
    if (this.special === "sNaN" || other.special === "sNaN") throw new DecimalTrap("InvalidOperation");
    const value = this.special === "NaN" ? this : other.special === "NaN" ? other : undefined;
    return value && new Decimal(value.negative, 0n, 0, "NaN", value.payload.slice(-28).replace(/^0+/, ""));
  }

  add(other: Decimal): Decimal {
    const nan = this.nan(other); if (nan) return nan;
    if (this.special === "Infinity" || other.special === "Infinity") {
      if (this.special === other.special && this.negative !== other.negative) throw new DecimalTrap("InvalidOperation");
      return this.special ? this : other;
    }
    const exponent = Math.min(this.exponent, other.exponent);
    const a = this.coefficient * 10n ** BigInt(this.exponent - exponent) * (this.negative ? -1n : 1n);
    const b = other.coefficient * 10n ** BigInt(other.exponent - exponent) * (other.negative ? -1n : 1n);
    const sum = a + b;
    return Decimal.finite(sum < 0n || sum === 0n && this.negative && other.negative, sum < 0n ? -sum : sum, exponent);
  }

  multiply(other: Decimal): Decimal {
    const nan = this.nan(other); if (nan) return nan;
    const negative = this.negative !== other.negative;
    if (this.special || other.special) {
      if (!this.special && this.coefficient === 0n || !other.special && other.coefficient === 0n) throw new DecimalTrap("InvalidOperation");
      return new Decimal(negative, 0n, 0, "Infinity");
    }
    return Decimal.finite(negative, this.coefficient * other.coefficient, this.exponent + other.exponent);
  }

  /** CPython mpdecimal integer power: precision + exponent digits + 2. */
  square(): Decimal {
    const nan = this.nan(this); if (nan) return nan;
    if (this.special) return new Decimal(false, 0n, 0, "Infinity");
    if (this.coefficient === 0n) return new Decimal(false, 0n, 0);
    const working = Decimal.finite(false, this.coefficient * this.coefficient, this.exponent * 2, 31);
    return Decimal.finite(false, working.coefficient, working.exponent);
  }

  divide(other: Decimal): Decimal {
    const nan = this.nan(other); if (nan) return nan;
    const negative = this.negative !== other.negative;
    if (this.special && other.special) throw new DecimalTrap("InvalidOperation");
    if (this.special) return new Decimal(negative, 0n, 0, "Infinity");
    // The frozen precision-28 context has Emin=-999999, hence Etiny=-1000026.
    if (other.special) return new Decimal(negative, 0n, -1000026);
    if (other.coefficient === 0n) throw new DecimalTrap(this.coefficient === 0n ? "InvalidOperation" : "DivisionByZero");
    const preferred = this.exponent - other.exponent;
    if (this.coefficient === 0n) return Decimal.finite(negative, 0n, preferred);
    const shift = Math.max(0, 29 + other.coefficient.toString().length - this.coefficient.toString().length);
    const numerator = this.coefficient * 10n ** BigInt(shift);
    let coefficient = numerator / other.coefficient;
    // Keep a sticky digit for correctly rounding a quotient ending in a tie.
    const remainder = numerator % other.coefficient;
    if (remainder !== 0n) coefficient = coefficient * 10n + 1n;
    let result = Decimal.finite(negative, coefficient, preferred - shift - (remainder !== 0n ? 1 : 0));
    if (numerator % other.coefficient === 0n) {
      coefficient = result.coefficient;
      let exponent = result.exponent;
      while (exponent < preferred && coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
      result = new Decimal(negative, coefficient, exponent);
    }
    return result;
  }

  compare(other: Decimal): number {
    if (this.special === "NaN" || this.special === "sNaN" || other.special === "NaN" || other.special === "sNaN") throw new DecimalTrap("InvalidOperation");
    if (this.special || other.special) {
      if (this.special === other.special && this.negative === other.negative) return 0;
      return this.special ? (this.negative ? -1 : 1) : (other.negative ? 1 : -1);
    }
    if (this.coefficient === 0n && other.coefficient === 0n) return 0;
    if (this.negative !== other.negative) return this.negative ? -1 : 1;
    const exponent = Math.min(this.exponent, other.exponent);
    const a = this.coefficient * 10n ** BigInt(this.exponent - exponent);
    const b = other.coefficient * 10n ** BigInt(other.exponent - exponent);
    return (a === b ? 0 : a < b ? -1 : 1) * (this.negative ? -1 : 1);
  }

  normalized(): Decimal {
    const nan = this.nan(this); if (nan) return nan;
    if (this.special) return this;
    const rounded = Decimal.finite(this.negative, this.coefficient, this.exponent);
    let coefficient = rounded.coefficient;
    let exponent = rounded.exponent;
    if (coefficient === 0n) return new Decimal(this.negative, 0n, 0);
    while (coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
    return new Decimal(this.negative, coefficient, exponent);
  }

  toString(): string {
    const sign = this.negative ? "-" : "";
    if (this.special) return sign + this.special + this.payload;
    const digits = this.coefficient.toString();
    const adjusted = this.exponent + digits.length - 1;
    if (this.exponent > 0 || adjusted < -6) return sign + digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "E" + (adjusted >= 0 ? "+" : "") + adjusted;
    const point = digits.length + this.exponent;
    if (point > 0) return sign + digits.slice(0, point) + (point < digits.length ? "." + digits.slice(point) : "");
    return sign + "0." + "0".repeat(-point) + digits;
  }
}
