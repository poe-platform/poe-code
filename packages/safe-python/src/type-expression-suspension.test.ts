import { describe, expect, it } from "vitest";
import { analyzeModule } from "./analysis.js";

const templates = [
  "type A = EXPR", "def f[T: EXPR](): pass",
  "def f[T: (EXPR, int)](): pass", "def f[T = EXPR](): pass",
  "def f[*Ts = EXPR](): pass", "def f[**P = EXPR](): pass",
  "class C[T: EXPR]: pass", "async def outer():\n type A = EXPR",
];

describe.each(templates)("type expression suspension: %s", template => {
  it.each([
    "[await x for x in xs]", "[x async for x in xs]",
    "[x for x in xs for y in (await ys)]", "[x for x in xs if await x]",
    "[[x async for x in xs] for y in ys]", "lambda: [await x for x in xs]",
  ])("rejects an eagerly evaluated asynchronous comprehension: %s", expression => {
    expect(() => analyzeModule(template.replace("EXPR", expression)))
      .toThrow("asynchronous comprehension outside of an asynchronous function");
  });
  it.each([
    "(x async for x in xs)", "(await x for x in xs)",
    "([x async for x in xs] for y in ys)", "[x for x in (y async for y in ys)]",
    "lambda: (x async for x in xs)", "[lambda: (yield x) for x in xs]",
  ])("accepts a separate generator scope: %s", expression => {
    expect(() => analyzeModule(template.replace("EXPR", expression))).not.toThrow();
  });
  it("rejects await in a synchronous lambda body", () => {
    expect(() => analyzeModule(template.replace("EXPR", "lambda: (await x)")))
      .toThrow("'await' outside async function");
  });
});

it("preserves the whole asynchronous comprehension diagnostic span", () => {
  expect(() => analyzeModule("type A = [await x for x in xs]", {filename:"audit.py"}))
    .toThrowError(expect.objectContaining({filename:"audit.py",
      message:"asynchronous comprehension outside of an asynchronous function",
      position:{offset:9,line:1,column:9}, endPosition:{offset:30,line:1,column:30},
    }));
});

it.each(["[await x for x in xs]", "[x async for x in xs]", "[[x async for x in xs] for y in ys]"])
  ("uses the same suspension rules for ordinary expressions: %s", expression => {
    expect(() => analyzeModule(`result = ${expression}`))
      .toThrow("asynchronous comprehension outside of an asynchronous function");
    expect(() => analyzeModule(`async def f():\n return ${expression}`)).not.toThrow();
  });

it.each([
  ["type A = {await x for x in xs}", 1, 9, 1, 30],
  ["type A = {x: await x for x in xs}", 1, 9, 1, 33],
  ["type A = (([await x for x in xs]))", 1, 11, 1, 32],
  ["type A = (x for x in [y async for y in ys])", 1, 21, 1, 42],
  ["type A = [lambda x=(await y): x for y in ys]", 1, 9, 1, 44],
  ["type A = [\n await x\n for x in xs\n]", 1, 9, 4, 1],
] as const)("retains nested and multiline suspension spans: %s", (source, line, column, endLine, endColumn) => {
  expect(() => analyzeModule(source, {filename:"audit.py"}))
    .toThrowError(expect.objectContaining({filename:"audit.py",
      message:"asynchronous comprehension outside of an asynchronous function",
      position:expect.objectContaining({line,column}),
      endPosition:expect.objectContaining({line:endLine,column:endColumn}),
    }));
});

it.each(["(x for x in (await xs))", "[x for x in (await xs)]"])
  ("keeps the first iterable in its annotation scope: %s", expression => {
    expect(() => analyzeModule(`type A = ${expression}`))
      .toThrow("await expression cannot be used within a type alias");
  });

it("keeps assignment restrictions ahead of asynchronous comprehension diagnostics", () => {
  expect(() => analyzeModule("type A = [x async for x in xs if (y:=1)]"))
    .toThrow("assignment expression within a comprehension cannot be used in a type alias");
});

it("validates adversarial nested eager comprehensions without losing the outer span", () => {
  const source = `type A = ${"[".repeat(80)}[await x for x in xs]${" for y in ys]".repeat(80)}`;
  expect(() => analyzeModule(source)).toThrowError(expect.objectContaining({
    message:"asynchronous comprehension outside of an asynchronous function",
    position:{offset:9,line:1,column:9},
    endPosition:{offset:source.length,line:1,column:source.length},
  }));
});

it.each([
  ["[(yield x) for x in xs]", "'yield' inside list comprehension", 11, 18],
  ["{(yield x) for x in xs}", "'yield' inside set comprehension", 11, 18],
  ["{x:(yield x) for x in xs}", "'yield' inside dict comprehension", 13, 20],
  ["((yield x) for x in xs)", "'yield' inside generator expression", 11, 18],
  ["[(yield from x) for x in xs]", "'yield' inside list comprehension", 11, 23],
] as const)("preserves collection-specific yield diagnostics: %s", (expression, message, column, endColumn) => {
  expect(() => analyzeModule(`type A = ${expression}`)).toThrowError(expect.objectContaining({
    message, position:{offset:column,line:1,column},
    endPosition:{offset:endColumn,line:1,column:endColumn},
  }));
});
