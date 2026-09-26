import { expect, test } from "vitest";
import { Decimal } from "./decimal.js";
import reference from "../../../../docs/csvkit/csvstat-metrics-review-reference.json" with { type: "json" };

test("square follows original precision-31 working context before precision-28 rounding", () => {
  for (const item of reference.power2Review.differences) {
    expect(Decimal.parse(item.input).square().toString()).toBe(item.power2);
    expect(Decimal.parse("-" + item.input).square().toString()).toBe(item.power2);
  }
});

test("square preserves original special values and preferred exponents", () => {
  for (const [input, expected] of [
    ["0.00", "0"], ["-0.00", "0"], ["1.000", "1.000000"],
    ["-2.00", "4.0000"], ["Infinity", "Infinity"], ["-Infinity", "Infinity"],
    ["NaN123", "NaN123"], ["-NaN123", "-NaN123"]
  ]) expect(Decimal.parse(input!).square().toString()).toBe(expected);
  expect(() => Decimal.parse("sNaN").square()).toThrow("InvalidOperation");
});

test("exact addition preserves integers beyond binary64 and trailing precision", () => {
  expect(Decimal.parse("9007199254740993.00").add(Decimal.parse("2.10")).toString()).toBe("9007199254740995.10");
  expect(Decimal.parse("-0.00").multiply(Decimal.parse("2.0")).toString()).toBe("-0.000");
});

test("context rounding is half even with carry and exponent preservation", () => {
  expect(Decimal.parse("1.2345678901234567890123456785").add(Decimal.parse("0")).toString()).toBe("1.234567890123456789012345678");
  expect(Decimal.parse("9999999999999999999999999999").add(Decimal.parse("1")).toString()).toBe("1.000000000000000000000000000E+28");
});

test("division uses precision 28, trims exact quotient zeros, and traps zero", () => {
  expect(Decimal.parse("1").divide(Decimal.parse("3")).toString()).toBe("0.3333333333333333333333333333");
  expect(Decimal.parse("1.00").divide(Decimal.parse("2")).toString()).toBe("0.50");
  expect(() => Decimal.parse("1").divide(Decimal.parse("0"))).toThrow("DivisionByZero");
  expect(() => Decimal.parse("0").divide(Decimal.parse("0"))).toThrow("InvalidOperation");
});

test("nonfinite arithmetic and comparison obey Decimal traps", () => {
  expect(Decimal.parse("NaN123").add(Decimal.parse("1")).toString()).toBe("NaN123");
  expect(() => Decimal.parse("sNaN").add(Decimal.parse("1"))).toThrow("InvalidOperation");
  expect(() => Decimal.parse("Infinity").add(Decimal.parse("-Infinity"))).toThrow("InvalidOperation");
  expect(() => Decimal.parse("NaN").compare(Decimal.parse("1"))).toThrow("InvalidOperation");
  expect(Decimal.parse("9007199254740993").compare(Decimal.parse("9007199254740992"))).toBe(1);
});

test("normalized keys differ from precision-preserving CSV text", () => {
  expect(Decimal.parse("123.4500").normalized().toString()).toBe("123.45");
  expect(Decimal.parse("1000.00").normalized().toString()).toBe("1E+3");
  expect(Decimal.parse("-0.000").normalized().toString()).toBe("-0");
  expect(Decimal.parse("123.4500").toString()).toBe("123.4500");
});

test("finite division rounds a sticky remainder above an exact half-even tie", () => {
  expect(Decimal.parse("2469135780246913578024691357").divide(Decimal.parse("2")).toString()).toBe("1234567890123456789012345678");
  expect(Decimal.parse("24691357802469135780246913571").divide(Decimal.parse("20")).toString()).toBe("1234567890123456789012345679");
});

test("finite division by infinity returns a signed zero at the context Etiny", () => {
  for (const [a, b, expected] of [
    ["1", "Infinity", "0E-1000026"],
    ["1", "-Infinity", "-0E-1000026"],
    ["-0.00", "-Infinity", "0E-1000026"],
    ["1E-10000", "Infinity", "0E-1000026"]
  ]) expect(Decimal.parse(a!).divide(Decimal.parse(b!)).toString()).toBe(expected);
});

test("Decimal string construction accepts Python whitespace, underscores and Unicode digits", () => {
  expect(Decimal.parse(" \t-١_٢.٣_٠e+٢\n").toString()).toBe("-1230");
  expect(Decimal.parse("_1__2_.3_").toString()).toBe("12.3");
  expect(Decimal.parse("\u0085-0.00\u0085").toString()).toBe("-0.00");
  expect(Decimal.parse("NaN_٠٠١٢").toString()).toBe("NaN12");
  expect(Decimal.parse("1\u001c").toString()).toBe("1");
});

test("special payloads obey the same digit admission budget as finite values", () => {
  expect(() => Decimal.parse("NaN" + "1".repeat(10001))).toThrow("Decimal admission budget exceeded");
  expect(() => Decimal.parse("sNaN" + "1".repeat(10001))).toThrow("Decimal admission budget exceeded");
});
