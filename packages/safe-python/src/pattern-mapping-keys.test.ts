import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("literal mapping-pattern keys", () => {
  it("rejects complex literals whose integer real part overflows float conversion", () => {
    const huge = `1${"0".repeat(400)}`;
    expect(() => parseModule(`match value:\n case {${huge}+0j: x}: pass`)).toThrow(SyntaxError);
    expect(() => parseModule(`match value:\n case -${huge}+1j: pass`)).toThrow(SyntaxError);
    expect(() => parseModule(`match value:\n case {${huge}: x, 1e999: y}: pass`)).not.toThrow();
  });
  it.each([
    ["1", "1.0"], ["True", "1"], ["False", "-0.0"], ["0j", "0"], ["1+0j", "True"],
    ["-1+2j", "-1.0+2.0j"], ["1e999", "1e1000"], ["None", "None"],
    ["'ab'", "'a' 'b'"], ["b'ab'", "b'a' b'b'"], ["'\\U0001f600'", "'😀'"],
    ["9007199254740992", "9007199254740992.0"], ["9007199254740993+0j", "9007199254740992"]
  ])("rejects equal literal keys %s and %s", (a, b) => {
    expect(() => parseModule(`match value:\n case {${a}: x, ${b}: y}: pass`)).toThrow(SyntaxError);
  });

  it.each([
    ["9007199254740993", "9007199254740992.0"], ["'a'", "b'a'"], ["False", "None"],
    ["1", "1j"], ["1+2j", "1-2j"], ["'\\ud83d\\ude00'", "'😀'"],
    ["1e999", "-1e999"], ["Keys.A", "Keys.A"], ["Keys.A", "1"]
  ])("keeps distinct or dynamic keys %s and %s", (a, b) => {
    expect(() => parseModule(`match value:\n case {${a}: x, ${b}: y}: pass`)).not.toThrow();
  });

  it("checks nested mappings independently", () => {
    expect(() => parseModule("match value:\n case {'outer': {1: x, True: y}}: pass")).toThrow(SyntaxError);
    expect(() => parseModule("match value:\n case {1: {1: x}}: pass")).not.toThrow();
  });
});
