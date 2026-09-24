import { expect, it } from "vitest";
import { parseEvalScript, parseModule, parseSourceModule, type Statement } from "./parser.js";

const parsers = [
  { name: "ordinary", parse: (source: string) => parseModule(source).body[0]! },
  { name: "compact module", parse: (source: string) =>
    parseSourceModule(source, "branches.js", undefined, { compactAst: true }).module.body[0]! },
  { name: "compact classic", parse: (source: string) =>
    parseEvalScript(source, {}, undefined, "branches.js", { compactAst: true }).node.body[0]! }
];

const chain = (count: number) => Array.from({ length: count }, () => "if (flag) value;").join(" else ") + " else fallback;";

it.each(parsers)("parses else-if chains up to the explicit limit: $name", ({ parse }) => {
  const source = chain(2048);
  let statement: Statement | undefined = parse(source);
  let count = 0;
  while (statement?.type === "IfStatement") {
    expect(statement.span.end.offset).toBe(source.length - 1);
    count++;
    statement = statement.alternate;
  }
  expect(count).toBe(2048);
  expect(statement).toMatchObject({ type: "ExpressionStatement", expression: { name: "fallback" } });
  expect(() => parse(chain(2049))).toThrow("If statement nesting limit exceeded");
});

it.each(parsers)("keeps dangling else clauses attached to their nearest if: $name", ({ parse }) => {
  const statement = parse("if (a) if (b) c; else if (d) e; else f; else if (g) h; else i;");
  expect(statement).toMatchObject({
    type: "IfStatement", test: { name: "a" },
    consequent: {
      type: "IfStatement", test: { name: "b" },
      alternate: { type: "IfStatement", test: { name: "d" }, alternate: { expression: { name: "f" } } }
    },
    alternate: { type: "IfStatement", test: { name: "g" }, alternate: { expression: { name: "i" } } }
  });
});
