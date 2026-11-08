import { expect, it } from "vitest";
import { parse, parseModule } from "./parser.js";
import { hashSource } from "./hash.js";
import { lint } from "../lint.js";

it("recognizes BigInt as a runtime global in harness lint", () => {
  expect(lint("export default () => BigInt('1') + 1n;").map(diagnostic => diagnostic.code)).not.toContain("AS003");
});

it.each(["0n", "123n", "1_000n", "0xffn", "0b10n", "0o77n"])("parses BigInt literal %s with JSON-safe AST data", raw => {
  const ast = parse(raw);
  expect(ast).toMatchObject({ type: "BigIntLiteral", raw, value: raw.slice(0,-1).replaceAll("_", "") });
  expect(JSON.parse(JSON.stringify(ast))).toEqual(ast);
  expect(hashSource(raw)).not.toBe(hashSource(raw.slice(0,-1)));
});

it.each(["1.0n", ".1n", "1e2n", "01n", "00n", "1_n", "0x_n", "1nfoo", "1n0", "1nn"])("rejects invalid BigInt spelling %s", source => {
  expect(() => Function('"use strict";return '+source)).toThrow(SyntaxError);
  expect(() => parse(source)).toThrow();
});

it("accepts BigInt property names and template substitutions", () => {
  expect(() => parseModule("const x={0xffn:1};class X{1n(){return 2}};const y=`${1n}`;")).not.toThrow();
});
