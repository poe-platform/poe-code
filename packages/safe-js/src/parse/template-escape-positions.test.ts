import { expect, it } from "vitest";
import { parse } from "./parser.js";

it.each(["\n", "\r", "\r\n"].flatMap(line => ["\\xZ", "\\uZZZZ", "\\8"].flatMap(escape =>
  ["a", "a${1}b"].map(prefix => ({ line, escape, prefix }))
)))("locates $escape after $line in $prefix", ({ line, escape, prefix }) => {
  expect(() => parse("`" + prefix + line + "bc" + escape + "`"))
    .toThrow("at line 2, column 3.");
});

it.each(["\\xZ", "\\uZZZZ", "\\8"])("keeps source positions after multiple CRLF sequences: %s", escape => {
  expect(() => parse("`a\r\nb\r\ncd" + escape + "`"))
    .toThrow("at line 3, column 3.");
});
