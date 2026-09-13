import { expect, it } from "vitest";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { parseEvalScript, parseExecutableModule } from "./parser.js";

// ECMA-262 edition 16 §12.9.5: no LineTerminator in a RegExp body,
// including a character class or RegularExpressionBackslashSequence.
it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"].flatMap(line =>
  [line, "a" + line, "\\" + line, "[" + line + "]"].map(body => `/${body}/`)
))("rejects literal line terminators before execution: %j", source => {
  expect(() => parseEvalScript(source)).toThrow(SyntaxError);
  expect(() => parseExecutableModule(source, "guest.ajs")).toThrow();
});

it("keeps escaped pattern characters and constructor text valid", async () => {
  const source = 'return [/\\n/.test("\\n"), new RegExp("\\n").test("\\n")]';
  expect(await run(source)).toMatchObject({ok:true, returnValue:[true,true]});
  expect(lint('return eval("/\\\\n/.test(\\"\\\\n\\")")')).toEqual([]);
});

it("selects the regexp goal for /=/ while retaining division assignment", async () => {
  const source = 'let x=8; x/=2; return [x,/=/.test("="),`${/=/.source}`]';
  expect(() => parseEvalScript('let x=8; x/=2; /=/.test("=")')).not.toThrow();
  expect(await run(source)).toMatchObject({ok:true,returnValue:[4,true,"="]});
});
