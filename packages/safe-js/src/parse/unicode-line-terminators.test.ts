import { expect, it } from "vitest";
import { tokenize } from "./tokenizer.js";

it.each(["\u2028", "\u2029"])("recognizes %j as a line terminator outside strings", separator => {
  const tokens = tokenize(`return${separator}7`);
  expect(tokens.map(token => token.value)).toEqual(["return", "7", ""]);
  expect(tokens[1]?.start).toEqual({ line: 2, column: 1, offset: 7 });
  const commented = tokenize(`// ignored${separator}7`);
  expect(commented.map(token => token.value)).toEqual(["7", ""]);
  expect(commented[0]?.start.line).toBe(2);
  const block = tokenize(`/* ignored${separator} */7`);
  expect(block[0]?.start.line).toBe(2);
});

it.each(["\u2028", "\u2029"])("preserves %j inside quoted strings and advances source positions", separator => {
  const source = `"a${separator}b";7`;
  const tokens = tokenize(source);
  expect(tokens[0]?.value).toBe(`"a${separator}b"`);
  expect(tokens[0]?.end.line).toBe(2);
  expect(tokens[2]?.start.line).toBe(2);
});
