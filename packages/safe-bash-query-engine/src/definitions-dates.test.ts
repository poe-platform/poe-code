import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "./query-core.js";

for (const [filter, input, expected] of [
  ['1 | def f: . + 1; f | f', null, [3]],
  ['def fact: if . <= 1 then 1 else . * ((. - 1) | fact) end; 5 | fact', null, [120]],
  ['def countdown(n): if n <= 0 then 0 else n, countdown(n - 1) end; [countdown(3)]', null, [[3, 2, 1, 0]]],
  ['def countdown($n): if $n <= 0 then 0 else $n, countdown($n - 1) end; [countdown(3)]', null, [[3, 2, 1, 0]]],
  ['def outer: def inner: . + 1; inner | inner; 5 | outer', null, [7]],
  ['(def f: . + 10; f) + (def f: . + 20; f)', 1, [32]],
  ['if true then def f: . + 1; f else . end', 1, [2]],
  ['def outer(f): def inner(f): f; inner(f + 1); outer(. * 2)', 3, [7]],
  ['def f: 1; (def f: 2; f), f', null, [2, 1]],
  ['1 as $x | def f: $x; 2 as $x | f', null, [1]],
  ['def outer($x): def inner: $x; 9 as $x | inner; outer(3)', null, [3]],
  ['sub("(?<a>[0-9]+)"; "num:\\(.a)")', 'id=42', ['id=num:42']],
  ['sub("a"; "x")', 'aaa', ['xaa']],
  ['sub("a"; "x"; "g")', 'aaa', ['xxx']],
  ['gsub("(?<a>[0-9]+)"; "num:\\(.a)")', '1 2', ['num:1 num:2']],
  ['gsub("a"; ("x", "y"); "i")', 'Aa', ['xx', 'yy']],
  ['strptime("%FT%T%z")', '2024-01-01T00:30:00+0230', [[2023, 11, 31, 22, 0, 0, 0, 364]]],
  ['strptime("%Y %W %w")', '2024 09 4', [[2024, 1, 29, 0, 0, 0, 4, 59]]],
  ['strptime("%s")', '123', [[1970, 0, 1, 0, 2, 3, 4, 0]]],
  ['gmtime', 0, [[1970, 0, 1, 0, 0, 0, 4, 0]]],
  ['mktime', [1970, 0, 1, 0, 0, 0, 4, 0], [0]],
  ['strftime("%Y-%m-%dT%H:%M:%SZ")', 0, ['1970-01-01T00:00:00Z']],
  ['strptime("%Y-%m-%dT%H:%M:%SZ")', '1970-01-01T00:00:00Z', [[1970, 0, 1, 0, 0, 0, 4, 0]]],
  ['strptime("%Y-%m-%d") | mktime | gmtime | strftime("%F %j %a")', '2024-02-29', ['2024-02-29 060 Thu']],
] as const) {
  test(`definitions, replacements and dates: ${filter}`, async () => {
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

for (const [filter, message] of [
  ['def f: missing; f', '1 compile error'],
  ['(def f: .; f) | f', 'f/0 is not defined'],
  ['strftime("%Y"; "UTC")', 'strftime/2 is not defined'],
  ['def f: f; f', 'maxSteps limit exceeded'],
  ['"2024-01-01rest" | strptime("%F")', 'does not match format'],
  ['-1 | gmtime | mktime', 'invalid gmtime representation'],
  ['null | gmtime', 'requires numeric inputs'],
  ['[] | mktime', 'requires parsed datetime inputs'],
] as const) {
  test(`query errors remain bounded: ${filter}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxSteps: 200 } });
    try {
      await assert.rejects(async () => {
        session.compileOnce(filter);
        for await (const value of session.run(null)) void value;
      }, error => error instanceof Error && error.message.includes(message) && !error.message.includes('2 compile errors'));
    } finally { await session.close(); }
  });
}
