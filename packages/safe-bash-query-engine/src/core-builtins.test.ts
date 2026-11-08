import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

// Per-name/arity compatibility matrix, pinned to /usr/bin/jq 1.7.1-apple.
const cases = [
  ['path(.a.b[0])', null, [["a", "b", 0]]],
  ['[path(.. | select(type == "number"))]', {a: {b: [10,20]}}, [[["a","b",0],["a","b",1]]]],
  ['path(.)', null, [[]]],
  ['[leaf_paths]', {a: false, b: null, c: 0, d: "", e: [], f: {}, g: true}, [[["c"],["d"],["g"]]]],
  ['fabs', -3.5, [3.5]],
  ["[combinations(0,1)]", [1, 2], [[[1], [2]]]],
  ["test(\"foo\")", "foobar", [true]],
  ["test(\"foo\"; \"i\")", "FOObar", [true]],
  ["match(\"(\\\\w+)\")", "foo bar", [{"offset": 0, "length": 3, "string": "foo", "captures": [{"offset": 0, "length": 3, "string": "foo", "name": null}]}]],
  ["match(\"(?<x>a)(a)?\"; \"g\")", "😀aa a", [{"offset": 1, "length": 2, "string": "aa", "captures": [{"offset": 1, "length": 1, "string": "a", "name": "x"}, {"offset": 2, "length": 1, "string": "a", "name": null}]}, {"offset": 4, "length": 1, "string": "a", "captures": [{"offset": 4, "length": 1, "string": "a", "name": "x"}, {"offset": -1, "string": null, "length": 0, "name": null}]}]],
  ["match(\"a(a)\")", "aaa", [{"offset": 0, "length": 2, "string": "aa", "captures": [{"offset": 1, "length": 1, "string": "a", "name": null}]}]],
  ["sub(\"foo\"; \"baz\")", "foo bar foo", ["baz bar foo"]],
  ["sub(\"foo\"; \"baz\"; \"i\")", "FOO bar foo", ["baz bar foo"]],
  ["[splits(\",\\\\s*\"; \"i\")]", "a, B, c", [["a", "B", "c"]]],
  ["[splits(\",\")]", "a,b", [["a", "b"]]],
  ["[scan(\"a\")]", "Aa", [["a"]]],
  ["[scan(\"a\"; \"i\")]", "Aa", [["A", "a"]]],
  ["in({\"a\":1})", "a", [true]],
  ["[index(\"aba\"),rindex(\"aba\")]", "ababa", [[0, 2]]],
  ["[index(1),rindex(1)]", [1, 2, 1, 2, 1], [[0, 4]]],
  ["[IN(1,2,3),IN(4,5,6)]", 3, [[true, false]]],
  ["IN(.[]; 2,4)", [1, 2], [true]],
  ["INDEX(.[]; .id)", [{"id": "x", "v": 1}, {"id": "y", "v": 2}], [{"x": {"id": "x", "v": 1}, "y": {"id": "y", "v": 2}}]],
  ["INDEX(.id)", [{"id": "x"}, {"id": "y"}], [{"x": {"id": "x"}, "y": {"id": "y"}}]],
  ["[isempty(empty),isempty(1,2),isempty(.[])]", [], [[true, false, true]]],
  ["[nth(2; .[]),nth(1; range(5))]", [10, 20, 30, 40], [[30, 1]]],
  ["nth(1)", [10, 20], [20]],
  ["explode | implode", "a😀b", ["a😀b"]],
  ["[combinations(2)]", [0, 1], [[[0, 0], [0, 1], [1, 0], [1, 1]]]],
  ["[combinations]", [[0, 1], [2, 3]], [[[0, 2], [0, 3], [1, 2], [1, 3]]]],
  ["pick(.a, .b.c, .e[1])", {"a": 1, "b": {"c": 2, "d": 3}, "e": [4, 5, 6]}, [{"a": 1, "b": {"c": 2}, "e": [null, 5]}]],
  ["[abs,floor,ceil,round,(9|sqrt)]", -3.7, [[3.7, -4, -3, -4, 3]]],
  ["[todate,(\"1970-01-01T00:00:00Z\"|fromdate),strftime(\"%Y-%m-%d %H:%M:%S\")]", 0, [["1970-01-01T00:00:00Z", 0, "1970-01-01 00:00:00"]]],
  ["gmtime | mktime", 0, [0]],
  ["strptime(\"%Y-%m-%d\")", "2024-02-29", [[2024, 1, 29, 0, 0, 0, 4, 59]]],
  ["nth(9)", [1], [null]],
  ["[nth(9; .[])]", [1], [[]]],
  ["isempty(1,error(\"unreachable\"))", null, [false]],
  ["nth(0; 1,error(\"unreachable\"))", null, [1]],
  ["pick(.missing)", {}, [{"missing": null}]],
  ["in([1,2])", 1, [true]],
  ["IN(empty; empty)", null, [false]],
  ["INDEX(tostring)", [1, 2, 1], [{"1": 1, "2": 2}]],
  ["[nth(1.5;range(4))]", null, [[2]]],
  ["[combinations(-1)]", [1, 2], [[[]]]],
  ["[combinations(0)]", [1, 2], [[[]]]],
  ["[test(\"x\"),test([\"a\",\"i\"])]", "A", [[false, true]]],
  ["[match(\"(?<x>a)?b\";\"g\")]", "b ab", [[{"offset": 0, "length": 1, "string": "b", "captures": [{"offset": -1, "string": null, "length": 0, "name": "x"}]}, {"offset": 2, "length": 2, "string": "ab", "captures": [{"offset": 2, "length": 1, "string": "a", "name": "x"}]}]]],
  ["[match(\"(?<=a)(a)\";\"g\")]", "aaa", [[{"offset": 1, "length": 1, "string": "a", "captures": [{"offset": 1, "length": 1, "string": "a", "name": null}]}, {"offset": 2, "length": 1, "string": "a", "captures": [{"offset": 2, "length": 1, "string": "a", "name": null}]}]]],
  ["[match(\"\";\"g\")]", "abc", [[{"offset": 0, "length": 0, "string": "", "captures": []}, {"offset": 1, "length": 0, "string": "", "captures": []}, {"offset": 2, "length": 0, "string": "", "captures": []}, {"offset": 3, "length": 0, "string": "", "captures": []}]]],
  ["[match(\"\";\"g\")]", "😀", [[{"offset": 0, "length": 0, "string": "", "captures": []}, {"offset": 1, "length": 0, "string": "", "captures": []}, {"offset": 1, "length": 0, "string": "", "captures": []}, {"offset": 1, "length": 0, "string": "", "captures": []}, {"offset": 1, "length": 0, "string": "", "captures": []}]]],
  ["[scan(\"(a)\";\"i\")]", "Aa", [[["A"], ["a"]]]],
  ["[scan(\"\";\"n\")]", "ab", [[]]],
  ["[splits(\"A\";\"i\")]", "aAa", [["", "", "", ""]]],
  ["IN(.[]; .)", [1, 2], [false]],
  ["INDEX((.a,.b))", [{"a": "x", "b": "y"}], [{"x": {"a": "x", "b": "y"}, "y": {"a": "x", "b": "y"}}]],
  ["sqrt | isnan", -1, [true]],
] as const;
for (const [filter, input, expected] of cases) {
  test(`core builtins (jq 1.7.1): ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce(filter);
      const values: unknown[] = [];
      for await (const value of session.run(JSON.parse(JSON.stringify(input)))) {
        values.push(JSON.parse(await session.ownedWork.stringifyJson(value, { pretty: false, maxBytes: 10000, limitName: "maxValueBytes" })));
      }
      assert.deepEqual(values, expected);
    } finally { await session.close(); }
  });
}

for (const [filter, input] of [
  ['test("[")', "a"], ['match("a"; "?")', "a"],
  ['scan("a"; 1)', "a"], ['splits("a"; "?")', "a"],
  ['nth(-1; .[])', [1]], ['in(1)', "a"], ['sqrt', "a"],
] as const) {
  test(`invalid builtin input: ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      session.compileOnce(filter);
      await assert.rejects(session.run(JSON.parse(JSON.stringify(input))).next());
    } finally { await session.close(); }
  });
}
for (const filter of ['[combinations(100)]', 'INDEX(range(1000); tostring)', 'pick(.[1000])', '[match("a"; "g")]']) {
  test(`builtin resource accounting: ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxSteps: 500, maxValueBytes: 100 } });
    try {
      session.compileOnce(filter);
      await assert.rejects(session.run(filter.includes('match') ? 'a'.repeat(50) : [1, 2]).next());
    } finally { await session.close(); }
  });
}
