import { expect, it } from "vitest";
import { applyEdits, findMatches, parseCode, rewriteCode } from "./index.js";

it("backtracks nested middle variadics without losing fixed suffixes", () => {
  const source = "fn(a, fn(b, c, d), e, z); fn(a,z); fn(a);";
  const matches = findMatches(parseCode(source), "fn($A, $$$MID, $Z)");
  expect(matches.map(m => [m.captures.A!.text, m.captures.MID!.text, m.captures.Z!.text]))
    .toEqual([["a", "fn(b, c, d), e", "z"], ["b", "c", "d"], ["a", "", "z"]]);
  expect(rewriteCode(parseCode(source), "fn($A, $$$MID, $Z)", "pair($A, $Z)"))
    .toBe("pair(a, z); pair(a, z); fn(a);");
});

it("handles a wide Unicode corpus with exact disjoint edits and repeated captures", () => {
  const count = 400;
  const source = Array.from({ length: count }, (_, i) => `/* 😀${i} */ f(v${i}); v${i} === v${i}; v${i} === other;`).join("\r\n");
  const tree = parseCode(source);
  const matches = findMatches(tree, "f($X)");
  expect(matches).toHaveLength(count);
  expect(findMatches(tree, "$X === $X")).toHaveLength(count);
  const bytes = new TextEncoder().encode(source);
  for (const match of matches) {
    expect(new TextDecoder().decode(bytes.slice(...match.node.range))).toBe(match.node.text);
  }
  const expected = Array.from({ length: count }, (_, i) => `/* 😀${i} */ g(v${i}); v${i} === v${i}; v${i} === other;`).join("\r\n");
  expect(rewriteCode(tree, "f($X)", "g($X)")).toBe(expected);
  expect(applyEdits(source, matches.map(m => ({ range: m.node.range, replacement: `g(${m.captures.X!.text})` })).reverse())).toBe(expected);
});

it("rewrites only the outermost of deeply nested spans", () => {
  const depth = 100;
  const source = "f(".repeat(depth) + "value" + ")".repeat(depth);
  const tree = parseCode(source);
  expect(tree.errors).toEqual([]);
  expect(findMatches(tree, "f($X)")).toHaveLength(depth);
  expect(rewriteCode(tree, "f($X)", "g($X)")).toBe("g" + source.slice(1));
});

it("matches nested JSX attributes and generic calls inside decorated methods", () => {
  const jsx = '<Box><Item data={{a: 1}}><Item data={value} /></Item></Box>';
  expect(findMatches(parseCode(jsx, "tsx"), '<Item data={$V} />').map(m => m.captures.V!.text)).toEqual(["value"]);
  const ts = '@sealed class C<T> { @memo method<U>(v: U) { return identity<Map<T, U>>(v); } }';
  const tree = parseCode(ts);
  expect(tree.errors).toEqual([]);
  expect(rewriteCode(tree, 'identity<$T>($V)', 'copy<$T>($V)')).toBe(ts.replace('identity', 'copy'));
});
