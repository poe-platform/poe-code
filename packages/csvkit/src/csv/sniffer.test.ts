import { test, expect } from "vitest";
import { sniff } from "./sniffer.js";

test.each([",", "\t", ";", " ", ":", "|"])("Agate accepts %j", delimiter => {
  expect(sniff(`a${delimiter}b\n1${delimiter}2\n`)?.delimiter).toBe(delimiter);
});
test.each(["", "abc\ndef\n", "\n\n"])("no delimiter falls back: %j", sample => {
  expect(sniff(sample)).toBeUndefined();
});
test("ambiguous samples use CPython preference, not highest frequency", () => {
  expect(sniff("a,b;c;d\n1,2;3;4\n")?.delimiter).toBe(",");
});
test("space inference follows first physical line", () => {
  expect(sniff("a, b\n1, 2\n")?.skipinitialspace).toBe(true);
  expect(sniff("a,b\n1, 2\n")?.skipinitialspace).toBe(false);
});
test("consistency subtraction rejects a 90 percent mode in ten lines", () => {
  expect(sniff("a,b\n".repeat(9) + "c\n")).toBeUndefined();
});
