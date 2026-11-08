import { expect, it } from "vitest";
import { parseDynamicFunction, type DynamicFunctionKind } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { run } from "../run.js";

const constructors = [
  ["normal", Function],
  ["async", Object.getPrototypeOf(async function () {}).constructor],
  ["generator", Object.getPrototypeOf(function* () {}).constructor],
  ["async-generator", Object.getPrototypeOf(async function* () {}).constructor]
] as const;

it.each(constructors)("accepts HTML-like comments in %s constructor bodies", (kind, Constructor) => {
  for (const body of [
    "<!-- comment\nreturn a",
    "\n--> comment\nreturn a",
    "\n /* same line */ --> comment\nreturn a",
    "a; /* across\n lines */ --> comment\nreturn a",
    "\"use strict\"; <!-- comment\nreturn a",
    "return `${ <!-- comment\n a }`",
    "return `${\n --> comment\n a }`",
    "return a-->0"
  ]) {
    expect(() => Constructor("a", body)).not.toThrow();
    expect(() => parseDynamicFunction(kind as DynamicFunctionKind, "a", body)).not.toThrow();
  }
});

it("does not enable legacy comments for the ordinary tokenizer", () => {
  expect(() => tokenize("<!-- comment\n1")).toThrow();
  expect(() => tokenize("\n--> comment\n1")).toThrow();
});

it("does not consume a close delimiter following a same-line token as a comment", () => {
  const body = "return a; /* same line */ --> comment\nreturn a";
  expect(() => Function("a", body)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "a", body)).toThrow(SyntaxError);
});

it.each(["\n", "\r\n", "\u2028", "\u2029"])("preserves comment line terminators %j during execution", async newline => {
  for (const body of [
    `return <!-- comment${newline} 7`,
    `return \`\${${newline} --> comment${newline} 7}\``,
    `return 1; /* comment${newline} */ --> ignored${newline} return 2`
  ]) {
    const expected = Function(body)();
    expect(await run(`return Function(${JSON.stringify(body)})()`))
      .toMatchObject({ ok: true, returnValue: expected });
  }
});
