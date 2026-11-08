import { expect, it } from "vitest";
import { tokenize } from "./tokenizer.js";

it.each([
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000
])("recognizes Unicode space separator U+%s without inserting a line break", codePoint => {
  const space = String.fromCodePoint(codePoint);
  const source = `const${space}value${space}=${space}1;return${space}value`;
  expect(Function(source)()).toBe(1);
  const tokens = tokenize(source);
  expect(tokens.map(token => token.value)).toEqual(["const", "value", "=", "1", ";", "return", "value", ""]);
  expect(tokens.every(token => token.start.line === 1 && token.end.line === 1)).toBe(true);
  expect(tokenize(`"a${space}b"`)[0]?.value).toBe(`"a${space}b"`);
});

it.each([0x0085, 0x180e, 0x200b, 0x2060])("rejects non-whitespace U+%s between tokens", codePoint => {
  const source = `const${String.fromCodePoint(codePoint)}value=1`;
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => tokenize(source)).toThrow();
});
