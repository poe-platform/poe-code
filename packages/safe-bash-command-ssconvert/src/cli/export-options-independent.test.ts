import { expect, it } from "vitest";
import { exportOptionPairs } from "./export-options.js";
import { cNumber } from "../conversion/c-number.js";
import { validateImageOptions } from "../conversion/image-options.js";

it("admits only the source's ASCII bare-key alphabet", () => {
  const allowed = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-!_.,:;|/$%#@~";
  for (let code = 1; code < 128; code++) {
    const character = String.fromCharCode(code);
    if (allowed.includes(character)) {
      expect([...exportOptionPairs(`${character}=x`)]).toEqual([[character, "x"]]);
    } else if (!" \t\n\r\f".includes(character) && character !== "'" && character !== '"') {
      expect(() => [...exportOptionPairs(`${character}=x`)]).toThrow("ssconvert: Syntax error");
    }
  }
});

it("uses the captured GLib whitespace set and rejects nearby controls", () => {
  for (const character of " \t\n\r\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000") {
    expect([...exportOptionPairs(`a${character}=${character}'x'${character}b=y`)]).toEqual([["a", "x"], ["b", "y"]]);
  }
  for (const character of "\u000b\u0085\u180e\u200b\u2060\ufeff") {
    expect([...exportOptionPairs(`a=x${character}b=y`)]).toEqual([["a", `x${character}b=y`]]);
    expect(() => [...exportOptionPairs(`a${character}=x`)]).toThrow("Syntax error");
  }
});

it("unescapes the next character without interpreting C or shell escapes", () => {
  for (const quote of ["'", '"']) {
    for (const character of ["n", "t", "0", "\\", quote, "\n", "é", "𝟘"]) {
      expect([...exportOptionPairs(`${quote}a\\${character}${quote}=${quote}\\${character}${quote}`)])
        .toEqual([[`a${character}`, character]]);
    }
  }
  expect([...exportOptionPairs("a=\\n b=$HOME c=`id`")]).toEqual([["a", "\\n"], ["b", "$HOME"], ["c", "`id`"]]);
});

it("distinguishes unfinished strings from missing equals after adjacent pairs", () => {
  for (const suffix of ["'", '"', "'x\\", '"x\\']) {
    const pairs = exportOptionPairs(`a='ok'${suffix}`);
    expect(pairs.next().value).toEqual(["a", "ok"]);
    expect(() => pairs.next()).toThrow("Quoted string not terminated");
  }
  expect([...exportOptionPairs("''=''\"\"=\"\"a='b'c=d")]).toEqual([["", ""], ["", ""], ["a", "b"], ["c", "d"]]);
  expect(() => [...exportOptionPairs("a='ok' 'closed'")]).toThrow("Syntax error");
});

it("matches independently computed hexadecimal binary fractions", () => {
  for (let numerator = 1; numerator <= 31; numerator++) {
    for (let exponent = -8; exponent <= 8; exponent++) {
      const expected = numerator * 2 ** exponent;
      const text = `0x${numerator.toString(16)}p${exponent}suffix`;
      expect(cNumber(text)).toBe(expected);
      if (expected >= 1 && expected <= 10000) expect(validateImageOptions([`resolution=${text}`])).toBe(expected);
      else expect(() => validateImageOptions([`resolution=${text}`])).toThrow("Invalid export option");
    }
  }
});

it("rounds boundary fractions before applying inclusive image bounds", () => {
  expect(validateImageOptions(["resolution=0x0.fffffffffffffcp0"])).toBe(1);
  expect(() => validateImageOptions(["resolution=0x0.fffffffffffff8p0"])).toThrow("Invalid export option");
  expect(validateImageOptions(["resolution=0x2710.0000000001p0"])).toBe(10000);
  expect(() => validateImageOptions(["resolution=0x2710.0000000002p0"])).toThrow("Invalid export option");
});
